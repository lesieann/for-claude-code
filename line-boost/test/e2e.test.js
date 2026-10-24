// 端對端測試：啟動伺服器、把 LINE API 換成假的，驗證推播、分眾、Webhook 貼標籤、追蹤連結、圖文選單發布
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-'));
process.env.PUBLIC_URL = 'https://boost.example.com';
delete process.env.ADMIN_PASSWORD;

const realFetch = global.fetch;
const calls = [];
global.fetch = async (url, opt = {}) => {
  url = String(url);
  if (!url.startsWith('https://api')) return realFetch(url, opt);
  const body = opt.body && !Buffer.isBuffer(opt.body) ? JSON.parse(opt.body) : opt.body;
  calls.push({ method: opt.method, path: url.replace(/^https:\/\/api(-data)?\.line\.me/, ''), body });
  let res = {};
  if (url.endsWith('/v2/bot/info')) res = { displayName: '測試商店', basicId: '@test' };
  if (url.endsWith('/v2/bot/richmenu')) res = { richMenuId: `richmenu-${calls.length}` };
  if (url.includes('/v2/bot/profile/')) res = { displayName: '小明' };
  return new Response(JSON.stringify(res), { status: 200 });
};

const Builder = require('../public/builder');
const server = require('../server');
let base;
const api = async (method, p, body) => {
  const r = await realFetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
};
const U1 = 'U' + '1'.repeat(32);
const U2 = 'U' + '2'.repeat(32);
const SECRET = 'secret123';
let acc;

async function webhook(events) {
  const raw = JSON.stringify({ events });
  const sig = crypto.createHmac('sha256', SECRET).update(raw).digest('base64');
  const r = await realFetch(`${base}/webhook/${acc.id}`, { method: 'POST', headers: { 'x-line-signature': sig }, body: raw });
  await new Promise((ok) => setTimeout(ok, 50));
  return r.status;
}

