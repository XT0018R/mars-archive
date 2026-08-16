/* ============================================================
   本地存储层 —— 观演记录与照片
   所有数据默认仅保存在用户本机 localStorage（私藏，不上服务器）。
   开启共享后，被标记为「共享」的场次/照片会同步到公共回忆墙。
   ============================================================ */
const Store = (() => {
  const K_WENT = 'mars.went.v1';
  const K_PHOTO = 'mars.photos.v1';
  const K_SHARED_WENT = 'mars.sharedWent.v1';
  const K_SHARED_PHOTO = 'mars.sharedPhoto.v1';
  const K_DEVICE = 'mars.device.v1';

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  };

  let went = new Set(read(K_WENT, []));
  let photos = read(K_PHOTO, {});   // { showId: [{id, src, ts}] }
  let sharedWent = new Set(read(K_SHARED_WENT, []));
  let sharedPhoto = read(K_SHARED_PHOTO, {}); // { photoId: true }

  /* 设备唯一 ID：每个浏览器生成一次，用于标识「这位火星人」 */
  let deviceId = read(K_DEVICE, null);
  if (!deviceId) {
    deviceId = 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    write(K_DEVICE, deviceId);
  }

  const saveWent = () => write(K_WENT, [...went]);
  const savePhotos = () => write(K_PHOTO, photos);
  const saveSharedWent = () => write(K_SHARED_WENT, [...sharedWent]);
  const saveSharedPhoto = () => write(K_SHARED_PHOTO, sharedPhoto);

  /* 图片压缩：最长边 1000px，JPEG 0.68 —— 明显减小体积，避免 localStorage / 共享库撑爆
     对移动端连续处理多图做了加固：toDataURL 失败时自动用更低质量/尺寸重试，避免整张丢失 */
  function compress(file, maxSide = 1000, quality = 0.68) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('读取失败'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('解析失败'));
        img.onload = () => {
          let { width: w, height: h } = img;
          const scale = Math.min(1, maxSide / Math.max(w, h));
          w = Math.round(w * scale); h = Math.round(h * scale);
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          try {
            resolve(cv.toDataURL('image/jpeg', quality));
          } catch (e) {
            // 部分移动端对大 canvas 编码会抛错，降级重试
            try { resolve(cv.toDataURL('image/jpeg', Math.max(0.5, quality - 0.15))); }
            catch (_) { reject(new Error('编码失败')); }
          }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* 单张压缩，带一次降级重试（尺寸/质量更激进），最大化「能存下」的概率 */
  async function compressSafe(file) {
    for (const opt of [[1000, 0.68], [900, 0.6], [760, 0.55]]) {
      try { return await compress(file, opt[0], opt[1]); } catch (_) {}
    }
    return null;
  }

  return {
    /* —— 观演标记 —— */
    isWent: id => went.has(id),
    toggleWent(id) {
      went.has(id) ? went.delete(id) : went.add(id);
      saveWent();
      return went.has(id);
    },
    wentList: () => [...went],
    wentCount: () => went.size,

    /* —— 共享状态（本地标记，用于记住哪些已共享） —— */
    deviceId: () => deviceId,
    isSharedWent: id => sharedWent.has(id),
    setSharedWent(id, on) {
      on ? sharedWent.add(id) : sharedWent.delete(id);
      saveSharedWent();
    },
    sharedWentList: () => [...sharedWent],
    isSharedPhoto: pid => !!sharedPhoto[pid],
    setSharedPhoto(pid, on) {
      on ? (sharedPhoto[pid] = true) : delete sharedPhoto[pid];
      saveSharedPhoto();
    },

    /* —— 照片 —— */
    getPhotos: id => photos[id] || [],
    async addPhotos(id, files) {
      if (!photos[id]) photos[id] = [];
      let ok = 0, fail = 0;
      for (const f of files) {
        if (!f.type.startsWith('image/')) { fail++; continue; }
        if (photos[id].length >= 6) { fail++; continue; }
        // 多图连续压缩时让出主线程，避免移动端 canvas/内存 压力导致后续整张失败
        await new Promise(r => setTimeout(r, 20));
        const src = await compressSafe(f);
        if (!src) { fail++; continue; }
        photos[id].push({ id: 'p' + Date.now() + Math.random().toString(36).slice(2, 7), src, ts: Date.now() });
        // 若 localStorage 空间已满（接近 5MB 上限），尝试先腾出其他场次的冗余再存；仍失败则该张记为失败而非静默吞掉
        if (!savePhotos()) {
          photos[id].pop();
          fail++;
        } else ok++;
      }
      return { ok, fail };
    },
    delPhoto(showId, photoId) {
      if (!photos[showId]) return;
      photos[showId] = photos[showId].filter(p => p.id !== photoId);
      if (!photos[showId].length) delete photos[showId];
      savePhotos();
    },
    allPhotos() {
      const out = [];
      Object.keys(photos).forEach(sid => photos[sid].forEach(p => out.push({ ...p, showId: sid })));
      return out.sort((a, b) => b.ts - a.ts);
    },
    photoCount: () => Object.values(photos).reduce((n, a) => n + a.length, 0),

    /* —— 火星小故事（纯文字，无图，可关联某场） —— */
    getShowStory(showId) {
      const arr = photos[showId || '__free__'] || [];
      const ex = arr.find(p => p.src === null);
      return ex ? ex.story : '';
    },
    getShowStoryObj(showId) {
      const arr = photos[showId || '__free__'] || [];
      return arr.find(p => p.src === null) || null;
    },
    setShowStory(showId, story) {
      const sid = showId || '__free__';
      if (!photos[sid]) photos[sid] = [];
      const ex = photos[sid].find(p => p.src === null);
      if (ex) ex.story = story;
      else photos[sid].push({ id: 'st' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), src: null, story, ts: Date.now() });
      savePhotos();
      return photos[sid].find(p => p.src === null) || null;
    },

    /* —— 备份 —— */
    exportAll() {
      return JSON.stringify({ v: 1, exportedAt: new Date().toISOString(), went: [...went], photos }, null, 0);
    },
    importAll(json) {
      const d = JSON.parse(json);
      if (!d || d.v !== 1) throw new Error('文件格式不正确');
      went = new Set(d.went || []);
      photos = d.photos || {};
      saveWent(); savePhotos();
    },
    usageKB() {
      try { return Math.round((localStorage.getItem(K_PHOTO) || '').length / 1024); } catch { return 0; }
    }
  };
})();
