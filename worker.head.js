/**
 * shillscope — Cloudflare Worker (one file: the page + a small API proxy).
 *
 * Setup (free Cloudflare account):
 *   1. Workers & Pages → Create → Worker → paste this file → Deploy.
 *   2. Settings → Variables and Secrets → add Secret  X_BEARER_TOKEN  = your X API bearer token.
 *   3. (optional) add Secret  ACCESS_KEY  = any password, so only you can spend your API credits.
 *
 * Cost: X API pay-per-use. Only replies that contain media are requested (has:media),
 * and each page is cached for 30 minutes so reloading a thread doesn't bill twice.
 */
const HTML = 