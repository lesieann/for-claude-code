// 業務邏輯：分眾、追蹤連結、推播、圖文選單發布、Webhook、排程
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const Line = require('./line');
const Builder = require('../public/builder');

const PUBLIC_URL = () => (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

function account(id) {
  const a = store.db.accounts.find((x) => x.id === id);
  if (!a) throw Object.assign(new Error('找不到這個官方帳號'), { status: 404 });
  return a;
}
const client = (acc) => Line(acc.token);

// ---------- 分眾 ----------
// target = { include: [tag], logic: 'and'|'or', exclude: [tag] }
function segment(accountId, target = {}) {
  const include = Builder.splitTags(target.include);
  const exclude = Builder.splitTags(target.exclude);
  return Object.entries(store.usersOf(accountId))
    .filter(([, u]) => u.followed !== false)
    .filter(([, u]) => {
      if (exclude.some((t) => u.tags.includes(t))) return false;
      if (!include.length) return true;
      return target.logic === 'or' ? include.some((t) => u.tags.includes(t)) : include.every((t) => u.tags.includes(t));
    })
    .map(([id]) => id);
}

// ---------- 追蹤連結 ----------
const sign = (secret, linkId, userId) => crypto.createHmac('sha256', secret).update(`${linkId}:${userId}`).digest('hex').slice(0, 16);

// 把訊息裡的 uri 動作換成 /r/<id> 追蹤網址，postback 加上活動代碼；也移除 _ 開頭的內部欄位
function prepare(messages, { acc, campaign, userId, track }) {
  const base = PUBLIC_URL();
  const walk = (o) => {
    if (Array.isArray(o)) return o.map(walk);
    if (!o || typeof o !== 'object') return o;
    const out = {};
    for (const [k, v] of Object.entries(o)) if (!k.startsWith('_')) out[k] = walk(v);
    const field = o.type === 'uri' ? (o.linkUri !== undefined ? 'linkUri' : 'uri') : null;
    if (field && track && base && /^https?:/i.test(out[field])) {
      const info = o._track || {};
      const id = crypto.createHash('sha1').update(`${acc.id}|${campaign}|${out[field]}|${info.key}`).digest('hex').slice(0, 12);
      if (!store.db.links[id]) {
        store.db.links[id] = { url: out[field], key: info.key || out.label || out[field], tags: info.tags || [], campaign, account: acc.id };
        store.save();
      }
      out[field] = `${base}/r/${id}` + (userId ? `?u=${encodeURIComponent(userId)}&s=${sign(acc.secret, id, userId)}` : '');
    }
    if ((o.type === 'postback' || o.type === 'richmenuswitch') && campaign && out.data && !/(^|&)c=/.test(out.data)) {
      out.data = `${out.data}&c=${encodeURIComponent(campaign)}`.slice(0, 300);
    }
    return out;
  };
  return walk(messages);
}

function handleRedirect(id, query) {
  const link = store.db.links[id];
  if (!link) return null;
  const acc = store.db.accounts.find((a) => a.id === link.account);
  let userId = null;
  if (acc && query.u && query.s === sign(acc.secret, id, query.u)) userId = query.u;
  store.logEvent({ account: link.account, campaign: link.campaign, kind: 'link', key: link.key, userId });
  if (userId && link.tags.length) onTagsAdded(acc, userId, store.addTags(acc.id, userId, link.tags)).catch(console.error);
  return link.url;
}

// ---------- 推播 ----------
// payload = { account, name, messages, mode: 'broadcast'|'segment'|'test', target, testUserIds, track }
async function send(payload) {
  const acc = account(payload.account);
  const line = client(acc);
  const campaign = store.uid();
  const record = { id: campaign, account: acc.id, name: payload.name || '未命名推播', mode: payload.mode, target: payload.target || null, ts: Date.now(), recipients: 0, status: 'sending' };
  store.db.campaigns.push(record);
  store.save();
  const track = payload.track !== false;
  try {
    let ids;
    if (payload.mode === 'broadcast') {
      await line.broadcast(prepare(payload.messages, { acc, campaign, track }));
      const users = Object.values(store.usersOf(acc.id)).filter((u) => u.followed !== false);
      record.recipients = users.length;
      record.note = '全部好友（人數以工具已知好友估算）';
    } else {
      ids = payload.mode === 'test' ? Builder.splitTags(payload.testUserIds) : segment(acc.id, payload.target);
      if (!ids.length) throw new Error('沒有符合條件的好友');
      const needPersonal = track && PUBLIC_URL() && hasUri(payload.messages);
      if (needPersonal) {
        // 每人一個追蹤網址，點連結時才能知道是誰點的、自動貼標籤
        for (const uid of ids) await line.push(uid, prepare(payload.messages, { acc, campaign, userId: uid, track }));
      } else {
        await line.multicast(ids, prepare(payload.messages, { acc, campaign, track }));
      }
      record.recipients = ids.length;
    }
    record.status = 'sent';
  } catch (e) {
    record.status = 'failed';
    record.error = e.message;
    throw e;
  } finally {
    store.save();
  }
  return record;
}

const hasUri = (o) => JSON.stringify(o).includes('"type":"uri"');

// ---------- 圖文選單 ----------
const aliasIds = (menu) => menu.layers.map((_, i) => `lb${menu.id}-${i}`.toLowerCase().slice(0, 32));

function readUpload(url) {
  const name = path.basename(new URL(url, 'http://x').pathname);
  const file = path.join(store.UPLOAD_DIR, name);
  if (!fs.existsSync(file)) throw new Error('找不到選單底圖，請重新上傳：' + name);
  const ext = path.extname(name).toLowerCase();
  return { buf: fs.readFileSync(file), type: ext === '.png' ? 'image/png' : 'image/jpeg' };
}

async function publishMenu(menuId) {
  const menu = store.db.menus.find((m) => m.id === menuId);
  if (!menu) throw new Error('找不到圖文選單');
  const acc = account(menu.account);
  const line = client(acc);
  if (!menu.layers.length) throw new Error('至少需要一層');
  menu.layers.forEach((l, i) => { if (!l.image) throw new Error(`第 ${i + 1} 層還沒有底圖`); });

  const aliases = aliasIds(menu);
  const campaign = `menu:${menu.id}`;
  const defs = Builder.buildRichMenus(menu, aliases).map((d) => prepare(d, { acc, campaign, track: true }));
  const old = (menu.published && menu.published.richMenuIds) || [];

  const ids = [];
  try {
    for (let i = 0; i < defs.length; i++) {
      const { richMenuId } = await line.createRichMenu(defs[i]);
      ids.push(richMenuId);
      const img = readUpload(menu.layers[i].image);
      await line.uploadRichMenuImage(richMenuId, img.buf, img.type);
    }
    for (let i = 0; i < ids.length; i++) await line.upsertAlias(aliases[i], ids[i]);
  } catch (e) {
    for (const id of ids) await line.deleteRichMenu(id).catch(() => {});
    throw e;
  }

  const target = menu.target || { mode: 'default' };
  acc.menuRules = (acc.menuRules || []).filter((r) => r.menuId !== menu.id);
  if (target.mode === 'tag') {
    const tags = Builder.splitTags(target.tag);
    acc.menuRules.push({ menuId: menu.id, tags, richMenuId: ids[0] });
    const users = segment(acc.id, { include: tags, logic: 'or' });
    if (users.length) await line.bulkLink(users, ids[0]);
  } else {
    await line.setDefaultRichMenu(ids[0]);
  }
  for (const id of old) await line.deleteRichMenu(id).catch(() => {});
  menu.published = { richMenuIds: ids, aliases, at: Date.now(), target };
  store.save();
  return menu.published;
}

async function unpublishMenu(menuId) {
  const menu = store.db.menus.find((m) => m.id === menuId);
  if (!menu || !menu.published) return;
  const acc = account(menu.account);
  const line = client(acc);
  const { richMenuIds = [], aliases = [], target = {} } = menu.published;
  if (target.mode === 'tag') {
    const users = segment(acc.id, { include: target.tag, logic: 'or' });
    if (users.length) await line.bulkUnlink(users).catch(() => {});
  } else {
    const cur = await line.getDefaultRichMenu();
    if (cur.richMenuId && richMenuIds.includes(cur.richMenuId)) await line.clearDefaultRichMenu().catch(() => {});
  }
  for (const a of aliases) await line.deleteAlias(a);
  for (const id of richMenuIds) await line.deleteRichMenu(id).catch(() => {});
  acc.menuRules = (acc.menuRules || []).filter((r) => r.menuId !== menu.id);
  menu.published = null;
  store.save();
}

// 標籤新增後：如果有「分眾選單」規則，幫這位好友換上對應的選單
async function onTagsAdded(acc, userId, added) {
  if (!acc || !added.length) return;
  const rule = (acc.menuRules || []).find((r) => r.tags.some((t) => added.includes(t)));
  if (rule) await client(acc).linkRichMenu(userId, rule.richMenuId);
}

// ---------- Webhook ----------
async function templateMessages(id, acc, userId) {
  const t = store.db.templates.find((x) => x.id === id);
  if (!t) return null;
  return prepare(t.messages, { acc, campaign: `tpl:${t.id}`, userId, track: true });
}

async function handleWebhook(acc, body) {
  const line = client(acc);
  const users = store.usersOf(acc.id);
  for (const ev of body.events || []) {
    const userId = ev.source && ev.source.userId;
    if (!userId) continue;
    const u = users[userId] || (users[userId] = { tags: [], since: Date.now() });
    u.lastSeen = Date.now();
    try {
      if (ev.type === 'follow') {
        u.followed = true;
        try {
          const p = await line.profile(userId);
          u.name = p.displayName;
          u.picture = p.pictureUrl;
        } catch { /* 拿不到個人資料也沒關係 */ }
        store.logEvent({ account: acc.id, kind: 'follow', userId });
        if (acc.welcomeTemplateId && ev.replyToken) {
          const msgs = await templateMessages(acc.welcomeTemplateId, acc, userId);
          if (msgs) await line.reply(ev.replyToken, msgs);
        }
        const rule = (acc.menuRules || []).find((r) => r.tags.some((t) => u.tags.includes(t)));
        if (rule) await line.linkRichMenu(userId, rule.richMenuId);
      } else if (ev.type === 'unfollow') {
        u.followed = false;
        store.logEvent({ account: acc.id, kind: 'unfollow', userId });
      } else if (ev.type === 'postback') {
        u.followed = true;
        const p = new URLSearchParams(ev.postback.data || '');
        const campaign = p.get('c') || null;
        store.logEvent({ account: acc.id, kind: 'postback', key: p.get('k') || '按鈕', campaign, userId });
        await onTagsAdded(acc, userId, store.addTags(acc.id, userId, p.getAll('tag')));
        if (p.get('reply') && ev.replyToken) await line.reply(ev.replyToken, [{ type: 'text', text: p.get('reply') }]);
      } else if (ev.type === 'message') {
        u.followed = true;
        if (ev.message.type === 'text' && ev.replyToken) {
          const text = ev.message.text.trim();
          const rule = (acc.autoReplies || []).find((r) => (r.exact ? text === r.keyword : text.includes(r.keyword)));
          if (rule) {
            store.logEvent({ account: acc.id, kind: 'keyword', key: rule.keyword, userId });
            if (rule.tags) await onTagsAdded(acc, userId, store.addTags(acc.id, userId, Builder.splitTags(rule.tags)));
            const msgs = await templateMessages(rule.templateId, acc, userId);
            if (msgs) await line.reply(ev.replyToken, msgs);
          }
        }
      }
    } catch (e) {
      console.error('[webhook]', e.message);
    }
  }
  store.save();
}

async function syncFollowers(acc) {
  const line = client(acc);
  const ids = await line.followerIds();
  const users = store.usersOf(acc.id);
  let added = 0;
  for (const id of ids) {
    if (!users[id]) { users[id] = { tags: [], since: Date.now() }; added++; }
    users[id].followed = true;
    if (!users[id].name) {
      try { users[id].name = (await line.profile(id)).displayName; } catch { /* 略過 */ }
    }
  }
  store.save();
  return { total: ids.length, added };
}

// ---------- 排程 ----------
async function runJob(job) {
  if (job.type === 'send') await send(job.payload);
  else if (job.type === 'menu-publish') await publishMenu(job.menuId);
  else if (job.type === 'menu-unpublish') await unpublishMenu(job.menuId);
}

function startScheduler() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const job of store.db.jobs.filter((j) => j.status === 'pending' && j.at <= Date.now())) {
        job.status = 'running';
        try {
          await runJob(job);
          job.status = 'done';
        } catch (e) {
          job.status = 'failed';
          job.error = e.message;
        }
        job.finishedAt = Date.now();
        store.save();
      }
    } finally {
      busy = false;
    }
  }, 15000);
}

