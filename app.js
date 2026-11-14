'use strict';
/* Amatu Scalping · tampilan. Semua hitungan ada di mesin.js (Web Worker); halaman ini hanya menggambar. */
(() => {
  const VERSI = document.documentElement.dataset.web || '';
  const $ = id => document.getElementById(id);
  const SYMS = ['BTCUSDT', 'XAUUSDm'];
  const KONTRAK = { BTCUSDT: 1, XAUUSDm: 100 };
  const TF_MENIT = { '1m': 1, '5m': 5 };
  const TF_MS = { '1m': 6e4, '5m': 3e5 };
  const IKUT = { '1m': '5m' };   // TF yang memakai sinyal TF lain (sama dengan mesin.js): 1m = chart detail untuk sinyal 5m
  const WIB = 7 * 3600e3;
  const C = { up: '#22c39a', dn: '#f2545b', am: '#f5b041', bl: '#5b8cff', mu: '#8790a1', line: '#1d2430' };
  const NAMA = { BTCUSDT: 'BTCUSDm', XAUUSDm: 'XAUUSDm' };   // nama simbol seperti di Exness

  // ---------------------------------------------------------------- preferensi (kunci berawalan scalping.)
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('scalping.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('scalping.' + k, JSON.stringify(v)); } catch (e) { /* mode privat */ } },
  };
  const qs = new URLSearchParams(location.search);
  const P = {
    sym: qs.get('sym') || LS.get('sym', 'BTCUSDT'), tf: qs.get('tf') || LS.get('tf', '1m'),
    gaya: LS.get('gaya', 'seimbang'), lot: +LS.get('lot', 0.01) || 0.01,
    spread: Object.assign({ BTCUSDT: 6.4, XAUUSDm: 0.24 }, LS.get('spread', {})),
    kal: Object.assign({ BTCUSDT: null, XAUUSDm: null }, LS.get('kal', {})),   // kalibrasi harga ke Exness
    bunyi: LS.get('bunyi', true) !== false, rw: LS.get('rw', 'live'),
  };
  if (!SYMS.includes(P.sym)) P.sym = 'BTCUSDT';
  if (!TF_MENIT[P.tf]) P.tf = '1m';
  if (!['winrate', 'seimbang', 'rr'].includes(P.gaya)) P.gaya = 'seimbang';
  let KURS = +LS.get('kurs', 18200) || 18200;

  // ---------------------------------------------------------------- format angka (Indonesia)
  const NF = {};
  const nf = d => NF[d] || (NF[d] = new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const ok = x => typeof x === 'number' && Number.isFinite(x);
  const fh = x => ok(x) ? nf(2).format(x) : '–';
  const fd = (x, d = 2) => ok(x) ? (x < 0 ? '−$' : '$') + nf(d).format(Math.abs(x)) : '–';
  const frp = (x, tanda = true) => ok(x) ? (x < 0 ? '−' : tanda ? '+' : '') + 'Rp ' + nf(0).format(Math.abs(Math.round(x))) : '–';
  const frpRingkas = x => !ok(x) ? '–' : (x < 0 ? '−' : '') + 'Rp ' + (Math.abs(x) >= 1e6 ? nf(1).format(Math.abs(x) / 1e6) + ' jt'
    : Math.abs(x) >= 1e5 ? nf(0).format(Math.abs(x) / 1e3) + ' rb' : nf(0).format(Math.abs(Math.round(x))));
  const fa = x => fx(x, Math.abs(x) >= 10 ? 0 : 1);   // kelipatan ATR
  const fp = (x, d = 0) => ok(x) ? nf(d).format(x * 100) + '%' : '–';
  const fx = (x, d = 1) => ok(x) ? nf(d).format(x) : '–';
  const dua = n => String(n).padStart(2, '0');
  const jm = t => { const d = new Date(t + WIB); return dua(d.getUTCHours()) + '.' + dua(d.getUTCMinutes()); };
  const jms = t => { const d = new Date(t + WIB); return jm(t) + '.' + dua(d.getUTCSeconds()); };
  const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const keRp = (usd, sym) => usd * KONTRAK[sym] * P.lot * KURS;
  const tl = t => Math.floor(t / 1000) + 7 * 3600;          // waktu chart = WIB
  const setT = (el, s) => { if (el && el.textContent !== s) el.textContent = s; };
  const setC = (el, c) => { if (el && el.className !== c) el.className = c; };

  // ---------------------------------------------------------------- mesin (Web Worker)
  const W = new Worker('mesin.js?v=' + encodeURIComponent(VERSI));
  W.onmessage = e => { try { terima(e.data); } catch (err) { console.error(err); } };
  W.onerror = e => { setT($('muat-t'), 'Mesin gagal dimuat: ' + (e.message || 'galat')); };
  // feed resmi Exness lewat relay Supabase amatu-exness (perlu login Portal AMATU; tanpa itu mesin memakai Binance)
  const EDGE_EXN = 'https://ieyqxmzztoxgpvwexbkj.supabase.co/functions/v1/amatu-exness';
  const lokal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const tokenPortal = () => { try { const s = window.AMATU && window.AMATU.sess && window.AMATU.sess(); return (s && s.t) || ''; } catch (e) { return ''; } };
  const EXNESS = { edge: (lokal && qs.get('exness')) || EDGE_EXN, token: (lokal && qs.get('xt')) || tokenPortal() };
  let FEED = { sumber: 'binance', exn: {} };
  W.postMessage({ op: 'mulai', set: { lot: P.lot, spread: P.spread, gaya: P.gaya, kal: P.kal }, lihat: { sym: P.sym, tf: P.tf }, exness: EXNESS });

  // ---------------------------------------------------------------- chart
  const LW = window.LightweightCharts;
  let chart = null, cs = null, vs = null, su = null, sb = null;
  const garis = {};
  const CH = { sym: '', tf: '', sMs: 3e5, bars: [], vols: [], uu: [], ll: [], lastT: 0, uji: [], jurnal: [], piv: [], tr: new Map(), s: null, pos: null };

  // ---------------------------------------------------------------- alat posisi (seperti Long/Short Position di TradingView)
  // Kotak dimulai di penutupan candle sinyal (harga entry) dan selebar batas waktu posisi (MAXB candle, sama dengan mesin.js):
  // zona hijau = arah take profit, zona merah = arah stop loss, garis putih = entry, tepi kanan = posisi ditutup paksa.
  const MAXB = { '1m': 30, '5m': 24 };
  const HIJAU = '34,195,154', MERAH = '242,84,91', AMBER = '245,176,65';
  const PIL = { h: 19, pad: 7, atas: 34 };                    // tinggi label, padding, batas atas (di bawah legenda & jam pasir)
  const fontPil = b => `${b ? 700 : 600} 11px Inter, system-ui, sans-serif`;
  /** indeks candle terakhir dengan waktu ≤ t (waktu chart), −1 bila sebelum candle pertama */
  function idxWaktu(t) {
    const B = CH.bars; let lo = 0, hi = B.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (B[m].time <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  }
  const fdj = d => fd(d, d >= 100 ? 0 : 2);
  const persen = (d, e) => nf(2).format(d / e * 100) + '%';
  /** isi label: tiap bagian punya beberapa varian, dari panjang ke pendek; tataLabel memilih yang muat */
  function teksPosisi(p) {
    const sym = P.sym, jual = p.side < 0, sisi = jual ? 'SELL' : 'BUY', wS = jual ? C.dn : C.up, T = '#dfe5ee', M = '#8f98aa';
    const tpD = Math.abs(p.tp - p.entry), slD = Math.abs(p.sl - p.entry), rr = slD ? tpD / slD : 0, sp = P.spread[sym] || 0;
    const rpTp = frp(keRp(tpD - sp, sym)), rpSl = frp(-keRp(slD + sp, sym)), rrT = `R:R 1 : ${fx(rr, 1)}`;
    let e;
    if (p.jenis === 'aktif') {
      const pl = p.pl || 0, wP = pl >= 0 ? C.up : C.dn, plU = (pl >= 0 ? '+' : '−') + '$' + nf(2).format(Math.abs(pl)), plR = frp(keRp(pl, sym));
      e = [[{ t: sisi, c: wS, b: 1 }, { t: ` berjalan · entry ${fh(p.entry)} · `, c: T }, { t: `P/L ${plU} · ${plR}`, c: wP, b: 1 }],
        [{ t: sisi, c: wS, b: 1 }, { t: ` ${fh(p.entry)} · `, c: T }, { t: plR, c: wP, b: 1 }], [{ t: sisi + ' ', c: wS, b: 1 }, { t: plR, c: wP, b: 1 }]];
    } else if (p.jenis === 'riwayat') {
      const wP = p.pnl > 0 ? C.up : C.dn, rp = frp(keRp(p.pnl, sym)), asal = p.sumber === 'live' ? ' · live' : ' · uji';
      e = [[{ t: sisi, c: wS, b: 1 }, { t: ` ${jm(p.t0)} · ${fh(p.entry)} → ${p.hasil} ${fh(p.keluar)} · `, c: T }, { t: rp, c: wP, b: 1 }, { t: asal, c: M }],
        [{ t: sisi, c: wS, b: 1 }, { t: ` ${p.hasil} · `, c: T }, { t: rp, c: wP, b: 1 }]];
    } else {
      const tag = p.jenis === 'calon' ? ['CALON ', C.am] : p.jenis === 'siaga' ? ['SIAGA ', C.am] : ['RENCANA ', M], kira = p.jenis === 'calon' ? '' : '≈ ';
      e = [[{ t: tag[0], c: tag[1], b: 1 }, { t: sisi, c: wS, b: 1 }, { t: ` · entry ${kira}${fh(p.entry)} · ${rrT}`, c: T }],
        [{ t: tag[0], c: tag[1], b: 1 }, { t: sisi, c: wS, b: 1 }, { t: ` ${kira}${fh(p.entry)}`, c: T }], [{ t: sisi, c: wS, b: 1 }, { t: ` ${kira}${fh(p.entry)}`, c: T }]];
    }
    return {
      e,
      tp: [`${fh(p.tp)} · ${fdj(tpD)} (${persen(tpD, p.entry)}) · ${rpTp}`, `${fh(p.tp)} · ${rpTp}`, fh(p.tp)],
      sl: [`${fh(p.sl)} · ${fdj(slD)} (${persen(slD, p.entry)}) · ${rpSl}`, `${fh(p.sl)} · ${rpSl}`, fh(p.sl)],
    };
  }
  /** tata letak label (px CSS): entry di garis entry, TP & SL di luar tepi zonanya, tidak saling tumpuk, dan tidak
   *  menutupi candle yang sedang berjalan (k.cur = [kiri, kanan] candle itu). ukur(seg) = lebar teks di konteks gambar. */
  function tataLabel(k, W, H, isi, jenis, ukur) {
    const a = Math.max(k.x1, 4), b = Math.min(k.x2, W - 4);
    if (b - a < 2 || W < 80) return null;
    const tegas = jenis === 'aktif' || jenis === 'calon', putus = jenis === 'siaga' || jenis === 'rencana';
    const lebar = v => v.reduce((s, x) => s + ukur(x), 0) + 2 * PIL.pad;
    const varian = { e: isi.e };
    for (const [kunci, warna, kata, gelap] of [['tp', HIJAU, 'TP ', '#04150f'], ['sl', MERAH, 'SL ', '#200609']]) {
      const tc = tegas ? gelap : `rgb(${warna})`;
      varian[kunci] = isi[kunci].map(t => [{ t: kata, c: tc, b: 1 }, { t, c: tc }]);
    }
    // daerah label: kanan candle berjalan (ruang kosong ke depan) bila cukup; kalau sempit, menempel di kiri candle
    // berjalan (menutup candle lama, bukan yang sedang terbentuk); kalau tetap sempit, seluruh lebar chart
    let r0 = 4, r1 = W - 4, maks = Math.min(W - 8, Math.max(b - a + 120, 270)), rapatKanan = false;
    if (k.cur) {
      const kanan = [Math.max(a, k.cur[1] + 3), W - 4], kiri = [4, Math.min(b, k.cur[0] - 3)];
      const perlu = i => Math.max(...['e', 'tp', 'sl'].map(x => lebar(varian[x][Math.min(i, varian[x].length - 1)])));
      const lK = kanan[1] - kanan[0], lI = kiri[1] - kiri[0], pendek = perlu(9);
      if (lK >= perlu(1) || (lK >= pendek && lK >= lI)) [r0, r1] = kanan;
      else if (lI >= pendek) { [r0, r1] = kiri; rapatKanan = true; }
      maks = r1 - r0;
    }
    const pilih = vs => { for (const v of vs) { const w = lebar(v); if (w <= maks) return { seg: v, w }; } const v = vs[vs.length - 1]; return { seg: v, w: lebar(v) }; };
    const c0 = Math.max(a, r0), c1 = Math.min(b, r1), cx = c1 > c0 ? (c0 + c1) / 2 : (r0 + r1) / 2;
    const xDi = w => Math.max(4, rapatKanan ? r1 - w : Math.max(r0, Math.min(r1 - w, cx - w / 2)));
    const yDi = y => Math.max(PIL.atas, Math.min(H - PIL.h / 2 - 3, y));
    const out = [];
    const e = pilih(varian.e);
    out.push({ ...e, x: xDi(e.w), y: yDi(k.yE), bg: 'rgba(15,20,28,0.95)', bd: 'rgba(170,179,194,0.45)', putus });
    for (const [kunci, y, warna] of [['tp', k.yT, HIJAU], ['sl', k.yS, MERAH]]) {
      const arah = Math.sign(y - k.yE) || (kunci === 'tp' ? -1 : 1);
      let yy = y + arah * (3 + PIL.h / 2);
      if (Math.abs(yy - k.yE) < PIL.h + 4) yy = k.yE + arah * (PIL.h + 4);
      const v = pilih(varian[kunci]);
      out.push({ ...v, x: xDi(v.w), y: yDi(yy), bg: tegas ? `rgba(${warna},0.95)` : 'rgba(10,13,18,0.92)', bd: tegas ? null : `rgba(${warna},0.85)`, putus });
    }
    return out;
  }
  function kotakRect(r) { return { x: r.x, y: r.y - PIL.h / 2, w: r.w, h: PIL.h }; }
  const tumpuk = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  function isiKotak(ctx, k, hr, vr, a) {
    const x1 = Math.round(k.x1 * hr), x2 = Math.round(k.x2 * hr), yE = Math.round(k.yE * vr), yT = Math.round(k.yT * vr), yS = Math.round(k.yS * vr);
    if (x2 <= x1) return;
    ctx.fillStyle = `rgba(${HIJAU},${a})`; ctx.fillRect(x1, Math.min(yE, yT), x2 - x1, Math.abs(yT - yE));
    ctx.fillStyle = `rgba(${MERAH},${a})`; ctx.fillRect(x1, Math.min(yE, yS), x2 - x1, Math.abs(yS - yE));
  }
  function garisH(ctx, x1, x2, y) { ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); }
  function garisPosisi(ctx, k, hr, vr, now = 0) {
    const j = k.p.jenis, rencana = j === 'siaga' || j === 'rencana';
    const x1 = Math.round(k.x1 * hr), x2 = Math.round(k.x2 * hr), yE = Math.round(k.yE * vr) + .5, yT = Math.round(k.yT * vr) + .5, yS = Math.round(k.yS * vr) + .5;
    if (x2 <= x1) return;
    const lw = Math.max(1, Math.round(hr)), putus = [5 * hr, 4 * hr];
    ctx.lineWidth = lw;
    if (rencana) {        // rencana: garis luar putus-putus per zona
      ctx.setLineDash(putus);
      ctx.strokeStyle = `rgba(${HIJAU},0.8)`; ctx.strokeRect(x1 + .5, Math.min(yE, yT), x2 - x1 - 1, Math.abs(yT - yE));
      ctx.strokeStyle = `rgba(${MERAH},0.8)`; ctx.strokeRect(x1 + .5, Math.min(yE, yS), x2 - x1 - 1, Math.abs(yS - yE));
    } else {
      ctx.strokeStyle = `rgba(${HIJAU},0.95)`; garisH(ctx, x1, x2, yT);
      ctx.strokeStyle = `rgba(${MERAH},0.95)`; garisH(ctx, x1, x2, yS);
      ctx.setLineDash([3 * hr, 3 * hr]); ctx.strokeStyle = `rgba(${AMBER},0.6)`;   // tepi kanan = batas waktu posisi
      ctx.beginPath(); ctx.moveTo(x2 - .5, Math.min(yT, yS)); ctx.lineTo(x2 - .5, Math.max(yT, yS)); ctx.stroke();
    }
    ctx.setLineDash(rencana ? putus : []);
    ctx.lineWidth = Math.max(1, Math.round(1.6 * hr)); ctx.strokeStyle = 'rgba(223,229,238,0.92)'; garisH(ctx, x1, x2, yE);
    ctx.setLineDash([]);
    if (k.xN != null && k.yN != null) {   // posisi berjalan: entry → harga kini (garis mengalir + titik berdenyut)
      const c = k.p.side * (k.p.harga - k.p.entry) >= 0 ? HIJAU : MERAH, xN = k.xN * hr, yN = k.yN * vr;
      ctx.lineWidth = lw; ctx.setLineDash([4 * hr, 3 * hr]); ctx.lineDashOffset = GERAK ? -(now / 45 % 7) * hr : 0; ctx.strokeStyle = `rgba(${c},0.95)`;
      ctx.beginPath(); ctx.moveTo(x1, yE); ctx.lineTo(xN, yN); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      if (GERAK) { const f = (now % 1600) / 1600; ctx.strokeStyle = `rgba(${c},${0.7 * (1 - f)})`; ctx.lineWidth = 1.5 * hr; ctx.beginPath(); ctx.arc(xN, yN, (3.5 + 10 * f) * hr, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = `rgb(${c})`; ctx.beginPath(); ctx.arc(xN, yN, 3.4 * hr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#dfe5ee'; ctx.beginPath(); ctx.arc(x1, yE, 3 * hr, 0, Math.PI * 2); ctx.fill();   // titik entry
  }
  function garisTrade(ctx, k, hr, vr) {
    const x = k.p, s = k.sorot, x1 = Math.round(k.x1 * hr), x2 = Math.round(k.x2 * hr), yE = Math.round(k.yE * vr) + .5;
    ctx.lineWidth = Math.max(1, Math.round(hr));
    if (s) {
      ctx.strokeStyle = `rgba(${HIJAU},0.9)`; garisH(ctx, x1, x2, Math.round(k.yT * vr) + .5);
      ctx.strokeStyle = `rgba(${MERAH},0.9)`; garisH(ctx, x1, x2, Math.round(k.yS * vr) + .5);
    }
    ctx.strokeStyle = `rgba(223,229,238,${s ? 0.9 : 0.35})`; garisH(ctx, x1, x2, yE);
    if (k.xX == null || k.yX == null || k.jalur) return;   // saat diputar ulang, jalur harga digambar animasi
    const c = x.pnl > 0 ? HIJAU : MERAH;   // entry → keluar
    ctx.setLineDash([3 * hr, 3 * hr]); ctx.strokeStyle = `rgba(${c},${s ? 0.95 : 0.55})`;
    ctx.beginPath(); ctx.moveTo(x1, yE); ctx.lineTo(k.xX * hr, k.yX * vr); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = `rgba(${c},${s ? 1 : 0.8})`; ctx.beginPath(); ctx.arc(k.xX * hr, k.yX * vr, (s ? 3.2 : 2.4) * hr, 0, Math.PI * 2); ctx.fill();
  }
  function bulat(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function gambarLabel(ctx, lay, alfa = 1) {
    if (!(alfa > 0)) return;
    ctx.save(); ctx.globalAlpha = alfa;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (const q of lay) {
      bulat(ctx, q.x, q.y - PIL.h / 2, q.w, PIL.h, 4);
      ctx.fillStyle = q.bg; ctx.fill();
      if (q.bd) { ctx.lineWidth = 1; ctx.strokeStyle = q.bd; if (q.putus) ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]); }
      let x = q.x + PIL.pad;
      for (const s of q.seg) { ctx.font = fontPil(s.b); ctx.fillStyle = s.c; ctx.fillText(s.t, x, q.y + 0.5); x += ctx.measureText(s.t).width; }
    }
    ctx.textBaseline = 'alphabetic'; ctx.restore();
  }

  // ---------------------------------------------------------------- animasi chart: posisi dibuka, kena TP / SL / waktu habis, putar ulang trade
  // Semua animasi dihitung dari waktu & harga (bukan piksel), jadi tetap menempel saat chart digeser/di-zoom.
  const GERAK = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ANIM = { list: [], raf: 0, denyut: false, tLalu: 0 };
  const mudah = {
    keluar: x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3),
    balik: x => { x = Math.min(1, Math.max(0, x)); const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); },
  };
  const jepit = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  function acak(seed) { let s = (seed >>> 0) || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
  /** a.jenis: 'buka' {side, entry, tp, sl, tE, dur} · 'tutup' {hasil, side, entry, tp, sl, keluar, tE, t1, pnl} · 'putar' {x: trade riwayat} */
  function mulaiAnim(a) {
    a.t = performance.now();
    const r = acak(Math.round(Math.abs(a.entry || (a.x && a.x.entry) || 1) * 100) ^ (a.t | 0));
    a.serpih = Array.from({ length: GERAK ? 28 : 0 }, () => ({ s: r() * Math.PI * 2, v: 70 + r() * 170, u: 2 + r() * 3, w: r(), z: r() }));
    ANIM.list = ANIM.list.filter(x => x.kunci !== a.kunci);
    ANIM.list.push(a); jalanAnim();
  }
  function jalanAnim() {
    if (ANIM.raf) return;
    const langkah = now => {
      ANIM.raf = 0;
      ANIM.list = ANIM.list.filter(a => now - a.t < a.d);
      const hidup = ANIM.list.length > 0 || (ANIM.denyut && GERAK && !document.hidden);
      if (!hidup) { zona.minta(); return; }
      if (ANIM.list.length || now - ANIM.tLalu > 33) { ANIM.tLalu = now; zona.minta(); }   // denyut posisi ±30 fps, kejadian 60 fps
      ANIM.raf = requestAnimationFrame(langkah);
    };
    ANIM.raf = requestAnimationFrame(langkah);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) jalanAnim(); });
  const animUntuk = (jenis, tE) => ANIM.list.find(a => a.jenis === jenis && Math.abs(a.tE - tE) < 1000);
  /** waktu (ms) → posisi logis TEPI candle di chart (bisa pecahan & di depan candle terakhir). Penutupan candle i = i + 0.5. */
  function lgs(t) {
    const B = CH.bars, n = B.length; if (!n || !ok(t)) return null;
    const ms = TF_MS[CH.tf] || 6e4, akhir = (B[n - 1].time - 7 * 3600) * 1000 + ms;
    if (t > akhir) return n - 0.5 + (t - akhir) / ms;
    const i = idxWaktu(tl(t - 1)); return i < 0 ? null : i + 0.5;
  }
  function pil(ctx, teks, x, y, warna, isi, alfa = 1, ukuran = 12) {
    ctx.save(); ctx.globalAlpha = alfa; ctx.font = `700 ${ukuran}px Inter, system-ui, sans-serif`; ctx.textBaseline = 'middle';
    const w = ctx.measureText(teks).width + 16, h = ukuran + 10;
    bulat(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fillStyle = isi; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = warna; ctx.stroke();
    ctx.fillStyle = warna; ctx.textAlign = 'center'; ctx.fillText(teks, x, y + 0.5); ctx.restore();
    return w;
  }
  function cincin(ctx, x, y, r, warna, alfa, tebal = 2) { ctx.save(); ctx.globalAlpha = alfa; ctx.lineWidth = tebal; ctx.strokeStyle = warna; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  const WARNA = { TP: [HIJAU, '#d8fff1'], SL: [MERAH, '#ffe1e3'], WKT: [AMBER, '#fff1d6'] };
  const rpTeks = (pnl, sym) => frp(keRp(pnl, sym));
  /** efek pembukaan posisi: kotak tumbuh dari garis entry (di hitung()), cincin di titik entry, label arah */
  function efekBuka(ctx, a, k, e, W) {
    const col = a.side > 0 ? HIJAU : MERAH, warna = `rgb(${col})`;
    if (k.x1 == null || k.yE == null) return;
    for (let q = 0; q < 3; q++) {
      const f = (e - q * 260) / 950; if (f <= 0 || f >= 1) continue;
      cincin(ctx, k.x1, k.yE, 5 + 36 * mudah.keluar(f), warna, (1 - f) * 0.9, 2);
    }
    ctx.save(); ctx.fillStyle = '#fff'; ctx.shadowColor = warna; ctx.shadowBlur = 14 * (1 - jepit(e / 1600));
    ctx.beginPath(); ctx.arc(k.x1, k.yE, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    const masuk = mudah.balik(e / 420), keluar = e > a.d - 600 ? (a.d - e) / 600 : 1;
    const teks = (a.side > 0 ? 'BUY ▲ dibuka ' : 'SELL ▼ dibuka ') + fh(a.entry);
    ctx.save(); ctx.font = '700 12px Inter, system-ui, sans-serif'; const w = ctx.measureText(teks).width + 16; ctx.restore();
    let x = k.x1 - w / 2 - 12; if (x - w / 2 < 4) x = Math.min(W - w / 2 - 4, k.x1 + w / 2 + 12);
    const y = k.yE - a.side * (1 - masuk) * 22;
    pil(ctx, teks, x, y, warna, 'rgba(10,13,18,0.94)', jepit(masuk) * keluar);
  }
  /** efek penutupan: kilat zona, gelombang kejut di titik keluar, serpihan, ikon, label hasil Rp */
  function efekTutup(ctx, a, k, e, W, H) {
    const [col, terang] = WARNA[a.hasil] || WARNA.WKT, warna = `rgb(${col})`, tp = a.hasil === 'TP', sl = a.hasil === 'SL';
    const x = k.xX != null ? k.xX : k.x2, y = k.yK != null ? k.yK : k.yE; if (x == null || y == null) return;
    const pudar = e > a.d - 700 ? (a.d - e) / 700 : 1;
    if (GERAK && e < 520) { ctx.save(); ctx.fillStyle = `rgba(${col},${(sl ? 0.16 : 0.10) * (1 - e / 520)})`; ctx.fillRect(0, 0, W, H); ctx.restore(); }
    if (k.x1 != null && k.x2 != null && k.x2 > k.x1) {   // kilat zona yang kena
      const yZ = tp ? k.yT : sl ? k.yS : y, kedip = sl ? Math.abs(Math.sin(e / 105)) * (1 - jepit(e / 900)) : 1 - jepit(e / 900);
      ctx.save(); ctx.fillStyle = `rgba(${col},${0.32 * kedip})`; ctx.fillRect(Math.min(k.x1, k.x2), Math.min(k.yE, yZ), Math.abs(k.x2 - k.x1), Math.abs(yZ - k.yE)); ctx.restore();
    }
    for (let q = 0; q < 2; q++) { const f = (e - q * 180) / 760; if (f > 0 && f < 1) cincin(ctx, x, y, 4 + 48 * mudah.keluar(f), warna, (1 - f) * 0.95, q ? 1.5 : 2.5); }
    // serpihan: TP = konfeti hijau-emas naik lalu jatuh, SL = pecahan merah jatuh
    const dt = e / 1000;
    if (dt < 1.7) for (const s of a.serpih || []) {
      const v = s.v * (sl ? 0.7 : 1), vx = Math.cos(s.s) * v, vy = Math.sin(s.s) * v - (tp ? 150 : 20);
      const px = x + vx * dt, py = y + vy * dt + 0.5 * 420 * dt * dt, al = (1 - dt / 1.7) * pudar;
      if (al <= 0) continue;
      ctx.save(); ctx.globalAlpha = al; ctx.translate(px, py); ctx.rotate(s.s + dt * (4 + s.z * 6));
      ctx.fillStyle = tp ? (s.w < 0.35 ? '#f5d061' : s.w < 0.7 ? warna : terang) : (s.w < 0.5 ? warna : '#ff8a8f');
      if (sl) { ctx.beginPath(); ctx.moveTo(-s.u, -s.u); ctx.lineTo(s.u * 1.2, 0); ctx.lineTo(-s.u * 0.6, s.u); ctx.closePath(); ctx.fill(); }
      else ctx.fillRect(-s.u, -s.u * 0.45, s.u * 2, s.u * 0.9);
      ctx.restore();
    }
    // ikon di titik keluar
    const sk = mudah.balik(e / 420) * pudar, gs = sl && GERAK && e < 650 ? Math.sin(e / 16) * 5 * (1 - e / 650) : 0;
    if (sk > 0) {
      ctx.save(); ctx.translate(x + gs, y); ctx.scale(sk, sk);
      ctx.fillStyle = warna; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0a0d12'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.beginPath();
      if (tp) { ctx.moveTo(-4.5, 0.5); ctx.lineTo(-1.2, 3.8); ctx.lineTo(4.8, -3.4); }
      else if (sl) { ctx.moveTo(-3.8, -3.8); ctx.lineTo(3.8, 3.8); ctx.moveTo(3.8, -3.8); ctx.lineTo(-3.8, 3.8); }
      else { ctx.moveTo(0, -5); ctx.lineTo(0, 0); ctx.lineTo(3.5, 2.5); }
      ctx.stroke(); ctx.restore();
    }
    // label hasil: TP naik, SL turun (bergetar), waktu habis diam
    const arah = tp ? -1 : sl ? 1 : -1, geser = 20 + 30 * mudah.keluar(e / 1300);
    const teks = `${a.hasil === 'WKT' ? 'WAKTU HABIS' : a.hasil} ${a.pnl >= 0 ? '+' : ''}${rpTeks(a.pnl, P.sym).replace(/^\+/, '')}`;
    pil(ctx, teks, x + gs, y + arah * geser, warna, 'rgba(10,13,18,0.95)', jepit(e / 220) * pudar, 13);
  }
  /** putar ulang trade riwayat: buka (0–0,8 dtk) → harga berjalan candle demi candle → efek TP/SL di titik keluar */
  function efekPutar(ctx, a, k, e, W, H) {
    const x = a.x, BUKA = 800, JALAN = 2300;
    if (e < BUKA + 400) efekBuka(ctx, { ...a, side: x.side, entry: x.entry, d: BUKA + 400 }, k, e, W);
    const jalur = k.jalur || []; if (jalur.length < 2) return;
    const f = jepit((e - BUKA) / JALAN); if (e < BUKA) return;
    // panjang jalur → titik pada pecahan f
    let total = 0; const seg = []; for (let i = 1; i < jalur.length; i++) { const d = Math.hypot(jalur[i][0] - jalur[i - 1][0], jalur[i][1] - jalur[i - 1][1]); seg.push(d); total += d; }
    let sisa = total * mudah.keluar(f), i = 1; while (i < jalur.length - 1 && sisa > seg[i - 1]) { sisa -= seg[i - 1]; i++; }
    const a0 = jalur[i - 1], a1 = jalur[i], u = seg[i - 1] ? jepit(sisa / seg[i - 1]) : 1;
    const px = a0[0] + (a1[0] - a0[0]) * u, py = a0[1] + (a1[1] - a0[1]) * u, harga = a0[2] + (a1[2] - a0[2]) * u;
    const pnl = f >= 1 ? x.pnl : x.side * (harga - x.entry) - (P.spread[P.sym] || 0), col = pnl >= 0 ? HIJAU : MERAH;
    ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = `rgba(${col},0.95)`; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(jalur[0][0], jalur[0][1]);
    for (let q = 1; q < i; q++) ctx.lineTo(jalur[q][0], jalur[q][1]);
    ctx.lineTo(px, py); ctx.stroke();
    ctx.fillStyle = `rgba(${col},0.18)`; ctx.beginPath(); ctx.moveTo(jalur[0][0], k.yE); for (let q = 0; q < i; q++) ctx.lineTo(jalur[q][0], jalur[q][1]); ctx.lineTo(px, py); ctx.lineTo(px, k.yE); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.shadowColor = `rgb(${col})`; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(px, py, 4.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    if (e < BUKA + JALAN + 200) pil(ctx, `${pnl >= 0 ? '+' : ''}${rpTeks(pnl, P.sym).replace(/^\+/, '')}`, Math.min(W - 50, px + 46), py - 16, `rgb(${col})`, 'rgba(10,13,18,0.92)', 1, 11);
    if (e >= BUKA + JALAN) efekTutup(ctx, { ...a, hasil: x.hasil, pnl: x.pnl, d: a.d - BUKA - JALAN }, k, e - BUKA - JALAN, W, H);
  }

  /** Primitive: gelombang (zigzag puncak/lembah + label HH/HL/LH/LL), garis & zona batas gelombang, alat posisi (entry/TP/SL) + trade riwayat + animasi. */
  class Zona {
    constructor() {
      this.d = null; this.g = null; this.ch = null; this.se = null; this.req = null; this.sorot = null; const z = this;
      this.views = [{ zOrder: () => 'bottom', renderer: () => ({ draw: t => z.gambarBawah(t) }) }, { zOrder: () => 'top', renderer: () => ({ draw: t => z.gambarAtas(t) }) }];
    }
    attached(p) { this.ch = p.chart; this.se = p.series; this.req = p.requestUpdate; }
    detached() { this.ch = this.se = this.req = null; }
    paneViews() { return this.views; }
    updateAllViews() { this.hitung(); }
    set(d) { this.d = d; this.minta(); }
    minta() { if (this.req) this.req(); }
    hitung() {
      const d = this.d; this.g = null;
      if (!d || !this.ch || !this.se) return;
      const ts = this.ch.timeScale(), se = this.se, g = {}, now = performance.now();
      const xy = (t, p) => { const x = ts.timeToCoordinate(t), y = se.priceToCoordinate(p); return x == null || y == null ? null : [x, y]; };
      const yP = p => ok(p) ? se.priceToCoordinate(p) : null;
      if (d.level) {
        const L = d.level;
        g.lv = [
          { x: L.tA ? ts.timeToCoordinate(L.tA) : null, y: se.priceToCoordinate(L.atas), yz: se.priceToCoordinate(L.atas - L.zona), warna: '242,84,91', teks: 'BATAS ATAS · ' + (L.lblA || 'puncak'), atas: true },
          { x: L.tB ? ts.timeToCoordinate(L.tB) : null, y: se.priceToCoordinate(L.bawah), yz: se.priceToCoordinate(L.bawah + L.zona), warna: '34,195,154', teks: 'BATAS BAWAH · ' + (L.lblB || 'lembah'), atas: false },
        ];
      }
      if (d.gel) {
        g.piv = d.gel.piv.map(x => { const q = xy(x.t, x.p); return q && { x: q[0], y: q[1], tipe: x.tipe, lbl: x.lbl }; }).filter(Boolean);
        g.ujung = d.gel.ujung ? xy(d.gel.ujung.t, d.gel.ujung.p) : null;
      }
      const B = CH.bars; if (!B.length) { this.g = g; return; }
      const W = ts.width(), H = Math.max(0, $('chart').clientHeight - ts.height());
      // indeks logis → x. LWC 4.1 mengembalikan 0 untuk indeks pecahan, jadi interpolasi dari dua indeks bulat
      const xL = l => {
        if (l == null) return null;
        const a = Math.floor(l), xa = ts.logicalToCoordinate(a); if (xa == null || l === a) return xa;
        const xb = ts.logicalToCoordinate(a + 1); return xb == null ? null : xa + (l - a) * (xb - xa);
      };
      // kotak posisi dari tepi logis l1 (entry = penutupan candle sinyal) sampai l2 (keluar / batas waktu)
      const kotak = (p, l1, l2) => {
        const k = { p, l1, l2, x1: xL(l1), x2: xL(l2), yE: yP(p.entry), yT: yP(p.tp), yS: yP(p.sl) };
        return k.x1 == null || k.x2 == null || k.yE == null || k.yT == null || k.yS == null ? null : k;
      };
      const tumbuh = (k, e) => {   // animasi buka: zona TP/SL tumbuh dari garis entry, kotak memanjang ke kanan
        const v = mudah.keluar(e / 900), h = mudah.keluar(e / 700);
        k.yT = k.yE + (k.yT - k.yE) * v; k.yS = k.yE + (k.yS - k.yE) * v; k.x2 = k.x1 + (k.x2 - k.x1) * h; k.alfa = jepit((e - 350) / 500);
      };
      if (d.pos) {          // posisi berjalan / calon / rencana
        const p = d.pos, l1 = lgs(p.tE), l2 = lgs(p.tE + p.dur), k = l1 != null && l2 != null ? kotak(p, l1, l2) : null;
        if (k) {
          const iK = idxWaktu(tl(p.tBar));        // candle berjalan: label tidak boleh menutupinya
          if (iK >= 0) { const c0 = xL(iK - 0.5), c1 = xL(iK + 0.5); if (c0 != null && c1 != null) k.cur = [c0, c1]; }
          if (p.jenis === 'aktif' && ok(p.harga)) {
            const f = p.barMs ? jepit((p.t - p.tBar) / p.barMs) : 1;
            k.xN = xL(Math.min(l2, Math.max(l1, iK - 0.5 + f))); k.yN = se.priceToCoordinate(p.harga);
          }
          const ab = p.jenis === 'aktif' && animUntuk('buka', p.tE); if (ab) tumbuh(k, now - ab.t);
          g.pos = k;
        }
      }
      const lr = ts.getVisibleLogicalRange();   // trade riwayat yang terlihat (kotak tipis; label saat disorot)
      const putar = ANIM.list.find(a => a.jenis === 'putar');
      if (lr && CH.tr && CH.tr.size) {
        g.riw = [];
        for (const x of CH.tr.values()) {
          const l1 = lgs(x.t0 + (x.ms || CH.sMs)), l2 = lgs(x.t1); if (l1 == null || l2 == null || x.t0 < (B[0].time - 7 * 3600) * 1000) continue;
          if (l2 + 1 < lr.from || l1 > lr.to + 1) continue;
          const k = kotak(x, l1, Math.max(l2, l1 + 0.5)); if (!k) continue;
          k.xX = xL(Math.max(l1, l2 - 0.5)); k.yX = se.priceToCoordinate(x.keluar); k.sorot = x === this.sorot;
          if (putar && putar.x === x) {
            const e = now - putar.t; tumbuh(k, e); k.sorot = true;
            // jalur harga: entry → penutupan tiap candle → titik keluar
            const jalur = [[k.x1, k.yE, x.entry]];
            for (let i = Math.ceil(l1); i < l2 - 0.5; i++) { const b = B[i]; if (!b) break; const xx = xL(i), yy = se.priceToCoordinate(b.close); if (xx != null && yy != null) jalur.push([xx, yy, b.close]); }
            if (k.xX != null && k.yX != null) jalur.push([k.xX, k.yX, x.keluar]);
            k.jalur = jalur; k.yK = k.yX;
            if (e < 3100) k.sembunyiKeluar = true;   // titik keluar muncul saat animasi sampai
          }
          g.riw.push(k);
        }
      }
      // animasi kejadian (posisi live dibuka / ditutup)
      g.anim = [];
      for (const a of ANIM.list) {
        if (a.jenis === 'putar') { const k = (g.riw || []).find(q => q.p === a.x); if (k) g.anim.push([a, k]); continue; }
        const l1 = lgs(a.tE), l2 = lgs(a.t1 != null ? a.t1 : a.tE + a.dur);
        const k = { x1: xL(l1), x2: xL(l2), yE: yP(a.entry), yT: yP(a.tp), yS: yP(a.sl) };
        if (a.jenis === 'tutup') { k.xX = xL(l2 == null ? null : Math.max(l1 || 0, l2 - 0.5)); k.yK = yP(a.keluar); }
        if (a.jenis === 'buka' && g.pos && Math.abs(g.pos.p.tE - a.tE) < 1000) { k.x1 = g.pos.x1; k.yE = g.pos.yE; }
        g.anim.push([a, k]);
      }
      g.W = W; g.H = H; g.now = now;
      this.g = g;
    }
    /** tata label sekali per gambar, diukur dengan konteks kanvas chart sendiri (kanvas lain mengukur angka berbeda) */
    tata(ctx) {
      const g = this.g; if (!g || g.tertata) return; g.tertata = true;
      const ukur = s => { ctx.font = fontPil(s.b); return ctx.measureText(s.t).width; };
      if (g.pos) g.pos.lay = tataLabel(g.pos, g.W, g.H, teksPosisi(g.pos.p), g.pos.p.jenis, ukur);
      for (const k of g.riw || []) if (k.sorot && !k.jalur) k.lay = tataLabel(k, g.W, g.H, teksPosisi({ ...k.p, jenis: 'riwayat' }), 'riwayat', ukur);
    }
    gambarBawah(target) {
      const g = this.g; if (!g) return;
      target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
        this.tata(ctx);
        const pil = [...(g.pos && g.pos.lay || []), ...((g.riw || []).find(k => k.lay) || { lay: [] }).lay].map(kotakRect);
        const Wd = bitmapSize.width;
        for (const v of g.lv || []) {          // zona sentuh pola + garis batas gelombang
          if (v.y == null) continue;
          const x1 = v.x == null ? 0 : Math.max(0, Math.round(v.x * hr)), y = Math.round(v.y * vr), yz = v.yz == null ? y : Math.round(v.yz * vr);
          ctx.fillStyle = `rgba(${v.warna},0.10)`; ctx.fillRect(x1, Math.min(y, yz), Wd - x1, Math.max(1, Math.abs(yz - y)));
          ctx.lineWidth = Math.max(1, Math.round(1.3 * vr)); ctx.strokeStyle = `rgba(${v.warna},0.95)`;
          ctx.beginPath(); ctx.moveTo(x1, y + .5); ctx.lineTo(Wd, y + .5); ctx.stroke();
          ctx.font = `600 ${Math.round(10.5 * vr)}px Inter, system-ui, sans-serif`; ctx.fillStyle = `rgba(${v.warna},0.95)`;
          const teks = Wd / hr < 560 ? v.teks.replace('BATAS ', '') : v.teks, lebarT = ctx.measureText(teks).width;
          const tx = Math.max(x1 + 34 * hr, Wd - lebarT - (Wd / hr < 560 ? 12 : 64) * hr);
          // nama batas tidak boleh tertutup label alat posisi: coba sisi lain garis, kalau tetap bentrok disembunyikan
          const coba = v.atas ? [y - 5 * vr, y + 14 * vr] : [y + 14 * vr, y - 5 * vr];
          const ty = coba.find(b => !pil.some(r => tumpuk(r, { x: tx / hr, y: b / vr - 10, w: lebarT / hr, h: 12 })));
          if (ty != null) ctx.fillText(teks, tx, ty);
        }
        for (const k of g.riw || []) isiKotak(ctx, k, hr, vr, k.jalur ? 0.15 : k.sorot ? 0.15 : 0.06);
        if (g.pos) {
          const k = g.pos, denyut = k.p.jenis === 'calon' && GERAK ? 0.05 * (0.5 + 0.5 * Math.sin(g.now / 240)) : 0;
          isiKotak(ctx, k, hr, vr, ({ aktif: 0.17, calon: 0.12, siaga: 0.1, rencana: 0.07 }[k.p.jenis] || 0.1) + denyut);
          if (k.xN != null && k.yN != null) {   // area untung/rugi yang sudah berjalan
            const x1 = Math.round(k.x1 * hr), xN = Math.round(k.xN * hr), yE = Math.round(k.yE * vr), yN = Math.round(k.yN * vr);
            ctx.fillStyle = `rgba(${k.p.side * (k.p.harga - k.p.entry) >= 0 ? HIJAU : MERAH},0.24)`;
            if (xN > x1) ctx.fillRect(x1, Math.min(yE, yN), xN - x1, Math.abs(yN - yE));
          }
        }
      });
    }
    gambarAtas(target) {
      const g = this.g; if (!g) return;
      target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
        this.tata(ctx);
        const P_ = g.piv || [];
        if (P_.length) {
          ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, 1.4 * hr); ctx.strokeStyle = 'rgba(214,222,235,0.55)';
          ctx.beginPath(); ctx.moveTo(P_[0].x * hr, P_[0].y * vr);
          for (let i = 1; i < P_.length; i++) ctx.lineTo(P_[i].x * hr, P_[i].y * vr);
          ctx.stroke();
          if (g.ujung) {   // kaki gelombang yang masih berjalan
            const a = P_[P_.length - 1]; ctx.setLineDash([4 * hr, 4 * hr]); ctx.strokeStyle = 'rgba(245,176,65,0.75)';
            ctx.beginPath(); ctx.moveTo(a.x * hr, a.y * vr); ctx.lineTo(g.ujung[0] * hr, g.ujung[1] * vr); ctx.stroke(); ctx.setLineDash([]);
          }
          ctx.font = `700 ${Math.round(9.5 * vr)}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center';
          for (const q of P_) {
            const naik = q.lbl === 'HH' || q.lbl === 'HL', turun = q.lbl === 'LH' || q.lbl === 'LL';
            ctx.fillStyle = naik ? 'rgba(34,195,154,0.95)' : turun ? 'rgba(242,84,91,0.95)' : 'rgba(170,179,194,0.9)';
            ctx.beginPath(); ctx.arc(q.x * hr, q.y * vr, 2.4 * hr, 0, Math.PI * 2); ctx.fill();
            ctx.fillText(q.lbl, q.x * hr, q.tipe > 0 ? q.y * vr - 7 * vr : q.y * vr + 15 * vr);
          }
          ctx.textAlign = 'start';
        }
        for (const k of g.riw || []) garisTrade(ctx, k, hr, vr);
        if (g.pos) garisPosisi(ctx, g.pos, hr, vr, g.now);
      });
      target.useMediaCoordinateSpace(({ context: ctx }) => {   // label & animasi di ruang px CSS agar teks tajam
        for (const k of g.riw || []) if (k.lay) gambarLabel(ctx, k.lay);
        if (g.pos && g.pos.lay) gambarLabel(ctx, g.pos.lay, g.pos.alfa);
        for (const [a, k] of g.anim || []) {
          const e = g.now - a.t;
          if (a.jenis === 'buka') efekBuka(ctx, a, k, e, g.W);
          else if (a.jenis === 'tutup') efekTutup(ctx, a, k, e, g.W, g.H);
          else if (a.jenis === 'putar') efekPutar(ctx, a, k, e, g.W, g.H);
        }
      });
    }
  }
  const zona = new Zona();

  function buatChart() {
    if (!LW) { setT($('muat-t'), 'Pustaka chart gagal dimuat — periksa koneksi lalu muat ulang.'); return; }
    chart = LW.createChart($('chart'), {
      autoSize: true,
      layout: { background: { type: 'solid', color: '#0a0d12' }, textColor: '#8790a1', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(255,255,255,0.028)' }, horzLines: { color: 'rgba(255,255,255,0.028)' } },
      rightPriceScale: { borderColor: C.line, scaleMargins: { top: 0.1, bottom: 0.14 } },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 10, barSpacing: 7, minBarSpacing: 1 },
      crosshair: { mode: LW.CrosshairMode.Normal, vertLine: { color: 'rgba(148,163,184,.35)', labelBackgroundColor: '#273041' }, horzLine: { color: 'rgba(148,163,184,.35)', labelBackgroundColor: '#273041' } },
      localization: { locale: 'id-ID', priceFormatter: p => nf(2).format(p) },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
    });
    vs = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.88, bottom: 0 }, visible: false });
    // level gelombang per candle (disimpan untuk sinkron waktu, tidak digambar: zigzag sudah menunjukkan riwayat gelombang)
    const garisRiwayat = c => ({ color: c, lineWidth: 1, lineType: 1, visible: false, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
    su = chart.addLineSeries(garisRiwayat('rgba(242,84,91,0.30)'));
    sb = chart.addLineSeries(garisRiwayat('rgba(34,195,154,0.30)'));
    cs = chart.addCandlestickSeries({ upColor: C.up, downColor: C.dn, wickUpColor: C.up, wickDownColor: C.dn, borderVisible: false,
      priceLineColor: '#aab3c2', priceLineStyle: 2, priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      // skala otomatis: candle terlihat + batas & alat posisi (entry/TP/SL) saat ini (bila candle terakhir terlihat)
      autoscaleInfoProvider: asli => {
        const r = asli(), s = CH.s; if (!r || !s || !chart) return r;
        const lr = chart.timeScale().getVisibleLogicalRange();
        if (!lr || lr.to < CH.bars.length - 2) return r;
        const ext = [s.atas, s.bawah]; const t = CH.pos;
        if (t) ext.push(t.tp, t.sl);
        for (const v of ext) if (ok(v)) { r.priceRange.minValue = Math.min(r.priceRange.minValue, v); r.priceRange.maxValue = Math.max(r.priceRange.maxValue, v); }
        return r;
      } });
    cs.attachPrimitive(zona);
    const pl = (color, title, style = 0) => cs.createPriceLine({ price: 0, color, lineWidth: 1, lineStyle: style, lineVisible: false, axisLabelVisible: false, title });
    garis.atas = pl(C.dn, ''); garis.bawah = pl(C.up, '');
    // entry/TP/SL: hanya label harga di sumbu; garis & zonanya digambar alat posisi (Zona)
    garis.entry = pl('#c9d1dd', ''); garis.tp = pl(C.up, ''); garis.sl = pl(C.dn, '');
    chart.subscribeCrosshairMove(legendaDari);
  }
  const garisLama = {};
  function aturGaris(k, harga, tampil, garisTampil = true) {
    const g = garis[k]; if (!g) return;
    const key = tampil ? harga.toFixed(4) + garisTampil : 'x';
    if (garisLama[k] === key) return; garisLama[k] = key;
    g.applyOptions(tampil ? { price: harga, axisLabelVisible: true, lineVisible: garisTampil } : { axisLabelVisible: false, lineVisible: false });
  }

  function isiChart(m) {
    if (!chart) return;
    const B = m.bars, n = B.t.length, viewSama = CH.sym === m.sym && CH.tf === m.tf && CH.bars.length > 0;
    let kembalikan = null;
    if (viewSama) { const lr = chart.timeScale().getVisibleLogicalRange(); if (lr && lr.to < CH.bars.length - 3) kembalikan = chart.timeScale().getVisibleRange(); }
    // kosongkan semua seri dulu (LWC 4: ganti data candle saat seri garis masih memegang waktu lama → "Value is null")
    cs.setMarkers([]); cs.setData([]); vs.setData([]); su.setData([]); sb.setData([]);
    const bars = [], vols = [], uu = [], ll = [];
    for (let i = 0; i < n; i++) {
      const t = tl(B.t[i]);
      bars.push({ time: t, open: B.o[i], high: B.h[i], low: B.l[i], close: B.c[i] });
      vols.push({ time: t, value: B.v[i], color: B.c[i] >= B.o[i] ? 'rgba(34,195,154,.26)' : 'rgba(242,84,91,.26)' });
      uu.push(ok(B.U[i]) ? { time: t, value: B.U[i] } : { time: t });
      ll.push(ok(B.L[i]) ? { time: t, value: B.L[i] } : { time: t });
    }
    Object.assign(CH, { sym: m.sym, tf: m.tf, sMs: TF_MS[IKUT[m.tf] || m.tf], bars, vols, uu, ll, lastT: n ? B.t[n - 1] : 0 });
    if (n) { cs.setData(bars); vs.setData(vols); su.setData(uu); sb.setData(ll); }
    CH.uji = m.uji || CH.uji; CH.jurnal = m.jurnal || CH.jurnal;
    CH.piv = (m.piv || []).map(x => ({ t: tl(x.t), p: x.p, tipe: x.tipe, lbl: x.lbl }));
    pasangPenanda();
    // ruang kanan selebar batas waktu posisi, agar alat posisi (entry/TP/SL) terlihat utuh; layar sempit = lebih sedikit candle
    const sempit = $('chart').clientWidth < 600;
    // 1m mengikuti sinyal 5m: kotak posisi selebar 24 candle 5m = 120 candle 1m, cukup sebagian terlihat di kanan
    const kanan = IKUT[P.tf] ? 42 : MAXB[P.tf] + 3;
    if (!viewSama && n) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - (sempit ? 60 : IKUT[P.tf] ? 140 : 115)), to: n + kanan });
    else if (kembalikan) { try { chart.timeScale().setVisibleRange(kembalikan); } catch (e) { /* abaikan */ } }
    if (n > 30) $('muat').classList.add('pergi');
    legendaDari(null);
  }
  function berjalan(s) {
    if (!chart || !CH.bars.length || !s.bar || s.bar.t < CH.lastT) return;
    const b = s.bar, t = tl(b.t), bar = { time: t, open: b.o, high: b.h, low: b.l, close: b.c };
    const vol = { time: t, value: b.v, color: b.c >= b.o ? 'rgba(34,195,154,.26)' : 'rgba(242,84,91,.26)' };
    const u = ok(s.atas) ? { time: t, value: s.atas } : { time: t }, l = ok(s.bawah) ? { time: t, value: s.bawah } : { time: t };
    const n = CH.bars.length;
    if (b.t > CH.lastT) { CH.bars.push(bar); CH.vols.push(vol); CH.uu.push(u); CH.ll.push(l); CH.lastT = b.t; }
    else { CH.bars[n - 1] = bar; CH.vols[n - 1] = vol; CH.uu[n - 1] = u; CH.ll[n - 1] = l; }
    try { cs.update(bar); vs.update(vol); su.update(u); sb.update(l); }
    catch (e) { W.postMessage({ op: 'lihat', sym: P.sym, tf: P.tf }); }
  }
  function barTutup(m) {
    if (!chart || m.sym !== P.sym || m.tf !== P.tf) return;
    const t = tl(m.bar.t);
    let i = CH.bars.length - 1; while (i >= 0 && CH.bars[i].time > t) i--;
    if (i < 0 || CH.bars[i].time !== t) return;
    const b = m.bar, lama = CH.bars[i];
    const beda = lama.open !== b.o || lama.high !== b.h || lama.low !== b.l || lama.close !== b.c;
    CH.bars[i] = { time: t, open: b.o, high: b.h, low: b.l, close: b.c };
    CH.vols[i] = { time: t, value: b.v, color: b.c >= b.o ? 'rgba(34,195,154,.26)' : 'rgba(242,84,91,.26)' };
    if (beda) {
      try { if (i === CH.bars.length - 1) { cs.update(CH.bars[i]); vs.update(CH.vols[i]); } else { cs.setData(CH.bars); vs.setData(CH.vols); pasangPenanda(); } } catch (e) { /* */ }
    }
    if (m.jurnal) { CH.jurnal = m.jurnal; pasangPenanda(); }
    if (m.piv) CH.piv = m.piv.map(x => ({ t: tl(x.t), p: x.p, tipe: x.tipe, lbl: x.lbl }));
  }
  /** waktu chart candle tempat entry terjadi (candle terakhir sebelum penutupan candle sinyal) */
  function waktuEntry(x) { const i = idxWaktu(tl(x.t0 + (x.ms || CH.sMs) - 1)); return i >= 0 ? CH.bars[i].time : tl(x.t0); }
  function pasangPenanda() {
    if (!cs) return;
    const t0 = CH.bars.length ? CH.bars[0].time : Infinity, map = new Map();
    for (const x of CH.uji || []) if (tl(x.t0) >= t0) map.set(x.t0, x);
    for (const x of CH.jurnal || []) if (tl(x.t0) >= t0) map.set(x.t0, x);
    const s = CH.s, akt = s && s.aktif;
    const mk = [...map.values()].sort((a, b) => a.t0 - b.t0).map(x => ({ time: waktuEntry(x), position: x.side < 0 ? 'aboveBar' : 'belowBar',
      shape: x.side < 0 ? 'arrowDown' : 'arrowUp', color: x.pnl > 0 ? C.up : C.dn, text: x.sumber === 'live' ? (x.kode || 'live') : '' }));
    if (akt && tl(akt.t0) >= t0) mk.push({ time: waktuEntry(akt), position: akt.side < 0 ? 'aboveBar' : 'belowBar', shape: akt.side < 0 ? 'arrowDown' : 'arrowUp', color: C.am, text: (akt.side < 0 ? 'SELL ' : 'BUY ') + (akt.kode || '') });
    mk.sort((a, b) => a.time - b.time);
    for (let i = mk.length - 1; i > 0; i--) if (mk[i].time === mk[i - 1].time) mk.splice(i - 1, 1);   // satu penanda per candle
    try { cs.setMarkers(mk); } catch (e) { /* */ }
    const ukuranLama = CH.tr ? CH.tr.size : -1;
    CH.tr = map; CH.mkAkt = akt ? akt.t0 : 0;
    if (ukuranLama !== map.size && typeof renderRiwayat === 'function') renderRiwayat();
  }
  function legendaDari(param) {
    const el = $('legend'); if (!cs) return;
    let bar = null, tr = null;
    if (param && param.time && param.seriesData) bar = param.seriesData.get(cs);
    // trade riwayat di bawah kursor (sepanjang entry → keluar): kotaknya disorot + label TP/SL di chart
    if (param && param.time != null && CH.tr) for (const x of CH.tr.values()) if (waktuEntry(x) <= param.time && param.time < tl(x.t1)) { tr = x; break; }
    if (zona.sorot !== tr) { zona.sorot = tr; zona.minta(); }
    if (!bar) bar = CH.bars[CH.bars.length - 1];
    if (!bar) { el.innerHTML = ''; return; }
    const nm = NAMA[P.sym];
    let h = `<span class="t">${nm} · ${P.tf}${IKUT[P.tf] ? ` <small class="ikut">sinyal ${IKUT[P.tf]}</small>` : ''}</span><span class="ohl">O <b>${fh(bar.open)}</b></span><span class="ohl">H <b>${fh(bar.high)}</b></span><span class="ohl">L <b>${fh(bar.low)}</b></span><span>C <b>${fh(bar.close)}</b></span>`;
    if (tr) h += `<span class="tr ${tr.pnl > 0 ? 'w' : 'l'}">${tr.side < 0 ? 'SELL' : 'BUY'} ${fh(tr.entry)} → ${tr.hasil} ${fh(tr.keluar)} · ${frp(keRp(tr.pnl, P.sym))}${tr.sumber === 'live' ? ' · live' : ' · uji'}</span>`;
    if (el.innerHTML !== h) el.innerHTML = h;
  }

  // ---------------------------------------------------------------- pesan dari mesin
  const A = { strategi: null, jurnal: [], uji: [], hariIni: null, kebiasaan: null, sesi: null, batas: null, memori: null, kurva: null };
  function terima(m) {
    switch (m.op) {
      case 'riwayat': if (m.sym === P.sym && m.tf === P.tf) {
        isiChart(m); A.jurnal = m.jurnal || A.jurnal; renderRiwayat();
        if (PUTAR.nanti && CH.tr.has(PUTAR.nanti)) { const t = PUTAR.nanti; PUTAR.nanti = 0; setTimeout(() => putarUlang(t), 350); }
      } break;
      case 'detik': onDetik(m); break;
      case 'bar': barTutup(m); if (m.sym === P.sym && m.tf === P.tf && m.jurnal) { A.jurnal = m.jurnal; renderRiwayat(); } break;
      case 'analisis': if (m.sym === P.sym && m.tf === P.tf) { Object.assign(A, m); renderStrategi(); renderRiwayat(); renderKeb(); CH.jurnal = m.jurnal; pasangPenanda(); } break;
      case 'analisis-selesai': ulangSelesai(); break;
      case 'sinyal': onSinyal(m); break;
      case 'jurnal': if (m.sym === P.sym && m.tf === P.tf) {   // 1m mengikuti 5m: candle 5m baru tutup
        CH.jurnal = A.jurnal = m.jurnal || []; if (m.piv) CH.piv = m.piv.map(x => ({ t: tl(x.t), p: x.p, tipe: x.tipe, lbl: x.lbl })); pasangPenanda(); renderRiwayat(); } break;
      case 'kalibrasi-ok': kalibrasiOk(m); break;
      case 'terhapus': location.reload(); break;
      case 'galat': console.warn('[mesin]', m.pesan); break;
    }
  }

  let detikT = 0;
  function onDetik(m) {
    detikT = Date.now();
    if (m.kurs && Math.abs(m.kurs - KURS) > 1) { KURS = m.kurs; LS.set('kurs', Math.round(KURS)); }
    // header
    for (const sym of SYMS) {
      const h = m.harga[sym], b = document.querySelector(`.pair[data-sym="${sym}"]`); if (!h || !b) continue;
      setT(b.querySelector('[data-px]'), ok(h.p) && h.p > 0 ? fh(h.p) : '–');
      const c = b.querySelector('[data-chg]');
      setT(c, ok(h.ubah) ? (h.ubah >= 0 ? '+' : '−') + nf(2).format(Math.abs(h.ubah * 100)) + '%' : '');
      setC(c, 'pc ' + (ok(h.ubah) ? (h.ubah >= 0 ? 'up' : 'dn') : ''));
      setC(b.querySelector('[data-badge]'), 'pb ' + (h.lencana === 'SELL' ? 'sell' : h.lencana === 'BUY' ? 'buy' : ''));
      b.classList.toggle('tutup', !h.buka);
      const umur = FEED.sumber === 'exness' ? 0 : h.kal && h.kal.t ? Date.now() - h.kal.t : Infinity;
      setC(b.querySelector('[data-kal]'), 'pk' + (umur < 12 * 3600e3 ? ' ok' : umur < Infinity ? ' lama' : ''));
      HDR[sym] = h;
    }
    infoKal();
    const s = m.s, f = m.feed || {};
    if (f.sumber) { FEED = f; renderSumber(); }
    setT($('jam'), jms(s ? s.t : Date.now()));
    const live = $('live');
    setC(live, 'live ' + (f.ws ? 'on' : f.rest && Date.now() - f.rest < 15000 ? 'poll' : 'off'));
    live.dataset.info = f.ws ? 'ws' : f.rest && Date.now() - f.rest < 15000 ? 'poll' : 'off';
    if (f.unduh) {
      const u = f.unduh, pct = u.total ? Math.round(u.beres / u.total * 100) : 0;
      setT($('muat-t'), `${u.mundur ? 'Merekam riwayat lebih jauh' : 'Merekam riwayat'} ${u.sym} ${u.tf} · ${pct}%`);
    }
    if (!s || s.sym !== P.sym || s.tf !== P.tf) return;
    CH.s = s;
    berjalan(s);
    gambarLevel(s);
    renderSinyal(s); renderBatas(s); renderHitung(s);
    const tut = $('tutup');
    if (s.keadaan === 'TUTUP' && s.bukaLagi) { tut.classList.remove('hidden'); setT(tut, `Pasar emas tutup · buka lagi ${HARI[new Date(s.bukaLagi + WIB).getUTCDay()]} ${jm(s.bukaLagi)} WIB`); }
    else tut.classList.add('hidden');
    if (!$('muat').classList.contains('pergi') && CH.bars.length > 30 && !f.unduh) $('muat').classList.add('pergi');
    const lbl = { POSISI: s.aktif ? (s.aktif.side < 0 ? 'SELL' : 'BUY') : '', KANDIDAT: 'calon ' + (s.arah < 0 ? 'SELL' : 'BUY'), SIAGA: 'siaga', TEMBUS: 'tembus', TUTUP: 'tutup' }[s.keadaan] || '';
    document.title = `${NAMA[P.sym]} Bid ${ok(s.harga) ? fh(s.harga) : ''}${lbl ? ' · ' + lbl : ''} · Scalping`;
    if ((CH.mkAkt || 0) !== (s.aktif ? s.aktif.t0 : 0)) pasangPenanda();
  }

  function gambarLevel(s) {
    if (!chart) return;
    const adaR = ok(s.atas) && ok(s.bawah);
    aturGaris('atas', s.atas, adaR, false); aturGaris('bawah', s.bawah, adaR, false);
    // alat posisi: posisi berjalan (dari candle sinyal), calon (sah saat candle ini tutup), atau rencana perkiraan di level gelombang
    // waktu dalam ms: tE = penutupan candle sinyal (entry), dur = batas waktu posisi (maxb candle strategi). Di 1m (ikut 5m) candle strategi = 5m.
    let pos = null;
    const sMs = s.stratMs || s.barMs, tutupKini = Math.floor(s.t / sMs) * sMs + sMs;
    const sumber = s.aktif ? ['aktif', s.aktif, s.aktif.tE] : s.keadaan === 'KANDIDAT' && s.rencana ? ['calon', s.rencana]
      : (s.keadaan === 'SIAGA' || s.keadaan === 'TUNGGU') && s.siaga ? [s.keadaan === 'SIAGA' ? 'siaga' : 'rencana', s.siaga] : null;
    if (sumber && s.bar) {
      const x = sumber[1];
      if (ok(x.entry) && ok(x.tp) && ok(x.sl)) pos = { jenis: sumber[0], side: x.side, entry: x.entry, tp: x.tp, sl: x.sl, pl: x.pl,
        tE: sumber[2] || tutupKini, dur: (x.maxb || s.maxb || MAXB[s.ikut || s.tf]) * sMs, harga: s.harga, t: s.t, tBar: s.bar.t, barMs: s.chartMs || s.barMs };
    }
    CH.pos = pos;
    const denyutLama = ANIM.denyut;
    ANIM.denyut = !!pos && (pos.jenis === 'aktif' || pos.jenis === 'calon');
    if (ANIM.denyut && !denyutLama) jalanAnim();
    // label harga di sumbu hanya untuk posisi berjalan/calon (entry calon = harga kini, labelnya sudah ada)
    const sumbu = !!pos && (pos.jenis === 'aktif' || pos.jenis === 'calon');
    aturGaris('entry', sumbu ? pos.entry : 0, sumbu && pos.jenis === 'aktif', false); aturGaris('tp', sumbu ? pos.tp : 0, sumbu, false); aturGaris('sl', sumbu ? pos.sl : 0, sumbu, false);
    const st = s.struktur || {};
    zona.set({
      level: adaR ? { atas: s.atas, bawah: s.bawah, tA: s.tAtas ? tl(s.tAtas) : 0, tB: s.tBawah ? tl(s.tBawah) : 0, zona: s.zona || 0, lblA: st.lblA, lblB: st.lblB } : null,
      gel: { piv: CH.piv || [], ujung: s.gel && ok(s.gel.p) ? { t: tl(s.gel.t), p: s.gel.p } : null },
      pos,
    });
  }

  function renderHitung(s) {
    const sisa = Math.max(0, (s.sisaChart != null ? s.sisaChart : s.sisa) | 0), txt = Math.floor(sisa / 60) + ':' + dua(sisa % 60);   // candle chart
    setT($('hitung-v'), s.keadaan === 'TUTUP' ? 'tutup' : txt);
    $('hitung').classList.toggle('dekat', sisa <= 10 && s.keadaan === 'KANDIDAT');
  }

  // ---------------------------------------------------------------- jam pasir: waktu candle (konfirmasi pola) / waktu posisi (batas waktu scalping)
  const JP = { siklus: null };
  const fWaktu = ms => { const d = Math.max(0, Math.round(ms / 1000)), h = Math.floor(d / 3600), m = Math.floor(d % 3600 / 60), x = d % 60; return h ? `${h}:${dua(m)}:${dua(x)}` : `${m}:${dua(x)}`; };
  function renderJamPasir(s) {
    const el = $('jp'); if (!el) return;
    let sisa = 0, waktu = '–', ket = 'candle', kelas = 'jp', tanda = null, siklus = null, jalan = true;
    if (s.keadaan === 'TUTUP' || s.keadaan === 'MEMUAT') { kelas += ' diam'; ket = s.keadaan === 'TUTUP' ? 'pasar tutup' : 'memuat'; jalan = false; }
    else if (s.aktif) {
      const a = s.aktif, total = a.maxb * s.barMs, lewat = Math.max(0, s.t - a.tE);
      sisa = Math.max(0, 1 - lewat / total); waktu = fWaktu(total - lewat); ket = 'sisa posisi'; siklus = 'p' + a.tE;
      if (a.eta) { const f = Math.min(1, a.eta * s.barMs / total); tanda = 57 - 25 * f; }
      kelas += sisa < 0.12 ? ' kritis' : a.eta && lewat > a.eta * s.barMs ? ' telat' : ' posisi';
    } else {
      sisa = Math.max(0, Math.min(1, s.sisa * 1000 / s.barMs)); waktu = fWaktu(s.sisa * 1000); siklus = 'c' + (s.bar ? s.bar.t : 0);
      if (s.keadaan === 'KANDIDAT') { kelas += s.arah < 0 ? ' k-sell' : ' k-buy'; ket = 'konfirmasi'; } else ket = 'candle tutup';
    }
    $('jp-a').setAttribute('y', (32 - 25 * sisa).toFixed(2)); $('jp-a').setAttribute('height', (25 * sisa).toFixed(2));
    $('jp-b').setAttribute('y', (57 - 25 * (1 - sisa)).toFixed(2)); $('jp-b').setAttribute('height', (25 * (1 - sisa)).toFixed(2));
    $('jp-alir').setAttribute('y2', (57 - 25 * (1 - sisa)).toFixed(2));
    $('jp-alir').style.visibility = jalan && sisa > 0.005 ? 'visible' : 'hidden';
    const t = $('jp-tanda');
    if (tanda != null) { t.setAttribute('y1', tanda.toFixed(2)); t.setAttribute('y2', tanda.toFixed(2)); t.setAttribute('visibility', 'visible'); } else t.setAttribute('visibility', 'hidden');
    setC(el, kelas); setT($('jp-w'), waktu); setT($('jp-k'), ket);
    if (JP.siklus && siklus && siklus !== JP.siklus) { const svg = $('jp-svg'); svg.classList.remove('balik'); void svg.getBoundingClientRect(); svg.classList.add('balik'); }
    JP.siklus = siklus;
  }

  // ---------------------------------------------------------------- daftar periksa price action: lokasi gelombang · pola candle · konteks · tutup candle
  function ck(id, keadaan, label, info) {
    const el = $(id); if (!el) return;
    setC(el, 'ck ' + keadaan); setT(el.lastElementChild, label); el.dataset.info = info || '';
  }
  function renderCek(s) {
    const box = $('s-cek');
    const tampil = s.cek && ['KANDIDAT', 'SIAGA', 'TUNGGU', 'TEMBUS'].includes(s.keadaan);
    box.classList.toggle('hidden', !tampil);
    if (!tampil) return;
    const c = s.cek, at = s.aturan || {}, sisi = s.arah;
    const polaKini = s.polaKini && s.polaKini.length ? ' Terlihat sekarang: ' + s.polaKini.join(', ') + '.' : '';
    const tj = c.tren ? c.tren.tj : 0, panah = tj > 0 ? ' ▲' : tj < 0 ? ' ▼' : ' –';
    ck('ck-tren', sisi ? (c.tren && c.tren.ok ? 'ok' : 'no') : (tj ? 'na' : 'no'), 'Tren 1j' + panah,
      `Wajib searah tren 1 jam (EMA50 vs EMA200 harga per jam). Saat ini ${c.tren ? c.tren.teks : 'tren belum dihitung'} → hanya ${tj > 0 ? 'BUY di lembah gelombang' : tj < 0 ? 'SELL di puncak gelombang' : 'tunggu tren jelas'}.`);
    ck('ck-lok', !sisi ? 'na' : c.lokasi.ok ? 'ok' : 'no', 'Lokasi', sisi ? `Lokasi: ${c.lokasi.teks}.` : 'Belum ada sisi yang cocok dengan aturan strategi.');
    ck('ck-pola', !sisi ? 'na' : c.candle.ok ? 'ok' : 'no', at.pola || 'Candle', `Pola yang dipakai strategi: ${c.candle.teks}.${polaKini}`);
    const lblK = at.ctx === 'ema+' || at.ctx === 'ema-' ? 'Tren EMA' : at.ctx === 'with+' ? 'Struktur+EMA' : at.ctx === 'none' ? 'Konteks bebas' : 'Struktur';
    ck('ck-ktx', !c.konteks.perlu ? 'na' : !sisi ? 'no' : c.konteks.ok ? 'ok' : 'no', lblK, `Aturan: ${at.ktx || 'tanpa filter'}. Saat ini: ${c.konteks.teks}.`);
    const kand = s.keadaan === 'KANDIDAT';
    ck('ck-wkt', kand ? 'tunggu' : 'na', kand ? `Tutup ${Math.floor(s.sisa / 60)}:${dua(s.sisa % 60)}` : 'Tutup candle', 'Pola baru sah saat candle tutup — lihat jam pasir.');
  }

  function lv(id, harga, sub) { setT($('s-' + id), ok(harga) ? fh(harga) : '–'); setT($('s-' + id + '2'), sub || ''); }
  const strukturT = st => !st ? '' : st.st > 0 ? `naik (${st.lblA}·${st.lblB})` : st.st < 0 ? `turun (${st.lblA}·${st.lblB})` : `datar (${st.lblA}·${st.lblB})`;
  function renderSinyal(s) {
    const sym = s.sym, badge = $('s-badge'), at = s.aturan || {};
    setT($('s-tf'), s.ikut ? `${s.tf} · sinyal ${s.ikut}` : s.tf);
    setT($('s-pola'), A.strategi && A.strategi.aktif ? A.strategi.pola : '');
    let cls = 's-badge', bt = 'TUNGGU', judul = '', sub = '', plan = null, redup = false, meta = '';
    const arahT = a => a < 0 ? 'SELL' : 'BUY';
    const tempat = a => a < 0 ? 'puncak gelombang' : 'lembah gelombang';
    switch (s.keadaan) {
      case 'MEMUAT': bt = '···'; judul = 'Menyiapkan data & uji maju'; sub = 'Riwayat diunduh lalu 1.512 kombinasi gelombang × pola candle diuji maju (walk-forward) di perangkat ini.'; break;
      case 'TUTUP': bt = 'TUTUP'; judul = 'Pasar emas sedang tutup'; sub = s.bukaLagi ? `Buka lagi ${HARI[new Date(s.bukaLagi + WIB).getUTCDay()]} ${jm(s.bukaLagi)} WIB. Harga beku di penutupan terakhir.` : ''; break;
      case 'NONAKTIF': bt = 'TUNGGU'; judul = 'Hari ini belum ada setup yang lolos seleksi';
        sub = `Tidak ada kombinasi gelombang + pola candle (searah tren 1 jam) yang untung setelah spread di ≥3 dari 4 bagian ${A.strategi && A.strategi.L ? A.strategi.L + ' hari' : 'riwayat'} terakhir. Dipilih ulang tiap hari; batas & kebiasaan tetap jalan.`; break;
      case 'DITAHAN': {
        const st = A.strategi || {}; cls += ' tahan'; bt = 'DITAHAN';
        judul = 'Sinyal ditahan — uji maju belum terbukti untung';
        sub = st.n ? `Hasil uji maju ${st.hariOos} hari: ${st.n} trade, PF ${fx(st.pf, 2)}, ${frp(keRp(st.tot || 0, sym))} (lot ${nf(2).format(P.lot)}). Sinyal baru dibuka bila PF ≥ 1,05 dari ≥ 20 trade.`
          : 'Riwayat masih direkam; uji maju butuh beberapa minggu data sebelum sinyal dibuka.';
        break;
      }
      case 'POSISI': {
        const a = s.aktif; cls += a.side < 0 ? ' sell' : ' buy'; bt = arahT(a.side);
        judul = `Posisi ${arahT(a.side)} berjalan · ${a.pola || ''} · masuk ${jm(a.tE)}`;
        sub = `Ditutup otomatis di TP, SL, atau saat jam pasir habis (${a.maxb} candle ${s.ikut || s.tf}). Sisa ${Math.max(0, a.maxb - a.lewat)} candle.`;
        plan = a; break;
      }
      case 'KANDIDAT': {
        cls += s.arah < 0 ? ' k-sell' : ' k-buy'; bt = arahT(s.arah) + '?';
        judul = at.p === 'bos' ? `Calon ${arahT(s.arah)} — ${at.pola}: tembus ${tempat(-s.arah)}` : `Calon ${arahT(s.arah)} — ${at.pola} di ${tempat(s.arah)}`;
        sub = `Lokasi, pola candle, dan konteks sudah cocok. Sah bila candle tutup tetap seperti ini (${s.sisa} dtk lagi).`;
        plan = s.rencana; break;
      }
      case 'TEMBUS':
        cls += ' tembus'; bt = 'TEMBUS';
        judul = `Harga menembus ${s.arahTembus > 0 ? 'puncak' : 'lembah'} gelombang (${s.arahTembus > 0 ? 'BOS naik' : 'BOS turun'})`;
        sub = `Bukan lokasi entry strategi ${at.pola || ''}. Tunggu gelombang baru terkonfirmasi atau harga kembali ke dalam.`;
        plan = s.siaga; redup = true; break;
      case 'SIAGA': case 'TUNGGU': {
        const sisi = s.arah, dekat = s.keadaan === 'SIAGA';
        if (!sisi) { judul = 'Harga di dalam gelombang'; sub = `Belum ada sisi yang cocok: tren 1 jam ${s.tren > 0 ? 'naik (hanya BUY)' : s.tren < 0 ? 'turun (hanya SELL)' : 'belum jelas'}${at.ktx ? `, aturan ${at.ktx}` : ''} — struktur ${strukturT(s.struktur)}, EMA ${s.struktur && s.struktur.ema > 0 ? 'naik' : 'turun'}.`; break; }
        if (dekat) { cls += ' siaga'; bt = 'SIAGA'; }
        const jarak = at.p === 'bos' ? (sisi > 0 ? s.jarak.atas : s.jarak.bawah) : (sisi < 0 ? s.jarak.atas : s.jarak.bawah);
        const jT = fd(Math.abs(jarak), Math.abs(jarak) >= 100 ? 0 : 2);
        if (at.p === 'bos') {
          judul = dekat ? `Dekat ${tempat(-sisi)} — siap ${arahT(sisi)} (${at.pola})` : `Di dalam gelombang · tunggu ${at.pola} ${arahT(sisi)}`;
          sub = `${arahT(sisi)} bila candle tutup ${sisi > 0 ? 'di atas' : 'di bawah'} ${fh(sisi > 0 ? s.atas : s.bawah)} (jarak ${jT}).`;
        } else {
          judul = dekat ? `Dekat ${tempat(sisi)} — siap ${arahT(sisi)}` : `Di dalam gelombang · tunggu ${arahT(sisi)}`;
          sub = `${arahT(sisi)} bila ${at.pola} ${sisi < 0 ? 'bearish' : 'bullish'} terbentuk di zona ${fh(sisi < 0 ? s.atas - s.zona : s.bawah)}–${fh(sisi < 0 ? s.atas : s.bawah + s.zona)} (jarak ${jT}).`;
        }
        if (s.boleh && !(sisi < 0 ? s.boleh.beli : s.boleh.jual) && at.p !== 'bos') sub += ` ${arahT(-sisi)} di ${tempat(-sisi)} tidak diambil (${s.tren === -sisi ? at.ktx || 'aturan' : 'melawan tren 1 jam'}).`;
        if (s.tolak) sub = `${s.tolak.pola} terlihat, tapi ${s.tolak.alasan} — tidak sesuai aturan. ` + sub;
        plan = s.siaga; redup = true; break;
      }
    }
    setC(badge, cls); setT(badge, bt); setT($('s-judul'), judul); setT($('s-sub'), sub);
    $('s-lv').classList.toggle('redup', redup || !plan);
    if (plan) {
      const tpD = Math.abs(plan.tp - plan.entry), slD = Math.abs(plan.sl - plan.entry);
      lv('entry', plan.entry, s.keadaan === 'POSISI' ? 'masuk ' + jm(plan.tE) : s.keadaan === 'KANDIDAT' ? 'harga kini' : 'perkiraan');
      lv('tp', plan.tp, `${fd(tpD, tpD >= 100 ? 0 : 2)}\n${frp(keRp(tpD - P.spread[sym], sym))}`);
      lv('sl', plan.sl, `${fd(slD, slD >= 100 ? 0 : 2)}\n${frp(-keRp(slD + P.spread[sym], sym))}`);
      const rr = slD ? tpD / slD : 0, eta = plan.eta ? Math.round(plan.eta * TF_MENIT[s.ikut || s.tf]) : 0;
      meta = `<span>R:R <b>1 : ${fx(rr, 1)}</b></span>` + (ok(plan.pTp) ? `<span>Kena TP <b>${fp(plan.pTp)}</b> di uji maju</span>` : '') + (eta ? `<span>± <b>${eta} mnt</b> ke TP</span>` : '');
    } else { lv('entry', NaN, ''); lv('tp', NaN, ''); lv('sl', NaN, ''); }
    const metaEl = $('s-meta'); if (metaEl.innerHTML !== meta) metaEl.innerHTML = meta;
    // progres posisi berjalan
    const prog = $('s-prog'), plEl = $('s-pl');
    if (s.keadaan === 'POSISI' && s.aktif) {
      const a = s.aktif; prog.classList.remove('hidden'); plEl.classList.remove('hidden');
      const x = a.prog >= 0 ? 50 + 50 * Math.min(1, a.prog) : 50 - 50 * Math.min(1, a.progSl);
      $('s-mark').style.left = x.toFixed(1) + '%';
      const h = `<span>P/L kini (setelah spread)</span><b class="${a.pl >= 0 ? 'up' : 'dn'}">${(a.pl >= 0 ? '+' : '−') + '$' + nf(2).format(Math.abs(a.pl))} · ${frp(keRp(a.pl, sym))}</b>`;
      if (plEl.innerHTML !== h) plEl.innerHTML = h;
    } else { prog.classList.add('hidden'); plEl.classList.add('hidden'); }
    renderCek(s); renderJamPasir(s);
  }

  function renderBatas(s) {
    if (!ok(s.atas)) return;
    const d = s.jarak || {}, st = s.struktur || {}, lebar = s.atas - s.bawah;
    setT($('b-w'), `≥ ${fx(s.r, s.r % 1 ? 1 : 0)} ATR · lebar ${fd(lebar, lebar >= 100 ? 0 : 2)}`);
    setT($('b-atas-l'), 'Batas Atas · puncak ' + (st.lblA || '')); setT($('b-bawah-l'), 'Batas Bawah · lembah ' + (st.lblB || ''));
    setT($('b-atas'), fh(s.atas)); setT($('b-bawah'), fh(s.bawah)); setT($('b-harga'), fh(s.harga));
    setT($('b-atas-d'), d.atas >= 0 ? `▲ ${fd(d.atas, d.atas >= 100 ? 0 : 2)} · ${fa(d.atasA)} ATR` : `tembus ${fd(-d.atas, 2)}`);
    setT($('b-bawah-d'), d.bawah >= 0 ? `▼ ${fd(d.bawah, d.bawah >= 100 ? 0 : 2)} · ${fa(d.bawahA)} ATR` : `tembus ${fd(-d.bawah, 2)}`);
    setT($('b-pos'), ok(s.pos) ? `posisi ${fp(Math.max(0, Math.min(1, s.pos)))} dari lembah` : '');
    const pos = ok(s.pos) ? Math.max(-0.06, Math.min(1.06, s.pos)) : 0.5;
    $('b-mark').style.top = ((1 - pos) * 100).toFixed(1) + '%';
    const strEl = $('b-str');
    setT(strEl, st.st > 0 ? `Naik · ${st.lblA}/${st.lblB}` : st.st < 0 ? `Turun · ${st.lblA}/${st.lblB}` : `Datar · ${st.lblA || '–'}/${st.lblB || '–'}`);
    setC(strEl, st.st > 0 ? 'up' : st.st < 0 ? 'dn' : '');
    if (s.peluang) { setT($('b-pel-h'), `Sentuh ${s.peluang.menit} mnt`); setT($('b-pel'), `▲ ${fp(s.peluang.atas)} · ▼ ${fp(s.peluang.bawah)}`); }
    const B = A.batas;
    setT($('b-pantul'), B ? `▲ ${fp(B.pantulAtas)} · ▼ ${fp(B.pantulBawah)}` : '–');
  }

  function renderStrategi() {
    const st = A.strategi, sym = P.sym;
    document.querySelectorAll('#gaya button').forEach(b => b.classList.toggle('on', b.dataset.g === P.gaya));
    const teks = $('st-teks'), bukti = $('st-bukti');
    if (!st) { setT(teks, 'Menguji maju 1.512 setup pada riwayat…'); setC(bukti, 'bukti hidden'); return; }
    const nama = { winrate: 'Winrate', seimbang: 'Seimbang', rr: 'RR besar' }, ikut = A.ikut ? `Sinyal dari ${A.ikut} (setup 1m rugi setelah spread di uji harga Exness). ` : '';
    teks.className = 'st-teks' + (st.aktif ? '' : ' mati');
    setT(teks, ikut + (st.aktif ? 'Hari ini: ' + st.teks + (st.gayaDipakai && st.gayaDipakai !== st.gaya ? ` — gaya ${nama[st.gaya]} tidak menemukan setup lolos, dipakai ${nama[st.gayaDipakai]}` : '')
      : `Hari ini tidak ada kombinasi yang lolos seleksi ${st.L || 120} hari terakhir — sinyal libur, batas & kebiasaan tetap jalan.`));
    // status bukti: angka di bawah ini dari UJI MAJU (pilihan tiap hari hanya memakai data sebelum hari itu)
    setC(bukti, 'bukti ' + (st.terbukti ? 'ok' : 'tahan'));
    setT(bukti.querySelector('b'), st.terbukti ? 'Terbukti' : 'Ditahan');
    setT(bukti.querySelector('span'), st.n ? `uji maju ${fx(st.hariOos, 0)} hari · ${st.n} trade · ${st.minggu ? st.minggu[0] + '/' + st.minggu[1] : '–'} minggu untung` : 'uji maju menunggu riwayat lebih panjang');
    if (!st.n) {
      ['st-wr', 'st-pf', 'st-e', 'st-ph'].forEach(id => setT($(id), '–')); $('st-kurva').innerHTML = ''; setT($('st-proj'), '');
      setT($('st-uji'), `${fx(st.hari, 0)} hari riwayat · spread ${fd(st.spread, st.spread >= 1 ? 1 : 2)}`); return;
    }
    setT($('st-wr'), fp(st.wr)); setT($('st-pf'), fx(st.pf, 2));
    setT($('st-e'), frpRingkas(keRp(st.e, sym))); setT($('st-ph'), fx(st.perHari, 1));
    $('st-e').className = st.e >= 0 ? 'up' : 'dn'; $('st-pf').className = st.pf >= 1 ? '' : 'dn';
    const proj = keRp(st.e * st.perHari, sym);
    $('st-proj').innerHTML = `Rata-rata uji maju <b class="${proj >= 0 ? 'up' : 'dn'}">${frp(proj)}/hari</b> · lot ${nf(2).format(P.lot)} · kena TP ${fp(st.tpRate)}`;
    setT($('st-uji'), `Dipilih ulang tiap hari dari ${st.L} hari sebelumnya · ${st.ganti || 1} kombinasi terpakai`);
    gambarKurva(A.kurva, sym);
  }
  function gambarKurva(k, sym) {
    const el = $('st-kurva');
    if (!k || k.length < 3) { el.innerHTML = ''; return; }
    const mn = Math.min(0, ...k), mx = Math.max(0, ...k), w = 300, h = 40, sx = w / (k.length - 1), sy = (mx - mn) || 1;
    const pts = k.map((v, i) => `${(i * sx).toFixed(1)},${(h - (v - mn) / sy * h).toFixed(1)}`).join(' ');
    const y0 = (h - (0 - mn) / sy * h).toFixed(1), akhir = k[k.length - 1], warna = akhir >= 0 ? C.up : C.dn;
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="kg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${warna}" stop-opacity=".28"/><stop offset="1" stop-color="${warna}" stop-opacity="0"/></linearGradient></defs>` +
      `<line x1="0" x2="${w}" y1="${y0}" y2="${y0}" stroke="#2a3344" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>` +
      `<polygon points="0,${y0} ${pts} ${w},${y0}" fill="url(#kg)"/><polyline points="${pts}" fill="none" stroke="${warna}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
    el.dataset.akhir = frp(keRp(akhir, sym));
  }

  function renderRiwayat() {
    document.querySelectorAll('#rw-src button').forEach(b => b.classList.toggle('on', b.dataset.r === P.rw));
    const sym = P.sym, live = P.rw === 'live';
    const list = (live ? A.jurnal : A.uji) || [];
    const sum = $('rw-sum');
    if (live) {
      const h = A.hariIni;
      sum.innerHTML = h && h.n ? `Hari ini <b>${h.n}</b> sinyal · <b>${h.tp}</b> untung · <b class="${h.pnl >= 0 ? 'up' : 'dn'}">${frp(keRp(h.pnl, sym))}</b>` : 'Tercatat otomatis selama halaman terbuka.';
    } else {
      const w = list.filter(x => x.pnl > 0).length;
      sum.innerHTML = list.length ? `${list.length} trade terakhir uji maju · <b>${fp(w / list.length)}</b> untung · <b class="${list.reduce((s, x) => s + x.pnl, 0) >= 0 ? 'up' : 'dn'}">${frp(keRp(list.reduce((s, x) => s + x.pnl, 0), sym))}</b> · <span class="muted">ketuk baris untuk putar ulang</span>` : '';
    }
    const el = $('rw-list');
    if (!list.length) {
      el.innerHTML = `<div class="rw-kosong">${live ? 'Belum ada sinyal live di ' + NAMA[sym] + ' ' + (IKUT[P.tf] || P.tf) + '.<br>Sinyal & hasilnya direkam di sini begitu muncul.' : 'Belum ada trade uji maju.'}</div>`;
      return;
    }
    const rows = list.slice(-80).reverse().map(x => {
      const rp = keRp(x.pnl, sym), tgl = Math.floor((x.t0 + WIB) / 864e5) !== Math.floor((Date.now() + WIB) / 864e5);
      const wk = tgl ? new Date(x.t0 + WIB).toISOString().slice(8, 10) + '/' + new Date(x.t0 + WIB).toISOString().slice(5, 7) : jm(x.t0);
      const ada = (CH.tr && CH.tr.has(x.t0)) || (IKUT[P.tf] && Date.now() - x.t0 < 5 * 864e5);
      return `<div class="rw${ada ? ' bisa' : ''}" data-t0="${x.t0}" title="${x.side < 0 ? 'SELL' : 'BUY'} ${fh(x.entry)} · TP ${fh(x.tp)} · SL ${fh(x.sl)} · keluar ${jm(x.t1)}${ada ? ' · ketuk untuk putar ulang di chart' : ''}"><span class="w">${wk}</span><span class="d ${x.side < 0 ? 's' : 'b'}">${x.side < 0 ? 'SELL' : 'BUY'}</span>` +
        `<span class="p">${fh(x.entry)} → ${fh(x.keluar)}</span><span class="h ${x.hasil === 'TP' ? 'tp' : x.hasil === 'SL' ? 'sl' : ''}">${x.hasil}</span><span class="r ${rp >= 0 ? 'up' : 'dn'}">${frp(rp)}</span></div>`;
    }).join('');
    if (el.innerHTML !== rows) el.innerHTML = rows;
  }

  /** putar ulang trade riwayat di chart: geser ke trade itu, kotak tumbuh dari entry, harga berjalan candle demi candle, lalu efek TP/SL */
  const PUTAR = { nanti: 0 };
  function putarUlang(t0) {
    const x = CH.tr && CH.tr.get(t0);
    if (!x || !chart) {
      // chart 1m hanya ±25 jam: trade 5m yang lebih lama diputar di chart 5m (±5 hari)
      if (IKUT[P.tf] && Date.now() - t0 < 5 * 864e5) { toast('Trade ini di luar chart 1m (±25 jam). <button>Putar di 5m</button>', () => { PUTAR.nanti = t0; pilih(P.sym, IKUT[P.tf]); }); return; }
      toast('Trade ini di luar jendela chart — hanya trade yang terlihat di chart bisa diputar ulang.'); return;
    }
    const l1 = lgs(x.t0 + (x.ms || CH.sMs)), l2 = lgs(x.t1); if (l1 == null || l2 == null) return;
    const lebar = Math.max(8, l2 - l1), kiri = Math.max(30, lebar * 1.3), kanan = Math.max(22, lebar * 0.9);
    chart.timeScale().setVisibleLogicalRange({ from: l1 - kiri, to: l2 + kanan });
    zona.sorot = x;
    mulaiAnim({ jenis: 'putar', kunci: 'putar', d: 5800, x, tE: x.t0 + (x.ms || CH.sMs), entry: x.entry });
    setTimeout(() => bunyi(x.pnl > 0 ? [1320, 1760] : [440, 330]), 3150);
    if (innerWidth <= 860) $('chart').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  $('rw-list').addEventListener('click', e => { const r = e.target.closest('.rw'); if (r && r.dataset.t0) putarUlang(+r.dataset.t0); });

  const SESI = [{ nama: 'Asia', a: 6, b: 14 }, { nama: 'Eropa', a: 14, b: 19 }, { nama: 'Amerika', a: 19, b: 24 }, { nama: 'Dini hari', a: 0, b: 6 }];
  function renderKeb() {
    const K = A.kebiasaan, bars = $('keb-bars'), sym = P.sym;
    if (!K) { bars.innerHTML = ''; setT($('keb-now'), 'menunggu riwayat 5m…'); return; }
    const jamKini = new Date(Date.now() + WIB).getUTCHours();
    const mx = Math.max(...K.jam.map(j => j.vol), 0.01);
    if (bars.children.length !== 24) bars.innerHTML = '<i></i>'.repeat(24);
    K.jam.forEach((j, h) => {
      const el = bars.children[h];
      el.style.height = (6 + 94 * j.vol / mx).toFixed(1) + '%';
      el.className = (j.naik >= 0.535 ? 'naik' : j.naik <= 0.465 ? 'turun' : '') + (h === jamKini ? ' kini' : '');
      el.dataset.h = h;
    });
    const hariData = Math.round((K.sampai - K.dari) / 864e5);
    setT($('keb-sub'), `rata-rata gerak per jam WIB · ${hariData} hari terakhir`);
    const j = K.jam[jamKini];
    const S = A.sesi, ks = SESI.findIndex(x => jamKini >= x.a && jamKini < x.b);
    const kini = new Date(Date.now() + WIB), sisaM = (SESI[ks].b * 60) - (kini.getUTCHours() * 60 + kini.getUTCMinutes());
    setT($('keb-now'), `Jam ${dua(jamKini)}.00: gerak ±${fd(j.gerak, j.gerak >= 100 ? 0 : 2)} · rentang ${fd(j.rng, j.rng >= 100 ? 0 : 2)} · naik ${fp(j.naik)} · aktivitas ${fx(j.vol, 1)}× · sesi ${SESI[ks].nama} sisa ${Math.floor(sisaM / 60) ? Math.floor(sisaM / 60) + ' j ' : ''}${sisaM % 60} m`);
    $('keb-sesi').innerHTML = '<div class="sh">Strategi per sesi (uji)</div>' + SESI.map((x, i) => {
      const st = S && S[i];
      const isi = st && st.n ? `<b class="${st.e >= 0 ? 'up' : 'dn'}">${frp(keRp(st.e, sym))}</b><span class="w">WR ${fp(st.wr)} · ${st.n}×</span>` : '<b>–</b><span class="w"></span>';
      return `<div class="s${i === ks ? ' kini' : ''}" data-tip="sesi" data-i="${i}"><span class="n" data-tip="sesi" data-i="${i}">${x.nama} ${dua(x.a)}–${dua(x.b % 24)}</span>${isi}</div>`;
    }).join('');
  }
  setInterval(() => { if (A.kebiasaan) renderKeb(); }, 60000);

  // ---------------------------------------------------------------- sinyal: bunyi + toast
  let AC = null;
  function bunyi(nada) {
    if (!P.bunyi) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      const t = AC.currentTime;
      nada.forEach((f, i) => {
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.16); g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.3);
        o.connect(g).connect(AC.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.32);
      });
    } catch (e) { /* tanpa suara */ }
  }
  let toastT = null;
  function toast(html, aksi) {
    const el = $('toast'); el.innerHTML = html; el.classList.remove('hidden');
    const b = el.querySelector('button'); if (b && aksi) b.onclick = () => { aksi(); el.classList.add('hidden'); };
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 9000);
  }
  function onSinyal(m) {
    const arah = m.side < 0 ? 'SELL' : 'BUY', nm = `${NAMA[m.sym]} ${m.tf}`;
    const tampak = m.sym === P.sym && (m.tf === P.tf || IKUT[P.tf] === m.tf);   // sinyal 5m juga tampil di chart 1m
    if (m.jenis === 'buka') {
      bunyi([880, 1320]);
      toast(`<b class="${m.side < 0 ? 'dn' : 'up'}">${arah}</b> ${nm} dibuka @ ${fh(m.entry)}` + (tampak ? '' : ' <button>Lihat</button>'), () => pilih(m.sym, m.tf));
      if (tampak && ok(m.tE)) mulaiAnim({ jenis: 'buka', kunci: 'b' + m.tE, d: 3000, side: m.side, entry: m.entry, tp: m.tp, sl: m.sl, tE: m.tE, dur: (m.maxb || 24) * (m.ms || CH.sMs) });
    } else {
      bunyi(m.pnl > 0 ? [1320, 1760] : [440, 330]);
      toast(`${arah} ${nm} selesai: <b class="${m.pnl > 0 ? 'up' : 'dn'}">${m.hasil} ${frp(keRp(m.pnl, m.sym))}</b>` + (tampak ? '' : ' <button>Lihat</button>'), () => pilih(m.sym, m.tf));
      if (tampak && ok(m.tE)) mulaiAnim({ jenis: 'tutup', kunci: 't' + m.tE, d: 3400, hasil: m.hasil, side: m.side, entry: m.entry, tp: m.tp, sl: m.sl, keluar: m.keluar, tE: m.tE, t1: m.t1 || Date.now(), pnl: m.pnl });
    }
  }

  // ---------------------------------------------------------------- interaksi
  function pilih(sym, tf) {
    if (sym === P.sym && tf === P.tf) return;
    P.sym = sym; P.tf = tf; LS.set('sym', sym); LS.set('tf', tf);
    tandaiPilihan();
    Object.assign(A, { strategi: null, jurnal: [], uji: [], hariIni: null, kebiasaan: A.kebiasaan && sym === CH.sym ? A.kebiasaan : null, sesi: null, batas: null, kurva: null, ikut: null });
    ANIM.list = []; ANIM.denyut = false;
    CH.uji = []; CH.jurnal = []; CH.piv = []; CH.s = null; CH.pos = null; JP.siklus = null;
    zona.sorot = null; zona.set(null); ['atas', 'bawah', 'entry', 'tp', 'sl'].forEach(k => aturGaris(k, 0, false));
    renderStrategi(); renderRiwayat();
    W.postMessage({ op: 'lihat', sym, tf });
  }
  function tandaiPilihan() {
    document.querySelectorAll('.pair').forEach(b => b.classList.toggle('on', b.dataset.sym === P.sym));
    document.querySelectorAll('#tf button').forEach(b => b.classList.toggle('on', b.dataset.tf === P.tf));
  }
  $('pairs').addEventListener('click', e => { const b = e.target.closest('.pair'); if (b) pilih(b.dataset.sym, P.tf); });
  $('tf').addEventListener('click', e => { const b = e.target.closest('button'); if (b) pilih(P.sym, b.dataset.tf); });
  $('gaya').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.dataset.g === P.gaya) return;
    P.gaya = b.dataset.g; LS.set('gaya', P.gaya);
    W.postMessage({ op: 'setel', set: { gaya: P.gaya } });
    A.strategi = null; renderStrategi(); setT($('st-teks'), 'Memilih ulang setup untuk gaya ' + b.textContent + '…');
  });
  $('rw-src').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { P.rw = b.dataset.r; LS.set('rw', P.rw); renderRiwayat(); } });
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $('main').dataset.tab = b.dataset.tab;
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  });
  document.querySelector('#tabs button').classList.add('on');
  const ulang = $('st-ulang');
  ulang.addEventListener('click', () => { ulang.disabled = true; ulang.classList.add('jalan'); W.postMessage({ op: 'analisis-ulang', sym: P.sym, tf: P.tf }); setTimeout(ulangSelesai, 30000); });
  function ulangSelesai() { ulang.disabled = false; ulang.classList.remove('jalan'); }
  function aturBunyi() { const b = $('btn-bunyi'); b.classList.toggle('off', !P.bunyi); b.querySelector('use').setAttribute('href', P.bunyi ? '#i-bunyi' : '#i-bisu'); b.setAttribute('aria-pressed', String(P.bunyi)); }
  $('btn-bunyi').addEventListener('click', () => { P.bunyi = !P.bunyi; LS.set('bunyi', P.bunyi); aturBunyi(); if (P.bunyi) bunyi([880]); });

  // setelan
  const pop = $('setelan');
  // ---------------------------------------------------------------- samakan harga dengan Exness
  const HDR = {};
  function angka(x) {   // "67,306.76" · "67.306,76" · "3883.075" → angka
    let t = String(x || '').trim().replace(/[\s$]/g, '');
    if (!t) return NaN;
    const ti = (t.match(/\./g) || []).length, ko = (t.match(/,/g) || []).length;
    if (ti && ko) { const des = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ','; t = t.split(des === '.' ? ',' : '.').join(''); if (des === ',') t = t.replace(',', '.'); }
    else if (ko > 1) t = t.replace(/,/g, ''); else if (ti > 1) t = t.replace(/\./g, ''); else if (ko === 1) t = t.replace(',', '.');
    return parseFloat(t);
  }
  function teksKal(sym) {
    const k = P.kal[sym];
    if (!k || !k.t) return 'Belum disamakan — harga masih perkiraan dari Binance.';
    const sel = sym === 'BTCUSDT' ? `selisih ${k.d >= 0 ? '+' : '−'}$${nf(2).format(Math.abs(k.d))}` : `rasio ${nf(5).format(k.k)}`;
    const umur = Date.now() - k.t, lama = umur > 12 * 3600e3;
    const kapan = umur < 864e5 ? jm(k.t) + ' WIB' : new Date(k.t + WIB).toISOString().slice(8, 10) + '/' + new Date(k.t + WIB).toISOString().slice(5, 7);
    return `${lama ? '⚠ ' : '✓ '}Disamakan ${kapan} (Bid ${nf(sym === 'XAUUSDm' ? 3 : 2).format(k.bid)}, ${sel})${lama ? ' — sudah lama, samakan lagi' : ''}`;
  }
  const ALASAN_EXN = {
    BELUM_DIKONFIGURASI: 'Feed resmi Exness belum dipasang (API key belum disimpan di server).',
    BELUM_LOGIN_PORTAL: 'Masuk Portal AMATU dulu untuk memakai feed resmi Exness.',
    AUTH_INVALID_API_KEY: 'API key Exness ditolak — periksa kunci yang disimpan.',
    AUTH_INVALID_SIGNATURE: 'Kunci privat Exness tidak cocok dengan API key.',
    AUTH_PERMISSION_DENIED: 'API key Exness tidak diizinkan (izin data harga, akun, atau IP).',
    ACCOUNT_NOT_FOUND: 'Nomor akun Exness tidak dikenali untuk API key ini.',
  };
  const alasanExn = g => !g ? '' : ALASAN_EXN[g] || (/HTTP 401/.test(g) ? 'Login portal kedaluwarsa — muat ulang halaman.' : 'Feed resmi Exness belum tersambung (' + g + ').');
  function renderSumber() {
    const x = FEED.sumber === 'exness', el = $('sumber');
    setT(el, x ? 'EXNESS' : 'BINANCE ≈'); setC(el, 'src' + (x ? ' exn' : ''));
  }
  function renderKal() {
    const x = FEED.sumber === 'exness', box = $('kal-exn');
    box.classList.toggle('hidden', !x); $('kal-rows').classList.toggle('hidden', x); $('kal-cat').classList.toggle('hidden', x);
    if (x) {
      const sp = (FEED.exn && FEED.exn.spread) || {};
      box.innerHTML = `✓ <b>Feed resmi Exness aktif</b> — candle & tick langsung dari server Exness (Bid), jadi harga, batas, entry/TP/SL sama dengan terminal Exness.` +
        `<br><span class="muted">Spread langsung: BTCUSDm ${sp.BTCUSDT ? '$' + nf(2).format(sp.BTCUSDT) : '–'} · XAUUSDm ${sp.XAUUSDm ? '$' + nf(3).format(sp.XAUUSDm) : '–'}</span>`;
      return;
    }
    const g = FEED.exn && FEED.exn.galat;
    $('kal-cat').innerHTML = (g ? `<span class="am">${alasanExn(g)}</span> Sementara itu: ` : '') + 'buka terminal Exness, lihat harga <b>Bid</b> (tombol Sell / judul tab "BTC Bid …"), ketik di sini lalu tekan Samakan. Chart, batas gelombang, entry/TP/SL lalu mengikuti harga Exness.';
    document.querySelectorAll('.kal-row').forEach(r => {
      const sym = r.dataset.sym, st = r.querySelector('.kal-s');
      st.innerHTML = teksKal(sym) + (P.kal[sym] ? ' · <button class="link reset">Reset</button>' : '');
      st.className = 'kal-s' + (P.kal[sym] && Date.now() - P.kal[sym].t < 12 * 3600e3 ? ' ok' : P.kal[sym] ? ' lama' : '');
    });
  }
  document.querySelectorAll('.kal-row').forEach(r => {
    const sym = r.dataset.sym, inp = r.querySelector('input');
    const kirimKal = () => {
      const v = angka(inp.value);
      if (!(v > 0)) { r.querySelector('.kal-s').textContent = 'Ketik harga Bid dari Exness dulu.'; return; }
      W.postMessage({ op: 'kalibrasi', sym, bid: v });
    };
    r.querySelector('.btn').addEventListener('click', kirimKal);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); kirimKal(); } });
    r.addEventListener('click', e => { if (e.target.closest('.reset')) W.postMessage({ op: 'kalibrasi', sym, reset: true }); });
  });
  function kalibrasiOk(m) {
    const r = document.querySelector(`.kal-row[data-sym="${m.sym}"]`);
    if (m.galat) { if (r) r.querySelector('.kal-s').textContent = m.galat; return; }
    P.kal[m.sym] = m.kal; LS.set('kal', P.kal);
    if (r) r.querySelector('input').value = '';
    renderKal(); infoKal();
    toast(m.kal ? `<b>${NAMA[m.sym]}</b> disamakan dengan harga Exness` : `Kalibrasi ${NAMA[m.sym]} direset ke perkiraan Binance`);
  }
  let infoKalTutup = false;
  function infoKal() {
    const el = $('info-kal'), k = P.kal[P.sym], tutup = CH.s && CH.s.keadaan === 'TUTUP';
    const perlu = FEED.sumber !== 'exness' && !infoKalTutup && !tutup && (!k || Date.now() - k.t > 12 * 3600e3);
    el.classList.toggle('hidden', !perlu);
    if (perlu) setT($('info-kal-t'), k ? `Kalibrasi harga ${NAMA[P.sym]} sudah lama — samakan lagi dengan Exness?` : `Harga ${NAMA[P.sym]} masih perkiraan dari Binance. Samakan dengan Exness?`);
  }
  $('info-kal-b').addEventListener('click', () => { bukaSetelan(); const r = document.querySelector(`.kal-row[data-sym="${P.sym}"] input`); if (r) setTimeout(() => r.focus(), 60); });
  $('info-kal-x').addEventListener('click', () => { infoKalTutup = true; infoKal(); });
  // kalibrasi dari perangkat lain (disinkronkan oleh portal)
  window.addEventListener('storage', e => {
    if (e.key !== 'scalping.kal') return;
    P.kal = Object.assign({ BTCUSDT: null, XAUUSDm: null }, LS.get('kal', {}));
    W.postMessage({ op: 'setel', set: { kal: P.kal } }); W.postMessage({ op: 'lihat', sym: P.sym, tf: P.tf }); renderKal();
  });

  function bukaSetelan() {
    $('set-lot').value = P.lot; $('set-sp-btc').value = P.spread.BTCUSDT; $('set-sp-xau').value = P.spread.XAUUSDm; $('set-bunyi').checked = P.bunyi;
    $('set-info').textContent = FEED.sumber === 'exness'
      ? `Sumber: feed resmi Exness (Exness Trader API lewat server AMATU, hanya membaca harga). Riwayat candle & tick Bid langsung dari Exness, disimpan di browser ini. Kurs USD/IDR ${nf(0).format(KURS)}.`
      : `Sumber: Binance (BTC = BTCUSDT ÷ USDCUSDT agar dalam USD seperti Exness; XAU = PAXGUSDT × rasio emas). Semua harga ditampilkan sebagai Bid seperti di Exness. Tanpa kalibrasi, selisih ke Exness bisa beberapa dolar. Kurs USD/IDR ${nf(0).format(KURS)}.`;
    renderKal();
    pop.classList.remove('hidden');
  }
  $('btn-setelan').addEventListener('click', bukaSetelan);
  $('set-tutup').addEventListener('click', () => pop.classList.add('hidden'));
  pop.addEventListener('click', e => { if (e.target === pop) pop.classList.add('hidden'); });
  $('set-simpan').addEventListener('click', () => {
    const lot = +$('set-lot').value, sb = +$('set-sp-btc').value, sx = +$('set-sp-xau').value;
    if (lot > 0) P.lot = Math.round(lot * 100) / 100;
    if (sb >= 0) P.spread.BTCUSDT = sb; if (sx >= 0) P.spread.XAUUSDm = sx;
    P.bunyi = $('set-bunyi').checked; aturBunyi();
    LS.set('lot', P.lot); LS.set('spread', P.spread); LS.set('bunyi', P.bunyi);
    W.postMessage({ op: 'setel', set: { lot: P.lot, spread: P.spread } });
    pop.classList.add('hidden'); renderStrategi(); renderRiwayat(); renderKeb();
  });
  $('set-hapus').addEventListener('click', () => {
    if (confirm('Hapus semua rekaman candle, jurnal sinyal, dan hasil uji di perangkat ini? Riwayat akan diunduh ulang dari Binance.')) W.postMessage({ op: 'hapus' });
  });
  document.addEventListener('keydown', e => {
    if (e.target.closest('input') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') pop.classList.add('hidden');
    const k = e.key.toLowerCase();
    if (k === '1') pilih(P.sym, '1m'); else if (k === '5') pilih(P.sym, '5m');
    else if (k === 'b') pilih('BTCUSDT', P.tf); else if (k === 'g' || k === 'x') pilih('XAUUSDm', P.tf);
  });

  // keterangan (hover / ketuk)
  const TIP = {
    live: () => { const i = $('live').dataset.info, x = FEED.sumber === 'exness', src = x ? 'feed resmi Exness (relay)' : 'WebSocket Binance';
      return (i === 'ws' ? `<b>Live</b> — harga langsung dari ${src}, diperbarui tiap detik.` : i === 'poll' ? '<b>Cadangan</b> — WebSocket terputus, harga diambil lewat REST.' : '<b>Terputus</b> — mencoba menyambung lagi.') +
        (x ? '' : '<br>' + (alasanExn(FEED.exn && FEED.exn.galat) || 'Sumber: Binance (perkiraan harga Exness).')); },
    harga: el => {
      const sym = el.dataset.sym, h = HDR[sym];
      if (FEED.sumber === 'exness') return `<b>${NAMA[sym]} Bid ${h && ok(h.p) ? fh(h.p) : ''}</b><br>Feed resmi Exness (Trader API): Bid langsung dari server Exness, sama dengan terminal Anda.`;
      return `<b>${NAMA[sym]} Bid ${h && ok(h.p) ? fh(h.p) : ''}</b><br>${sym === 'BTCUSDT' ? 'Binance BTCUSDT ÷ USDCUSDT (USD)' : 'PAXGUSDT × rasio emas'}, ditampilkan sebagai Bid (tengah − spread/2).<br>${teksKal(sym)}${FEED.exn && FEED.exn.galat ? '<br>' + alasanExn(FEED.exn.galat) : ''}`;
    },
    hitung: () => 'Sisa waktu candle chart ini.' + (IKUT[P.tf] ? ` Sinyal dari candle ${IKUT[P.tf]} — lihat jam pasir di kartu Sinyal untuk waktu konfirmasinya.` : ' Pola candle baru sah saat candle tutup.'),
    gelombang: () => 'Batas Atas/Bawah = puncak & lembah gelombang terakhir. Satu gelombang terkonfirmasi bila harga berbalik minimal sekian ATR dari titik ekstremnya; ukuran ini dipilih dari uji riwayat.',
    struktur: () => 'Struktur gelombang: HH & HL (puncak dan lembah makin tinggi) = naik; LH & LL = turun; campuran = datar.',
    peluang: () => 'Peluang harga menyentuh zona puncak (▲) / lembah (▼) gelombang dalam jendela waktu ini, dari sebaran gerak di riwayat. Dihitung ulang tiap detik.',
    pantul: () => 'Dari 30 hari terakhir: saat ekor candle menyentuh puncak/lembah gelombang terakhir, berapa persen candle tutup kembali di dalam (sisanya menembus).',
    pola: () => A.strategi && A.strategi.aktif ? `Pola candle yang dipakai strategi hari ini: <b>${A.strategi.pola}</b>. ${A.strategi.teks}.` : 'Hari ini belum ada pola yang lolos seleksi.',
    bukti: () => A.strategi ? `<b>Uji maju (walk-forward)</b>: tiap hari strategi dipilih hanya dari ${A.strategi.L || 120} hari SEBELUM hari itu, lalu hasil hari itu dicatat. Ini menirukan pemakaian nyata, jadi angkanya jujur (bukan hasil kombinasi terbaik di data yang sama). Sinyal live dibuka hanya bila uji maju PF ≥ 1,05 dari ≥ 20 trade.` : '',
    cek: el => el.dataset.info || '',
    jp: () => { const s = CH.s; if (s && s.aktif) return `<b>Jam pasir posisi</b> — scalping dibatasi ${s.aktif.maxb} candle (${s.aktif.maxb * TF_MENIT[s.ikut || s.tf]} mnt). Garis putus = rata-rata waktu kena TP di riwayat (±${Math.round((s.aktif.eta || 0) * TF_MENIT[s.ikut || s.tf])} mnt). Lewat garis itu peluang TP menurun; saat pasir habis posisi ditutup.`;
      return '<b>Jam pasir candle</b> — sisa waktu candle berjalan. Entry hanya setelah candle tutup dan polanya tetap sah; saat pasir habis jam pasir dibalik untuk candle berikut.'; },
    wr: () => 'Persentase trade uji maju yang untung setelah spread.',
    pf: () => 'Total untung ÷ total rugi di uji maju. Di atas 1 = untung bersih; 1,2+ cukup baik untuk scalping.',
    e: () => `Rata-rata hasil per trade uji maju setelah spread, untuk lot ${nf(2).format(P.lot)} dan kurs ${nf(0).format(KURS)}.`,
    ph: () => 'Rata-rata jumlah sinyal per hari di uji maju (hari tanpa setup lolos ikut dihitung).',
    kurva: () => `Hasil kumulatif semua trade uji maju (setelah spread): <b>${$('st-kurva').dataset.akhir || '–'}</b>. Naik stabil = konsisten; turun tajam = periode rugi.`,
    sesi: el => { const st = A.sesi && A.sesi[+el.dataset.i]; return st && st.n ? `Strategi aktif pada sesi ini di uji riwayat: ${st.n} trade, untung ${fp(st.wr)}, rata-rata ${frp(keRp(st.e, P.sym))}/trade.` : 'Belum ada trade uji di sesi ini.'; },
    jam: el => { const j = A.kebiasaan && A.kebiasaan.jam[+el.dataset.h]; return j ? `<b>${dua(j.h)}.00–${dua((j.h + 1) % 24)}.00 WIB</b><br>Gerak bersih rata-rata ±${fd(j.gerak, j.gerak >= 100 ? 0 : 2)}, rentang ${fd(j.rng, j.rng >= 100 ? 0 : 2)}<br>Ditutup naik ${fp(j.naik)} · aktivitas ${fx(j.vol, 2)}× rata-rata · ${j.n} jam data` : ''; },
  };
  const tipEl = $('tip');
  function tampilTip(el, x, y) {
    const k = el.dataset.tip || (el.parentElement && el.parentElement.id === 'keb-bars' ? 'jam' : null);
    const f = k && TIP[k]; if (!f) return;
    const h = f(el); if (!h) return;
    tipEl.innerHTML = h; tipEl.classList.remove('hidden');
    const r = tipEl.getBoundingClientRect();
    tipEl.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x + 12)) + 'px';
    tipEl.style.top = Math.max(8, y + 16 + r.height > innerHeight ? y - r.height - 10 : y + 16) + 'px';
  }
  document.addEventListener('mouseover', e => { const el = e.target.closest('[data-tip], #keb-bars i'); if (el) tampilTip(el, e.clientX, e.clientY); else tipEl.classList.add('hidden'); });
  document.addEventListener('mousemove', e => { if (!tipEl.classList.contains('hidden')) { const el = e.target.closest('[data-tip], #keb-bars i'); if (el) tampilTip(el, e.clientX, e.clientY); } });
  document.addEventListener('touchstart', e => { const el = e.target.closest('[data-tip], #keb-bars i'); if (el) { const t = e.touches[0]; tampilTip(el, t.clientX, t.clientY); setTimeout(() => tipEl.classList.add('hidden'), 3500); } }, { passive: true });

  // versi baru (halaman tidak dimuat ulang otomatis)
  if (VERSI && !VERSI.includes('%')) setInterval(async () => {
    try { const v = (await (await fetch('versi.txt?t=' + Date.now(), { cache: 'no-store' })).text()).trim(); if (v && v.length < 40 && v !== VERSI) $('baru').classList.remove('hidden'); } catch (e) { /* */ }
  }, 5 * 60000);
  $('btn-baru').addEventListener('click', () => location.reload());
  // mesin diam > 6 dtk (tab dibekukan) → tandai
  setInterval(() => { if (detikT && Date.now() - detikT > 6000) setC($('live'), 'live off'); }, 2000);

  buatChart();
  tandaiPilihan(); aturBunyi(); renderStrategi(); renderRiwayat(); renderKeb();
  window.SCALP = { P, A, CH, W, chart: () => chart, zona, anim: ANIM, putar: putarUlang, sinyal: onSinyal };
})();
