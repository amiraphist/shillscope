;

const X = 'https://api.x.com/2';
const CACHE_TTL = 1800;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/api/replies') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'x-access-key', 'access-control-max-age': '86400' } });
      const r = await replies(req, url, env, ctx);
      const out = new Response(r.body, r); for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v); return out;
    }
    return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', ...SEC,
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; media-src https://video.twimg.com https://amiraphist.github.io; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'" } });
  },
};

const CORS = { 'access-control-allow-origin': '*', 'vary': 'origin' };
const SEC = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'strict-transport-security': 'max-age=31536000' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...SEC } });

async function replies(req, url, env, ctx) {
  if (env.ACCESS_KEY && req.headers.get('x-access-key') !== env.ACCESS_KEY) return json({ error: 'access key needed' }, 401);
  const id = url.searchParams.get('id') || '';
  const next = url.searchParams.get('next') || '';
  if (!/^\d{5,25}$/.test(id)) return json({ error: 'bad post id' }, 400);
  if (!env.X_BEARER_TOKEN) return fxReplies(id, ctx);   // free mode (no X API key): FxTwitter

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
async function fxReplies(id, ctx) {
  const cache = caches.default;
  const key = new Request(`https://cache.shillscope/fx3/${id}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const pull = async mode => {
    const r = await fetch(`${FX}${id}?ranking_mode=${mode}`, { headers: { 'User-Agent': 'shillscope/1.0 (+https://shillscope.amiraphist.workers.dev)' } });
    if (!r.ok) return null;
    return r.json().catch(() => null);
  };
  try {
    const [a, b] = await Promise.all([pull('likes'), pull('recency')]);
    const base = a || b;
    if (!base || !base.status) return json({ error: 'could not read this post (deleted, private or not found)' }, 404);
    const st = base.status;
    const root = { text: st.text || '', author: { username: st.author?.screen_name, name: st.author?.name, avatar: st.author?.avatar_url } };
    const seen = new Set(); const items = [];
    for (const t of [...(a?.replies || []), ...(b?.replies || [])]) {
      if (!t || seen.has(t.id) || t.id === id) continue; seen.add(t.id);
      const x = fxItem(t); if (x.media.length && x.author.username !== root.author.username) items.push(x);   // skip the host's own replies
    }
    const res = json({ root, items, next: null, source: 'fxtwitter' });
    res.headers.set('cache-control', 'public, max-age=600');
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch (e) {
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
