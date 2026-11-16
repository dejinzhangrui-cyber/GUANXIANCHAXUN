// ============================================================
//  管理后台 · 云端版（EdgeOne Pages 边缘函数 + KV 存储）
//  放到仓库 functions/api/index.js 自动部署后，接口地址：
//     https://你的域名/api
//  APP「⚙ 设置」里填 https://你的域名 并切换到云端即可多人共享。
//
//  控制台准备（一次性）：
//    1. EdgeOne Pages 项目 → 存储 → KV → 申请开通
//    2. 创建命名空间（如 pipe-data），绑定到项目，变量名必须填 my_kv
// ============================================================

// 所有修改操作都要求带 ?key=密码 或 POST 里的 key 字段（与查询共用一个密码）
const PASS = '370983';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store'
};

const K_NOTES = 'notes';    // { "支架_管线": {bracketId,pipeNo,notes:[{note,time,user}]} }
const K_VALVES = 'valves';  // [ {valveTag,weldNo1,weldNo2,serialNo,user,updateTime} ]
const K_TAILS = 'tails';    // { "子项_管线": [{id,content,createdAt,user}] }
const K_DATA1 = 'data1';    // { "支架_管线": {status,updateTime,user} }
const K_DATA2 = 'data2';    // { "阀门位号": {...} }
const K_DATA6 = 'data6';    // { version,updatedAt,columns,teams,days }
const K_DATA7 = 'data7';    // { logs: [] }

