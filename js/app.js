/* ============================================================
   火星档案馆 · 主控
   ============================================================ */
const App = (() => {

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = d => d.slice(5).replace('-', '.');           // 2024-05-04 → 05.04
  const full = d => d.replace(/-/g, '.');                  // 2024.05.04

  let curShow = null;
  let yearScrollHandler = null;

  /* ---------- 通用 ---------- */
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('on'), 2400);
  }

  function countUp(el, target, suffix) {
    const dur = 1400, t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.innerHTML = Math.round(target * e) + (suffix ? `<i>${suffix}</i>` : '');
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- 视图切换 ---------- */
  function go(view) {
    $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + view));
    $$('.nav-item').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    if (view === 'map') MarsMap.ensure();
    if (view === 'mine') renderMine();
    if (view === 'wall') renderWall();
    const yn = $('#yearnav');
    if (yn) {
      if (view === 'timeline') { if (yearScrollHandler) yearScrollHandler(); }
      else yn.classList.remove('show');
    }
    return false;
  }

  /* ---------- 时间轴 ---------- */
  function renderChapters() {
    const byYear = {};
    SHOWS.forEach(s => (byYear[s.year] = byYear[s.year] || []).push(s));

    const html = TOURS.map(tour => {
      const list = byYear[tour.year] || [];
      if (!list.length) return '';
      const cities = [...new Set(list.map(s => s.city))];

      const rows = list.map(s => {
        const went = Store.isWent(s.id);
        const shared = Store.isSharedWent(s.id);
        return `
        <div class="show-row ${went ? 'went' : ''}" data-id="${esc(s.id)}">
          <div class="sr-date">${md(s.date)}</div>
          <div class="sr-main">
            <div class="sr-city">${esc(s.city)}
              ${s.milestone ? '<span class="chip star">里程碑</span>' : ''}
            </div>
            <div class="sr-venue">${esc(s.venue)}</div>
            ${s.debuts ? `<div class="sr-debut">♪ 新歌首唱 · ${s.debuts.map(esc).join(' / ')}</div>` : ''}
          </div>
          <div class="sr-right">
            <span class="chip ${/四面台|日出|2\.0/.test(s.format) ? 'hot' : ''}">${esc(s.format)}</span>
            <button class="share-btn ${shared ? 'on' : ''}" data-share="${esc(s.id)}" title="共享到回忆墙 / 珍藏">
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4">
                <circle cx="3.2" cy="7" r="1.7"/><circle cx="10.8" cy="3.2" r="1.7"/><circle cx="10.8" cy="10.8" r="1.7"/>
                <path d="M4.6 6.1l5-2.4M4.6 7.9l5 2.4" stroke-linecap="round"/>
              </svg>
            </button>
            <button class="mark-btn ${went ? 'on' : ''}" data-mark="${esc(s.id)}" title="标记我去过这场">
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M2 6.3l2.6 2.6L10 3.4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>`;
      }).join('');

      return `
      <section class="chapter" id="chap-${tour.year}" data-year="${tour.year}">
        <aside class="chap-side">
          <div class="chap-year">${tour.year}</div>
          <div class="chap-tag">${esc(tour.tag)}</div>
          <div class="chap-name">${esc(tour.name)}</div>
          <div class="chap-count">${list.length} 场 · ${cities.length} 城</div>
        </aside>
        <div class="chap-body">
          <p class="chap-concept">${esc(tour.concept)}</p>
          <div class="rows">${rows}</div>
        </div>
      </section>`;
    }).join('');

    $('#chapters').innerHTML = html;

    // 入场动画
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.transition = 'opacity .7s cubic-bezier(.16,1,.3,1), transform .8s cubic-bezier(.16,1,.3,1)';
        e.target.style.opacity = 1; e.target.style.transform = 'none';
        io.unobserve(e.target);
      }
    }), { threshold: .06, root: $('#view-timeline') });

    $$('#chapters .show-row').forEach((el, i) => {
      el.style.opacity = 0; el.style.transform = 'translateY(16px)';
      el.style.transitionDelay = (i % 8) * 40 + 'ms';
      io.observe(el);
    });
  }

  /* ---------- 左侧年份跳转导航 ---------- */
  function buildYearNav() {
    const nav = $('#yearnav');
    const view = $('#view-timeline');
    if (!nav || !view) return;
    const years = [...new Set(SHOWS.map(s => s.year))].sort((a, b) => a - b);
    nav.innerHTML = `<div class="yn-list">` + years.map(y =>
      `<button class="yn-item" data-year="${y}" title="${y} 年"><span class="yn-dot"></span><span class="yn-yr">${y}</span></button>`
    ).join('') + `</div>`;
    const list = nav.querySelector('.yn-list');
    const chapters = years.map(y => document.getElementById('chap-' + y)).filter(Boolean);
    const items = [...nav.querySelectorAll('.yn-item')];

    /* 高亮当前年份并居中：竖排(宽屏)用 translateY 滑窗；横排(窄屏)用横滑 scrollIntoView */
    const winSize = 5, mid = Math.floor(winSize / 2);
    const isHorizontal = () => getComputedStyle(list).flexDirection === 'row';
    const setActive = y => {
      nav.querySelectorAll('.yn-item').forEach(b => b.classList.toggle('active', b.dataset.year === String(y)));
      const idx = items.findIndex(b => b.dataset.year === String(y));
      if (idx < 0) return;
      if (isHorizontal()) {
        const el = items[idx];
        if (el) el.scrollIntoView({ block: 'nearest', inline: 'center' });
      } else {
        const h = items[0].offsetHeight || 30;
        let ty = (mid - idx) * h;
        const minTy = (mid - (items.length - 1)) * h;
        ty = Math.max(minTy, Math.min(0, ty));
        list.style.transform = `translateY(${ty}px)`;
      }
    };

    nav.querySelectorAll('.yn-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const chap = document.getElementById('chap-' + btn.dataset.year);
        if (!chap) return;
        const top = chap.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - 6;
        view.scrollTo({ top, behavior: 'smooth' });
      });
    });

    /* 在导航条上滚动 = 仅浏览年份（滑窗），右边保持不动；点击年份才跳转右侧 */
    let wheelLock = 0;
    nav.addEventListener('wheel', e => {
      e.preventDefault();
      const cur = items.findIndex(b => b.classList.contains('active'));
      if (cur < 0) return;
      const now = Date.now();
      if (now - wheelLock < 130) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      const ni = Math.max(0, Math.min(items.length - 1, cur + dir));
      if (ni === cur) return;
      wheelLock = now;
      setActive(items[ni].dataset.year);
    }, { passive: false });

    let raf = 0;
    yearScrollHandler = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const firstTop = chapters.length ? chapters[0].offsetTop : 0;
        if (isHorizontal()) {
          /* 窄屏/中屏：进入时间轴即常显底部胶囊条，滚动时仅更新高亮 */
          nav.classList.add('show');
        } else {
          /* 宽屏：仅在滚过首屏 hero、到达第一个年份章节后才显示导航 */
          if (chapters.length && view.scrollTop >= firstTop - 8) nav.classList.add('show');
          else nav.classList.remove('show');
        }
        const ref = view.scrollTop + view.clientHeight * 0.32;
        let active = years[0];
        chapters.forEach(c => { if (c.offsetTop <= ref) active = c.dataset.year; });
        setActive(active);
      });
    };
    view.addEventListener('scroll', yearScrollHandler, { passive: true });
    yearScrollHandler();
  }

  /* ---------- 详情浮层 ---------- */
  function openSheet(id) {
    const s = SHOWS.find(x => x.id === id);
    if (!s) return;
    curShow = s;
    /* 开发者可见：本地存储占用（普通用户不显示） */
    try { console.log('[mars-archive] 本地存储已用约 ' + Store.usageKB() + ' KB'); } catch (_) {}
    const tour = TOURS.find(t => t.year === s.year) || {};
    const stageLabel = s.stage
      || (s.format === '乐园 · 双场' ? '火星乐园 · 星环（环环）'
          : s.format === '日出场' ? '日出场 · 海边日出'
          : s.format === '四面台' ? '四面台'
          : (tour.stage || s.format));
    const idx = SHOWS.indexOf(s) + 1;
    const went = Store.isWent(s.id);
    const photos = Store.getPhotos(s.id);

    const setlistHtml = s.setlist && s.setlist.length
      ? `<ul class="setlist">${s.setlist.map((t, i) =>
          `<li data-i="${String(i + 1).padStart(2, '0')}">${esc(t)}</li>`).join('')}</ul>
         ${s.setlist.length < 12 ? '<p style="font-size:11px;color:var(--txt-4);margin-top:12px">以上为已确认曲目，完整歌单补录中。</p>' : ''}`
      : `<div class="empty">歌单待补录，官方曲目单整理中。</div>`;

    let videoHtml;
    const v = s.video;
    let vbvid = null, vurl = null, vaid = null, vcid = null;
    if (typeof v === 'string') {
      const m = v.match(/BV1[0-9A-Za-z]{9}/);
      if (m) vbvid = m[0]; else vurl = v;
    } else if (v && (v.bvid || v.aid || v.cid)) {
      vbvid = v.bvid || null; vaid = v.aid || null; vcid = v.cid || null;
    } else if (v && v.url) {
      vurl = v.url;
    }
    if (vbvid || vaid) {
      const qs = [];
      if (vaid) qs.push('aid=' + vaid);
      if (vbvid) qs.push('bvid=' + vbvid);
      if (vcid) qs.push('cid=' + vcid);
      qs.push('autoplay=0', 'danmaku=0', 'high_quality=1');
      const src = 'https://player.bilibili.com/player.html?' + qs.join('&');
      videoHtml = `<div class="video-box"><iframe src="${src}" allowfullscreen="true" scrolling="no" frameborder="no" border="0" framespacing="0"></iframe></div>`;
    } else if (vurl) {
      videoHtml = `<a class="src-link" href="${esc(vurl)}" target="_blank" rel="noopener">前往官方视频 ↗</a>`;
    } else {
      videoHtml = `<div class="video-ph"><div><div class="ic">◎</div>
        <p>官方影像待收录</p>
      </div></div>`;
    }

    const looks = Array.isArray(s.looks) ? s.looks : [];
    const looksHtml = looks.length
      ? `<div class="look-grid">${looks.map(l => {
          const src = (l && l.src) ? l.src : (typeof l === 'string' ? l : '');
          return `<figure class="look-card"><img src="${esc(src)}" alt="造型"></figure>`;
        }).join('')}</div>`
      : `<div class="empty">造型待补充，官图整理中。</div>`;

    $('#sheetInner').innerHTML = `
      <div class="sheet-top">
        <button class="sheet-back" onclick="App.closeSheet()" aria-label="返回上一级">← 返回</button>
        <button class="sheet-close" onclick="App.closeSheet()" aria-label="关闭">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M2 2l10 10M12 2L2 12" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="sh-kicker">Show No.${String(idx).padStart(2, '0')} / ${SHOWS.length}</div>
      <div class="sh-date">${full(s.date)}</div>
      <div class="sh-city">${esc(s.city)}</div>

      <div class="sh-chips">
        <span class="chip hot">${esc(s.format)}</span>
        <span class="chip">${esc(s.theme)}</span>
        ${s.debuts ? '<span class="chip debut">♪ 新歌首唱</span>' : ''}
        ${s.milestone ? '<span class="chip star">里程碑场次</span>' : ''}
        ${went ? '<span class="chip hot">我去过</span>' : ''}
      </div>

      ${s.note ? `<p class="sh-note">${esc(s.note)}</p>` : ''}

      <div class="sh-block">
        <div class="sh-h">场次档案 · Record</div>
        <dl class="kv">
          <dt>日期</dt><dd>${full(s.date)}</dd>
          <dt>城市</dt><dd>${esc(s.city)}</dd>
          <dt>行政区</dt><dd>${esc(s.province)}</dd>
          <dt>场馆</dt><dd>${esc(s.venue)}</dd>
          <dt>所属巡演</dt><dd>${s.year} ${esc(tour.name || '')}</dd>
          <dt>舞台形态</dt><dd>${esc(stageLabel)}</dd>
        </dl>
      </div>

      <div class="sh-block">
        <div class="sh-h">现场歌单 · Setlist</div>
        ${setlistHtml}
      </div>

      ${s.debuts ? `
      <div class="sh-block debut-block">
        <div class="sh-h">新歌首唱 · Debut Performance</div>
        <div class="debut-list">${s.debuts.map(t => `<span class="debut-tag">${esc(t)}</span>`).join('')}</div>
      </div>` : ''}

      <div class="sh-block">
        <div class="sh-h">官方影像 · Official Video</div>
        ${videoHtml}
        <div class="src-links">
          ${OFFICIAL_SOURCES.map(o => `<a class="src-link" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.name)} ↗</a>`).join('')}
        </div>
      </div>

      <div class="sh-block">
        <div class="sh-h">造型 · Looks</div>
        ${looksHtml}
      </div>

      <div class="sh-block">
        <div class="sh-h">我的记录 · My Memory</div>
        <div class="upload-zone" id="uz">
          <div class="big">＋</div>
          <p>上传你在这一场拍下的照片</p>
          <small>最多 6 张 · 仅保存在你自己的浏览器 · 上传即自动压缩 · 支持拖拽</small>
        </div>
        <div class="photo-grid" id="pg">
          ${photos.filter(p => p.src).map(p => `
            <div class="photo-cell">
              <img src="${p.src}" alt="现场照片">
              <button class="photo-share ${Store.isSharedPhoto(p.id) ? 'on' : ''}" data-share-photo="${p.id}" title="共享到回忆墙 / 珍藏">
                <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4">
                  <circle cx="3.2" cy="7" r="1.6"/><circle cx="10.8" cy="3.2" r="1.6"/><circle cx="10.8" cy="10.8" r="1.6"/>
                  <path d="M4.6 6.1l5-2.4M4.6 7.9l5 2.4" stroke-linecap="round"/>
                </svg>
              </button>
              <button class="photo-del" data-del="${p.id}" title="删除">×</button>
            </div>`).join('')}
        </div>

        <div class="story-box">
          <div class="sh-sub">写一段火星小故事（可选 · 会随这场一起共享到回忆墙）</div>
          <textarea id="showStory" class="story-input" rows="2" placeholder="这场最难忘的瞬间、散场后的心情、对面那片被能量棒点亮的火海…">${esc(Store.getShowStory(s.id))}</textarea>
          <button class="story-save" id="saveStory">保存故事</button>
        </div>
        <button class="share-toggle ${Store.isSharedWent(s.id) ? 'on' : ''}" id="shareToggle">
          ${Store.isSharedWent(s.id) ? '☉　已共享到回忆墙' : '共享这场到回忆墙'}
        </button>
        <button class="went-toggle ${went ? 'on' : ''}" id="wt">
          ${went ? '✓　这一场我在现场' : '标记：我去过这一场'}
        </button>
      </div>
      <div style="height:20px"></div>
    `;

    bindSheet(s);
    $('#sheet').classList.add('on');
    // 仅在栈顶还不是 sheet 时才压入历史，避免「标记去过 / 重新上传」触发的重渲染重复压栈
    if (!history.state || history.state.mars !== 'sheet') history.pushState({ mars: 'sheet' }, '');
  }

  function bindSheet(s) {
    const uz = $('#uz'), fi = $('#fileInput');

    uz.onclick = () => { fi.value = ''; fi.onchange = () => handleFiles(s.id, fi.files); fi.click(); };
    uz.ondragover = e => { e.preventDefault(); uz.classList.add('drag'); };
    uz.ondragleave = () => uz.classList.remove('drag');
    uz.ondrop = e => { e.preventDefault(); uz.classList.remove('drag'); handleFiles(s.id, e.dataTransfer.files); };

    $('#pg').onclick = e => {
      const del = e.target.closest('[data-del]');
      if (del) {
        Store.delPhoto(s.id, del.dataset.del);
        openSheet(s.id);
        toast('已删除');
        return;
      }
      const sh = e.target.closest('[data-share-photo]');
      if (sh) {
        const pid = sh.dataset.sharePhoto;
        const photo = Store.getPhotos(s.id).find(p => p.id === pid);
        if (photo) toggleSharePhoto(s.id, pid, photo.src);
        return;
      }
      // 点照片本身 → 放大查看（更深一级，返回回到本场档案）
      const cell = e.target.closest('.photo-cell');
      if (cell) {
        const img = cell.querySelector('img');
        if (img) { openLightbox(img.src); return; }
      }
    };

    const st = $('#shareToggle');
    if (st) st.onclick = () => toggleShare(s.id);

    $('#wt').onclick = () => { setWent(s.id); openSheet(s.id); };

    const sv = $('#saveStory');
    if (sv) sv.onclick = async () => {
      const txt = $('#showStory').value.trim();
      const obj = Store.setShowStory(s.id, txt);
      toast('已保存');
      if (txt && Backend.isConfigured() && window.__storyReady) {
        try {
          const rid = await Backend.sharePhoto(s.id, null, txt);
          if (rid) Store.setSharedPhoto(obj.id, rid);
        } catch (_) {}
      }
      openSheet(s.id);
    };
  }

  async function handleFiles(showId, files) {
    if (!files || !files.length) return;
    toast('处理中…');
    const { ok, fail } = await Store.addPhotos(showId, files);
    openSheet(showId);
    if (ok && !fail) toast(`已添加 ${ok} 张照片`);
    else if (ok && fail) toast(`添加 ${ok} 张，${fail} 张失败（超出上限或空间不足）`);
    else toast('添加失败：可能超出 6 张上限或本地空间已满');
    // 若该场已共享到回忆墙，新增照片自动同步上去
    if (ok && Backend.isConfigured() && Store.isSharedWent(showId)) {
      let up = 0, lastErr = '';
      for (const p of Store.getPhotos(showId)) {
        if (Store.isSharedPhoto(p.id)) continue;
        try { const rid = await Backend.sharePhoto(showId, p.src); Store.setSharedPhoto(p.id, rid || true); up++; }
        catch (e) { lastErr = (e && e.message) ? e.message : String(e); }
      }
      refreshPhotoShareBtns(showId);
      if (up) toast(`已添加 ${ok} 张照片，其中 ${up} 张已同步到回忆墙 ☉`);
      else if (lastErr) toast(`照片同步失败：${lastErr.slice(0, 36)}`);
    }
  }

  /* ---------- 照片放大浮层（lightbox，比 sheet 更深一级） ---------- */
  function openLightbox(src) {
    $('#lbImg').src = src;
    $('#lightbox').classList.add('on');
    history.pushState({ mars: 'lightbox' }, '');
  }
  function closeLightbox() {
    if (!popGuard && history.state && history.state.mars === 'lightbox') { history.back(); }
    else { $('#lightbox').classList.remove('on'); }
  }

  /* ---------- 层级返回：靠浏览器历史栈实现「返回上一级」 ---------- */
  let popGuard = false;
  function closeSheet() {
    if (!popGuard && history.state && history.state.mars === 'sheet') { history.back(); }
    else { $('#sheet').classList.remove('on'); curShow = null; }
  }
  function onPop(e) {
    const m = (e.state && e.state.mars) || 'base';
    popGuard = true;
    if (m === 'lightbox') { $('#lightbox').classList.remove('on'); }
    else if (m === 'sheet') { $('#sheet').classList.remove('on'); curShow = null; }
    else { $('#lightbox').classList.remove('on'); $('#sheet').classList.remove('on'); curShow = null; }
    popGuard = false;
  }

  /* ---------- 标记 ---------- */
  function setWent(id) {
    const on = Store.toggleWent(id);
    // 同步时间轴 UI
    const row = document.querySelector(`.show-row[data-id="${CSS.escape(id)}"]`);
    if (row) {
      row.classList.toggle('went', on);
      row.querySelector('.mark-btn').classList.toggle('on', on);
    }
    updateCounter();
    toast(on ? '已标记：我在现场 ✓' : '已取消标记');
    return on;
  }

  function updateCounter() {
    const n = Store.wentCount();
    $('#hudWent').textContent = n;
    const C = 2 * Math.PI * 6;
    $('#ring').style.strokeDashoffset = C * (1 - n / SHOWS.length);
  }

  /* ---------- 共享（回忆墙） ---------- */
  /* 把本场所有未上传的照片推上墙（不碰 attendance 标记） */
  async function syncPhotos(id) {
    const photos = Store.getPhotos(id);
    let up = 0, fail = 0, lastErr = '';
    for (const p of photos) {
      if (Store.isSharedPhoto(p.id)) continue;
      try {
        const rid = await Backend.sharePhoto(id, p.src);
        Store.setSharedPhoto(p.id, rid || true); up++;
      } catch (e) { fail++; lastErr = (e && e.message) ? e.message : String(e); }
    }
    refreshPhotoShareBtns(id);
    return { up, fail, lastErr };
  }

  async function toggleShare(id) {
    if (!Backend.isConfigured()) { toast('共享未开启：在 js/config.js 填入 Supabase 密钥'); return; }
    const show = SHOWS.find(x => x.id === id);
    const isShared = Store.isSharedWent(id);
    const hasUnshared = Store.getPhotos(id).some(p => !Store.isSharedPhoto(p.id));

    // 自愈：曾标记「已共享」但实际有照片没传上去（如旧版本 Storage 上传失败）→ 直接补传，不撤下
    if (isShared && hasUnshared) {
      toast('正在补传未上传的照片…');
      try {
        const r = await syncPhotos(id);
        toast(r.fail ? `补传完成：${r.up} 张成功，${r.fail} 张失败（${r.lastErr.slice(0, 30)}）` : `已补传 ${r.up} 张到回忆墙 ☉`);
      } catch (e) { toast('补传失败：' + (e.message || e)); }
      return;
    }

    const on = !isShared;
    if (on) {
      if (!Store.isWent(id)) setWent(id);
      toast('同步到回忆墙…');
      try {
        await Backend.shareAttendance(show);
        const r = await syncPhotos(id);
        if (r.fail) {
          // 照片没全部传上去：不标记为整场已共享，方便重试
          toast(`${r.up} 张已上传，${r.fail} 张失败（${r.lastErr.slice(0, 30)}），可重试`);
          if (curShow && curShow.id === id) {
            const t = $('#shareToggle');
            if (t) { t.classList.remove('on'); t.textContent = '共享这场到回忆墙'; }
          }
          syncShareBtn(id, false);
          return;
        }
        Store.setSharedWent(id, true);
        // 同步本场文字故事（若有且尚未同步）
        const so = Store.getShowStoryObj(id);
        if (so && so.story && Backend.isConfigured() && window.__storyReady && !Store.isSharedPhoto(so.id)) {
          try { const rid = await Backend.sharePhoto(id, null, so.story); if (rid) Store.setSharedPhoto(so.id, rid); } catch (_) {}
        }
        if (curShow && curShow.id === id) {
          const t = $('#shareToggle');
          if (t) { t.classList.add('on'); t.textContent = '☉　已共享到回忆墙'; }
        }
        syncShareBtn(id, true);
        toast('已共享到回忆墙 ☉');
      } catch (e) { toast('共享失败：' + (e.message || e)); }
    } else {
      toast('从回忆墙撤下…');
      try {
        await Backend.unshareAttendance(id);
        Store.setSharedWent(id, false);
        Store.getPhotos(id).forEach(p => Store.setSharedPhoto(p.id, false));
        if (curShow && curShow.id === id) {
          const t = $('#shareToggle');
          if (t) { t.classList.remove('on'); t.textContent = '共享这场到回忆墙'; }
        }
        syncShareBtn(id, false);
        refreshPhotoShareBtns(id);
        toast('已从回忆墙撤下');
      } catch (e) { toast('撤下失败：' + (e.message || e)); }
    }
  }

  /* 刷新抽屉里每张照片的共享按钮状态 */
  function refreshPhotoShareBtns(id) {
    const pg = document.querySelector('#pg');
    if (!pg) return;
    pg.querySelectorAll('[data-share-photo]').forEach(b => {
      b.classList.toggle('on', !!Store.isSharedPhoto(b.dataset.sharePhoto));
    });
  }

  function syncShareBtn(id, on) {
    const b = document.querySelector(`.share-btn[data-share="${CSS.escape(id)}"]`);
    if (b) b.classList.toggle('on', on);
  }

  async function toggleSharePhoto(showId, photoId, dataUrl) {
    if (!Backend.isConfigured()) { toast('共享未开启：在 js/config.js 填入 Supabase 密钥'); return; }
    const on = !Store.isSharedPhoto(photoId);
    toast(on ? '上传到回忆墙…' : '从回忆墙撤下…');
    try {
      if (on) {
        const remoteId = await Backend.sharePhoto(showId, dataUrl);
        Store.setSharedPhoto(photoId, remoteId || true);
      } else {
        const remoteId = Store.isSharedPhoto(photoId);
        if (remoteId && remoteId !== true) await Backend.unsharePhoto(remoteId);
        Store.setSharedPhoto(photoId, false);
      }
      const btn = document.querySelector(`[data-share-photo="${CSS.escape(photoId)}"]`);
      if (btn) btn.classList.toggle('on', on);
      toast(on ? '照片已共享到回忆墙 ☉' : '照片已从回忆墙撤下');
    } catch (e) { toast('操作失败：' + (e.message || e)); }
  }

  async function renderWall() {
    const box = $('#wallBody');
    if (!Backend.isConfigured()) {
      box.innerHTML = `<div class="mine-empty"><div class="ic">☉</div>
        <h3>回忆墙尚未开启</h3>
        <p>这是所有火星人共享的「我去过 / 现场照」汇总。开启方法见 README：在 <code>js/config.js</code> 填入免费 Supabase 的两个值即可，开启后这里会自动出现大家的回忆。</p></div>`;
      return;
    }
    box.innerHTML = `<div class="mine-empty"><div class="spin"></div><p>正在载入所有人的回忆…</p></div>`;
    let data;
    try { data = await Backend.getWall(); }
    catch (e) {
      box.innerHTML = `<div class="mine-empty"><div class="ic">!</div><h3>载入失败</h3><p>${esc(e.message || e)}</p>
        <p style="font-size:11px;color:var(--txt-4)">请检查 config.js 中的 Supabase 密钥是否正确、SQL 是否已执行。</p></div>`;
      return;
    }
    const me = Store.deviceId();
    const showMap = Object.fromEntries(SHOWS.map(s => [s.id, s]));
    const perShow = data.perShow.slice().sort((a, b) => b.cnt - a.cnt);

    const rankHtml = perShow.length ? perShow.map(p => {
      const s = showMap[p.show_id];
      return `<div class="wrow"><span class="wcity">${s ? esc(s.city) : esc(p.show_id)}</span>
        <span class="wdate">${s ? full(s.date) : ''}</span>
        <span class="wcnt">${p.cnt}<i>人</i></span></div>`;
    }).join('') : `<p class="empty">还没有人共享，去时间轴点亮第一场吧。</p>`;

    const photosHtml = data.photos.length ? data.photos.map(p => {
      const s = showMap[p.show_id];
      return `<div class="gal-cell" data-url="${esc(p.url)}"><img src="${esc(p.url)}" alt="火星人共享照片" loading="lazy">
        <div class="gal-cap">${s ? full(s.date) + ' · ' + esc(s.city) : ''}</div></div>`;
    }).join('') : `<p class="empty">还没有共享照片。在档案抽屉里点照片右上角的共享按钮即可。</p>`;

    // 合并：远端共享流（含所有人 + 自己） + 本地尚未共享的内容（仅自己可见）
    const remote = (data.photos || []).map(p => ({
      id: p.id, showId: p.show_id, src: p.url, story: p.story || '',
      ts: p.created_at ? Date.parse(p.created_at) : 0, local: false, mine: p.device_id === me
    }));
    const local = Store.allPhotos().filter(p => !Store.isSharedPhoto(p.id)).map(p => ({
      id: p.id, showId: p.showId, src: p.src, story: p.story || '', ts: p.ts || 0, local: true, mine: true
    }));
    const wall = remote.concat(local).sort((a, b) => (b.ts || 0) - (a.ts || 0));

    const cardsHtml = wall.length ? wall.map(it => {
      const s = showMap[it.showId];
      const cap = (s ? full(s.date) + ' · ' + esc(s.city) : '火星手记') + (it.local ? ' · 仅自己可见' : (it.mine ? ' · 我' : ''));
      if (!it.src) {
        return `<div class="gal-cell story-card${it.local ? ' local' : ''}">
          <div class="gc-quote">“</div>
          <div class="gc-story">${esc(it.story || '')}</div>
          <div class="gal-cap">${cap}</div>
        </div>`;
      }
      return `<div class="gal-cell" data-url="${esc(it.src)}">
        <img src="${esc(it.src)}" alt="火星人共享照片" loading="lazy">
        ${it.story ? `<div class="gc-story">${esc(it.story)}</div>` : ''}
        <div class="gal-cap">${cap}</div>
      </div>`;
    }).join('') : `<p class="empty">还没有共享内容。在点开任意场次后，上传照片、写一段小故事，再点「共享这场到回忆墙」即可上墙。</p>`;

    box.innerHTML = `
      <div class="wall-actions"><button class="wall-write" id="wallWrite">✎　写一段火星故事</button></div>
      <div class="mine-stats">
        <div class="mcard"><div class="n">${data.people}<small>位</small></div><div class="l">火星人点亮回忆</div>
          <div class="s">覆盖 ${new Set(data.perShow.map(p => p.show_id)).size} 场</div></div>
        <div class="mcard"><div class="n">${data.photos.length}<small>张</small></div><div class="l">共享照片</div>
          <div class="s">来自全国各地的现场</div></div>
      </div>
      ${window.__storyReady ? '' : `<div class="wall-note">文字故事功能已就绪：想让所有人都能看到你写的小故事，只需在 Supabase 控制台跑一句 <code>ALTER TABLE photos ADD COLUMN story text;</code>（详见说明）。未开启前，你写的故事会显示在本机「仅自己可见」。</div>`}
      <div class="sh-h" style="margin:34px 0 16px">各场到场火星人 · 排行</div>
      <div class="wall-rank">${rankHtml}</div>
      <div class="sh-h" style="margin:40px 0 16px">共享回忆 · 照片与故事 · ${wall.length}</div>
      <div class="gallery">${cardsHtml}</div>`;

    const wb = $('#wallWrite');
    if (wb) wb.onclick = openWallStoryModal;
  }

  /* ---------- 我的火星 ---------- */
  function renderMine() {
    const ids = Store.wentList();
    const mine = SHOWS.filter(s => ids.includes(s.id)).sort((a, b) => a.date.localeCompare(b.date));
    const box = $('#mineBody');

    const tools = `
      <div class="tools">
        <button class="tool" onclick="App.exportData()">导出我的档案</button>
        <button class="tool" onclick="App.importData()">导入备份</button>
        <button class="tool" onclick="App.go('timeline')">去标记更多场次</button>
      </div>`;

    if (!mine.length) {
      box.innerHTML = tools + `
        <div class="mine-empty">
          <div class="ic">◎</div>
          <h3>还没有标记任何场次</h3>
          <p>回到时间轴，点亮你去过的每一场。你的记录会生成专属的观演统计与照片墙。</p>
        </div>`;
      return;
    }

    const cities = [...new Set(mine.map(s => s.city))];
    const provs = [...new Set(mine.map(s => s.province))];
    const first = mine[0], last = mine[mine.length - 1];
    const photos = Store.allPhotos();

    box.innerHTML = tools + `
      <div class="mine-stats">
        <div class="mcard"><div class="n">${mine.length}<small>场</small></div><div class="l">Shows Attended</div>
          <div class="s">占全部 ${(mine.length / SHOWS.length * 100).toFixed(1)}%</div></div>
        <div class="mcard"><div class="n">${cities.length}<small>城</small></div><div class="l">Cities</div>
          <div class="s">${esc(cities.slice(0, 4).join(' · '))}${cities.length > 4 ? ' …' : ''}</div></div>
        <div class="mcard"><div class="n">${provs.length}<small>省</small></div><div class="l">Provinces</div>
          <div class="s">足迹覆盖 ${(provs.length / PROVINCE_STATS.length * 100).toFixed(0)}% 已巡演地区</div></div>
        <div class="mcard"><div class="n">${photos.length}<small>张</small></div><div class="l">Photos</div></div>
      </div>

      <div class="mine-stats" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">
        <div class="mcard"><div class="l">第一次见到他</div>
          <div class="n" style="font-size:26px;margin-top:10px">${full(first.date)}</div>
          <div class="s">${esc(first.city)} · ${esc(first.venue)}</div></div>
        <div class="mcard"><div class="l">最近一次</div>
          <div class="n" style="font-size:26px;margin-top:10px">${full(last.date)}</div>
          <div class="s">${esc(last.city)} · ${esc(last.venue)}</div></div>
      </div>

      <div class="sh-h" style="margin:34px 0 16px">我去过的场次 · ${mine.length}</div>
      <div>${mine.map(s => `
        <div class="show-row went" data-id="${esc(s.id)}">
          <div class="sr-date">${s.year}.${md(s.date)}</div>
          <div class="sr-main">
            <div class="sr-city">${esc(s.city)}</div>
            <div class="sr-venue">${esc(s.venue)}</div>
          </div>
          <div class="sr-right"><span class="chip hot">${esc(s.format)}</span>
            <span class="chip">${Store.getPhotos(s.id).length} 张照片</span></div>
        </div>`).join('')}</div>

      ${photos.length ? `
        <div class="sh-h" style="margin:40px 0 16px">我的记忆 · ${photos.length}</div>
        <div class="gallery">
          ${photos.map(p => {
            const s = SHOWS.find(x => x.id === p.showId);
            const cap = s ? full(s.date) + ' · ' + esc(s.city) : '火星手记';
            if (!p.src) {
              return `<div class="gal-cell story-card">
                <div class="gc-quote">“</div>
                <div class="gc-story">${esc(p.story || '')}</div>
                <div class="gal-cap">${cap}</div>
              </div>`;
            }
            return `<div class="gal-cell" data-id="${esc(p.showId)}">
              <img src="${p.src}" alt="现场照片" loading="lazy">
              <div class="gal-cap">${cap}</div>
            </div>`;
          }).join('')}
        </div>` : ''}
    `;
  }

  /* ---------- 火星小故事弹窗（回忆墙「写一段火星故事」） ---------- */
  function openWallStoryModal() {
    const sel = $('#storyShow');
    if (sel && sel.dataset.filled !== '1') {
      // 场次按日期倒序，便于就近选择；首位为「自由手记」
      sel.innerHTML =
        '<option value="__free__">不关联 · 自由火星手记</option>' +
        SHOWS.slice().sort((a, b) => b.date.localeCompare(a.date)).map(s =>
          `<option value="${esc(s.id)}">${full(s.date)} · ${esc(s.city)} · ${esc(s.venue)}</option>`).join('');
      sel.dataset.filled = '1';
    }
    // 预填：若已写过自由手记则载入，方便续写
    const ta = $('#storyText');
    if (ta) ta.value = Store.getShowStory('__free__') || '';
    const hint = $('#storyModalHint');
    if (hint) hint.textContent = '';
    $('#storyModal').classList.add('on');
  }

  function closeStoryModal() {
    $('#storyModal').classList.remove('on');
  }

  async function saveWallStory() {
    const sel = $('#storyShow');
    const showId = sel ? sel.value : '__free__';
    const ta = $('#storyText');
    const txt = (ta ? ta.value : '').trim();
    const hint = $('#storyModalHint');
    if (!txt) { if (hint) hint.textContent = '写点什么再保存吧 ☉'; return; }
    const obj = Store.setShowStory(showId, txt);
    toast('已保存到本机');
    if (Backend.isConfigured() && window.__storyReady) {
      try {
        const rid = await Backend.sharePhoto(showId, null, txt);
        if (rid) Store.setSharedPhoto(obj.id, rid);
        if (hint) hint.textContent = '已同步到回忆墙 ☉';
      } catch (e) {
        if (hint) hint.textContent = '已存本机，但同步失败：' + ((e && e.message) || e).slice(0, 40);
      }
    } else {
      if (hint) hint.textContent = window.__storyReady ? '共享未开启，仅存于本机' : '后端未启用文字列，仅存于本机（见说明开启）';
    }
    await renderWall();
    setTimeout(closeStoryModal, 900);
  }

  /* ---------- 备份 ---------- */
  function exportData() {
    const blob = new Blob([Store.exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `我的火星档案_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出备份文件');
  }

  function importData() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          Store.importAll(fr.result);
          renderChapters(); updateCounter(); renderMine();
          toast('导入成功');
        } catch (e) { toast('导入失败：' + e.message); }
      };
      fr.readAsText(f);
    };
    inp.click();
  }

  /* ---------- 初始化 ---------- */
  function init() {
    history.replaceState({ mars: 'base' }, '');
    window.addEventListener('popstate', onPop);

    const cities = new Set(SHOWS.map(s => s.city));
    const years = new Set(SHOWS.map(s => s.year));

    $('#hudTotal').textContent = SHOWS.length;
    $('#hudProv').textContent = PROVINCE_STATS.length;
    countUp($('#s1'), SHOWS.length, '场');
    countUp($('#s2'), cities.size, '城');
    countUp($('#s3'), PROVINCE_STATS.length, '省');
    countUp($('#s4'), years.size, '年');

    renderChapters();
    buildYearNav();
    const yn = $('#yearnav'); if (yn) yn.classList.add('show');
    updateCounter();

    // 事件委托
    document.addEventListener('click', e => {
      const share = e.target.closest('[data-share]');
      if (share) { e.stopPropagation(); toggleShare(share.dataset.share); return; }
      const mark = e.target.closest('[data-mark]');
      if (mark) { e.stopPropagation(); setWent(mark.dataset.mark); return; }
      const row = e.target.closest('.show-row');
      if (row) { openSheet(row.dataset.id); return; }
      const gal = e.target.closest('.gal-cell');
      if (gal) {
        if (gal.dataset.url) { openLightbox(gal.dataset.url); return; }
        if (gal.dataset.id) { openSheet(gal.dataset.id); return; }
      }
    });

    $$('.nav-item').forEach(b => b.onclick = () => go(b.dataset.view));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if ($('#storyModal').classList.contains('on')) closeStoryModal();
        else if ($('#lightbox').classList.contains('on')) closeLightbox();
        else if ($('#sheet').classList.contains('on')) closeSheet();
      }
    });

    // HUD 时钟
    const tick = () => {
      const d = new Date();
      $('#hudClock').textContent = d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
        + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    };
    tick(); setInterval(tick, 30000);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { go, openSheet, closeSheet, openLightbox, closeLightbox, setWent, exportData, importData, toast, renderMine, renderWall, toggleShare, toggleSharePhoto, openStoryModal: openWallStoryModal, closeStoryModal, saveWallStory };
})();
