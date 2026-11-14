'use strict';
/* Amatu Scalping · tampilan. Semua hitungan ada di mesin.js (Web Worker); halaman ini hanya menggambar. */
(() => {
  const VERSI = document.documentElement.dataset.web || '';
  const $ = id => document.getElementById(id);
  const SYMS = ['BTCUSDT', 'XAUUSDm'];
  const KONTRAK = { BTCUSDT: 1, XAUUSDm: 100 };
  const TF_MENIT = { '1m': 1, '5m': 5 };
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
  W.postMessage({ op: 'mulai', set: { lot: P.lot, spread: P.spread, gaya: P.gaya, kal: P.kal }, lihat: { sym: P.sym, tf: P.tf } });

  // ---------------------------------------------------------------- chart
  const LW = window.LightweightCharts;
  let chart = null, cs = null, vs = null, su = null, sb = null;
  const garis = {};
  const CH = { sym: '', tf: '', bars: [], vols: [], uu: [], ll: [], lastT: 0, uji: [], jurnal: [], piv: [], tr: new Map(), s: null };

  /** Primitive: gelombang (zigzag puncak/lembah + label HH/HL/LH/LL), garis & zona batas gelombang, zona TP/SL posisi. */
  class Zona {
    constructor() {
      this.d = null; this.g = null; this.ch = null; this.se = null; this.req = null; const z = this;
      this.views = [{ zOrder: () => 'bottom', renderer: () => ({ draw: t => z.gambarBawah(t) }) }, { zOrder: () => 'top', renderer: () => ({ draw: t => z.gambarAtas(t) }) }];
    }
    attached(p) { this.ch = p.chart; this.se = p.series; this.req = p.requestUpdate; }
    detached() { this.ch = this.se = this.req = null; }
    paneViews() { return this.views; }
    updateAllViews() { this.hitung(); }
    set(d) { this.d = d; if (this.req) this.req(); }
    hitung() {
      const d = this.d; this.g = null;
      if (!d || !this.ch || !this.se) return;
      const ts = this.ch.timeScale(), se = this.se, g = {};
      const xy = (t, p) => { const x = ts.timeToCoordinate(t), y = se.priceToCoordinate(p); return x == null || y == null ? null : [x, y]; };
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
      if (d.trade) { const x = d.trade; g.tx = ts.timeToCoordinate(x.t); g.yE = se.priceToCoordinate(x.entry); g.yT = se.priceToCoordinate(x.tp); g.yS = se.priceToCoordinate(x.sl); g.calon = x.calon; }
      this.g = g;
    }
    gambarBawah(target) {
      const g = this.g; if (!g) return;
      target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
        const Wd = bitmapSize.width;
        for (const v of g.lv || []) {          // zona sentuh pola + garis batas gelombang
          if (v.y == null) continue;
          const x1 = v.x == null ? 0 : Math.max(0, Math.round(v.x * hr)), y = Math.round(v.y * vr), yz = v.yz == null ? y : Math.round(v.yz * vr);
          ctx.fillStyle = `rgba(${v.warna},0.10)`; ctx.fillRect(x1, Math.min(y, yz), Wd - x1, Math.max(1, Math.abs(yz - y)));
          ctx.lineWidth = Math.max(1, Math.round(1.3 * vr)); ctx.strokeStyle = `rgba(${v.warna},0.95)`;
          ctx.beginPath(); ctx.moveTo(x1, y + .5); ctx.lineTo(Wd, y + .5); ctx.stroke();
          ctx.font = `600 ${Math.round(10.5 * vr)}px Inter, system-ui, sans-serif`; ctx.fillStyle = `rgba(${v.warna},0.95)`;
          const teks = Wd / hr < 560 ? v.teks.replace('BATAS ', '') : v.teks, lebarT = ctx.measureText(teks).width;
          ctx.fillText(teks, Math.max(x1 + 34 * hr, Wd - lebarT - (Wd / hr < 560 ? 12 : 64) * hr), v.atas ? y - 5 * vr : y + 14 * vr);
        }
        if (g.yE != null && g.yT != null && g.yS != null) {
          const x = g.tx == null ? Math.round(Wd * 0.7) : Math.max(0, Math.round(g.tx * hr)), yE = Math.round(g.yE * vr), yT = Math.round(g.yT * vr), yS = Math.round(g.yS * vr);
          const a = g.calon ? 0.09 : 0.16;
          ctx.fillStyle = `rgba(34,195,154,${a})`; ctx.fillRect(x, Math.min(yE, yT), Wd - x, Math.abs(yT - yE));
          ctx.fillStyle = `rgba(242,84,91,${a})`; ctx.fillRect(x, Math.min(yE, yS), Wd - x, Math.abs(yS - yE));
        }
      });
    }
    gambarAtas(target) {
      const g = this.g; if (!g || !g.piv || !g.piv.length) return;
      target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
        const P_ = g.piv;
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
      // skala otomatis: candle terlihat + batas & TP/SL saat ini (bila candle terakhir terlihat)
      autoscaleInfoProvider: asli => {
        const r = asli(), s = CH.s; if (!r || !s || !chart) return r;
        const lr = chart.timeScale().getVisibleLogicalRange();
        if (!lr || lr.to < CH.bars.length - 2) return r;
        const ext = [s.atas, s.bawah]; const t = s.aktif || (s.keadaan === 'KANDIDAT' && s.rencana);
        if (t) ext.push(t.tp, t.sl);
        for (const v of ext) if (ok(v)) { r.priceRange.minValue = Math.min(r.priceRange.minValue, v); r.priceRange.maxValue = Math.max(r.priceRange.maxValue, v); }
        return r;
      } });
    cs.attachPrimitive(zona);
    const pl = (color, title, style = 0) => cs.createPriceLine({ price: 0, color, lineWidth: 1, lineStyle: style, lineVisible: false, axisLabelVisible: false, title });
    garis.atas = pl(C.dn, ''); garis.bawah = pl(C.up, '');
    garis.entry = pl('#aab3c2', 'Entry', 2); garis.tp = pl(C.up, 'TP', 2); garis.sl = pl(C.dn, 'SL', 2);
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
    Object.assign(CH, { sym: m.sym, tf: m.tf, bars, vols, uu, ll, lastT: n ? B.t[n - 1] : 0 });
    if (n) { cs.setData(bars); vs.setData(vols); su.setData(uu); sb.setData(ll); }
    CH.uji = m.uji || CH.uji; CH.jurnal = m.jurnal || CH.jurnal;
    CH.piv = (m.piv || []).map(x => ({ t: tl(x.t), p: x.p, tipe: x.tipe, lbl: x.lbl }));
    pasangPenanda();
    if (!viewSama && n) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - (P.tf === '1m' ? 150 : 140)), to: n + 8 });
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
  function pasangPenanda() {
    if (!cs) return;
    const t0 = CH.bars.length ? CH.bars[0].time : Infinity, map = new Map();
    for (const x of CH.uji || []) if (tl(x.t0) >= t0) map.set(x.t0, x);
    for (const x of CH.jurnal || []) if (tl(x.t0) >= t0) map.set(x.t0, x);
    const s = CH.s, akt = s && s.aktif;
    const mk = [...map.values()].sort((a, b) => a.t0 - b.t0).map(x => ({ time: tl(x.t0), position: x.side < 0 ? 'aboveBar' : 'belowBar',
      shape: x.side < 0 ? 'arrowDown' : 'arrowUp', color: x.pnl > 0 ? C.up : C.dn, text: x.sumber === 'live' ? (x.kode || 'live') : '' }));
    if (akt && tl(akt.t0) >= t0) mk.push({ time: tl(akt.t0), position: akt.side < 0 ? 'aboveBar' : 'belowBar', shape: akt.side < 0 ? 'arrowDown' : 'arrowUp', color: C.am, text: (akt.side < 0 ? 'SELL ' : 'BUY ') + (akt.kode || '') });
    mk.sort((a, b) => a.time - b.time);
    try { cs.setMarkers(mk); } catch (e) { /* */ }
    CH.tr = map; CH.mkAkt = akt ? akt.t0 : 0;
  }
  function legendaDari(param) {
    const el = $('legend'); if (!cs) return;
    let bar = null;
    if (param && param.time && param.seriesData) bar = param.seriesData.get(cs);
    if (!bar) bar = CH.bars[CH.bars.length - 1];
    if (!bar) { el.innerHTML = ''; return; }
    const tm = (bar.time - 7 * 3600) * 1000;
    const tr = CH.tr && CH.tr.get(tm);
    const nm = NAMA[P.sym];
    let h = `<span class="t">${nm} · ${P.tf}</span><span class="ohl">O <b>${fh(bar.open)}</b></span><span class="ohl">H <b>${fh(bar.high)}</b></span><span class="ohl">L <b>${fh(bar.low)}</b></span><span>C <b>${fh(bar.close)}</b></span>`;
    if (tr) h += `<span class="tr ${tr.pnl > 0 ? 'w' : 'l'}">${tr.side < 0 ? 'SELL' : 'BUY'} ${fh(tr.entry)} → ${tr.hasil} ${fh(tr.keluar)} · ${frp(keRp(tr.pnl, P.sym))}${tr.sumber === 'live' ? ' · live' : ' · uji'}</span>`;
    if (el.innerHTML !== h) el.innerHTML = h;
  }

  // ---------------------------------------------------------------- pesan dari mesin
  const A = { strategi: null, jurnal: [], uji: [], hariIni: null, kebiasaan: null, sesi: null, batas: null, memori: null, kurva: null };
  function terima(m) {
    switch (m.op) {
      case 'riwayat': if (m.sym === P.sym && m.tf === P.tf) { isiChart(m); A.jurnal = m.jurnal || A.jurnal; renderRiwayat(); } break;
      case 'detik': onDetik(m); break;
      case 'bar': barTutup(m); if (m.sym === P.sym && m.tf === P.tf && m.jurnal) { A.jurnal = m.jurnal; renderRiwayat(); } break;
      case 'analisis': if (m.sym === P.sym && m.tf === P.tf) { Object.assign(A, m); renderStrategi(); renderRiwayat(); renderKeb(); CH.jurnal = m.jurnal; pasangPenanda(); } break;
      case 'analisis-selesai': ulangSelesai(); break;
      case 'sinyal': onSinyal(m); break;
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
      const umur = h.kal && h.kal.t ? Date.now() - h.kal.t : Infinity;
      setC(b.querySelector('[data-kal]'), 'pk' + (umur < 12 * 3600e3 ? ' ok' : umur < Infinity ? ' lama' : ''));
      HDR[sym] = h;
    }
    infoKal();
    const s = m.s, f = m.feed || {};
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
    let tr = null;
    if (s.aktif) tr = { t: tl(s.aktif.t0), entry: s.aktif.entry, tp: s.aktif.tp, sl: s.aktif.sl };
    else if (s.keadaan === 'KANDIDAT' && s.rencana) tr = { t: tl(s.bar.t), entry: s.rencana.entry, tp: s.rencana.tp, sl: s.rencana.sl, calon: true };
    aturGaris('entry', tr ? tr.entry : 0, !!tr); aturGaris('tp', tr ? tr.tp : 0, !!tr); aturGaris('sl', tr ? tr.sl : 0, !!tr);
    const st = s.struktur || {};
    zona.set({
      level: adaR ? { atas: s.atas, bawah: s.bawah, tA: s.tAtas ? tl(s.tAtas) : 0, tB: s.tBawah ? tl(s.tBawah) : 0, zona: s.zona || 0, lblA: st.lblA, lblB: st.lblB } : null,
      gel: { piv: CH.piv || [], ujung: s.gel && ok(s.gel.p) ? { t: tl(s.gel.t), p: s.gel.p } : null },
      trade: tr,
    });
  }

  function renderHitung(s) {
    const sisa = Math.max(0, s.sisa | 0), txt = Math.floor(sisa / 60) + ':' + dua(sisa % 60);
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
    setT($('s-tf'), s.tf);
    setT($('s-pola'), A.strategi && A.strategi.aktif ? A.strategi.pola : '');
    let cls = 's-badge', bt = 'TUNGGU', judul = '', sub = '', plan = null, redup = false, meta = '';
    const arahT = a => a < 0 ? 'SELL' : 'BUY';
    const tempat = a => a < 0 ? 'puncak gelombang' : 'lembah gelombang';
    switch (s.keadaan) {
      case 'MEMUAT': bt = '···'; judul = 'Menyiapkan data & uji riwayat'; sub = 'Riwayat diunduh lalu ratusan kombinasi gelombang × pola candle diuji di perangkat ini.'; break;
      case 'TUTUP': bt = 'TUTUP'; judul = 'Pasar emas sedang tutup'; sub = s.bukaLagi ? `Buka lagi ${HARI[new Date(s.bukaLagi + WIB).getUTCDay()]} ${jm(s.bukaLagi)} WIB. Harga beku di penutupan terakhir.` : ''; break;
      case 'NONAKTIF': bt = 'TUNGGU'; judul = 'Belum ada setup yang lolos uji'; sub = 'Pada gaya ini tidak ada kombinasi gelombang + pola candle yang untung di ≥3 dari 4 periode riwayat. Coba gaya lain di kartu Strategi.'; break;
      case 'POSISI': {
        const a = s.aktif; cls += a.side < 0 ? ' sell' : ' buy'; bt = arahT(a.side);
        judul = `Posisi ${arahT(a.side)} berjalan · ${a.pola || ''} · masuk ${jm(a.tE)}`;
        sub = `Ditutup otomatis di TP, SL, atau saat jam pasir habis (${a.maxb} candle). Sisa ${Math.max(0, a.maxb - a.lewat)} candle.`;
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
        if (!sisi) { judul = 'Harga di dalam gelombang'; sub = `Belum ada sisi yang cocok dengan aturan (${at.ktx || 'filter'}): struktur ${strukturT(s.struktur)}, EMA ${s.struktur && s.struktur.ema > 0 ? 'naik' : 'turun'}.`; break; }
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
        if (s.boleh && !(sisi < 0 ? s.boleh.beli : s.boleh.jual) && at.p !== 'bos') sub += ` ${arahT(-sisi)} di ${tempat(-sisi)} tidak diambil (${at.ktx}).`;
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
      const rr = slD ? tpD / slD : 0, eta = plan.eta ? Math.round(plan.eta * TF_MENIT[s.tf]) : 0;
      meta = `<span>R:R <b>1 : ${fx(rr, 1)}</b></span>` + (ok(plan.pTp) ? `<span>Kena TP <b>${fp(plan.pTp)}</b> di riwayat</span>` : '') + (eta ? `<span>± <b>${eta} mnt</b> ke TP</span>` : '');
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
    const teks = $('st-teks');
    if (!st) { setT(teks, 'Menguji setup pada riwayat…'); return; }
    if (!st.aktif) {
      teks.className = 'st-teks mati';
      setT(teks, `Dari ${st.diuji} setup yang diuji, tidak ada yang lolos untuk gaya ini (syarat: untung setelah spread di ≥3 dari 4 periode). Sinyal dimatikan; batas & kebiasaan tetap jalan.`);
      ['st-wr', 'st-pf', 'st-e', 'st-ph'].forEach(id => setT($(id), '–')); $('st-kurva').innerHTML = ''; setT($('st-proj'), '');
      setT($('st-uji'), `${fx(st.hari, 0)} hari riwayat · spread ${fd(st.spread, st.spread >= 1 ? 1 : 2)}`); return;
    }
    teks.className = 'st-teks';
    const nama = { winrate: 'Winrate', seimbang: 'Seimbang', rr: 'RR besar' };
    setT(teks, st.teks + (st.gayaDipakai && st.gayaDipakai !== st.gaya ? ` — gaya ${nama[st.gaya]} tidak menemukan setup lolos, dipakai ${nama[st.gayaDipakai]}` : ''));
    setT($('st-wr'), fp(st.wr)); setT($('st-pf'), fx(st.pf, 2));
    setT($('st-e'), frpRingkas(keRp(st.e, sym))); setT($('st-ph'), fx(st.perHari, 1));
    $('st-e').className = st.e >= 0 ? 'up' : 'dn';
    const proj = keRp(st.e * st.perHari, sym);
    $('st-proj').innerHTML = `Proyeksi <b class="${proj >= 0 ? 'up' : 'dn'}">${frp(proj)}/hari</b> · lot ${nf(2).format(P.lot)} · kena TP ${fp(st.tpRate)}`;
    setT($('st-uji'), `Diuji ${st.diuji} setup · ${fx(st.hari, 0)} hari · ${st.lolosP}/4 periode untung`);
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
      sum.innerHTML = list.length ? `${list.length} sinyal terakhir dari uji riwayat · <b>${fp(w / list.length)}</b> untung · <b>${frp(keRp(list.reduce((s, x) => s + x.pnl, 0), sym))}</b>` : '';
    }
    const el = $('rw-list');
    if (!list.length) {
      el.innerHTML = `<div class="rw-kosong">${live ? 'Belum ada sinyal live di ' + NAMA[sym] + ' ' + P.tf + '.<br>Sinyal & hasilnya direkam di sini begitu muncul.' : 'Belum ada trade uji.'}</div>`;
      return;
    }
    const rows = list.slice(-80).reverse().map(x => {
      const rp = keRp(x.pnl, sym), tgl = Math.floor((x.t0 + WIB) / 864e5) !== Math.floor((Date.now() + WIB) / 864e5);
      const wk = tgl ? new Date(x.t0 + WIB).toISOString().slice(8, 10) + '/' + new Date(x.t0 + WIB).toISOString().slice(5, 7) : jm(x.t0);
      return `<div class="rw" title="${x.side < 0 ? 'SELL' : 'BUY'} ${fh(x.entry)} · TP ${fh(x.tp)} · SL ${fh(x.sl)} · keluar ${jm(x.t1)}"><span class="w">${wk}</span><span class="d ${x.side < 0 ? 's' : 'b'}">${x.side < 0 ? 'SELL' : 'BUY'}</span>` +
        `<span class="p">${fh(x.entry)} → ${fh(x.keluar)}</span><span class="h ${x.hasil === 'TP' ? 'tp' : x.hasil === 'SL' ? 'sl' : ''}">${x.hasil}</span><span class="r ${rp >= 0 ? 'up' : 'dn'}">${frp(rp)}</span></div>`;
    }).join('');
    if (el.innerHTML !== rows) el.innerHTML = rows;
  }

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
    if (m.jenis === 'buka') { bunyi([880, 1320]); toast(`<b class="${m.side < 0 ? 'dn' : 'up'}">${arah}</b> ${nm} @ ${fh(m.entry)}` + (m.sym !== P.sym || m.tf !== P.tf ? ' <button>Lihat</button>' : ''), () => pilih(m.sym, m.tf)); }
    else { bunyi(m.pnl > 0 ? [1320, 1760] : [440, 330]); toast(`${arah} ${nm} selesai: <b class="${m.pnl > 0 ? 'up' : 'dn'}">${m.hasil} ${frp(keRp(m.pnl, m.sym))}</b>` + (m.sym !== P.sym || m.tf !== P.tf ? ' <button>Lihat</button>' : ''), () => pilih(m.sym, m.tf)); }
  }

  // ---------------------------------------------------------------- interaksi
  function pilih(sym, tf) {
    if (sym === P.sym && tf === P.tf) return;
    P.sym = sym; P.tf = tf; LS.set('sym', sym); LS.set('tf', tf);
    tandaiPilihan();
    Object.assign(A, { strategi: null, jurnal: [], uji: [], hariIni: null, kebiasaan: A.kebiasaan && sym === CH.sym ? A.kebiasaan : null, sesi: null, batas: null, kurva: null });
    CH.uji = []; CH.jurnal = []; CH.piv = []; CH.s = null; JP.siklus = null;
    zona.set(null); ['atas', 'bawah', 'entry', 'tp', 'sl'].forEach(k => aturGaris(k, 0, false));
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
  function renderKal() {
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
    const perlu = !infoKalTutup && !tutup && (!k || Date.now() - k.t > 12 * 3600e3);
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
    $('set-info').textContent = `Sumber: Binance (BTC = BTCUSDT ÷ USDCUSDT agar dalam USD seperti Exness; XAU = PAXGUSDT × rasio emas). Semua harga ditampilkan sebagai Bid seperti di Exness. Tanpa kalibrasi, selisih ke Exness bisa beberapa dolar. Kurs USD/IDR ${nf(0).format(KURS)}.`;
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
    live: () => { const i = $('live').dataset.info; return i === 'ws' ? '<b>Live</b> — harga langsung dari WebSocket Binance, diperbarui tiap detik.' : i === 'poll' ? '<b>Cadangan</b> — WebSocket terputus, harga diambil lewat REST tiap ±1 detik.' : '<b>Terputus</b> — mencoba menyambung lagi.'; },
    harga: el => {
      const sym = el.dataset.sym, h = HDR[sym];
      return `<b>${NAMA[sym]} Bid ${h && ok(h.p) ? fh(h.p) : ''}</b><br>${sym === 'BTCUSDT' ? 'Binance BTCUSDT ÷ USDCUSDT (USD)' : 'PAXGUSDT × rasio emas'}, ditampilkan sebagai Bid (tengah − spread/2).<br>${teksKal(sym)}`;
    },
    hitung: () => 'Jam pasir candle: sisa waktu sampai candle ini tutup. Pola candle baru sah saat candle tutup.',
    gelombang: () => 'Batas Atas/Bawah = puncak & lembah gelombang terakhir. Satu gelombang terkonfirmasi bila harga berbalik minimal sekian ATR dari titik ekstremnya; ukuran ini dipilih dari uji riwayat.',
    struktur: () => 'Struktur gelombang: HH & HL (puncak dan lembah makin tinggi) = naik; LH & LL = turun; campuran = datar.',
    peluang: () => 'Peluang harga menyentuh zona puncak (▲) / lembah (▼) gelombang dalam jendela waktu ini, dari sebaran gerak di riwayat. Dihitung ulang tiap detik.',
    pantul: () => 'Dari 30 hari terakhir: saat ekor candle menyentuh puncak/lembah gelombang terakhir, berapa persen candle tutup kembali di dalam (sisanya menembus).',
    pola: () => A.strategi && A.strategi.aktif ? `Pola candle yang dipakai strategi saat ini: <b>${A.strategi.pola}</b>. ${A.strategi.teks}.` : 'Belum ada pola yang lolos uji.',
    cek: el => el.dataset.info || '',
    jp: () => { const s = CH.s; if (s && s.aktif) return `<b>Jam pasir posisi</b> — scalping dibatasi ${s.aktif.maxb} candle (${s.aktif.maxb * TF_MENIT[s.tf]} mnt). Garis putus = rata-rata waktu kena TP di riwayat (±${Math.round((s.aktif.eta || 0) * TF_MENIT[s.tf])} mnt). Lewat garis itu peluang TP menurun; saat pasir habis posisi ditutup.`;
      return '<b>Jam pasir candle</b> — sisa waktu candle berjalan. Entry hanya setelah candle tutup dan polanya tetap sah; saat pasir habis jam pasir dibalik untuk candle berikut.'; },
    wr: () => 'Persentase trade uji yang untung setelah spread.',
    pf: () => 'Total untung ÷ total rugi di uji riwayat. Di atas 1 = untung bersih; 1,2+ cukup baik untuk scalping.',
    e: () => `Rata-rata hasil per trade setelah spread, untuk lot ${nf(2).format(P.lot)} dan kurs ${nf(0).format(KURS)}.`,
    ph: () => 'Rata-rata jumlah sinyal per hari di uji riwayat.',
    kurva: () => `Hasil kumulatif semua trade uji (setelah spread): <b>${$('st-kurva').dataset.akhir || '–'}</b>. Naik stabil = konsisten; turun tajam = periode rugi.`,
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
  window.SCALP = { P, A, CH, W, chart: () => chart };
})();
