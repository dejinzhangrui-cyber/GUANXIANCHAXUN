// EdgeOne Pages Function：支架备注 KV 读写
// 路由：/api/notes   GET=列出全部  POST=保存  DELETE=删除
// KV 通过绑定的变量名访问；下方 MY_KV 需与控制台「KV存储」绑定的变量名一致

const BIND_NAME = 'MY_KV';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// 支架编号 -> 合法 KV key（仅数字/字母/下划线）
function safeKey(no) {
  return 'note_' + String(no || '').replace(/[^0-9A-Za-z_]/g, '_');
}

export async function onRequest({ request, env }) {
  // 取绑定的 KV 命名空间：优先环境变量，其次全局变量（兼容两种运行时）
  const kv = (env && env[BIND_NAME]) || globalThis[BIND_NAME];
  if (!kv) return json({ error: 'KV 未绑定，请在控制台把命名空间绑定为变量 ' + BIND_NAME }, 500);

  const method = request.method.toUpperCase();

  try {
    if (method === 'GET') {
      // 遍历全部 key，读出所有备注
      const items = [];
      let cursor = undefined;
      do {
        const page = await kv.list({ prefix: 'note_', limit: 256, cursor });
        for (const k of page.keys || []) {
          const v = await kv.get(k.key, 'json');
          if (v) items.push(v);
        }
        cursor = page.complete ? undefined : page.cursor;
      } while (cursor);
      items.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      return json({ ok: true, notes: items });
    }

    if (method === 'POST') {
      const body = await request.json();
      const no = String(body.support_no || '').trim();
      if (!no) return json({ error: '缺少支架编号' }, 400);
      const note = String(body.note || '').trim();
      if (!note) return json({ error: '备注内容不能为空' }, 400);
      const key = safeKey(no);
      const record = {
        support_no: no,
        note,
        location: String(body.location || ''),
        iso_no: String(body.iso_no || ''),
        line_no: String(body.line_no || ''),
        area: String(body.area || ''),
        owner_name: String(body.owner_name || ''),
        updated_at: new Date().toISOString(),
        _key: key,
      };
      await kv.put(key, JSON.stringify(record));
      // 维护索引：note_index 存所有 key
      let idx = [];
      try { idx = await kv.get('note_index', 'json') || []; } catch (e) { idx = []; }
      if (!Array.isArray(idx)) idx = [];
      if (idx.indexOf(key) < 0) idx.push(key);
      await kv.put('note_index', JSON.stringify(idx));
      return json({ ok: true, note: record });
    }

    if (method === 'DELETE') {
      const url = new URL(request.url);
      const no = url.searchParams.get('support_no') || (await request.json().catch(() => ({}))).support_no;
      if (!no) return json({ error: '缺少支架编号' }, 400);
      const key = safeKey(no);
      await kv.delete(key);
      let idx = [];
      try { idx = await kv.get('note_index', 'json') || []; } catch (e) { idx = []; }
      if (Array.isArray(idx)) {
        idx = idx.filter(k => k !== key);
        await kv.put('note_index', JSON.stringify(idx));
      }
      return json({ ok: true });
    }

    return json({ error: '不支持的方法' }, 405);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}
