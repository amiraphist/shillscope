;

const X = 'https://api.x.com/2';
const CACHE_TTL = 1800;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/api/hit') {
      if (req.method !== 'OPTIONS') ctx.waitUntil(bump(env, 'v', (url.searchParams.get('r') || '').slice(0, 60), req));
      return new Response(null, { status: 204, headers: CORS });
    }
    if (url.pathname === '/stats') return stats(url, env);
    if (url.pathname === '/api/replies') {
      if (req.method === 'GET' && !url.searchParams.get('next')) ctx.waitUntil(bump(env, 'g', '', req));
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'x-access-key', 'access-control-max-age': '86400' } });
      const r = await replies(req, url, env, ctx);
      const out = new Response(r.body, r); for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v); return out;
    }
    return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', ...SEC,
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; media-src https://video.twimg.com https://amiraphist.github.io; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'" } });
  },
};

function uaInfo(ua) {
  const os = /iPhone|iPod/.test(ua) ? 'iOS' : /iPad/.test(ua) ? 'iPadOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'other';
  const dev = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet' : /Mobi|iPhone|Android/.test(ua) ? 'mobile' : 'desktop';
  const br = /Twitter|TwitterAndroid/.test(ua) ? 'X app' : /FBAN|FBAV|Instagram/.test(ua) ? 'Meta app' : /Telegram/.test(ua) ? 'Telegram' : /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Brave/.test(ua) ? 'Brave' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'other';
  return { dev, os, br };
}

async function bump(env, kind, ref, req) {
  if (!env.STATS) return;
  try {
    const key = 'd:' + new Date().toISOString().slice(0, 10);
    const d = (await env.STATS.get(key, 'json')) || { v: 0, g: 0, ref: {}, c: {} };
    d[kind] = (d[kind] || 0) + 1;
    if (kind === 'v') {
      const r = ref || 'direct'; d.ref[r] = (d.ref[r] || 0) + 1;
      const c = (req.cf && req.cf.country) || '?'; d.c[c] = (d.c[c] || 0) + 1;
      const u = uaInfo(req.headers.get('user-agent') || '');
      for (const [f, val] of [['dev', u.dev], ['os', u.os], ['br', u.br]]) { d[f] = d[f] || {}; d[f][val] = (d[f][val] || 0) + 1; }
    }
    await env.STATS.put(key, JSON.stringify(d));
  } catch (e) {}
}

const CORS = { 'access-control-allow-origin': '*', 'vary': 'origin' };
const SEC = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'strict-transport-security': 'max-age=31536000' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...SEC } });

