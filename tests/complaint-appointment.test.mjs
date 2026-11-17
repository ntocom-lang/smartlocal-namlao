// งาน 1.1 (E1) คำร้องแบบนัดหมาย — ตรรกะหน้าเว็บ + ตรวจให้หน้าเว็บกับฐานข้อมูลตรงกัน (ไม่ใช้เครือข่าย ไม่แตะข้อมูลจริง)
//   node tests/complaint-appointment.test.mjs
// ฝั่งฐานข้อมูลตรวจแยกที่ tests/complaint-appointment-db.test.mjs (ต้องใช้ PGlite)
//
// สิ่งที่ต้องไม่พัง: (1) วันที่ไทย/ช่วงเวลา/นัดหลังกำหนด ไม่ขึ้นกับ timezone เครื่อง (2) ตารางอัตราตรวจตามกติกาเดียวกับ SQL
// และ rate ส่งเป็น number (3) ชื่อ RPC/พารามิเตอร์ที่หน้าเว็บเรียก = ฐานข้อมูล (4) หน้า /t/ ไม่โหลดรูปเองและไม่ผ่าน /_img/
// (5) หมวด odor ไม่ได้ preferred_date (whitelist คีย์ของฐานข้อมูล)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPOINTMENT_SLOTS, APPOINTMENT_TIMELINE_LABELS, FEE_LIMITS, TRACK_PHOTO_MODES,
  addDaysToDateStr, appointmentText, bangkokToday, feeRowsToDraft, feeSaveErrorMessage, formatApptDate, formatApptDateShort,
  isAppointmentAfterDue, isDateOnly, normalizeFeeRates, normalizeTrackPhotos, offDayWarning, preferredDateRange, readPreferredDate,
  staffAppointmentRange, trackPhotoUrl, trackPhotosLocked, validateFeeReference, validateFeeRows,
} from '../src/lib/complaintAppointment.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = async rel => (await readFile(path.join(root, rel), 'utf8')).replace(/\r\n/g, '\n')
const stripComments = source => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

await test('วันที่: รูปแบบ · พ.ศ. · ช่วงเวลา · นัดหลังกำหนด', () => {
  assert.equal(isDateOnly('2026-12-05'), true)
  for (const bad of ['2026-02-30', '2026-13-01', '26-12-05', '', null, undefined, '2026-12-05T00:00:00Z']) assert.equal(isDateOnly(bad), false, String(bad))
  assert.equal(formatApptDate('2026-12-05'), '5 ธ.ค. 2569')
  assert.equal(formatApptDateShort('2026-12-05'), '5 ธ.ค.')
  assert.equal(formatApptDate('x'), '')
  assert.equal(appointmentText({ date: '2026-12-05', slot: 'morning' }), '5 ธ.ค. 2569 ช่วงเช้า')
  assert.equal(appointmentText({ date: '2026-12-05', slot: 'afternoon' }), '5 ธ.ค. 2569 ช่วงบ่าย')
  assert.equal(appointmentText({ date: '2026-12-05', slot: 'allday' }), '5 ธ.ค. 2569 ทั้งวัน')
  assert.equal(appointmentText({ date: '', slot: 'morning' }), '')
  assert.deepEqual(APPOINTMENT_SLOTS.map(s => s.value), ['morning', 'afternoon', 'allday'])
  assert.equal(isAppointmentAfterDue('2026-12-10', '2026-12-09'), true)
  assert.equal(isAppointmentAfterDue('2026-12-09', '2026-12-09'), false)
  assert.equal(isAppointmentAfterDue('2026-12-09', null), false, 'ไม่มีวันกำหนด = ไม่ตัดสิน')
  assert.deepEqual(APPOINTMENT_TIMELINE_LABELS, { appointment: 'นัดหมาย', appointment_cleared: 'ยกเลิกนัด' })
})

await test('ช่วงวันที่เวลาไทย: พรุ่งนี้ถึง +90 วัน (ผู้แจ้ง) · วันนี้ถึง +180 วัน (เจ้าหน้าที่) ไม่ขึ้นกับ timezone เครื่อง', () => {
  // 17:30 UTC ของ 30 พ.ย. = 00:30 ของ 1 ธ.ค. เวลาไทย
  const lateUtc = new Date('2026-11-30T17:30:00Z')
  assert.equal(bangkokToday(lateUtc), '2026-12-01')
  assert.deepEqual(preferredDateRange(lateUtc), { min: '2026-12-02', max: '2027-03-01' })
  assert.deepEqual(staffAppointmentRange(lateUtc), { min: '2026-12-01', max: '2027-05-30' })
  assert.equal(addDaysToDateStr('2026-12-31', 1), '2027-01-01')
  assert.equal(addDaysToDateStr('bad', 1), '')
})

