/* LINE Boost 工具前端（不需建置，直接由伺服器提供） */
'use strict';

// ---------- 小工具 ----------
const $ = (s, el = document) => el.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
function toast(msg, err) {
  const d = h('div', { class: err ? 'err' : '' }, msg);
  $('#toast').append(d);
  setTimeout(() => d.remove(), err ? 6000 : 3000);
}
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof Blob) opt.body = body;
  else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, opt);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const guard = (fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { toast(e.message, true); console.error(e); }
};
const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-TW', { hour12: false }) : '');
const uniq = (a) => [...new Set(a)];
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 無痕模式 */ } },
};

// 雙向綁定的輸入框
function inp(obj, key, attrs = {}, after) {
  return h('input', { type: 'text', value: obj[key] ?? '', ...attrs, oninput: (e) => { obj[key] = e.target.type === 'number' ? Number(e.target.value) : e.target.value; (after || changed)(); } });
}
function ta(obj, key, attrs = {}, after) {
  return h('textarea', { value: obj[key] ?? '', ...attrs, oninput: (e) => { obj[key] = e.target.value; (after || changed)(); } });
}
function sel(obj, key, options, onchange) {
  return h('select', { onchange: (e) => { obj[key] = e.target.value; (onchange || changed)(); } },
    Object.entries(options).map(([v, t]) => h('option', { value: v, selected: String(obj[key] ?? '') === v }, t)));
}

// ---------- 狀態 ----------
const S = {
  config: {},
  accounts: [],
  acc: store.get('lb.account', null),
  tags: [],
  templates: [],
  model: store.get('lb.draft', null) || newModel(),
  push: store.get('lb.push', { mode: 'segment', target: { include: [], logic: 'and', exclude: [] }, track: true, name: '' }),
  menus: [],
  menu: null,
  layer: 0,
  areaSel: -1,
  showJson: false,
};
function newModel() { return { altText: '', messages: [{ type: 'text', text: '哈囉！歡迎加入好友 🎉' }], quickReply: [] }; }
const changed = () => { store.set('lb.draft', S.model); renderPreview(); };

// ---------- 上傳與圖片處理 ----------
function pickFile(accept) {
  return new Promise((resolve) => {
    const i = h('input', { type: 'file', accept, onchange: () => resolve(i.files[0] || null) });
    i.click();
  });
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('圖片讀取失敗'));
    img.src = src;
  });
}
function canvasBlob(canvas, type = 'image/jpeg', q = 0.9) {
  return new Promise((r) => canvas.toBlob(r, type, q));
}
// 縮放（cover 為裁切填滿）
function drawTo(img, w, hgt, cover) {
  const c = h('canvas', { width: w, height: hgt });
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, hgt);
  if (cover) {
    const s = Math.max(w / img.width, hgt / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (w - dw) / 2, (hgt - dh) / 2, dw, dh);
  } else ctx.drawImage(img, 0, 0, w, hgt);
  return c;
}
async function underLimit(canvas, limit) {
  for (let q = 0.92; q > 0.3; q -= 0.08) {
    const b = await canvasBlob(canvas, 'image/jpeg', q);
    if (b.size <= limit) return b;
  }
  return canvasBlob(canvas, 'image/jpeg', 0.3);
}
async function uploadBlob(blob, ext) {
  return api('POST', `/api/upload?ext=${ext}`, blob);
}
const fileURL = (f) => URL.createObjectURL(f);

