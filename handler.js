import chalk from "chalk"
import fs from "fs"
import { downloadContentFromMessage } from "@whiskeysockets/baileys"
import sharp from "sharp"
import ytdl from "ytdl-core"
import { isRegistered, getUser, registerUser, isAntilinkEnabled, setAntilink, getProfile, updateProfile, useEnergy } from "./db.js"
import { SOCIALKIT_API_KEY, GOOGLE_API_KEY, GOOGLE_CX } from "./config.js"

// ==================== PREFIX ====================
// Semua command harus diawali karakter ini, misal: .ping
const prefix = "."

// ==================== CEK ADMIN GRUP ====================
// Mengecek apakah pengirim pesan adalah admin di grup tempat pesan dikirim.
// Kalau chat pribadi (bukan grup), otomatis dianggap bukan admin.
async function isSenderAdmin(sock, jid, sender) {
   if (!jid.endsWith("@g.us")) return false // bukan grup

   try {
      const metadata = await sock.groupMetadata(jid)
      const participant = metadata.participants.find((p) => p.id === sender)
      return participant?.admin === "admin" || participant?.admin === "superadmin"
   } catch (err) {
      console.log(chalk.red(`❌ Gagal cek admin: ${err.message}`))
      return false
   }
}

// Ambil video ID dari berbagai format link YouTube (youtu.be, youtube.com/watch, /shorts, dll)
function extractYoutubeId(url) {
   const match = url.match(
      /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([a-zA-Z0-9_-]{11})/
   )
   return match ? match[1] : null
}


// Mengubah stream media (gambar/video/dll dari WA) jadi Buffer utuh
async function streamToBuffer(stream) {
   const chunks = []
   for await (const chunk of stream) {
      chunks.push(chunk)
   }
   return Buffer.concat(chunks)
}


// ==================== STATE GIVEAWAY (di memori, per grup) ====================
// Disimpan di memori aja (bukan file), jadi kalau bot restart giveaway yang
// sedang berjalan otomatis hilang & perlu dimulai ulang dengan .ga.
// Struktur: { [jid]: { jumlahPemenang, messageId, participants: { [senderJid]: {id, nama} } } }
const activeGiveaways = {}

// Acak urutan array (Fisher-Yates), dipakai buat undi pemenang
function acakArray(arr) {
   const hasil = [...arr]
   for (let i = hasil.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[hasil[i], hasil[j]] = [hasil[j], hasil[i]]
   }
   return hasil
}

// Coba potong energy sebelum menjalankan fitur berbayar (.tt, .yt, .sticker, dll).
// Kalau energy tidak cukup, otomatis kirim pesan penolakan dan return false.
async function spendEnergy(sock, msg, jid, sender, jumlah, namaFitur) {
   const hasil = useEnergy(sender, jumlah)
   if (!hasil.success) {
      await sock.sendMessage(
         jid,
         {
            text:
               `🔋 Energy kamu tidak cukup buat pakai ${namaFitur} (butuh ${jumlah}, sisa ${hasil.energy}).\n` +
               `Energy reset otomatis tiap jam 00:00 WIB.`,
         },
         { quoted: msg }
      )
      return false
   }
   return true
}

