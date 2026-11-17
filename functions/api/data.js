// EdgeOne Pages Function：三张数据表（管线/支架/阀门）的云端分发
// GET    /api/data?name=pipeline            -> 版本信息 manifest
// GET    /api/data?name=pipeline&part=0     -> 第 0 片（gzip 后的 base64 文本）
// POST   /api/data  {action:'part',...}     -> 上传一片
// POST   /api/data  {action:'meta',meta}    -> 发布新版本
// DELETE /api/data?name=pipeline            -> 清空该表云端数据
// 约束：Edge Functions 请求 body 上限 1 MB，故每片控制在 ~450 KB

const BIND_NAME = 'MY_KV';
const NAMES = ['pipeline', 'support', 'valve'];
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
function text(s, status = 200) {
  return new Response(s, {
    status,
    headers: Object.assign({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, CORS),
  });
}
const metaKey = name => 'data_' + name + '_meta';
const partKey = (name, i) => 'data_' + name + '_' + i;

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const kv = (env && env[BIND_NAME]) || globalThis[BIND_NAME];
  if (!kv) return json({ error: 'KV 未绑定，请把命名空间绑定为变量 ' + BIND_NAME }, 500);

  const url = new URL(request.url);
  const name = String(url.searchParams.get('name') || '');
  if (NAMES.indexOf(name) < 0) return json({ error: '表名无效，仅支持 pipeline/support/valve' }, 400);
  const method = request.method.toUpperCase();

  try {
    if (method === 'GET') {
      const p = url.searchParams.get('part');
      if (p !== null) {
        const key = partKey(name, Number(p));
        const v = await kv.get(key);
        return v === null || v === undefined ? text('', 404) : text(String(v));
      }
      const meta = await kv.get(metaKey(name), 'json');
      return json(meta ? { ok: true, meta } : { ok: true, meta: null });
    }

    if (method === 'POST') {
      const body = await request.json();
      if (body.action === 'part') {
        const i = Number(body.part);
        if (!Number.isInteger(i) || i < 0) return json({ error: '分片序号无效' }, 400);
        const data = String(body.data || '');
        if (!data) return json({ error: '分片内容为空' }, 400);
        if (data.length > 900000) return json({ error: '分片超过 1 MB 请求限制' }, 413);
        await kv.put(partKey(name, i), data);
        return json({ ok: true, part: i });
      }
      if (body.action === 'meta') {
        const meta = body.meta;
        if (!meta || !meta.version) return json({ error: '缺少版本信息' }, 400);
        await kv.put(metaKey(name), JSON.stringify(meta));
        return json({ ok: true, meta });
      }
      return json({ error: '未知操作' }, 400);
    }

    if (method === 'DELETE') {
      let cursor = '';
      const prefix = 'data_' + name + '_';
      do {
        const opt = { prefix, limit: 256 };
        if (cursor) opt.cursor = cursor;
        const page = await kv.list(opt);
        for (const k of page.keys || []) await kv.delete(k.key);
        cursor = page.complete ? '' : (page.cursor || '');
      } while (cursor);
      return json({ ok: true });
    }

    return json({ error: '不支持的方法' }, 405);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}
