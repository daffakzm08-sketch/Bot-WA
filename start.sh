#!/data/data/com.termux/files/usr/bin/bash
# Script ini menjalankan bot dan OTOMATIS menjalankan ulang
# kalau proses Node.js mati/ke-kill (misal karena RAM habis).

while true
do
   echo "🚀 Menjalankan bot..."
   node index.js

   echo "⚠️ Bot berhenti/crash. Restart dalam 5 detik..."
   sleep 5
done