// 一般圖片訊息：原圖（最寬 2048、≤10MB）＋預覽圖（最寬 1024、≤1MB）
async function uploadImage(file) {
  const img = await loadImage(fileURL(file));
  const scale = Math.min(1, 2048 / img.width);
  const big = await underLimit(drawTo(img, Math.round(img.width * scale), Math.round(img.height * scale)), 10e6);
  const ps = Math.min(1, 1024 / img.width);
  const small = await underLimit(drawTo(img, Math.round(img.width * ps), Math.round(img.height * ps)), 1e6);
  const [o, p] = await Promise.all([uploadBlob(big, 'jpg'), uploadBlob(small, 'jpg')]);
  return { url: o.url, preview: p.url };
}
// 熱區圖片：產生 1040／700／460／300／240 五種寬度
async function uploadImagemap(file) {
  const img = await loadImage(fileURL(file));
  const height = Math.round((1040 * img.height) / img.width);
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  let baseUrl;
  for (const w of [1040, 700, 460, 300, 240]) {
    const blob = await underLimit(drawTo(img, w, Math.round((w * img.height) / img.width)), 10e6);
    baseUrl = (await api('POST', `/api/imagemap/${id}/${w}`, blob)).baseUrl;
  }
  return { baseUrl, height };
}
// 影片：上傳 mp4，並擷取一格畫面當預覽圖
async function uploadVideo(file) {
  if (file.size > 200e6) throw new Error('影片不能超過 200MB');
  const up = await uploadBlob(file, 'mp4');
  const v = h('video', { muted: true, playsInline: true, preload: 'auto', src: fileURL(file) });
  await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('影片讀取失敗')); });
  v.currentTime = Math.min(1, (v.duration || 1) / 2);
  await new Promise((r) => { v.onseeked = r; });
  const c = h('canvas', { width: v.videoWidth, height: v.videoHeight });
  c.getContext('2d').drawImage(v, 0, 0);
  const p = await uploadBlob(await underLimit(c, 1e6), 'jpg');
  return { url: up.url, preview: p.url };
}
// 圖文選單底圖：裁成 2500×1686 或 2500×843，壓到 1MB 以下
async function uploadMenuImage(file, height) {
  const img = await loadImage(fileURL(file));
  const blob = await underLimit(drawTo(img, 2500, height, true), 1e6);
  return (await uploadBlob(blob, 'jpg')).url;
}
// 沒有設計稿時：用每一格的文字自動畫出底圖
async function generateMenuImage(layer, height, color) {
  const c = h('canvas', { width: 2500, height });
  const ctx = c.getContext('2d');
  ctx.fillStyle = color || '#c07b84';
  ctx.fillRect(0, 0, 2500, height);
  for (const a of layer.areas) {
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    const pad = 14;
    ctx.beginPath();
    ctx.roundRect(a.x + pad, a.y + pad, a.w - pad * 2, a.h - pad * 2, 36);
    ctx.fill();
    const label = (a.action && (a.action.label || a.action.text)) || '';
    const size = Math.max(40, Math.min(150, a.h / 4.5, (a.w * 1.6) / Math.max(2, label.length + 1)));
    ctx.fillStyle = color || '#c07b84';
    ctx.font = `700 ${size}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, a.x + a.w / 2, a.y + a.h / 2);
  }
  return (await uploadBlob(await underLimit(c, 1e6), 'jpg')).url;
}

// ---------- 動作編輯器 ----------
const ACTION_NAMES = { uri: '開連結', message: '傳送文字', tag: '貼標籤', share: '分享給好友', switch: '切換到其他層', camera: '開相機', cameraRoll: '開相簿', location: '傳送位置' };
const WHERE = {
  flex: ['uri', 'message', 'tag', 'share'],
  template: ['uri', 'message', 'tag', 'share'],
  quick: ['message', 'tag', 'uri', 'share', 'camera', 'cameraRoll', 'location'],
  imagemap: ['uri', 'message', 'share'],
  richmenu: ['uri', 'message', 'tag', 'switch', 'share'],
};
function actionEd(a, where, opt = {}) {
  const types = WHERE[where];
  if (!types.includes(a.type)) a.type = types[0];
  const after = opt.onChange || changed;
  const box = h('div', { class: 'action-ed' });
  const rebuild = () => { box.replaceWith(actionEd(a, where, opt)); after(); };
  box.append(sel(a, 'type', Object.fromEntries(types.map((t) => [t, ACTION_NAMES[t]])), rebuild));
  if (where !== 'imagemap') box.append(inp(a, 'label', { placeholder: where === 'richmenu' ? '格子名稱（統計用）' : '按鈕文字', maxLength: 20 }, after));
  if (a.type === 'uri') {
    box.append(inp(a, 'uri', { type: 'url', placeholder: 'https://…' }, after));
    box.append(inp(a, 'tags', { placeholder: '點了自動貼標籤（選填，逗號分隔）' }, after));
  } else if (a.type === 'message') {
    box.append(inp(a, 'text', { placeholder: '好友點了會送出的文字' }, after));
  } else if (a.type === 'tag') {
    box.append(inp(a, 'tags', { placeholder: '要貼的標籤，如 VIP, 台北店' }, after));
    box.append(inp(a, 'text', { placeholder: '聊天室顯示文字（選填）' }, after));
    box.append(inp(a, 'reply', { placeholder: '自動回覆（選填）' }, after));
  } else if (a.type === 'share') {
    box.append(inp(a, 'text', { placeholder: '要分享的內容（可含網址）' }, after));
    box.append(inp(a, 'tags', { placeholder: '點了貼標籤（選填）' }, after));
  } else if (a.type === 'switch') {
    const layers = opt.layers || [];
    box.append(sel(a, 'layer', Object.fromEntries(layers.map((l, i) => [String(i), `→ ${l.name || '第 ' + (i + 1) + ' 層'}`])), after));
    box.append(inp(a, 'tags', { placeholder: '同時貼標籤（選填）' }, after));
  }
  if (opt.onRemove) box.append(h('button', { class: 'btn sm danger', onclick: opt.onRemove }, '刪除'));
  return box;
}

// ---------- 切格編輯器（圖文選單、熱區圖片共用） ----------
const PRESETS = {
  large: { '6 格': [3, 2], '4 格': [2, 2], '3 欄': [3, 1], '上 1 下 2': 'top1', '上 1 下 3': 'top1b3', '2 欄': [2, 1], '1 格': [1, 1] },
  compact: { '3 格': [3, 1], '2 格': [2, 1], '左大右小': 'big-left', '1 格': [1, 1] },
  imagemap: { '2×2': [2, 2], '1×2 上下': [1, 2], '2×1 左右': [2, 1], '1 格': [1, 1] },
};
function presetAreas(p, W, H) {
  const g = (cols, rows) => {
    const out = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = Math.round((W * c) / cols), y = Math.round((H * r) / rows);
      out.push({ x, y, w: Math.round((W * (c + 1)) / cols) - x, h: Math.round((H * (r + 1)) / rows) - y });
    }
    return out;
  };
  if (Array.isArray(p)) return g(p[0], p[1]);
  const half = Math.round(H / 2);
  if (p === 'top1') return [{ x: 0, y: 0, w: W, h: half }, ...g(2, 1).map((a) => ({ ...a, y: half, h: H - half }))];
  if (p === 'top1b3') return [{ x: 0, y: 0, w: W, h: half }, ...g(3, 1).map((a) => ({ ...a, y: half, h: H - half }))];
  if (p === 'big-left') { const w = Math.round((W * 2) / 3); return [{ x: 0, y: 0, w, h: H }, { x: w, y: 0, w: W - w, h: H }]; }
  return g(1, 1);
}
function areaEditor({ W, H, image, areas, selected, onSelect, onChange }) {
  const box = h('div', { class: 'area-ed' + (image ? ' has-img' : ''), style: { aspectRatio: `${W} / ${H}`, backgroundImage: image ? `url("${image}")` : '' } });
  const pct = (v, t) => `${(v / t) * 100}%`;
  const draw = () => {
    box.querySelectorAll('.a').forEach((n) => n.remove());
    areas.forEach((a, i) => {
      const label = (a.action && (a.action.label || a.action.text)) || '';
      box.append(h('div', { class: 'a' + (i === selected ? ' sel' : ''), 'data-i': i, style: { left: pct(a.x, W), top: pct(a.y, H), width: pct(a.w, W), height: pct(a.h, H) } },
        `${i + 1}${label ? ' ' + label : ''}`, h('span', { class: 'rs' })));
    });
  };
  draw();
  let drag = null;
  const pt = (e) => {
    const r = box.getBoundingClientRect();
    return { x: Math.max(0, Math.min(W, ((e.clientX - r.left) / r.width) * W)), y: Math.max(0, Math.min(H, ((e.clientY - r.top) / r.height) * H)) };
  };
  box.addEventListener('pointerdown', (e) => {
    const p = pt(e);
    const node = e.target.closest('.a');
    box.setPointerCapture(e.pointerId);
    if (node) {
      const i = Number(node.dataset.i);
      selected = i;
      drag = { mode: e.target.classList.contains('rs') ? 'resize' : 'move', i, start: p, orig: { ...areas[i] } };
      draw();
    } else {
      drag = { mode: 'create', start: p, el: h('div', { class: 'draft' }) };
      box.append(drag.el);
    }
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = pt(e);
    if (drag.mode === 'create') {
      const x = Math.min(p.x, drag.start.x), y = Math.min(p.y, drag.start.y);
      drag.rect = { x, y, w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
      Object.assign(drag.el.style, { left: pct(x, W), top: pct(y, H), width: pct(drag.rect.w, W), height: pct(drag.rect.h, H) });
      return;
    }
    const a = areas[drag.i], o = drag.orig;
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (drag.mode === 'move') {
      a.x = Math.round(Math.max(0, Math.min(W - o.w, o.x + dx)));
      a.y = Math.round(Math.max(0, Math.min(H - o.h, o.y + dy)));
    } else {
      a.w = Math.round(Math.max(20, Math.min(W - o.x, o.w + dx)));
      a.h = Math.round(Math.max(20, Math.min(H - o.y, o.h + dy)));
    }
    drag.moved = true;
    draw();
  });
  box.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.mode === 'create') {
      d.el.remove();
      if (d.rect && d.rect.w > W / 50 && d.rect.h > H / 50) {
        areas.push({ x: Math.round(d.rect.x), y: Math.round(d.rect.y), w: Math.round(d.rect.w), h: Math.round(d.rect.h), action: { type: '', label: '' } });
        onSelect(areas.length - 1);
        onChange();
      }
      return;
    }
    if (d.moved) onChange();
    onSelect(d.i);
  });
  return box;
}
function areaNumbers(a, W, H, after) {
  return h('div', { class: 'row muted' }, ['x', 'y', 'w', 'h'].map((k) => [k, inp(a, k, { type: 'number', min: 0, max: k === 'x' || k === 'w' ? W : H, style: { width: '80px', flex: 'none' } }, after)]));
}

// ---------- 訊息編輯 ----------
const TYPES = {
  text: '純文字', image: '純圖片', imagemap: '熱區圖片', video: '純影片', youtube: 'YouTube 卡片',
  flex: '圖文訊息（單頁／多頁）', flexjson: '自訂 Flex JSON', buttons: '按鈕範本', confirm: '確認範本',
};
const newBubble = () => ({ image: '', ratio: '20:13', title: '標題', price: '', text: '說明文字', color: '#C07B84', buttons: [{ type: 'uri', label: '了解更多', uri: 'https://' }] });
const NEW_ITEM = {
  text: () => ({ type: 'text', text: '' }),
  image: () => ({ type: 'image', url: '', preview: '' }),
  imagemap: () => ({ type: 'imagemap', baseUrl: '', height: 1040, areas: [] }),
  video: () => ({ type: 'video', url: '', preview: '' }),
  youtube: () => ({ type: 'youtube', url: '', title: '', desc: '', button: '▶ 觀看影片' }),
  flex: () => ({ type: 'flex', bubbles: [newBubble()] }),
  flexjson: () => ({ type: 'flexjson', json: '{\n  "type": "bubble",\n  "body": { "type": "box", "layout": "vertical", "contents": [ { "type": "text", "text": "Hello" } ] }\n}' }),
  buttons: () => ({ type: 'buttons', image: '', title: '標題', text: '說明', actions: [{ type: 'uri', label: '開啟網站', uri: 'https://' }] }),
  confirm: () => ({ type: 'confirm', text: '確定要報名嗎？', actions: [{ type: 'tag', label: '是', tags: '已報名', text: '是' }, { type: 'message', label: '否', text: '否' }] }),
};

function uploadBtn(label, accept, fn) {
  return h('button', {
    class: 'btn', onclick: guard(async (e) => {
      const f = await pickFile(accept);
      if (!f) return;
      const b = e.target;
      b.disabled = true;
      b.textContent = '上傳中…';
      try { await fn(f); } finally { b.disabled = false; b.textContent = label; }
    }),
  }, label);
}

function imageField(obj, key, label = '圖片') {
  return h('div', { class: 'row' }, h('label', {}, label),
    uploadBtn('上傳', 'image/png,image/jpeg', async (f) => { const r = await uploadImage(f); obj[key] = r.url; renderCompose(); }),
    inp(obj, key, { type: 'url', placeholder: '或貼上 https 圖片網址' }),
    obj[key] ? h('img', { class: 'thumb', src: obj[key] }) : null);
}

function itemEditor(it, idx) {
  const list = S.model.messages;
  const move = (d) => { const j = idx + d; if (j < 0 || j >= list.length) return; [list[idx], list[j]] = [list[j], list[idx]]; renderCompose(); };
  const head = h('div', { class: 'item-head' }, `${idx + 1}. ${TYPES[it.type]}`, h('span', { class: 'sp' }),
    h('button', { class: 'btn sm', onclick: () => move(-1) }, '↑'),
    h('button', { class: 'btn sm', onclick: () => move(1) }, '↓'),
    h('button', { class: 'btn sm danger', onclick: () => { list.splice(idx, 1); renderCompose(); } }, '刪除'));
  const body = h('div', { class: 'stack' });
  switch (it.type) {
    case 'text':
      body.append(ta(it, 'text', { placeholder: '訊息內容（可用 emoji）', maxLength: 5000 }));
      break;
    case 'image':
      body.append(h('div', { class: 'row' },
        uploadBtn('上傳圖片', 'image/png,image/jpeg', async (f) => { Object.assign(it, await uploadImage(f)); renderCompose(); }),
        inp(it, 'url', { type: 'url', placeholder: '或貼上原圖網址' }),
        it.url ? h('img', { class: 'thumb', src: it.preview || it.url }) : null),
        h('div', { class: 'muted' }, '整張圖以原比例呈現。上傳時自動產生預覽小圖。'));
      break;
    case 'video':
      body.append(h('div', { class: 'row' },
        uploadBtn('上傳 MP4', 'video/mp4', async (f) => { Object.assign(it, await uploadVideo(f)); renderCompose(); }),
        inp(it, 'url', { type: 'url', placeholder: '或貼上 mp4 網址' })),
        imageField(it, 'preview', '預覽圖'),
        h('div', { class: 'muted' }, '在對話中直接播放。上傳時自動擷取畫面當預覽圖。'));
      break;
    case 'youtube': {
      const id = Builder.youtubeId(it.url);
      body.append(h('div', { class: 'row' }, h('label', {}, '影片網址'), inp(it, 'url', { type: 'url', placeholder: 'https://youtu.be/…' }, () => { changed(); }),
        id ? h('img', { class: 'thumb', src: `https://i.ytimg.com/vi/${id}/default.jpg` }) : null),
        h('div', { class: 'row' }, h('label', {}, '標題'), inp(it, 'title')),
        h('div', { class: 'row' }, h('label', {}, '說明'), inp(it, 'desc')),
        h('div', { class: 'row' }, h('label', {}, '按鈕文字'), inp(it, 'button')),
        h('div', { class: 'row' }, h('label', {}, '點了貼標籤'), inp(it, 'tags', { placeholder: '選填，需開啟點擊追蹤' })),
        h('div', { class: 'muted' }, '貼網址自動變成有縮圖與播放鈕的卡片，點開在 LINE 內建瀏覽器全螢幕播放。'));
      break;
    }
    case 'imagemap': {
      it.areas = it.areas || [];
      const selIdx = it._sel ?? -1;
      const preview = it.baseUrl ? `${it.baseUrl}/1040` : '';
      body.append(h('div', { class: 'row' },
        uploadBtn(it.baseUrl ? '換圖片' : '上傳圖片', 'image/png,image/jpeg', async (f) => { Object.assign(it, await uploadImagemap(f)); renderCompose(); }),
        h('span', { class: 'muted' }, '在圖上拖曳畫出可點區塊；拖曳區塊可移動，右下角可調整大小')));
      body.append(h('div', { class: 'row' }, h('span', { class: 'muted' }, '快速切格：'),
        Object.entries(PRESETS.imagemap).map(([n, p]) => h('button', { class: 'btn sm', onclick: () => { it.areas = presetAreas(p, 1040, it.height).map((a) => ({ ...a, action: { type: 'uri', uri: 'https://' } })); it._sel = 0; renderCompose(); } }, n))));
      body.append(h('div', { style: { maxWidth: '420px' } }, areaEditor({
        W: 1040, H: it.height, image: preview, areas: it.areas, selected: selIdx,
        onSelect: (i) => { it._sel = i; renderCompose(); }, onChange: changed,
      })));
      const a = it.areas[selIdx];
      if (a) {
        body.append(h('div', { class: 'sub' }, h('b', {}, `區塊 ${selIdx + 1} 的動作`),
          actionEd(a.action, 'imagemap', { onRemove: () => { it.areas.splice(selIdx, 1); it._sel = -1; renderCompose(); } }),
          areaNumbers(a, 1040, it.height, () => { changed(); })));
      }
      break;
    }
    case 'flex':
      it.bubbles.forEach((b, bi) => body.append(bubbleEditor(it, b, bi)));
      if (it.bubbles.length < 12) body.append(h('button', { class: 'btn', onclick: () => { it.bubbles.push(newBubble()); renderCompose(); } }, `＋ 新增一頁（目前 ${it.bubbles.length} 頁，多頁會變成橫向滑動）`));
      break;
    case 'flexjson': {
      const err = h('div', { class: 'muted' });
      const check = () => { try { JSON.parse(it.json); err.textContent = '✓ JSON 格式正確'; } catch (e) { err.textContent = '✗ ' + e.message; } };
      body.append(ta(it, 'json', { style: { minHeight: '180px', fontFamily: 'monospace' } }, () => { check(); changed(); }), err,
        h('div', { class: 'muted' }, '可貼上 LINE Flex Message Simulator 匯出的 bubble 或 carousel JSON。'));
      check();
      break;
    }
    case 'buttons':
      body.append(imageField(it, 'image', '縮圖'),
        h('div', { class: 'row' }, h('label', {}, '標題'), inp(it, 'title', { maxLength: 40 })),
        h('div', { class: 'row' }, h('label', {}, '內文'), inp(it, 'text', { maxLength: 160 })));
      it.actions.forEach((a, i) => body.append(actionEd(a, 'template', { onRemove: () => { it.actions.splice(i, 1); renderCompose(); } })));
      if (it.actions.length < 4) body.append(h('button', { class: 'btn sm', onclick: () => { it.actions.push({ type: 'message', label: '' }); renderCompose(); } }, '＋ 按鈕（最多 4 個）'));
      break;
    case 'confirm':
      body.append(h('div', { class: 'row' }, h('label', {}, '問題'), inp(it, 'text', { maxLength: 240 })));
      it.actions.forEach((a) => body.append(actionEd(a, 'template')));
      break;
  }
  return h('div', { class: 'item' }, head, body);
}

