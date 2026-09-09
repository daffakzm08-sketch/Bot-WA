import chalk from "chalk"
import { downloadContentFromMessage } from "@whiskeysockets/baileys"
import sharp from "sharp"
import ytdl from "@distube/ytdl-core"
import { isRegistered, getUser, registerUser, isAntilinkEnabled, setAntilink } from "./db.js"

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

// ==================== BANTUAN DOWNLOAD MEDIA ====================
// Mengubah stream media (gambar/video/dll dari WA) jadi Buffer utuh
async function streamToBuffer(stream) {
   const chunks = []
   for await (const chunk of stream) {
      chunks.push(chunk)
   }
   return Buffer.concat(chunks)
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
      desc: "Download video TikTok tanpa watermark",
      usage: ".tt <link tiktok>",
      run: async (sock, msg, args, jid) => {
         const url = args[0]

         if (!url || !url.includes("tiktok.com")) {
            await sock.sendMessage(
               jid,
               { text: "⚠️ Kirim link TikTok-nya. Contoh:\n.tt https://vt.tiktok.com/xxxxx" },
               { quoted: msg }
            )
            return
         }

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
      desc: "Download audio/musik dari video TikTok (mp3)",
      usage: ".ttmp3 <link tiktok>",
      run: async (sock, msg, args, jid) => {
         const url = args[0]

         if (!url || !url.includes("tiktok.com")) {
            await sock.sendMessage(
               jid,
               { text: "⚠️ Kirim link TikTok-nya. Contoh:\n.ttmp3 https://vt.tiktok.com/xxxxx" },
               { quoted: msg }
            )
            return
         }

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
      desc: "Download video YouTube (kualitas gabungan video+audio, biasanya 360p)",
      usage: ".yt <link youtube>",
      run: async (sock, msg, args, jid) => {
         const url = args[0]

         if (!url || !ytdl.validateURL(url)) {
            await sock.sendMessage(
               jid,
               { text: "⚠️ Kirim link YouTube-nya. Contoh:\n.yt https://youtu.be/xxxxx" },
               { quoted: msg }
            )
            return
         }

         await sock.sendMessage(jid, { text: "⏳ Sedang download video..." }, { quoted: msg })

         try {
            const info = await ytdl.getInfo(url)
            const judul = info.videoDetails.title

            // Ambil format yang sudah gabungan video+audio (biar tidak perlu ffmpeg buat merge)
            const format = ytdl.chooseFormat(info.formats, { quality: "18" }) // itag 18 = mp4 360p video+audio

            if (!format?.url) {
               await sock.sendMessage(
                  jid,
                  { text: "❌ Format video gabungan tidak ditemukan untuk video ini." },
                  { quoted: msg }
               )
               return
            }

            await sock.sendMessage(
               jid,
               { video: { url: format.url }, caption: judul },
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
      desc: "Download audio dari video YouTube",
      usage: ".ytmp3 <link youtube>",
      run: async (sock, msg, args, jid) => {
         const url = args[0]

         if (!url || !ytdl.validateURL(url)) {
            await sock.sendMessage(
               jid,
               { text: "⚠️ Kirim link YouTube-nya. Contoh:\n.ytmp3 https://youtu.be/xxxxx" },
               { quoted: msg }
            )
            return
         }

         await sock.sendMessage(jid, { text: "⏳ Sedang ambil audio..." }, { quoted: msg })

         try {
            const info = await ytdl.getInfo(url)
            const judul = info.videoDetails.title

            // Ambil format audio-only dengan bitrate terbaik
            const format = ytdl.chooseFormat(info.formats, { filter: "audioonly", quality: "highestaudio" })

            if (!format?.url) {
               await sock.sendMessage(jid, { text: "❌ Gagal ambil audio dari video ini." }, { quoted: msg })
               return
            }

            await sock.sendMessage(
               jid,
               { audio: { url: format.url }, mimetype: "audio/mp4", fileName: `${judul}.m4a` },
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
      desc: "Ubah gambar jadi stiker WA (kirim gambar dengan caption .sticker, atau reply gambar lalu ketik .sticker)",
      usage: ".sticker (kirim/reply gambar)",
      run: async (sock, msg, args, jid) => {
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
