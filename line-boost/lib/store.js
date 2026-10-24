// 簡單的 JSON 檔案資料庫：所有資料存在 DATA_DIR/db.json，上傳檔案存在 DATA_DIR/uploads
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_EVENTS = 100000;

const EMPTY = {
  accounts: [],   // { id, name, token, secret, welcomeTemplateId, autoReplies: [{ keyword, exact, templateId }], menuRules: [{ tag, richMenuId, menuId }] }
  users: {},      // users[accountId][userId] = { name, picture, tags: [], followed, since, lastSeen }
  templates: [],  // { id, name, model, messages, updatedAt }
  menus: [],      // 圖文選單草稿與發布狀態
  jobs: [],       // 排程工作
  campaigns: [],  // 推播紀錄
  events: [],     // 點擊／互動事件
  links: {},      // 追蹤連結 id -> { url, key, tags, campaign, account }
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db = structuredClone(EMPTY);
if (fs.existsSync(FILE)) {
  db = { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 200);
}
function flush() {
  clearTimeout(timer);
  if (db.events.length > MAX_EVENTS) db.events = db.events.slice(-MAX_EVENTS);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}
process.on('exit', flush);

const uid = (n = 6) => crypto.randomBytes(n).toString('hex');

function usersOf(accountId) {
  if (!db.users[accountId]) db.users[accountId] = {};
  return db.users[accountId];
}

function addTags(accountId, userId, tags) {
  const u = usersOf(accountId)[userId] || (usersOf(accountId)[userId] = { tags: [], followed: true, since: Date.now() });
  const added = [];
  for (const t of tags) {
    const tag = String(t).trim();
    if (tag && !u.tags.includes(tag)) { u.tags.push(tag); added.push(tag); }
  }
  if (added.length) save();
  return added;
}

function logEvent(e) {
  db.events.push({ ts: Date.now(), ...e });
  save();
}

module.exports = { get db() { return db; }, save, flush, uid, usersOf, addTags, logEvent, DATA_DIR, UPLOAD_DIR };