function bubbleEditor(it, b, bi) {
  const multi = it.bubbles.length > 1;
  b.buttons = b.buttons || [];
  b.imageAction = b.imageAction || { type: '' };
  return h('div', { class: 'sub' },
    h('div', { class: 'item-head' }, multi ? `第 ${bi + 1} 頁` : '卡片內容', h('span', { class: 'sp' }),
      multi ? h('button', { class: 'btn sm', onclick: () => { it.bubbles.splice(bi + 1, 0, structuredClone(b)); renderCompose(); } }, '複製') : null,
      multi ? h('button', { class: 'btn sm danger', onclick: () => { it.bubbles.splice(bi, 1); renderCompose(); } }, '刪除') : null),
    imageField(b, 'image', '主圖'),
    h('div', { class: 'row' }, h('label', {}, '圖片比例'), sel(b, 'ratio', { '20:13': '20:13 橫式', '1:1': '1:1 方形', '16:9': '16:9 寬螢幕', '3:4': '3:4 直式' }),
      h('label', {}, '主色'), h('input', { type: 'color', value: b.color || '#C07B84', oninput: (e) => { b.color = e.target.value; changed(); } })),
    h('div', { class: 'row' }, h('label', {}, '點圖片'),
      h('select', { onchange: (e) => { b.imageAction = e.target.value ? { type: e.target.value, uri: 'https://' } : { type: '' }; renderCompose(); } },
        h('option', { value: '' }, '不動作'), h('option', { value: 'uri', selected: b.imageAction.type === 'uri' }, '開連結'))),
    b.imageAction.type ? actionEd(b.imageAction, 'flex') : null,
    h('div', { class: 'row' }, h('label', {}, '標題'), inp(b, 'title')),
    h('div', { class: 'row' }, h('label', {}, '價格／副標'), inp(b, 'price', { placeholder: '選填，如 NT$ 990' })),
    h('div', { class: 'row' }, h('label', {}, '說明'), ta(b, 'text', { style: { minHeight: '50px' } })),
    b.buttons.map((a, i) => actionEd(a, 'flex', { onRemove: () => { b.buttons.splice(i, 1); renderCompose(); } })),
    b.buttons.length < 4 ? h('button', { class: 'btn sm', onclick: () => { b.buttons.push({ type: 'uri', label: '', uri: 'https://' }); renderCompose(); } }, '＋ 按鈕（最多 4 個）') : null);
}

