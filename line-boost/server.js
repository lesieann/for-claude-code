// LINE Boost 工具伺服器：後台 API、LINE Webhook、追蹤轉址、圖片託管
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 讀取 .env（不依賴套件）
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const store = require('./lib/store');
const core = require('./lib/core');
const Line = require('./lib/line');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_UPLOAD = 200 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.svg': 'image/svg+xml',
};

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('檔案太大'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

function serveFile(res, file, cache) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', ...(cache ? { 'Cache-Control': 'public, max-age=86400' } : {}) });
  fs.createReadStream(file).pipe(res);
}

function authorized(req) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return true;
  const m = (req.headers.authorization || '').match(/^Basic (.+)$/);
  if (!m) return false;
  const [user, pass] = Buffer.from(m[1], 'base64').toString().split(/:(.*)/s);
  const a = Buffer.from(`${user}:${pass}`);
  const b = Buffer.from(`admin:${pw}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const publicUrl = () => (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const maskAccount = (a) => ({ ...a, token: a.token ? `…${a.token.slice(-6)}` : '', secret: a.secret ? `…${a.secret.slice(-4)}` : '' });
const safeName = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '');

// ---------- API ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

route('GET', '/api/config', async () => ({
  publicUrl: publicUrl(),
  webhookBase: publicUrl() ? `${publicUrl()}/webhook/` : '',
}));

// 官方帳號
route('GET', '/api/accounts', async () => store.db.accounts.map(maskAccount));
route('POST', '/api/accounts', async ({ body }) => {
  const acc = body.id ? core.account(body.id) : { id: store.uid(4), autoReplies: [], menuRules: [] };
  for (const k of ['name', 'welcomeTemplateId', 'autoReplies']) if (body[k] !== undefined) acc[k] = body[k];
  if (body.token && !body.token.startsWith('…')) acc.token = body.token.trim();
  if (body.secret && !body.secret.startsWith('…')) acc.secret = body.secret.trim();
  if (!acc.token || !acc.secret) throw Object.assign(new Error('請填 Channel access token 與 Channel secret'), { status: 400 });
  if (!body.id) {
    const info = await Line(acc.token).botInfo();
    acc.name = acc.name || info.displayName;
    acc.basicId = info.basicId;
    store.db.accounts.push(acc);
  }
  store.save();
  return maskAccount(acc);
});
route('DELETE', '/api/accounts/:id', async ({ params }) => {
  store.db.accounts = store.db.accounts.filter((a) => a.id !== params.id);
  store.save();
  return { ok: true };
});
route('GET', '/api/accounts/:id/quota', async ({ params }) => {
  const line = core.client(core.account(params.id));
  const [quota, used] = await Promise.all([line.quota(), line.consumption()]);
  return { ...quota, totalUsage: used.totalUsage };
});

// 檔案上傳（原始 body，副檔名用 ?ext=）
route('POST', '/api/upload', async ({ req, query }) => {
  const ext = ['jpg', 'jpeg', 'png', 'mp4'].includes(query.ext) ? query.ext : 'jpg';
  const buf = await readBody(req, MAX_UPLOAD);
  const name = `${Date.now().toString(36)}-${store.uid(4)}.${ext}`;
  fs.writeFileSync(path.join(store.UPLOAD_DIR, name), buf);
  return { url: `${publicUrl()}/uploads/${name}`, path: `/uploads/${name}`, size: buf.length };
});
// 熱區圖片：LINE 會依手機解析度向 baseUrl/1040、/700、/460、/300、/240 取圖
route('POST', '/api/imagemap/:id/:w', async ({ req, params }) => {
  if (!['1040', '700', '460', '300', '240'].includes(params.w)) throw Object.assign(new Error('寬度不正確'), { status: 400 });
  const buf = await readBody(req, 10 * 1024 * 1024);
  fs.writeFileSync(path.join(store.UPLOAD_DIR, `im-${safeName(params.id)}-${params.w}.jpg`), buf);
  return { baseUrl: `${publicUrl()}/imagemap/${safeName(params.id)}` };
});

// 推播
route('POST', '/api/send', async ({ body }) => {
  if (body.scheduleAt) {
    const job = { id: store.uid(), type: 'send', at: new Date(body.scheduleAt).getTime(), status: 'pending', title: body.name, account: body.account, payload: { ...body, scheduleAt: undefined } };
    if (!(job.at > Date.now())) throw Object.assign(new Error('排程時間必須在未來'), { status: 400 });
    store.db.jobs.push(job);
    store.save();
    return { scheduled: job };
  }
  return core.send(body);
});
route('POST', '/api/validate', async ({ body }) => {
  await core.client(core.account(body.account)).validate(core.prepare(body.messages, { acc: core.account(body.account), track: false }));
  return { ok: true };
});
route('POST', '/api/segment', async ({ body }) => ({ count: core.segment(body.account, body.target).length }));

// 好友與標籤
route('GET', '/api/users', async ({ query }) => Object.entries(store.usersOf(query.account)).map(([id, u]) => ({ id, ...u })).sort((a, b) => (b.lastSeen || b.since || 0) - (a.lastSeen || a.since || 0)));
route('POST', '/api/users/tags', async ({ body }) => {
  const acc = core.account(body.account);
  const users = store.usersOf(acc.id);
  for (const id of body.userIds || []) {
    const u = users[id];
    if (!u) continue;
    if (body.remove) u.tags = u.tags.filter((t) => !body.remove.includes(t));
    if (body.add) await core.onTagsAdded(acc, id, store.addTags(acc.id, id, body.add)).catch(() => {});
  }
  store.save();
  return { ok: true };
});
route('POST', '/api/users/sync', async ({ body }) => core.syncFollowers(core.account(body.account)));
route('POST', '/api/users/add', async ({ body }) => {
  const users = store.usersOf(core.account(body.account).id);
  for (const id of body.userIds || []) if (/^U[0-9a-f]{32}$/.test(id) && !users[id]) users[id] = { tags: [], followed: true, since: Date.now() };
  store.save();
  return { ok: true };
});

// 範本（跨帳號共用）
route('GET', '/api/templates', async () => store.db.templates);
route('POST', '/api/templates', async ({ body }) => {
  let t = body.id && store.db.templates.find((x) => x.id === body.id);
  if (!t) { t = { id: store.uid() }; store.db.templates.push(t); }
  Object.assign(t, { name: body.name || '未命名範本', model: body.model, messages: body.messages, updatedAt: Date.now() });
  store.save();
  return t;
});
route('DELETE', '/api/templates/:id', async ({ params }) => {
  store.db.templates = store.db.templates.filter((t) => t.id !== params.id);
  store.save();
  return { ok: true };
});

// 圖文選單
route('GET', '/api/menus', async ({ query }) => store.db.menus.filter((m) => m.account === query.account));
route('POST', '/api/menus', async ({ body }) => {
  let m = body.id && store.db.menus.find((x) => x.id === body.id);
  if (!m) { m = { id: store.uid(4), published: null }; store.db.menus.push(m); }
  for (const k of ['account', 'name', 'size', 'chatBarText', 'openByDefault', 'layers', 'target']) if (body[k] !== undefined) m[k] = body[k];
  m.updatedAt = Date.now();
  store.save();
  return m;
});
route('DELETE', '/api/menus/:id', async ({ params }) => {
  await core.unpublishMenu(params.id).catch(() => {});
  store.db.menus = store.db.menus.filter((m) => m.id !== params.id);
  store.db.jobs = store.db.jobs.filter((j) => j.menuId !== params.id || j.status !== 'pending');
  store.save();
  return { ok: true };
});
route('POST', '/api/menus/:id/publish', async ({ params, body }) => {
  const m = store.db.menus.find((x) => x.id === params.id);
  if (!m) throw Object.assign(new Error('找不到圖文選單'), { status: 404 });
  const out = {};
  for (const [type, at] of [['menu-publish', body.publishAt], ['menu-unpublish', body.unpublishAt]]) {
    if (!at) continue;
    const job = { id: store.uid(), type, menuId: m.id, account: m.account, title: `${type === 'menu-publish' ? '上架' : '下架'}：${m.name}`, at: new Date(at).getTime(), status: 'pending' };
    store.db.jobs.push(job);
    out[type] = job;
  }
  store.save();
  if (!body.publishAt) out.published = await core.publishMenu(m.id);
  return out;
});
route('POST', '/api/menus/:id/unpublish', async ({ params }) => {
  await core.unpublishMenu(params.id);
  return { ok: true };
});
route('GET', '/api/richmenus/line', async ({ query }) => core.client(core.account(query.account)).listRichMenus());

// 排程與成效
route('GET', '/api/jobs', async ({ query }) => store.db.jobs.filter((j) => j.account === query.account).map(({ payload, ...j }) => j).sort((a, b) => b.at - a.at));
route('DELETE', '/api/jobs/:id', async ({ params }) => {
  store.db.jobs = store.db.jobs.filter((j) => !(j.id === params.id && j.status === 'pending'));
  store.save();
  return { ok: true };
});
route('GET', '/api/stats', async ({ query }) => core.stats(query.account));

// ---------- HTTP ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  const query = Object.fromEntries(url.searchParams);
  try {
    // 不需登入：LINE Webhook、追蹤轉址、對外圖片
    const wh = p.match(/^\/webhook\/([\w-]+)$/);
    if (wh && req.method === 'POST') {
      const acc = store.db.accounts.find((a) => a.id === wh[1]);
      const raw = await readBody(req);
      if (!acc || !Line.verifySignature(acc.secret, raw, req.headers['x-line-signature'])) return json(res, 401, { error: 'bad signature' });
      json(res, 200, {});
      core.handleWebhook(acc, JSON.parse(raw.toString('utf8'))).catch((e) => console.error('[webhook]', e));
      return;
    }
    const r = p.match(/^\/r\/(\w+)$/);
    if (r) {
      const target = core.handleRedirect(r[1], query);
      res.writeHead(target ? 302 : 404, target ? { Location: target } : {});
      return res.end();
    }
    const up = p.match(/^\/uploads\/([\w.-]+)$/);
    if (up) return serveFile(res, path.join(store.UPLOAD_DIR, up[1]), true);
    const im = p.match(/^\/imagemap\/([\w-]+)\/(\d+)$/);
    if (im) {
      res.setHeader('Content-Type', 'image/jpeg');
      const file = path.join(store.UPLOAD_DIR, `im-${im[1]}-${im[2]}.jpg`);
      return serveFile(res, fs.existsSync(file) ? file : path.join(store.UPLOAD_DIR, `im-${im[1]}-1040.jpg`), true);
    }

    if (!authorized(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="LINE Boost Tool", charset="UTF-8"' });
      return res.end('請登入（帳號 admin）');
    }

    if (p.startsWith('/api/')) {
      for (const rt of routes) {
        const m = rt.method === req.method && p.match(rt.re);
        if (!m) continue;
        let body = {};
        if (req.method !== 'GET' && !p.startsWith('/api/upload') && !p.startsWith('/api/imagemap/')) {
          const raw = await readBody(req);
          body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
        }
        return json(res, 200, await rt.fn({ req, params: m.groups || {}, query, body }));
      }
      return json(res, 404, { error: '找不到 API' });
    }

    const file = path.normalize(path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    return serveFile(res, file);
  } catch (e) {
    if (!res.headersSent) json(res, e.status && e.status < 500 ? e.status : 500, { error: e.message });
    else console.error(e);
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`LINE Boost 工具已啟動：http://localhost:${PORT}`);
    if (!publicUrl()) console.log('⚠ 尚未設定 PUBLIC_URL：圖片、Webhook、點擊追蹤需要對外 HTTPS 網址才能運作');
    if (!process.env.ADMIN_PASSWORD) console.log('⚠ 尚未設定 ADMIN_PASSWORD：後台目前不需登入');
  });
  core.startScheduler();
}

module.exports = server;
