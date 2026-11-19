// รูปแบบไอคอนหมวด 'glyph' (ไอคอนทึบสีเดียว Phosphor) — ตรวจตารางแปลง emoji → ไอคอน ไม่ต่อเน็ต ไม่ใช้บัญชี
//   1) ทุกชื่อในตาราง GLYPH_NAME_BY_EMOJI มีตัวไอคอนจริงใน categoryGlyphIcons.js (ห้ามเดาชื่อ Phosphor — พิมพ์ผิด = ไอคอนหายเงียบๆ)
//   2) emoji ที่หน้าจอใช้จริง (หมวดสำรองของ ComplaintCategory, FALLBACK_EMOJI ของ ComplaintBand, ปุ่ม ServiceHub 4 ช่อง,
//      ServiceButtons) ต้องมีไอคอนทึบ — เว้นรายการที่ "ตัดสินใจแล้วว่ายังไม่แปลง" ใน KNOWN_UNMAPPED พร้อมเหตุผล
//      เพิ่ม emoji ใหม่ในหน้าเหล่านั้นแล้วลืมใส่ตาราง = เทสต์นี้ล้ม (ไม่งั้นโหมด glyph จะตกไปเป็นภาพสีเงียบๆ)
//   3) ตัด U+FE0F ก่อนเทียบ, URL รูปที่แอดมินตั้งเองไม่ถือว่ามีไอคอนทึบ
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { GLYPH_NAME_BY_EMOJI, glyphNameFor, hasGlyphIcon, normalizeEmojiKey } = await import('../src/lib/categoryGlyphNames.js')
const { GLYPH_ICONS } = await import('../src/lib/categoryGlyphIcons.js')
const { DEFAULT_COMPLAINT_CATEGORIES } = await import('../src/lib/complaintCategoryDefaults.js')

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

let cases = 0
const test = (label, run) => {
  run()
  cases++
  console.log('PASS ' + label)
}

// emoji ที่ Phosphor ไม่มีไอคอนความหมายตรง — ตั้งใจไม่แปลง (โหมด glyph แสดงเป็นภาพ OpenMoji สีในกล่องสีของหมวดแทน)
// ถ้าจะแปลง: เติมในตาราง categoryGlyphNames.js แล้วลบออกจากรายการนี้
const KNOWN_UNMAPPED = new Map([
  ['🕳', 'หลุม/ท่อระบายน้ำ — ไม่มีไอคอนหลุมใน Phosphor (เสนอ Pipe ให้เจ้าของระบบตัดสิน)'],
  ['🏞', 'อุทยานแห่งชาติ/ลำคลอง — ไม่มีไอคอนตรง (ใกล้สุด Mountains/Waves ความหมายไม่ตรง)'],
])

const emojisIn = (text) => [...text.matchAll(/:\s*'([^'\w][^']*)'/g)].map(m => m[1])
const block = (source, startRe) => {
  const m = source.match(startRe)
  assert.ok(m, 'หาบล็อกในซอร์สไม่เจอ: ' + startRe)
  return m[1]
}

test('ทุกชื่อไอคอนในตารางมีตัวไอคอนจริง และ categoryGlyphIcons ไม่มีของเกิน', () => {
  const names = new Set(Object.values(GLYPH_NAME_BY_EMOJI))
  for (const name of names) {
    const Icon = GLYPH_ICONS[name]
    assert.ok(Icon && typeof Icon === 'object' && Icon.$$typeof, `ไม่มีไอคอน Phosphor ชื่อ ${name} ใน categoryGlyphIcons.js`)
    assert.equal(Icon.displayName, name + 'Icon', `${name} ไม่ใช่ไอคอน Phosphor จริง`)
  }
  for (const name of Object.keys(GLYPH_ICONS)) assert.ok(names.has(name), `categoryGlyphIcons.js import ${name} เกินจากที่ตารางใช้ (เพิ่ม bundle เปล่าๆ)`)
})

test('คีย์ในตารางเป็นรูปที่ตัด FE0F แล้ว และไม่ซ้ำ', () => {
  for (const key of Object.keys(GLYPH_NAME_BY_EMOJI)) {
    assert.equal(key, normalizeEmojiKey(key), `คีย์ ${key} มี U+FE0F ค้าง`)
  }
})

test('hasGlyphIcon ตัด FE0F ก่อนเทียบ และ URL รูป/ค่าว่างไม่ถือว่ามีไอคอนทึบ', () => {
  assert.equal(hasGlyphIcon('🛣️'), true)
  assert.equal(hasGlyphIcon('🛣'), true)
  assert.equal(glyphNameFor('🚰'), 'Drop')
  assert.equal(hasGlyphIcon('https://example.com/a.png'), false)
  assert.equal(hasGlyphIcon('data:image/png;base64,AAAA'), false)
  assert.equal(hasGlyphIcon(''), false)
  assert.equal(hasGlyphIcon(undefined), false)
  assert.equal(hasGlyphIcon('🕳️'), false)
})