function quickReplyEditor() {
  const qr = S.model.quickReply;
  return h('div', { class: 'card' },
    h('h3', {}, `快速回覆泡泡（${qr.length}/13）`, h('span', { class: 'sp' }),
      qr.length < 13 ? h('button', { class: 'btn sm', onclick: () => { qr.push({ imageUrl: '', action: { type: 'message', label: '', text: '' } }); renderCompose(); } }, '＋ 新增') : null),
    h('div', { class: 'muted' }, '顯示在最後一則訊息下方，好友點一下就能回答，不用打字。可放小圖示、開連結、分享給好友或貼標籤。'),
    qr.map((q, i) => h('div', { class: 'sub' },
      actionEd(q.action, 'quick', { onRemove: () => { qr.splice(i, 1); renderCompose(); } }),
      h('div', { class: 'row' }, h('label', {}, '小圖示'),
        uploadBtn('上傳', 'image/png', async (f) => { const img = await loadImage(fileURL(f)); const c = drawTo(img, 96, 96, true); q.imageUrl = (await uploadBlob(await canvasBlob(c, 'image/png'), 'png')).url; renderCompose(); }),
        inp(q, 'imageUrl', { type: 'url', placeholder: '選填，PNG 網址' })))));
}

function tagPicker(list, onChange) {
  const box = h('div', { class: 'stack' });
  const draw = () => {
    box.replaceChildren(
      h('div', { class: 'chips' }, list.length ? list.map((t, i) => h('span', { class: 'chip' }, t, h('button', { onclick: () => { list.splice(i, 1); draw(); onChange(); } }, '×'))) : h('span', { class: 'muted' }, '（未選）')),
      h('div', { class: 'row' },
        h('select', { onchange: (e) => { if (e.target.value && !list.includes(e.target.value)) { list.push(e.target.value); draw(); onChange(); } } },
          h('option', { value: '' }, '＋ 選擇標籤'), S.tags.map((t) => h('option', { value: t.tag }, `${t.tag}（${t.n}）`))),
        h('input', { type: 'text', placeholder: '或輸入新標籤後按 Enter', onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { list.push(e.target.value.trim()); draw(); onChange(); } } })));
  };
  draw();
  return box;
}

function pushCard() {
  const P = S.push;
  P.target = P.target || { include: [], logic: 'and', exclude: [] };
  const count = h('b', {}, '…');
  const refresh = debounce(guard(async () => {
    store.set('lb.push', P);
    if (!S.acc || P.mode !== 'segment') { count.textContent = ''; return; }
    count.textContent = `符合 ${(await api('POST', '/api/segment', { account: S.acc, target: P.target })).count} 人`;
  }), 300);
  const modeRadio = (v, t) => h('label', {}, h('input', { type: 'radio', name: 'pmode', checked: P.mode === v, onchange: () => { P.mode = v; store.set('lb.push', P); renderCompose(); } }), ' ', t);
  const schedule = h('input', { type: 'datetime-local' });
  const submit = guard(async () => {
    if (!S.acc) throw new Error('請先到「帳號設定」新增官方帳號');
    const messages = Builder.buildMessages(S.model);
    if (!messages.length) throw new Error('請先新增訊息');
    const payload = { account: S.acc, name: P.name || S.model.altText || '推播', messages, mode: P.mode, target: P.target, testUserIds: P.testUserIds, track: P.track };
    if (schedule.value) payload.scheduleAt = new Date(schedule.value).toISOString();
    const who = P.mode === 'broadcast' ? '全部好友' : P.mode === 'test' ? '測試對象' : count.textContent;
    if (!confirm(`${schedule.value ? '排程' : '立即'}推播給 ${who}？`)) return;
    const r = await api('POST', '/api/send', payload);
    toast(r.scheduled ? `已排程：${fmtTime(r.scheduled.at)}` : `已送出給 ${r.recipients} 人`);
  });
  const card = h('div', { class: 'card' },
    h('h3', {}, '推播'),
    h('div', { class: 'row' }, h('label', {}, '活動名稱'), inp(P, 'name', { placeholder: '成效報表上顯示的名稱' }, refresh)),
    h('div', { class: 'row' }, modeRadio('segment', '標籤分眾'), modeRadio('broadcast', '全部好友'), modeRadio('test', '測試')),
    P.mode === 'segment' ? h('div', { class: 'sub' },
      h('div', {}, '包含標籤 ', sel(P.target, 'logic', { and: '全部符合（AND）', or: '任一符合（OR）' }, refresh)),
      tagPicker(P.target.include, refresh),
      h('div', { style: { marginTop: '8px' } }, '排除標籤'),
      tagPicker(P.target.exclude, refresh),
      h('div', { class: 'muted' }, '不選標籤＝所有已知好友（透過 Webhook 或同步取得）。'), count) : null,
    P.mode === 'test' ? h('div', { class: 'sub' }, h('div', { class: 'muted' }, '好友的 userId（可到「好友與標籤」複製），多個用逗號分隔'), inp(P, 'testUserIds', { placeholder: 'U1234…' }, refresh)) : null,
    P.mode === 'broadcast' ? h('div', { class: 'muted' }, '使用 broadcast 傳給所有好友（含工具尚未記錄的好友）。點連結只能統計次數，無法辨識是誰。') : null,
    h('div', { class: 'row' }, h('label', {}, h('input', { type: 'checkbox', checked: P.track !== false, onchange: (e) => { P.track = e.target.checked; refresh(); } }), ' 追蹤點擊'),
      h('span', { class: 'muted' }, '連結改經本工具轉址，可統計每顆按鈕點擊；分眾推播時會逐人發送，點了自動貼標籤')),
    h('div', { class: 'row' }, h('label', {}, '排程'), schedule, h('span', { class: 'muted' }, '留空＝立即送出')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: guard(async () => { await api('POST', '/api/validate', { account: S.acc, messages: Builder.buildMessages(S.model) }); toast('✓ LINE 驗證格式通過'); }) }, '驗證格式'),
      h('button', { class: 'btn primary', onclick: submit }, '送出')),
    h('div', { class: 'muted' }, '推播額度以「收件人數」計算，一次最多 5 則訊息只算 1 則。'));
  refresh();
  return card;
}

function templateCard() {
  const m = S.model;
  return h('div', { class: 'card' },
    h('h3', {}, '範本', h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: () => { if (confirm('清空目前編輯的內容？')) { S.model = newModel(); changed(); renderCompose(); } } }, '開新訊息')),
    h('div', { class: 'row' }, h('label', {}, '範本名稱'), inp(m, '_tplName', { placeholder: '例如：週年慶主推' }, () => store.set('lb.draft', m)),
      m._tplId ? h('button', { class: 'btn', onclick: guard(() => saveTemplate(m._tplId)) }, '更新範本') : null,
      h('button', { class: 'btn primary', onclick: guard(() => saveTemplate(null)) }, '另存新範本')),
    h('div', { class: 'row' }, h('label', {}, '套用範本'),
      h('select', { onchange: (e) => { const t = S.templates.find((x) => x.id === e.target.value); if (t) loadTemplate(t); } },
        h('option', { value: '' }, `選擇（共 ${S.templates.length} 個）`), S.templates.map((t) => h('option', { value: t.id }, t.name)))),
    h('div', { class: 'muted' }, '範本可跨你管理的所有官方帳號使用，之後只改文字與連結。'));
}
async function saveTemplate(id) {
  const messages = Builder.buildMessages(S.model);
  const t = await api('POST', '/api/templates', { id, name: S.model._tplName || S.model.altText || '未命名範本', model: S.model, messages });
  S.model._tplId = t.id;
  changed();
  await loadTemplates();
  renderCompose();
  toast('範本已儲存');
}
function loadTemplate(t) {
  S.model = structuredClone(t.model);
  S.model._tplId = t.id;
  S.model._tplName = t.name;
  changed();
  renderCompose();
  showTab('compose');
}

