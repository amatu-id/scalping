'use strict';
/* Amatu Scalping · mesin (Web Worker) · versi %%VERSI%%
 * - Data  : Binance spot publik. BTCUSDm = BTCUSDT ÷ USDCUSDT (Exness memakai USD, bukan USDT) + selisih kalibrasi Exness;
 *           XAUUSDm = PAXGUSDT × rasio (kalibrasi harga Exness, cadangan spot gold-api.com), candle di luar jam pasar emas dibuang.
 *           Semua harga yang dikirim ke halaman berbasis BID seperti chart & judul tab Exness (tengah − spread/2). REST data-api.binance.vision + WebSocket data-stream.binance.vision.
 * - Rekam : semua candle 1m/5m disimpan di IndexedDB 'amatu-scalping' (hanya di perangkat ini) dan terus bertambah.
 * - Batas : Batas Atas/Bawah = puncak & lembah GELOMBANG terakhir (zigzag: berbalik ≥ r × ATR), struktur HH/HL/LH/LL.
 * - Setup : pola candle di zona gelombang (tolak, pin bar, engulfing, high wave, BOS/CHoCH) + konteks price action
 *           (struktur, tren EMA). Kombinasi dipilih otomatis dari uji riwayat 4 periode, biaya spread ikut dihitung.
 * - Detik : status, peluang sentuh, posisi virtual dan P/L dihitung ulang tiap detik. */

const MENIT = 6e4, JAM = 36e5, HARI = 864e5, WIB = 7 * JAM;
const TF_MS = { '1m': MENIT, '5m': 5 * MENIT };
const TFS = ['1m', '5m'];
const SYMS = ['BTCUSDT', 'XAUUSDm'];
const INFO = {
  BTCUSDT: { seri: 'BTCUSDT', kontrak: 1, emas: false },
  XAUUSDm: { seri: 'PAXGUSDT', kontrak: 100, emas: true },
};
const SERI = ['BTCUSDT', 'PAXGUSDT'];
const SYM_DARI = { BTCUSDT: 'BTCUSDT', PAXGUSDT: 'XAUUSDm' };
const SIMPAN = { '1m': [14, 60], '5m': [90, 365] };   // hari diunduh awal, hari maksimum direkam
const MAXB = { '1m': 30, '5m': 24 };                   // posisi ditutup paksa setelah N candle
const HZ = { '1m': 15, '5m': 12 };                     // jendela peluang sentuh (candle)
const TAMPIL = 1500;
const R_BAKU = 2.5;   // ukuran gelombang bawaan (× ATR) sebelum optimizer memilih
const GRID = { r: [1.5, 2.5, 4], p: ['tolak', 'pin', 'engulf', 'hw', 'bos'], ctx: ['none', 'with', 'against', 'range', 'ema+', 'ema-', 'with+'], s: [0.1, 0.3, 0.6], tp: ['R1', 'R1.5', 'R2', 'wave', 'mid'] };
const ALGO = 3;   // naikkan bila grid / aturan uji berubah → hasil tersimpan diuji ulang
const GAYA_WR = { winrate: 0.52, seimbang: 0.38, rr: 0 };
const GAYA_URUT = { winrate: ['winrate', 'seimbang', 'rr'], seimbang: ['seimbang', 'rr'], rr: ['rr'] };
const HOSTS = ['https://data-api.binance.vision/api/v3', 'https://api1.binance.com/api/v3', 'https://api2.binance.com/api/v3',
  'https://api3.binance.com/api/v3', 'https://api.binance.com/api/v3'];
const WS_URL = 'wss://data-stream.binance.vision/stream?streams=btcusdt@kline_1s/paxgusdt@kline_1s/paxgusdt@bookTicker/usdcusdt@bookTicker';

const SET = { lot: 0.01, spread: { BTCUSDT: 6.4, XAUUSDm: 0.24 }, gaya: 'seimbang' };
const KAL = { BTCUSDT: null, XAUUSDm: null };   // kalibrasi ke harga Exness: BTC {d (USD)}, XAU {k (rasio)}
let LIHAT = { sym: 'BTCUSDT', tf: '1m' };
const STATUS = { ws: false, wsT: 0, rest: 0, galat: '', unduh: null };
const DATA = new Map();   // 'SERI|tf' → Seri
const AN = new Map();     // 'SYM|tf' → Analisis
const HARGA = {};         // seri → {p, t, bid, ask}
let RASIO = { k: 1, t: 0, spot: 0 };
let KURS = 18200;

// ------------------------------------------------------------------ waktu
let geser = 0;
const geserS = [];
const kini = () => Date.now() + geser;
const tidur = ms => new Promise(r => setTimeout(r, ms));
function jamServer(E) {
  if (!E) return;
  geserS.push(E - Date.now());
  if (geserS.length > 60) geserS.shift();
  if (geserS.length % 15 === 0) { const m = Math.max(...geserS); geser = Math.abs(m) > 700 ? m : 0; }
}
const jamWib = t => Math.floor(((t + WIB) % HARI + HARI) % HARI / JAM);

// jam pasar emas (New York): tutup Jumat ≥17.00, Sabtu, Minggu <18.00, jeda harian 17.00–18.00
let fmtNy = null;
const nyCache = new Map();
function nyOff(t) {
  const d = Math.floor(t / HARI);
  let o = nyCache.get(d);
  if (o === undefined) {
    try {
      fmtNy = fmtNy || new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
      o = +fmtNy.format(new Date(d * HARI + 12 * JAM)) - 12;
      if (!Number.isFinite(o)) o = -5;
    } catch (e) { o = -5; }
    nyCache.set(d, o);
  }
  return o;
}
function emasBuka(t) {
  const n = new Date(t + nyOff(t) * JAM), wd = n.getUTCDay(), h = n.getUTCHours();
  if (wd === 6) return false;
  if (wd === 5 && h >= 17) return false;
  if (wd === 0 && h < 18) return false;
  return h !== 17;
}
function bukaBerikut(t) {
  let x = Math.ceil(t / (5 * MENIT)) * 5 * MENIT;
  for (let i = 0; i < 1500 && !emasBuka(x); i++) x += 5 * MENIT;
  return x;
}
const bukaSeri = seri => seri === 'PAXGUSDT' ? emasBuka : null;

// ------------------------------------------------------------------ seri candle (typed array, terurut waktu)
class Seri {
  constructor(seri, tf) {
    this.seri = seri; this.tf = tf; this.key = seri + '|' + tf; this.ms = TF_MS[tf];
    this.buka = bukaSeri(seri); this.n = 0; this.cap = 0; this.kotor = new Set(); this.versi = 0;   // versi naik bila indeks bergeser
    this._alloc(4096);
  }
  _alloc(cap) {
    for (const f of ['t', 'o', 'h', 'l', 'c', 'v']) {
      const a = new Float64Array(cap);
      if (this[f]) a.set(this[f].subarray(0, Math.min(this.n, cap)));
      this[f] = a;
    }
    this.cap = cap;
  }
  get awal() { return this.n ? this.t[0] : 0; }
  get akhir() { return this.n ? this.t[this.n - 1] : 0; }
  cari(t) { let lo = 0, hi = this.n; while (lo < hi) { const m = (lo + hi) >> 1; if (this.t[m] < t) lo = m + 1; else hi = m; } return lo; }
  _tandai(t) { this.kotor.add(Math.floor(t / (this.ms * 1440))); }
  _set(i, r) { this.t[i] = r[0]; this.o[i] = r[1]; this.h[i] = r[2]; this.l[i] = r[3]; this.c[i] = r[4]; this.v[i] = r[5]; }
  /** rows terurut [[t,o,h,l,c,v]…]; waktu sama ditimpa. Kembalikan jumlah candle baru. */
  gabung(rows) {
    if (this.buka) rows = rows.filter(r => this.buka(r[0]));
    if (!rows.length) return 0;
    let baru = 0;
    const cepat = rows.every(r => r[0] > this.akhir || (this.n && r[0] >= this.awal && this.t[this.cari(r[0])] === r[0]));
    if (cepat) {
      for (const r of rows) {
        if (r[0] > this.akhir || !this.n) {
          if (this.n >= this.cap) this._alloc(Math.ceil(this.cap * 1.5) + 1024);
          this._set(this.n++, r); baru++;
        } else this._set(this.cari(r[0]), r);
        this._tandai(r[0]);
      }
      return baru;
    }
    // gabung penuh (isi mundur / celah di tengah)
    const m = this.n + rows.length, B = {};
    for (const f of ['t', 'o', 'h', 'l', 'c', 'v']) B[f] = new Float64Array(Math.max(4096, m + 2048));
    let i = 0, j = 0, k = 0;
    while (i < this.n || j < rows.length) {
      let r;
      if (j >= rows.length || (i < this.n && this.t[i] < rows[j][0])) { r = [this.t[i], this.o[i], this.h[i], this.l[i], this.c[i], this.v[i]]; i++; }
      else { r = rows[j]; if (i < this.n && this.t[i] === r[0]) i++; else baru++; j++; this._tandai(r[0]); }
      if (k && B.t[k - 1] === r[0]) k--;
      B.t[k] = r[0]; B.o[k] = r[1]; B.h[k] = r[2]; B.l[k] = r[3]; B.c[k] = r[4]; B.v[k] = r[5]; k++;
    }
    Object.assign(this, B); this.n = k; this.cap = B.t.length; this.versi++;
    return baru;
  }
  /** tick 1 detik / harga hidup → candle berjalan */
  tick(t, o, h, l, c, v) {
    const bs = Math.floor(t / this.ms) * this.ms;
    if (this.buka && !this.buka(bs)) return;
    if (!this.n || bs > this.akhir) { this.gabung([[bs, o, h, l, c, v]]); return; }
    if (bs < this.akhir) return;
    const i = this.n - 1;
    if (h > this.h[i]) this.h[i] = h;
    if (l < this.l[i]) this.l[i] = l;
    this.c[i] = c; this.v[i] += v;
  }
  buang(sebelum) {   // buang candle lebih tua dari waktu ini (memori)
    const a = this.cari(sebelum); if (a <= 0) return;
    for (const f of ['t', 'o', 'h', 'l', 'c', 'v']) this[f].copyWithin(0, a, this.n);
    this.n -= a; this.versi++;
  }
}

