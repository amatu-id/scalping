// amatu-exness — relay feed resmi Exness (Exness Trader API) untuk Amatu Scalping (amatu-id.github.io/scalping).
// Halaman tidak bisa memanggil Exness langsung: permintaan harus ditandatangani Ed25519 (kunci privat wajib di server)
// dan *.exness.com diblokir DNS sebagian ISP Indonesia. Relay ini hanya MEMBACA harga; tidak ada rute order.
//
//   GET …/amatu-exness/status                                   → {siap, ok, galat, batas}  (tanpa login, tanpa rahasia)
//   GET …/amatu-exness/candles?sym=BTCUSDm&tf=M1&from=ISO&count=N   header x-amatu   → {t[],o[],h[],l[],c[],v[]} (harga Bid)
//   GET …/amatu-exness/ws?t=<token>&sym=BTCUSDm,XAUUSDm         (WebSocket)        → {i,b,a,t} tiap tick (Bid/Ask)
//
// Rahasia (supabase secrets set …): EXN_API_KEY, EXN_PRIVATE_KEY (hex 128/64 dari Exness, atau PEM PKCS#8),
//   EXN_ACCOUNT_ID, EXN_GATEWAY (host dari widget DNS Key Management; bawaan api.exness.com lalu api.exness-api.com),
//   EXN_TEST_TOKEN (opsional, hanya untuk uji teknis tanpa login portal).
// Deploy: supabase functions deploy amatu-exness --project-ref ieyqxmzztoxgpvwexbkj --no-verify-jwt --use-api

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-amatu',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const SB = Deno.env.get('SUPABASE_URL') || '', ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const API_KEY = (Deno.env.get('EXN_API_KEY') || '').trim();
const PRIV = Deno.env.get('EXN_PRIVATE_KEY') || '';
const ACCOUNT = (Deno.env.get('EXN_ACCOUNT_ID') || '').trim().replace(/^#/, '');
const TEST_TOKEN = (Deno.env.get('EXN_TEST_TOKEN') || '').trim();
const GATEWAYS = [Deno.env.get('EXN_GATEWAY') || '', 'https://api.exness.com', 'https://api.exness-api.com']
  .map((g) => g.trim().replace(/\/+$/, '')).filter(Boolean).map((g) => (/^https?:\/\//.test(g) ? g : 'https://' + g))
  .filter((g, i, a) => a.indexOf(g) === i);
const SIMBOL = new Set(['BTCUSDm', 'XAUUSDm']);
const TF = new Set(['M1', 'M5']);

const out = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } });
const siap = () => !!(API_KEY && PRIV && /^\d{1,20}$/.test(ACCOUNT));

// ------------------------------------------------------------------ tanda tangan EXN-* (Ed25519, sign version 1)
const enc = new TextEncoder();
function b64u(buf: ArrayBuffer | Uint8Array) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function dariB64(s: string) {
  const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}
const PKCS8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
let kunci: CryptoKey | null = null;
async function kunciPrivat() {
  if (kunci) return kunci;
  const s = PRIV.replace(/-----(BEGIN|END)[A-Z ]*-----/g, '').replace(/\s+/g, '');
  let seed: Uint8Array;
  if (/^[0-9a-fA-F]{64}$/.test(s) || /^[0-9a-fA-F]{128}$/.test(s)) seed = Uint8Array.from(s.slice(0, 64).match(/../g)!.map((h) => parseInt(h, 16)));
  else {
    const b = dariB64(s);
    if (b.length === 48 && PKCS8.every((v, i) => b[i] === v)) seed = b.slice(16);
    else if (b.length === 32 || b.length === 64) seed = b.slice(0, 32);
    else throw new Error('KUNCI_FORMAT');
  }
  const der = new Uint8Array(48); der.set(PKCS8); der.set(seed, 16);
  kunci = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
  return kunci;
}
async function tandaTangan(method: string, pathQuery: string, body = '') {
  const ts = Date.now();
  const bodyHash = b64u(await crypto.subtle.digest('SHA-256', enc.encode(body)));
  // urutan field mengikuti contoh resmi; "/" tidak di-escape
  const data = enc.encode(`{"api_key":${JSON.stringify(API_KEY)},"idempotency_key":"","timestamp":${ts},"sign_version":1,` +
    `"method":${JSON.stringify(method)},"path":${JSON.stringify(pathQuery)},"body_hash":${JSON.stringify(bodyHash)}}`);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, await kunciPrivat(), data);
  return {
    'EXN-API-KEY': API_KEY, 'EXN-IDEMPOTENCY-KEY': '', 'EXN-TIMESTAMP': String(ts), 'EXN-SIGN-VERSION': '1',
    'EXN-DATA': b64u(data), 'EXN-SIGN': b64u(sig),
  };
}

