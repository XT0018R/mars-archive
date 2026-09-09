/* ============================================================
   火星档案馆 · 主控
   ============================================================ */
const App = (() => {

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* 歌单渲染：识别「下午场／晚上场」分场标记，拆成带分割线的小节；
     强制 下午场 在上、晚上场 在下（无论数据里顺序如何），每节独立 01 起编号 */
  function setlistToHtml(list) {
    if (!list || !list.length) return `<div class="empty">歌单待补录，由歌迷整理后陆续补全。</div>`;
    const SEC_RE = /^(下午场|晚上场|午场|晚场)[：:]/;
    if (!list.some(t => SEC_RE.test(t))) {
      return `<ul class="setlist">${list.map((t, i) =>
        `<li data-i="${String(i + 1).padStart(2, '0')}">${esc(t)}</li>`).join('')}</ul>
        ${list.length < 12 ? '<p class="setlist-note">以上为已确认曲目，完整歌单补录中。</p>' : ''}`;
    }
    const sections = new Map();   // 场次名 -> [歌曲]
    const encounter = [];         // 场次名出现顺序
    let cur = null;
    for (const raw of list) {
      const m = raw.match(SEC_RE);
      if (m) {
        cur = m[1];
        if (!sections.has(cur)) { sections.set(cur, []); encounter.push(cur); }
        const song = raw.replace(SEC_RE, '').trim();
        if (song) sections.get(cur).push(song);
      } else if (cur) {
        sections.get(cur).push(raw);
      }
    }
    // 强制顺序：下午场 → 晚上场 → 其余场次（按出现顺序）
    const FORCE = ['下午场', '晚上场'];
    const names = [];
    for (const f of FORCE) if (sections.has(f)) names.push(f);
    for (const n of encounter) if (!FORCE.includes(n)) names.push(n);
    const block = name => {
      const songs = sections.get(name);
      return `<div class="setlist-block"><div class="setlist-divider"><span>${esc(name)}</span></div><ul class="setlist">` +
        songs.map((t, i) => `<li data-i="${String(i + 1).padStart(2, '0')}">${esc(t)}</li>`).join('') + '</ul></div>';
    };
    let html = '<div class="setlist-sections">' + names.map(block).join('') + '</div>';
    if (list.length < 12) html += '<p class="setlist-note">以上为已确认曲目，完整歌单补录中。</p>';
    return html;
  }

  const md = d => d.slice(5).replace('-', '.');           // 2024-05-04 → 05.04
  const full = d => d.replace(/-/g, '.');                  // 2024.05.04

  // 把 data.js 里的 video 字段规范化成数组（支持字符串 / 对象 / 数组）
  function normalizeVideo(v) {
    if (!v) return null;
    let vbvid = null, vurl = null, vaid = null, vcid = null, title = null;
    if (typeof v === 'string') {
      const m = v.match(/BV1[0-9A-Za-z]{9}/);
      if (m) vbvid = m[0]; else vurl = v;
    } else if (v.bvid || v.aid || v.cid) {
      vbvid = v.bvid || null; vaid = v.aid || null; vcid = v.cid || null; title = v.title || null;
    } else if (v.url) {
      const m = String(v.url).match(/BV1[0-9A-Za-z]{9}/);
      if (m) { vbvid = m[0]; title = v.title || null; }
      else { vurl = v.url; title = v.title || null; }
    }
    if (vbvid || vaid) return { type: 'bili', vbvid, vaid, vcid, title };
    if (vurl) return { type: 'link', vurl, title };
    return null;
  }
  function normalizeVideos(video) {
    if (!video) return [];
    const arr = Array.isArray(video) ? video : [video];
    return arr.map(normalizeVideo).filter(Boolean);
  }

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

    /* 竖排(宽屏)与横排(窄屏)统一：导航条作为可滚动容器，只有"实际居中"的年份才高亮(红+放大)；
       首/尾年份借助内边距可滚到正中，故 2014 在起点居中高亮、2026 在终点居中高亮。 */
    const isHorizontal = () => getComputedStyle(list).flexDirection === 'row';
    /* 把目标年份滚到导航条正中（两种方向通用） */
    const centerYear = y => {
      const idx = items.findIndex(b => b.dataset.year === String(y));
      if (idx < 0) return;
      const el = items[idx];
      if (isHorizontal()) nav.scrollLeft = el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2;
      else nav.scrollTop = el.offsetTop - (nav.clientHeight - el.offsetHeight) / 2;
    };
    /* 高亮导航条实际最居中的年份——只有居中才高亮，离开正中即刻取消 */
    const setCenterActive = () => {
      const horiz = isHorizontal();
      const center = horiz ? (nav.scrollLeft + nav.clientWidth / 2) : (nav.scrollTop + nav.clientHeight / 2);
      let best = 0, bestDist = Infinity;
      items.forEach((b, i) => {
        const c = horiz ? (b.offsetLeft + b.offsetWidth / 2) : (b.offsetTop + b.offsetHeight / 2);
        const d = Math.abs(c - center);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      items.forEach((b, i) => b.classList.toggle('active', i === best));
    };
    /* 用户手动滑动导航条时，按实际居中实时高亮 */
    nav.addEventListener('scroll', setCenterActive, { passive: true });
    setCenterActive();

    nav.querySelectorAll('.yn-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const chap = document.getElementById('chap-' + btn.dataset.year);
        if (!chap) return;
        const top = chap.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - 6;
        view.scrollTo({ top, behavior: 'smooth' });
      });
    });

    /* 在导航条上滚动 = 仅浏览年份（滑窗），右侧保持不动；点击年份才跳转右侧 */
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
      centerYear(items[ni].dataset.year);
      setCenterActive();
    }, { passive: false });

    let raf = 0, syncRaf = 0, lastSyncTop = -1;
    /* 把主时间轴滚动进度连续插值映射到导航条滚动位置（平滑跟手、零跳变、零原生 smooth 延迟）；
       竖排映射到 scrollTop，横排映射到 scrollLeft，高亮始终按实际居中计算。 */
    const applyNavSync = () => {
      if (!chapters.length) return;
      const ref = view.scrollTop + view.clientHeight * 0.32;
      let f = 0; const n = chapters.length;
      let i = 0; while (i < n && chapters[i].offsetTop <= ref) i++;
      if (i <= 0) f = 0;
      else if (i >= n) f = n - 1;
      else { const t = (ref - chapters[i-1].offsetTop) / (chapters[i].offsetTop - chapters[i-1].offsetTop); f = (i - 1) + t; }
      const m = items.length;
      if (m > 1) {
        const horiz = isHorizontal();
        const a = horiz ? 'offsetLeft' : 'offsetTop';
        const b = horiz ? 'offsetWidth' : 'offsetHeight';
        const span = horiz ? nav.clientWidth : nav.clientHeight;
        const first = items[0], last = items[m - 1];
        const gap = (last[a] - first[a]) / (m - 1);
        const target = first[a] + gap * f - (span - first[b]) / 2;
        if (horiz) nav.scrollLeft = target; else nav.scrollTop = target;
        setCenterActive();
      }
    };
    yearScrollHandler = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const firstTop = chapters.length ? chapters[0].offsetTop : 0;
        /* 首屏 hero 不显示年份导航；滚到第一个年份章节(2014)到达视口中线以上才淡入 */
        const trigger = firstTop - view.clientHeight * 0.5;
        if (chapters.length && view.scrollTop >= trigger) nav.classList.add('show');
        else nav.classList.remove('show');
        /* 连续跟随循环：覆盖移动端惯性滚动不触发 scroll 事件的情况，确保导航条始终跟手 */
        applyNavSync();
        if (!syncRaf) { lastSyncTop = -1; syncRaf = requestAnimationFrame(function follow(){
          applyNavSync();
          if (view.scrollTop !== lastSyncTop) { lastSyncTop = view.scrollTop; syncRaf = requestAnimationFrame(follow); }
          else syncRaf = 0;
        }); }
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

    const setlistHtml = setlistToHtml(s.setlist);

    let videoHtml;
    const vlist = normalizeVideos(s.video);
    if (vlist.length) {
      videoHtml = vlist.map(vid => {
        if (vid.type === 'bili') {
          const qs = [];
          if (vid.vaid) qs.push('aid=' + vid.vaid);
          if (vid.vbvid) qs.push('bvid=' + vid.vbvid);
          if (vid.vcid) qs.push('cid=' + vid.vcid);
          qs.push('autoplay=0', 'danmaku=0', 'high_quality=1');
          const src = 'https://player.bilibili.com/player.html?' + qs.join('&');
          const cap = vid.title ? `<div class="video-cap">${esc(vid.title)}</div>` : '';
          return `<div class="video-item">${cap}<div class="video-box"><iframe src="${src}" allowfullscreen="true" scrolling="no" frameborder="no" border="0" framespacing="0"></iframe></div></div>`;
        }
        return `<a class="src-link" href="${esc(vid.vurl)}" target="_blank" rel="noopener">前往官方视频 ↗</a>`;
      }).join('');
    } else {
      videoHtml = `<div class="video-ph"><div><div class="ic">◎</div>
        <p>官方影像待收录</p>
      </div></div>`;
    }

    const looks = Array.isArray(s.looks) ? s.looks : [];
    const looksHtml = looks.length
      ? `<div class="sh-block">
        <div class="sh-h">造型 · Looks</div>
        <div class="look-grid">${looks.map(l => {
          const src = (l && l.src) ? l.src : (typeof l === 'string' ? l : '');
          return `<figure class="look-card"><img src="${esc(src)}" alt="造型"></figure>`;
        }).join('')}</div>
      </div>`
      : '';

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
        <div class="sh-note">仅作为记录，非官方歌单</div>
        ${setlistHtml}
      </div>

      ${s.debuts ? `
      <div class="sh-block debut-block">
        <div class="sh-h">新歌首唱 · Debut Performance</div>
        <div class="debut-list">${s.debuts.map(t => `<span class="debut-tag">${esc(t)}</span>`).join('')}</div>
      </div>` : ''}

      ${vlist.length ? `
      <div class="sh-block">
        <div class="sh-h">官方影像 · Official Video</div>
        ${videoHtml}
        <div class="src-links">
          ${OFFICIAL_SOURCES.map(o => `<a class="src-link" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.name)} ↗</a>`).join('')}
        </div>
      </div>` : ''}

      ${looksHtml}

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

    /* 火星小故事：输入框实时自动保存（防抖），避免只填不点「保存故事」导致文字没进 Store、上不了墙 */
    const si = $('#showStory');
    if (si) {
      let _t;
      si.oninput = () => { clearTimeout(_t); _t = setTimeout(() => Store.setShowStory(s.id, si.value), 400); };
      si.onblur = () => Store.setShowStory(s.id, si.value);
    }

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
      // 若回忆墙正打开，立即重渲染，确保本场记忆即时同步上墙
      const wv = document.getElementById('view-wall');
      if (wv && wv.classList.contains('on')) renderWall();
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
  /* 关掉场次详情时，强制停掉里面仍在播放的 B 站视频（只清 src 在微信里常不生效，直接移除 iframe 节点最可靠） */
  function stopSheetVideos() {
    const sheet = $('#sheet');
    if (!sheet) return;
    sheet.querySelectorAll('iframe').forEach(f => {
      try { f.src = 'about:blank'; } catch (_) {}
      try { f.remove(); } catch (_) {}
    });
  }
  function closeSheet() {
    stopSheetVideos();
    if (!popGuard && history.state && history.state.mars === 'sheet') { history.back(); }
    else { $('#sheet').classList.remove('on'); curShow = null; }
  }
  function onPop(e) {
    const m = (e.state && e.state.mars) || 'base';
    popGuard = true;
    if (m === 'lightbox') { $('#lightbox').classList.remove('on'); }
    else if (m === 'sheet') { stopSheetVideos(); $('#sheet').classList.remove('on'); curShow = null; }
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
    if (window.MarsMap && MarsMap.refresh) MarsMap.refresh();
    try { window.dispatchEvent(new Event('mars:went-changed')); } catch (e) {}
    return on;
  }

  function updateCounter() {
    const n = Store.wentCount();
    $('#hudWent').textContent = n;
    const C = 2 * Math.PI * 6;
    $('#ring').style.strokeDashoffset = C * (1 - n / SHOWS.length);
  }

  /* ---------- 共享（回忆墙） ---------- */
  /* 把本场所有未上传的照片推上墙（不碰 attendance 标记）
     每张最多重试 2 次：海外 Supabase 经常偶发超时，单次失败不应直接丢弃整张 */
  async function shareOnePhoto(id, src) {
    let lastErr = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rid = await Backend.sharePhoto(id, src);
        if (rid) return { ok: true, rid };
        return { ok: true, rid: true };
      } catch (e) { lastErr = (e && e.message) ? e.message : String(e); }
    }
    return { ok: false, err: lastErr };
  }
  async function syncPhotos(id) {
    const photos = Store.getPhotos(id);
    let up = 0, fail = 0, lastErr = '';
    for (const p of photos) {
      if (Store.isSharedPhoto(p.id)) continue;
      const r = await shareOnePhoto(id, p.src);
      if (r.ok) { Store.setSharedPhoto(p.id, r.rid || true); up++; }
      else { fail++; lastErr = r.err; }
    }
    refreshPhotoShareBtns(id);
    return { up, fail, lastErr };
  }

  /* 自愈：开墙时自动把「本机已传、但没成功推上服务器」的照片/故事补齐上传。
     解决「我在本机传了 7 张，别人/换设备只看到 4 张」——那 3 张当初没传上服务器，
     这次在上传设备上打开回忆墙会静默补传，之后所有人都能看到。 */
  async function selfHealUploads() {
    if (!Backend.isConfigured()) return;
    let up = 0, fail = 0;
    /* 纳入补传的场次：
       1) 已标记「共享/去过」的场次（原有逻辑）
       2) 任何写有本地文字故事的场次——即使没点过该场「共享」，故事也应上墙，
          否则只存本机、selfHeal 又只遍历 sharedWentList，导致故事永远传不上服务器。 */
    const ids = new Set(Store.sharedWentList());
    for (const s of SHOWS) {
      const so = Store.getShowStoryObj(s.id);
      if (so && so.story) ids.add(s.id);
    }
    if (Store.getShowStoryObj('__free__')) ids.add('__free__');
    for (const id of ids) {
      try {
        const r = await syncPhotos(id);
        up += r.up; fail += r.fail;
      } catch (_) {}
      const so = Store.getShowStoryObj(id);
      if (so && so.story && !Store.isSharedPhoto(so.id)) {
        try {
          if (window.__storyReady === undefined) { try { await Backend.probeStory(); } catch (_) {} }
          if (window.__storyReady) {
            const rid = await Backend.sharePhoto(id, null, so.story);
            if (rid) { Store.setSharedPhoto(so.id, rid); up++; }
          } else { fail++; }
        } catch (_) { fail++; }
      }
    }
    if (up || fail) {
      toast(up
        ? `已自动补传 ${up} 条到回忆墙${fail ? `，${fail} 张网络超时，下次打开会再试` : ' ☉'}`
        : `自动补传有 ${fail} 张超时，下次打开回忆墙会再试`);
    }
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
        // 即便部分照片因网络超时没传上去，也标记为「已共享」：
        // 本机所有照片本来就会显示在回忆墙（不依赖服务器），按钮状态与用户意图一致；
        // 没传上去的那几张保持「未共享」标记，下次打开回忆墙会自动补传。
        Store.setSharedWent(id, true);
        if (r.fail) {
          toast(`已共享到回忆墙 ☉（${r.up} 张已传，${r.fail} 张网络超时，将在打开回忆墙时自动补传）`);
        } else {
          toast('已共享到回忆墙 ☉');
        }
        // 同步本场文字故事（若有且尚未同步）：优先取抽屉里 textarea 的实时内容，避免没点「保存故事」就丢失
        let so = Store.getShowStoryObj(id);
        const taEl = $('#showStory');
        const liveTxt = taEl ? taEl.value.trim() : '';
        if (liveTxt && (!so || !so.story)) so = Store.setShowStory(id, liveTxt);
        if (so && so.story) {
          // 确保已探测 story 列（从时间轴直接共享、尚未打开过回忆墙时 __storyReady 可能还是 undefined，会导致漏传或写出空卡片）
          if (window.__storyReady === undefined && Backend.isConfigured()) {
            try { await Backend.probeStory(); } catch (_) {}
          }
          // 仅当 story 列已就绪才上传，避免写出「url:null 且无字」的垃圾空卡片
          if (Backend.isConfigured() && window.__storyReady && !Store.isSharedPhoto(so.id)) {
            try { const rid = await Backend.sharePhoto(id, null, so.story); if (rid) Store.setSharedPhoto(so.id, rid); } catch (_) {}
          }
        }
        if (curShow && curShow.id === id) {
          const t = $('#shareToggle');
          if (t) { t.classList.add('on'); t.textContent = '☉　已共享到回忆墙'; }
        }
        syncShareBtn(id, true);
      } catch (e) { toast('已存本机 ☉ 云端暂不可达，网络恢复后打开回忆墙会自动补传'); }
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

  /* 足迹人数「缓存兜底」：把每次成功从后端拉到的 attendance 设备集合存到本机，
     下次即使后端抖动/超时，也用能见到过的最新真实人数做下限，绝不会退回到旧静态快照的 11。
     人数只会随共享人数增长（这是用户明确要求的「不要停在 11 位」）。
     注意：合并采用并集（monotonic），即头条人数只增不减——撤下分享也不会让数字回落，
     以避免后端偶发抖动造成数字乱跳；真实去重仍以每次成功同步的 live 为准。 */
  const ATT_CACHE_KEY = 'mars-wall-attendance-cache-v1';
  function _readAttCache() {
    try { const a = JSON.parse(localStorage.getItem(ATT_CACHE_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (_) { return []; }
  }
  function _writeAttCache(arr) {
    try { localStorage.setItem(ATT_CACHE_KEY, JSON.stringify(Array.isArray(arr) ? arr : [])); } catch (_) {}
  }
  function _mergeAttendance(...lists) {
    const byDev = new Map();
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const a of list) { if (a && a.device_id) byDev.set(a.device_id, a); }
    }
    return [...byDev.values()];
  }

  /* 当前回忆墙渲染上下文：供「同步云端」按钮复用，避免每次点击都重算 */
  let _wallBox = null, _wallLocal = null, _wallShowMap = null, _wallMe = null, _wallDeleted = null;

  /* 从云端拉取最新回忆墙并刷新：3 次重试 + 退避 + 25s 竞速超时（getWall 已并行化约 8s 完成，稳定赢下竞速），海外 Supabase 偶发抖动时更可能成功。
     成功则合并（静态 ∪ 本机缓存 ∪ live）并重绘、写回缓存；失败则提示仍显示本机/上次同步内容。 */
  async function syncWallFromBackend() {
    if (!Backend.isConfigured()) { toast('共享未开启：在 js/config.js 填入 Supabase 密钥'); return; }
    const box = _wallBox, localBase = _wallLocal, showMap = _wallShowMap, me = _wallMe, deletedSet = _wallDeleted;
    if (!box) return;
    const btn = $('#wallSync');
    if (btn) { btn.classList.add('busy'); btn.textContent = '同步中…'; }
    let data = null;
    const backoff = [0, 1200, 2400];
    for (let attempt = 0; attempt < 3 && !data; attempt++) {
      if (backoff[attempt]) await new Promise(r => setTimeout(r, backoff[attempt]));
      try {
        data = await Promise.race([
          Backend.getWall(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))
        ]);
      } catch (_) { data = null; }
    }
    if (btn) { btn.classList.remove('busy'); btn.textContent = '↻　同步云端'; }
    if (data && ((data.photos || []).length > 0 || (data.attendance || []).length > 0)) {
      data.photos = data.photos.filter(p => !deletedSet.has(p.id || ''));
      if (!data.attendance || !data.attendance.length) data.attendance = window.__WALL_STATIC_ATTENDANCE || [];
      data.attendance = _mergeAttendance(window.__WALL_STATIC_ATTENDANCE || [], _readAttCache(), data.attendance);
      if (data.attendance && data.attendance.length) _writeAttCache(data.attendance);
      paintWall(box, data, localBase, showMap, me, { status: '· 已从服务器同步最新' });
      bindWallActions();
    } else {
      toast('云端暂时连不上，已显示本机 / 上次同步的内容');
    }
  }

  async function renderWall() {
    try {
      const box = $('#wallBody');
      if (!box) return;
      const me = Store.deviceId();
      const showMap = Object.fromEntries(SHOWS.map(s => [s.id, s]));

      /* 本机照片/故事全集（同步取得） */
      const localBase = Store.allPhotos().map(p => ({
        id: p.id, showId: p.showId, src: p.src, story: p.story || '',
        ts: p.ts || 0, local: true, mine: true
      }));

      /* 已删除内容（管理员在前端删的，记录在本机，重新渲染时过滤） */
      const deletedSet = new Set(JSON.parse(localStorage.getItem('mars-wall-deleted') || '[]'));

      /* 静态数据（wall-data.js 内嵌，从 Supabase 导出的有效数据）
         这是回忆墙的主力数据源——不依赖任何网络请求，国内手机秒开 */
      const staticData = (window.__WALL_STATIC_DATA || [])
        .filter(p => !deletedSet.has(p.id))   // 过滤管理员已删
        .map(p => ({
        id: p.id, showId: p.showId, src: p.url || '', story: p.story || '',
        ts: p.ts || 0, local: false, mine: p.deviceId === me, device_id: p.deviceId
      })).filter(p => p.src || p.story);  // 安全过滤

      /* 第一步：立即用「静态数据 + 本机数据」渲染（真正的秒开，零网络依赖） */
      const initialData = {
        people: 0, perShow: [],
        photos: staticData.map(p => ({  // 转回 paintWall 期望的格式
          id: p.id, show_id: p.showId, device_id: p.device_id,
          url: p.src, story: p.story, created_at: p.ts ? new Date(p.ts).toISOString() : null
        })),
        attendance: _mergeAttendance(window.__WALL_STATIC_ATTENDANCE || [], _readAttCache())  // 静态固化足迹 ∪ 本机曾见到的最新真实人数，保证秒开/后端拉空时人数也准且不退回旧快照
      };
      paintWall(box, initialData, localBase, showMap, me, {
        status: staticData.length > 0
          ? '· 已加载 ' + staticData.length + ' 条回忆'
          : '· 暂无回忆'
      });
      bindWallActions();
      /* 缓存本场渲染上下文，供「同步云端」按钮复用 */
      _wallBox = box; _wallLocal = localBase; _wallShowMap = showMap; _wallMe = me; _wallDeleted = deletedSet;
      /* 开墙即自愈：静默把本机没传上服务器的照片/故事补传（不阻塞首屏） */
      selfHealUploads();

      /* 第二步：后台静默拉云端（3 次重试 + 退避 + 20s 超时），成功则合并刷新 */
      await syncWallFromBackend();
    } catch (e) {
      console.error('[mars-archive] 回忆墙渲染异常：', e);
      const box = $('#wallBody');
      if (box) box.innerHTML = '<p class="empty" style="color:var(--red)">回忆墙加载出现问题，请刷新页面试试。</p>';
    }
  }

  function bindWallActions() {
    const wb = $('#wallWrite');
    if (wb) wb.onclick = openWallStoryModal;
    const ws = $('#wallSync');
    if (ws) ws.onclick = () => syncWallFromBackend();
  }


  /* 渲染回忆墙主体：localBase=本机全集；data=远端数据（可为空）；opts.pending=true 表示远端尚未回来，opts.status 状态提示文字 */
  function paintWall(box, data, localBase, showMap, me, opts) {
    const pending = !!(opts && opts.pending);
    const statusText = (opts && opts.status) || '';
    /* 本机已写故事（无图）的场次集合，用于远端去重 */
    const localStoryShows = new Set(localBase.filter(p => !p.src && p.story).map(p => p.showId));

    /* 远端共享流：丢弃「无图无字」的垃圾记录；本机已有同场故事时跳过远端那条（避免重复空卡片） */
    const remote = (data.photos || []).map(p => ({
      id: p.id, showId: p.show_id, src: p.url || '', story: p.story || '',
      ts: p.created_at ? Date.parse(p.created_at) : 0, local: false, mine: p.device_id === me, device_id: p.device_id
    })).filter(p => {
      if (!p.src && !p.story) return false;                       // 空记录（url:null 且无字）直接丢弃
      if (!p.src && p.story && localStoryShows.has(p.showId)) return false; // 本机已有该场故事，跳过远端重复
      return true;
    });
    /* 远端内部去重：同一张图（base64 完全相同 = 逐字节重复上传）或同一段文字只留一条，
       消除历史上同图被重复上传到后端造成的「两份」。
       必须用完整字符串做 key：base64 图片的头 N 字符几乎都相同（JPEG 头 /9j/4AAQ...），
       用前缀/长度/尾组合都会把「同场次不同照片」误判为重复而吞掉。 */
    const seen = new Set();
    const remoteDedup = remote.filter(p => {
      const key = p.src ? p.showId + '|' + p.src : p.showId + '|story:' + (p.story || '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    /* 本机内容：文字故事永远保留；有图的照片只在「远端确有同图」时才去重。
       关键修复：不再用 Store.isSharedPhoto 标记来隐藏本机照片——
       海外后端半通不通时，照片会被标记为「已共享」却没真传上去，
       若按标记隐藏，本机这张就凭空消失（表现为「上传6张只显示1张」）。
       现在本机照片始终显示，只有远端真的出现了同图才去重，杜绝漏显示也不会重复。 */
    const remoteKeys = new Set(remoteDedup.filter(r => r.src).map(r => r.showId + '|' + r.src));
    const local = localBase.filter(p => {
      if (!p.src) return true;                                  // 文字故事永远显示
      const key = p.showId + '|' + p.src;
      return !remoteKeys.has(key);                             // 仅当远端确有同图时才去重
    }).map(p => ({ ...p, device_id: me }));
    const wall = remoteDedup.concat(local).sort((a, b) => (b.ts || 0) - (a.ts || 0));

    /* 统计：多少位火星人留下回忆 / 多少张照片 / 多少条火星故事（不再做「各场到场人数排行」）
       关键修复：人数必须合并「上传过照片/故事的 device」与「共享过足迹的 device」（attendance 表），
       二者去重后再加上自己——BUILD az 删共同足迹块时把 attendance 漏掉了，导致只数到 photos 的 4 个设备。 */
    const contributors = new Set([
      ...wall.map(p => p.device_id || me),
      ...(data.attendance || []).map(a => a.device_id).filter(Boolean),
      me
    ]).size;
    const photoCount = wall.filter(p => p.src).length;
    const storyCount = wall.filter(p => !p.src && (p.story || '').trim()).length;

    /* 管理员判定：当前设备 ID 是否在管理员列表中 */
    const adminList = (window.APP_CONFIG && window.APP_CONFIG.ADMIN_DEVICE_IDS) || [];
    const isAdmin = adminList.includes(Store.deviceId()) || localStorage.getItem('mars-admin') === '1';

    const cardsHtml = wall.length ? wall.map(it => {
      const s = showMap[it.showId];
      const cap = (s ? full(s.date) + ' · ' + esc(s.city) : '火星手记') + (it.local ? ' · 仅自己可见' : (it.mine ? ' · 我' : ''));
      /* 管理员删除按钮：仅远端条目（有 id）且当前用户是管理员时显示 */
      const delBtn = (isAdmin && it.id && !it.local)
        ? `<button class="gal-del" data-pid="${esc(it.id)}" title="删除此条">✕</button>` : '';
      if (!it.src) {
        return `<div class="gal-cell story-card${it.local ? ' local' : ''}">
          ${delBtn}
          <div class="gc-quote">"</div>
          <div class="gc-story">${esc(it.story || '')}</div>
          <div class="gal-cap">${cap}</div>
        </div>`;
      }
      return `<div class="gal-cell" data-url="${esc(it.src)}">
        ${delBtn}
        <img src="${esc(it.src)}" alt="火星人共享照片" loading="lazy">
        ${it.story ? `<div class="gc-story">${esc(it.story)}</div>` : ''}
        <div class="gal-cap">${cap}</div>
      </div>`;
    }).join('') : `<p class="empty">还没有共享内容。在点开任意场次后，上传照片、写一段小故事，再点「共享这场到回忆墙」即可上墙。</p>`;


    box.innerHTML = `
      <div class="wall-actions">
        <button class="wall-write" id="wallWrite">✎　写一段火星故事</button>
        <button class="wall-write" id="wallSync">↻　同步云端</button>
      </div>
      <div class="mine-stats wall-stats">
        <div class="mcard"><div class="n ${pending ? 'loading' : ''}">${pending ? '载入中' : contributors}<small>${pending ? '' : '位'}</small></div><div class="l">火星人的回忆</div>
          <div class="s">${pending ? '正在汇总…' : '在这里留下足迹'}</div></div>
        <div class="mcard"><div class="n ${pending ? 'loading' : ''}">${pending ? '载入中' : photoCount}<small>${pending ? '' : '张'}</small></div><div class="l">共享照片</div>
          <div class="s">来自现场的回忆</div></div>
        <div class="mcard"><div class="n ${pending ? 'loading' : ''}">${pending ? '载入中' : storyCount}<small>${pending ? '' : '条'}</small></div><div class="l">火星故事</div>
          <div class="s">写给现场的私语</div></div>
      </div>
      ${statusText && !pending ? `<div style="text-align:center;color:var(--txt-4);font-size:12px;margin-top:8px">· 已加载 ${wall.length} 条回忆</div>` : ''}
      <div class="sh-h" style="margin:40px 0 16px">共享回忆 · 照片与故事 · ${wall.length}</div>
      <div class="gallery">${cardsHtml}</div>`;

    const wb = $('#wallWrite'); if (wb) wb.onclick = openWallStoryModal;
    /* 管理员删除按钮：纯前端删除（墙是静态档案，不再依赖 Supabase RPC）
       从内存 + 本机记录移除 → 立即消失；要全网所有人也看不到，需重新导出部署 */
    if (isAdmin) {
      box.querySelectorAll('.gal-del').forEach(btn => {
        btn.onclick = function (e) {
          e.stopPropagation();   // 关键：阻止冒泡到卡片查看器（否则点删除会触发放大看图）
          const pid = this.getAttribute('data-pid');
          if (!pid) return;
          if (!confirm('确定要删除这条内容吗？此操作不可撤销。')) return;
          /* 1. 本机记录已删 id（刷新后仍不显示） */
          const delSet = JSON.parse(localStorage.getItem('mars-wall-deleted') || '[]');
          if (!delSet.includes(pid)) delSet.push(pid);
          localStorage.setItem('mars-wall-deleted', JSON.stringify(delSet));
          /* 2. 从静态数据内存中移除（当前会话立即消失） */
          if (window.__WALL_STATIC_DATA) {
            window.__WALL_STATIC_DATA = window.__WALL_STATIC_DATA.filter(p => p.id !== pid);
          }
          toast('已删除 ☉');
          renderWall();
        };
      });
    }
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
    if (Backend.isConfigured()) {
      if (window.__storyReady === undefined) { try { await Backend.probeStory(); } catch (_) {} }
      if (window.__storyReady) {
        try {
          const rid = await Backend.sharePhoto(showId, null, txt);
          if (rid) Store.setSharedPhoto(obj.id, rid);
          if (hint) hint.textContent = '已同步到回忆墙 ☉';
        } catch (e) {
          if (hint) hint.textContent = '已存本机，但同步失败：' + ((e && e.message) || e).slice(0, 40);
        }
      } else {
        if (hint) hint.textContent = '后端未启用文字列，仅存于本机（见说明开启）';
      }
    } else {
      if (hint) hint.textContent = '共享未开启，仅存于本机';
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

    /* 管理员本地解锁：网址后加 #admin 回车即可开启删除权限（仅本机生效，换设备/清缓存需重开） */
    if (location.hash.indexOf('admin') >= 0) {
      try { localStorage.setItem('mars-admin', '1'); } catch (_) {}
      history.replaceState({ mars: 'base' }, '', location.pathname + location.search);
      setTimeout(() => toast('管理员模式已开启 · 回忆墙照片可删除'), 600);
    }

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
    /* 首屏不强制显示年份导航；由 yearScrollHandler 按滚动位置决定 */
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
// 离线小工具：minitool-bootstrap.js 的 data-act 委托依赖 window.App；
// 顶层 const App 不会挂到 window，这里显式暴露，否则所有 data-act 按钮（返回/×/导出/导入）失效。
window.App = App;
