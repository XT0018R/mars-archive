/* ============================================================
   足迹地图 —— 自带中国省界 SVG
   省界与南海诸岛数据来自标准行政区划 GeoJSON（js/china-geo.js），
   随站打包，不依赖任何外部地图服务，永远能渲染出真实中国地图。
   合规：含台湾省、香港特别行政区、澳门特别行政区及南海诸岛。
   ============================================================ */
const MarsMap = (() => {

  /* 场次数 → 色阶（暗红同色系，由浅到亮） */
  const SCALE = [
    { max: 0,        fill: 'rgba(255,255,255,0.05)',  label: '未到达' },
    { max: 2,        fill: 'rgba(255,60,72,0.34)',    label: '1—2 场' },
    { max: 5,        fill: 'rgba(255,45,58,0.55)',    label: '3—5 场' },
    { max: 9,        fill: 'rgba(255,38,50,0.76)',    label: '6—9 场' },
    { max: Infinity, fill: 'rgba(255,45,58,0.95)',    label: '10 场以上' }
  ];
  const tierOf = n => SCALE.findIndex(t => n <= t.max);

  /* 省名 → 地图标注用短名 */
  const SHORT = {
    '北京市':'北京','天津市':'天津','河北省':'河北','山西省':'山西','内蒙古自治区':'内蒙古',
    '辽宁省':'辽宁','吉林省':'吉林','黑龙江省':'黑龙江','上海市':'上海','江苏省':'江苏',
    '浙江省':'浙江','安徽省':'安徽','福建省':'福建','江西省':'江西','山东省':'山东',
    '河南省':'河南','湖北省':'湖北','湖南省':'湖南','广东省':'广东','广西壮族自治区':'广西',
    '海南省':'海南','重庆市':'重庆','四川省':'四川','贵州省':'贵州','云南省':'云南',
    '西藏自治区':'西藏','陕西省':'陕西','甘肃省':'甘肃','青海省':'青海','宁夏回族自治区':'宁夏',
    '新疆维吾尔自治区':'新疆','台湾省':'台湾','香港特别行政区':'香港','澳门特别行政区':'澳门'
  };

  /* 墨卡托投影（x=经度弧度，y=纬度换算后取负，使北方朝上） */
  const proj = (lon, lat) => ({ x: lon * Math.PI / 180, y: -Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) });

  const ALL_PROVINCES = [
    '北京市','天津市','河北省','山西省','内蒙古自治区','辽宁省','吉林省','黑龙江省','上海市','江苏省',
    '浙江省','安徽省','福建省','江西省','山东省','河南省','湖北省','湖南省','广东省','广西壮族自治区',
    '海南省','重庆市','四川省','贵州省','云南省','西藏自治区','陕西省','甘肃省','青海省','宁夏回族自治区',
    '新疆维吾尔自治区','台湾省','香港特别行政区','澳门特别行政区'
  ];

  let svg = null, pathsByName = {}, centroids = {}, onlyMine = false, mineInited = false;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* 下钻：点省份 → 列出该省各城市及每场，点击跳转到档案 */
  function renderDrill(name) {
    const box = document.getElementById('provDrill');
    if (!box) return;
    const p = PROVINCE_STATS.find(x => x.province === name);
    if (!p) {
      box.classList.remove('on');
      box.innerHTML = `<div class="pd-empty">${esc(name)}　尚未到达 —— 等华晨宇下次巡演解锁 ✦</div>`;
      return;
    }
    const shows = SHOWS.filter(s => s.province === name).sort((a, b) => a.date.localeCompare(b.date));
    const byCity = {};
    shows.forEach(s => { (byCity[s.city] = byCity[s.city] || []).push(s); });
    const cities = Object.keys(byCity);
    const cityHtml = cities.map(city => {
      const list = byCity[city].map(s => {
        const d = s.date.replace(/-/g, '.');
        const w = (typeof Store !== 'undefined' && Store.isWent(s.id)) ? ' went' : '';
        return `<div class="pd-show${w}" data-show="${esc(s.id)}">
          <span class="pd-date">${d}</span>
          <span class="pd-venue">${esc(s.venue)}</span>
          <span class="pd-arrow">查看</span>
        </div>`;
      }).join('');
      return `<div class="pd-city">
        <div class="pd-city-h"><span class="pd-city-name">${esc(city)}</span><span class="pd-city-n">${byCity[city].length} 场</span></div>
        <div class="pd-shows">${list}</div>
      </div>`;
    }).join('');
    box.classList.add('on');
    box.innerHTML = `<div class="pd-head">
        <span class="pd-title">${esc(name)}</span>
        <span class="pd-sub">${p.count} 场 · ${cities.length} 城</span>
      </div>${cityHtml}`;
    box.querySelectorAll('[data-show]').forEach(el =>
      el.addEventListener('click', () => App.openSheet(el.dataset.show)));
    if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function renderLegend() {
    document.getElementById('legendScale').innerHTML =
      SCALE.map(t => `<span class="legend-sw" style="background:${t.fill};border:1px solid rgba(255,255,255,.25)" title="${t.label}"></span>`).join('');
  }

  function renderRank() {
    document.getElementById('rankTotal').textContent = `${PROVINCE_STATS.length} 个 · ${SHOWS.length} 场`;
    document.getElementById('rankList').innerHTML = PROVINCE_STATS.map(p => `
      <div class="rank-item" data-prov="${p.province}">
        <div>
          <div class="rank-name">${p.province}</div>
          <div class="rank-city">${p.cities.join('、')}</div>
        </div>
        <div class="rank-n">${p.count}</div>
        <div class="rank-bar" style="width:${(p.count / PROVINCE_STATS[0].count * 100).toFixed(1)}%"></div>
      </div>`).join('');
    document.getElementById('rankList').onclick = e => {
      const it = e.target.closest('[data-prov]');
      if (it) focusProvince(it.dataset.prov);
    };
  }

  function renderUnvisited() {
    const been = new Set(PROVINCE_STATS.map(p => p.province));
    const rest = ALL_PROVINCES.filter(p => !been.has(p));
    document.getElementById('unvisitedTags').innerHTML =
      rest.map(p => `<span>${SHORT[p] || p}</span>`).join('');
  }

  function draw() {
    const provinces = (window.CHINA_GEO || []).filter(p => p.name);
    const nh = window.CHINA_NANHAI || [];
    const been = Object.fromEntries(PROVINCE_STATS.map(p => [p.province, p]));

    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    const built = provinces.map(f => {
      const n = been[f.name] ? been[f.name].count : 0;
      const t = tierOf(n);
      let d = '';
      f.rings.forEach(ring => {
        if (!ring || ring.length < 3) return;
        ring.forEach((pt, i) => {
          const p = proj(pt[0], pt[1]);
          if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
          d += (i ? 'L' : 'M') + p.x.toFixed(3) + ' ' + p.y.toFixed(3);
        });
        d += 'Z';
      });
      const cen = f.centroid ? proj(f.centroid[0], f.centroid[1]) : null;
      return { name: f.name, short: SHORT[f.name] || f.name, count: n, tier: t, d, cen };
    });

    built.forEach(b => { if (b.cen) centroids[b.name] = b.cen; });
    const padX = (maxX - minX) * 0.04, padY = (maxY - minY) * 0.06;
    const vb = [minX - padX, minY - padY, (maxX - minX) + padX * 2, (maxY - minY) + padY * 2];

    /* 南海诸岛九段线：右下角小窗 */
    let nhSvg = '';
    if (nh.length) {
      let a = 1e9, b = 1e9, c = -1e9, d2 = -1e9;
      nh.forEach(ring => ring.forEach(pt => {
        const p = proj(pt[0], pt[1]);
        if (p.x < a) a = p.x; if (p.x > c) c = p.x;
        if (p.y < b) b = p.y; if (p.y > d2) d2 = p.y;
      }));
      const iw = (maxX - minX) * 0.20, ih = iw * 0.92, ix = maxX - iw - 0.12, iy = maxY - ih - 0.12;
      const s = Math.min(iw / (c - a), ih / (d2 - b));
      const tX = x => ix + (x - a) * s, tY = y => iy + (d2 - y) * s;
      let nd = '';
      nh.forEach(ring => {
        if (!ring || ring.length < 2) return;
        ring.forEach((pt, i) => {
          const p = proj(pt[0], pt[1]);
          nd += (i ? 'L' : 'M') + tX(p.x).toFixed(3) + ' ' + tY(p.y).toFixed(3);
        });
        nd += 'Z';
      });
      nhSvg = `<g class="nh-box">
        <rect x="${ix.toFixed(3)}" y="${iy.toFixed(3)}" width="${iw.toFixed(3)}" height="${ih.toFixed(3)}"/>
        <path class="nh" d="${nd}"/>
        <text class="nh-label" x="${(ix + iw / 2).toFixed(3)}" y="${(iy - 0.015).toFixed(3)}">南海诸岛</text>
      </g>`;
    }

    const provSvg = built.map(b =>
      `<path class="province t${b.tier}" data-name="${b.name}" d="${b.d}" fill-rule="evenodd"/>`).join('');
    const labelSvg = built.map(b =>
      b.cen ? `<text class="prov-label${b.count ? ' on' : ''}" x="${b.cen.x.toFixed(3)}" y="${b.cen.y.toFixed(3)}">${b.short}</text>` : '').join('');

    document.getElementById('tmap').innerHTML =
      `<svg viewBox="${vb.join(' ')}" preserveAspectRatio="xMidYMid meet" shape-rendering="geometricPrecision" xmlns="http://www.w3.org/2000/svg">${provSvg}${nhSvg}${labelSvg}<g class="mine-badges"></g></svg>`;

    svg = document.querySelector('#tmap svg');
    pathsByName = {};
    svg.querySelectorAll('.province').forEach(p => {
      pathsByName[p.dataset.name] = p;
      p.addEventListener('click', () => focusProvince(p.dataset.name));
    });
  }

  function focusProvince(name) {
    const p = PROVINCE_STATS.find(x => x.province === name);
    App.toast(p ? `${name}　${p.count} 场 · ${p.cities.join('、')}` : `${name}　尚未到达`);
    Object.values(pathsByName).forEach(el => el.classList.remove('active'));
    const el = pathsByName[name];
    if (el) el.classList.add('active');
    renderDrill(name);
  }

  function visitedProvinces() {
    const ids = (typeof Store !== 'undefined' && Store.wentList) ? Store.wentList() : [];
    const set = new Set(ids);
    const m = new Map();
    (typeof SHOWS !== 'undefined' ? SHOWS : []).forEach(s => {
      if (set.has(s.id)) m.set(s.province, (m.get(s.province) || 0) + 1);
    });
    return m;
  }

  function applyMine() {
    if (!svg) return;
    const vis = visitedProvinces();
    const tmapEl = document.getElementById('tmap');
    if (tmapEl) tmapEl.classList.toggle('only-mine', onlyMine);
    svg.querySelectorAll('.province').forEach(p => {
      const name = p.dataset.name;
      p.classList.toggle('visited', vis.has(name));            // 本人到过：常驻金色描边（标记后立即可见）
      p.classList.toggle('mine', onlyMine && vis.has(name));   // 只看我的足迹：整块点亮
    });
    let g = svg.querySelector('.mine-badges');
    if (!g) {
      g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'mine-badges');
      svg.appendChild(g);
    }
    // 本人到过的省份，始终在地图上标注场次数量（标记后立即可见，无需切到"只看我的足迹"）
    g.innerHTML = [...vis.entries()].map(([name, c]) => {
      const c0 = centroids[name];
      if (!c0) return '';
      return `<text class="mine-badge" x="${c0.x.toFixed(3)}" y="${(c0.y + 0.014).toFixed(3)}">${c}</text>`;
    }).join('');
  }

  function renderMineBox() {
    const box = document.getElementById('mapMine');
    if (!box) return;
    const vis = visitedProvinces();
    if (!vis.size) {
      box.innerHTML = '<span class="mm-empty">还没有标记去过的场次 —— 在「我的火星」里点亮你到过现场的那场 ✦</span>';
      return;
    }
    const chips = [...vis.entries()].map(([name, c]) => {
      const short = SHORT[name] || name;
      return `<span class="mm-chip"><i class="mm-dot"></i>${short}<b>${c}</b></span>`;
    }).join('');
    box.innerHTML = `<span class="mm-lead">我去过的省份</span>${chips}`;
  }

  function initMine() {
    renderMineBox();
    const btn = document.getElementById('toggleMine');
    if (!btn || mineInited) return;
    mineInited = true;
    btn.addEventListener('click', () => {
      onlyMine = !onlyMine;
      btn.classList.toggle('on', onlyMine);
      btn.textContent = onlyMine ? '显示全部省份' : '只看我的足迹';
      applyMine();
    });
    window.addEventListener('mars:went-changed', () => { renderMineBox(); applyMine(); });
  }

  function refresh() { renderMineBox(); applyMine(); }

  function ensure() {
    renderLegend();
    if (!document.getElementById('rankList').children.length) { renderRank(); renderUnvisited(); }
    if (!svg) draw();
    applyMine();
    initMine();
    const ml = document.getElementById('mapLoading');
    if (ml) ml.classList.add('hide');
  }

  return { ensure, focusProvince, refresh, applyMine };
})();
