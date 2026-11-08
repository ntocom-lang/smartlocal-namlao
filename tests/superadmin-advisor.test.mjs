// หน้า "ที่ปรึกษา AI" เฉพาะ Super Admin — ตรวจ helper pure + ซอร์ส (กัน XSS / สิทธิ์เมนู / ห้ามใช้ functions.invoke)
// npm run test:advisor
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  ADVISOR_MODEL_RE, bangkokDayStartIso, conversationToText, groupConversations, newConversationId, validateAdvisorSettings,
} from '../src/lib/advisorHelpers.js'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

await check('bangkokDayStartIso: เที่ยงคืนไทย = 17:00Z ของวันก่อน (ขอบวัน)', () => {
  assert.equal(bangkokDayStartIso(new Date('2026-11-08T18:30:00Z')), '2026-11-08T17:00:00.000Z')
  assert.equal(bangkokDayStartIso(new Date('2026-11-08T16:59:00Z')), '2026-11-07T17:00:00.000Z')
  assert.equal(bangkokDayStartIso(new Date('2026-11-08T17:00:00Z')), '2026-11-08T17:00:00.000Z', 'ตรงเที่ยงคืนพอดีนับเป็นวันใหม่')
  assert.equal(bangkokDayStartIso(new Date('2026-01-01T00:00:00Z')), '2025-12-31T17:00:00.000Z', 'ข้ามปี')
  assert.equal(bangkokDayStartIso('2026-11-08T05:00:00Z'), '2026-11-07T17:00:00.000Z', 'รับสตริง ISO ได้')
})

const row = (id, conv, role, content, at) => ({ id, conversation_id: conv, role, content, created_at: at })

await check('groupConversations: จัดกลุ่ม หัวข้อ = ข้อความ user แรก ตัด 60 ตัว เรียงล่าสุดก่อน', () => {
  const long = 'ก'.repeat(100)
  const rows = [
    // ลำดับสลับกันโดยตั้งใจ — ต้องเรียงเองไม่พึ่งลำดับที่ฐานข้อมูลส่งมา
    row(4, 'b', 'model', 'ตอบเรื่อง B', '2026-11-08T03:00:00Z'),
    row(2, 'a', 'model', 'ตอบ A', '2026-11-07T01:01:00Z'),
    row(1, 'a', 'user', '  คำถาม   A\nบรรทัดสอง ', '2026-11-07T01:00:00Z'),
    row(3, 'b', 'user', long, '2026-11-08T02:59:00Z'),
    row(5, 'c', 'model', 'ไม่มีข้อความ user ในชุดที่โหลด', '2026-11-06T00:00:00Z'),
  ]
  const out = groupConversations(rows)
  assert.deepEqual(out.map(c => c.id), ['b', 'a', 'c'], 'ล่าสุดก่อน')
  assert.equal(out[0].title, 'ก'.repeat(60))
  assert.equal(out[1].title, 'คำถาม A บรรทัดสอง', 'ยุบช่องว่าง/ขึ้นบรรทัดใหม่')
  assert.equal(out[2].title, 'บทสนทนา', 'ไม่มีข้อความ user ใช้หัวข้อสำรอง')
  assert.equal(out[1].lastAt, '2026-11-07T01:01:00Z')
  assert.equal(out[1].count, 2)
  assert.deepEqual(groupConversations([]), [])
  assert.deepEqual(groupConversations(null), [])
})

await check('validateAdvisorSettings: ตรวจโมเดลตาม regex เดียวกับฐานข้อมูล + เพดาน 1–1000', () => {
  assert.equal(validateAdvisorSettings({ model: 'gemini-2.5-flash', daily_cap: 50 }), '')
  assert.equal(validateAdvisorSettings({ model: ' gemini-2.5-flash ', daily_cap: '1000' }), '', 'ตัดช่องว่างหัวท้ายก่อนตรวจ')
  for (const bad of ['', 'a', 'Gemini', '-abc', 'a b', 'x'.repeat(64), 'ก-ข', 'a_b']) {
    assert.notEqual(validateAdvisorSettings({ model: bad, daily_cap: 10 }), '', `โมเดล "${bad}" ต้องไม่ผ่าน`)
  }
  for (const cap of [0, 1001, 1.5, 'abc', '', null]) {
    assert.notEqual(validateAdvisorSettings({ model: 'gemini-2.5-flash', daily_cap: cap }), '', `เพดาน ${cap} ต้องไม่ผ่าน`)
  }
  assert.ok(ADVISOR_MODEL_RE.test('x'.repeat(63)) && !ADVISOR_MODEL_RE.test('x'.repeat(64)))
})