async function replies(req, url, env, ctx) {
  if (env.ACCESS_KEY && req.headers.get('x-access-key') !== env.ACCESS_KEY) return json({ error: 'access key needed' }, 401);
  const id = url.searchParams.get('id') || '';
  const next = url.searchParams.get('next') || '';
  if (!/^\d{5,25}$/.test(id)) return json({ error: 'bad post id' }, 400);
  if (!env.X_BEARER_TOKEN) return fxReplies(id, ctx, env);   // free mode (no X API key): FxTwitter

  const cache = caches.default;
  const key = new Request(`https://cache.shillscope/v2/${id}/${encodeURIComponent(next)}`);
  const hit = await cache.match(key);
  if (hit) return hit;

  const H = { Authorization: `Bearer ${env.X_BEARER_TOKEN}` };
  const get = async (path, params) => {
    const r = await fetch(`${X}${path}?${new URLSearchParams(params)}`, { headers: H });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || j.title || `X API error ${r.status}`);
    return j;
  };

  try {
    // root post (only on first page)
    let root = null, conv = id, older = false;
    const rj = await get(`/tweets/${id}`, {
      'tweet.fields': 'conversation_id,created_at,text',
      expansions: 'author_id',
      'user.fields': 'username,name,profile_image_url',
    });
    conv = rj.data?.conversation_id || id;
    older = rj.data && (Date.now() - new Date(rj.data.created_at)) > 6.5 * 864e5;
    if (!next && rj.data) {
      const u = rj.includes?.users?.[0] || {};
      root = { text: rj.data.text, author: { username: u.username, name: u.name, avatar: big(u.profile_image_url) } };
    }

    const params = {
      query: `conversation_id:${conv} has:media -is:retweet`,
      max_results: '100',
      'tweet.fields': 'created_at,public_metrics,author_id,attachments,entities,note_tweet',
      expansions: 'attachments.media_keys,author_id',
      'media.fields': 'type,url,preview_image_url,width,height,variants',
      'user.fields': 'username,name,profile_image_url,public_metrics,verified,verified_type',
    };
    if (next) params.next_token = next;
    // recent search covers 7 days; older threads use full-archive search
    const sj = await get(older ? '/tweets/search/all' : '/tweets/search/recent', params);

    const media = new Map((sj.includes?.media || []).map(m => [m.media_key, m]));
    const users = new Map((sj.includes?.users || []).map(u => [u.id, u]));
    const items = (sj.data || []).filter(t => t.id !== id).map(t => {
      const u = users.get(t.author_id) || {};
      const m = (t.attachments?.media_keys || []).map(k => media.get(k)).filter(Boolean).map(m => {
        const src = m.type === 'photo' ? m.url : m.preview_image_url;
        const mp4 = (m.variants || []).filter(v => v.content_type === 'video/mp4' && /^https:\/\/video\.twimg\.com\//.test(v.url || '')).sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
        const pick = mp4.find(v => (v.bit_rate || 0) <= 2200000) || mp4[mp4.length - 1];
        return { type: m.type === 'animated_gif' ? 'gif' : m.type, w: m.width, h: m.height, url: sized(src, 'large'), thumb: sized(src, 'small'), video: pick && pick.url };
      }).filter(m => m.url);
      return {
        id: t.id,
        url: `https://x.com/${u.username || 'i'}/status/${t.id}`,
        text: cleanText(t),
        links: linksOf(t),
        created_at: t.created_at,
        likes: t.public_metrics?.like_count || 0,
        reposts: t.public_metrics?.retweet_count || 0,
        replies: t.public_metrics?.reply_count || 0,
        quotes: t.public_metrics?.quote_count || 0,
        bookmarks: t.public_metrics?.bookmark_count || 0,
        author: { username: u.username || '', name: u.name || '', avatar: big(u.profile_image_url), followers: u.public_metrics?.followers_count || 0, verified: !!u.verified, vtype: u.verified_type || (u.verified ? 'blue' : 'none') },
        media: m,
      };
    }).filter(x => x.media.length);

    const res = json({ root, items, next: sj.meta?.next_token || null });
    res.headers.set('cache-control', `public, max-age=${CACHE_TTL}`);
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

// full text (long posts too) with t.co links swapped for their real address, media links removed
function cleanText(t) {
  let text = t.note_tweet?.text || t.text || '';
  const urls = [...(t.note_tweet?.entities?.urls || []), ...(t.entities?.urls || [])];
  for (const u of urls) {
    if (!u.url) continue;
    const isMedia = u.media_key || /^(pic\.x\.com|pic\.twitter\.com)/.test(u.display_url || '') || /\/(photo|video)\/\d+$/.test(u.expanded_url || '');
    text = text.split(u.url).join(isMedia ? '' : (u.unwound_url || u.expanded_url || u.url));
  }
  return text.replace(/^(@\w+\s+)+/, '').replace(/[ \t]+\n/g, '\n').trim();
}
// outbound links (marketplaces etc.), never x.com links
function linksOf(t) {
  const urls = [...(t.note_tweet?.entities?.urls || []), ...(t.entities?.urls || [])];
  const out = [];
  for (const u of urls) {
    const href = u.unwound_url || u.expanded_url;
    if (!href || u.media_key) continue;
    try { const h = new URL(href).hostname.replace(/^www\./, ''); if (/(^|\.)(x|twitter)\.com$|^t\.co$|^pic\./.test(h)) continue; } catch { continue; }
    if (!out.includes(href)) out.push(href);
  }
  return out;
}

function sized(src, name) {
  if (!src) return '';
  try { const u = new URL(src); if (u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/')) { const ext = (u.pathname.match(/\.(\w+)$/) || [])[1] || 'jpg'; u.pathname = u.pathname.replace(/\.\w+$/, ''); u.search = `?format=${ext}&name=${name}`; } return u.toString(); }
  catch { return src; }
}
function big(src) { return src ? src.replace('_normal.', '_200x200.') : ''; }

/* ---------- free mode: FxTwitter public API (no key). One page per ranking: top-liked + newest, merged. ---------- */
const FX = 'https://api.fxtwitter.com/2/conversation/';
async function fxReplies(id, ctx, env) {
  const cache = caches.default;
  const key = new Request(`https://cache.shillscope/fx3/${id}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const kvKey = `fx:${id}`;
  const kv = env && env.STATS;
  const stored = kv ? await kv.get(kvKey, 'json').catch(() => null) : null;
  const fresh = stored && Date.now() - stored.t < 30 * 60e3;
  const reply = (body, put) => { const res = json(body); res.headers.set('cache-control', 'public, max-age=600'); if (put) ctx.waitUntil(cache.put(key, res.clone())); return res; };
  if (fresh) return reply(stored.body, true);       // shared across all Cloudflare locations
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let lastStatus = 0;
  const pull = async mode => {
    for (let i = 0; i < 3; i++) {                      // 1 try + 2 retries
      try {
        const r = await fetch(`${FX}${id}?ranking_mode=${mode}`, { headers: { 'User-Agent': 'shillscope/1.0 (+https://shillscope.amiraphist.workers.dev)', 'Accept': 'application/json' } });
        lastStatus = r.status;
        if (r.ok) { const j = await r.json().catch(() => null); if (j && j.status) return j; }
        if (r.status === 404) return null;            // really missing
      } catch { lastStatus = lastStatus || 502; }
      await sleep(600 * (i + 1));
    }
    return null;
  };
  try {
    const [a, b] = await Promise.all([pull('likes'), pull('recency')]);
    const base = a || b;
    if (!base || !base.status) {
      if (stored) return reply(stored.body, false);   // stale copy beats an error
      if (lastStatus === 404) return json({ error: 'could not read this post (deleted, private or not found)' }, 404);
      return json({ error: 'x is busy right now, try again in a minute' }, 503);
    }
    const st = base.status;
    const root = { text: st.text || '', author: { username: st.author?.screen_name, name: st.author?.name, avatar: st.author?.avatar_url } };
    const seen = new Set(); const items = [];
    for (const t of [...(a?.replies || []), ...(b?.replies || [])]) {
      if (!t || seen.has(t.id) || t.id === id) continue; seen.add(t.id);
      const x = fxItem(t); if (x.media.length && x.author.username !== root.author.username) items.push(x);   // skip the host's own replies
    }
    const body = { root, items, next: null, source: 'fxtwitter' };
    if (kv) ctx.waitUntil(kv.put(kvKey, JSON.stringify({ t: Date.now(), body }), { expirationTtl: 86400 }).catch(() => {}));
    return reply(body, true);
  } catch (e) {
    if (stored) return reply(stored.body, false);
    return json({ error: e.message }, 502);
  }
}
function fxMedia(list) {
  return (list || []).map(m => {
    const src = m.type === 'photo' ? m.url : (m.thumbnail_url || m.url);
    if (!src) return null;
    const vid = m.type !== 'photo' && /^https:\/\/video\.twimg\.com\//.test(m.url || '') ? m.url : undefined;
    return { type: m.type === 'photo' ? 'photo' : (m.type === 'gif' ? 'gif' : 'video'), w: m.width, h: m.height, url: sized(src, 'large'), thumb: sized(src, 'small'), video: vid };
  }).filter(Boolean);
}
function fxItem(t) {
  const a = t.author || {};
  let media = fxMedia(t.media?.all);
  if (!media.length && t.quote && t.quote.author?.screen_name === a.screen_name) media = fxMedia(t.quote.media?.all);  // artist quoting their own art post
  const links = [];
  for (const f of (t.raw_text?.facets || [])) {
    if (f.type !== 'url' || !f.replacement) continue;
    try { const h = new URL(f.replacement).hostname.replace(/^www\./, ''); if (/(^|\.)(x|twitter)\.com$|^t\.co$|^pic\./.test(h)) continue; } catch { continue; }
    if (!links.includes(f.replacement)) links.push(f.replacement);
  }
  const v = a.verification || {};
  const vtype = !v.verified ? 'none' : v.type === 'government' ? 'government' : (v.type === 'organization' || v.type === 'business') ? 'business' : 'blue';
  return {
    id: t.id,
    url: t.url || `https://x.com/${a.screen_name || 'i'}/status/${t.id}`,
    text: (t.text || '').replace(/^(@\w+\s*)+/, '').replace(/[ \t]+\n/g, '\n').trim(),
    links,
    created_at: t.created_at,
    likes: t.likes || 0, reposts: t.reposts || 0, replies: t.replies || 0, quotes: t.quotes || 0, bookmarks: t.bookmarks || 0,
    author: { username: a.screen_name || '', name: a.name || '', avatar: a.avatar_url || '', followers: a.followers || 0, verified: !!v.verified, vtype },
    media,
  };
}

/* ---------- private stats page: /stats?k=STATS_KEY ---------- */
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const flag = (cc) => /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0))) : '·';
const REFN = { 't.co': 'X', 'com.twitter.android': 'X app (android)', 'direct': 'direct' };
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

async function stats(url, env) {
  const nf = new Response('not found', { status: 404, headers: SEC });
  if (!env.STATS_KEY || url.searchParams.get('k') !== env.STATS_KEY || !env.STATS) return nf;
  const keys = []; let cur;
  do { const l = await env.STATS.list({ prefix: 'd:', cursor: cur }); keys.push(...l.keys.map((k) => k.name)); cur = l.list_complete ? null : l.cursor; } while (cur);
  keys.sort();
  const days = await Promise.all(keys.map(async (k) => ({ d: k.slice(2), ...((await env.STATS.get(k, 'json')) || {}) })));
  const today = new Date().toISOString().slice(0, 10);
  const td = days.find((x) => x.d === today) || { d: today, v: 0, g: 0 };
  const tot = { v: 0, g: 0, ref: {}, c: {}, dev: {}, os: {}, br: {} };
  for (const x of days) { tot.v += x.v || 0; tot.g += x.g || 0; for (const f of ['ref', 'c', 'dev', 'os', 'br']) for (const [k, n] of Object.entries(x[f] || {})) { const kk = f === 'ref' ? (REFN[k] || k) : k; tot[f][kk] = (tot[f][kk] || 0) + n; } }
  let post = null;
  try {
    const r = await fetch('https://api.fxtwitter.com/2/status/2112497567359758697', { cf: { cacheTtl: 600, cacheEverything: true }, headers: { 'user-agent': 'shillscope' } });
    if (r.ok) post = (await r.json()).status;
  } catch (e) {}
  const last = days.slice(-14); const mx = Math.max(1, ...last.map((x) => x.v || 0));
  const bars = last.map((x) => `<div class="b"><i style="height:${Math.round(((x.v || 0) / mx) * 100)}%"><em style="height:${x.v ? Math.round(((x.g || 0) / (x.v || 1)) * 100) : 0}%"></em></i><span>${fmt(x.v)}</span><small>${esc(x.d.slice(5).replace('-', '/'))}</small></div>`).join('');
  const list = (o, lab = (k) => esc(k), n = 8) => { const e = Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n); const t = e.reduce((a, b) => a + b[1], 0) || 1; return e.length ? e.map(([k, v]) => `<li><b>${lab(k)}</b><span class="bar"><i style="width:${Math.round((v / t) * 100)}%"></i></span><em>${fmt(v)}</em></li>`).join('') : '<li class="mute">nothing yet</li>'; };
  const conv = tot.v ? Math.round((tot.g / tot.v) * 100) : 0;
  const tile = (n, l, hot) => `<div class="t${hot ? ' hot' : ''}"><strong>${n}</strong><span>${l}</span></div>`;
  const postBlock = post ? `<section><h2>launch post <a href="https://x.com/amiraphist/status/2112497567359758697">open ↗</a></h2><div class="tiles">${tile(fmt(post.views), 'views', 1)}${tile(fmt(post.likes), 'likes')}${tile(fmt(post.reposts), 'reposts')}${tile(fmt(post.quotes), 'quotes')}${tile(fmt(post.replies), 'replies')}${tile(fmt(post.bookmarks), 'bookmarks')}</div></section>` : '';
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#000"><title>shillscope · stats</title>
<link rel="icon" type="image/svg+xml" href="https://amiraphist.github.io/shillscope/favicon.svg"><link rel="apple-touch-icon" href="https://amiraphist.github.io/shillscope/apple-touch-icon.png">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#050505;--card:rgba(255,255,255,.035);--fg:#ededed;--mute:#7c7c7c;--line:#1f1f1f;--acc:#e0242b}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--fg);font-family:'Space Grotesk',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body{min-height:100vh;padding:max(28px,env(safe-area-inset-top)) 18px 60px;background:radial-gradient(120% 60% at 50% -10%,rgba(224,36,43,.16),transparent 60%),var(--bg)}
body::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.06;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
main{max-width:760px;margin:0 auto;position:relative}
a{color:inherit;text-decoration:none}
.mono,h2,small,.t span,.b span,.b small,li em,header p{font-family:'JetBrains Mono',monospace;letter-spacing:.03em;text-transform:lowercase}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:26px}
h1{font-weight:700;font-size:clamp(40px,11vw,72px);letter-spacing:-.055em;line-height:.9}
h1 span{color:var(--acc)}
header p{font-size:11px;color:var(--mute);text-align:right;line-height:1.6}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--acc);box-shadow:0 0 10px var(--acc);margin-right:6px;animation:p 2s infinite}
@keyframes p{50%{opacity:.35}}
section{position:relative;border:1px solid rgba(255,255,255,.1);background:var(--card);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-radius:22px;padding:18px;margin-bottom:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
h2{font-size:11px;font-weight:500;color:var(--mute);margin-bottom:14px;display:flex;justify-content:space-between}
h2 a{color:#cfcfcf;border-bottom:1px solid rgba(255,255,255,.25)}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.t{border-radius:16px;padding:14px 12px;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.02));border:.5px solid rgba(255,255,255,.12)}
.t strong{display:block;font-size:30px;font-weight:700;letter-spacing:-.04em;line-height:1}
.t span{display:block;font-size:10.5px;color:var(--mute);margin-top:6px}
.t.hot{background:linear-gradient(180deg,rgba(240,60,66,.85),rgba(200,22,30,.6) 60%,rgba(240,60,66,.7));border-color:rgba(255,255,255,.35);box-shadow:inset 0 1px 1px rgba(255,255,255,.55),0 6px 22px rgba(224,36,43,.35)}
.t.hot span{color:rgba(255,255,255,.8)}
.chart{display:flex;align-items:flex-end;gap:6px;height:150px;padding-top:18px}
.b{flex:1;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;position:relative;min-width:0}
.b i{display:flex;align-items:flex-end;width:100%;max-width:34px;min-height:2px;border-radius:8px 8px 3px 3px;background:rgba(255,255,255,.14);overflow:hidden}
.b em{display:block;width:100%;background:var(--acc)}
.b span{position:absolute;top:0;font-size:10px;color:#cfcfcf}
.b small{font-size:9px;color:var(--mute);margin-top:6px}
.legend{display:flex;gap:14px;margin-top:12px;font-size:10.5px;color:var(--mute)}
.legend i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:-1px;background:rgba(255,255,255,.18)}.legend i.r{background:var(--acc)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.grid section{margin:0}
ul{list-style:none}
li{display:grid;grid-template-columns:minmax(0,1.1fr) 1fr auto;align-items:center;gap:10px;padding:6px 0;font-size:13.5px}
li b{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar{height:6px;border-radius:9px;background:rgba(255,255,255,.07);overflow:hidden}.bar i{display:block;height:100%;border-radius:9px;background:linear-gradient(90deg,#e0242b,#ff5a60)}
li em{font-style:normal;font-size:11px;color:#cfcfcf}
.mute{color:var(--mute);display:block}
footer{margin-top:22px;text-align:center;font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#555}
@media(max-width:560px){.grid{grid-template-columns:1fr}.t strong{font-size:24px}}
</style></head><body><main>
<header><h1>shill<span>scope</span></h1><p><span class="dot"></span>stats<br>${esc(now)} tehran</p></header>
<section><h2>today <span>utc day · ${esc(today)}</span></h2><div class="tiles">${tile(fmt(td.v), 'visits', 1)}${tile(fmt(td.g), 'galleries')}${tile(td.v ? Math.round(((td.g || 0) / td.v) * 100) + '%' : '–', 'used it')}</div></section>
<section><h2>all time <span>since ${esc(days[0] ? days[0].d : today)}</span></h2><div class="tiles">${tile(fmt(tot.v), 'visits')}${tile(fmt(tot.g), 'galleries')}${tile(conv + '%', 'used it')}</div></section>
<section><h2>daily <span>last ${last.length} days</span></h2><div class="chart">${bars || '<p class="mute">nothing yet</p>'}</div><div class="legend"><span><i></i>visits</span><span><i class="r"></i>share that built a gallery</span></div></section>
${postBlock}
<div class="grid">
<section><h2>from</h2><ul>${list(tot.ref)}</ul></section>
<section><h2>countries</h2><ul>${list(tot.c, (k) => flag(k) + ' ' + esc(k), 10)}</ul></section>
<section><h2>device</h2><ul>${list(tot.dev)}</ul></section>
<section><h2>system</h2><ul>${list(tot.os)}</ul></section>
<section><h2>app / browser</h2><ul>${list(tot.br)}</ul></section>
</div>
<footer>private · pull to refresh</footer>
</main></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SEC, 'x-robots-tag': 'noindex',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https://amiraphist.github.io; frame-ancestors 'none'; base-uri 'none'" } });
}