function renderCompose() {
  const m = S.model;
  const left = h('div', {},
    h('div', { class: 'card' },
      h('h3', {}, `訊息內容（${m.messages.length}/5 則）`),
      h('div', { class: 'row' }, h('label', {}, '通知文字'), inp(m, 'altText', { placeholder: '顯示在通知與聊天列表，如「週年慶開跑！」', maxLength: 400 })),
      m.messages.map((it, i) => itemEditor(it, i)),
      m.messages.length < 5 ? h('div', {}, h('div', { class: 'muted', style: { margin: '6px 0' } }, '新增訊息：'),
        h('div', { class: 'typebar' }, Object.entries(TYPES).map(([t, n]) => h('button', { class: 'btn sm', onclick: () => { m.messages.push(NEW_ITEM[t]()); changed(); renderCompose(); } }, '＋ ' + n)))) : null),
    quickReplyEditor(),
    templateCard());
  const right = h('div', {},
    h('div', { class: 'phone', id: 'phone' }),
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn sm', onclick: () => { S.showJson = !S.showJson; renderPreview(); } }, S.showJson ? '隱藏 JSON' : '查看 LINE JSON'),
      h('button', { class: 'btn sm', onclick: guard(async () => { await navigator.clipboard.writeText(JSON.stringify(Builder.clean(Builder.buildMessages(m)), null, 2)); toast('已複製 JSON'); }) }, '複製 JSON')),
    h('div', { id: 'json' }),
    pushCard());
  $('#tab-compose').replaceChildren(h('div', { class: 'grid' }, left, right));
  renderPreview();
}

// ---------- 預覽 ----------
function pvAction(a) { return (a && (a.label || a.text)) || '按鈕'; }
function pvCard(b) {
  const ratio = { '20:13': '20/13', '1:1': '1/1', '16:9': '16/9', '3:4': '3/4' }[b.ratio] || '20/13';
  return h('div', { class: 'pv-card' },
    b.image ? h('img', { class: 'hero', src: b.image, style: { aspectRatio: ratio } }) : null,
    h('div', { class: 'bd' },
      b.title ? h('div', { class: 'tt' }, b.title) : null,
      b.price ? h('div', { class: 'pr', style: { color: b.color } }, b.price) : null,
      b.text ? h('div', { class: 'tx' }, b.text) : null),
    (b.buttons || []).length ? h('div', { class: 'ft' }, b.buttons.map((a, i) => h('div', { class: 'b' + (i === 0 ? ' p' : ''), style: i === 0 ? { background: b.color || '#C07B84' } : {} }, pvAction(a)))) : null);
}
function pvItem(it) {
  switch (it.type) {
    case 'text': return h('div', { class: 'pv-text' }, it.text || '（空白）');
    case 'image': return it.url ? h('img', { class: 'pv-img', src: it.preview || it.url }) : h('div', { class: 'pv-text muted' }, '（尚未上傳圖片）');
    case 'video': return it.preview ? h('div', { class: 'pv-video' }, h('img', { class: 'pv-img', src: it.preview })) : h('div', { class: 'pv-text muted' }, '（尚未上傳影片）');
    case 'imagemap':
      if (!it.baseUrl) return h('div', { class: 'pv-text muted' }, '（尚未上傳熱區圖片）');
      return h('div', { class: 'pv-imgmap' }, h('img', { src: `${it.baseUrl}/1040` }),
        (it.areas || []).map((a) => h('i', { style: { left: `${(a.x / 1040) * 100}%`, top: `${(a.y / it.height) * 100}%`, width: `${(a.w / 1040) * 100}%`, height: `${(a.h / it.height) * 100}%` } })));
    case 'youtube': {
      const id = Builder.youtubeId(it.url);
      return h('div', { class: 'pv-card' },
        h('div', { class: 'yt' }, id ? h('img', { class: 'hero', src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, style: { aspectRatio: '16/9' } }) : h('div', { class: 'hero', style: { aspectRatio: '16/9' } })),
        it.title || it.desc ? h('div', { class: 'bd' }, it.title ? h('div', { class: 'tt' }, it.title) : null, it.desc ? h('div', { class: 'tx' }, it.desc) : null) : null,
        h('div', { class: 'ft' }, h('div', { class: 'b p', style: { background: '#f00' } }, it.button || '▶ 觀看影片')));
    }
    case 'flex':
      return it.bubbles.length === 1 ? pvCard(it.bubbles[0]) : h('div', { class: 'pv-scroll' }, it.bubbles.map(pvCard));
    case 'flexjson': return h('div', { class: 'pv-text muted' }, '自訂 Flex：請用「查看 LINE JSON」確認，或貼到 LINE Flex Message Simulator 預覽');
    case 'buttons':
      return h('div', { class: 'pv-card pv-tpl' }, it.image ? h('img', { class: 'hero', src: it.image, style: { aspectRatio: '1.51/1' } }) : null,
        h('div', { class: 'bd' }, it.title ? h('div', { class: 'tt' }, it.title) : null, h('div', { class: 'tx' }, it.text)),
        h('div', { class: 'ft' }, it.actions.map((a) => h('div', { class: 'b' }, pvAction(a)))));
    case 'confirm':
      return h('div', { class: 'pv-card pv-tpl' }, h('div', { class: 'bd' }, h('div', { class: 'tx', style: { color: '#222' } }, it.text)),
        h('div', { class: 'ft', style: { gridTemplateColumns: '1fr 1fr' } }, it.actions.map((a) => h('div', { class: 'b' }, pvAction(a)))));
    default: return h('div');
  }
}
function renderPreview() {
  const phone = $('#phone');
  if (!phone) return;
  const m = S.model;
  phone.replaceChildren(
    h('div', { class: 'msgs' }, m.messages.map((it) => h('div', { class: 'bubble-row' }, h('div', { class: 'avatar' }, 'OA'), pvItem(it)))),
    ...(m.quickReply.length ? [h('div', { class: 'pv-qr' }, m.quickReply.map((q) => h('span', {}, q.imageUrl ? h('img', { src: q.imageUrl }) : null, pvAction(q.action))))] : []));
  const j = $('#json');
  if (!S.showJson) { j.replaceChildren(); return; }
  try {
    j.replaceChildren(h('pre', { class: 'json' }, JSON.stringify(Builder.clean(Builder.buildMessages(m)), null, 2)));
  } catch (e) {
    j.replaceChildren(h('pre', { class: 'json' }, '錯誤：' + e.message));
  }
}

// ---------- 圖文選單 ----------
const menuH = (m) => (m.size === 'compact' ? 843 : 1686);
function newMenu() {
  return { account: S.acc, name: '主選單', size: 'large', chatBarText: '選單', openByDefault: true, target: { mode: 'default', tag: '' }, layers: [{ name: '第一層', image: '', bg: '#c07b84', areas: presetAreas([3, 2], 2500, 1686).map((a, i) => ({ ...a, action: { type: 'message', label: `按鈕${i + 1}`, text: `按鈕${i + 1}` } })) }] };
}
const saveMenu = debounce(guard(async () => {
  if (!S.menu) return;
  const saved = await api('POST', '/api/menus', S.menu);
  if (!S.menu.id) { S.menu.id = saved.id; await loadMenus(); renderMenu(); }
}), 600);
const menuChanged = () => { saveMenu(); renderMenuPreview(); };

async function loadMenus() {
  S.menus = S.acc ? await api('GET', `/api/menus?account=${S.acc}`) : [];
  if (S.menu && S.menu.id) S.menu = S.menus.find((m) => m.id === S.menu.id) || null;
}