// ------------------------------------------------------------------ access point (di-cache; discovery dibatasi Exness)
class GalatExn extends Error {
  constructor(public status: number, public kode: string) { super(kode); }
}
function kodeGalat(status: number, j: unknown) {
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  const e = (o.error && typeof o.error === 'object' ? o.error : o) as Record<string, unknown>;
  return String(e.error_message || e.code || e.message || `HTTP_${status}`);
}
let AP: { url: string; t: number } | null = null;
async function accessPoint() {
  if (AP && Date.now() - AP.t < 6 * 3600e3) return AP.url;
  let galat: GalatExn | null = null;
  for (const g of GATEWAYS) {
    const pq = `/v1/trading/access-point?account_id=${ACCOUNT}`;
    try {
      const r = await fetch(g + pq, { headers: await tandaTangan('GET', pq), signal: AbortSignal.timeout(10e3) });
      const j = await r.json().catch(() => null) as Record<string, unknown> | null;
      if (r.ok && j && j.access_point) {
        let u = String(j.access_point).trim().replace(/\/+$/, '');
        if (!/^https?:\/\//.test(u)) u = 'https://' + u;
        AP = { url: u, t: Date.now() };
        return u;
      }
      if (r.status === 404 && g !== GATEWAYS[GATEWAYS.length - 1]) { galat = new GalatExn(404, 'DISCOVERY_404'); continue; }
      galat = new GalatExn(r.status, kodeGalat(r.status, j));
      if (r.status === 401 || r.status === 403 || r.status === 400) break;   // masalah kunci/akun: gateway lain sama saja
    } catch (e) { galat = new GalatExn(0, 'JARINGAN: ' + String((e as Error).message || e).slice(0, 120)); }
  }
  throw galat || new GalatExn(0, 'ACCESS_POINT');
}
async function exn(pathQuery: string) {
  const ap = await accessPoint();
  const r = await fetch(ap + pathQuery, { headers: await tandaTangan('GET', pathQuery), signal: AbortSignal.timeout(15e3) });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 404 || r.status === 421 || r.status === 503) AP = null;
    throw new GalatExn(r.status, kodeGalat(r.status, j));
  }
  return j as Record<string, unknown>;
}
let BATAS: { lilin: number; t: number } | null = null;
async function batas() {
  if (BATAS && Date.now() - BATAS.t < 3600e3) return BATAS;
  let lilin = 1000;
  try {
    const j = await exn(`/v1/configuration/accounts/${ACCOUNT}/limits`);
    const ms = ((j.limits as Record<string, unknown>)?.rest as Record<string, unknown>)?.methods as Array<Record<string, unknown>> | undefined;
    const m = (ms || []).find((x) => x.api_operation_id === 'getCandleHistory' || /candles/.test(String(x.path || '')));
    const v = Number((m?.limits as Record<string, unknown> | undefined)?.max_candles_per_request);
    if (v > 0) lilin = v;
  } catch (e) { if (e instanceof GalatExn && (e.status === 401 || e.status === 403)) throw e; }
  BATAS = { lilin, t: Date.now() };
  return BATAS;
}

