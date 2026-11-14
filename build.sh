#!/bin/bash
# Cap versi ke index.html (?v=<hash> pada css/js, cache GitHub Pages ±10 menit) dan versi.txt (banner "versi baru").
set -e
cd "$(dirname "$0")"
H=$(cat index.src.html app.js app.css mesin.js | shasum | cut -c1-12)
sed "s/%%VERSI%%/$H/g" index.src.html > index.html
echo "$H" > versi.txt
node --check app.js
node --check mesin.js
echo "versi $H"
