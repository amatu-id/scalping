#!/bin/bash
# Pasang API key Exness untuk relay amatu-exness (Amatu Scalping) — dijalankan SENDIRI oleh pemilik akun.
# Kunci disimpan sebagai rahasia Supabase (project amatu-id); tidak ditulis ke file mana pun dan tidak tampil di layar.
#   bash pasang-kunci-exness.sh
set -euo pipefail
REF=ieyqxmzztoxgpvwexbkj
URL="https://$REF.supabase.co/functions/v1/amatu-exness/status"

command -v supabase >/dev/null || { echo "Supabase CLI tidak ditemukan (brew install supabase/tap/supabase)."; exit 1; }
echo "== Pasang API key Exness untuk Amatu Scalping =="
echo "Siapkan dari Exness Personal Area > Key Management: API key, kunci privat (128 huruf/angka hex),"
echo "nomor akun trading, dan host Gateway dari widget DNS."
echo

read -r -p "Nomor akun trading Exness (mis. 29000151170): " AKUN
AKUN="${AKUN//[#[:space:]]/}"
[[ "$AKUN" =~ ^[0-9]{5,20}$ ]] || { echo "Nomor akun tidak valid."; exit 1; }

read -r -p "API key (biasanya diawali exnsk-): " KEY
KEY="${KEY//[[:space:]]/}"
[[ ${#KEY} -ge 8 ]] || { echo "API key terlalu pendek."; exit 1; }

echo "Kunci privat (tempel lalu Enter; tidak akan terlihat):"
read -r -s PRIV
echo
PRIV="${PRIV//[[:space:]]/}"
if [[ ! "$PRIV" =~ ^[0-9a-fA-F]{128}$ && ! "$PRIV" =~ ^[0-9a-fA-F]{64}$ && "$PRIV" != *BEGIN* ]]; then
  echo "Peringatan: kunci privat bukan 128/64 karakter hex (panjang ${#PRIV}). Tetap lanjut? (y/n)"
  read -r OK; [[ "$OK" == "y" ]] || exit 1
fi

read -r -p "Host Gateway dari widget DNS (kosongkan untuk https://api.exness.com): " GW
GW="${GW//[[:space:]]/}"

TMP="$(mktemp -d)"; chmod 700 "$TMP"; ENVF="$TMP/exness.env"
trap 'rm -f "$ENVF"; rmdir "$TMP" 2>/dev/null || true' EXIT
{
  printf 'EXN_ACCOUNT_ID=%s\n' "$AKUN"
  printf 'EXN_API_KEY=%s\n' "$KEY"
  printf 'EXN_PRIVATE_KEY=%s\n' "$PRIV"
  [[ -n "$GW" ]] && printf 'EXN_GATEWAY=%s\n' "$GW"
} > "$ENVF"
chmod 600 "$ENVF"
unset PRIV KEY

echo "Menyimpan rahasia ke Supabase…"
supabase secrets set --project-ref "$REF" --env-file "$ENVF" >/dev/null
echo "Tersimpan. Menunggu fungsi memuat rahasia baru…"
sleep 8
for i in 1 2 3; do
  R="$(curl -s -m 30 "$URL" || true)"
  echo "$R" | grep -q '"ok":true' && { echo "BERHASIL: feed resmi Exness tersambung. Muat ulang amatu-id.github.io/scalping."; exit 0; }
  sleep 5
done
echo "Belum tersambung. Jawaban server: $R"
echo "Arti umum: AUTH_INVALID_API_KEY = API key salah/kedaluwarsa; AUTH_INVALID_SIGNATURE = kunci privat tidak cocok;"
echo "AUTH_PERMISSION_DENIED = izin key/akun/IP; ACCOUNT_NOT_FOUND = nomor akun bukan milik key ini."
exit 2
