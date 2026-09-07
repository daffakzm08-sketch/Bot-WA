// Import Module
const { makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys")
const pino = require("pino")
const chalk = require("chalk")
const readline = require("readline")

// Metode Pairing
// true = Pairing Code || false = Scan QR
const usePairingCode = true

// Prompt Input Terminal
async function question(prompt) {
   process.stdout.write(prompt)
   const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
   })
   return new Promise((resolve) => rl.question("", (ans) => {
      rl.close()
      resolve(ans)
   }))
}

// Koneksi WhatsApp
async function connectToWhatsApp(){
   console.log(chalk.blue("😆 Memulai koneksi ke WhatsApp"))

   // Menyimpan Sesi Login
   const { state, saveCreds } = await useMultiFileAuthState("./LenwySesi")

   // Membuat koneksi WhatsApp
   const sock = makeWASocket({
      logger: pino({ level: "silent"}),
      printQRInTerminal: !usePairingCode,
      auth: state,
      browser: ["Ubuntu", "Chrome", "20.0.04"]
   })

   // Metode Pairing Code
   if (usePairingCode && !sock.authState.creds.registered) {
      console.log(chalk.green("☺️ Masukkan nomor dengan awalan 62"))
      const phoneNumber = await question(">")
      const code = await sock.requestPairingCode(phoneNumber.trim())
      console.log(chalk.cyan(`😇 Pairing code: ${code}`))
   }

   // Menyimpan sesi login
   sock.ev.on("creds.update", saveCreds)

   // Informasi koneksi
   sock.ev.on("connection.update", (update) => {
      const { connection } = update
      if (connection === "close") {
         console.log(chalk.red("❌ Koneksi terputus, mencoba menyambung ulang..."))
         connectToWhatsApp()
      } else if (connection === "open") {
         console.log(chalk.green("✔️ Berhasil terhubung ke WhatsApp"))
      }
   })
}

// Jalankan koneksi WhatsApp
connectToWhatsApp()
      logger: pino({ level: "silent"}),
      printQRInTerminal: !usePairingCode,
      auth: state, // pakai sesi yang ada
      browser: ["Ubuntu", "Chrome", "20.0.04"], // simulasi br
   })

   // metode Pairing Code
   if (usePairingCode && !lenwy.authState.creds.registered) {
      console.log(chalk.green("☺️  masukan nomor dengan awal 62"))
      const phoneNumber = await question(">")
      const code = await lenwy.requestPairingCode(phoneNumber.trim())
      console.log(chalk.cyan(`😇pairin code : ${code}`))
   }

   // menyimpan sesi Login
   lenwy.ev.on("creds.update", saveCreds)

   // Informasi koneksi
   lenwy.ev.on("connection.update", (update) => {
      const {connection, lastDisconnect } = update
      if (connection === "close") {
         console.log(chalk.red("❌ koneksi terputus, Mencoba menyambung ulang"))
         connectToWhatsApp()
      } else if (connection === "open") {
         console.log(chalk.green("✔️ Berhasil terhubung ke whatsapp"))
      }
   })
}

// Jalankan koneksi wahtsapp
connectToWhatsApp()
