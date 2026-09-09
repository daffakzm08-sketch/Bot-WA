import fs from "fs"
import path from "path"

// File tempat data user terdaftar disimpan (format JSON sederhana)
const DB_PATH = path.resolve("./users.json")

// Ambil semua user terdaftar dari file
function loadUsers() {
   if (!fs.existsSync(DB_PATH)) return {}
   try {
      const raw = fs.readFileSync(DB_PATH, "utf-8")
      return JSON.parse(raw)
   } catch (err) {
      console.log("❌ Gagal baca users.json:", err.message)
      return {}
   }
}

// Simpan semua user terdaftar ke file
function saveUsers(users) {
   fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2))
}

// Cek apakah sebuah nomor (jid) sudah terdaftar
export function isRegistered(jid) {
   const users = loadUsers()
   return Boolean(users[jid])
}

// Ambil data user berdasarkan jid, null kalau belum terdaftar
export function getUser(jid) {
   const users = loadUsers()
   return users[jid] || null
}

// Daftarkan user baru. id & nama dari input command .reg
export function registerUser(jid, id, nama) {
   const users = loadUsers()
   users[jid] = {
      id,
      nama,
      registeredAt: new Date().toISOString(),
   }
   saveUsers(users)
   return users[jid]
}

// ==================== ANTI-LINK ====================
const ANTILINK_PATH = path.resolve("./antilink.json")

function loadAntilink() {
   if (!fs.existsSync(ANTILINK_PATH)) return {}
   try {
      return JSON.parse(fs.readFileSync(ANTILINK_PATH, "utf-8"))
   } catch (err) {
      console.log("❌ Gagal baca antilink.json:", err.message)
      return {}
   }
}

function saveAntilink(data) {
   fs.writeFileSync(ANTILINK_PATH, JSON.stringify(data, null, 2))
}

// Cek apakah fitur anti-link aktif di sebuah grup
export function isAntilinkEnabled(jid) {
   const data = loadAntilink()
   return Boolean(data[jid])
}

// Nyalakan/matikan fitur anti-link untuk sebuah grup
export function setAntilink(jid, enabled) {
   const data = loadAntilink()
   data[jid] = enabled
   saveAntilink(data)
}