function renderMenu() {
  const root = $('#tab-menu');
  if (!S.acc) { root.replaceChildren(h('div', { class: 'card' }, '請先到「帳號設定」新增官方帳號。')); return; }
  const list = h('div', { class: 'card' },
    h('h3', {}, '圖文選單', h('span', { class: 'sp' }), h('button', { class: 'btn sm primary', onclick: guard(async () => { S.menu = newMenu(); S.layer = 0; S.areaSel = -1; const saved = await api('POST', '/api/menus', S.menu); S.menu.id = saved.id; await loadMenus(); renderMenu(); }) }, '＋ 新增圖文選單')),
    S.menus.length ? S.menus.map((m) => h('div', { class: 'list-item' },
      h('b', {}, m.name), h('span', { class: 'muted' }, `${m.layers.length} 層 · ${m.size === 'compact' ? '小張' : '大張'}`),
      m.published ? h('span', { class: 'status done' }, m.published.target.mode === 'tag' ? `上架中（標籤：${m.published.target.tag}）` : '上架中（預設）') : h('span', { class: 'status' }, '草稿'),
      h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: () => { S.menu = m; S.layer = 0; S.areaSel = -1; renderMenu(); } }, '編輯'))) : h('div', { class: 'muted' }, '還沒有圖文選單。'));
  if (!S.menu) { root.replaceChildren(list); return; }

  const M = S.menu;
  const H = menuH(M);
  if (S.layer >= M.layers.length) S.layer = 0;
  const L = M.layers[S.layer];
  const a = L.areas[S.areaSel];
  const editor = h('div', { class: 'card' },
    h('h3', {}, `編輯：${M.name}`),
    h('div', { class: 'row' }, h('label', {}, '名稱'), inp(M, 'name', {}, menuChanged), h('label', {}, '選單列文字'), inp(M, 'chatBarText', { maxLength: 14 }, menuChanged)),
    h('div', { class: 'row' }, h('label', {}, '版面'),
      sel(M, 'size', { large: '大張 2500×1686', compact: '小張 2500×843' }, () => {
        const nh = menuH(M);
        for (const l of M.layers) l.areas = l.areas.map((x) => ({ ...x, y: Math.round((x.y * nh) / (nh === 843 ? 1686 : 843)), h: Math.round((x.h * nh) / (nh === 843 ? 1686 : 843)) }));
        menuChanged(); renderMenu();
      }),
      h('label', {}, h('input', { type: 'checkbox', checked: M.openByDefault, onchange: (e) => { M.openByDefault = e.target.checked; menuChanged(); } }), ' 預設展開')),
    h('div', { class: 'layers' },
      M.layers.map((l, i) => h('button', { class: 'btn' + (i === S.layer ? ' on' : ''), onclick: () => { S.layer = i; S.areaSel = -1; renderMenu(); } }, l.name || `第 ${i + 1} 層`)),
      h('button', { class: 'btn', onclick: () => { M.layers.push({ name: `第${M.layers.length + 1}層`, image: '', bg: L.bg, areas: presetAreas([2, 2], 2500, H).map((x, i) => ({ ...x, action: i === 3 ? { type: 'switch', label: '返回', layer: '0' } : { type: 'message', label: `選項${i + 1}`, text: `選項${i + 1}` } })) }); S.layer = M.layers.length - 1; S.areaSel = -1; menuChanged(); renderMenu(); } }, '＋ 新增一層')),
    h('div', { class: 'row' }, h('label', {}, '層名稱'), inp(L, 'name', {}, menuChanged),
      M.layers.length > 1 ? h('button', { class: 'btn sm danger', onclick: () => { if (confirm('刪除這一層？')) { M.layers.splice(S.layer, 1); S.layer = 0; menuChanged(); renderMenu(); } } }, '刪除這一層') : null),
    h('div', { class: 'row' }, h('label', {}, '底圖'),
      uploadBtn('上傳設計圖', 'image/png,image/jpeg', async (f) => { L.image = await uploadMenuImage(f, H); menuChanged(); renderMenu(); }),
      h('button', { class: 'btn', onclick: guard(async (e) => { e.target.disabled = true; L.image = await generateMenuImage(L, H, L.bg); menuChanged(); renderMenu(); }) }, '用格子文字產生底圖'),
      h('input', { type: 'color', value: L.bg || '#c07b84', title: '產生底圖用的底色', oninput: (e) => { L.bg = e.target.value; saveMenu(); } }),
      h('span', { class: 'muted' }, `自動裁成 2500×${H}、壓到 1MB 以下`)),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, '快速切格：'),
      Object.entries(PRESETS[M.size === 'compact' ? 'compact' : 'large']).map(([n, p]) => h('button', {
        class: 'btn sm', onclick: () => {
          const old = L.areas;
          L.areas = presetAreas(p, 2500, H).map((x, i) => ({ ...x, action: old[i] ? old[i].action : { type: 'message', label: `按鈕${i + 1}`, text: `按鈕${i + 1}` } }));
          S.areaSel = 0; menuChanged(); renderMenu();
        },
      }, n))),
    areaEditor({ W: 2500, H, image: L.image, areas: L.areas, selected: S.areaSel, onSelect: (i) => { S.areaSel = i; renderMenu(); }, onChange: menuChanged }),
    h('div', { class: 'muted', style: { marginTop: '6px' } }, '在圖上拖曳畫出新格子；拖曳格子可移動，右下角可調整大小。點格子設定動作。'),
    a ? h('div', { class: 'sub' }, h('b', {}, `格子 ${S.areaSel + 1} 的動作`),
      actionEd(a.action, 'richmenu', { layers: M.layers, onChange: menuChanged, onRemove: () => { L.areas.splice(S.areaSel, 1); S.areaSel = -1; menuChanged(); renderMenu(); } }),
      areaNumbers(a, 2500, H, menuChanged),
      h('div', { class: 'muted' }, '「貼標籤」：好友點了自動貼上標籤，可再用來分眾推播或指派專屬選單。「切換到其他層」也能同時貼標籤。')) : null);

  const T = M.target = M.target || { mode: 'default', tag: '' };
  const pubAt = h('input', { type: 'datetime-local' });
  const unpubAt = h('input', { type: 'datetime-local' });
  const pub = h('div', { class: 'card' },
    h('h3', {}, '發布'),
    M.published ? h('div', { class: 'row' }, h('span', { class: 'status done' }, `已上架 ${fmtTime(M.published.at)}`)) : null,
    h('div', { class: 'row' },
      h('label', {}, h('input', { type: 'radio', name: 'mt', checked: T.mode !== 'tag', onchange: () => { T.mode = 'default'; menuChanged(); renderMenu(); } }), ' 所有好友（預設選單）'),
      h('label', {}, h('input', { type: 'radio', name: 'mt', checked: T.mode === 'tag', onchange: () => { T.mode = 'tag'; menuChanged(); renderMenu(); } }), ' 只給特定標籤（分眾選單）')),
    T.mode === 'tag' ? h('div', { class: 'row' }, h('label', {}, '標籤'), inp(T, 'tag', { placeholder: '如 VIP（多個用逗號，符合任一）' }, saveMenu),
      h('div', { class: 'muted' }, '已有標籤的好友立即換上；之後被貼上這個標籤的好友也會自動換上。')) : null,
    h('div', { class: 'row' }, h('label', {}, '排程上架'), pubAt),
    h('div', { class: 'row' }, h('label', {}, '排程下架'), unpubAt),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn primary', onclick: guard(async (e) => {
          await api('POST', '/api/menus', M);
          e.target.disabled = true;
          try {
            const r = await api('POST', `/api/menus/${M.id}/publish`, { publishAt: pubAt.value ? new Date(pubAt.value).toISOString() : null, unpublishAt: unpubAt.value ? new Date(unpubAt.value).toISOString() : null });
            toast(r.published ? '已上架到 LINE' : '已排程');
          } finally { e.target.disabled = false; }
          await loadMenus(); renderMenu();
        }),
      }, pubAt.value ? '排程' : '上架／排程'),
      M.published ? h('button', { class: 'btn', onclick: guard(async () => { if (!confirm('從 LINE 下架這個選單？')) return; await api('POST', `/api/menus/${M.id}/unpublish`); toast('已下架'); await loadMenus(); renderMenu(); }) }, '立即下架') : null,
      h('button', { class: 'btn danger', onclick: guard(async () => { if (!confirm('刪除這個圖文選單（若已上架會一併下架）？')) return; await api('DELETE', `/api/menus/${M.id}`); S.menu = null; await loadMenus(); renderMenu(); }) }, '刪除')),
    h('div', { class: 'muted' }, '上架時會建立每一層的選單與別名（alias），格子的「切換到其他層」就會在好友手機上換頁。'));

  const right = h('div', {}, h('div', { class: 'phone', id: 'menu-phone' }), pub);
  root.replaceChildren(list, h('div', { class: 'grid' }, editor, right));
  renderMenuPreview();
}
function renderMenuPreview() {
  const phone = $('#menu-phone');
  if (!phone || !S.menu) return;
  const M = S.menu, L = M.layers[S.layer], H = menuH(M);
  const img = h('div', { class: 'area-ed', style: { aspectRatio: `2500 / ${H}`, backgroundImage: L.image ? `url("${L.image}")` : '', cursor: 'pointer', borderRadius: 0 } },
    L.areas.map((a, i) => h('div', {
      class: 'a', style: { left: `${(a.x / 2500) * 100}%`, top: `${(a.y / H) * 100}%`, width: `${(a.w / 2500) * 100}%`, height: `${(a.h / H) * 100}%`, background: L.image ? 'transparent' : '', border: L.image ? '1px dashed #fff8' : '', color: L.image ? 'transparent' : '' },
      title: (a.action && a.action.label) || '',
      onclick: () => {
        if (a.action && a.action.type === 'switch') { S.layer = Number(a.action.layer) || 0; S.areaSel = -1; renderMenu(); }
        else { S.areaSel = i; renderMenu(); }
      },
    }, (a.action && a.action.label) || `${i + 1}`)));
  phone.replaceChildren(h('div', { class: 'msgs' }, h('div', { class: 'muted', style: { color: '#fff' } }, '預覽：點「切換到其他層」的格子可以換頁')),
    h('div', { class: 'pv-menu' }, img, h('div', { class: 'mbar' }, `${M.chatBarText || '選單'} ▾`)));
}

