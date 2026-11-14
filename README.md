# Amatu Scalping

https://amatu-id.github.io/scalping/ — scalping BTCUSDT & XAUUSDm (bagian dari Portal AMATU).

- **Chart 1m / 5m** dengan **Batas Atas & Batas Bawah** otomatis (range tertinggi/terendah W candle tertutup terakhir), zona jual/beli, riwayat batas, penanda sinyal.
- **Rekam riwayat**: candle 1m (hingga 60 hari) dan 5m (hingga 365 hari) diunduh dari Binance lalu terus direkam di IndexedDB browser (`amatu-scalping`).
- **Strategi PANTUL**: ekor candle menyentuh batas lalu candle tutup kembali di dalam range → arah balik. Setiap simbol × TF menguji 864 kombinasi (lebar range, SL, TP, filter tren, lebar minimum) pada 4 periode riwayat dengan biaya spread; hanya setup yang untung di ≥3 dari 4 periode yang dipakai. Gaya: Winrate (WR ≥ 52%), Seimbang (WR ≥ 38%), RR besar.
- **Tiap detik**: harga (WebSocket Binance), status (tunggu / siaga / calon / posisi / tembus), rencana entry–TP–SL, peluang sentuh batas, P/L posisi virtual, hitung mundur candle. Sinyal live & hasilnya direkam di jurnal.
- **Kebiasaan pasar**: gerak rata-rata per jam WIB, arah dominan, hasil strategi per sesi.

Data: Binance spot publik (`data-api.binance.vision`, `data-stream.binance.vision`). XAUUSDm = PAXGUSDT × rasio harga spot emas (gold-api.com); candle di luar jam pasar emas dibuang. Semua hitungan berjalan di browser (Web Worker `mesin.js`), tanpa server.

Hasil uji masa lalu bukan jaminan hasil berikutnya; ini alat bantu analisis, bukan saran investasi.

Build: `./build.sh` (cap versi ke `index.html` + `versi.txt`), lalu commit & push.