// ------------------------------------------------------------------ IndexedDB (rekaman lokal)
let DB = null;
const KV = new Map();
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
async function bukaDb() {
  if (typeof indexedDB === 'undefined') return;
  try {
    DB = await new Promise((res, rej) => {
      const r = indexedDB.open('amatu-scalping', 1);
      r.onupgradeneeded = () => { const d = r.result; for (const s of ['potong', 'kv']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
    });
    const st = DB.transaction('kv').objectStore('kv');
    const [ks, vs] = await Promise.all([req(st.getAllKeys()), req(st.getAll())]);
    ks.forEach((k, i) => KV.set(k, vs[i]));
  } catch (e) { DB = null; }
}
function kvSet(k, v) {
  KV.set(k, v);
  if (DB) try { DB.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch (e) { /* abaikan */ }
}
const kunciPotong = (S, k) => S.key + '|' + String(k).padStart(8, '0');
async function muatSeri(S) {
  if (!DB) return;
  try {
    const vals = await req(DB.transaction('potong').objectStore('potong').getAll(IDBKeyRange.bound(S.key + '|', S.key + '|~')));
    let n = 0; for (const v of vals) n += v.t.length;
    if (!n) return;
    S.n = 0; S._alloc(n + 4096);
    let ok = true, prev = -1;
    for (const v of vals) for (let i = 0; i < v.t.length; i++) {
      const k = S.n++;
      S.t[k] = v.t[i]; S.o[k] = v.o[i]; S.h[k] = v.h[i]; S.l[k] = v.l[i]; S.c[k] = v.c[i]; S.v[k] = v.v[i];
      if (S.t[k] <= prev) ok = false; prev = S.t[k];
    }
    if (!ok) {   // jaga-jaga: urutkan & buang ganda
      const rows = []; for (let i = 0; i < S.n; i++) rows.push([S.t[i], S.o[i], S.h[i], S.l[i], S.c[i], S.v[i]]);
      rows.sort((a, b) => a[0] - b[0]); S.n = 0; S.gabung(rows);
    }
    S.kotor.clear();
  } catch (e) { /* mulai kosong */ }
}
async function simpanSeri(S) {
  if (!DB || !S.kotor.size) return;
  const ks = [...S.kotor]; S.kotor.clear();
  const P = S.ms * 1440;
  try {
    const tx = DB.transaction('potong', 'readwrite'), st = tx.objectStore('potong');
    for (const k of ks) {
      const a = S.cari(k * P), b = S.cari((k + 1) * P);
      if (b <= a) st.delete(kunciPotong(S, k));
      else st.put({ t: S.t.slice(a, b), o: S.o.slice(a, b), h: S.h.slice(a, b), l: S.l.slice(a, b), c: S.c.slice(a, b), v: S.v.slice(a, b) }, kunciPotong(S, k));
    }
    await txDone(tx);
  } catch (e) { ks.forEach(k => S.kotor.add(k)); }
}
async function pangkasSeri(S) {
  const batas = kini() - SIMPAN[S.tf][1] * HARI;
  if (S.n && S.awal < batas) S.buang(batas);
  if (!DB) return;
  try {
    const P = S.ms * 1440, kb = Math.floor(batas / P);
    const tx = DB.transaction('potong', 'readwrite');
    tx.objectStore('potong').delete(IDBKeyRange.bound(S.key + '|', kunciPotong(S, kb), false, true));
    await txDone(tx);
  } catch (e) { /* abaikan */ }
}
async function hapusSemua() {
  if (DB) { try { const tx = DB.transaction(['potong', 'kv'], 'readwrite'); tx.objectStore('potong').clear(); tx.objectStore('kv').clear(); await txDone(tx); } catch (e) { /* */ } }
  KV.clear();
}

// ------------------------------------------------------------------ jaringan
class GalatHttp extends Error { constructor(s) { super('HTTP ' + s); this.status = s; } }
let hostI = 0, hostT = 0;
async function ambilJson(url, ms = 10000) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, cache: 'no-store' });
    if (!r.ok) throw new GalatHttp(r.status);
    return await r.json();
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('waktu habis');
    throw e;
  } finally { clearTimeout(tm); }
}
async function klines(seri, tf, start, limit = 1000, ms = 10000) {
  if (hostI && Date.now() - hostT > 600000) hostI = 0;
  const i = hostI;
  const q = `symbol=${seri}&interval=${tf}&limit=${limit}` + (start != null ? `&startTime=${Math.floor(start)}` : '');
  try {
    const rows = await ambilJson(`${HOSTS[i]}/klines?${q}`, ms);
    STATUS.rest = Date.now(); STATUS.galat = '';
    return rows.map(k => [+k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
  } catch (e) {
    if (!(e instanceof GalatHttp) && hostI === i) { hostI = (i + 1) % HOSTS.length; hostT = Date.now(); }
    STATUS.galat = String(e && e.message || e);
    throw e;
  }
}
async function klinesUlang(seri, tf, start, limit = 1000) {
  let e0;
  for (let k = 0; k < 4; k++) {
    try { return await klines(seri, tf, start, limit); }
    catch (e) { e0 = e; if (e instanceof GalatHttp && e.status !== 429 && e.status < 500) throw e; await tidur(700 * 2 ** k); }
  }
  throw e0;
}
const ANTRE = { jalan: 0, maks: 6, tunggu: [] };
async function slot(fn) {
  if (ANTRE.jalan >= ANTRE.maks) await new Promise(r => ANTRE.tunggu.push(r));
  ANTRE.jalan++;
  try { return await fn(); } finally { ANTRE.jalan--; const r = ANTRE.tunggu.shift(); if (r) r(); }
}

/** Lengkapi riwayat S sampai `hari` ke belakang + sampai sekarang (potongan 1000 candle paralel). */
async function isiRiwayat(S, hari, prog) {
  const ms = S.ms, now = kini(), mulai = Math.floor((now - hari * HARI) / ms) * ms;
  const titik = [];
  const rentang = (a, b) => { for (let s = a; s <= b; s += 1000 * ms) titik.push(s); };
  const cakup = KV.get('cakup|' + S.key) || Infinity;
  if (!S.n) rentang(mulai, now);
  else {
    if (S.awal - ms > mulai && cakup > mulai) rentang(mulai, S.awal - ms);
    rentang(S.akhir, now);
  }
  let beres = 0, galat = null;
  await Promise.all(titik.map(s => slot(() => klinesUlang(S.seri, S.tf, s)).then(rows => {
    S.gabung(rows); beres++;
    if (prog) prog(beres, titik.length);
  }).catch(e => { galat = e; })));
  if (galat) throw galat;
  if (mulai < cakup) kvSet('cakup|' + S.key, mulai);
  await tambalCelah(S);
}
const celahDicoba = new Set();
async function tambalCelah(S) {
  const ms = S.ms, celah = [];
  for (let i = 1; i < S.n && celah.length < 30; i++) {
    const a = S.t[i - 1], b = S.t[i];
    if (b - a <= 1.5 * ms) continue;
    const k = S.key + a;
    if (celahDicoba.has(k)) continue;
    if (S.buka) { let ada = false; for (let x = a + ms; x < b; x += 5 * MENIT) if (S.buka(x)) { ada = true; break; } if (!ada) continue; }
    celahDicoba.add(k); celah.push([a + ms, b]);
  }
  for (const [a, b] of celah) {
    for (let s = a, k = 0; s < b && k < 20; k++) {
      const rows = await slot(() => klinesUlang(S.seri, S.tf, s)).catch(() => []);
      if (!rows.length) break;
      S.gabung(rows);
      const akhir = rows[rows.length - 1][0];
      if (akhir >= b || rows.length < 1000) break;
      s = akhir + S.ms;
    }
  }
}

// ------------------------------------------------------------------ harga hidup (WebSocket + cadangan REST)
let ws = null, wsCoba = 0, wsJadwal = null;
function sambungWs() {
  if (typeof WebSocket === 'undefined') return;
  clearTimeout(wsJadwal);
  try { ws = new WebSocket(WS_URL); } catch (e) { jadwalWs(); return; }
  const w = ws;
  w.onopen = () => { wsCoba = 0; STATUS.ws = true; };
  w.onmessage = ev => { try { const m = JSON.parse(ev.data); terima(m.stream, m.data); } catch (e) { /* abaikan */ } };
  w.onclose = () => { if (ws === w) { STATUS.ws = false; jadwalWs(); } };
  w.onerror = () => { try { w.close(); } catch (e) { /* */ } };
}
function jadwalWs() { clearTimeout(wsJadwal); wsJadwal = setTimeout(sambungWs, Math.min(30000, 1000 * 2 ** wsCoba++)); }
function terima(stream, d) {
  if (!d) return;
  STATUS.wsT = Date.now();
  if (d.e === 'kline') {
    const k = d.k, seri = d.s;
    jamServer(d.E);
    const c = +k.c;
    for (const tf of TFS) { const S = DATA.get(seri + '|' + tf); if (S) S.tick(+k.t, +k.o, +k.h, +k.l, c, +k.v); }
    const H = HARGA[seri] || (HARGA[seri] = {});
    if (seri === 'BTCUSDT' || !H.bid || Date.now() - H.t > 5000) { H.p = c; H.t = Date.now(); }
    HARGA[seri].trade = c;
  } else if (d.b && d.a && d.s) {      // bookTicker PAXG → harga tengah
    const b = +d.b, a = +d.a, mid = (b + a) / 2, seri = d.s;
    HARGA[seri] = { p: mid, t: Date.now(), bid: b, ask: a, trade: (HARGA[seri] || {}).trade };
    const t = kini();
    for (const tf of TFS) { const S = DATA.get(seri + '|' + tf); if (S) S.tick(t, mid, mid, mid, mid, 0); }
  }
}
let pollJalan = false;
async function pollRest() {     // dipakai saat WebSocket putus
  if (pollJalan) return; pollJalan = true;
  try {
    await Promise.all(SERI.map(async seri => {
      if (seri === 'PAXGUSDT' && !emasBuka(kini())) return;
      const rows = await klines(seri, '1m', null, 2, 4000);
      for (const tf of TFS) { const S = DATA.get(seri + '|' + tf); if (S) { const r = rows[rows.length - 1]; S.tick(r[0], r[1], r[2], r[3], r[4], 0); } }
      HARGA[seri] = { p: rows[rows.length - 1][4], t: Date.now() };
    }));
  } catch (e) { /* coba lagi detik berikut */ } finally { pollJalan = false; }
}

// spot emas → rasio XAUUSDm / PAXGUSDT
async function spotEmas() {
  const buka = emasBuka(kini());
  // pasar tutup: spot = harga penutupan, jadi bandingkan dengan candle PAXG terakhir di jam pasar (bukan PAXG akhir pekan)
  const S = DATA.get('PAXGUSDT|1m'), tutupT = S && S.n ? S.akhir : 0;
  if (!buka && (!tutupT || RASIO.tutup === tutupT)) return;
  try {
    const d = await ambilJson('https://api.gold-api.com/price/XAU', 8000);
    const p = +(d && d.price || 0), pg = buka ? ((HARGA.PAXGUSDT || {}).p || lastClose('PAXGUSDT')) : lastClose('PAXGUSDT');
    if (p > 100 && pg > 100) {
      let k = p / pg;
      if (buka && RASIO.t && !RASIO.tutup) {
        const old = RASIO.k;
        if (Math.abs(k / old - 1) > 0.02) k = old * (1 + 0.02 * Math.sign(k - old));
        k = old * 0.7 + k * 0.3;
      }
      RASIO = { k, t: Date.now(), spot: p, tutup: buka ? 0 : tutupT };
      kvSet('rasio', RASIO);
    }
  } catch (e) { /* tetap rasio lama */ }
}
async function ambilKurs() {
  try {
    const d = await ambilJson('https://open.er-api.com/v6/latest/USD', 8000);
    const v = +d.rates.IDR; if (v > 5000 && v < 50000) { KURS = v; kvSet('kurs', { v, t: Date.now() }); }
  } catch (e) { /* tetap */ }
}
/** USDCUSDT lewat REST (awal & cadangan bila WebSocket diam) */
async function ambilUsdc() {
  const H = HARGA.USDCUSDT;
  if (H && Date.now() - H.t < 60000) return;
  try {
    const d = await ambilJson(`${HOSTS[hostI]}/ticker/bookTicker?symbol=USDCUSDT`, 6000);
    const b = +d.bidPrice, a = +d.askPrice;
    if (b > 0.9 && a < 1.1) HARGA.USDCUSDT = { p: (b + a) / 2, t: Date.now(), bid: b, ask: a };
  } catch (e) { /* pakai nilai lama */ }
}
/** Samakan dengan Exness: bid = harga Bid yang terlihat di terminal Exness saat ini. */
function kalibrasi(sym, bid, reset) {
  if (reset) { KAL[sym] = null; return { kal: null }; }
  bid = +bid;
  if (!(bid > 0)) return { galat: 'Angka harga tidak valid.' };
  const exMid = bid + SET.spread[sym] / 2, raw = hargaKini(sym);
  if (!raw) return { galat: 'Harga Binance belum tersedia, coba lagi sebentar.' };
  if (sym === 'BTCUSDT') {
    const d = exMid - raw * faktorUsd();
    if (Math.abs(d) > raw * 0.02) return { galat: `Selisih ${Math.round(d)} terlalu besar — periksa angka (contoh 67306.76).` };
    KAL.BTCUSDT = { d, t: Date.now(), bid };
  } else {
    const k = exMid / raw, kLama = RASIO.k || k;
    if (Math.abs(k / kLama - 1) > 0.03) return { galat: 'Selisih terlalu besar — periksa angka (contoh 3883.075).' };
    KAL.XAUUSDm = { k, t: Date.now(), bid, d: exMid - raw * kLama };
  }
  return { kal: KAL[sym] };
}
function lastClose(seri) { const S = DATA.get(seri + '|1m'); return S && S.n ? S.c[S.n - 1] : 0; }
/** faktor USD: Exness BTCUSD memakai dolar AS, Binance memakai USDT (USDCUSDT ≈ harga 1 USD dalam USDT) */
function faktorUsd() { const u = HARGA.USDCUSDT; return u && u.p > 0.9 && u.p < 1.1 ? 1 / u.p : 1; }
const skala = sym => sym === 'XAUUSDm' ? ((KAL.XAUUSDm && KAL.XAUUSDm.k) || RASIO.k || 1) : faktorUsd();
/** geser harga tampilan: selisih kalibrasi Exness (BTC) − setengah spread (harga Bid, seperti di Exness) */
const geserHarga = sym => (sym === 'BTCUSDT' && KAL.BTCUSDT ? KAL.BTCUSDT.d : 0) - SET.spread[sym] / 2;
/** harga internal (Binance) → harga tampilan Exness Bid. Jarak/selisih cukup dikali skala(). */
const hp = (sym, x) => x * skala(sym) + geserHarga(sym);
const biayaInternal = sym => SET.spread[sym] / skala(sym);
function hargaKini(sym) {
  const seri = INFO[sym].seri, H = HARGA[seri];
  if (INFO[sym].emas && !emasBuka(kini())) return lastClose(seri);   // pasar emas tutup: harga beku di penutupan
  if (H && H.p && Date.now() - H.t < 120000) return H.p;
  return lastClose(seri);
}

// ------------------------------------------------------------------ indikator, gelombang (zigzag ATR) & struktur price action
const ZONA = 0.3;   // zona sentuh di sekitar puncak / lembah gelombang (× ATR)
/** ATR14, EMA50/200 dan GELOMBANG: puncak/lembah dikonfirmasi saat harga berbalik ≥ r × ATR dari titik ekstremnya.
 *  WH/WL[i] = puncak/lembah gelombang terakhir yang SUDAH terkonfirmasi sebelum candle i (dipakai untuk keputusan di candle i). */
function hitungInd(S, r) {
  const n = S.n, A = new Float64Array(n), E50 = new Float64Array(n), E200 = new Float64Array(n);
  const k50 = 2 / 51, k200 = 2 / 201; let s = 0;
  for (let i = 0; i < n; i++) {
    const tr = i ? Math.max(S.h[i] - S.l[i], Math.abs(S.h[i] - S.c[i - 1]), Math.abs(S.l[i] - S.c[i - 1])) : S.h[i] - S.l[i];
    if (i < 14) { s += tr; A[i] = s / (i + 1); } else A[i] = (A[i - 1] * 13 + tr) / 14;
    E50[i] = i ? S.c[i] * k50 + E50[i - 1] * (1 - k50) : S.c[i];
    E200[i] = i ? S.c[i] * k200 + E200[i - 1] * (1 - k200) : S.c[i];
  }
  const WH = new Float64Array(n), WL = new Float64Array(n), WH2 = new Float64Array(n), WL2 = new Float64Array(n);
  const WHi = new Int32Array(n), WLi = new Int32Array(n), piv = [];
  let dir = 1, upP = n ? S.h[0] : 0, upI = 0, dnP = n ? S.l[0] : 0, dnI = 0;
  let lH = NaN, lH2 = NaN, lL = NaN, lL2 = NaN, lHi = -1, lLi = -1;
  for (let i = 0; i < n; i++) {
    WH[i] = lH; WL[i] = lL; WH2[i] = lH2; WL2[i] = lL2; WHi[i] = lHi; WLi[i] = lLi;
    const a = A[i ? i - 1 : 0];
    if (dir === 1) {
      if (S.h[i] > upP) { upP = S.h[i]; upI = i; }
      if (S.l[i] <= upP - r * a) {
        piv.push({ i: upI, p: upP, tipe: 1, lbl: Number.isNaN(lH) ? 'H' : upP > lH ? 'HH' : 'LH' });
        lH2 = lH; lH = upP; lHi = upI; dir = -1; dnP = S.l[i]; dnI = i;
      }
    } else {
      if (S.l[i] < dnP) { dnP = S.l[i]; dnI = i; }
      if (S.h[i] >= dnP + r * a) {
        piv.push({ i: dnI, p: dnP, tipe: -1, lbl: Number.isNaN(lL) ? 'L' : dnP > lL ? 'HL' : 'LL' });
        lL2 = lL; lL = dnP; lLi = dnI; dir = 1; upP = S.h[i]; upI = i;
      }
    }
  }
  return { A, E50, E200, WH, WL, WH2, WL2, WHi, WLi, piv, r, n, versi: S.versi,
    akhir: { wh: lH, wl: lL, wh2: lH2, wl2: lL2, whi: lHi, wli: lLi, dir, extP: dir === 1 ? upP : dnP, extI: dir === 1 ? upI : dnI } };
}
/** +1 = naik (HH & HL), −1 = turun (LH & LL), 0 = datar / campuran */
const struktur = (wh, wl, wh2, wl2) => (wh > wh2 && wl > wl2) ? 1 : (wh < wh2 && wl < wl2) ? -1 : 0;
/** level gelombang yang berlaku untuk candle i (candle berjalan sesudah hitungan terakhir → keadaan akhir hitungan) */
function levelDi(I, i) {
  if (i < I.n) { const j = i ? i - 1 : 0; return { wh: I.WH[i], wl: I.WL[i], wh2: I.WH2[i], wl2: I.WL2[i], whi: I.WHi[i], wli: I.WLi[i], a: I.A[j], up: I.E50[j] > I.E200[j] }; }
  const z = I.akhir, j = I.n - 1;
  return { wh: z.wh, wl: z.wl, wh2: z.wh2, wl2: z.wl2, whi: z.whi, wli: z.wli, a: I.A[j], up: I.E50[j] > I.E200[j] };
}
const POLA = ['tolak', 'pin', 'engulf', 'hw', 'bos'];
const KONTEKS = ['none', 'with', 'against', 'range', 'ema+', 'ema-', 'with+'];
/** pola candle di candle i terhadap level gelombang lv → [side, ekstremAtas, ekstremBawah] atau null.
 *  Pola balik (tolak/pin/engulf/hw) harus di zona puncak (SELL) / lembah (BUY) dan candle tutup di dalam gelombang. */
function polaDi(S, i, p, lv) {
  const wh = lv.wh, wl = lv.wl, a = lv.a;
  if (!(wh > wl) || !(a > 0) || i < 1) return null;
  const o = S.o[i], h = S.h[i], l = S.l[i], c = S.c[i], o1 = S.o[i - 1], h1 = S.h[i - 1], l1 = S.l[i - 1], c1 = S.c[i - 1];
  if (p === 'bos') {
    if (c > wh + 0.1 * a && c1 <= wh) return [1, h, l];
    if (c < wl - 0.1 * a && c1 >= wl) return [-1, h, l];
    return null;
  }
  if (!(c < wh && c > wl)) return null;
  const rng = h - l || 1e-12, body = Math.abs(c - o), up = h - Math.max(o, c), lw = Math.min(o, c) - l;
  let jual = false, beli = false;
  if (p === 'tolak') { jual = h >= wh; beli = l <= wl; }
  else if (p === 'pin') {
    jual = up >= 0.5 * rng && body <= 0.35 * rng && h >= wh - ZONA * a;
    beli = lw >= 0.5 * rng && body <= 0.35 * rng && l <= wl + ZONA * a;
  } else if (p === 'engulf') {
    const b1 = Math.abs(c1 - o1);
    jual = c < o && c1 > o1 && o >= c1 && c <= o1 && body > b1 && Math.max(h, h1) >= wh - ZONA * a;
    beli = c > o && c1 < o1 && o <= c1 && c >= o1 && body > b1 && Math.min(l, l1) <= wl + ZONA * a;
  } else if (p === 'hw') {
    const r1 = h1 - l1 || 1e-12, b1 = Math.abs(c1 - o1), u1 = h1 - Math.max(o1, c1), w1 = Math.min(o1, c1) - l1;
    const hw = b1 <= 0.25 * r1 && u1 >= 0.3 * r1 && w1 >= 0.3 * r1 && r1 >= 0.8 * a;
    jual = hw && c < l1 && h1 >= wh - ZONA * a;
    beli = hw && c > h1 && l1 <= wl + ZONA * a;
  }
  if (jual === beli) return null;
  return [jual ? -1 : 1, Math.max(h, h1), Math.min(l, l1)];
}
function lolosKonteks(ctx, side, lv) {
  if (ctx === 'none') return true;
  const st = struktur(lv.wh, lv.wl, lv.wh2, lv.wl2);
  switch (ctx) {
    case 'with': return st === side;
    case 'against': return st === -side;
    case 'range': return st === 0;
    case 'ema+': return (side === 1) === lv.up;
    case 'ema-': return (side === 1) !== lv.up;
    case 'with+': return st === side && (side === 1) === lv.up;
  }
  return false;
}
function hitungSl(cfg, side, ph, pl, lv) {
  if (cfg.p === 'bos') return side > 0 ? pl - cfg.s * lv.a : ph + cfg.s * lv.a;
  return side < 0 ? Math.max(ph, lv.wh) + cfg.s * lv.a : Math.min(pl, lv.wl) - cfg.s * lv.a;
}
function hitungTp(cfg, side, entry, risk, lv) {
  switch (cfg.tp) {
    case 'R1': return entry + side * risk;
    case 'R1.5': return entry + side * 1.5 * risk;
    case 'R2': return entry + side * 2 * risk;
    case 'wave': return cfg.p === 'bos' ? entry + side * (lv.wh - lv.wl) : side < 0 ? lv.wl : lv.wh;
    default: return (lv.wh + lv.wl) / 2;   // 'mid'
  }
}
/** setup lengkap di candle i (pola + konteks) → {side, ph, pl, lv} | {tolak:true, side} | null */
function cekSetup(cfg, S, I, i) {
  const lv = levelDi(I, i), r = polaDi(S, i, cfg.p, lv);
  if (!r) return null;
  if (!lolosKonteks(cfg.ctx, r[0], lv)) return { tolak: true, side: r[0], lv };
  return { side: r[0], ph: r[1], pl: r[2], lv };
}
/** semua kejadian pola p di candle [i0, i1−1) — dihitung sekali per (gelombang, pola) untuk optimizer */
function eventPola(S, I, p, i0, i1) {
  const ev = [];
  for (let i = Math.max(i0, 220); i < i1 - 1; i++) {
    const lv = levelDi(I, i), r = polaDi(S, i, p, lv);
    if (r) ev.push({ i, side: r[0], ph: r[1], pl: r[2], lv });
  }
  return ev;
}
/** Uji setup pada candle [i0, i1). folds = jumlah periode. catat = simpan daftar trade. Satu posisi pada satu waktu. */
function uji(S, I, cfg, biaya, i0, i1, folds, catat, ev) {
  ev = ev || eventPola(S, I, cfg.p, i0, i1);
  const F = [];
  for (let f = 0; f < folds; f++) F.push({ n: 0, w: 0, tp: 0, sl: 0, gp: 0, gl: 0, s: 0, sa: 0, bTp: 0 });
  const tr = catat ? [] : null, maxb = MAXB[S.tf], span = Math.max(1, i1 - i0);
  const H = S.h, Lo = S.l, C = S.c, O = S.o;
  let bebas = 0;
  for (const e of ev) {
    const i = e.i;
    if (i < bebas || i < i0 || i >= i1 - 1) continue;
    const side = e.side, lv = e.lv;
    if (!lolosKonteks(cfg.ctx, side, lv)) continue;
    const entry = C[i], sl = hitungSl(cfg, side, e.ph, e.pl, lv), risk = Math.abs(entry - sl);
    if (!(risk > 0)) continue;
    const tp = hitungTp(cfg, side, entry, risk, lv);
    if (side * (tp - entry) <= biaya) continue;
    let cara = 0, keluar = 0, j = i + 1;
    const jEnd = i + maxb;
    for (; j <= jEnd && j < i1; j++) {
      if (side < 0 ? H[j] >= sl : Lo[j] <= sl) { keluar = side < 0 ? Math.max(sl, O[j]) : Math.min(sl, O[j]); cara = 2; break; }
      if (side < 0 ? Lo[j] <= tp : H[j] >= tp) { keluar = tp; cara = 1; break; }
    }
    if (!cara) { if (j > jEnd) { j = jEnd; keluar = C[j]; cara = 3; } else break; }
    const pnl = side * (keluar - entry) - biaya, a = lv.a;
    const f = F[Math.min(folds - 1, Math.floor((i - i0) / span * folds))];
    f.n++; if (pnl > 0) { f.w++; f.gp += pnl; } else f.gl -= pnl;
    if (cara === 1) { f.tp++; f.bTp += j - i; } else if (cara === 2) f.sl++;
    f.s += pnl; f.sa += pnl / a;
    if (tr) tr.push({ i, j, side, entry, keluar, sl, tp, cara, pnl, a });
    bebas = j + 1;
  }
  return { F, tr };
}
function jumlah(F) {
  const t = { n: 0, w: 0, tp: 0, sl: 0, gp: 0, gl: 0, s: 0, sa: 0, bTp: 0 };
  for (const f of F) for (const k in t) t[k] += f[k];
  return t;
}
function skor(F, gaya, minN) {
  const t = jumlah(F);
  if (t.n < minN) return null;
  const wr = t.w / t.n, pf = t.gl ? t.gp / t.gl : 9, eA = t.sa / t.n;
  const pos = F.filter(f => f.n >= 4 && f.s > 0).length;
  if (pos < F.length - 1 || eA <= 0 || pf < 1.05) return null;
  if (wr < GAYA_WR[gaya]) return null;
  const mf = F.reduce((s, f) => s + (f.n ? f.sa / f.n : 0), 0) / F.length;
  return mf * (pos / F.length) * Math.sqrt(Math.min(t.n, 400) / 400);
}
const NAMA_POLA = { tolak: 'Tolak', pin: 'Pin bar', engulf: 'Engulfing', hw: 'High wave', bos: 'BOS' };
const KODE_POLA = { tolak: 'TOL', pin: 'PIN', engulf: 'ENG', hw: 'HW', bos: 'BOS' };
const NAMA_KTX = { none: '', with: 'searah struktur', against: 'melawan struktur', range: 'saat struktur datar', 'ema+': 'searah tren EMA', 'ema-': 'melawan tren EMA', 'with+': 'searah struktur & EMA' };
const namaPola = cfg => cfg.p === 'bos' && cfg.ctx === 'against' ? 'CHoCH' : NAMA_POLA[cfg.p];
const kodePola = cfg => cfg.p === 'bos' && cfg.ctx === 'against' ? 'CHoCH' : KODE_POLA[cfg.p];
function teksCfg(cfg) {
  const r = String(cfg.r).replace('.', ',');
  const pola = cfg.p === 'bos' ? (cfg.ctx === 'against' ? 'CHoCH: candle tutup menembus gelombang melawan struktur' : 'BOS: candle tutup menembus puncak/lembah gelombang')
    : cfg.p === 'tolak' ? 'Tolak: ekor menembus puncak/lembah gelombang lalu tutup kembali'
      : cfg.p === 'hw' ? 'High wave di puncak/lembah gelombang + candle konfirmasi' : `${NAMA_POLA[cfg.p]} di puncak/lembah gelombang`;
  const ktx = cfg.p === 'bos' && cfg.ctx === 'against' ? '' : NAMA_KTX[cfg.ctx];
  const sl = `SL ${cfg.p === 'bos' ? 'candle' : 'ekor'} + ${String(cfg.s).replace('.', ',')} ATR`;
  const tp = { R1: 'TP 1R', 'R1.5': 'TP 1,5R', R2: 'TP 2R', wave: cfg.p === 'bos' ? 'TP 1 gelombang' : 'TP gelombang seberang', mid: 'TP tengah gelombang' }[cfg.tp];
  return `${pola} · gelombang ≥ ${r} ATR${ktx ? ' · ' + ktx : ''} · ${sl} · ${tp}`;
}

// ------------------------------------------------------------------ analisis per simbol × TF
class Analisis {
  constructor(sym, tf) {
    this.sym = sym; this.tf = tf; this.key = sym + '|' + tf;
    this.S = DATA.get(INFO[sym].seri + '|' + tf);
    const c0 = KV.get('cfg|' + this.key), c = c0 && c0.algo === ALGO ? c0 : null;
    this.cfg = c && c.cfg || null; this.hasil = c && c.hasil || null;
    this.r = this.cfg ? this.cfg.r : R_BAKU;
    this.I = null; this.uji = []; this.exc = null; this.batasStat = null;
    this.jurnal = KV.get('jurnal|' + this.key) || [];
    const ak = KV.get('aktif|' + this.key);
    this.aktif = ak && ak.lv ? ak : null;                 // posisi format lama (sebelum gelombang) dibuang
    this.selesai = KV.get('selesai|' + this.key) || 0;
    this.siap = false; this.optJalan = false; this.optN = c && c.n || 0; this.optT = c && c.t || 0;
  }
  perbarui() { if (this.S.n > 60) this.I = hitungInd(this.S, this.r); }
  /** indeks seri bergeser (riwayat lama disisipkan di depan) → hitung ulang indikator & trade uji */
  segar() { if (this.I && this.I.versi !== this.S.versi) { this.perbarui(); hitungRinci(this); } }
}

async function optimalkan(An) {
  if (An.optJalan) return; An.optJalan = true;
  try {
    const S = An.S, i1 = S.n - 1, sym = An.sym, tf = An.tf;
    if (i1 < 800) return;
    const biaya = biayaInternal(sym), hari = (S.t[i1] - S.t[0]) / HARI;
    const minN = Math.max(40, Math.round(hari * (tf === '1m' ? 2 : 0.6)));
    const hasil = [];
    let k = 0;
    for (const r of GRID.r) {
      const I = hitungInd(S, r);
      for (const p of GRID.p) {
        const ev = eventPola(S, I, p, 0, i1);
        for (const ctx of GRID.ctx) for (const s of GRID.s) for (const tp of GRID.tp) {
          if (p === 'bos' && tp === 'mid') continue;
          const cfg = { r, p, ctx, s, tp };
          hasil.push({ cfg, F: uji(S, I, cfg, biaya, 0, i1, 4, false, ev).F });
          if (++k % 150 === 0) await tidur(0);
        }
        await tidur(0);
      }
    }
    let pilih = null, gayaDipakai = null;
    for (const g of GAYA_URUT[SET.gaya]) {
      let best = null, bs = -Infinity;
      for (const h of hasil) { const s = skor(h.F, g, minN); if (s != null && s > bs) { bs = s; best = h; } }
      if (best) { pilih = best; gayaDipakai = g; break; }
    }
    const lolosSemua = hasil.filter(h => skor(h.F, 'rr', minN) != null).length;
    An.optT = Date.now(); An.optN = S.n;
    if (!pilih) {
      An.cfg = null; An.r = R_BAKU;
      An.hasil = { aktif: false, gaya: SET.gaya, diuji: hasil.length, lolos: lolosSemua, hari, t: An.optT, spread: SET.spread[sym] };
    } else {
      An.cfg = pilih.cfg; An.r = pilih.cfg.r;
      An.hasil = ringkasHasil(An, pilih.F, { gaya: SET.gaya, gayaDipakai, diuji: hasil.length, lolos: lolosSemua, hari });
    }
    kvSet('cfg|' + An.key, { cfg: An.cfg, hasil: An.hasil, t: An.optT, n: An.optN, algo: ALGO });
    An.perbarui();
    hitungRinci(An);
  } finally { An.optJalan = false; }
}
function ringkasHasil(An, F, x) {
  const t = jumlah(F), k = skala(An.sym);
  return Object.assign({
    aktif: true, cfg: An.cfg, teks: teksCfg(An.cfg), pola: namaPola(An.cfg), n: t.n, wr: t.w / t.n, pf: t.gl ? t.gp / t.gl : 9,
    e: t.s / t.n * k, tpRate: t.tp / t.n, slRate: t.sl / t.n, eta: t.tp ? t.bTp / t.tp : 0,
    perHari: t.n / Math.max(1, x.hari), lolosP: F.filter(f => f.n >= 4 && f.s > 0).length,
    folds: F.map(f => ({ n: f.n, wr: f.n ? f.w / f.n : 0, e: f.n ? f.s / f.n * k : 0 })), t: Date.now(), spread: SET.spread[An.sym],
  }, x);
}
/** trade uji (penanda chart & statistik sesi), statistik zona gelombang, peluang sentuh. */
function hitungRinci(An) {
  const S = An.S, I = An.I; if (!I) return;
  const i1 = S.n - 1, k = skala(An.sym);
  if (An.cfg) {
    const { tr } = uji(S, I, An.cfg, biayaInternal(An.sym), 0, i1, 1, true);
    An.ujiSemua = tr;
    const sesi = SESI.map(s => ({ nama: s.nama, n: 0, w: 0, s: 0 }));
    for (const x of tr) { const s = sesi[sesiDari(jamWib(S.t[x.i]))]; s.n++; if (x.pnl > 0) s.w++; s.s += x.pnl * k; }
    An.sesi = sesi.map(s => ({ nama: s.nama, n: s.n, wr: s.n ? s.w / s.n : 0, e: s.n ? s.s / s.n : 0 }));
    const awalTampil = S.t[Math.max(0, S.n - TAMPIL)];
    An.uji = tr.filter(x => S.t[x.i] >= awalTampil).map(x => trJadi(An, x, 'uji'));
  } else { An.ujiSemua = []; An.uji = []; An.sesi = null; }
  // saat harga menyentuh puncak / lembah gelombang: tutup kembali di dalam (pantul) vs tembus — 30 hari terakhir
  let pu = 0, tu = 0, pl = 0, tl = 0;
  const i0 = Math.max(300, S.cari(S.t[i1] - 30 * HARI));
  for (let i = i0; i < i1; i++) {
    const wh = I.WH[i], wl = I.WL[i]; if (!(wh > wl)) continue;
    const su = S.h[i] >= wh, sl = S.l[i] <= wl;
    if (su && !sl) { if (S.c[i] < wh) pu++; else tu++; }
    if (sl && !su) { if (S.c[i] > wl) pl++; else tl++; }
  }
  An.batasStat = { pantulAtas: pu / Math.max(1, pu + tu), pantulBawah: pl / Math.max(1, pl + tl), n: pu + tu + pl + tl };
  // sebaran gerak maksimum H candle ke depan (dalam ATR) → peluang sentuh
  const Hn = HZ[An.tf], j0 = Math.max(20, i1 - 30000 - Hn), m = i1 - Hn - j0;
  if (m > 200) {
    const up = new Float32Array(m), dn = new Float32Array(m);
    for (let i = j0, q = 0; q < m; i++, q++) {
      let mx = -Infinity, mn = Infinity;
      for (let j = i + 1; j <= i + Hn; j++) { if (S.h[j] > mx) mx = S.h[j]; if (S.l[j] < mn) mn = S.l[j]; }
      const a = I.A[i] || 1; up[q] = (mx - S.c[i]) / a; dn[q] = (S.c[i] - mn) / a;
    }
    up.sort(); dn.sort(); An.exc = { up, dn };
  }
}
const SESI = [{ nama: 'Asia', a: 6, b: 14 }, { nama: 'Eropa', a: 14, b: 19 }, { nama: 'Amerika', a: 19, b: 24 }, { nama: 'Dini hari', a: 0, b: 6 }];
const sesiDari = h => SESI.findIndex(s => h >= s.a && h < s.b);
function peluang(arr, x) {
  if (!arr || !arr.length) return null;
  if (x <= 0) return 1;
  let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
  return 1 - lo / arr.length;
}
/** kebiasaan pasar per jam WIB & per hari, dari candle 5m (riwayat terpanjang). */
function hitungKebiasaan(sym) {
  const S = DATA.get(INFO[sym].seri + '|5m'); if (!S || S.n < 2000) return null;
  const k = skala(sym), i0 = S.cari(S.akhir - 120 * HARI);
  const J = Array.from({ length: 24 }, () => ({ tr: 0, n: 0, naik: 0, nj: 0, gerak: 0, rng: 0 }));
  let totTr = 0, totN = 0, jamMulai = -1, o = 0, hi = 0, lo = 0, c = 0, jamIni = -1;
  const tutupJam = () => { if (jamMulai < 0) return; const x = J[jamIni]; x.nj++; if (c > o) x.naik++; x.gerak += Math.abs(c - o); x.rng += hi - lo; };
  for (let i = i0; i < S.n - 1; i++) {
    const h = jamWib(S.t[i]), r = S.h[i] - S.l[i];
    J[h].tr += r; J[h].n++; totTr += r; totN++;
    const jm = Math.floor(S.t[i] / JAM);
    if (jm !== jamMulai) { tutupJam(); jamMulai = jm; jamIni = h; o = S.o[i]; hi = S.h[i]; lo = S.l[i]; }
    if (S.h[i] > hi) hi = S.h[i]; if (S.l[i] < lo) lo = S.l[i]; c = S.c[i];
  }
  const rata = totTr / Math.max(1, totN);
  const jam = J.map((x, h) => ({ h, vol: x.n ? x.tr / x.n / rata : 0, naik: x.nj ? x.naik / x.nj : 0.5, gerak: x.nj ? x.gerak / x.nj * k : 0, rng: x.nj ? x.rng / x.nj * k : 0, n: x.nj }));
  const D = Array.from({ length: 7 }, () => ({ s: 0, n: 0 }));
  let hk = -1, dh = 0, dl = 0, dw = 0;
  for (let i = i0; i < S.n; i++) {
    const t = S.t[i] + WIB, d = Math.floor(t / HARI);
    if (d !== hk) { if (hk >= 0) { D[dw].s += dh - dl; D[dw].n++; } hk = d; dw = new Date(t).getUTCDay(); dh = S.h[i]; dl = S.l[i]; }
    if (S.h[i] > dh) dh = S.h[i]; if (S.l[i] < dl) dl = S.l[i];
  }
  const hari = D.map((x, d) => ({ d, rng: x.n ? x.s / x.n * k : 0, n: x.n }));
  return { jam, hari, rataBar: rata * k, dari: S.t[i0], sampai: S.akhir };
}

// ------------------------------------------------------------------ posisi virtual (rekam sinyal live)
function trJadi(An, x, sumber) {
  const S = An.S, k = skala(An.sym);
  const q = v => hp(An.sym, v);
  return { t0: S.t[x.i], t1: S.t[x.j] + S.ms, side: x.side, entry: q(x.entry), keluar: q(x.keluar), sl: q(x.sl), tp: q(x.tp),
    hasil: ['', 'TP', 'SL', 'WKT'][x.cara], pnl: x.pnl * k, sumber, kode: An.cfg ? kodePola(An.cfg) : '' };
}
function bukaPosisi(An, i, st) {
  const S = An.S, cfg = An.cfg, side = st.side, entry = S.c[i];
  const sl = hitungSl(cfg, side, st.ph, st.pl, st.lv), risk = Math.abs(entry - sl);
  const tp = hitungTp(cfg, side, entry, risk, st.lv);
  if (!(risk > 0) || side * (tp - entry) <= biayaInternal(An.sym)) return;
  An.aktif = { side, entry, sl, tp, t0: S.t[i], tE: S.t[i] + S.ms, lv: { wh: st.lv.wh, wl: st.lv.wl }, a: st.lv.a, k: skala(An.sym),
    eD: hp(An.sym, entry), sD: hp(An.sym, sl), tD: hp(An.sym, tp),
    cfg: teksCfg(cfg), pola: namaPola(cfg), kode: kodePola(cfg) };
  kvSet('aktif|' + An.key, An.aktif);
  kirim({ op: 'sinyal', jenis: 'buka', sym: An.sym, tf: An.tf, side, entry: hp(An.sym, entry), pola: namaPola(cfg) });
}
function tutupPosisi(An, keluar, cara, t1) {
  const P = An.aktif; if (!P) return;
  const k = skala(An.sym), pnl = P.side * (keluar - P.entry) - biayaInternal(An.sym);
  const q = v => hp(An.sym, v);
  const x = { t0: P.t0, t1, side: P.side, entry: P.eD != null ? P.eD : q(P.entry), keluar: cara === 'TP' && P.tD != null ? P.tD : q(keluar), sl: P.sD != null ? P.sD : q(P.sl),
    tp: P.tD != null ? P.tD : q(P.tp), hasil: cara, pnl: pnl * k, sumber: 'live', kode: P.kode || '' };
  An.jurnal.push(x); if (An.jurnal.length > 400) An.jurnal.splice(0, An.jurnal.length - 400);
  An.aktif = null;
  kvSet('jurnal|' + An.key, An.jurnal); kvSet('aktif|' + An.key, null);
  kirim({ op: 'sinyal', jenis: 'tutup', sym: An.sym, tf: An.tf, hasil: cara, pnl: x.pnl, side: x.side });
}
/** evaluasi candle tertutup i: keluar posisi lalu cari sinyal baru (logika sama persis dengan uji()) */
function evaluasiBar(An, i, live) {
  const S = An.S, P = An.aktif;
  if (P && S.t[i] >= P.tE) {
    if (P.side < 0 ? S.h[i] >= P.sl : S.l[i] <= P.sl) return tutupPosisi(An, P.side < 0 ? Math.max(P.sl, S.o[i]) : Math.min(P.sl, S.o[i]), 'SL', S.t[i] + S.ms);
    if (P.side < 0 ? S.l[i] <= P.tp : S.h[i] >= P.tp) return tutupPosisi(An, P.tp, 'TP', S.t[i] + S.ms);
    const nb = S.cari(S.t[i] + 1) - S.cari(P.tE);
    if (nb >= MAXB[An.tf]) return tutupPosisi(An, S.c[i], 'WKT', S.t[i] + S.ms);
    return;
  }
  if (!An.aktif && An.cfg && live && i >= 220) {
    const st = cekSetup(An.cfg, S, An.I, i);
    if (st && !st.tolak) bukaPosisi(An, i, st);
  }
}
function prosesBarTutup(An) {
  const S = An.S; if (S.n < 300) return;
  An.perbarui(); if (!An.I) return;
  const now = kini();
  let last = S.n - 1; while (last >= 0 && S.t[last] + S.ms > now) last--;
  if (last < 0) return;
  let i = An.selesai ? S.cari(An.selesai + 1) : last;
  const jauh = last - i > Math.ceil(30 * MENIT / S.ms);
  for (; i <= last; i++) {
    evaluasiBar(An, i, !jauh || i === last);
    An.selesai = S.t[i];
  }
  kvSet('selesai|' + An.key, An.selesai);
}
function cekPosisiDetik(An, p) {
  const P = An.aktif; if (!P || !p || kini() < P.tE) return;
  if (P.side < 0 ? p >= P.sl : p <= P.sl) tutupPosisi(An, P.sl, 'SL', kini());
  else if (P.side < 0 ? p <= P.tp : p >= P.tp) tutupPosisi(An, P.tp, 'TP', kini());
}

// ------------------------------------------------------------------ status tiap detik (gelombang + candle + price action)
function teksKonteks(ctx, side, lv) {
  const st = struktur(lv.wh, lv.wl, lv.wh2, lv.wl2), stT = st > 0 ? 'struktur naik' : st < 0 ? 'struktur turun' : 'struktur datar', emaT = lv.up ? 'EMA naik' : 'EMA turun';
  if (ctx === 'none') return 'tanpa filter';
  if (ctx === 'ema+' || ctx === 'ema-') return emaT;
  if (ctx === 'with+') return stT + ' · ' + emaT;
  return stT;
}
function statusDetik(An) {
  An.segar();
  const S = An.S, sym = An.sym, k = skala(sym), now = kini();
  const out = { sym, tf: An.tf, t: now, buka: true, keadaan: 'MEMUAT', barMs: S.ms, maxb: MAXB[An.tf],
    sisa: Math.ceil((Math.floor(now / S.ms) * S.ms + S.ms - now) / 1000) };
  if (INFO[sym].emas && !emasBuka(now)) { out.buka = false; out.bukaLagi = bukaBerikut(now); }
  if (!S.n) return out;
  const i = S.n - 1, p = hargaKini(sym) || S.c[i];
  const q = v => hp(sym, v);
  out.harga = q(p);
  out.bar = { t: S.t[i], o: q(S.o[i]), h: q(S.h[i]), l: q(S.l[i]), c: q(S.c[i]), v: S.v[i] };
  const I = An.I;
  if (!I || I.n < 2) { if (!out.buka) out.keadaan = 'TUTUP'; return out; }
  const lv = levelDi(I, i), wh = lv.wh, wl = lv.wl, a = lv.a;
  if (!(wh > wl) || !(a > 0)) { if (!out.buka) out.keadaan = 'TUTUP'; return out; }
  out.atas = q(wh); out.bawah = q(wl); out.atr = a * k; out.r = I.r; out.zona = ZONA * a * k;
  out.tAtas = lv.whi >= 0 ? S.t[lv.whi] : 0; out.tBawah = lv.wli >= 0 ? S.t[lv.wli] : 0;
  const st = struktur(wh, wl, lv.wh2, lv.wl2);
  out.struktur = { st, lblA: wh > lv.wh2 ? 'HH' : wh < lv.wh2 ? 'LH' : 'H', lblB: wl > lv.wl2 ? 'HL' : wl < lv.wl2 ? 'LL' : 'L', ema: lv.up ? 1 : -1 };
  // kaki gelombang yang sedang berjalan (diperpanjang oleh candle berjalan)
  const z = I.akhir; let gP = z.extP, gI = Math.min(z.extI, i);
  if (z.dir === 1 && S.h[i] > gP) { gP = S.h[i]; gI = i; } else if (z.dir === -1 && S.l[i] < gP) { gP = S.l[i]; gI = i; }
  out.gel = { dir: z.dir, p: q(gP), t: S.t[gI] };
  out.pos = (p - wl) / (wh - wl);
  out.jarak = { atas: (wh - p) * k, bawah: (p - wl) * k, atasA: (wh - p) / a, bawahA: (p - wl) / a };
  out.lebarA = (wh - wl) / a;
  // pola candle yang terlihat di candle berjalan (semua jenis, untuk keterangan)
  out.polaKini = [];
  for (const q of POLA) { const r = polaDi(S, i, q, lv); if (r) out.polaKini.push((q === 'bos' ? (r[0] > 0 ? 'Tembus naik' : 'Tembus turun') : NAMA_POLA[q] + (r[0] < 0 ? ' bearish' : ' bullish'))); }
  const cfg = An.cfg, H = An.hasil;
  if (An.exc) {
    const zA = (wh - ZONA * a - p) / a, zB = (p - wl - ZONA * a) / a;
    out.peluang = { atas: peluang(An.exc.up, zA), bawah: peluang(An.exc.dn, zB), menit: HZ[An.tf] * S.ms / MENIT };
  }
  const rinci = (side, entry, ph, pl) => {
    const sl = hitungSl(cfg, side, ph, pl, lv), risk = Math.abs(entry - sl), tp = hitungTp(cfg, side, entry, risk, lv);
    return { side, entry: q(entry), sl: q(sl), tp: q(tp), rr: Math.abs(tp - entry) / (risk || 1), pTp: H && H.tpRate, eta: H && H.eta };
  };
  if (!out.buka) { out.keadaan = 'TUTUP'; return out; }
  if (An.aktif) {
    const P = An.aktif, pl = P.side * (p - P.entry) - biayaInternal(sym);
    out.keadaan = 'POSISI'; out.arah = P.side;
    out.aktif = { side: P.side, entry: P.eD != null ? P.eD : q(P.entry), sl: P.sD != null ? P.sD : q(P.sl), tp: P.tD != null ? P.tD : q(P.tp), t0: P.t0, tE: P.tE, pl: pl * k,
      prog: Math.max(-1, Math.min(1, P.side * (p - P.entry) / (P.side * (P.tp - P.entry) || 1))),
      progSl: Math.max(0, Math.min(1, P.side * (P.entry - p) / Math.abs(P.entry - P.sl || 1))), cfg: P.cfg, pola: P.pola,
      lewat: Math.floor((now - P.tE) / S.ms), maxb: MAXB[An.tf], pTp: H && H.tpRate, eta: H && H.eta };
    return out;
  }
  if (!cfg) { out.keadaan = An.hasil ? 'NONAKTIF' : 'MEMUAT'; return out; }
  out.aturan = { pola: namaPola(cfg), p: cfg.p, ctx: cfg.ctx, ktx: NAMA_KTX[cfg.ctx] };
  // sisi yang diizinkan aturan strategi
  const bolehJ = lolosKonteks(cfg.ctx, -1, lv), bolehB = lolosKonteks(cfg.ctx, 1, lv);
  out.boleh = { jual: bolehJ, beli: bolehB };
  const setup = cekSetup(cfg, S, An.I, i);
  let sisi = 0;
  if (setup && !setup.tolak) sisi = setup.side;
  else {
    if (setup && setup.tolak) out.tolak = { pola: namaPola(cfg) + (setup.side < 0 ? ' bearish' : ' bullish'), alasan: teksKonteks(cfg.ctx, setup.side, lv) };
    const dA = (wh - p) / a, dB = (p - wl) / a;
    if (cfg.p === 'bos') sisi = bolehB && (!bolehJ || dA <= dB) ? 1 : bolehJ ? -1 : 0;
    else sisi = bolehJ && (!bolehB || dA <= dB) ? -1 : bolehB ? 1 : 0;
  }
  out.arah = sisi;
  // daftar periksa: lokasi gelombang · pola candle · konteks price action (+ waktu = jam pasir)
  const h = S.h[i], l = S.l[i], h1 = S.h[i - 1], l1 = S.l[i - 1];
  let lokasi = false, lokT = '';
  if (cfg.p === 'bos') {
    lokasi = sisi > 0 ? p > wh + 0.1 * a : sisi < 0 ? p < wl - 0.1 * a : false;
    lokT = sisi > 0 ? (lokasi ? 'di atas puncak gelombang' : 'menunggu tutup di atas puncak') : sisi < 0 ? (lokasi ? 'di bawah lembah gelombang' : 'menunggu tutup di bawah lembah') : '';
  } else {
    lokasi = sisi < 0 ? Math.max(h, h1) >= wh - ZONA * a && p < wh : sisi > 0 ? Math.min(l, l1) <= wl + ZONA * a && p > wl : false;
    lokT = sisi < 0 ? (lokasi ? 'di zona puncak gelombang' : 'menuju puncak gelombang') : sisi > 0 ? (lokasi ? 'di zona lembah gelombang' : 'menuju lembah gelombang') : '';
  }
  const polaAda = !!(setup && setup.side === sisi);
  const ktxOk = sisi ? lolosKonteks(cfg.ctx, sisi, lv) : false;
  out.cek = { lokasi: { ok: lokasi, teks: lokT }, candle: { ok: polaAda, teks: namaPola(cfg) + (sisi < 0 ? ' bearish' : sisi > 0 ? ' bullish' : '') },
    konteks: { ok: ktxOk || cfg.ctx === 'none', teks: teksKonteks(cfg.ctx, sisi, lv), perlu: cfg.ctx !== 'none' } };
  if (setup && !setup.tolak) { out.keadaan = 'KANDIDAT'; out.rencana = rinci(setup.side, p, setup.ph, setup.pl); return out; }
  if (!sisi) { out.keadaan = 'TUNGGU'; return out; }
  if (cfg.p !== 'bos' && (p > wh || p < wl)) { out.keadaan = 'TEMBUS'; out.arahTembus = p > wh ? 1 : -1; }
  else {
    const d = cfg.p === 'bos' ? (sisi > 0 ? (wh - p) / a : (p - wl) / a) : (sisi < 0 ? (wh - p) / a : (p - wl) / a);
    out.keadaan = d <= 1.2 ? 'SIAGA' : 'TUNGGU';
  }
  // rencana perkiraan jika pola terjadi di level gelombang
  if (cfg.p === 'bos') out.siaga = sisi > 0 ? rinci(1, wh + 0.1 * a, wh + 0.1 * a, wh - 0.9 * a) : rinci(-1, wl - 0.1 * a, wl + 0.9 * a, wl - 0.1 * a);
  else out.siaga = sisi < 0 ? rinci(-1, wh - ZONA * a / 2, wh, wh - a) : rinci(1, wl + ZONA * a / 2, wl + a, wl);
  return out;
}

function lencana(sym, tf) {
  const An = AN.get(sym + '|' + tf); if (!An) return '';
  if (An.aktif) return An.aktif.side < 0 ? 'SELL' : 'BUY';
  return '';
}
function ubah24(sym) {
  const S = DATA.get(INFO[sym].seri + '|5m'); if (!S || S.n < 300) return null;
  const p = hargaKini(sym), j = S.cari(S.akhir - HARI);
  return S.c[Math.max(0, j - 1)] ? p / S.c[Math.max(0, j - 1)] - 1 : null;
}

// ------------------------------------------------------------------ kirim ke halaman
function kirim(m) { self.postMessage(m); }
function kirimRiwayat(sym, tf) {
  const An = AN.get(sym + '|' + tf); if (!An) return;
  An.segar();
  const S = An.S, n = S.n, k = skala(sym), gs = geserHarga(sym), a = Math.max(0, n - TAMPIL), m = n - a;
  const t = new Float64Array(m), o = new Float64Array(m), h = new Float64Array(m), l = new Float64Array(m), c = new Float64Array(m), v = new Float64Array(m);
  const U = new Float64Array(m).fill(NaN), L = new Float64Array(m).fill(NaN);
  for (let i = 0; i < m; i++) {
    const j = a + i; t[i] = S.t[j]; o[i] = S.o[j] * k + gs; h[i] = S.h[j] * k + gs; l[i] = S.l[j] * k + gs; c[i] = S.c[j] * k + gs; v[i] = S.v[j];
    if (An.I && j < An.I.n) { U[i] = An.I.WH[j] * k + gs; L[i] = An.I.WL[j] * k + gs; }
  }
  kirim({ op: 'riwayat', sym, tf, kunci: sym + '|' + tf + '|' + (m ? t[0] : 0), bars: { t, o, h, l, c, v, U, L }, uji: An.uji, jurnal: An.jurnal.slice(-60), piv: pivotTampil(An, a) });
}
/** puncak/lembah gelombang terkonfirmasi di jendela tampilan */
function pivotTampil(An, dari) {
  if (!An.I) return [];
  const S = An.S, k = skala(An.sym), out = [];
  for (const x of An.I.piv) if (x.i >= dari && x.i < S.n) out.push({ t: S.t[x.i], p: hp(An.sym, x.p), tipe: x.tipe, lbl: x.lbl });
  return out;
}
function kirimAnalisis(sym, tf) {
  const An = AN.get(sym + '|' + tf); if (!An) return;
  An.segar();
  const KB = KEB[sym];
  const memori = {};
  for (const x of TFS) { const S = DATA.get(INFO[sym].seri + '|' + x); memori[x] = S && S.n ? { hari: (S.akhir - S.awal) / HARI, n: S.n, maks: SIMPAN[x][1] } : null; }
  const now = kini(), hariIni = Math.floor((now + WIB) / HARI);
  const jl = An.jurnal.filter(x => Math.floor((x.t1 + WIB) / HARI) === hariIni);
  kirim({ op: 'analisis', sym, tf, strategi: An.hasil, sesi: An.sesi, batas: An.batasStat, kebiasaan: KB, memori,
    jurnal: An.jurnal.slice(-60), uji: (An.ujiSemua || []).slice(-40).map(x => trJadi(An, x, 'uji')),
    hariIni: { n: jl.length, tp: jl.filter(x => x.pnl > 0).length, pnl: jl.reduce((s, x) => s + x.pnl, 0) },
    rasio: sym === 'XAUUSDm' ? RASIO : null, kontrak: INFO[sym].kontrak, kurva: kurva(An) });
}
/** hasil kumulatif trade uji (USD per 1 unit), maksimal ±160 titik */
function kurva(An) {
  const tr = An.ujiSemua || []; if (tr.length < 3) return null;
  const k = skala(An.sym), step = Math.max(1, Math.ceil(tr.length / 160)), out = [0];
  let s = 0;
  tr.forEach((x, i) => { s += x.pnl * k; if (i % step === step - 1 || i === tr.length - 1) out.push(s); });
  return out;
}
const KEB = {};
let detikTerakhir = 0;
function tiapDetik() {
  // posisi virtual dicek dengan harga hidup untuk semua simbol × TF
  for (const An of AN.values()) if (An.aktif && An.siap) {
    const p = hargaKini(An.sym);
    if (!(INFO[An.sym].emas && !emasBuka(kini()))) cekPosisiDetik(An, p);
  }
  const An = AN.get(LIHAT.sym + '|' + LIHAT.tf);
  const harga = {};
  for (const s of SYMS) harga[s] = { p: hp(s, hargaKini(s)), ubah: ubah24(s), lencana: lencana(s, LIHAT.tf), buka: !INFO[s].emas || emasBuka(kini()), kal: KAL[s] };
  const wsHidup = STATUS.ws && Date.now() - STATUS.wsT < 8000;
  kirim({ op: 'detik', s: An ? statusDetik(An) : null, harga, kurs: KURS,
    feed: { ws: wsHidup, rest: STATUS.rest, galat: STATUS.galat, unduh: STATUS.unduh, rasio: RASIO.t ? RASIO.k : null } });
  if (!wsHidup && (!STATUS.ws || Date.now() - STATUS.wsT > 8000)) pollRest();
}

// ------------------------------------------------------------------ jadwal
const barKini = {};
function denyut() {
  const t = kini();
  for (const tf of TFS) {
    const ms = TF_MS[tf], bs = Math.floor(t / ms) * ms;
    if (barKini[tf] && bs > barKini[tf]) { const tutup = barKini[tf]; setTimeout(() => rekonsiliasi(tf, tutup), 1600); }
    barKini[tf] = bs;
  }
  const s = Math.floor(t / 1000);
  if (s !== detikTerakhir) { detikTerakhir = s; try { tiapDetik(); } catch (e) { kirim({ op: 'galat', pesan: String(e && e.stack || e) }); } }
}
async function rekonsiliasi(tf, tutup) {
  await Promise.all(SERI.map(async seri => {
    const S = DATA.get(seri + '|' + tf); if (!S || !S.n) return;
    try {
      const lama = (tutup - S.akhir) / S.ms;
      if (lama > 3) await isiRiwayat(S, SIMPAN[tf][0]);
      else S.gabung(await klines(seri, tf, null, 3, 6000));
    } catch (e) { /* pakai data WebSocket */ }
  }));
  for (const sym of SYMS) {
    const An = AN.get(sym + '|' + tf); if (!An || !An.siap) continue;
    prosesBarTutup(An);
    if (sym === LIHAT.sym && tf === LIHAT.tf) kirimBar(An, tutup);
  }
}
function kirimBar(An, tutup) {
  const S = An.S, k = skala(An.sym), i = S.cari(tutup);
  if (i >= S.n || S.t[i] !== tutup) return;
  const q = v => hp(An.sym, v);
  kirim({ op: 'bar', sym: An.sym, tf: An.tf, bar: { t: S.t[i], o: q(S.o[i]), h: q(S.h[i]), l: q(S.l[i]), c: q(S.c[i]), v: S.v[i] },
    U: An.I && i < An.I.n ? q(An.I.WH[i]) : NaN, L: An.I && i < An.I.n ? q(An.I.WL[i]) : NaN, jurnal: An.jurnal.slice(-60), aktif: !!An.aktif,
    piv: pivotTampil(An, Math.max(0, S.n - TAMPIL)) });
}
async function simpanSemua() { for (const S of DATA.values()) await simpanSeri(S); }

// ------------------------------------------------------------------ alur utama
async function siapkan(An, opsi = {}) {
  An.perbarui();
  const basi = !An.optT || Date.now() - An.optT > 6 * JAM || An.S.n > An.optN * 1.15 || !An.hasil || (An.hasil && An.hasil.gaya !== SET.gaya) ||
    (An.hasil && An.hasil.spread !== SET.spread[An.sym]) || opsi.paksa;
  if (basi) await optimalkan(An); else hitungRinci(An);
  if (!An.siap) {   // sesi baru: jangan ulang sinyal lama, tapi selesaikan posisi tersimpan
    const S = An.S, now = kini();
    let last = S.n - 1; while (last >= 0 && S.t[last] + S.ms > now) last--;
    if (An.aktif && last >= 0) { for (let i = S.cari(An.aktif.tE); i <= last && An.aktif; i++) evaluasiBar(An, i, false); }
    if (last >= 0) { An.selesai = S.t[last]; kvSet('selesai|' + An.key, An.selesai); }
    An.siap = true;
  }
  KEB[An.sym] = hitungKebiasaan(An.sym) || KEB[An.sym];
  kirimAnalisis(An.sym, An.tf);
  if (An.sym === LIHAT.sym && An.tf === LIHAT.tf) kirimRiwayat(An.sym, An.tf);
}
function urutan() {
  const s0 = LIHAT.sym, s1 = SYMS.find(s => s !== s0), t0 = LIHAT.tf, t1 = TFS.find(t => t !== t0);
  return [[s0, t0], [s0, t1], [s1, t0], [s1, t1]];
}
let mulaiJalan = false;
async function mulai() {
  if (mulaiJalan) return; mulaiJalan = true;
  await bukaDb();
  const r = KV.get('rasio'); if (r && r.k) RASIO = r;
  const kv = KV.get('kurs'); if (kv && kv.v) KURS = kv.v;
  for (const seri of SERI) for (const tf of TFS) DATA.set(seri + '|' + tf, new Seri(seri, tf));
  await Promise.all([...DATA.values()].map(S => muatSeri(S)));
  for (const S of DATA.values()) await pangkasSeri(S);
  for (const sym of SYMS) for (const tf of TFS) AN.set(sym + '|' + tf, new Analisis(sym, tf));
  sambungWs();
  await ambilUsdc(); setInterval(ambilUsdc, 60000);
  setInterval(denyut, 200);
  ambilKurs(); setInterval(ambilKurs, 6 * JAM);
  setInterval(spotEmas, 30000);
  setInterval(simpanSemua, 20000);
  setInterval(cekBasi, 10 * MENIT);
  // tampilkan dulu apa yang sudah terekam
  for (const [sym, tf] of urutan()) {
    const An = AN.get(sym + '|' + tf);
    if (An.S.n > 300) { An.perbarui(); if (An.hasil) hitungRinci(An); }
  }
  const p0 = spotEmas();
  if (LIHAT.sym === 'XAUUSDm' && !RASIO.t) await p0;
  kirimRiwayat(LIHAT.sym, LIHAT.tf);
  // unduh: yang dilihat lebih dulu
  for (const [sym, tf] of urutan()) {
    const An = AN.get(sym + '|' + tf), S = An.S;
    STATUS.unduh = { sym, tf, beres: 0, total: 1 };
    try {
      if (!S.n) { S.gabung(await klinesUlang(S.seri, tf, null, 1000)); if (sym === LIHAT.sym && tf === LIHAT.tf) { An.perbarui(); kirimRiwayat(sym, tf); } }
      await isiRiwayat(S, SIMPAN[tf][0], (b, t) => { STATUS.unduh = { sym, tf, beres: b, total: t }; });
    } catch (e) { STATUS.galat = 'unduh ' + S.key + ': ' + (e && e.message || e); }
    if (sym === 'XAUUSDm') { await p0; if (!RASIO.t || (RASIO.tutup && RASIO.tutup !== DATA.get('PAXGUSDT|1m').akhir)) await spotEmas(); }
    await siapkan(An);
    await simpanSeri(S);
  }
  STATUS.unduh = null;
  isiMundur();
}
/** rekam mundur pelan-pelan sampai batas maksimum (60 hari 1m, 365 hari 5m) */
async function isiMundur() {
  const kon = self.navigator && self.navigator.connection;
  if (kon && kon.saveData) return;            // mode hemat data: cukup riwayat awal
  for (const [sym, tf] of urutan()) {
    const An = AN.get(sym + '|' + tf), S = An.S;
    if (!S.n) continue;
    const target = kini() - SIMPAN[tf][1] * HARI, cakup = KV.get('cakup|' + S.key) || S.awal;
    if (cakup <= target + S.ms) continue;
    try {
      STATUS.unduh = { sym, tf, beres: 0, total: 1, mundur: true };
      await isiRiwayat(S, SIMPAN[tf][1], (b, t) => { STATUS.unduh = { sym, tf, beres: b, total: t, mundur: true }; });
      await simpanSeri(S);
      await siapkan(An);
    } catch (e) { /* coba lagi nanti */ }
    await tidur(1500);
  }
  STATUS.unduh = null;
}
async function cekBasi() {
  for (const An of AN.values()) if (An.siap && Date.now() - An.optT > 6 * JAM) { await siapkan(An); }
  KEB.BTCUSDT = hitungKebiasaan('BTCUSDT') || KEB.BTCUSDT; KEB.XAUUSDm = hitungKebiasaan('XAUUSDm') || KEB.XAUUSDm;
}

self.onmessage = async ev => {
  const m = ev.data || {};
  try {
    if (m.op === 'mulai') {
      if (m.set) setel(m.set, false);
      if (m.lihat) LIHAT = { sym: m.lihat.sym, tf: m.lihat.tf };
      mulai();
    } else if (m.op === 'lihat') {
      LIHAT = { sym: m.sym, tf: m.tf };
      kirimRiwayat(m.sym, m.tf); kirimAnalisis(m.sym, m.tf);
    } else if (m.op === 'setel') {
      setel(m.set, true);
    } else if (m.op === 'analisis-ulang') {
      const An = AN.get(m.sym + '|' + m.tf);
      if (An && An.siap) { await siapkan(An, { paksa: true }); kirim({ op: 'analisis-selesai', sym: m.sym, tf: m.tf }); }
    } else if (m.op === 'kalibrasi') {
      const r = kalibrasi(m.sym, m.bid, m.reset);
      kirim({ op: 'kalibrasi-ok', sym: m.sym, kal: r.kal, galat: r.galat || '' });
      if (!r.galat) { kirimRiwayat(LIHAT.sym, LIHAT.tf); kirimAnalisis(LIHAT.sym, LIHAT.tf); }
    } else if (m.op === 'hapus') {
      await hapusSemua(); kirim({ op: 'terhapus' });
    }
  } catch (e) { kirim({ op: 'galat', pesan: String(e && e.stack || e) }); }
};
let setelJalan = null;
function setel(s, ulang) {
  const lama = JSON.stringify(SET);
  if (s.lot > 0) SET.lot = +s.lot;
  if (s.spread) for (const k of SYMS) if (s.spread[k] >= 0) SET.spread[k] = +s.spread[k];
  if (s.gaya && GAYA_WR[s.gaya] != null) SET.gaya = s.gaya;
  if (s.kal) for (const k of SYMS) KAL[k] = s.kal[k] && (s.kal[k].d != null || s.kal[k].k) ? s.kal[k] : null;
  if (!ulang || JSON.stringify(SET) === lama) return;
  clearTimeout(setelJalan);
  setelJalan = setTimeout(async () => {     // gaya / spread berubah → pilih ulang strategi (yang dilihat dulu)
    for (const [sym, tf] of urutan()) { const An = AN.get(sym + '|' + tf); if (An && An.siap) await siapkan(An); }
  }, 400);
}
