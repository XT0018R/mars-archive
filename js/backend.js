/* ============================================================
   后端适配器 —— 连接免费 Supabase 项目（REST API，无需 SDK）
   ------------------------------------------------------------
   仅在用户开启共享时用到。未配置密钥时所有方法优雅降级：
   isConfigured() 返回 false，UI 会禁用共享开关并给出引导。
   详见 README.md「开启共享功能」。
   ============================================================ */
const Backend = (() => {
  const cfg = () => window.APP_CONFIG || {};
  const url = () => (cfg().SUPABASE_URL || '').replace(/\/+$/, '');
  const key = () => cfg().SUPABASE_ANON_KEY || '';

  const isConfigured = () => {
    const u = url(), k = key();
    return u.startsWith('http') && k.length > 10;
  };

  function headers(extra = {}) {
    const h = {
      'apikey': key(),
      'Authorization': 'Bearer ' + key()
    };
    return Object.assign(h, extra);
  }

  async function api(path, opts = {}) {
    // 关键：默认鉴权头（apikey/Authorization）必须保留，调用方传入的 headers 只在其上合并，不可覆盖
    const finalHeaders = Object.assign(headers(), opts.headers || {});
    // 客户端超时：海外 Supabase 经常「连接上了但不回包」，无超时会导致请求无限挂起、
    // 批量上传时只有前几张能成功。默认 12s，超时即抛错走重试/失败分支。
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 12000);
    let res;
    try {
      res = await fetch(url() + path, Object.assign({}, opts, { headers: finalHeaders, signal: ctrl.signal }));
    } catch (e) {
      clearTimeout(timer);
      throw new Error(e.name === 'AbortError' ? '请求超时' : (e.message || '网络错误'));
    }
    clearTimeout(timer);
    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch (_) {}
      throw new Error('HTTP ' + res.status + (body ? ' · ' + body.slice(0, 160) : ''));
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : null;
  }

  function dataURLtoBlob(dataURL) {
    const [meta, b64] = dataURL.split(',');
    const mime = (meta.match(/:(.*?);/) || [, 'image/jpeg'])[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  return {
    isConfigured,

    /* 共享「我去过」——写入 attendance 表 */
    async shareAttendance(show) {
      await api('/rest/v1/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          show_id: show.id, device_id: Store.deviceId(),
          city: show.city, province: show.province
        })
      });
    },

    /* 取消共享某场：同时撤下该场该设备的 attendance 与照片 */
    async unshareAttendance(showId) {
      await api('/rest/v1/rpc/remove_shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_show: showId, p_device: Store.deviceId() })
      });
    },

    /* 共享一张照片：直接以 base64(dataURL) 写入 photos 表，绕开 Storage 上传链路
       （Storage 上传在部分浏览器/环境下会触发 CORS 预检失败，而 /rest/v1 写入已验证在浏览器中可用）
       story 为可选文字（火星小故事）；仅当 story 列已就绪（window.__storyReady）时才写入。 */
    async sharePhoto(showId, dataUrl, story = null) {
      const deviceId = Store.deviceId();
      const body = { show_id: showId, device_id: deviceId, url: dataUrl };
      if (story && window.__storyReady) body.story = story;
      const row = await api('/rest/v1/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
        body: JSON.stringify(body)
      });
      return (Array.isArray(row) && row[0] && row[0].id) || null;
    },

    /* 取消共享一张照片 */
    async unsharePhoto(photoId) {
      await api('/rest/v1/rpc/remove_photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_id: photoId, p_device: Store.deviceId() })
      });
    },

    /* 管理员删除回忆墙中任意一张照片（需 ADMIN_DEVICE_IDS 配置 + 后端 RPC admin_delete_photo）
       仅前端判定为管理员时才调用；后端 RPC 内应校验权限。 */
    async adminDeletePhoto(photoId) {
      await api('/rest/v1/rpc/admin_delete_photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_id: photoId, p_admin: Store.deviceId() })
      });
    },

    /* 轻量探测 story 列是否存在（不拉全量数据；避免从时间轴直接「共享」时 __storyReady 尚未探测导致故事被漏传） */
    async probeStory() {
      let ok = false;
      try { await api('/rest/v1/photos?select=story&limit=1'); ok = true; }
      catch (_) {}
      window.__storyReady = ok;
      return ok;
    },

    /* 拉取回忆墙数据：共享照片流（含文字 story 列）
       注意：不再依赖 rpc/wall_stats（该 RPC 未创建时会直接拖垮整个请求，导致照片也拿不到）。
       回忆墙统计（位/张/条）已在 paintWall 里基于照片流本地计算，无需远端统计函数。
       整体 try-catch 确保任何一个子请求失败不会导致整个 getWall 崩溃。 */
    async getWall() {
      // 并行拉取照片（含 story 列探测）与足迹：每个请求 8s 超时，整体约 8s 完成，
      // 稳定赢下 syncWallFromBackend 的竞速超时。
      // 旧实现为串行 3 请求（探测 story 列 + 照片 + 足迹），默认 12s 超时最慢 36s，
      // 必输 20s 竞速 → 海外 Supabase 一慢就判「云端连不上」退回过期静态快照，
      // 导致新共享的足迹在别的设备永远看不到。此为跨设备同步失败的根因。
      const photosP = api('/rest/v1/photos?select=id,show_id,device_id,url,story,created_at&order=created_at.desc.nullslast&limit=120', { timeout: 8000 })
        .then(r => { window.__storyReady = true; return Array.isArray(r) ? r : []; })
        .catch(async () => {
          // story 列可能不存在：退回不含 story 的查询（__storyReady 保持 falsy）
          try {
            const r2 = await api('/rest/v1/photos?select=id,show_id,device_id,url,created_at&order=created_at.desc.nullslast&limit=120', { timeout: 8000 });
            return Array.isArray(r2) ? r2 : [];
          } catch (e) {
            console.warn('[mars-archive] getWall 照片查询失败:', (e && e.message) || e);
            return [];
          }
        });
      const attendanceP = api('/rest/v1/attendance?select=show_id,device_id,city,province,created_at&order=created_at.desc&limit=600', { timeout: 8000 })
        .then(r => Array.isArray(r) ? r : [])
        .catch(e => { console.warn('[mars-archive] getWall attendance 查询失败:', (e && e.message) || e); return []; });
      const [photos, attendance] = await Promise.all([photosP, attendanceP]);
      return {
        people: 0,
        perShow: [],
        photos: photos,
        attendance: attendance
      };
    },

    /* 拉取「标记去过」足迹（attendance 表），供时间轴「火星人共同足迹」使用；失败返回空数组 */
    async getAttendance() {
      try {
        const raw = await api('/rest/v1/attendance?select=show_id,device_id,city,province,created_at&order=created_at.desc&limit=600');
        return Array.isArray(raw) ? raw : [];
      } catch (e) {
        console.warn('[mars-archive] getAttendance 查询失败:', (e && e.message) || e);
        return [];
      }
    }
  };
})();
