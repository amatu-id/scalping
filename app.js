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

  // ---------------------------------------------------------------- preferensi (kunci berawalan scalping.)
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('scalping.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('scalping.' + k, JSON.stringify(v)); } catch (e) { /* mode privat */ } },
  };
  const qs = new URLSearchParams(location.search);
  const P = {
    sym: qs.get('sym') || LS.get('sym', 'BTCUSDT'), tf: qs.get('tf') || LS.get('tf', '1m'),
    gaya: LS.get('gaya', 'seimbang'), lot: +LS.get('lot', 0.01) || 0.01,
    spread: Object.assign({ BTCUSDT: 6.4, XAUUSDm: 0.2 }, LS.get('spread', {})),
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
  W.postMessage({ op: 'mulai', set: { lot: P.lot, spread: P.spread, gaya: P.gaya }, lihat: { sym: P.sym, tf: P.tf } });

  // ---------------------------------------------------------------- chart
  const LW = window.LightweightCharts;
  let chart = null, cs = null, vs = null, su = null, sb = null;
  const garis = {};
  const CH = { sym: '', tf: '', bars: [], vols: [], uu: [], ll: [], lastT: 0, uji: [], jurnal: [], tr: new Map(), s: null };

  /** Primitive: kotak range (batas atas–bawah) + zona TP/SL posisi, digambar di bawah candle. */
  class Zona {
    constructor() { this.d = null; this.g = null; this.ch = null; this.se = null; this.req = null; const z = this; this.views = [{ zOrder: () => 'bottom', renderer: () => ({ draw: t => z.gambar(t) }) }]; }
    attached(p) { this.ch = p.chart; this.se = p.series; this.req = p.requestUpdate; }
    detached() { this.ch = this.se = this.req = null; }
    paneViews() { return this.views; }
    updateAllViews() { this.hitung(); }
    set(d) { this.d = d; if (this.req) this.req(); }
    hitung() {
      const d = this.d; this.g = null;
      if (!d || !this.ch || !this.se) return;
      const ts = this.ch.timeScale(), se = this.se, g = {};
      if (d.range) { g.x1 = ts.timeToCoordinate(d.range.t1); g.yA = se.priceToCoordinate(d.range.atas); g.yB = se.priceToCoordinate(d.range.bawah); g.yM = se.priceToCoordinate((d.range.atas + d.range.bawah) / 2); }
      if (d.trade) { const x = d.trade; g.tx = ts.timeToCoordinate(x.t); g.yE = se.priceToCoordinate(x.entry); g.yT = se.priceToCoordinate(x.tp); g.yS = se.priceToCoordinate(x.sl); g.calon = x.calon; }
      this.g = g;
    }
    gambar(target) {
      const g = this.g; if (!g) return;
      target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
        const Wd = bitmapSize.width;
        if (g.yA != null && g.yB != null) {
          const x1 = g.x1 == null ? 0 : Math.max(0, Math.round(g.x1 * hr)), yA = Math.round(g.yA * vr), yB = Math.round(g.yB * vr), h = yB - yA;
          if (h > 0) {
            ctx.fillStyle = 'rgba(148,163,184,0.045)'; ctx.fillRect(x1, yA, Wd - x1, h);
            const z = Math.max(2, Math.round(Math.min(h * 0.16, 70 * vr)));
            ctx.fillStyle = 'rgba(242,84,91,0.075)'; ctx.fillRect(x1, yA, Wd - x1, z);
            ctx.fillStyle = 'rgba(34,195,154,0.075)'; ctx.fillRect(x1, yB - z, Wd - x1, z);
            ctx.lineWidth = Math.max(1, Math.round(1.2 * vr));
            ctx.strokeStyle = 'rgba(242,84,91,0.9)'; ctx.beginPath(); ctx.moveTo(x1, yA + .5); ctx.lineTo(Wd, yA + .5); ctx.stroke();
            ctx.strokeStyle = 'rgba(34,195,154,0.9)'; ctx.beginPath(); ctx.moveTo(x1, yB + .5); ctx.lineTo(Wd, yB + .5); ctx.stroke();
            if (g.yM != null) { ctx.setLineDash([4 * hr, 5 * hr]); ctx.lineWidth = Math.max(1, Math.round(vr)); ctx.strokeStyle = 'rgba(148,163,184,0.28)'; const ym = Math.round(g.yM * vr) + .5; ctx.beginPath(); ctx.moveTo(x1, ym); ctx.lineTo(Wd, ym); ctx.stroke(); ctx.setLineDash([]); }
            ctx.font = `600 ${Math.round(10.5 * vr)}px Inter, system-ui, sans-serif`;
            ctx.fillStyle = 'rgba(242,84,91,0.95)'; ctx.fillText('BATAS ATAS', x1 + 6 * hr, yA - 5 * vr);
            ctx.fillStyle = 'rgba(34,195,154,0.95)'; ctx.fillText('BATAS BAWAH', x1 + 6 * hr, yB + 14 * vr);
          }
        }
        if (g.yE != null && g.yT != null && g.yS != null) {
          const x = g.tx == null ? Math.round(Wd * 0.7) : Math.max(0, Math.round(g.tx * hr)), yE = Math.round(g.yE * vr), yT = Math.round(g.yT * vr), yS = Math.round(g.yS * vr);
          const a = g.calon ? 0.09 : 0.16;
          ctx.fillStyle = `rgba(34,195,154,${a})`; ctx.fillRect(x, Math.min(yE, yT), Wd - x, Math.abs(yT - yE));
          ctx.fillStyle = `rgba(242,84,91,${a})`; ctx.fillRect(x, Math.min(yE, yS), Wd - x, Math.abs(yS - yE));
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
    const garisRiwayat = c => ({ color: c, lineWidth: 1, lineType: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
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
  }
  function pasangPenanda() {
    if (!cs) return;
    const t0 = CH.bars.length ? CH.bars[0].time : Infinity, map = new Map();
    for (const x of CH.uji || []) if (tl(x.t0) >= t0) map.set(x.t0, x);
    for (const x of CH.jurnal || []) if (tl(x.t0) >= t0) map.set(x.t0, x);
    const s = CH.s, akt = s && s.aktif;
    const mk = [...map.values()].sort((a, b) => a.t0 - b.t0).map(x => ({ time: tl(x.t0), position: x.side < 0 ? 'aboveBar' : 'belowBar',
      shape: x.side < 0 ? 'arrowDown' : 'arrowUp', color: x.pnl > 0 ? C.up : C.dn, text: x.sumber === 'live' ? 'live' : '' }));
    if (akt && tl(akt.t0) >= t0) mk.push({ time: tl(akt.t0), position: akt.side < 0 ? 'aboveBar' : 'belowBar', shape: akt.side < 0 ? 'arrowDown' : 'arrowUp', color: C.am, text: akt.side < 0 ? 'SELL' : 'BUY' });
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
    const nm = P.sym === 'XAUUSDm' ? 'XAUUSDm' : 'BTCUSDT';
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
    }
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
    document.title = `${ok(s.harga) ? fh(s.harga) : ''} ${P.sym}${lbl ? ' · ' + lbl : ''} · Scalping`;
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
    zona.set({ range: adaR ? { t1: tl(s.mulaiW), atas: s.atas, bawah: s.bawah } : null, trade: tr });
  }

  function renderHitung(s) {
    const sisa = Math.max(0, s.sisa | 0), txt = Math.floor(sisa / 60) + ':' + dua(sisa % 60);
    setT($('hitung-v'), txt);
    $('hitung').classList.toggle('dekat', sisa <= 10 && s.keadaan === 'KANDIDAT');
    const chip = $('s-sisa');
    setT(chip, s.keadaan === 'TUTUP' ? 'pasar tutup' : 'candle tutup ' + txt);
    setC(chip, 'chip' + (s.keadaan === 'KANDIDAT' ? ' dekat' : ''));
  }

  function lv(id, harga, sub) { setT($('s-' + id), ok(harga) ? fh(harga) : '–'); setT($('s-' + id + '2'), sub || ''); }
  function renderSinyal(s) {
    const sym = s.sym, badge = $('s-badge');
    setT($('s-tf'), s.tf);
    let cls = 's-badge', bt = 'TUNGGU', judul = '', sub = '', plan = null, redup = false, meta = '';
    const arahT = a => a < 0 ? 'SELL' : 'BUY';
    const batasT = a => a < 0 ? 'Batas Atas' : 'Batas Bawah';
    switch (s.keadaan) {
      case 'MEMUAT': bt = '···'; judul = 'Menyiapkan data & uji riwayat'; sub = 'Riwayat diunduh lalu ratusan setup diuji di perangkat ini.'; break;
      case 'TUTUP': bt = 'TUTUP'; judul = 'Pasar emas sedang tutup'; sub = s.bukaLagi ? `Buka lagi ${HARI[new Date(s.bukaLagi + WIB).getUTCDay()]} ${jm(s.bukaLagi)} WIB. Harga beku di penutupan terakhir.` : ''; break;
      case 'NONAKTIF': bt = 'TUNGGU'; judul = 'Belum ada setup yang lolos uji'; sub = 'Pada gaya ini tidak ada pola yang untung di ≥3 dari 4 periode riwayat. Coba gaya lain di kartu Strategi.'; break;
      case 'POSISI': {
        const a = s.aktif; cls += a.side < 0 ? ' sell' : ' buy'; bt = arahT(a.side);
        judul = `Posisi ${arahT(a.side)} berjalan · masuk ${jm(a.tE)}`;
        sub = `${a.cfg || ''}${a.maxb ? ` · ditutup paksa setelah ${a.maxb} candle (sisa ${Math.max(0, a.maxb - a.lewat)})` : ''}`;
        plan = a; break;
      }
      case 'KANDIDAT': {
        const r = s.rencana; cls += s.arah < 0 ? ' k-sell' : ' k-buy'; bt = arahT(s.arah) + '?';
        judul = `Calon ${arahT(s.arah)} — pantul dari ${batasT(s.arah)}`;
        sub = `Ekor sudah menyentuh ${batasT(s.arah)}. Sinyal sah jika candle tutup di ${s.arah < 0 ? 'bawah' : 'atas'} ${fh(s.arah < 0 ? s.atas : s.bawah)} (${s.sisa} dtk lagi).`;
        plan = r; break;
      }
      case 'TEMBUS': cls += ' tembus'; bt = 'TEMBUS';
        judul = `Harga menembus ${s.arah > 0 ? 'Batas Atas' : 'Batas Bawah'}`;
        sub = (s.boleh && !(s.arah > 0 ? s.boleh.jual : s.boleh.beli))
          ? `Bukan sinyal. Strategi ${s.aturanTren === 'with' ? 'ikut' : 'lawan'} tren tidak mengambil ${s.arah > 0 ? 'SELL' : 'BUY'} di sini; range akan bergeser.`
          : `Bukan sinyal. Jika candle tutup kembali di ${s.arah > 0 ? 'bawah ' + fh(s.atas) + ' → calon SELL' : 'atas ' + fh(s.bawah) + ' → calon BUY'}; jika tidak, range bergeser.`;
        plan = null; break;
      case 'SIAGA': case 'TUNGGU': {
        const sisi = s.arah, dekat = s.keadaan === 'SIAGA';
        if (!sisi) { judul = 'Harga di dalam range'; sub = `Belum ada sisi yang memenuhi aturan strategi (${s.tolak || 'filter'}).`; break; }
        if (dekat) { cls += ' siaga'; bt = 'SIAGA'; }
        const jarak = sisi < 0 ? s.jarak && s.jarak.atas : s.jarak && s.jarak.bawah;
        judul = dekat ? `Dekat ${batasT(sisi)} — siap ${arahT(sisi)}` : `Harga di dalam range · tunggu ${arahT(sisi)}`;
        sub = `${arahT(sisi)} jika ekor menyentuh ${fh(sisi < 0 ? s.atas : s.bawah)} lalu candle tutup kembali di dalam (jarak ${fd(jarak, jarak >= 100 ? 0 : 2)}).`;
        if (s.lewati) {
          const tr = /tren/.test(s.lewati.alasan || '');
          sub += ` ${arahT(s.lewati.sisi)} di ${batasT(s.lewati.sisi)} tidak diambil` + (tr ? `: strategi ${s.aturanTren === 'with' ? 'ikut' : 'lawan'} tren, tren sedang ${s.tren > 0 ? 'naik' : 'turun'}.` : ` (${s.lewati.alasan}).`);
        }
        if (s.tolak) sub = `Pantulan candle ini diabaikan (${s.tolak}). ` + sub;
        plan = s.siaga; redup = true; break;
      }
    }
    setC(badge, cls); setT(badge, bt); setT($('s-judul'), judul); setT($('s-sub'), sub);
    $('s-lv').classList.toggle('redup', redup || !plan);
    if (plan) {
      const tpD = Math.abs(plan.tp - plan.entry), slD = Math.abs(plan.sl - plan.entry);
      lv('entry', plan.entry, s.keadaan === 'POSISI' ? 'masuk ' + jm(plan.tE) : s.keadaan === 'KANDIDAT' ? 'harga kini' : 'di batas');
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
  }

  function renderBatas(s) {
    if (!ok(s.atas)) return;
    const d = s.jarak || {}, mnt = s.W * TF_MENIT[s.tf];
    setT($('b-w'), (mnt >= 60 ? fx(mnt / 60, mnt % 60 ? 1 : 0) + ' jam' : mnt + ' mnt') + ' terakhir');
    setT($('b-atas'), fh(s.atas)); setT($('b-bawah'), fh(s.bawah)); setT($('b-harga'), fh(s.harga));
    setT($('b-atas-d'), d.atas >= 0 ? `▲ ${fd(d.atas, d.atas >= 100 ? 0 : 2)} · ${fa(d.atasA)} ATR` : `tembus ${fd(-d.atas, 2)}`);
    setT($('b-bawah-d'), d.bawah >= 0 ? `▼ ${fd(d.bawah, d.bawah >= 100 ? 0 : 2)} · ${fa(d.bawahA)} ATR` : `tembus ${fd(-d.bawah, 2)}`);
    setT($('b-pos'), ok(s.pos) ? `posisi ${fp(Math.max(0, Math.min(1, s.pos)))} dari bawah` : '');
    const pos = ok(s.pos) ? Math.max(-0.06, Math.min(1.06, s.pos)) : 0.5;
    $('b-mark').style.top = ((1 - pos) * 100).toFixed(1) + '%';
    const lebar = s.atas - s.bawah;
    setT($('b-lebar'), `${fd(lebar, lebar >= 100 ? 0 : 2)} · ${fa(s.lebarA)} ATR`);
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
      el.innerHTML = `<div class="rw-kosong">${live ? 'Belum ada sinyal live di ' + sym + ' ' + P.tf + '.<br>Sinyal & hasilnya direkam di sini begitu muncul.' : 'Belum ada trade uji.'}</div>`;
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
    setT($('keb-now'), `Jam ${dua(jamKini)}.00: gerak ±${fd(j.gerak, j.gerak >= 100 ? 0 : 2)} · rentang ${fd(j.rng, j.rng >= 100 ? 0 : 2)} · naik ${fp(j.naik)} · aktivitas ${fx(j.vol, 1)}× rata-rata`);
    const S = A.sesi, ks = SESI.findIndex(x => jamKini >= x.a && jamKini < x.b);
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
    const arah = m.side < 0 ? 'SELL' : 'BUY', nm = `${m.sym} ${m.tf}`;
    if (m.jenis === 'buka') { bunyi([880, 1320]); toast(`<b class="${m.side < 0 ? 'dn' : 'up'}">${arah}</b> ${nm} @ ${fh(m.entry)}` + (m.sym !== P.sym || m.tf !== P.tf ? ' <button>Lihat</button>' : ''), () => pilih(m.sym, m.tf)); }
    else { bunyi(m.pnl > 0 ? [1320, 1760] : [440, 330]); toast(`${arah} ${nm} selesai: <b class="${m.pnl > 0 ? 'up' : 'dn'}">${m.hasil} ${frp(keRp(m.pnl, m.sym))}</b>` + (m.sym !== P.sym || m.tf !== P.tf ? ' <button>Lihat</button>' : ''), () => pilih(m.sym, m.tf)); }
  }

  // ---------------------------------------------------------------- interaksi
  function pilih(sym, tf) {
    if (sym === P.sym && tf === P.tf) return;
    P.sym = sym; P.tf = tf; LS.set('sym', sym); LS.set('tf', tf);
    tandaiPilihan();
    Object.assign(A, { strategi: null, jurnal: [], uji: [], hariIni: null, kebiasaan: A.kebiasaan && sym === CH.sym ? A.kebiasaan : null, sesi: null, batas: null, kurva: null });
    CH.uji = []; CH.jurnal = []; CH.s = null;
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
  function bukaSetelan() {
    $('set-lot').value = P.lot; $('set-sp-btc').value = P.spread.BTCUSDT; $('set-sp-xau').value = P.spread.XAUUSDm; $('set-bunyi').checked = P.bunyi;
    $('set-info').textContent = `Data: Binance BTCUSDT; XAUUSDm = PAXGUSDT × harga spot emas (gold-api.com), jadi bisa selisih sedikit dari Exness. Kurs USD/IDR ${nf(0).format(KURS)}. Rekaman candle & sinyal disimpan di browser ini.`;
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
    hitung: () => 'Sisa waktu sampai candle ini tutup. Sinyal pantul baru sah saat candle tutup.',
    lebar: () => 'Jarak Batas Atas ke Batas Bawah, dalam dolar dan kelipatan ATR (rata-rata gerak satu candle).',
    peluang: () => 'Dari riwayat: seberapa sering harga bergerak sejauh jarak ke batas dalam jendela waktu ini. Dihitung ulang tiap detik.',
    pantul: () => 'Dari 30 hari terakhir: saat ekor candle menyentuh batas, berapa persen candle tutup kembali di dalam range (sisanya tembus).',
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