await check('conversationToText + newConversationId', () => {
  assert.equal(conversationToText([{ role: 'user', content: 'สวัสดี' }, { role: 'model', content: 'ครับ' }]), 'ฉัน: สวัสดี\n\nGemini: ครับ')
  assert.match(newConversationId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

await check('ซอร์ส: SuperAdminAdvisor ไม่มี dangerouslySetInnerHTML/markdown lib · ตรวจ role · ใช้ whitespace-pre-wrap', async () => {
  const src = await read('src/components/admin/SuperAdminAdvisor.jsx')
  assert.ok(!src.includes('dangerouslySetInnerHTML'), 'ห้าม render HTML จากคำตอบโมเดล (XSS)')
  assert.ok(!/from ['"](react-markdown|marked|markdown-it|remark|showdown|dompurify)/.test(src), 'ห้ามเพิ่มไลบรารี markdown')
  assert.ok(src.includes("currentUserRole !== 'superadmin'"), 'ด่านที่ 2: ตรวจ role ในคอมโพเนนต์')
  assert.ok(src.includes('เมนูนี้ใช้ได้เฉพาะ Super Admin'))
  assert.ok(src.includes('whitespace-pre-wrap'))
  assert.ok(src.includes("'noopener'"), 'window.open ไป claude.ai ต้อง noopener')
})

await check('ซอร์ส: advisorApi ไม่เรียก functions.invoke (timeout 25 วิ) ใช้ fetch เอง + timeout 120 วิ', async () => {
  // ตัดบรรทัดคอมเมนต์ออก — คอมเมนต์ในไฟล์เตือนชื่อ functions.invoke ไว้ ไม่ใช่การเรียกจริง
  const src = (await read('src/lib/advisorApi.js')).split(/\r?\n/).filter(l => !l.trim().startsWith('//')).join(' ')
  assert.ok(!/functions\s*\.\s*invoke/.test(src), 'ห้ามใช้ supabase.functions.invoke')
  assert.ok(src.includes('/functions/v1/superadmin-advisor'))
  assert.ok(src.includes('AbortController') && src.includes('120000'))
  assert.ok(src.includes('Bearer ${session.access_token}') && src.includes('apikey: supabaseAnonKey'))
})

await check('ซอร์ส: AdminDashboard เมนู ai-advisor แสดงเฉพาะ superadmin ทุกจุด + ตัว render ตรวจ role ซ้ำ', async () => {
  const src = await read('src/pages/AdminDashboard.jsx')
  const lines = src.split('\n')
  const keyLines = lines.filter(l => /key:\s*'ai-advisor'/.test(l))
  assert.ok(keyLines.length >= 2, `ต้องมีรายการเมนูอย่างน้อย 2 จุด (ซ้าย + ตาราง) พบ ${keyLines.length}`)
  for (const l of keyLines) {
    assert.ok(/show:\s*currentUserRole === 'superadmin'\s*[,}]/.test(l), `show ต้องเป็น superadmin เท่านั้น: ${l.trim()}`)
  }
  // การ์ดมือถือ: setActivePage('ai-advisor') ต้องอยู่ใน {currentUserRole === 'superadmin' && (...)}
  const idx = lines.findIndex(l => l.includes("setActivePage('ai-advisor')"))
  assert.ok(idx > 0 && /currentUserRole === 'superadmin' && \($/.test(lines[idx - 1].trim()), 'การ์ดมือถือต้องห่อด้วยเงื่อนไข superadmin')
  assert.ok(src.includes("activePage === 'ai-advisor' && currentUserRole === 'superadmin'"))
  assert.ok(src.includes("lazy(() => import('../components/admin/SuperAdminAdvisor'))"))
})

console.log(`\nผ่านทั้งหมด ${passed} กลุ่ม`)