// ---------- 好友與標籤 ----------
async function renderUsers() {
  const root = $('#tab-users');
  if (!S.acc) { root.replaceChildren(h('div', { class: 'card' }, '請先到「帳號設定」新增官方帳號。')); return; }
  const users = await api('GET', `/api/users?account=${S.acc}`);
  const F = renderUsers.f || (renderUsers.f = { tag: '', q: '', picked: new Set() });
  const shown = users.filter((u) => (!F.tag || u.tags.includes(F.tag)) && (!F.q || (u.name || '').includes(F.q) || u.id.includes(F.q)));
  const tagInput = h('input', { type: 'text', placeholder: '標籤（逗號分隔）' });
  const bulk = (mode) => guard(async () => {
    const tags = Builder.splitTags(tagInput.value);
    if (!tags.length || !F.picked.size) throw new Error('請勾選好友並輸入標籤');
    await api('POST', '/api/users/tags', { account: S.acc, userIds: [...F.picked], [mode]: tags });
    toast('已更新標籤');
    await refreshTags();
    renderUsers();
  });
  root.replaceChildren(
    h('div', { class: 'card' },
      h('h3', {}, `好友（${users.filter((u) => u.followed !== false).length} 位有效 / 共 ${users.length}）`, h('span', { class: 'sp' }),
        h('button', { class: 'btn sm', onclick: guard(async (e) => { e.target.disabled = true; const r = await api('POST', '/api/users/sync', { account: S.acc }); toast(`同步完成：${r.total} 位，新增 ${r.added}`); renderUsers(); }) }, '從 LINE 同步好友名單')),
      h('div', { class: 'muted' }, '好友加入、傳訊息或點按鈕時會自動記錄。「同步」需要認證／進階帳號才能使用 LINE 的好友名單 API。'),
      h('div', { class: 'row' },
        h('select', { onchange: (e) => { F.tag = e.target.value; renderUsers(); } }, h('option', { value: '' }, '全部標籤'), S.tags.map((t) => h('option', { value: t.tag, selected: F.tag === t.tag }, `${t.tag}（${t.n}）`))),
        h('input', { type: 'text', placeholder: '搜尋名稱或 userId', value: F.q, onchange: (e) => { F.q = e.target.value; renderUsers(); } }),
        h('span', { class: 'muted' }, `已勾選 ${F.picked.size}`), tagInput,
        h('button', { class: 'btn', onclick: bulk('add') }, '貼標籤'), h('button', { class: 'btn', onclick: bulk('remove') }, '移除標籤')),
      h('table', {},
        h('tr', {}, h('th', {}, h('input', { type: 'checkbox', onchange: (e) => { shown.forEach((u) => (e.target.checked ? F.picked.add(u.id) : F.picked.delete(u.id))); renderUsers(); } })), h('th', {}, '好友'), h('th', {}, '標籤'), h('th', {}, '最後互動'), h('th', {}, '狀態')),
        shown.slice(0, 500).map((u) => h('tr', {},
          h('td', {}, h('input', { type: 'checkbox', checked: F.picked.has(u.id), onchange: (e) => { e.target.checked ? F.picked.add(u.id) : F.picked.delete(u.id); renderUsers(); } })),
          h('td', {}, h('div', {}, u.name || '（未知名稱）'), h('code', { title: '點一下複製', style: { cursor: 'pointer', fontSize: '11px' }, onclick: () => { navigator.clipboard.writeText(u.id); toast('已複製 userId'); } }, u.id)),
          h('td', {}, h('div', { class: 'chips' }, u.tags.map((t) => h('span', { class: 'chip' }, t, h('button', { onclick: guard(async () => { await api('POST', '/api/users/tags', { account: S.acc, userIds: [u.id], remove: [t] }); await refreshTags(); renderUsers(); }) }, '×'))))),
          h('td', { class: 'muted' }, fmtTime(u.lastSeen || u.since)),
          h('td', {}, u.followed === false ? h('span', { class: 'status failed' }, '已封鎖') : h('span', { class: 'status done' }, '好友'))))),
      shown.length > 500 ? h('div', { class: 'muted' }, `只顯示前 500 位（共 ${shown.length}）`) : null));
}

// ---------- 範本與自動回覆 ----------
function renderAuto() {
  const root = $('#tab-auto');
  const acc = S.accounts.find((a) => a.id === S.acc);
  const tplOpts = { '': '（不使用）', ...Object.fromEntries(S.templates.map((t) => [t.id, t.name])) };
  const tpls = h('div', { class: 'card' },
    h('h3', {}, `訊息範本（${S.templates.length}）`),
    h('div', { class: 'muted' }, '在「訊息與推播」編好訊息後按「另存新範本」。範本可跨帳號使用，也能當歡迎訊息與自動回覆。'),
    S.templates.map((t) => h('div', { class: 'list-item' }, h('b', {}, t.name), h('span', { class: 'muted' }, `${t.messages.length} 則 · ${fmtTime(t.updatedAt)}`), h('span', { class: 'sp' }),
      h('button', { class: 'btn sm', onclick: () => loadTemplate(t) }, '載入編輯'),
      h('button', { class: 'btn sm danger', onclick: guard(async () => { if (!confirm(`刪除範本「${t.name}」？`)) return; await api('DELETE', `/api/templates/${t.id}`); await loadTemplates(); renderAuto(); }) }, '刪除'))));
  if (!acc) { root.replaceChildren(tpls, h('div', { class: 'card' }, '新增官方帳號後即可設定歡迎訊息與自動回覆。')); return; }
  const A = { welcomeTemplateId: acc.welcomeTemplateId || '', autoReplies: structuredClone(acc.autoReplies || []) };
  const rules = h('div', {});
  const drawRules = () => rules.replaceChildren(...A.autoReplies.map((r, i) => h('div', { class: 'action-ed' },
    inp(r, 'keyword', { placeholder: '關鍵字' }, () => {}),
    h('label', {}, h('input', { type: 'checkbox', checked: !!r.exact, onchange: (e) => { r.exact = e.target.checked; } }), ' 完全相符'),
    sel(r, 'templateId', tplOpts, () => {}),
    inp(r, 'tags', { placeholder: '同時貼標籤（選填）' }, () => {}),
    h('button', { class: 'btn sm danger', onclick: () => { A.autoReplies.splice(i, 1); drawRules(); } }, '刪除'))));
  drawRules();
  root.replaceChildren(tpls, h('div', { class: 'card' },
    h('h3', {}, `${acc.name}：歡迎訊息與關鍵字自動回覆`),
    h('div', { class: 'row' }, h('label', {}, '歡迎訊息'), sel(A, 'welcomeTemplateId', tplOpts, () => {}), h('span', { class: 'muted' }, '好友加入時自動回覆（記得關閉 LINE 後台內建的加入好友歡迎訊息，避免重複）')),
    h('div', { style: { marginTop: '10px' } }, h('b', {}, '關鍵字自動回覆')),
    rules,
    h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => { A.autoReplies.push({ keyword: '', exact: false, templateId: '', tags: '' }); drawRules(); } }, '＋ 新增規則'),
      h('button', { class: 'btn primary', onclick: guard(async () => { await api('POST', '/api/accounts', { id: acc.id, ...A }); await loadAccounts(); toast('已儲存'); renderAuto(); }) }, '儲存'))));
}