await test('คำเตือนวันหยุด: เสาร์-อาทิตย์ / วันหยุดราชการ เตือนอ่อนๆ · วันทำการไม่เตือน', () => {
  assert.equal(offDayWarning('2026-12-08'), '', 'อังคารที่ไม่ใช่วันหยุด')
  assert.match(offDayWarning('2026-12-06'), /เสาร์-อาทิตย์/, 'อาทิตย์')
  assert.match(offDayWarning('2026-12-07'), /วันหยุดราชการ/, 'ชดเชยวันพ่อ (ตารางวันหยุดในโค้ด)')
  assert.equal(offDayWarning(''), '')
  assert.equal(offDayWarning('not-a-date'), '')
})

await test('วันที่สะดวกใน extra_data: รับเฉพาะรูปแบบวันที่ถูกต้อง', () => {
  assert.equal(readPreferredDate({ preferred_date: '2026-12-08' }), '2026-12-08')
  for (const bad of [null, undefined, {}, { preferred_date: 5 }, { preferred_date: '2026-12-08T10:00' }, { preferred_date: '8/12/2026' }, 'x'])
    assert.equal(readPreferredDate(bad), '', JSON.stringify(bad))
})

await test('ตารางอัตรา: กติกาเดียวกับ SQL (≤20 แถว · item ≤120 · unit ≤40 · rate 0..1,000,000 เป็น number · note ≤200)', () => {
  const ok = validateFeeRows([{ item: ' ดูดสิ่งปฏิกูล ', unit: 'ลบ.ม.', rate: '1,200', note: '' }, { item: 'ค่าเดินทาง', unit: 'ครั้ง', rate: '50.5', note: 'นอกเขต' }, { item: '', unit: '', rate: '', note: '' }])
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.rows, [{ item: 'ดูดสิ่งปฏิกูล', unit: 'ลบ.ม.', rate: 1200 }, { item: 'ค่าเดินทาง', unit: 'ครั้ง', rate: 50.5, note: 'นอกเขต' }])
  for (const row of ok.rows) assert.equal(typeof row.rate, 'number', 'rate ต้องเป็น number ไม่ใช่สตริง')
  assert.equal(validateFeeRows([{ item: 'x', unit: 'y', rate: '0' }]).ok, true, 'อัตรา 0 ใช้ได้')
  assert.equal(validateFeeRows([{ item: 'x', unit: 'y', rate: '1000000' }]).ok, true)
  const bads = [
    [{ item: '', unit: 'y', rate: '1' }], [{ item: 'x', unit: '', rate: '1' }], [{ item: 'x', unit: 'y', rate: '' }],
    [{ item: 'x', unit: 'y', rate: 'abc' }], [{ item: 'x', unit: 'y', rate: '-1' }], [{ item: 'x', unit: 'y', rate: '1000000.01' }],
    [{ item: 'x', unit: 'y', rate: '1e3' }], [{ item: 'x'.repeat(121), unit: 'y', rate: '1' }], [{ item: 'x', unit: 'y'.repeat(41), rate: '1' }],
    [{ item: 'x', unit: 'y', rate: '1', note: 'n'.repeat(201) }],
    Array.from({ length: 21 }, (_, i) => ({ item: `i${i}`, unit: 'u', rate: '1' })),
  ]
  for (const rows of bads) assert.equal(validateFeeRows(rows).ok, false, JSON.stringify(rows).slice(0, 60))
  assert.equal(validateFeeRows(Array.from({ length: 20 }, (_, i) => ({ item: `i${i}`, unit: 'u', rate: '1' }))).ok, true)
  assert.equal(validateFeeRows([]).ok, true, 'ล้างตารางได้')
  assert.deepEqual(validateFeeReference('  ข้อบัญญัติ ฯ  '), { ok: true, value: 'ข้อบัญญัติ ฯ' })
  assert.deepEqual(validateFeeReference('   '), { ok: true, value: null })
  assert.equal(validateFeeReference('x'.repeat(301)).ok, false)
  assert.deepEqual(FEE_LIMITS, { rows: 20, item: 120, unit: 40, rateMax: 1000000, note: 200, reference: 300 })
  assert.deepEqual(feeRowsToDraft([{ item: 'a', unit: 'b', rate: 5 }]), [{ item: 'a', unit: 'b', rate: '5', note: '' }])
  assert.match(feeSaveErrorMessage({ code: '23514' }), /ไม่ถูกต้อง/)
  assert.deepEqual(normalizeFeeRates([{ item: 'a', unit: 'b', rate: 5 }, { item: 'a', unit: 'b', rate: '5' }, null, 'x']), [{ item: 'a', unit: 'b', rate: 5, note: '' }])
})

