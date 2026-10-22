// ลงนามออนไลน์รายเรื่อง — ตัวช่วยฝั่งหน้าจอ (src/lib/esign.js, src/lib/esignApi.js) เทียบกับ migration ฝั่ง DB
//   node tests/esign-lib.test.mjs   (หรือ npm run test:esign)
// กันเรื่องที่เงียบแล้วพังตอนใช้จริง: (1) DB เพิ่มรหัสผลลัพธ์ใหม่แต่หน้าจอไม่มีข้อความ ผู้ใช้เห็นรหัสดิบ/ข้อความว่าง
// (2) หน้าจอเรียก RPC ไม่ครบ argument → PostgREST ตอบ PGRST202 ที่อ่านไม่ออก (3) ช่องลงนามหน้าจอไม่ตรงกับ DB
// (4) ร่างประกาศอ้างมาตรา/ข้อที่ไม่ได้ตรวจกับตัวบท
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  ESIGN_FLEET_SLOTS, ESIGN_MESSAGES, esignAnnouncementDraft, esignAnyOnline, esignBlockers, esignGateItems, esignMessage,
  esignModesFromStatus,
} from '../src/lib/esign.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const functionsSql = await read('../supabase/migrations/20261022100200_esign_functions.sql')
const apiSource = await read('../src/lib/esignApi.js')

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

await test('ทุกรหัสผลลัพธ์ (code/reason) ที่ฟังก์ชัน DB คืนได้ มีข้อความภาษาไทยในหน้าจอ', () => {
  const codes = new Set([...functionsSql.matchAll(/'(?:code|reason)',\s*'([a-z_]+)'/g)].map(match => match[1]))
  assert.ok(codes.size >= 30, `อ่านรหัสจาก migration ได้น้อยผิดปกติ (${codes.size})`)
  const missing = [...codes].filter(code => !ESIGN_MESSAGES[code])
  assert.deepEqual(missing, [], `รหัสที่ยังไม่มีข้อความ: ${missing.join(', ')}`)
  // ข้อความที่เหลือเกินจาก DB ได้ (rate_limited/error มาจากฝั่งหน้าจอ) แต่ห้ามว่าง
  for (const [code, text] of Object.entries(ESIGN_MESSAGES)) assert.ok(text.trim().length > 5, `ข้อความของ ${code} ว่าง`)
})

await test('esignMessage: รหัสไม่รู้จักไม่คืนรหัสดิบ · ใช้ message ของระบบเมื่อไม่มีรหัส · ไม่มีอะไรเลยคืนข้อความกลาง', () => {
  assert.equal(esignMessage({ ok: false, code: 'bad_pin' }), ESIGN_MESSAGES.bad_pin)
  assert.equal(esignMessage('pin_locked'), ESIGN_MESSAGES.pin_locked)
  assert.equal(esignMessage({ ok: false, code: 'รหัสใหม่ที่ยังไม่มี', message: 'network down' }), 'network down')
  assert.equal(esignMessage({ ok: false, code: 'xyz' }), ESIGN_MESSAGES.error)
  assert.equal(esignMessage(null), ESIGN_MESSAGES.error)
})

await test('ช่องลงนามบนหน้าจอตรงกับช่องที่ DB รู้จัก (ชื่อและลำดับ)', () => {
  const dbSlots = /v_slots\s+text\[\]\s*:=\s*ARRAY\[([^\]]+)\]/.exec(functionsSql)
  assert.ok(dbSlots, 'ไม่พบรายการช่องใน set_esign_doc_type')
  const names = [...dbSlots[1].matchAll(/'([a-z0-9_]+)'/g)].map(match => match[1])
  assert.deepEqual(ESIGN_FLEET_SLOTS.map(slot => slot.key), names)
  for (const slot of ESIGN_FLEET_SLOTS) assert.ok(slot.label && slot.hint, slot.key)
})

await test('หน้าจอเรียก RPC ครบทุก argument ตามชื่อใน DB (ไม่ขาด ไม่เกิน) — กัน PGRST202', () => {
  const dbFunctions = new Map()
  for (const match of functionsSql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)/g)) {
    const params = match[2].split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean)
    dbFunctions.set(match[1], params)
  }
  const calls = [...apiSource.matchAll(/callEsign\('(\w+)',\s*\{([^}]*)\}/g)]
  assert.ok(calls.length >= 5, `พบการเรียก RPC แค่ ${calls.length}`)
  for (const call of calls) {
    const sent = [...call[2].matchAll(/(p_\w+)\s*:/g)].map(match => match[1]).sort()
    const expected = dbFunctions.get(call[1])
    assert.ok(expected, `ไม่พบฟังก์ชัน ${call[1]} ใน migration`)
    assert.deepEqual(sent, [...expected].sort(), `${call[1]}: argument ที่ส่งไม่ตรงกับที่ DB ประกาศ`)
  }
})

await test('ทุกชื่อที่หน้าตั้งค่า import จาก lib/esign และ lib/esignApi มี export จริง (eslint ไม่จับ — เคยหลุดไปถึง build)', async () => {
  const component = await read('../src/components/admin/EsignSettings.jsx')
  const esign = await import('../src/lib/esign.js')
  const esignApiExports = new Set([...apiSource.matchAll(/export (?:const|async function|function) (\w+)/g)].map(match => match[1]))
  let checked = 0
  for (const match of component.matchAll(/import \{([^}]*)\} from '(\.\.\/\.\.\/lib\/esign(?:Api)?)'/g)) {
    const names = match[1].split(',').map(name => name.trim()).filter(Boolean)
    for (const name of names) {
      const exported = match[2].endsWith('Api') ? esignApiExports.has(name) : name in esign
      assert.ok(exported, `${match[2]} ไม่มี export ${name}`)
      checked++
    }
  }
  assert.ok(checked >= 14, `ตรวจชื่อ import ได้น้อยผิดปกติ (${checked})`)
})

