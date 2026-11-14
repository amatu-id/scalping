# Amatu Scalping

https://amatu-id.github.io/scalping/ — scalping BTCUSDT & XAUUSDm (bagian dari Portal AMATU).

- **Chart 1m / 5m** dengan **gelombang** otomatis: zigzag puncak/lembah (dikonfirmasi saat harga berbalik ≥ r × ATR) berlabel struktur **HH / HL / LH / LL**.
- **Batas Atas & Batas Bawah** = puncak dan lembah gelombang terakhir, lengkap dengan zona sentuh (±0,3 ATR) tempat pola candle dihitung.
- **Entry dari gelombang + candle + price action**: pola tolak (ekor menembus lalu tutup kembali), pin bar, engulfing, high wave + konfirmasi, BOS / CHoCH; difilter konteks struktur (searah / melawan / datar) dan tren EMA50/200.
- **Dipilih dari riwayat**: tiap simbol × TF menguji 1.512 kombinasi (ukuran gelombang, pola, konteks, SL, TP) di 4 periode riwayat dengan biaya spread; hanya yang untung di ≥3 dari 4 periode yang dipakai. Gaya: Winrate (WR ≥ 52%), Seimbang (WR ≥ 38%), RR besar.
- **Alat posisi di chart** (seperti Long/Short Position TradingView): kotak dari harga entry selebar batas waktu posisi — zona hijau ke arah **TP**, zona merah ke arah **SL**, garis putih = entry, tepi kanan = posisi ditutup paksa. Label TP/SL berisi harga, jarak $ dan %, serta Rupiah (setelah spread); label tengah berisi arah SELL/BUY, entry dan R:R, atau P/L berjalan. Putus-putus = rencana perkiraan (SIAGA / RENCANA), tegas = CALON dan posisi berjalan (dengan area untung/rugi dan garis entry → harga kini). Trade riwayat (uji & live) tampil samar; arahkan kursor ke trade untuk melihat kotak TP/SL dan hasilnya.
- **Jam pasir**: sisa waktu candle (pola baru sah saat candle tutup) dan, saat posisi berjalan, sisa batas waktu scalping (30 candle 1m / 24 candle 5m) dengan tanda rata-rata waktu kena TP.
- **Tiap detik**: harga (WebSocket Binance), daftar periksa Lokasi · Pola candle · Konteks · Tutup candle, status (tunggu / siaga / calon / posisi / tembus), rencana entry–TP–SL dalam harga & Rupiah, peluang sentuh zona, P/L posisi virtual. Sinyal live & hasilnya direkam di jurnal.
- **Rekam riwayat**: candle 1m (hingga 60 hari) dan 5m (hingga 365 hari) di IndexedDB browser (`amatu-scalping`), terus bertambah.
- **Kebiasaan pasar**: gerak rata-rata per jam WIB, arah dominan, hasil strategi per sesi, sisa waktu sesi.

**Feed resmi Exness** (bila API key sudah dipasang): relay Supabase Edge Function `amatu-exness` (`cloud/supabase/functions/amatu-exness`) menandatangani permintaan Exness Trader API (Ed25519, EXN-*) dan meneruskan candle Bid M1/M5 serta tick Bid/Ask BTCUSDm & XAUUSDm ke halaman (perlu login Portal AMATU; relay hanya membaca harga, tidak ada rute order). Pemilik akun memasang kunci sendiri dengan `bash cloud/pasang-kunci-exness.sh` (rahasia Supabase EXN_API_KEY, EXN_PRIVATE_KEY, EXN_ACCOUNT_ID, EXN_GATEWAY). Header menampilkan sumber: EXNESS atau BINANCE ≈.

Tanpa feed resmi: Binance spot publik (`data-api.binance.vision`, `data-stream.binance.vision`). **Harga ditampilkan seperti Exness (Bid)**: BTCUSDm = BTCUSDT ÷ USDCUSDT (Exness memakai USD, bukan USDT; tanpa ini harga ~$70–80 lebih tinggi dari Exness) − spread/2; XAUUSDm = PAXGUSDT × rasio emas − spread/2, candle di luar jam pasar emas dibuang. Menu Setelan → **Samakan harga dengan Exness**: ketik Bid dari terminal Exness, selisihnya disimpan (BTC: selisih USD, XAU: rasio) dan ikut tersinkron lewat portal. Uji 14 Nov 2026: setelah disamakan, selisih ke Bid Exness median ±$5 (BTC); harga Exness tetap punya feed sendiri, jadi tidak identik per tick. Arsip tick resmi Exness (`ticks.ex2archive.com`) dipakai untuk mengukur selisih ini. Semua hitungan berjalan di browser (Web Worker `mesin.js`), tanpa server.

Hasil uji masa lalu bukan jaminan hasil berikutnya; ini alat bantu analisis, bukan saran investasi.

Build: `./build.sh` (cap versi ke `index.html` + `versi.txt`), lalu commit & push.