await test('ตัวตรวจหน้าเว็บ = CHECK ในฐานข้อมูล (ตัวเลขชุดเดียวกัน)', async () => {
  const sql = await read('supabase/migrations/20261202100100_complaint_appointment_functions.sql')
  assert.match(sql, /jsonb_array_length\(p_rates\) > 20/)
  assert.match(sql, /NOT BETWEEN 1 AND 120/)
  assert.match(sql, /NOT BETWEEN 1 AND 40/)
  assert.match(sql, /v_rate > 1000000/)
  assert.match(sql, /char_length\(v_row ->> 'note'\) > 200/)
  assert.match(sql, /fee_reference IS NULL OR char_length\(fee_reference\) <= 300/)
  assert.match(sql, /track_photos IN \('none', 'after', 'both'\)/)
  assert.deepEqual(TRACK_PHOTO_MODES.map(m => m.value), ['none', 'after', 'both'])
  assert.match(sql, /appointment_slot IN \('morning', 'afternoon', 'allday'\)/)
  assert.match(sql, /char_length\(appointment_note\) <= 300/)
  assert.match(sql, /p_date > v_today \+ 180/)
})

await test('รูปในหน้า /t/: ล็อกหมวดอ่อนไหว/เฉพาะกิจ · URL ผ่าน drive-file เท่านั้น · id ผิดรูปแบบถูกทิ้ง', () => {
  assert.equal(trackPhotosLocked({ is_adhoc: true }), true)
  assert.equal(trackPhotosLocked({ requires_manual_intake: true }), true)
  assert.equal(trackPhotosLocked({ value: 'corruption' }), true, 'หมวดทุจริต (ชุดเดียวกับเรื่องลับ)')
  assert.equal(trackPhotosLocked({ value: 'road' }), false)
  assert.equal(trackPhotosLocked({ is_adhoc: false, requires_manual_intake: false }), false)
  assert.equal(trackPhotoUrl('https://abc.supabase.co', 'A1b2C3d4E5f6'), 'https://abc.supabase.co/functions/v1/drive-file?id=A1b2C3d4E5f6')
  assert.equal(trackPhotoUrl('https://abc.supabase.co/', 'A1b2C3d4E5f6'), 'https://abc.supabase.co/functions/v1/drive-file?id=A1b2C3d4E5f6')
  for (const badId of ['short', '../../x', 'a b c d e f g h i j', '', null, 'x?y=1&zzzzzzzz']) assert.equal(trackPhotoUrl('https://abc.supabase.co', badId), null, String(badId))
  assert.equal(trackPhotoUrl('', 'A1b2C3d4E5f6'), null)
  assert.deepEqual(normalizeTrackPhotos({ after: ['A1b2C3d4E5f6', 'bad id', 7], before: 'x' }), { before: [], after: ['A1b2C3d4E5f6'] })
  assert.deepEqual(normalizeTrackPhotos(null), { before: [], after: [] })
})

// ── หน้าเว็บ ↔ ฐานข้อมูล ──────────────────────────────────────────────────────────────────────
await test('RPC นัดหมายที่หน้าเจ้าหน้าที่เรียก: ชื่อและพารามิเตอร์ตรงกับฟังก์ชันในฐานข้อมูล', async () => {
  const sql = await read('supabase/migrations/20261202100100_complaint_appointment_functions.sql')
  const signature = /FUNCTION public\.set_complaint_appointment\(([\s\S]*?)\)\s*RETURNS jsonb/.exec(sql)
  assert.ok(signature)
  const declared = signature[1].split(',').map(part => part.trim().split(/\s+/)[0])
  assert.deepEqual(declared, ['p_complaint_id', 'p_date', 'p_slot', 'p_note', 'p_allow_off_day'])
  const manager = stripComments(await read('src/components/admin/ComplaintsManager.jsx'))
  const calls = [...manager.matchAll(/rpc\('set_complaint_appointment', \{([^}]*)\}/g)]
  assert.equal(calls.length, 2, 'ตั้ง/เลื่อน 1 จุด + ยกเลิก 1 จุด')
  for (const [, args] of calls) {
    const passed = [...args.matchAll(/\b(p_[a-z_]+)\s*:/g)].map(m => m[1])
    assert.deepEqual(passed, declared)
  }
  assert.match(manager, /code === 'off_day'/, 'วันหยุดต้องถามยืนยันแล้วเรียกซ้ำ')
  assert.match(manager, /p_allow_off_day: allowOffDay/)
})