function json(obj, code) {
  return new Response(JSON.stringify(obj), {
    status: code || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}
function bad(msg, code) { return json({ success: false, message: msg }, code || 400); }

function nowText() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

async function kvReady() {
  try {
    if (typeof my_kv === 'undefined' || !my_kv) return false;
    await my_kv.get('__ping__');
    return true;
  } catch (e) { return false; }
}

async function getJSON(key, fallback) {
  try {
    const v = await my_kv.get(key, 'json');
    return (v === null || v === undefined) ? fallback : v;
  } catch (e) { return fallback; }
}
async function putJSON(key, val) {
  await my_kv.put(key, JSON.stringify(val));
}

/* ------------------------- 备注 ------------------------- */
async function getNotes() { return getJSON(K_NOTES, {}); }

async function saveNote(b) {
  const bracketId = String(b.bracketId || '').trim();
  const pipeNo = String(b.pipeNo || '').trim();
  if (!bracketId || !pipeNo) return { success: false, message: '支架号/管线号不能为空' };
  const map = await getNotes();
  const key = bracketId + '_' + pipeNo;
  const item = map[key] || { bracketId: bracketId, pipeNo: pipeNo, notes: [] };
  if (!Array.isArray(item.notes)) item.notes = [];
  item.notes.unshift({ note: String(b.note || '').trim(), time: b.timestamp || nowText(), user: b.user || '' });
  if (item.notes.length > 50) item.notes = item.notes.slice(0, 50);
  map[key] = item;
  await putJSON(K_NOTES, map);
  return { success: true, message: '已保存' };
}

async function deleteNote(q) {
  const map = await getNotes();
  const key = String(q.get('bracketId') || '') + '_' + String(q.get('pipeNo') || '');
  if (!map[key]) return { success: false, message: '没有找到该备注' };
  delete map[key];
  await putJSON(K_NOTES, map);
  return { success: true, message: '已删除' };
}

/* ------------------------- 阀门录入 ------------------------- */
async function getValves() { return { success: true, data: await getJSON(K_VALVES, []) }; }

async function saveValve(b) {
  const tag = String(b.valveTag || '').trim();
  if (!tag) return { success: false, message: '阀门位号不能为空' };
  const list = await getJSON(K_VALVES, []);
  const rec = {
    valveTag: tag,
    weldNo1: String(b.weldNo1 || '').trim(),
    weldNo2: String(b.weldNo2 || '').trim(),
    serialNo: String(b.serialNo || '').trim(),
    user: b.user || '',
    updateTime: b.timestamp || nowText()
  };
  const i = list.findIndex(function (x) { return x && x.valveTag === tag; });
  if (i >= 0) list[i] = rec; else list.unshift(rec);
  await putJSON(K_VALVES, list);
  return { success: true, message: '已保存' };
}

async function deleteValve(q) {
  const list = await getJSON(K_VALVES, []);
  const tag = String(q.get('key') || '').replace(/^阀门_/, '') || String(q.get('valveTag') || '');
  const out = list.filter(function (x) { return !x || x.valveTag !== tag; });
  if (out.length === list.length) return { success: false, message: '没有找到该阀门' };
  await putJSON(K_VALVES, out);
  return { success: true, message: '已删除' };
}

/* ------------------------- 尾项 ------------------------- */
async function getTails() { return getJSON(K_TAILS, {}); }

async function saveTail(b) {
  const sub = String(b.subItem || '').trim();
  const line = String(b.lineNo || '').trim();
  if (!sub || !line) return { success: false, error: '子项号/管线号不能为空' };
  const map = await getTails();
  const key = sub + '_' + line;
  if (!Array.isArray(map[key])) map[key] = [];
  map[key].push({
    id: 'T' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    content: String(b.content || '').trim(),
    createdAt: nowText(),
    user: b.user || ''
  });
  await putJSON(K_TAILS, map);
  return { success: true };
}

async function updateTail(b) {
  const map = await getTails();
  const id = String(b.id || '');
  let done = false;
  Object.keys(map).forEach(function (k) {
    (map[k] || []).forEach(function (t) {
      if (t && String(t.id) === id) { t.content = String(b.content || '').trim(); t.updatedAt = nowText(); done = true; }
    });
  });
  if (!done) return { success: false, message: '没有找到该尾项' };
  await putJSON(K_TAILS, map);
  return { success: true };
}

async function deleteTail(b) {
  const map = await getTails();
  const id = String(b.id || '');
  let done = false;
  Object.keys(map).forEach(function (k) {
    const arr = map[k] || [];
    const out = arr.filter(function (t) { return !t || String(t.id) !== id; });
    if (out.length !== arr.length) done = true;
    if (out.length) map[k] = out; else delete map[k];
  });
  if (!done) return { success: false, message: '没有找到该尾项' };
  await putJSON(K_TAILS, map);
  return { success: true };
}

/* ------------------------- 静态 JSON（dataN.json） ------------------------- */
const DATA_KEYS = { 'data1.json': K_DATA1, 'data2.json': K_DATA2, 'data6.json': K_DATA6, 'data7.json': K_DATA7 };

async function getDataFile(name) {
  const key = DATA_KEYS[name];
  if (!key) return {};
  const v = await getJSON(key, null);
  if (v) return v;
  if (name === 'data6.json') return { version: 1, updatedAt: '', columns: [], teams: [], days: {} };
  if (name === 'data7.json') return { logs: [] };
  return {};
}

/* ------------------------- 路由 ------------------------- */
function checkPass(q, b) {
  const k = (q && q.get('key')) || (b && b.key) || '';
  return !PASS || k === PASS;
}

export async function onRequest(context) {
  const req = context.request;
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // /api/kv 与 /api/tails（兼容 /api 直接访问）
  const m = path.match(/\/api(\/(kv|tails))?$/) || path.match(/\/api$/);

  if (m) {
    const q = url.searchParams;
    const action = (q.get('action') || '').toLowerCase();
    let body = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch (e) { body = {}; }
    }

    if (!checkPass(q, body) && action !== 'get-notes' && action !== 'get-valves') {
      return bad('密码不正确，请在地址后加 ?key=你的密码', 401);
    }

    if (action === 'get-notes') return json(await getNotes());
    if (action === 'get-valves') return json(await getValves());
    if (action === 'save-note') return json(await saveNote(body));
    if (action === 'save-valve') return json(await saveValve(body));
    if (action === 'delete-note') return json(await deleteNote(q));
    if (action === 'delete-valve') return json(await deleteValve(q));
    if (action === 'flush-db') {
      await putJSON(K_NOTES, {}); await putJSON(K_VALVES, []); await putJSON(K_TAILS, {});
      return json({ success: true, message: '云端数据已清空' });
    }

    if (action === 'get-all') return json(await getTails());
    if (action === 'save') return json(await saveTail(body));
    if (action === 'update') return json(await updateTail(body));
    if (action === 'delete') return json(await deleteTail(body));

    return bad('未知操作：' + action, 400);
  }

  // /dataN.json —— GET 读取；POST 整份覆盖（APP「生成到仓库/加入静态库」用）
  const file = url.pathname.split('/').pop();
  if (DATA_KEYS[file]) {
    if (req.method === 'POST') {
      let body = {};
      try { body = await req.json(); } catch (e) { return bad('JSON 解析失败', 400); }
      if (file === 'data6.json') body.updatedAt = nowText();
      await putJSON(DATA_KEYS[file], body);
      return json({ success: true, message: file + ' 已保存到云端' });
    }
    return json(await getDataFile(file));
  }

  return bad('not found', 404);
}
