// ด่านลินต์เฉพาะกฎที่ "พังจริงบน production" — รันใน cf:deploy ก่อน build
//
// ที่ไม่ใช้ `npm run lint` ทั้งชุดเป็นด่าน เพราะทั้ง repo มี problem อยู่หลักสิบ
// (ส่วนใหญ่ react-hooks/set-state-in-effect กับ exhaustive-deps) ซึ่งเป็นหนี้
// ทางเทคนิคที่ไม่ทำให้หน้าเว็บตาย ถ้าบล็อกทั้งหมดตั้งแต่วันแรก ทุกคนจะพิมพ์
// ALLOW_DIRTY_DEPLOY=1 ทุกครั้งจนด่านไม่มีความหมาย — หลักการเดียวกับที่เขียนไว้
// ใน eslint.config.js ว่าด่านที่ส่งเสียงดังจนไม่มีใครฟังคือด่านที่ไม่มีอยู่จริง
//
// ที่ต้องมีด่านนี้: 2026-08-31 หน้าเว็บ production ขาวทั้งหน้าเพราะ commit หนึ่ง
// ลบ User ออกจาก import ของ lucide-react แต่ JSX ยัง render <User /> อยู่
// vite build ผ่านฉลุย (bundler ไม่ตรวจว่า identifier มีตัวตนไหม) แล้วไปตาย
// ตอน runtime ด้วย "ReferenceError: User is not defined" ส่วน eslint จับได้
// ตั้งแต่แรกด้วย no-undef บรรทัดเดียวเป๊ะ
//
// เกณฑ์เพิ่มกฎเข้ารายการนี้: ผิดกฎนี้แล้วโค้ดต้องพังตอนรันเสมอ ไม่ใช่แค่ "ไม่สวย"
// ถ้าเป็นเรื่องสไตล์หรือ performance ให้อยู่ใน `npm run lint` ตามเดิม

import { ESLint } from 'eslint'

const BLOCKING_RULES = new Set([
  'no-undef',          // ตัวที่ทำให้เกิด incident 2026-08-31
  'no-const-assign',   // TypeError ตอนรัน
  'no-dupe-keys',      // ค่าถูกทับเงียบๆ
  'no-dupe-args',
  'no-dupe-class-members',
  'no-func-assign',
  'no-import-assign',
  'no-obj-calls',      // เรียก object เหมือน function -> TypeError
  'no-unsafe-negation',
  'no-unreachable',
  'no-setter-return',
  'no-class-assign',
  'getter-return',
  'constructor-super',
  'no-this-before-super',
])

const eslint = new ESLint()
const results = await eslint.lintFiles(['.'])

const blocking = []
for (const file of results) {
  for (const msg of file.messages) {
    // fatal = parse error (ruleId เป็น null) ไฟล์นั้น bundle ไม่ได้อยู่แล้ว ต้องบล็อกเสมอ
    if (msg.fatal || BLOCKING_RULES.has(msg.ruleId)) {
      blocking.push({ file: file.filePath, msg })
    }
  }
}

if (blocking.length) {
  console.error(`\n\u274c ลินต์เจอปัญหาที่จะทำให้หน้าเว็บพังตอนรัน ${blocking.length} จุด\n`)
  for (const { file, msg } of blocking) {
    const where = `${file}:${msg.line}:${msg.column}`
    console.error(`   ${where}\n     ${msg.message}  [${msg.ruleId ?? 'parse error'}]`)
  }
  console.error('\n   แก้ให้หมดก่อน deploy — กฎชุดนี้ผิดแล้วพังตอนรันเสมอ ไม่ใช่เรื่องสไตล์')
  console.error('   (ปัญหาลินต์อื่นๆ ที่ไม่ทำให้พัง ดูด้วย `npm run lint`)\n')
  process.exit(1)
}

console.log('\u2705 ผ่านด่านลินต์ — ไม่มี undefined identifier หรือ parse error')