// ------------------------------------------------------------------ login portal (seperti amatu-translate)
const seen = new Map<string, { u: string; until: number }>();
async function who(token: string) {
  if (TEST_TOKEN.length >= 32 && token === TEST_TOKEN) return 'uji';
  if (!/^[0-9a-f]{64}$/.test(token) || !SB) return '';
  const c = seen.get(token);
  if (c && c.until > Date.now()) return c.u;
  const r = await fetch(`${SB}/rest/v1/rpc/amt_status`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: token }), signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => null);
  const u = (r.ok && j && j.user) || '';
  if (u) { if (seen.size > 500) seen.clear(); seen.set(token, { u, until: Date.now() + 10 * 60e3 }); }
  return u;
}
const hits = new Map<string, number[]>();
function busy(key: string, max: number) {
  const now = Date.now(), h = (hits.get(key) || []).filter((t) => now - t < 60e3);
  if (h.length >= max) return true;
  h.push(now); hits.set(key, h);
  return false;
}

// ------------------------------------------------------------------ rute
async function status(req: Request) {
  if (!siap()) return out({ siap: false, ok: false, galat: 'BELUM_DIKONFIGURASI' });
  const ip = req.headers.get('x-forwarded-for') || '';
  if (busy('status|' + ip, 30)) return out({ siap: true, ok: false, galat: 'TERLALU_CEPAT' }, 429);
  const t0 = Date.now();
  try {
    await kunciPrivat();
    await accessPoint();
    const b = await batas();
    return out({ siap: true, ok: true, galat: null, batas: { lilin: b.lilin }, ms: Date.now() - t0 }, 200, { 'Cache-Control': 'no-store' });
  } catch (e) {
    const g = e instanceof GalatExn ? e.kode : String((e as Error).message || e);
    return out({ siap: true, ok: false, galat: g, ms: Date.now() - t0 });
  }
}

async function candles(url: URL) {
  const sym = url.searchParams.get('sym') || '', tf = url.searchParams.get('tf') || '';
  const from = url.searchParams.get('from') || '', count = Math.trunc(Number(url.searchParams.get('count') || 0));
  if (!SIMBOL.has(sym) || !TF.has(tf) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(from) || !count) return out({ error: 'data' }, 400);
  const b = await batas();
  const n = Math.max(-b.lilin, Math.min(b.lilin, count));
  const pq = `/v1/market-data/accounts/${ACCOUNT}/candles?instrument=${sym}&price_type=bid&timeframe=${tf}&from=${from}&count=${n}`;
  const j = await exn(pq);
  const cs = (j.candles as Array<Record<string, unknown>>) || [];
  const r = { t: [] as number[], o: [] as number[], h: [] as number[], l: [] as number[], c: [] as number[], v: [] as number[] };
  for (const x of cs) {
    const s = (x.bid && typeof x.bid === 'object' ? x.bid : x) as Record<string, number>;
    const t = Date.parse(String(x.time));
    if (!Number.isFinite(t)) continue;
    r.t.push(t); r.o.push(+s.open); r.h.push(+s.high); r.l.push(+s.low); r.c.push(+s.close); r.v.push(+(x.volume as number) || 0);
  }
  return out(r, 200, { 'Cache-Control': 'no-store' });
}

/** cari objek tick {instrument, bid, ask, timestamp} di dalam pesan Exness (bentuk amplop bisa berbeda) */
function cariTick(x: unknown, hasil: Array<Record<string, unknown>>, dalam = 0) {
  if (!x || typeof x !== 'object' || dalam > 4) return;
  if (Array.isArray(x)) { for (const y of x) cariTick(y, hasil, dalam + 1); return; }
  const o = x as Record<string, unknown>;
  if (typeof o.bid === 'number' && typeof o.ask === 'number' && (o.instrument || o.symbol)) { hasil.push(o); return; }
  for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') cariTick(o[k], hasil, dalam + 1);
}