test.before(async () => {
  await new Promise((ok) => server.listen(0, ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('builder 產生所有訊息格式', () => {
  const msgs = Builder.buildMessages({
    altText: '測試',
    messages: [
      { type: 'text', text: 'hi' },
      { type: 'image', url: 'https://x/a.jpg', preview: 'https://x/b.jpg' },
      { type: 'imagemap', baseUrl: 'https://x/im/1', height: 700, areas: [{ x: 0, y: 0, w: 520, h: 700, action: { type: 'uri', uri: 'https://shop' } }] },
      { type: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', title: '影片' },
      { type: 'flex', bubbles: [{ title: 'A', buttons: [{ type: 'tag', label: '我要', tags: 'VIP, 新客' }] }, { title: 'B' }] },
    ],
    quickReply: [{ action: { type: 'share', label: '分享', text: '快來看' } }],
  });
  assert.equal(msgs.length, 5);
  assert.equal(msgs[2].actions[0].linkUri, 'https://shop');
  assert.equal(msgs[3].contents.hero.contents[0].url, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(msgs[4].contents.type, 'carousel');
  const pb = msgs[4].contents.contents[0].footer.contents[0].action;
  assert.deepEqual(new URLSearchParams(pb.data).getAll('tag'), ['VIP', '新客']);
  assert.match(msgs[4].quickReply.items[0].action.uri, /^https:\/\/line\.me\/R\/share\?text=/);
  assert.ok(!JSON.stringify(Builder.clean(msgs)).includes('_track'));
});

test('新增帳號、Webhook 收好友並自動貼標籤、分眾推播與追蹤連結', async () => {
  acc = await api('POST', '/api/accounts', { token: 'tok', secret: SECRET });
  assert.equal(acc.name, '測試商店');

  // 簽章錯誤要拒絕
  const bad = await realFetch(`${base}/webhook/${acc.id}`, { method: 'POST', headers: { 'x-line-signature': 'nope' }, body: '{"events":[]}' });
  assert.equal(bad.status, 401);

  assert.equal(await webhook([
    { type: 'follow', replyToken: 'r1', source: { userId: U1 } },
    { type: 'follow', replyToken: 'r2', source: { userId: U2 } },
    { type: 'postback', replyToken: 'r3', source: { userId: U1 }, postback: { data: 'k=VIP專區&tag=VIP&reply=歡迎VIP' } },
  ]), 200);
  const users = await api('GET', `/api/users?account=${acc.id}`);
  assert.equal(users.find((u) => u.id === U1).name, '小明');
  assert.deepEqual(users.find((u) => u.id === U1).tags, ['VIP']);
  assert.ok(calls.some((c) => c.path === '/v2/bot/message/reply' && c.body.messages[0].text === '歡迎VIP'));

  assert.equal((await api('POST', '/api/segment', { account: acc.id, target: { include: ['VIP'], logic: 'and' } })).count, 1);
  assert.equal((await api('POST', '/api/segment', { account: acc.id, target: { include: [], exclude: ['VIP'] } })).count, 1);

  const messages = Builder.buildMessages({ messages: [{ type: 'flex', bubbles: [{ title: '優惠', buttons: [{ type: 'uri', label: '去逛逛', uri: 'https://shop.example.com', tags: '點過優惠' }] }] }] });
  calls.length = 0;
  const camp = await api('POST', '/api/send', { account: acc.id, name: 'VIP 優惠', messages, mode: 'segment', target: { include: ['VIP'] }, track: true });
  assert.equal(camp.recipients, 1);
  const push = calls.find((c) => c.path === '/v2/bot/message/push');
  assert.equal(push.body.to, U1);
  const uri = push.body.messages[0].contents.footer.contents[0].action.uri;
  assert.match(uri, /^https:\/\/boost\.example\.com\/r\/\w+\?u=/);

  // 點追蹤連結：轉址並自動貼標籤
  const r = await realFetch(base + new URL(uri).pathname + new URL(uri).search, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://shop.example.com');
  const after = await api('GET', `/api/users?account=${acc.id}`);
  assert.ok(after.find((u) => u.id === U1).tags.includes('點過優惠'));

  // 竄改簽章不能幫別人貼標籤
  await realFetch(`${base}${new URL(uri).pathname}?u=${U2}&s=0000`, { redirect: 'manual' });
  assert.ok(!(await api('GET', `/api/users?account=${acc.id}`)).find((u) => u.id === U2).tags.includes('點過優惠'));

  const st = await api('GET', `/api/stats?account=${acc.id}`);
  const c = st.campaigns.find((x) => x.id === camp.id);
  assert.equal(c.items[0].key, '去逛逛');
  assert.equal(c.items[0].users, 1);
});

test('多層圖文選單發布、分眾指派與排程', async () => {
  const img = Buffer.from('/9j/4AAQSkZJRgABAQ==', 'base64');
  const up = await (await realFetch(`${base}/api/upload?ext=jpg`, { method: 'POST', body: img })).json();
  const menu = await api('POST', '/api/menus', {
    account: acc.id, name: 'VIP 選單', size: 'large', chatBarText: '選單', target: { mode: 'tag', tag: 'VIP' },
    layers: [
      { name: '主層', image: up.url, areas: [{ x: 0, y: 0, w: 1250, h: 1686, action: { type: 'switch', label: '門市', layer: '1', tags: '看門市' } }, { x: 1250, y: 0, w: 1250, h: 1686, action: { type: 'uri', label: '官網', uri: 'https://shop.example.com' } }] },
      { name: '門市', image: up.url, areas: [{ x: 0, y: 0, w: 2500, h: 1686, action: { type: 'switch', label: '返回', layer: '0' } }] },
    ],
  });
  calls.length = 0;
  await api('POST', `/api/menus/${menu.id}/publish`, {});
  const created = calls.filter((c) => c.path === '/v2/bot/richmenu');
  assert.equal(created.length, 2);
  const sw = created[0].body.areas[0].action;
  assert.equal(sw.type, 'richmenuswitch');
  assert.equal(sw.richMenuAliasId, `lb${menu.id}-1`);
  assert.match(created[0].body.areas[1].action.uri, /\/r\//);
  assert.equal(calls.filter((c) => c.path.endsWith('/content')).length, 2);
  assert.equal(calls.filter((c) => c.path === '/v2/bot/richmenu/alias').length, 2);
  const link = calls.find((c) => c.path === '/v2/bot/richmenu/bulk/link');
  assert.deepEqual(link.body.userIds, [U1]);

  // 新貼上 VIP 標籤的好友自動換上分眾選單
  calls.length = 0;
  await webhook([{ type: 'postback', source: { userId: U2 }, postback: { data: 'k=x&tag=VIP' } }]);
  assert.ok(calls.some((c) => c.path === `/v2/bot/user/${U2}/richmenu/${link.body.richMenuId}`));

  // 排程下架
  const r = await api('POST', `/api/menus/${menu.id}/publish`, { publishAt: new Date(Date.now() + 3600e3).toISOString(), unpublishAt: new Date(Date.now() + 7200e3).toISOString() });
  assert.ok(r['menu-publish'] && r['menu-unpublish'] && !r.published);
  const jobs = await api('GET', `/api/jobs?account=${acc.id}`);
  assert.equal(jobs.length, 2);

  calls.length = 0;
  await api('POST', `/api/menus/${menu.id}/unpublish`, {});
  assert.ok(calls.some((c) => c.path === '/v2/bot/richmenu/bulk/unlink'));
  assert.equal(calls.filter((c) => c.method === 'DELETE' && /^\/v2\/bot\/richmenu\/richmenu-/.test(c.path)).length, 2);
});

test('關鍵字自動回覆使用範本', async () => {
  const messages = Builder.buildMessages({ messages: [{ type: 'text', text: '營業時間 10:00-21:00' }] });
  const t = await api('POST', '/api/templates', { name: '營業時間', model: {}, messages });
  await api('POST', '/api/accounts', { id: acc.id, autoReplies: [{ keyword: '營業', templateId: t.id, tags: '問過營業時間' }] });
  calls.length = 0;
  await webhook([{ type: 'message', replyToken: 'r9', source: { userId: U2 }, message: { type: 'text', text: '請問營業時間' } }]);
  assert.equal(calls.find((c) => c.path === '/v2/bot/message/reply').body.messages[0].text, '營業時間 10:00-21:00');
  assert.ok((await api('GET', `/api/users?account=${acc.id}`)).find((u) => u.id === U2).tags.includes('問過營業時間'));
});