// Tambahkan command baru di sini.
// level: "member" -> bisa dipakai siapa saja
// level: "admin"  -> hanya admin grup yang bisa pakai (di chat pribadi otomatis ditolak)
// desc            -> penjelasan singkat, dipakai di .menu dan .help
// usage           -> contoh cara pakai, dipakai di .help
// Setiap "run" menerima: (sock, msg, args, jid, sender)
//   sock   = koneksi whatsapp (lenwy)
//   msg    = pesan mentah dari baileys
//   args   = array kata setelah nama command, misal ".ban budi" -> args = ["budi"]
//   jid    = id chat/grup pengirim (buat balas ke chat yang sama)
//   sender = id pengirim asli pesan (penting dipakai di grup)
const commands = {
   // ---------- COMMAND MEMBER (semua orang boleh pakai) ----------
   ping: {
      level: "member",
      desc: "Cek kecepatan respon bot (ping dalam ms)",
      usage: ".ping",
      run: async (sock, msg, args, jid) => {
         const start = Date.now()
         const sent = await sock.sendMessage(jid, { text: "🏓 Pong!" }, { quoted: msg })
         const latency = Date.now() - start
         // Edit pesan yang sama biar hasilnya rapi jadi 1 pesan aja
         await sock.sendMessage(jid, { text: `🏓 Pong! ${latency}ms`, edit: sent.key })
      },
   },

   menu: {
      level: "member",
      desc: "Tampilkan daftar semua command (ringkas)",
      usage: ".menu",
      run: async (sock, msg, args, jid) => {
         const memberList = Object.entries(commands)
            .filter(([, c]) => c.level === "member")
            .map(([name, c]) => `• ${prefix}${name} - ${c.desc}`)
            .join("\n")
         const adminList = Object.entries(commands)
            .filter(([, c]) => c.level === "admin")
            .map(([name, c]) => `• ${prefix}${name} - ${c.desc}`)
            .join("\n")

         const teks =
            `📜 *Command Member:*\n${memberList}\n\n` +
            `🛡️ *Command Admin (khusus admin grup):*\n${adminList}\n\n` +
            `ℹ️ Ketik ${prefix}help <nama command> buat penjelasan lengkap. Contoh: ${prefix}help tt`

         await sock.sendMessage(jid, { text: teks }, { quoted: msg })
      },
   },

   help: {
      level: "member",
      desc: "Penjelasan lengkap satu command, atau semua command kalau tanpa argumen",
      usage: ".help <nama command>",
      run: async (sock, msg, args, jid) => {
         const target = args[0]?.toLowerCase()

         // Tanpa argumen -> tampilkan penjelasan lengkap semua command
         if (!target) {
            const semua = Object.entries(commands)
               .map(([name, c]) => {
                  const label = c.level === "admin" ? "🛡️ admin" : "👤 member"
                  return `*${prefix}${name}* (${label})\n${c.desc}\nContoh: ${c.usage}`
               })
               .join("\n\n")

            await sock.sendMessage(
               jid,
               { text: `📖 *Penjelasan Semua Command:*\n\n${semua}` },
               { quoted: msg }
            )
            return
         }

         // Dengan argumen -> tampilkan penjelasan 1 command spesifik
         const command = commands[target]
         if (!command) {
            await sock.sendMessage(
               jid,
               { text: `❓ Command "${target}" tidak ditemukan. Ketik ${prefix}menu buat lihat daftar command.` },
               { quoted: msg }
            )
            return
         }

         const label = command.level === "admin" ? "🛡️ Khusus admin grup" : "👤 Bisa dipakai semua orang"
         const teks =
            `*${prefix}${target}*\n` +
            `${label}\n\n` +
            `📌 Penjelasan: ${command.desc}\n` +
            `💡 Contoh pakai: ${command.usage}`

         await sock.sendMessage(jid, { text: teks }, { quoted: msg })
      },
   },

   reg: {
      level: "member",
      desc: "Registrasi diri sebelum bisa pakai command lain",
      usage: ".reg <ID> <nama> — contoh: .reg 1234 Budi Santoso",
      run: async (sock, msg, args, jid, sender) => {
         const id = args[0]
         const nama = args.slice(1).join(" ")

         if (!id || !nama) {
            await sock.sendMessage(
               jid,
               { text: `⚠️ Format salah. Contoh: ${prefix}reg 1234 Budi Santoso` },
               { quoted: msg }
            )
            return
         }

         if (isRegistered(sender)) {
            const user = getUser(sender)
            await sock.sendMessage(
               jid,
               { text: `ℹ️ Kamu sudah terdaftar sebagai:\nID: ${user.id}\nNama: ${user.nama}` },
               { quoted: msg }
            )
            return
         }

         registerUser(sender, id, nama)
         await sock.sendMessage(
            jid,
            { text: `✅ Registrasi berhasil!\nID: ${id}\nNama: ${nama}\n\nSekarang kamu sudah bisa pakai semua command. Ketik ${prefix}menu buat lihat daftarnya.` },
            { quoted: msg }
         )
      },
   },

   profil: {
      level: "member",
      desc: "Lihat profil sendiri (ID, nama, energy)",
      usage: ".profil",
      run: async (sock, msg, args, jid, sender) => {
         const user = getProfile(sender)
         if (!user) {
            await sock.sendMessage(jid, { text: `⚠️ Kamu belum registrasi. Ketik ${prefix}reg dulu.` }, { quoted: msg })
            return
         }

         await sock.sendMessage(
            jid,
            {
               text:
                  `👤 *Profil Kamu*\n\n` +
                  `ID: ${user.id}\n` +
                  `Nama: ${user.nama}\n` +
                  `🔋 Energy: ${user.energy}/30\n\n` +
                  `Energy reset otomatis tiap jam 00:00 WIB.`,
            },
            { quoted: msg }
         )
      },
   },

   updateprofil: {
      level: "member",
      desc: "Update ID & nama profil kamu (energy tidak berubah)",
      usage: ".updateprofil <ID> <nama> — contoh: .updateprofil 5678 Budi Santoso Baru",
      run: async (sock, msg, args, jid, sender) => {
         const id = args[0]
         const nama = args.slice(1).join(" ")

         if (!id || !nama) {
            await sock.sendMessage(
               jid,
               { text: `⚠️ Format salah. Contoh: ${prefix}updateprofil 5678 Budi Santoso Baru` },
               { quoted: msg }
            )
            return
         }

         const updated = updateProfile(sender, id, nama)
         if (!updated) {
            await sock.sendMessage(jid, { text: `⚠️ Kamu belum registrasi. Ketik ${prefix}reg dulu.` }, { quoted: msg })
            return
         }

         await sock.sendMessage(
            jid,
            { text: `✅ Profil berhasil diupdate!\nID: ${id}\nNama: ${nama}` },
            { quoted: msg }
         )
      },
   },

   cekprofil: {
      level: "admin",
      desc: "Cek profil orang lain (ID, nama, energy) dengan tag atau reply pesannya",
      usage: "Tag/mention atau reply pesan orangnya, lalu ketik .cekprofil",
      run: async (sock, msg, args, jid) => {
         const target =
            msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
            msg.message?.extendedTextMessage?.contextInfo?.participant

         if (!target) {
            await sock.sendMessage(
               jid,
               { text: "⚠️ Tag/mention orangnya atau reply pesan orang itu, lalu ketik .cekprofil" },
               { quoted: msg }
            )
            return
         }

         const user = getProfile(target)
         if (!user) {
            await sock.sendMessage(
               jid,
               { text: `⚠️ Orang itu belum registrasi (@${target.split("@")[0]}).`, mentions: [target] },
               { quoted: msg }
            )
            return
         }

         await sock.sendMessage(
            jid,
            {
               text:
                  `👤 *Profil @${target.split("@")[0]}*\n\n` +
                  `ID: ${user.id}\n` +
                  `Nama: ${user.nama}\n` +
                  `🔋 Energy: ${user.energy}/30`,
               mentions: [target],
            },
            { quoted: msg }
         )
      },
   },

   info: {
      level: "member",
      desc: "Info singkat tentang bot ini",
      usage: ".info",
      run: async (sock, msg, args, jid) => {
         await sock.sendMessage(
            jid,
            { text: "🤖 Bot WA ini dibuat pakai baileys." },
            { quoted: msg }
         )
      },
   },

   // Download video TikTok tanpa watermark
   tt: {
      level: "member",
      desc: "Download video TikTok tanpa watermark (7 energy)",
      usage: ".tt <link tiktok>",
      run: async (sock, msg, args, jid, sender) => {
         const url = args[0]

         if (!url || !url.includes("tiktok.com")) {
            await sock.sendMessage(
               jid,
               { text: "⚠️ Kirim link TikTok-nya. Contoh:\n.tt https://vt.tiktok.com/xxxxx" },
               { quoted: msg }
            )
            return
         }

         if (!(await spendEnergy(sock, msg, jid, sender, 7, ".tt"))) return

         await sock.sendMessage(jid, { text: "⏳ Sedang download video..." }, { quoted: msg })

         try {
            const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`
            const res = await fetch(apiUrl)
            const json = await res.json()

            if (json.code !== 0 || !json.data?.play) {
               await sock.sendMessage(
                  jid,
                  { text: "❌ Gagal ambil video. Cek lagi link-nya atau coba beberapa saat lagi." },
                  { quoted: msg }
               )
               return
            }

            const videoUrl = json.data.play // link video tanpa watermark
            const caption = json.data.title || "Download TikTok tanpa watermark"

            await sock.sendMessage(
               jid,
               { video: { url: videoUrl }, caption },
               { quoted: msg }
            )
         } catch (err) {
            console.log(chalk.red(`❌ Error command tt: ${err.message}`))
            await sock.sendMessage(
               jid,
               { text: "❌ Terjadi error saat download video. Coba lagi nanti." },
               { quoted: msg }
            )
         }
      },
   },

   // Download audio/musik dari video TikTok (mp3)
   ttmp3: {
      level: "member",
      desc: "Download audio/musik dari video TikTok (mp3) (5 energy)",
      usage: ".ttmp3 <link tiktok>",
      run: async (sock, msg, args, jid, sender) => {
         const url = args[0]

         if (!url || !url.includes("tiktok.com")) {
            await sock.sendMessage(
               jid,
               { text: "⚠️ Kirim link TikTok-nya. Contoh:\n.ttmp3 https://vt.tiktok.com/xxxxx" },
               { quoted: msg }
            )
            return
         }

         if (!(await spendEnergy(sock, msg, jid, sender, 5, ".ttmp3"))) return

         await sock.sendMessage(jid, { text: "⏳ Sedang download audio..." }, { quoted: msg })

         try {
            const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`
            const res = await fetch(apiUrl)
            const json = await res.json()

            if (json.code !== 0 || !json.data?.music) {
               await sock.sendMessage(
                  jid,
                  { text: "❌ Gagal ambil audio. Cek lagi link-nya atau coba beberapa saat lagi." },
                  { quoted: msg }
               )
               return
            }

            const audioUrl = json.data.music
            const judul = json.data.title || "Audio TikTok"

            await sock.sendMessage(
               jid,
               { audio: { url: audioUrl }, mimetype: "audio/mpeg", fileName: `${judul}.mp3` },
               { quoted: msg }
            )
         } catch (err) {
            console.log(chalk.red(`❌ Error command ttmp3: ${err.message}`))
            await sock.sendMessage(
               jid,
               { text: "❌ Terjadi error saat download audio. Coba lagi nanti." },
               { quoted: msg }
            )
         }
      },
   },

   // Download video YouTube
   yt: {
      level: "member",
      desc: "Download video YouTube (coba gratis dulu via ytdl-core, fallback ke SocialKit) (10 energy)",
      usage: ".yt <link youtube>",
      run: async (sock, msg, args, jid, sender) => {
         const url = args[0]
         const videoId = url ? extractYoutubeId(url) : null

         if (!videoId) {
            await sock.sendMessage(
               jid,
               { text: "⚠️ Kirim link YouTube-nya. Contoh:\n.yt https://youtu.be/xxxxx" },
               { quoted: msg }
            )
            return
         }

         if (!(await spendEnergy(sock, msg, jid, sender, 10, ".yt"))) return

         await sock.sendMessage(jid, { text: "⏳ Sedang download video..." }, { quoted: msg })

         // ---- Percobaan 1: ytdl-core (gratis, tanpa kuota, tapi rawan gagal) ----
         try {
            const fullUrl = `https://youtu.be/${videoId}`
            const info = await ytdl.getInfo(fullUrl)
            const format = ytdl.chooseFormat(info.formats, { filter: "audioandvideo", quality: "lowest" })

            if (format?.url) {
               await sock.sendMessage(
                  jid,
                  { video: { url: format.url }, caption: info.videoDetails.title },
                  { quoted: msg }
               )
               return // berhasil, tidak perlu lanjut ke SocialKit
            }
         } catch (err) {
            console.log(chalk.yellow(`⚠️ ytdl-core gagal (yt), fallback ke SocialKit: ${err.message}`))
         }

         // ---- Percobaan 2: fallback ke SocialKit ----
         if (SOCIALKIT_API_KEY.startsWith("ISI_")) {
            await sock.sendMessage(
               jid,
               { text: "❌ Gagal download video (ytdl-core error, dan SocialKit belum dikonfigurasi)." },
               { quoted: msg }
            )
            return
         }

         try {
            const res = await fetch("https://api.socialkit.dev/youtube/download", {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify({
                  access_key: SOCIALKIT_API_KEY,
                  url: `https://youtu.be/${videoId}`,
                  format: "mp4",
                  quality: "360p",
               }),
            })
            const json = await res.json()

            if (!json.success || !json.data?.downloadUrl) {
               console.log(chalk.red(`❌ SocialKit error (yt): ${json.error || JSON.stringify(json)}`))
               await sock.sendMessage(
                  jid,
                  { text: "❌ Gagal download video. Cek lagi link-nya, atau kuota API sudah habis." },
                  { quoted: msg }
               )
               return
            }

            await sock.sendMessage(
               jid,
               { video: { url: json.data.downloadUrl }, caption: json.data.title || "Video YouTube" },
               { quoted: msg }
            )
         } catch (err) {
            console.log(chalk.red(`❌ Error command yt: ${err.message}`))
            await sock.sendMessage(
               jid,
               { text: "❌ Terjadi error saat download video. Coba lagi nanti." },
               { quoted: msg }
            )
         }
      },
   },

   // Download audio dari YouTube
   ytmp3: {
      level: "member",
      desc: "Download audio dari video YouTube (coba gratis dulu via ytdl-core, fallback ke SocialKit) (8 energy)",
      usage: ".ytmp3 <link youtube>",
      run: async (sock, msg, args, jid, sender) => {
         const url = args[0]
         const videoId = url ? extractYoutubeId(url) : null

         if (!videoId) {
            await sock.sendMessage(
               jid,
               { text: "⚠️ Kirim link YouTube-nya. Contoh:\n.ytmp3 https://youtu.be/xxxxx" },
               { quoted: msg }
            )
            return
         }

         if (!(await spendEnergy(sock, msg, jid, sender, 8, ".ytmp3"))) return

         await sock.sendMessage(jid, { text: "⏳ Sedang ambil audio..." }, { quoted: msg })

         // ---- Percobaan 1: ytdl-core (gratis, tanpa kuota, tapi rawan gagal) ----
         try {
            const fullUrl = `https://youtu.be/${videoId}`
            const info = await ytdl.getInfo(fullUrl)
            const format = ytdl.chooseFormat(info.formats, { filter: "audioonly", quality: "highestaudio" })

            if (format?.url) {
               await sock.sendMessage(
                  jid,
                  {
                     audio: { url: format.url },
                     mimetype: "audio/mp4",
                     fileName: `${info.videoDetails.title}.m4a`,
                  },
                  { quoted: msg }
               )
               return // berhasil, tidak perlu lanjut ke SocialKit
            }
         } catch (err) {
            console.log(chalk.yellow(`⚠️ ytdl-core gagal (ytmp3), fallback ke SocialKit: ${err.message}`))
         }

         // ---- Percobaan 2: fallback ke SocialKit ----
         if (SOCIALKIT_API_KEY.startsWith("ISI_")) {
            await sock.sendMessage(
               jid,
               { text: "❌ Gagal ambil audio (ytdl-core error, dan SocialKit belum dikonfigurasi)." },
               { quoted: msg }
            )
            return
         }

         try {
            const res = await fetch("https://api.socialkit.dev/youtube/download", {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify({
                  access_key: SOCIALKIT_API_KEY,
                  url: `https://youtu.be/${videoId}`,
                  format: "mp3",
               }),
            })
            const json = await res.json()

            if (!json.success || !json.data?.downloadUrl) {
               console.log(chalk.red(`❌ SocialKit error (ytmp3): ${json.error || JSON.stringify(json)}`))
               await sock.sendMessage(
                  jid,
                  { text: "❌ Gagal ambil audio. Cek lagi link-nya, atau kuota API sudah habis." },
                  { quoted: msg }
               )
               return
            }

            const judul = json.data.title || "Audio YouTube"
            await sock.sendMessage(
               jid,
               { audio: { url: json.data.downloadUrl }, mimetype: "audio/mpeg", fileName: `${judul}.mp3` },
               { quoted: msg }
            )
         } catch (err) {
            console.log(chalk.red(`❌ Error command ytmp3: ${err.message}`))
            await sock.sendMessage(
               jid,
               { text: "❌ Terjadi error saat ambil audio. Coba lagi nanti." },
               { quoted: msg }
            )
         }
      },
   },

   // Buat stiker dari gambar
   // Bisa dipakai 2 cara:
   // 1. Kirim gambar dengan caption ".sticker"
   // 2. Reply/quote gambar yang sudah ada di chat, lalu ketik ".sticker"
   sticker: {
      level: "member",
      desc: "Ubah gambar jadi stiker WA (kirim gambar dengan caption .sticker, atau reply gambar lalu ketik .sticker) (2 energy)",
      usage: ".sticker (kirim/reply gambar)",
      run: async (sock, msg, args, jid, sender) => {
         // Cari gambar: dari pesan ini langsung, atau dari pesan yang di-reply/quote
         const imageMsg =
            msg.message?.imageMessage ||
            msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage

         if (!imageMsg) {
            await sock.sendMessage(
               jid,
               {
                  text:
                     "⚠️ Kirim gambar dengan caption .sticker, atau reply sebuah gambar lalu ketik .sticker",
               },
               { quoted: msg }
            )
            return
         }

         if (!(await spendEnergy(sock, msg, jid, sender, 2, ".sticker"))) return

         await sock.sendMessage(jid, { text: "⏳ Sedang buat stiker..." }, { quoted: msg })

         try {
            // Download gambar dari WhatsApp
            const stream = await downloadContentFromMessage(imageMsg, "image")
            const buffer = await streamToBuffer(stream)

            // Konversi ke format webp (format resmi stiker WA), ukuran dipas-kan 512x512
            const stickerBuffer = await sharp(buffer)
               .resize(512, 512, {
                  fit: "contain",
                  background: { r: 0, g: 0, b: 0, alpha: 0 }, // background transparan
               })
               .webp()
               .toBuffer()

            await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg })
         } catch (err) {
            console.log(chalk.red(`❌ Error command sticker: ${err.message}`))
            await sock.sendMessage(
               jid,
               { text: "❌ Terjadi error saat buat stiker. Coba lagi nanti." },
               { quoted: msg }
            )
         }
      },
   },

   // Pencarian Google
   src: {
      level: "member",
      desc: "Cari sesuatu di Google, tampilkan 5 hasil teratas",
      usage: ".src <kata kunci>",
      run: async (sock, msg, args, jid) => {
         const query = args.join(" ")

         if (!query) {
            await sock.sendMessage(
               jid,
               { text: `⚠️ Kirim kata kuncinya. Contoh:\n${prefix}src cara membuat kopi susu` },
               { quoted: msg }
            )
            return
         }

         if (GOOGLE_API_KEY.startsWith("ISI_") || GOOGLE_CX.startsWith("ISI_")) {
            await sock.sendMessage(
               jid,
               { text: "⚠️ Fitur pencarian belum dikonfigurasi. Isi GOOGLE_API_KEY dan GOOGLE_CX di file config.js dulu." },
               { quoted: msg }
            )
            return
         }

         await sock.sendMessage(jid, { text: "🔍 Sedang mencari..." }, { quoted: msg })

         try {
            const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}`
            const res = await fetch(apiUrl)
            const json = await res.json()

            if (json.error) {
               console.log(chalk.red(`❌ Google API error: ${json.error.message}`))
               await sock.sendMessage(
                  jid,
                  { text: "❌ Gagal mencari. Kemungkinan API key/CX salah atau kuota harian habis (limit gratis: 100/hari)." },
                  { quoted: msg }
               )
               return
            }

            const items = json.items?.slice(0, 5)
            if (!items || items.length === 0) {
               await sock.sendMessage(jid, { text: `❌ Tidak ada hasil untuk "${query}".` }, { quoted: msg })
               return
            }

            const teks = items
               .map((item, i) => `${i + 1}. *${item.title}*\n${item.link}\n${item.snippet || ""}`)
               .join("\n\n")

            await sock.sendMessage(
               jid,
               { text: `🔍 *Hasil pencarian "${query}":*\n\n${teks}` },
               { quoted: msg }
            )
         } catch (err) {
            console.log(chalk.red(`❌ Error command src: ${err.message}`))
            await sock.sendMessage(jid, { text: "❌ Terjadi error saat mencari. Coba lagi nanti." }, { quoted: msg })
         }
      },
   },

   // Contoh command yang pakai argumen
   echo: {
      level: "member",
      desc: "Bot mengulang balik teks yang kamu kirim",
      usage: ".echo <teks>",
      run: async (sock, msg, args, jid) => {
         const teks = args.join(" ") || "(kamu belum kirim teks apa-apa)"
         await sock.sendMessage(jid, { text: teks }, { quoted: msg })
      },
   },

   // ---------- COMMAND ADMIN (hanya admin grup) ----------
   del: {
      level: "admin",
      desc: "Hapus pesan yang di-reply/quote",
      usage: "Reply pesan yang mau dihapus lalu ketik .del",
      run: async (sock, msg, args, jid) => {
         const quoted = msg.message?.extendedTextMessage?.contextInfo
         if (!quoted?.stanzaId) {
            await sock.sendMessage(jid, { text: "⚠️ Reply/quote pesan yang mau dihapus dulu." }, { quoted: msg })
            return
         }
         await sock.sendMessage(jid, {
            delete: {
               remoteJid: jid,
               id: quoted.stanzaId,
               participant: quoted.participant,
            },
         })
      },
   },

   kick: {
      level: "admin",
      desc: "Keluarkan member dari grup (bot juga harus jadi admin)",
      usage: "Tag/mention orang yang mau dikeluarkan lalu ketik .kick",
      run: async (sock, msg, args, jid) => {
         const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
         if (!target) {
            await sock.sendMessage(jid, { text: "⚠️ Tag/mention orang yang mau dikeluarkan." }, { quoted: msg })
            return
         }
         await sock.groupParticipantsUpdate(jid, [target], "remove")
      },
   },

   lock: {
      level: "admin",
      desc: "Kunci grup, cuma admin yang bisa kirim pesan",
      usage: ".lock",
      run: async (sock, msg, args, jid) => {
         await sock.groupSettingUpdate(jid, "announcement")
         await sock.sendMessage(jid, { text: "🔒 Grup dikunci, cuma admin yang bisa kirim pesan." }, { quoted: msg })
      },
   },

   unlock: {
      level: "admin",
      desc: "Buka kunci grup, semua member bisa kirim pesan lagi",
      usage: ".unlock",
      run: async (sock, msg, args, jid) => {
         await sock.groupSettingUpdate(jid, "not_announcement")
         await sock.sendMessage(jid, { text: "🔓 Grup dibuka, semua member bisa kirim pesan lagi." }, { quoted: msg })
      },
   },

   antilink: {
      level: "admin",
      desc: "Nyalakan/matikan proteksi anti-link (hapus otomatis link grup WA lain)",
      usage: ".antilink on / .antilink off",
      run: async (sock, msg, args, jid) => {
         if (!jid.endsWith("@g.us")) {
            await sock.sendMessage(jid, { text: "⚠️ Command ini cuma bisa dipakai di grup." }, { quoted: msg })
            return
         }

         const mode = args[0]?.toLowerCase()
         if (mode !== "on" && mode !== "off") {
            await sock.sendMessage(
               jid,
               { text: `⚠️ Format salah. Pakai:\n${prefix}antilink on\n${prefix}antilink off` },
               { quoted: msg }
            )
            return
         }

         setAntilink(jid, mode === "on")
         await sock.sendMessage(
            jid,
            {
               text:
                  mode === "on"
                     ? "🛡️ Anti-link diaktifkan. Link grup WA lain akan otomatis dihapus (link grup ini sendiri tetap boleh)."
                     : "🛡️ Anti-link dimatikan.",
            },
            { quoted: msg }
         )
      },
   },

   ga: {
      level: "admin",
      desc: "Mulai giveaway, admin tentukan jumlah pemenang",
      usage: ".ga <jumlah pemenang> — contoh: .ga 4",
      run: async (sock, msg, args, jid) => {
         if (!jid.endsWith("@g.us")) {
            await sock.sendMessage(jid, { text: "⚠️ Command ini cuma bisa dipakai di grup." }, { quoted: msg })
            return
         }

         const jumlah = parseInt(args[0])
         if (!jumlah || jumlah < 1) {
            await sock.sendMessage(
               jid,
               { text: `⚠️ Format salah. Contoh: ${prefix}ga 4` },
               { quoted: msg }
            )
            return
         }

         if (activeGiveaways[jid]) {
            await sock.sendMessage(
               jid,
               { text: `⚠️ Sudah ada giveaway yang sedang berjalan di grup ini. Akhiri dulu pakai ${prefix}gastart.` },
               { quoted: msg }
            )
            return
         }

         const sent = await sock.sendMessage(jid, {
            text:
               `🎉 *GIVEAWAY DIMULAI!*\n\n` +
               `Admin akan memilih *${jumlah} orang* sebagai pemenang.\n\n` +
               `Mau ikutan? *Reply pesan ini* dengan ${prefix}ikut\n\n` +
               `Peserta saat ini: belum ada`,
         })

         activeGiveaways[jid] = {
            jumlahPemenang: jumlah,
            messageId: sent.key.id,
            participants: {},
         }
      },
   },

   ikut: {
      level: "member",
      desc: "Ikut giveaway yang sedang berjalan (reply pesan giveaway-nya)",
      usage: "Reply pesan giveaway yang aktif, lalu ketik .ikut",
      run: async (sock, msg, args, jid, sender) => {
         const giveaway = activeGiveaways[jid]
         const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId

         if (!giveaway || quotedId !== giveaway.messageId) {
            await sock.sendMessage(
               jid,
               { text: "❌ Tidak ada giveaway aktif untuk pesan itu. Reply pesan giveaway yang sedang berjalan." },
               { quoted: msg }
            )
            return
         }

         if (giveaway.participants[sender]) {
            await sock.sendMessage(jid, { text: "ℹ️ Kamu sudah ikut giveaway ini." }, { quoted: msg })
            return
         }

         const user = getProfile(sender)
         if (!user) {
            await sock.sendMessage(jid, { text: `⚠️ Kamu belum registrasi. Ketik ${prefix}reg dulu.` }, { quoted: msg })
            return
         }

         giveaway.participants[sender] = { id: user.id, nama: user.nama }

         const daftarPeserta = Object.values(giveaway.participants)
            .map((p, i) => `${i + 1}. ID: ${p.id} - Nama: ${p.nama}`)
            .join("\n")

         await sock.sendMessage(jid, {
            text:
               `📋 *Update Peserta Giveaway*\n` +
               `Pemenang yang akan dipilih: ${giveaway.jumlahPemenang} orang\n\n` +
               `Peserta (${Object.keys(giveaway.participants).length}):\n${daftarPeserta}`,
         })
      },
   },

   gastart: {
      level: "admin",
      desc: "Tutup pendaftaran giveaway & undi pemenang secara acak",
      usage: ".gastart",
      run: async (sock, msg, args, jid) => {
         const giveaway = activeGiveaways[jid]
         if (!giveaway) {
            await sock.sendMessage(jid, { text: "⚠️ Tidak ada giveaway aktif di grup ini." }, { quoted: msg })
            return
         }

         const pesertaEntries = Object.entries(giveaway.participants) // [senderJid, {id, nama}][]

         if (pesertaEntries.length === 0) {
            await sock.sendMessage(jid, { text: "⚠️ Tidak ada peserta yang ikut, giveaway dibatalkan." }, { quoted: msg })
            delete activeGiveaways[jid]
            return
         }

         const teracak = acakArray(pesertaEntries)
         const pemenang = teracak.slice(0, giveaway.jumlahPemenang)

         const daftarPemenang = pemenang
            .map(([senderJid, p], i) => `${i + 1}. ID: ${p.id} - Nama: ${p.nama} (@${senderJid.split("@")[0]})`)
            .join("\n")

         const catatanKurang =
            pesertaEntries.length < giveaway.jumlahPemenang
               ? `\n\n⚠️ Peserta cuma ${pesertaEntries.length} orang (kurang dari target ${giveaway.jumlahPemenang}), jadi semua peserta otomatis menang.`
               : ""

         await sock.sendMessage(jid, {
            text: `🏆 *PEMENANG GIVEAWAY!*\n\n${daftarPemenang}${catatanKurang}\n\nSelamat! 🎉`,
            mentions: pemenang.map(([senderJid]) => senderJid),
         })

         delete activeGiveaways[jid]
      },
   },
}

// ==================== FUNGSI UTAMA HANDLER ====================
// Dipanggil dari index.js setiap ada pesan masuk
export async function handleMessage(sock, msg) {
   // Lewati kalau bukan pesan biasa atau berasal dari bot sendiri
   if (!msg.message || msg.key.fromMe) return

   const jid = msg.key.remoteJid
   // Di grup, pengirim asli ada di participant. Di chat pribadi, sender = jid itu sendiri.
   const sender = msg.key.participant || msg.key.remoteJid

   // Ambil teks dari berbagai kemungkinan tipe pesan
   const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      ""

   if (!text) return

   console.log(chalk.gray(`📩 Pesan dari ${sender} di ${jid}: ${text}`))

   // ---- Anti-link: hapus pesan yang mengandung link grup WA lain ----
   if (jid.endsWith("@g.us") && isAntilinkEnabled(jid)) {
      const linkMatch = text.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/i)

      if (linkMatch) {
         const admin = await isSenderAdmin(sock, jid, sender)

         if (!admin) {
            let isOwnGroupLink = false
            try {
               // Cek apakah link yang dikirim itu link grup INI sendiri (boleh) atau grup lain (tidak boleh)
               const ownCode = await sock.groupInviteCode(jid)
               isOwnGroupLink = linkMatch[1] === ownCode
            } catch {
               // Kalau gagal ambil invite code (bot bukan admin), anggap bukan link grup sendiri -> tetap diblokir
               isOwnGroupLink = false
            }

            if (!isOwnGroupLink) {
               try {
                  await sock.sendMessage(jid, {
                     delete: {
                        remoteJid: jid,
                        id: msg.key.id,
                        participant: msg.key.participant,
                        fromMe: false,
                     },
                  })
               } catch (err) {
                  console.log(chalk.red(`❌ Gagal hapus pesan anti-link: ${err.message}`))
               }

               await sock.sendMessage(jid, {
                  text: `🚫 @${sender.split("@")[0]} dilarang share link grup lain di sini!`,
                  mentions: [sender],
               })
               return
            }
         }
      }
   }

   const isRegCommand = text.toLowerCase().startsWith(`${prefix}reg`)

   // ---- Kalau pengirim belum registrasi, tegur di SETIAP pesan yang dia kirim ----
   // (kecuali dia sedang mencoba registrasi lewat .reg)
   if (!isRegCommand && !isRegistered(sender)) {
      await sock.sendMessage(
         jid,
         {
            text:
               `🚫 Kamu belum registrasi, jadi bot tidak akan merespon pesanmu.\n` +
               `Daftar dulu ya dengan format:\n` +
               `${prefix}reg <ID> <nama>\n\n` +
               `Contoh: ${prefix}reg 1234 Budi Santoso`,
         },
         { quoted: msg }
      )
      return
   }

   // ---- Cek apakah ini command (diawali prefix) ----
   if (!text.startsWith(prefix)) return

   const [rawCmd, ...args] = text.slice(prefix.length).trim().split(/\s+/)
   const cmd = rawCmd.toLowerCase()
   const command = commands[cmd]

   if (!command) {
      await sock.sendMessage(jid, { text: `❓ Command tidak dikenal. Ketik ${prefix}menu` }, { quoted: msg })
      return
   }

   // ---- Kalau command butuh admin, cek dulu ----
   if (command.level === "admin") {
      const admin = await isSenderAdmin(sock, jid, sender)
      if (!admin) {
         await sock.sendMessage(
            jid,
            { text: "🚫 Command ini cuma bisa dipakai admin grup." },
            { quoted: msg }
         )
         return
      }
   }

   try {
      await command.run(sock, msg, args, jid, sender)
   } catch (err) {
      console.log(chalk.red(`❌ Error di command ${cmd}: ${err.message}`))
      await sock.sendMessage(jid, { text: "⚠️ Terjadi error saat menjalankan command." }, { quoted: msg })
   }
}

// ==================== WELCOME MESSAGE ====================
// Dipanggil dari index.js setiap ada perubahan anggota grup (masuk/keluar).
// Cuma kirim pesan sambutan waktu ada yang BARU MASUK ("add").
export async function handleGroupParticipantsUpdate(sock, update) {
   try {
      if (update.action !== "add") return

      const groupMetadata = await sock.groupMetadata(update.id)
      const namaGrup = groupMetadata.subject

      for (const participant of update.participants) {
         await sock.sendMessage(update.id, {
            text:
               `👋 Selamat datang @${participant.split("@")[0]} di grup *${namaGrup}*!\n\n` +
               `Yuk kenalan dulu, ketik ${prefix}reg <ID> <nama> buat registrasi.\n` +
               `Ketik ${prefix}menu buat lihat semua command yang tersedia.`,
            mentions: [participant],
         })
      }
   } catch (err) {
      console.log(chalk.red(`❌ Error welcome message: ${err.message}`))
   }
}
