// MW4 Fieldnotes sync. One row per tracker: the edit code is the only key that can write,
// a separate view id lets friends read. Only a hash of the edit code is stored.
const MAX_BYTES = 1536 * 1024;// D1 rows top out at 2 MB; a few thousand matches fit comfortably
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {status, headers: {...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store'}});
}
function randomCode(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => CODE_ALPHABET[b & 31]).join('');
}
// 16 characters from a 32-letter alphabet is 80 bits: not guessable.
const newEditCode = () => 'MW4-' + randomCode(16).match(/.{4}/g).join('-');
const newViewId = () => randomCode(10);
const cleanCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^MW4/, '');
async function hash(code) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('mw4-sync:' + cleanCode(code)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
async function readData(request) {
  const text = await request.text();
  if (text.length > MAX_BYTES) throw new HttpError(413, 'Progress is too large to sync.');
  let body;
  try { body = JSON.parse(text); } catch { throw new HttpError(400, 'Not JSON.'); }
  if (!body || typeof body.data !== 'object' || Array.isArray(body.data) || body.data.version !== 3) throw new HttpError(400, 'Not tracker progress.');
  return body;
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function owner(request, env) {
  const code = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (cleanCode(code).length !== 16) throw new HttpError(401, 'That sync code is not valid.');
  const row = await env.DB.prepare('SELECT edit_hash, view_id, rev, data, updated FROM docs WHERE edit_hash = ?').bind(await hash(code)).first();
  if (!row) throw new HttpError(404, 'No progress uses that sync code.');
  return row;
}
// Friends see camo progress, match and lifetime stats; goals and their notes stay private.
function publicView(data) {
  return {version: 3, checks: data.checks || {}, categoryTotals: data.categoryTotals || {}, matches: data.matches || [], lifetime: data.lifetime || null, goals: [], mode: data.mode};
}

async function route(request, env) {
  const url = new URL(request.url), path = url.pathname, now = new Date().toISOString();
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
  // People who open the server address directly get pointed at the tracker.
  if (path === '/' && request.method === 'GET') return new Response('MW4 Fieldnotes sync server is running.\n\nThis address is used by the tracker behind the scenes. Open the tracker and use "Sync devices":\nhttps://ddemetriou9.github.io/cod-camo-tracker/\n', {headers: {'Content-Type': 'text/plain; charset=utf-8'}});

  if (path === '/v1/create' && request.method === 'POST') {
    const {data} = await readData(request), code = newEditCode(), viewId = newViewId();
    await env.DB.prepare('INSERT INTO docs (edit_hash, view_id, rev, data, updated) VALUES (?, ?, 1, ?, ?)').bind(await hash(code), viewId, JSON.stringify(data), now).run();
    return json({code, viewId, rev: 1, updated: now}, 201);
  }
  if (path === '/v1/doc' && request.method === 'GET') {
    const row = await owner(request, env), known = Number(url.searchParams.get('rev'));
    if (known === row.rev) return json({rev: row.rev, viewId: row.view_id, updated: row.updated});
    return json({rev: row.rev, viewId: row.view_id, updated: row.updated, data: JSON.parse(row.data)});
  }
  if (path === '/v1/doc' && request.method === 'PUT') {
    const row = await owner(request, env), {data, baseRev} = await readData(request);
    // Only write if nobody else wrote since this device last synced; otherwise hand back the newer copy to merge.
    const result = await env.DB.prepare('UPDATE docs SET data = ?, rev = rev + 1, updated = ? WHERE edit_hash = ? AND rev = ?').bind(JSON.stringify(data), now, row.edit_hash, baseRev).run();
    if (!result.meta.changes) {
      const fresh = await env.DB.prepare('SELECT rev, data, updated FROM docs WHERE edit_hash = ?').bind(row.edit_hash).first();
      return json({error: 'conflict', rev: fresh.rev, updated: fresh.updated, data: JSON.parse(fresh.data)}, 409);
    }
    return json({rev: baseRev + 1, updated: now});
  }
  if (path === '/v1/view/rotate' && request.method === 'POST') {
    const row = await owner(request, env), viewId = newViewId();
    await env.DB.prepare('UPDATE docs SET view_id = ? WHERE edit_hash = ?').bind(viewId, row.edit_hash).run();
    return json({viewId});
  }
  const view = path.match(/^\/v1\/view\/([A-Z0-9]{10})$/);
  if (view && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT data, updated FROM docs WHERE view_id = ?').bind(view[1]).first();
    if (!row) throw new HttpError(404, 'This share link has been replaced or never existed.');
    return json({updated: row.updated, data: publicView(JSON.parse(row.data))});
  }
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch (e) {
      if (e instanceof HttpError) return json({error: e.message}, e.status);
      console.error(e);
      return json({error: 'Sync is unavailable right now.'}, 500);
    }
  },
};
