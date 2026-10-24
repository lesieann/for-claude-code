// LINE Messaging API 的最小封裝（使用 Node 18+ 內建 fetch）
const crypto = require('crypto');

const API = 'https://api.line.me';
const DATA_API = 'https://api-data.line.me';

async function call(token, method, path, body, opt = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (Buffer.isBuffer(body)) {
    headers['Content-Type'] = opt.contentType;
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch((opt.data ? DATA_API : API) + path, { method, headers, body: payload });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const detail = (json.details || []).map((d) => `${d.property}: ${d.message}`).join('; ');
    const err = new Error(`LINE API ${res.status}：${json.message || text}${detail ? `（${detail}）` : ''}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

function verifySignature(secret, rawBody, signature) {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = (token) => ({
  botInfo: () => call(token, 'GET', '/v2/bot/info'),
  profile: (userId) => call(token, 'GET', `/v2/bot/profile/${encodeURIComponent(userId)}`),
  async followerIds() {
    const ids = [];
    let start;
    do {
      const q = new URLSearchParams({ limit: '1000', ...(start ? { start } : {}) });
      const r = await call(token, 'GET', `/v2/bot/followers/ids?${q}`);
      ids.push(...r.userIds);
      start = r.next;
    } while (start);
    return ids;
  },
  quota: () => call(token, 'GET', '/v2/bot/message/quota'),
  consumption: () => call(token, 'GET', '/v2/bot/message/quota/consumption'),
  reply: (replyToken, messages) => call(token, 'POST', '/v2/bot/message/reply', { replyToken, messages }),
  push: (to, messages) => call(token, 'POST', '/v2/bot/message/push', { to, messages }),
  async multicast(userIds, messages) {
    for (const ids of chunk(userIds, 500)) await call(token, 'POST', '/v2/bot/message/multicast', { to: ids, messages });
  },
  broadcast: (messages) => call(token, 'POST', '/v2/bot/message/broadcast', { messages }),
  validate: (messages) => call(token, 'POST', '/v2/bot/message/validate/push', { messages }),

  // 圖文選單
  createRichMenu: (menu) => call(token, 'POST', '/v2/bot/richmenu', menu),
  validateRichMenu: (menu) => call(token, 'POST', '/v2/bot/richmenu/validate', menu),
  uploadRichMenuImage: (id, buf, contentType) => call(token, 'POST', `/v2/bot/richmenu/${id}/content`, buf, { data: true, contentType }),
  deleteRichMenu: (id) => call(token, 'DELETE', `/v2/bot/richmenu/${id}`),
  listRichMenus: () => call(token, 'GET', '/v2/bot/richmenu/list'),
  setDefaultRichMenu: (id) => call(token, 'POST', `/v2/bot/user/all/richmenu/${id}`),
  getDefaultRichMenu: () => call(token, 'GET', '/v2/bot/user/all/richmenu').catch(() => ({})),
  clearDefaultRichMenu: () => call(token, 'DELETE', '/v2/bot/user/all/richmenu'),
  linkRichMenu: (userId, id) => call(token, 'POST', `/v2/bot/user/${encodeURIComponent(userId)}/richmenu/${id}`),
  async bulkLink(userIds, richMenuId) {
    for (const ids of chunk(userIds, 500)) await call(token, 'POST', '/v2/bot/richmenu/bulk/link', { richMenuId, userIds: ids });
  },
  async bulkUnlink(userIds) {
    for (const ids of chunk(userIds, 500)) await call(token, 'POST', '/v2/bot/richmenu/bulk/unlink', { userIds: ids });
  },
  async upsertAlias(richMenuAliasId, richMenuId) {
    try {
      await call(token, 'POST', '/v2/bot/richmenu/alias', { richMenuAliasId, richMenuId });
    } catch (e) {
      if (e.status !== 400) throw e;
      await call(token, 'POST', `/v2/bot/richmenu/alias/${richMenuAliasId}`, { richMenuId });
    }
  },
  deleteAlias: (id) => call(token, 'DELETE', `/v2/bot/richmenu/alias/${id}`).catch(() => {}),
});

module.exports.verifySignature = verifySignature;
module.exports.chunk = chunk;