await test('esignModesFromStatus: ไม่มีสถานะ/ไม่มีช่อง = เซ็นสดทุกช่อง · ค่าแปลกถือเป็นเซ็นสด', () => {
  const allWet = { requester: 'wet', dept_head: 'wet', authority: 'wet', sk1: 'wet' }
  assert.deepEqual(esignModesFromStatus(null), allWet)
  assert.deepEqual(esignModesFromStatus({ slot_modes: null }), allWet)
  assert.deepEqual(esignModesFromStatus({ slot_modes: { requester: 'online', authority: 'maybe', x: 'online' } }),
    { requester: 'online', dept_head: 'wet', authority: 'wet', sk1: 'wet' })
  assert.equal(esignAnyOnline(allWet), false)
  assert.equal(esignAnyOnline({ ...allWet, sk1: 'online' }), true)
  assert.equal(esignAnyOnline(null), false)
})

await test('ประตู: ปิดทั้งหมดไม่ติดอะไร · เปิดต้องมีประกาศ+ทดลอง · ช่องผู้มีอำนาจ/หัวหน้ากองต้องผูกบัญชีเมื่อเลือกออนไลน์เท่านั้น', () => {
  const none = { policy: null, authority_linked: 0, dept_head_linked: 0 }
  const wet = { requester: 'wet', dept_head: 'wet', authority: 'wet', sk1: 'wet' }
  assert.deepEqual(esignBlockers(none, wet), [], 'ปิดทั้งหมดเปิดได้เสมอ (ไม่ใช่การเปิด)')
  assert.deepEqual(esignBlockers(none, { ...wet, requester: 'online' }), ['policy', 'trial'])
  const policyOnly = { policy: { announcement_no: 'ก 1', trial_confirmed_at: null }, authority_linked: 0, dept_head_linked: 0 }
  assert.deepEqual(esignBlockers(policyOnly, { ...wet, requester: 'online' }), ['trial'])
  const ready = { policy: { announcement_no: 'ก 1', trial_confirmed_at: '2026-10-22T05:00:00Z' }, authority_linked: 1, dept_head_linked: 0 }
  assert.deepEqual(esignBlockers(ready, { ...wet, requester: 'online', authority: 'online' }), [])
  assert.deepEqual(esignBlockers(ready, { ...wet, dept_head: 'online' }), ['dept_head'])
  assert.deepEqual(esignBlockers(ready, { ...wet, authority: 'online', dept_head: 'online' }), ['dept_head'])
  const items = esignGateItems(ready, { ...wet, authority: 'online' })
  assert.deepEqual(items.map(item => [item.key, item.required, item.ok]),
    [['policy', true, true], ['trial', true, true], ['authority', true, true], ['dept_head', false, false]])
})

await test('ร่างประกาศ: ใส่ชื่อหน่วยงาน · มีส่วนให้หน่วยงานกรอกเอง · อ้างตัวบทเท่าที่ตรวจแล้วเท่านั้น', () => {
  const text = esignAnnouncementDraft('องค์การบริหารส่วนตำบลทดสอบ')
  assert.ok(text.startsWith('ประกาศองค์การบริหารส่วนตำบลทดสอบ'))
  assert.ok(text.includes('[ระบุ'), 'ต้องมีช่อง [ระบุ…] ให้หน่วยงานตัดสินใจเอง (สำรอง/ความเห็นชอบ/DPO)')
  assert.ok(esignAnnouncementDraft('').includes('[ชื่อหน่วยงาน]'))
  // ตัวบทที่ตรวจแล้ว: พ.ร.บ.ธุรกรรมฯ ๒๕๔๔ มาตรา ๙ · พ.ร.ฎ. ๒๕๔๙ ข้อ ๗ — ห้ามมีมาตราอื่นลอยมาจากความจำ
  assert.deepEqual([...new Set([...text.matchAll(/มาตรา\s*([๐-๙0-9]+)/g)].map(match => match[1]))], ['๙'])
  assert.ok(text.includes('พ.ศ. ๒๕๔๔'))
  assert.ok(/พ\.ศ\. ๒๕๔๙ ข้อ ๗/.test(text))
  for (const unverified of ['ข้อ ๑๒', 'ข้อ ๘๙', 'พ.ร.บ.การปฏิบัติราชการทางอิเล็กทรอนิกส์', 'คุ้มครองข้อมูลส่วนบุคคล พ.ศ.']) {
    assert.ok(!text.includes(unverified), `ร่างอ้างสิ่งที่ยังไม่ได้ตรวจตัวบท: ${unverified}`)
  }
  // ไม่สัญญาว่าระบบทำสิ่งที่ยังไม่มี (สำรองข้อมูลเป็นหน้าที่ที่หน่วยงานกำหนดเอง)
  assert.ok(!/ระบบ(จะ)?สำรองข้อมูล/.test(text))
})

console.log(`\nผ่านทั้งหมด ${cases} กรณี`)
