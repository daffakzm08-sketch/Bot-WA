import chalk from "chalk"

// ==================== PREFIX ====================
// Semua command harus diawali karakter ini, misal: !ping
const prefix = "!"

// ==================== DAFTAR COMMAND ====================
// Tambahkan command baru di sini.
// Setiap command menerima: (sock, msg, args, jid)
//   sock = koneksi whatsapp (lenwy)
//   msg  = pesan mentah dari baileys
//   args = array kata setelah nama command, misal "!ban budi" -> args = ["budi"]
//   jid  = id chat/grup pengirim (buat balas ke chat yang sama)
const commands = {
   ping: async (sock, msg, args, jid) => {
      await sock.sendMessage(jid, { text: "🏓 Pong!" }, { quoted: msg })
   },

   menu: async (sock, msg, args, jid) => {
      const daftar = Object.keys(commands)
         .map((cmd) => `• ${prefix}${cmd}`)
         .join("\n")
      await sock.sendMessage(jid, { text: `📜 Daftar Command:\n${daftar}` }, { quoted: msg })
   },

   info: async (sock, msg, args, jid) => {
      await sock.sendMessage(
         jid,
         { text: "🤖 Bot WA ini dibuat pakai baileys." },
         { quoted: msg }
      )
   },

   // Contoh command yang pakai argumen
   // Kirim "!echo halo dunia" -> bot akan balas "halo dunia"
   echo: async (sock, msg, args, jid) => {
      const teks = args.join(" ") || "(kamu belum kirim teks apa-apa)"
      await sock.sendMessage(jid, { text: teks }, { quoted: msg })
   },
}

// ==================== DAFTAR AUTO-REPLY ====================
// Tidak butuh prefix, dicek dari kata kunci di dalam pesan (case-insensitive).
// "match" bisa berisi beberapa kata kunci sekaligus.
const autoReplies = [
   {
      match: ["halo", "hai", "assalamualaikum"],
      reply: "Halo juga! 👋 Ketik !menu buat lihat daftar command.",
   },
   {
      match: ["makasih", "terima kasih"],
      reply: "Sama-sama! 😊",
   },
   {
      match: ["jam berapa"],
      reply: () => `Sekarang jam ${new Date().toLocaleTimeString("id-ID")}`,
   },
]

// ==================== FUNGSI UTAMA HANDLER ====================
// Dipanggil dari index.js setiap ada pesan masuk
export async function handleMessage(sock, msg) {
   // Lewati kalau bukan pesan biasa atau berasal dari bot sendiri
   if (!msg.message || msg.key.fromMe) return

   const jid = msg.key.remoteJid

   // Ambil teks dari berbagai kemungkinan tipe pesan
   const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      ""

   if (!text) return

   console.log(chalk.gray(`📩 Pesan dari ${jid}: ${text}`))

   // ---- Cek apakah ini command (diawali prefix) ----
   if (text.startsWith(prefix)) {
      const [rawCmd, ...args] = text.slice(prefix.length).trim().split(/\s+/)
      const cmd = rawCmd.toLowerCase()

      if (commands[cmd]) {
         try {
            await commands[cmd](sock, msg, args, jid)
         } catch (err) {
            console.log(chalk.red(`❌ Error di command ${cmd}: ${err.message}`))
            await sock.sendMessage(jid, { text: "⚠️ Terjadi error saat menjalankan command." }, { quoted: msg })
         }
      } else {
         await sock.sendMessage(jid, { text: `❓ Command tidak dikenal. Ketik ${prefix}menu` }, { quoted: msg })
      }
      return
   }

   // ---- Kalau bukan command, cek auto-reply ----
   const lowerText = text.toLowerCase()
   for (const item of autoReplies) {
      const cocok = item.match.some((kata) => lowerText.includes(kata))
      if (cocok) {
         const balasan = typeof item.reply === "function" ? item.reply() : item.reply
         await sock.sendMessage(jid, { text: balasan }, { quoted: msg })
         break
      }
   }
}
