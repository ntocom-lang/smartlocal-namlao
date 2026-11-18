// ถ้อยคำตำแหน่งกรณีผู้อื่นลงนามแทน — ปุ่มเติม "รักษาราชการแทน/ปฏิบัติราชการแทน" ในกล่องแก้ผู้ลงนาม (เจ้าของระบบสั่ง 2569-11-18)
//   node tests/signatory-acting-title.test.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ACTING_TITLE_PHRASES, actingTitleOptions, slotHolder } from '../src/lib/documentSignatories.js'
import { govSplitActingTitle } from '../src/lib/govSignBlock.js'

const mayor = { id: 'p-mayor', full_name: 'นายสมชาย ใจดี', job_title: 'นายกเทศมนตรีตำบลน้ำเลา' }
const clerk = { id: 'p-clerk', full_name: 'นางสมศรี ตั้งใจ', job_title: 'ปลัดเทศบาล' }
const asPerson = p => ({ id: p.id, name: p.full_name, title: p.job_title })

// 1) ผู้ดำรงตำแหน่งจากการแต่งตั้งมาก่อน · ไม่มีการแต่งตั้ง ใช้แถวทะเบียนที่ไม่ใช่ผู้แทน · แถวผู้แทนไม่นับเป็นตัวจริง
{
  const fromAppointment = slotHolder({ suggestion: { status: 'one', person: mayor }, assignment: null })
  assert.deepEqual(fromAppointment, { id: 'p-mayor', name: 'นายสมชาย ใจดี', title: 'นายกเทศมนตรีตำบลน้ำเลา' })

  const fromRegistry = slotHolder({
    suggestion: { status: 'none' },
    assignment: { profile_id: null, manual_name: 'นายสมชาย ใจดี', title_override: 'นายกเทศมนตรีตำบลน้ำเลา' },
  })
  assert.equal(fromRegistry.title, 'นายกเทศมนตรีตำบลน้ำเลา')

  const acting = slotHolder({
    suggestion: { status: 'many', count: 2, people: [] },
    assignment: { profile_id: 'p-clerk', profile: clerk, title_override: 'ปลัดเทศบาล รักษาราชการแทนนายกเทศมนตรีตำบลน้ำเลา' },
  })
  assert.equal(acting, null, 'แถวที่ตั้งผู้แทนไว้ต้องไม่ถูกนับเป็นผู้ดำรงตำแหน่ง')
}

// 2) คนอื่นมาแทน = ได้ 2 ถ้อยคำครบ เรียงตามค่าคงที่
{
  const holder = slotHolder({ suggestion: { status: 'one', person: mayor } })
  const options = actingTitleOptions({ holder, person: asPerson(clerk) })
  assert.deepEqual(options.map(o => o.phrase), [...ACTING_TITLE_PHRASES])
  assert.deepEqual(options.map(o => o.text), [
    'ปลัดเทศบาล รักษาราชการแทน นายกเทศมนตรีตำบลน้ำเลา',
    'ปลัดเทศบาล ปฏิบัติราชการแทน นายกเทศมนตรีตำบลน้ำเลา',
  ])
  assert.ok(options.every(o => o.complete && o.ownTitle))
  // ใบพิมพ์ต้องแบ่ง 2 บรรทัดหลังคำว่า "แทน" ได้จากข้อความที่ปุ่มเติมให้
  assert.deepEqual(govSplitActingTitle(options[0].text), ['ปลัดเทศบาล รักษาราชการแทน', 'นายกเทศมนตรีตำบลน้ำเลา'])
}

// 3) คนเดียวกับผู้ดำรงตำแหน่ง (กรณีปกติ/ตอนเปลี่ยนคืน) = ไม่มีตัวเลือก — ทั้งเทียบบัญชีและเทียบชื่อที่พิมพ์เอง
{
  const holder = slotHolder({ suggestion: { status: 'one', person: mayor } })
  assert.deepEqual(actingTitleOptions({ holder, person: asPerson(mayor) }), [])
  const manualHolder = { id: null, name: 'นายสมชาย ใจดี', title: 'นายก' }
  assert.deepEqual(actingTitleOptions({ holder: manualHolder, person: { id: null, name: 'สมชาย  ใจดี', title: '' } }), [],
    'คำนำหน้า/ช่องว่างต่างกันยังเป็นคนเดียวกัน')
}

// 4) ไม่รู้ตำแหน่งที่ถูกแทน = ข้อความจบที่ "แทน" + complete=false · ห้ามเดาตำแหน่งจากชื่อกอง
{
  const options = actingTitleOptions({ holder: null, person: asPerson(clerk) })
  assert.deepEqual(options.map(o => o.text), ['ปลัดเทศบาล รักษาราชการแทน', 'ปลัดเทศบาล ปฏิบัติราชการแทน'])
  assert.ok(options.every(o => !o.complete))
}

// 5) โหมดพิมพ์ชื่อเอง (ไม่มีตำแหน่งของผู้แทน) = ขึ้นต้นด้วยถ้อยคำเลย · ยังไม่ได้เลือกบุคลากร = ไม่มีตัวเลือก
{
  const holder = slotHolder({ suggestion: { status: 'one', person: mayor } })
  const options = actingTitleOptions({ holder, person: { id: null, name: 'นายรอง นายก', title: '' } })
  assert.equal(options[0].text, 'รักษาราชการแทน นายกเทศมนตรีตำบลน้ำเลา')
  assert.equal(options[0].ownTitle, false, 'ต้องบอกหน้าจอให้เตือนพิมพ์ตำแหน่งนำหน้า')
  assert.deepEqual(actingTitleOptions({ holder, person: null }), [])
  // โหมดพิมพ์ชื่อเองยังไม่พิมพ์ชื่อ ปุ่มต้องขึ้นแล้ว (เจ้าของระบบถาม 2569-11-18 ว่าทำไมไม่มีให้เลือก)
  const blank = actingTitleOptions({ holder, person: { id: null, name: '   ', title: '' } })
  assert.deepEqual(blank.map(o => o.text), ['รักษาราชการแทน นายกเทศมนตรีตำบลน้ำเลา', 'ปฏิบัติราชการแทน นายกเทศมนตรีตำบลน้ำเลา'])
}

// 6) หน้าจอใช้ตัวประกอบชุดนี้ และมีปุ่ม "ตามการแต่งตั้ง" สำหรับเปลี่ยนคืน
{
  const source = await readFile(new URL('../src/components/admin/SignatorySettings.jsx', import.meta.url), 'utf8')
  assert.match(source, /actingTitleOptions\(\{ holder, person: actingPerson \}\)/)
  assert.match(source, /data-signatory-title-option="appointed"/)
}

console.log('signatory-acting-title: ผ่านทุกข้อ')
