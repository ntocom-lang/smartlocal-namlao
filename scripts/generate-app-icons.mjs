// สร้างไอคอน PNG สำรองของระบบจาก public/icons/app-icon.svg
//
// รันมือเท่านั้น ไม่ได้อยู่ใน build: ผลลัพธ์ถูก commit ไว้แล้ว คนที่ clone repo มาไม่ต้องรัน
// รันใหม่เมื่อแก้ app-icon.svg เท่านั้น — node scripts/generate-app-icons.mjs
//
// sharp ไม่ได้อยู่ใน dependencies ตรงๆ (ติดมากับ wrangler > miniflare) จึงห้ามให้ build
// หรือ CI ไปพึ่งสคริปต์นี้ ถ้าวันหนึ่ง wrangler เลิกพา sharp มา สคริปต์นี้จะรันไม่ได้
// แต่ไฟล์ PNG ที่ commit ไว้ยังอยู่ครบ ระบบไม่พัง
import { readFile, writeFile } from 'node:fs/promises'

const sharp = (await import('sharp').catch(() => null))?.default
if (!sharp) {
  console.error('ไม่พบ sharp — ติดตั้งชั่วคราวด้วย npm i -D sharp แล้วรันใหม่ (ไฟล์ PNG เดิมยังใช้ได้ตามปกติ)')
  process.exit(1)
}

const svg = await readFile('public/icons/app-icon.svg')

// 192 กับ 512 คือสองขนาดที่ Chrome ใช้ตัดสินว่าเว็บติดตั้งได้ไหม
for (const size of [192, 512]) {
  const png = await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
  await writeFile(`public/icons/icon-${size}x${size}.png`, png)
  console.log(`icon-${size}x${size}.png`, png.length, 'bytes')
}

// badge ของ push notification: Android ระบายสีทับเอง เหลือแค่รูปทรงขาวบนพื้นโปร่ง
const badgeSvg = (await readFile('public/icons/app-icon.svg', 'utf8'))
  .replace('<rect width="512" height="512" rx="112" fill="#1d4ed8"/>', '')
const badge = await sharp(Buffer.from(badgeSvg), { density: 384 })
  .resize(72, 72).png({ compressionLevel: 9 }).toBuffer()
await writeFile('public/icons/icon-72x72.png', badge)
console.log('icon-72x72.png', badge.length, 'bytes')
