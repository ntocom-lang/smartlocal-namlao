// ตัวช่วยรันตัววาดอินโฟกราฟิกในเบราว์เซอร์จริง (Chrome) — ใช้ทั้งเทสต์และสคริปต์ถ่ายภาพตัวอย่าง
//
// ทำไมต้องรันในเบราว์เซอร์: ตัวตัดบรรทัดวัดความกว้างข้อความด้วย canvas ของเบราว์เซอร์ ถ้าวัดด้วยค่าประมาณใน node
// ภาพที่ได้จริงอาจข้อความล้นขอบโดยเทสต์ไม่เห็น — ต้องวัดของจริง
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// ใช้ vite (ประกาศไว้ใน devDependencies แล้ว) ไม่ใช่ esbuild — esbuild ไม่ได้ประกาศไว้และ npm ls ขึ้น extraneous
// เครื่องที่ npm ci ใหม่จะไม่มี เทสต์ที่พึ่งมันจะล้มโดยไม่มีใครรู้สาเหตุ
import { build } from 'vite'

const ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'infographicEntry.js')

/** รวมโมดูลตัววาด (และไอคอน lucide ที่ใช้) เป็นสคริปต์เดียวเพื่อฉีดเข้าหน้าเบราว์เซอร์ → window.InfoBundle */
export async function bundleInfographic() {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    // ไม่คัดลอกโฟลเดอร์ public/ ลงผลลัพธ์ และไม่เขียนไฟล์ใดลงดิสก์ (write: false)
    publicDir: false,
    // lib mode ไม่แทน process.env.NODE_ENV ให้เอง แต่โค้ดของ React ที่ lucide ดึงมาอ้างถึงมัน
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      write: false,
      minify: false,
      lib: { entry: ENTRY, name: 'InfoBundle', formats: ['iife'], fileName: 'infographic-bundle' },
    },
  })
  const output = (Array.isArray(result) ? result[0] : result).output
  return output.find(chunk => chunk.type === 'chunk').code
}

/**
 * ตัวเลขเดือนเมษายน 2569 ของเทศบาลนครยะลา (จากภาพสรุปที่เทศบาลเผยแพร่เอง): 39 เรื่อง
 * ไฟฟ้า 13 · อื่นๆ 11 · ประปา 7 · ขยะ 7 · โครงสร้างพื้นฐาน 1 · เสร็จ 37 เรื่อง อยู่ระหว่างดำเนินการ 2 เรื่อง
 * ชื่อหมวดใช้ของระบบเรา ไม่ใช่ของยะลา (ยะลาใช้ "โครงสร้างพื้นฐาน" รวมถนน/ทางเท้า/ฝาท่อ)
 */
export const YALA_APRIL = {
  stats: { total: 39, open: 1, in_progress: 1, resolved: 37, rejected: 0, avg_days: null },
  categories: { light: 13, other: 11, water: 7, trash: 7, road: 1 },
  labels: { light: 'ไฟฟ้าสาธารณะ', other: 'อื่นๆ', water: 'น้ำประปา', trash: 'ขยะ/ความสะอาด', road: 'ถนน/ทางสาธารณะ' },
}
