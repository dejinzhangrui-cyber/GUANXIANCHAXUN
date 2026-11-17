// EdgeOne Pages Function：支架备注 + 工作台记录 KV 读写
// 路由 /api/notes            GET=列出备注  POST=保存  DELETE=删除
//      /api/notes?type=work  GET=列出工作台行  POST=保存行  DELETE=删除行
// KV 通过绑定的变量名访问；MY_KV 需与控制台「KV存储」绑定的变量名一致
// 注意：EdgeOne KV list() 的 cursor 必须是字符串，首次调用不能传 undefined

const BIND_NAME = 'MY_KV';
// APK 内是 capacitor://localhost，跨域访问接口需要 CORS 头
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS),
  });
}

// 编号 -> 合法 KV key（仅数字/字母/下划线）
function safeKey(prefix, no) {
  return prefix + String(no || '').replace(/[^0-9A-Za-z_]/g, '_');
}

async function readIndex(kv, indexKey) {
  let idx = [];
  try { idx = await kv.get(indexKey, 'json') || []; } catch (e) { idx = []; }
  return Array.isArray(idx) ? idx : [];
}
async function addIndex(kv, indexKey, key) {
  const idx = await readIndex(kv, indexKey);
  if (idx.indexOf(key) < 0) idx.push(key);
  await kv.put(indexKey, JSON.stringify(idx));
}
async function removeIndex(kv, indexKey, key) {
  const idx = await readIndex(kv, indexKey);
  await kv.put(indexKey, JSON.stringify(idx.filter(k => k !== key)));
}

// 列出某个前缀下的全部记录；list 不可用时回退到索引
async function listRecords(kv, prefix, indexKey) {
  const items = [];
  let listOK = false;
  let cursor = '';
  try {
    do {
      const opt = { prefix, limit: 256 };
      if (cursor) opt.cursor = cursor;
      const page = await kv.list(opt);
      for (const k of page.keys || []) {
        if (k.key === indexKey) continue; // 索引 key 本身不是记录
        const v = await kv.get(k.key, 'json');
        if (v && typeof v === 'object' && !Array.isArray(v)) items.push(v);
      }
      cursor = page.complete ? '' : (page.cursor || '');
    } while (cursor);
    listOK = true;
  } catch (e) { listOK = false; }
  if (!listOK) {
    for (const key of await readIndex(kv, indexKey)) {
      if (key === indexKey) continue;
      const v = await kv.get(key, 'json');
      if (v && typeof v === 'object' && !Array.isArray(v)) items.push(v);
    }
  }
  const seen = new Set();
  return items.filter(v => {
    const k = v._key || '';
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const kv = (env && env[BIND_NAME]) || globalThis[BIND_NAME];
  if (!kv) return json({ error: 'KV 未绑定，请在控制台把命名空间绑定为变量 ' + BIND_NAME }, 500);

  const url = new URL(request.url);
  const isWork = url.searchParams.get('type') === 'work';
  const prefix = isWork ? 'work_' : 'note_';
  const indexKey = isWork ? 'work_index' : 'note_index';
  const method = request.method.toUpperCase();

  try {
    if (method === 'GET') {
      const items = await listRecords(kv, prefix, indexKey);
      items.sort((a, b) =>
        String(b.updated_at || '').localeCompare(String(a.updated_at || '')) ||
        String(a.date || '').localeCompare(String(b.date || ''))
      );
      return json(isWork ? { ok: true, rows: items } : { ok: true, notes: items });
    }

    if (method === 'POST') {
      const body = await request.json();
      if (isWork) {
        const id = String(body.id || '').trim();
        if (!id) return json({ error: '缺少记录 id' }, 400);
        const key = safeKey(prefix, id);
        const record = Object.assign({}, body, { id, _key: key, updated_at: new Date().toISOString() });
        await kv.put(key, JSON.stringify(record));
        await addIndex(kv, indexKey, key);
        return json({ ok: true, row: record });
      }
      const no = String(body.support_no || '').trim();
      if (!no) return json({ error: '缺少支架编号' }, 400);
      const note = String(body.note || '').trim();
      if (!note) return json({ error: '备注内容不能为空' }, 400);
      const key = safeKey(prefix, no);
      const record = {
        support_no: no, note,
        kind: String(body.kind || 'support'),   // support=支架 / valve=阀门
        location: String(body.location || ''),
        iso_no: String(body.iso_no || ''),
        line_no: String(body.line_no || ''),
        area: String(body.area || ''),
        owner_name: String(body.owner_name || ''),
        updated_at: new Date().toISOString(),
        _key: key,
      };
      await kv.put(key, JSON.stringify(record));
      await addIndex(kv, indexKey, key);
      return json({ ok: true, note: record });
    }

    if (method === 'DELETE') {
      let body = {};
      try { body = await request.json(); } catch (e) { body = {}; }
      const no = url.searchParams.get('id') || url.searchParams.get('support_no') || body.id || body.support_no;
      if (!no) return json({ error: '缺少编号' }, 400);
      const key = safeKey(prefix, no);
      await kv.delete(key);
      await removeIndex(kv, indexKey, key);
      return json({ ok: true });
    }

    return json({ error: '不支持的方法' }, 405);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}