await test('ฟอร์มประชาชน: preferred_date เฉพาะหมวดที่เปิดนัดหมาย ไม่ใช่ odor · ตรวจช่วงวันก่อนส่งทั้ง 2 จุด · คิวรีหมวดถอยกลับได้', async () => {
  const form = await read('src/pages/CitizenForm.jsx')
  const build = /function buildExtraData\(form\) \{[\s\S]*?\n  \}\n/.exec(stripComments(form))?.[0]
  assert.ok(build)
  assert.ok(build.indexOf("form.category === 'odor'") < build.indexOf('preferred_date'), 'odor ต้องออกจากฟังก์ชันก่อนถึง preferred_date')
  assert.match(build, /appointmentEnabledFor\(form\.category\) && isDateOnly\(form\.preferred_date\)/)
  assert.equal((form.match(/= validatePreferredDate\(form\)/g) ?? []).length, 2, 'ต้องตรวจทั้งปุ่มก่อนเปิดหน้าทวนและ handleSubmit')
  assert.match(form, /requires_appointment, fee_rates, fee_reference/)
  assert.match(form, /\.select\('value, label, emoji, color, is_active, submit_audience'\)/, 'ฐานข้อมูลยังไม่มีคอลัมน์ใหม่ต้องถอยไปคอลัมน์เดิม ไม่ทำให้รายการหมวดหาย')
  assert.match(form, /เจ้าหน้าที่จะยืนยันวันนัดอีกครั้ง ดูได้ที่ลิงก์ติดตามเรื่อง/)
})

await test('หน้า /t/: ไม่โหลดรูปเองตอนเปิดหน้า · ไม่ผ่าน /_img/ หรือ edgeImage · ใช้ drive-file ตรง · มีข้อความวันนัด/อัตรา', async () => {
  const page = await read('src/pages/TrackComplaint.jsx')
  const code = stripComments(page)
  assert.ok(!/edgeImage|\/_img\//.test(code), 'รูปคำร้องประชาชนห้ามเข้าแคช edge')
  assert.match(code, /import\.meta\.env\.VITE_SUPABASE_URL/)
  assert.match(code, /loading="lazy"/)
  assert.match(code, /แตะเพื่อดูรูป/)
  // <img> ต้องอยู่หลังเงื่อนไข shown เท่านั้น
  const imgAt = code.indexOf('<img')
  const shownAt = code.indexOf('!shown ?')
  assert.ok(shownAt > 0 && imgAt > shownAt, 'รูปต้องไม่ถูกเรนเดอร์ก่อนผู้ใช้แตะ')
  assert.match(code, /รอเจ้าหน้าที่ยืนยันวันนัด/)
  assert.match(code, /นัดหลังวันกำหนดเสร็จ/)
  assert.match(code, /<FeeRatesCard /)
})

await test('ตั้งค่าหมวด: สวิตช์นัดหมาย · ตัวเลือกรูป /t/ (ล็อกหมวดอ่อนไหว/เฉพาะกิจ + เตือน PDPA) · ตัวแก้อัตราส่ง rate เป็น number ผ่าน validateFeeRows', async () => {
  const admin = await read('src/pages/AdminDashboard.jsx')
  assert.match(admin, /requires_appointment: next/)
  assert.match(admin, /track_photos: mode/)
  assert.match(admin, /fee_rates: rows, fee_reference: reference/)
  assert.match(admin, /trackPhotosLocked\(cat\)/)
  assert.match(admin, /TRACK_PHOTO_BOTH_WARNING/)
  assert.match(admin, /FEE_ADMIN_HINT/)
  assert.match(admin, /feeSaveErrorMessage\(result\.error\)/)
  const lib = await read('src/lib/complaintAppointment.js')
  assert.match(lib, /ไม่แสดงรูปเสมอ/)
  assert.match(lib, /รูปที่ประชาชนส่งมาอาจมีหน้าคน ป้ายทะเบียน หรือบ้านเลขที่ ทุกคนที่มีลิงก์ติดตามเรื่องจะเห็น/)
})

console.log(`\nครบ ${cases} กลุ่ม`)