// ---------- 成效與排程 ----------
async function renderStats() {
  const root = $('#tab-stats');
  if (!S.acc) { root.replaceChildren(h('div', { class: 'card' }, '請先到「帳號設定」新增官方帳號。')); return; }
  const [st, jobs] = await Promise.all([api('GET', `/api/stats?account=${S.acc}`), api('GET', `/api/jobs?account=${S.acc}`)]);
  const clickTable = (items) => {
    if (!items.length) return h('div', { class: 'muted' }, '尚無點擊');
    const max = Math.max(...items.map((x) => x.clicks));
    return h('table', {}, h('tr', {}, h('th', {}, '按鈕／格子'), h('th', {}, '點擊'), h('th', {}, '不重複人數'), h('th', { style: { width: '30%' } }, '')),
      items.map((x) => h('tr', {}, h('td', {}, x.key), h('td', {}, x.clicks), h('td', {}, x.users || '—'), h('td', {}, h('div', { class: 'bar', style: { width: `${(x.clicks / max) * 100}%` } })))));
  };
  root.replaceChildren(
    h('div', { class: 'card' },
      h('h3', {}, '總覽'),
      [['有效好友', st.friends], ['已封鎖', st.blocked], ['30 天新加入', st.follows30], ['30 天封鎖', st.unfollows30], ['30 天點擊', st.clicks30]].map(([k, v]) => h('div', { class: 'stat' }, h('b', {}, v), k)),
      h('div', { class: 'row' }, h('button', {
        class: 'btn sm', onclick: guard(async (e) => {
          const q = await api('GET', `/api/accounts/${S.acc}/quota`);
          e.target.replaceWith(h('span', {}, `本月推播額度：${q.type === 'none' ? '無上限' : q.value} · 已使用：${q.totalUsage}`));
        }),
      }, '查詢本月推播額度'))),
    h('div', { class: 'card' }, h('h3', {}, '標籤分布'),
      st.tags.length ? h('table', {}, st.tags.map((t) => h('tr', {}, h('td', { style: { width: '30%' } }, t.tag), h('td', { style: { width: '80px' } }, t.n), h('td', {}, h('div', { class: 'bar', style: { width: `${(t.n / st.tags[0].n) * 100}%` } }))))) : h('div', { class: 'muted' }, '還沒有標籤')),
    h('div', { class: 'card' }, h('h3', {}, '排程'),
      jobs.length ? jobs.map((j) => h('div', { class: 'list-item' }, h('span', { class: 'status ' + j.status }, { pending: '等待中', running: '執行中', done: '完成', failed: '失敗' }[j.status]),
        h('b', {}, j.title || j.type), h('span', { class: 'muted' }, fmtTime(j.at)), j.error ? h('span', { class: 'muted' }, j.error) : null, h('span', { class: 'sp' }),
        j.status === 'pending' ? h('button', { class: 'btn sm danger', onclick: guard(async () => { await api('DELETE', `/api/jobs/${j.id}`); renderStats(); }) }, '取消') : null)) : h('div', { class: 'muted' }, '沒有排程')),
    h('div', { class: 'card' }, h('h3', {}, '推播成效（每顆按鈕的點擊）'),
      st.campaigns.length ? st.campaigns.map((c) => h('details', { class: 'sub' },
        h('summary', {}, h('b', {}, c.name), ' ', h('span', { class: 'status ' + c.status }, c.status === 'sent' ? '已送出' : c.status === 'failed' ? '失敗' : '傳送中'),
          h('span', { class: 'muted' }, ` ${fmtTime(c.ts)} · ${{ broadcast: '全部好友', segment: '分眾', test: '測試' }[c.mode] || ''} · ${c.recipients} 人 · ${c.items.reduce((s, x) => s + x.clicks, 0)} 次點擊`)),
        c.error ? h('div', { class: 'muted' }, c.error) : null, clickTable(c.items))) : h('div', { class: 'muted' }, '還沒有推播紀錄')),
    h('div', { class: 'card' }, h('h3', {}, '圖文選單成效（每一格的點擊）'),
      st.menus.length ? st.menus.map((m) => h('details', { class: 'sub', open: true }, h('summary', {}, h('b', {}, m.name)), clickTable(m.items))) : h('div', { class: 'muted' }, '還沒有圖文選單')),
    ...(st.keywords.length ? [h('div', { class: 'card' }, h('h3', {}, '關鍵字觸發'), clickTable(st.keywords))] : []));
}

// ---------- 帳號設定 ----------
function renderSettings() {
  const root = $('#tab-settings');
  const form = { name: '', token: '', secret: '' };
  root.replaceChildren(
    h('div', { class: 'card' },
      h('h3', {}, '官方帳號'),
      S.accounts.length ? S.accounts.map((a) => h('div', { class: 'list-item', style: { flexWrap: 'wrap' } },
        h('b', {}, a.name), h('span', { class: 'muted' }, a.basicId || ''), h('span', { class: 'sp' }),
        h('div', { style: { width: '100%' } }, h('span', { class: 'muted' }, 'Webhook URL：'),
          h('code', {}, S.config.webhookBase ? S.config.webhookBase + a.id : `（設定 PUBLIC_URL 後顯示）/webhook/${a.id}`)),
        h('button', { class: 'btn sm danger', onclick: guard(async () => { if (!confirm(`從工具移除「${a.name}」？（不影響 LINE 上的帳號）`)) return; await api('DELETE', `/api/accounts/${a.id}`); await loadAccounts(); renderAll(); }) }, '移除'))) : h('div', { class: 'muted' }, '尚未新增官方帳號。')),
    h('div', { class: 'card' },
      h('h3', {}, '新增官方帳號'),
      h('div', { class: 'row' }, h('label', {}, '名稱'), inp(form, 'name', { placeholder: '選填，預設用 LINE 上的名稱' }, () => {})),
      h('div', { class: 'row' }, h('label', {}, 'Access token'), inp(form, 'token', { type: 'password', placeholder: 'Channel access token (long-lived)' }, () => {})),
      h('div', { class: 'row' }, h('label', {}, 'Channel secret'), inp(form, 'secret', { type: 'password' }, () => {})),
      h('button', { class: 'btn primary', onclick: guard(async () => { const a = await api('POST', '/api/accounts', form); S.acc = a.id; store.set('lb.account', a.id); await loadAccounts(); toast(`已新增：${a.name}`); renderAll(); }) }, '新增並驗證'),
      h('ol', { class: 'muted' },
        h('li', {}, '到 LINE Developers Console（developers.line.biz）選擇你的官方帳號的 Messaging API channel。'),
        h('li', {}, '在「Basic settings」複製 Channel secret；在「Messaging API」頁最下方發行 Channel access token (long-lived)。'),
        h('li', {}, '新增後，把上面顯示的 Webhook URL 貼到「Messaging API → Webhook URL」，開啟 Use webhook，按 Verify。'),
        h('li', {}, '到 LINE 官方帳號管理後台 → 回應設定：開啟 Webhook；若要用本工具的歡迎訊息／自動回覆，請關閉後台的「加入好友的歡迎訊息」與「自動回應訊息」。'))),
    h('div', { class: 'card' },
      h('h3', {}, '伺服器狀態'),
      h('div', {}, 'PUBLIC_URL：', S.config.publicUrl ? h('code', {}, S.config.publicUrl) : h('b', { style: { color: 'var(--err)' } }, '未設定')),
      h('div', { class: 'muted' }, 'LINE 只接受 HTTPS 公開網址的圖片與 Webhook，正式使用請把工具部署到有網域的主機並設定 PUBLIC_URL。')));
}

// ---------- 載入與切換 ----------
async function loadAccounts() {
  S.accounts = await api('GET', '/api/accounts');
  if (!S.accounts.find((a) => a.id === S.acc)) S.acc = S.accounts[0] ? S.accounts[0].id : null;
  store.set('lb.account', S.acc);
  $('#account').replaceChildren(...(S.accounts.length ? S.accounts.map((a) => h('option', { value: a.id, selected: a.id === S.acc }, a.name)) : [h('option', { value: '' }, '（尚未新增）')]));
}
async function loadTemplates() { S.templates = await api('GET', '/api/templates'); }
async function refreshTags() { S.tags = S.acc ? (await api('GET', `/api/stats?account=${S.acc}`)).tags : []; }

let current = 'compose';
const RENDER = { compose: renderCompose, menu: renderMenu, users: renderUsers, auto: renderAuto, stats: renderStats, settings: renderSettings };
function showTab(t) {
  current = t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${t}`));
  guard(RENDER[t])();
}
async function renderAll() {
  await Promise.all([refreshTags(), loadMenus()]);
  showTab(current);
}

$('#tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); });
$('#account').addEventListener('change', guard(async (e) => { S.acc = e.target.value; store.set('lb.account', S.acc); S.menu = null; renderUsers.f = null; await renderAll(); }));

guard(async () => {
  S.config = await api('GET', '/api/config');
  await Promise.all([loadAccounts(), loadTemplates()]);
  const warn = [];
  if (!S.config.publicUrl) warn.push('伺服器尚未設定 PUBLIC_URL：可以編輯與預覽，但 LINE 需要 HTTPS 公開網址才能顯示圖片、接收 Webhook 與追蹤點擊。');
  if (!S.accounts.length) { warn.push('請先到「帳號設定」新增 LINE 官方帳號。'); current = 'settings'; }
  $('#notice').textContent = warn.join(' ');
  await renderAll();
})();
