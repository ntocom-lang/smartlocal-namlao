// กฎเรียบเรียงข้อความคำร้อง — ตรวจว่าแก้เฉพาะที่ตั้งใจ และไม่ทำข้อความของผู้ร้องเสียหาย
// รันด้วย: node tests/complaint-text-polish.test.mjs
//
// ทำไมต้องมี: ข้อความที่ผู้ร้องกดเลือกจะไหลไปขึ้นใบพิมพ์เสนอผู้บังคับบัญชาและข้อความแจ้งเตือน
// ถ้ากฎกินคำผิดที่ (เช่น ตัด "ครับ" กลางชื่อคน หรือเปลี่ยนคำในบริบทที่ไม่ควร) ความหมายจะเพี้ยน
// โดยไม่มีใครรู้ เพราะผู้ร้องส่วนใหญ่กดเลือกโดยไม่อ่านละเอียด

import assert from 'node:assert/strict'
import {
  COMMON_MISSPELLINGS,
  SPOKEN_TO_FORMAL,
  hasPolishSuggestion,
  polishComplaintText,
} from '../src/lib/complaintTextPolish.js'

const polish = (text) => polishComplaintText(text).polished
const kinds = (text) => polishComplaintText(text).changes.map((c) => c.kind)

// ── ตัวอักษรซ้ำ / อีโมจิ / เครื่องหมาย ─────────────────────────────────────────
assert.equal(polish('ไฟฟ้าดับมากกกกก'), 'ไฟฟ้าดับมาก')
assert.equal(polish('ช่วยด้วย!!!!'), 'ช่วยด้วย!')
assert.equal(polish('น้ำท่วม 😭😭 หน้าบ้าน'), 'น้ำท่วม หน้าบ้าน')
assert.equal(polish('ถนน   เป็น    หลุม'), 'ถนน เป็น หลุม')

// ── คำสะกดผิด ────────────────────────────────────────────────────────────────
assert.equal(polish('ขออนุญาติแจ้งเรื่อง'), 'ขออนุญาตแจ้งเรื่อง')
assert.equal(polish('สังเกตุเห็นน้ำรั่ว'), 'สังเกตเห็นน้ำรั่ว')
assert.ok(kinds('ขออนุญาติ').includes('spelling'))

// ── คำพูด → คำราชการ ─────────────────────────────────────────────────────────
assert.equal(polish('ไฟดับหน้าบ้าน'), 'ไฟฟ้าส่องสว่างสาธารณะดับหน้าบ้าน')
assert.equal(polish('น้ำไม่ไหลมา 3 วัน'), 'น้ำประปาไม่ไหลมา 3 วัน')

// ── คำลงท้าย: ตัดท้ายประโยคเท่านั้น ห้ามกินคำอื่น ─────────────────────────────
assert.equal(polish('ไฟฟ้าส่องสว่างเสีย ครับ'), 'ไฟฟ้าส่องสว่างเสีย')
assert.equal(polish('รบกวนด้วยนะคะ'), 'รบกวนด้วย')
// "คะ" อยู่กลางคำ ("คะแนน") ต้องไม่โดนตัด
assert.equal(polish('ขอให้ตรวจสอบคะแนนภาษี'), 'ขอให้ตรวจสอบคะแนนภาษี')
// ชื่อคนที่มีคำว่า "ครับ" ติดอยู่กลางข้อความต้องไม่หาย
assert.equal(polish('แจ้งแทนนายครับพล ศรีทอง'), 'แจ้งแทนนายครับพล ศรีทอง')

// ── สรรพนาม ─────────────────────────────────────────────────────────────────
assert.equal(polish('ผม อยากแจ้งเรื่องถนน'), 'ข้าพเจ้า อยากแจ้งเรื่องถนน')
// "ผม" ที่เป็นส่วนของคำอื่น (ผมร่วง) ต้องไม่โดนเปลี่ยน
assert.equal(polish('ร้านตัดผมส่งน้ำเสียลงถนน'), 'ร้านตัดผมส่งน้ำเสียลงถนน')

// ── ไม่มีอะไรให้แก้ = ไม่เสนอ ────────────────────────────────────────────────
const clean = 'ขอให้ตรวจสอบและซ่อมแซมฝาท่อระบายน้ำบริเวณปากซอย 5 ซึ่งชำรุดและอาจเกิดอันตราย'
assert.equal(polish(clean), clean)
assert.equal(hasPolishSuggestion(clean), false)
assert.equal(hasPolishSuggestion('ไฟดับครับ'), true)
assert.equal(hasPolishSuggestion(''), false)
assert.equal(hasPolishSuggestion(null), false)

// ── ห้ามคืนข้อความว่างให้ส่งแทนของจริง ────────────────────────────────────────
assert.equal(hasPolishSuggestion('ครับ'), false, 'ข้อความที่เหลือว่างหลังเรียบเรียง ต้องไม่ถูกเสนอ')

// ── ตารางคำต้องไม่มีคู่ที่วนกลับหรือซ้ำซ้อน ──────────────────────────────────
for (const [wrong, right] of Object.entries(COMMON_MISSPELLINGS)) {
  assert.notEqual(wrong, right)
  assert.equal(COMMON_MISSPELLINGS[right], undefined, `คำที่ถูกแล้ว (${right}) ต้องไม่อยู่ฝั่งคำผิด`)
  assert.equal(polish(right), right, `คำที่ถูกแล้ว (${right}) ต้องไม่ถูกแก้ซ้ำ`)
}
for (const [spoken, formal] of Object.entries(SPOKEN_TO_FORMAL)) {
  assert.ok(!formal.includes(spoken) || formal !== spoken, `คำราชการของ ${spoken} ต้องไม่วนกลับหาตัวเอง`)
  assert.equal(polish(formal), formal, `คำราชการ (${formal}) ต้องไม่ถูกแปลงซ้ำอีกรอบ`)
}

// เรียบเรียงซ้ำอีกครั้งต้องได้ผลเดิม (idempotent) — ผู้ร้องกดสลับฉบับไปมาแล้วข้อความต้องไม่เพี้ยนเพิ่ม
const messy = 'ผม แจ้งไฟดับมากกกก 😫 ขออนุญาติครับ'
assert.equal(polish(polish(messy)), polish(messy))

console.log('✓ complaint-text-polish: ผ่านทุกข้อ')