async function ws(req: Request, url: URL) {
  if ((req.headers.get('upgrade') || '').toLowerCase() !== 'websocket') return out({ error: 'ws' }, 400);
  const u = await who(url.searchParams.get('t') || '');
  if (!u) return new Response('auth', { status: 401, headers: CORS });
  if (busy('ws|' + u, 40)) return new Response('cepat', { status: 429, headers: CORS });
  const syms = (url.searchParams.get('sym') || 'BTCUSDm,XAUUSDm').split(',').filter((s) => SIMBOL.has(s));
  const { socket, response } = Deno.upgradeWebSocket(req);
  let up: WebSocket | null = null, hidup: number | undefined, lain = 0;
  const kirim = (o: unknown) => { try { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(o)); } catch { /* klien sudah pergi */ } };
  const selesai = (alasan: unknown) => { clearInterval(hidup); kirim({ tutup: alasan }); try { socket.close(); } catch { /* */ } try { up?.close(); } catch { /* */ } };
  socket.onopen = async () => {
    try {
      const ap = await accessPoint();
      const path = `/v1/server-events/accounts/${ACCOUNT}/ws/ticks`;
      // Deno: header kustom + subprotocol pada handshake (handshake ditandatangani sebagai GET dengan path persis)
      // deno-lint-ignore no-explicit-any
      up = new (WebSocket as any)(ap.replace(/^http/, 'ws') + path, { protocols: ['exness-ws-protocol'], headers: await tandaTangan('GET', path) }) as WebSocket;
      up.onopen = () => {
        up!.send(JSON.stringify({ id: 'amatu-' + crypto.randomUUID().slice(0, 8), subscribe: { event: 'ticks', instruments: syms } }));
        kirim({ siap: syms });
      };
      up.onmessage = (e) => {
        let j: unknown;
        try { j = JSON.parse(String(e.data)); } catch { return; }
        const t: Array<Record<string, unknown>> = [];
        cariTick(j, t);
        if (t.length) {
          for (const x of t) {
            const ts = Date.parse(String(x.timestamp || x.time || ''));
            kirim({ i: x.instrument || x.symbol, b: x.bid, a: x.ask, t: Number.isFinite(ts) ? ts : Date.now() });
          }
        } else {
          const o = (j || {}) as Record<string, unknown>;
          if (o.error_message || o.code) kirim({ galat: o.error_message || o.code });
          else if (lain++ < 5) kirim({ info: JSON.stringify(j).slice(0, 300) });
        }
      };
      up.onclose = (e) => selesai({ hulu: e.code, alasan: String(e.reason || '').slice(0, 120) });
      up.onerror = () => kirim({ galat: 'HULU_GALAT' });
      hidup = setInterval(() => kirim({ p: Date.now() }), 20e3);
    } catch (e) {
      selesai({ galat: e instanceof GalatExn ? e.kode : String((e as Error).message || e).slice(0, 160) });
    }
  };
  socket.onclose = () => { clearInterval(hidup); try { up?.close(); } catch { /* */ } };
  socket.onerror = () => { try { up?.close(); } catch { /* */ } };
  return response;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') return out({ error: 'method' }, 405);
  const url = new URL(req.url), path = url.pathname.split('/').filter(Boolean).pop() || '';
  try {
    if (path === 'status') return await status(req);
    if (!siap()) return out({ error: 'BELUM_DIKONFIGURASI' }, 503);
    if (path === 'ws') return await ws(req, url);
    if (path === 'candles') {
      const u = await who(req.headers.get('x-amatu') || '');
      if (!u) return out({ error: 'auth' }, 401);
      if (busy('c|' + u, 240)) return out({ error: 'cepat' }, 429);
      return await candles(url);
    }
    return out({ error: 'path' }, 404);
  } catch (e) {
    if (e instanceof GalatExn) return out({ error: e.kode, status: e.status }, e.status >= 400 && e.status < 600 ? e.status : 502);
    return out({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
});