test('KNOWN_UNMAPPED ยังเป็น "ไม่มีไอคอน" จริง (ถ้าแปลงแล้วให้ลบออกจากรายการ)', () => {
  for (const [emoji] of KNOWN_UNMAPPED) assert.equal(hasGlyphIcon(emoji), false, `${emoji} แปลงแล้ว — ลบออกจาก KNOWN_UNMAPPED`)
})

function assertCovered(label, emojis) {
  assert.ok(emojis.length > 0, `อ่าน emoji ของ ${label} ไม่ได้ (รูปแบบซอร์สเปลี่ยน?)`)
  for (const e of emojis) {
    const key = normalizeEmojiKey(e)
    if (KNOWN_UNMAPPED.has(key)) continue
    assert.ok(hasGlyphIcon(e), `${label}: emoji ${e} ไม่มีไอคอนทึบ — เติมใน categoryGlyphNames.js หรือใส่ KNOWN_UNMAPPED พร้อมเหตุผล`)
  }
}

test('หมวดสำรอง (EMOJI_OVERRIDE ใน ComplaintCategory.jsx) มีไอคอนทึบครบ และครอบทุกหมวดใน complaintCategoryDefaults.js', () => {
  const src = read('src/pages/ComplaintCategory.jsx')
  const body = block(src, /const EMOJI_OVERRIDE = \{([\s\S]*?)\n\}/)
  assertCovered('EMOJI_OVERRIDE', emojisIn(body))
  // complaintCategoryDefaults.js ไม่เก็บ emoji ตรงๆ — หน้าเลือกหมวดดึงจาก EMOJI_OVERRIDE ตาม value ต้องไม่มีหมวดตกหล่น
  for (const { value } of DEFAULT_COMPLAINT_CATEGORIES) {
    assert.ok(new RegExp(`\\b${value}:\\s*'`).test(body), `หมวดสำรอง ${value} ไม่มี emoji ใน EMOJI_OVERRIDE`)
  }
})

test('FALLBACK_EMOJI ของ ComplaintBand (ธีม clean) มีไอคอนทึบครบ', () => {
  const src = read('src/components/home/ComplaintBand.jsx')
  assertCovered('FALLBACK_EMOJI', emojisIn(block(src, /const FALLBACK_EMOJI = \{([\s\S]*?)\n\}/)))
})

test('ปุ่ม ServiceHub 4 ช่องหลัก (ร้องเรียน/บริการประชาชน/ประปา/คู่มือ) มีไอคอนทึบ และประปาใช้หยดน้ำ', () => {
  const src = read('src/components/citizen/templates/ServiceHub/Home.jsx')
  const names = ['COMPLAINT_SERVICE', 'CITIZEN_SERVICE', 'WATERWORKS_SERVICE', 'MANUAL_SERVICE']
  const found = {}
  for (const n of names) {
    const body = block(src, new RegExp(`const ${n} = \\{([\\s\\S]*?)\\n\\}`))
    const m = body.match(/emoji:\s*'([^']+)'/)
    assert.ok(m, `${n} ไม่มี emoji`)
    found[n] = m[1]
  }
  assertCovered('ServiceHub 4 ช่อง', Object.values(found))
  assert.equal(glyphNameFor(found.WATERWORKS_SERVICE), 'Drop', 'ช่องประปาต้องเป็นหยดน้ำทึบ')
  // ประเภทที่ อปท. เพิ่มเอง ถ้าไม่ตั้ง emoji ใช้ 📋 — ต้องมีไอคอนทึบด้วย
  assert.ok(hasGlyphIcon('📋'))
})

test('FALLBACK ของ ServiceButtons มีไอคอนทึบครบ', () => {
  const src = read('src/components/home/ServiceButtons.jsx')
  const body = block(src, /const FALLBACK = \[([\s\S]*?)\n\]/)
  assertCovered('ServiceButtons FALLBACK', [...body.matchAll(/emoji:\s*'([^']+)'/g)].map(m => m[1]))
})

test('ตัวเลือกอีโมจิของแอดมิน (EMOJI_GROUPS) แปลงได้ส่วนใหญ่ — ตัวที่ไม่มีไอคอนตรงจะแสดงเป็นภาพสีและแอดมินเห็นรายการเตือน', () => {
  const src = read('src/pages/AdminDashboard.jsx')
  const body = block(src, /const EMOJI_GROUPS = \[([\s\S]*?)\n\]/)
  const all = [...body.matchAll(/'([^'\w]+)'/g)].map(m => m[1]).filter(e => e.length > 0 && !/[0E00-0E7F]/.test(e))
  assert.ok(all.length > 80, 'อ่านรายการ emoji ของแอดมินได้น้อยผิดปกติ')
  const covered = all.filter(e => hasGlyphIcon(e)).length
  assert.ok(covered / all.length >= 0.6, `แปลงได้แค่ ${covered}/${all.length} ตัว — ต่ำกว่า 60%`)
})

console.log(`\nผ่านทั้งหมด ${cases} เคส`)