// ---------- 成效 ----------
function stats(accountId) {
  const events = store.db.events.filter((e) => e.account === accountId);
  const group = (list) => {
    const m = {};
    for (const e of list) {
      const g = (m[e.key] = m[e.key] || { key: e.key, clicks: 0, users: new Set() });
      g.clicks++;
      if (e.userId) g.users.add(e.userId);
    }
    return Object.values(m).map((g) => ({ key: g.key, clicks: g.clicks, users: g.users.size })).sort((a, b) => b.clicks - a.clicks);
  };
  const clicks = events.filter((e) => e.kind === 'link' || e.kind === 'postback');
  const campaigns = store.db.campaigns.filter((c) => c.account === accountId).slice(-50).reverse()
    .map((c) => ({ ...c, items: group(clicks.filter((e) => e.campaign === c.id)) }));
  const menus = store.db.menus.filter((m) => m.account === accountId)
    .map((m) => ({ id: m.id, name: m.name, items: group(clicks.filter((e) => e.campaign === `menu:${m.id}`)) }));
  const users = Object.values(store.usersOf(accountId));
  const tagCount = {};
  for (const u of users) if (u.followed !== false) for (const t of u.tags) tagCount[t] = (tagCount[t] || 0) + 1;
  const day = 86400000;
  const since = Date.now() - 30 * day;
  return {
    friends: users.filter((u) => u.followed !== false).length,
    blocked: users.filter((u) => u.followed === false).length,
    follows30: events.filter((e) => e.kind === 'follow' && e.ts > since).length,
    unfollows30: events.filter((e) => e.kind === 'unfollow' && e.ts > since).length,
    clicks30: clicks.filter((e) => e.ts > since).length,
    tags: Object.entries(tagCount).map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n),
    campaigns,
    menus,
    keywords: group(events.filter((e) => e.kind === 'keyword')),
  };
}

module.exports = { account, client, segment, prepare, handleRedirect, send, publishMenu, unpublishMenu, handleWebhook, syncFollowers, startScheduler, stats, onTagsAdded };
