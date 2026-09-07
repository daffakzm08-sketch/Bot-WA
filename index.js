//import Module
const { makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys")
const pino = require("pino")
const chalk = require("chalk")
const readline = require("readline")
const { resolve } = require("path")
const { version } = require("os")

// Metode Pairing
// True = Pairing Code || False = Scan QR
const usePairingCode = true

// promt Input Terminal
async function question(promt) {
   process.stdout.write(promt)
   const r1 = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
   })

   return new Promise((resolve) => r1.question("", (ans) => {
      r1.close()
      resolve(ans)
   }))
}

// Koneksi Whatsapp
async function connectToWhatsApp(){
   console.log(chalk.blue("😆  Memulai koneksi ke wahtsapp"))

   // Meyimpan Sesi Login
   // LenwySesi Menjadi Pyeimpanan Sesi Login
   const { state, saveCreds } = await useMultiFileAuthState("./LenwySesi")

   // Membuat koneksi wahtsapp
   const lenwy = makeWASocket({
      logger: pino({ level: "silent"}),
      printQRInTerminal: !usePairingCode,
      auth: state, // pakai sesi yang ada
      browser: ["Ubuntu", "Chrome", "20.0.04"], // simulasi browser
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