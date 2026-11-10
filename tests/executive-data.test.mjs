// Pure-logic test: ช่วงเวลา / ชีพจร / ตาราง ②-2 / หมวดปัญหา ของห้องผู้บริหาร (src/lib/executiveData.js, executiveAccess.js)
// ใช้วันที่คงที่ทุกเคส ไม่ขึ้นกับเวลาจริงหรือโซนเวลาของเครื่อง · ไม่ต่อเน็ต/ฐานข้อมูล
import assert from 'node:assert/strict'

// ตั้งโซนเวลาเครื่องเป็นที่อื่นไว้ก่อน import — ถ้าโค้ดพึ่ง TZ เครื่อง วันที่ไทยจะเพี้ยนและเทสต์ล้ม
process.env.TZ = 'America/Los_Angeles'

const {
  EXEC_PERIODS, categoryCounts, compareValues, docTypeLabelOf, buildServiceRows, execPeriodRange, execPreviousRange,
  execRangeText, execToday, fiscalYearStart, issueBreakdownRows, normalizeComplaintStats, projectComplaintRows,
  projectDocRows, rowsTruncated, splitServiceRows, summarizePulse,
} = await import('../src/lib/executiveData.js')
const {
  EXEC_OAUTH_CHECK_TTL_MS, EXEC_POSITION_LOOKUP_ROLES, canOpenExecutiveHome, executiveLandingPath, isExecutiveHomeDefault, isFreshExecOauthCheck,
} = await import('../src/lib/executiveAccess.js')
const { STAFF_PORTAL_ROLES } = await import('../src/lib/portalAccess.js')
const { fiscalYearOf } = await import('../src/lib/fiscalYear.js')
const { EXECUTIVE_REGISTRY, liveEntries, ownerOfDocType } = await import('../src/lib/executiveRegistry.js')

let cases = 0
const done = (label) => {
  cases++
  console.log('PASS ' + label)
}
// เคสที่เป็น async ต้อง await ที่ผู้เรียก (await test(...)) — เคสปกติรันตรงๆ
const test = (label, run) => {
  const result = run()
  if (result && typeof result.then === 'function') return result.then(() => done(label))
  done(label)
  return undefined
}
// ช่วงที่เทียบเป็นเวลาไทย: 12:00 น. ไทย = 05:00Z
const at = (iso) => new Date(`${iso}T05:00:00Z`)

// ── วันที่ไทย ────────────────────────────────────────────────────────────────

test('"วันนี้" ตามเวลาไทย ไม่ใช่ UTC/โซนเครื่อง: ตี 0:30 ไทย = วันถัดไป, 23:59 ไทย = วันเดิม', () => {
  assert.equal(execToday(new Date('2026-11-09T17:30:00Z')), '2026-11-10') // 00:30 ไทย
  assert.equal(execToday(new Date('2026-11-10T16:59:59Z')), '2026-11-10') // 23:59:59 ไทย
  assert.equal(execToday(new Date('2026-11-10T17:00:00Z')), '2026-11-11') // 00:00 ไทยของวันถัดไป
})

test('ช่วงวัน/7 วัน: วันนี้ + ช่วงก่อนหน้าติดกัน', () => {
  assert.deepEqual(execPeriodRange('today', at('2026-11-10')), { from: '2026-11-10', to: '2026-11-10' })
  assert.deepEqual(execPreviousRange('today', at('2026-11-10')), { from: '2026-11-09', to: '2026-11-09' })
  assert.deepEqual(execPeriodRange('7d', at('2026-11-10')), { from: '2026-11-04', to: '2026-11-10' })
  assert.deepEqual(execPreviousRange('7d', at('2026-11-10')), { from: '2026-10-28', to: '2026-11-03' })
})

test('7 วันข้ามสิ้นเดือน/ปี: ย้อนผ่านวันที่ 1 และ 1 ม.ค. ถูก', () => {
  assert.deepEqual(execPeriodRange('7d', at('2026-03-03')), { from: '2026-02-25', to: '2026-03-03' })
  assert.deepEqual(execPreviousRange('7d', at('2026-03-03')), { from: '2026-02-18', to: '2026-02-24' })
  assert.deepEqual(execPeriodRange('7d', at('2027-01-03')), { from: '2026-12-28', to: '2027-01-03' })
})

test('เดือนนี้: 1 ของเดือน..วันนี้ เทียบเดือนก่อนจำนวนวันเท่ากัน (ไม่เทียบทั้งเดือนก่อน)', () => {
  assert.deepEqual(execPeriodRange('month', at('2026-11-10')), { from: '2026-11-01', to: '2026-11-10' })
  assert.deepEqual(execPreviousRange('month', at('2026-11-10')), { from: '2026-10-01', to: '2026-10-10' })
})

test('เดือนนี้ สิ้นเดือน: 31 มี.ค. เทียบ ก.พ. ทั้งเดือน (28 วัน ตัดที่วันสุดท้ายของเดือนก่อน) · 29 ก.พ. ปีอธิกสุรทิน', () => {
  assert.deepEqual(execPreviousRange('month', at('2026-03-31')), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(execPreviousRange('month', at('2028-03-31')), { from: '2028-02-01', to: '2028-02-29' })
  assert.deepEqual(execPreviousRange('month', at('2028-02-29')), { from: '2028-01-01', to: '2028-01-29' })
})

test('เดือนนี้ ม.ค.: เดือนก่อนคือ ธ.ค. ของปีก่อน', () => {
  assert.deepEqual(execPeriodRange('month', at('2027-01-15')), { from: '2027-01-01', to: '2027-01-15' })
  assert.deepEqual(execPreviousRange('month', at('2027-01-15')), { from: '2026-12-01', to: '2026-12-15' })
})

test('ปีงบ: 1 ต.ค.–วันนี้ · ข้ามปีงบ 30 ก.ย. → 1 ต.ค. เริ่มปีงบใหม่', () => {
  assert.deepEqual(execPeriodRange('fy', at('2026-09-30')), { from: '2025-10-01', to: '2026-09-30' })
  assert.deepEqual(execPreviousRange('fy', at('2026-09-30')), { from: '2024-10-01', to: '2025-09-30' })
  assert.deepEqual(execPeriodRange('fy', at('2026-10-01')), { from: '2026-10-01', to: '2026-10-01' })
  assert.deepEqual(execPreviousRange('fy', at('2026-10-01')), { from: '2025-10-01', to: '2025-10-01' })
  assert.deepEqual(execPeriodRange('fy', at('2026-11-10')), { from: '2026-10-01', to: '2026-11-10' })
  assert.deepEqual(execPreviousRange('fy', at('2026-11-10')), { from: '2025-10-01', to: '2025-11-10' })
})

test('ปีงบ ช่วงหลังปีใหม่: ปีงบก่อนใช้วันเดิมของปีปฏิทินก่อนหน้า · 29 ก.พ. → 28 ก.พ.', () => {
  assert.deepEqual(execPeriodRange('fy', at('2027-02-15')), { from: '2026-10-01', to: '2027-02-15' })
  assert.deepEqual(execPreviousRange('fy', at('2027-02-15')), { from: '2025-10-01', to: '2026-02-15' })
  assert.deepEqual(execPreviousRange('fy', at('2028-02-29')), { from: '2026-10-01', to: '2027-02-28' })
})

test('ปีงบ ใช้กติกากลาง fiscalYear.js: วันเริ่มปีงบ 1 ต.ค. · ขอบ 30 ก.ย./1 ต.ค. · ไม่ขึ้นกับโซนเวลาเครื่อง (TZ = Los_Angeles ตั้งไว้ต้นไฟล์)', () => {
  assert.equal(fiscalYearOf(new Date(2026, 8, 30)), 2569)
  assert.equal(fiscalYearOf(new Date(2026, 9, 1)), 2570)
  assert.equal(fiscalYearStart('2026-09-30'), '2025-10-01')
  assert.equal(fiscalYearStart('2026-10-01'), '2026-10-01')
  assert.equal(fiscalYearStart('2026-12-31'), '2026-10-01')
  assert.equal(fiscalYearStart('2027-01-01'), '2026-10-01')
  assert.equal(fiscalYearStart('2027-09-30'), '2026-10-01')
})

test('ทุกช่วงให้ from <= to และรูปแบบ YYYY-MM-DD · ช่วงที่ไม่รู้จัก = error', () => {
  for (const p of EXEC_PERIODS) {
    for (const r of [execPeriodRange(p, at('2026-11-10')), execPreviousRange(p, at('2026-11-10'))]) {
      assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/)
      assert.match(r.to, /^\d{4}-\d{2}-\d{2}$/)
      assert.ok(r.from <= r.to, `${p}: from > to`)
    }
  }
  assert.throws(() => execPeriodRange('week', at('2026-11-10')))
})

test('ข้อความช่วงวันที่: วันเดียวไม่เขียน "10 – 10"', () => {
  assert.equal(execRangeText({ from: '2026-11-10', to: '2026-11-10' }), '10 พ.ย. 2569')
  assert.equal(execRangeText({ from: '2026-10-01', to: '2026-11-10' }), '1 ต.ค. – 10 พ.ย. 2569')
})

// ── ชีพจร ────────────────────────────────────────────────────────────────────

const complaintStats = { total: 10, open: 3, in_progress: 2, resolved: 4, rejected: 1, parked: 2, avg_days: 3.2 }
const docStats = { total: 5, pending: 1, processing: 1, completed: 2, rejected: 1, avg_days: 1.5 }

test('ชีพจร: ยังไม่เสร็จ = คำร้อง(open+in_progress+parked) + คำขอ(pending+processing) · เสร็จ = resolved + completed', () => {
  assert.deepEqual(summarizePulse({ complaints: complaintStats, docs: docStats }), { new: 15, open: 9, done: 6, parked: 2 })
})

test('ชีพจร: ไม่รวมค่าเฉลี่ยวันข้ามสองชุด · แหล่งที่ปิดโมดูล (null) ไม่นับ', () => {
  const pulse = summarizePulse({ complaints: complaintStats, docs: docStats })
  assert.equal('avgDays' in pulse, false)
  assert.equal('avg_days' in pulse, false)
  assert.deepEqual(summarizePulse({ complaints: complaintStats, docs: null }), { new: 10, open: 7, done: 4, parked: 2 })
  assert.deepEqual(summarizePulse({ complaints: null, docs: docStats }), { new: 5, open: 2, done: 2, parked: 0 })
  assert.deepEqual(summarizePulse({}), { new: 0, open: 0, done: 0, parked: 0 })
})

test('ชีพจร: ค่าผิดรูป (ลบ/ข้อความ/null) = 0 · ไม่มีคีย์ parked = 0 · avg_days ว่าง = null (ไม่ใช่ 0)', () => {
  assert.deepEqual(summarizePulse({ complaints: { total: -4, open: 'x', in_progress: null, resolved: undefined } }), { new: 0, open: 0, done: 0, parked: 0 })
  assert.equal(normalizeComplaintStats({ total: 3, avg_days: null }).avgDays, null)
  assert.equal(normalizeComplaintStats({ total: 3, avg_days: 0 }).avgDays, 0)
})

test('ลูกศรเทียบ: ทิศ/ผลต่าง/เปอร์เซ็นต์ · ช่วงก่อนเป็น 0 ไม่คิดเปอร์เซ็นต์', () => {
  assert.deepEqual(compareValues(12, 10), { current: 12, previous: 10, diff: 2, dir: 'up', pct: 20 })
  assert.equal(compareValues(5, 10).dir, 'down')
  assert.equal(compareValues(5, 10).pct, -50)
  assert.equal(compareValues(7, 7).dir, 'flat')
  assert.equal(compareValues(3, 0).pct, null)
  assert.equal(compareValues(3, 0).dir, 'up')
})

// ── ตาราง ②-2 ────────────────────────────────────────────────────────────────

const doc = (docType, status, days = null) => ({ doc_type: docType, status, created_at: '2026-11-02T03:00:00Z', issued_at: null, days_taken: days })
const tenantBase = { fee_schedule: {} }
const rowOf = (rows, id) => rows.find((r) => r.id === id)

test('ประเภทที่เปิดอยู่แต่ไม่มีเรื่อง แสดง 0 ไม่ซ่อน · แถวคำร้องมาก่อนแถวคำขอเสมอ', () => {
  const rows = buildServiceRows({ complaintStats, docRows: [doc('tax_notice', 'pending')], tenant: tenantBase })
  assert.equal(rows[0].id, 'complaints')
  assert.equal(rows[0].total, 10)
  assert.equal(rows[0].open, 7)
  const water = rowOf(rows, 'doc:water_supply_request')
  assert.ok(water, 'ประเภทประปาที่เปิดอยู่ต้องมีแถว')
  assert.equal(water.total, 0)
  assert.equal(water.avgDays, null)
  assert.equal(water.closed, false)
  assert.equal(rowOf(rows, 'doc:tax_notice').open, 1)
})

test('คอลัมน์ E1: ยื่น/ยังไม่เสร็จ/เสร็จ/ปฏิเสธ + เวลาเฉลี่ยเฉพาะเรื่องที่เสร็จ (ปัด 1 ตำแหน่ง)', () => {
  const rows = buildServiceRows({
    complaintStats: null,
    docRows: [doc('tax_notice', 'pending'), doc('tax_notice', 'processing'), doc('tax_notice', 'completed', '1.0'), doc('tax_notice', 'completed', '2.5'), doc('tax_notice', 'rejected', '9')],
    tenant: tenantBase,
  })
  const r = rowOf(rows, 'doc:tax_notice')
  assert.deepEqual([r.total, r.open, r.done, r.rejected, r.avgDays], [5, 2, 2, 1, 1.8])
  assert.equal(rows.some((x) => x.id === 'complaints'), false, 'complaintStats = null → ไม่มีแถวคำร้อง')
})

test('ประเภทที่ อปท. ปิดรับแล้วแต่ยังมีเรื่องในช่วงนั้น → แสดงพร้อมธง closed · ปิดแล้วไม่มีเรื่อง → ไม่แสดง', () => {
  const tenant = { fee_schedule: { _removed_types: ['building_permit', 'cctv_footage_request'] } }
  const rows = buildServiceRows({ complaintStats: null, docRows: [doc('building_permit', 'completed', 4)], tenant })
  const bp = rowOf(rows, 'doc:building_permit')
  assert.ok(bp)
  assert.equal(bp.closed, true)
  assert.equal(bp.total, 1)
  assert.equal(rowOf(rows, 'doc:cctv_footage_request'), undefined, 'ปิดแล้วและไม่มีเรื่อง ต้องไม่แสดง')
})

test('ประเภทที่ อปท. เพิ่มเอง ตกที่รายการคำขอบริการ (inbox) · มีชื่อไทยของ อปท. เอง', () => {
  const tenant = { fee_schedule: { _custom_types: [{ value: 'custom_pet', label: 'ขึ้นทะเบียนสัตว์เลี้ยง', emoji: '🐕' }] } }
  const rows = buildServiceRows({ complaintStats: null, docRows: [doc('custom_pet', 'pending')], tenant })
  const r = rowOf(rows, 'doc:custom_pet')
  assert.ok(r, 'ประเภทที่เพิ่มเองต้องมีแถว')
  assert.equal(r.label, 'ขึ้นทะเบียนสัตว์เลี้ยง')
  assert.equal(r.owner.key, 'inbox')
  assert.equal(r.closed, false)
  assert.equal(ownerOfDocType('custom_pet').key, 'inbox')
  // เพิ่มเองแล้วยังไม่มีเรื่อง = แสดง 0 ไม่ซ่อน
  const none = buildServiceRows({ complaintStats: null, docRows: [], tenant })
  assert.equal(rowOf(none, 'doc:custom_pet').total, 0)
})

test('ประเภทไม่รู้จักที่มีเรื่อง (เช่น ประเภทเก่าที่ตัดออกแล้ว) แสดงชื่อไทยและตกที่ inbox · ไม่หายเงียบ', () => {
  const rows = buildServiceRows({ complaintStats: null, docRows: [doc('residence_cert', 'completed', 1), doc('mystery_type', 'pending')], tenant: tenantBase })
  assert.equal(rowOf(rows, 'doc:residence_cert').label, 'ใบรับรองการอยู่อาศัย')
  assert.equal(rowOf(rows, 'doc:residence_cert').closed, true)
  assert.equal(rowOf(rows, 'doc:mystery_type').owner.key, 'inbox')
  assert.equal(docTypeLabelOf('building_permit', tenantBase), 'ขออนุญาตก่อสร้างบ้าน', 'ตัดอีโมจิหน้าชื่อ')
})

test('โมดูลเจ้าของปิด (งานประปา/รถผู้ป่วย): ไม่มีเรื่อง → ไม่แสดง · มีเรื่องเก่า → แสดงพร้อมธง closed', () => {
  const isModuleEnabled = (key) => !['waterworks', 'patient-transport'].includes(key)
  const quiet = buildServiceRows({ complaintStats: null, docRows: [], tenant: tenantBase, isModuleEnabled })
  assert.equal(rowOf(quiet, 'doc:water_supply_request'), undefined)
  assert.equal(rowOf(quiet, 'doc:patient_transport_request'), undefined)
  assert.ok(rowOf(quiet, 'doc:tax_notice'))
  const busy = buildServiceRows({ complaintStats: null, docRows: [doc('water_meter_change', 'completed', 3)], tenant: tenantBase, isModuleEnabled })
  assert.equal(rowOf(busy, 'doc:water_meter_change').closed, true)
  assert.equal(rowOf(busy, 'doc:water_meter_change').owner.key, 'waterworks')
})

test('ทุกแถวคำขอมีเจ้าของสำหรับทำลิงก์ (owner.link)', () => {
  const rows = buildServiceRows({ complaintStats: complaintStats, docRows: [doc('mystery_type', 'pending')], tenant: tenantBase, complaintEntry: EXECUTIVE_REGISTRY.find((e) => e.key === 'complaints') })
  for (const r of rows) assert.ok(r.owner?.link, `แถว ${r.id} ไม่มี owner.link`)
})

test('ไม่ส่งคอลัมน์ purpose ต่อ (PDPA): projectDocRows ทิ้งข้อความของผู้ยื่น · projectComplaintRows ไม่เก็บเลขที่เรื่อง', () => {
  const out = projectDocRows([{ ref_id: 'abc12345', doc_type: 'tax_notice', purpose: 'ชื่อ-สกุล เบอร์โทร 081', status: 'pending', created_at: 'x', issued_at: null, days_taken: null }])
  assert.deepEqual(Object.keys(out[0]).sort(), ['created_at', 'days_taken', 'doc_type', 'issued_at', 'status'])
  assert.equal(JSON.stringify(out).includes('เบอร์โทร'), false)
  const c = projectComplaintRows([{ ref_id: 'R-1', category: 'light', status: 'new', created_at: 'x', closed_at: null, days_taken: null }])
  assert.equal('ref_id' in c[0], false)
  assert.deepEqual(projectDocRows(null), [])
})

// ── ถูกตัด (truncated) ───────────────────────────────────────────────────────

test('แถวรายเรื่องถูกตัด: ครบ limit 5000 / ได้น้อยกว่ายอดรวม (เซิร์ฟเวอร์ตัดที่ 1000) = true · ครบแล้ว = false', () => {
  assert.equal(rowsTruncated(5000), true)
  assert.equal(rowsTruncated(1000, { knownTotal: 1500 }), true, 'max_rows ของ Supabase = 1000 ขอ 5000 ก็ได้ 1000')
  assert.equal(rowsTruncated(30, { knownTotal: 30 }), false)
  assert.equal(rowsTruncated(30), false)
  assert.equal(rowsTruncated(30, { knownTotal: null }), false)
  assert.equal(rowsTruncated(4999, { limit: 5000, knownTotal: 4999 }), false)
})

// ── หมวดปัญหา ②-4 ────────────────────────────────────────────────────────────

test('หมวดปัญหา: top 8 + "อื่นๆ" รวมที่เหลือ · หมวด other และไม่มีหมวด รวมเข้า "อื่นๆ"', () => {
  const rows = []
  const add = (category, n) => { for (let i = 0; i < n; i++) rows.push({ category }) }
  ;['road', 'light', 'trash', 'drain', 'flood', 'tree', 'noise', 'canal', 'mosquito', 'building'].forEach((c, i) => add(c, 20 - i)) // 10 หมวด
  add('other', 4)
  add(null, 2)
  const out = categoryCounts(rows)
  assert.equal(out.length, 9)
  assert.deepEqual(out.slice(0, 3).map((c) => [c.key, c.count]), [['road', 20], ['light', 19], ['trash', 18]])
  const rest = out.at(-1)
  assert.equal(rest.isRest, true)
  assert.equal(rest.label, 'อื่นๆ')
  // หมวดอันดับ 9-10 (mosquito 12 + building 11) + other 4 + ไม่มีหมวด 2
  assert.equal(rest.count, 12 + 11 + 4 + 2)
  assert.equal(out.reduce((s, c) => s + c.count, 0), rows.length, 'ผลรวมต้องเท่าจำนวนเรื่อง')
  assert.equal(out.filter((c) => c.label === 'อื่นๆ').length, 1, 'ห้ามมี "อื่นๆ" ซ้ำสองแถว')
})

test('หมวดปัญหา: ไม่เกิน 8 หมวดไม่มีแถวอื่นๆ · ใช้ชื่อไทยของ อปท. ก่อน ไม่มีชื่อใช้ชื่อมาตรฐาน (ไม่หลุดเป็นรหัสดิบ)', () => {
  const out = categoryCounts([{ category: 'light' }, { category: 'light' }, { category: 'road' }], { labels: { light: 'ไฟข้างทาง (ตั้งเอง)' } })
  assert.deepEqual(out.map((c) => [c.label, c.count]), [['ไฟข้างทาง (ตั้งเอง)', 2], ['ถนน/ทางสาธารณะ', 1]])
  assert.deepEqual(categoryCounts([]), [])
})

test('ลักษณะย่อยหมวดไฟฟ้า: ว่าง = "ไม่ระบุลักษณะ" · ตัดยอด 0', () => {
  assert.deepEqual(issueBreakdownRows([{ issue_label: 'ไฟดับทั้งดวง', total: 5 }, { issue_label: null, total: '2' }, { issue_label: 'ไฟกระพริบ', total: 0 }]),
    [{ label: 'ไฟดับทั้งดวง', total: 5 }, { label: 'ไม่ระบุลักษณะ', total: 2 }])
  assert.deepEqual(issueBreakdownRows(null), [])
})

// ── ทะเบียน × เฟส ────────────────────────────────────────────────────────────

test('liveEntries: เฟส E1 เท่านั้น · โมดูลที่ปิดไม่ขึ้น · แหล่งข้อมูล (src:) ไม่ผูกโมดูล', () => {
  const all = liveEntries(() => true, 'E1')
  assert.ok(all.every((e) => e.phase === 'E1'))
  assert.ok(all.some((e) => e.key === 'src:esign'))
  assert.equal(all.some((e) => e.key === 'projects'), false, 'projects เป็น E2')
  const noComplaints = liveEntries((key) => key !== 'complaints', 'E1')
  assert.equal(noComplaints.some((e) => e.key === 'complaints'), false)
  assert.ok(noComplaints.some((e) => e.key === 'src:esign'))
})

test('liveEntries เฟส E2: รายการ E1+E2 ขึ้นจอ · ไม่มีรายการเฟส E3 · โมดูลที่ปิดยังไม่ขึ้น', () => {
  const all = liveEntries(() => true, 'E2')
  assert.ok(all.every((e) => e.phase === 'E1' || e.phase === 'E2'))
  for (const key of ['projects', 'local-plan', 'borrowable-assets', 'performance', 'src:satisfaction']) {
    assert.ok(all.some((e) => e.key === key), `${key} ต้องขึ้นใน E2`)
  }
  assert.equal(liveEntries((key) => key !== 'projects', 'E2').some((e) => e.key === 'projects'), false)
})

// ── สิทธิ์เปิดห้อง ───────────────────────────────────────────────────────────

test('ผู้บริหารของห้อง: viewer + ปลัด/รองปลัด (ตำแหน่งหมวด top_admin) ไม่ว่า role เป็น officer หรือ admin', () => {
  assert.equal(isExecutiveHomeDefault({ role: 'viewer' }), true)
  assert.equal(isExecutiveHomeDefault({ role: 'officer', positionCategory: 'top_admin' }), true, 'ปลัด role officer')
  assert.equal(isExecutiveHomeDefault({ role: 'admin', positionCategory: 'top_admin' }), true, 'ปลัด role admin (seed ตำแหน่งมาตรฐาน)')
  assert.equal(isExecutiveHomeDefault({ role: 'superadmin', positionCategory: 'top_admin' }), true)
  assert.equal(isExecutiveHomeDefault({ role: 'officer', positionCategory: 'dept_head' }), false)
  assert.equal(isExecutiveHomeDefault({ role: 'officer', positionCategory: null }), false)
  assert.equal(isExecutiveHomeDefault({ role: 'admin', positionCategory: 'dept_head' }), false, 'admin ที่ไม่ใช่ปลัด')
  assert.equal(isExecutiveHomeDefault({ role: 'admin' }), false)
  assert.equal(isExecutiveHomeDefault({ role: 'citizen', positionCategory: 'top_admin' }), false, 'ไม่ใช่กลุ่มเจ้าหน้าที่')
  assert.equal(isExecutiveHomeDefault(), false)
})

test('ใครเปิดห้องได้: ผู้บริหารตามข้างบน + admin/superadmin ทุกคน · เจ้าหน้าที่ทั่วไปไม่เห็นทางเข้า', () => {
  assert.equal(canOpenExecutiveHome({ role: 'admin' }), true)
  assert.equal(canOpenExecutiveHome({ role: 'admin', positionCategory: 'dept_head' }), true, 'admin ที่ไม่ใช่ปลัดเปิดดูได้')
  assert.equal(canOpenExecutiveHome({ role: 'superadmin' }), true)
  assert.equal(canOpenExecutiveHome({ role: 'viewer' }), true)
  assert.equal(canOpenExecutiveHome({ role: 'officer', positionCategory: 'top_admin' }), true)
  assert.equal(canOpenExecutiveHome({ role: 'officer', positionCategory: 'dept_head' }), false)
  for (const role of ['officer', 'staff', 'technician', 'council']) assert.equal(canOpenExecutiveHome({ role }), false, role)
  assert.equal(canOpenExecutiveHome(), false)
})

// ── หลังล็อกอินพาไปไหน ───────────────────────────────────────────────────────

// client จำลอง: session + ตาราง profiles/positions (นับจำนวนครั้งที่ถามตำแหน่งด้วย)
function fakeClient({ uid = 'u1', profile = null, category = null, profileError = null, positionError = null, hang = false } = {}) {
  const calls = { positions: 0 }
  const query = (table) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => {
          if (hang) return new Promise(() => {})
          if (table === 'profiles') return Promise.resolve({ data: profile, error: profileError })
          calls.positions += 1
          return Promise.resolve({ data: category == null ? null : { category }, error: positionError })
        },
      }),
    }),
  })
  return { calls, auth: { getSession: async () => ({ data: { session: uid ? { user: { id: uid } } : null } }) }, from: query }
}

await test('หลังล็อกอิน: viewer → /executive (ไม่ต้องถามตำแหน่ง) · ปลัดทุก role เจ้าหน้าที่ → /executive · คนอื่น → /admin', async () => {
  const viewer = fakeClient({ profile: { role: 'viewer', position_id: null } })
  assert.equal(await executiveLandingPath({ client: viewer }), '/executive')
  assert.equal(viewer.calls.positions, 0)
  // ปลัดที่แอดมินตั้ง role อะไรก็ได้ในกลุ่มเจ้าหน้าที่ ต้องถูกอ่านตำแหน่ง (รีวิวรอบ 2: เดิมถามเฉพาะ officer/admin)
  for (const role of ['officer', 'admin', 'staff', 'council', 'technician', 'superadmin']) {
    const c = fakeClient({ profile: { role, position_id: 'p1' }, category: 'top_admin' })
    assert.equal(await executiveLandingPath({ client: c }), '/executive', `ปลัด role ${role}`)
  }
  assert.equal(await executiveLandingPath({ client: fakeClient({ profile: { role: 'admin', position_id: 'p2' }, category: 'dept_head' }) }), '/admin')
  assert.equal(await executiveLandingPath({ client: fakeClient({ profile: { role: 'admin', position_id: null } }) }), '/admin')
  const citizen = fakeClient({ profile: { role: 'citizen', position_id: 'p3' }, category: 'top_admin' })
  assert.equal(await executiveLandingPath({ client: citizen }), '/admin', 'ประชาชนไม่ถามตำแหน่ง')
  assert.equal(citizen.calls.positions, 0)
  assert.equal(await executiveLandingPath({ client: fakeClient({ profile: { role: 'citizen' } }), fallback: '/' }), '/', 'fallback ที่ผู้เรียกกำหนด')
})

test('ตัวอ่านตำแหน่งครอบทุก role ที่กฎนับเป็นปลัดได้ (กันกฎกับตัวอ่านเพี้ยนกันอีก)', () => {
  for (const role of STAFF_PORTAL_ROLES) {
    const byRule = isExecutiveHomeDefault({ role, positionCategory: 'top_admin' })
    assert.ok(role === 'viewer' || !byRule || EXEC_POSITION_LOOKUP_ROLES.includes(role), `role ${role} นับเป็นปลัดได้แต่ไม่มีใครอ่านตำแหน่ง`)
  }
  assert.ok(!EXEC_POSITION_LOOKUP_ROLES.includes('viewer'))
  assert.ok(!EXEC_POSITION_LOOKUP_ROLES.includes('citizen'))
})

test('คีย์ "เพิ่งล็อกอิน OAuth จากหน้าแรก" หมดอายุใน 10 นาที · ค่าเสีย/อนาคต = ไม่นับ', () => {
  const now = 1_800_000_000_000
  assert.equal(isFreshExecOauthCheck(String(now - 1000), now), true)
  assert.equal(isFreshExecOauthCheck(String(now - EXEC_OAUTH_CHECK_TTL_MS), now), true)
  assert.equal(isFreshExecOauthCheck(String(now - EXEC_OAUTH_CHECK_TTL_MS - 1), now), false, 'ค้างเกิน 10 นาที (กด LINE แล้วยกเลิก)')
  assert.equal(isFreshExecOauthCheck(String(now + 5000), now), false, 'เวลาอนาคต')
  for (const bad of [null, undefined, '', 'abc', '0', '-5']) assert.equal(isFreshExecOauthCheck(bad, now), false, `ค่า ${bad}`)
})

await test('หลังล็อกอิน: ผิดพลาด/ไม่มี session/ช้าเกิน = ปลายทางเดิม', async () => {
  assert.equal(await executiveLandingPath({ client: fakeClient({ profile: { role: 'viewer' }, profileError: { message: 'x' } }) }), '/admin')
  assert.equal(await executiveLandingPath({ client: fakeClient({ profile: { role: 'officer', position_id: 'p1' }, category: 'top_admin', positionError: { message: 'x' } }) }), '/admin')
  assert.equal(await executiveLandingPath({ client: fakeClient({ uid: null }) }), '/admin')
  assert.equal(await executiveLandingPath({ client: { auth: { getSession: async () => { throw new Error('net') } } } }), '/admin')
  const started = Date.now()
  assert.equal(await executiveLandingPath({ client: fakeClient({ hang: true }), timeoutMs: 50 }), '/admin', 'ค้าง → timeout')
  assert.ok(Date.now() - started < 1000, 'ไม่รอเกิน timeout มาก')
})

test('ตาราง ②-2: แสดงเฉพาะแถวที่มีเรื่อง แถว 0 แยกไว้ให้กดแสดง (รวมแถวคำร้อง) และคงลำดับเดิม', () => {
  const rows = [
    { id: 'complaints', total: 0 },
    { id: 'doc:tax_notice', total: 3 },
    { id: 'doc:building_permit', total: 0 },
    { id: 'doc:cctv_footage_request', total: 1 },
  ]
  const { withData, empty } = splitServiceRows(rows)
  assert.deepEqual(withData.map((r) => r.id), ['doc:tax_notice', 'doc:cctv_footage_request'])
  assert.deepEqual(empty.map((r) => r.id), ['complaints', 'doc:building_permit'])
  assert.deepEqual(splitServiceRows([]), { withData: [], empty: [] })
  assert.deepEqual(splitServiceRows(undefined), { withData: [], empty: [] })
  // E2: ไม่มีเรื่องยื่นในช่วงนี้ แต่ยังมีเรื่องเลยกำหนดค้าง → ต้องขึ้น (ไม่งั้นยอดบนการ์ดชีพจรไปซ่อนหลังปุ่ม "ไม่มีเรื่อง")
  const e2 = splitServiceRows([{ id: 'a', total: 0, overdue: 2 }, { id: 'b', total: 0, overdue: 0 }, { id: 'c', total: 0, overdue: null }])
  assert.deepEqual(e2.withData.map((r) => r.id), ['a'])
  assert.deepEqual(e2.empty.map((r) => r.id), ['b', 'c'])
})

// ═════════════════════════ เฟส E2 — executive_overview() ═════════════════════════
// วันนี้คงที่ 2026-11-10 (อังคาร) — ตารางวันหยุดชั้น static ไม่มีวันหยุดตั้งแต่ 1 พ.ย. ถึง 10 พ.ย. 2569 · ต.ค. 69 มีวันที่ 13 และ 23

const E2 = await import('../src/lib/executiveData.js')
const {
  EXEC_ALERT_RULE_KEYS, EXEC_NO_DEPT_KEY, backlogAnalysis, backlogByType, buildAlerts, buildDecisionQueue, buildDeptRows, buildExecModel,
  compareMetric, decorateServiceRows, deriveExec, execAverage, execDateOnly, execPercent, execSummaryKeys, normalizeComplaintsSummary,
  normalizeDocRequestsSummary, onTimeSummary, planResultMissingCount, projectStageRows, satisfactionView, sumOnTime, upcomingEvents,
  thaiDayLabel, waitText, waitingWorkdays,
} = E2
const { isPhaseLive } = await import('../src/lib/executiveRegistry.js')
const NOW = '2026-11-10'

const complaintsRaw = {
  period: { total: 11, citizen_online: 10, oss_counter: 1, confidential: 1, adhoc: 1 },
  villages: [{ village: 'หมู่ 1', n: 6 }, { village: 'บ้านดอน', n: 1 }],
  villages_unlisted: 2,
  on_time: { completed: 3, on_time: 2, late: 1, no_due: 0, open_past_due: 3, undated: 0, as_of: NOW },
  backlog: [
    { s: 'new', due: '2026-11-12', c: '2026-11-09', u: true, n: 2 },
    { s: 'new', due: '2026-11-02', c: '2026-11-02', u: true, n: 1 },
    { s: 'received', due: '2026-11-05', c: '2026-10-30', u: false, n: 3 },
    { s: 'in_progress', due: null, c: '2026-10-12', u: false, n: 1 },
    { s: 'in_progress', due: '2026-10-01', c: null, u: false, n: 2 },
  ],
  parked: { n: 1, by_reason: { budget: 1 } },
  repeat: { days: 90, min: 3, groups: [{ category: 'road', label: 'ถนนชำรุด', village: 'หมู่ 1', n: 5 }] },
}

test('ค้างอยู่ตอนนี้: เลยกำหนด (วันปฏิทิน) / เกิน 5 วันทำการ / ยังไม่มีผู้รับผิดชอบ / อายุวันทำการ / ขั้นที่ค้างมากสุด', () => {
  const a = backlogAnalysis(normalizeComplaintsSummary(complaintsRaw).backlog, NOW)
  assert.equal(a.total, 9)
  assert.equal(a.overdue, 6, 'due < วันนี้: 1 + 3 + 2')
  // 11-02 → 11-10 = 6 วันทำการ (>5 นับ) · 11-05 → 11-10 = 3 (ไม่นับ) · 10-01 ไกลกว่า 5 แน่นอน (นับ 2)
  assert.equal(a.overdue5wd, 3)
  assert.equal(a.unassigned, 3)
  assert.equal(a.ageUnknown, 2, 'แถวไม่มีวันที่แจ้งไม่เข้ากลุ่มอายุ')
  assert.deepEqual(a.ageBuckets.map((b) => [b.key, b.n]), [['0-3', 2], ['4-7', 4], ['8-15', 0], ['15+', 1]])
  assert.deepEqual(a.stages, [
    { s: 'new', n: 3, avgAge: 2.7 },        // (1×2 + 6×1) ÷ 3
    { s: 'received', n: 3, avgAge: 7 },
    { s: 'in_progress', n: 3, avgAge: 19 }, // ถ่วงเฉพาะเรื่องที่รู้วันที่แจ้ง
  ])
  assert.equal(a.worstStage, 'in_progress', 'ค้างเท่ากัน 3 ขั้น → ขั้นที่อายุเฉลี่ยสูงสุด')
  assert.equal(a.avgAge, 6.9)
})

test('ค้างอยู่ตอนนี้: เลยกำหนดเกิน 5 วันทำการต้อง "มากกว่า" 5 (ครบ 5 พอดีไม่นับ) และเลยกำหนดวันนี้ไม่นับเป็นเลยกำหนด', () => {
  const rows = [
    { s: 'new', due: '2026-11-03', c: '2026-11-03', u: false, n: 1 }, // 5 วันทำการพอดี
    { s: 'new', due: '2026-11-10', c: '2026-11-10', u: false, n: 1 }, // ครบวันนี้ ยังไม่เลย
  ]
  const a = backlogAnalysis(rows, NOW)
  assert.equal(a.overdue, 1)
  assert.equal(a.overdue5wd, 0)
  assert.equal(a.worstStage, 'new')
})

test('ค้างอยู่ตอนนี้: ว่าง/ผิดรูป → ศูนย์ ไม่พัง · worstStage null', () => {
  for (const bad of [null, undefined, [], [{ n: 0 }], [null], 'x']) {
    const a = backlogAnalysis(bad, NOW)
    assert.equal(a.total, 0)
    assert.equal(a.worstStage, null)
    assert.equal(a.avgAge, null)
    assert.deepEqual(a.stages, [])
  }
})

test('คำขอค้างรายประเภท: นับเลยกำหนดแยกประเภท', () => {
  const m = backlogByType([
    { t: 'tax_notice', s: 'pending', due: '2026-11-01', c: '2026-10-25', n: 2 },
    { t: 'tax_notice', s: 'processing', due: '2026-11-20', c: '2026-11-05', n: 1 },
    { t: 'building_permit', s: 'pending', due: '2026-11-09', c: '2026-11-02', n: 1 },
    { s: 'pending', due: null, c: null, n: 9 }, // ไม่มีประเภท = ข้าม
  ], NOW)
  assert.deepEqual(m.get('tax_notice'), { open: 3, overdue: 2, overdue5wd: 2 })
  assert.deepEqual(m.get('building_permit'), { open: 1, overdue: 1, overdue5wd: 0 })
  assert.equal(m.size, 2)
})

test('% ทันกำหนด = ทัน ÷ (ทัน + เกิน + ค้างที่เลยกำหนด) · ตัวหาร 0 = null (ไม่ใช่ 0/100)', () => {
  assert.equal(onTimeSummary(complaintsRaw.on_time).pct, 33.3, '2 ÷ (2+1+3)')
  assert.equal(onTimeSummary(complaintsRaw.on_time).denominator, 6)
  assert.equal(onTimeSummary({ completed: 0, on_time: 0, late: 0, open_past_due: 0 }).pct, null)
  assert.equal(onTimeSummary(null).pct, null)
  assert.equal(onTimeSummary({ on_time: 5, late: 0, open_past_due: 0 }).pct, 100)
  // ค้างเลยกำหนดต้องอยู่ในตัวหาร (ไม่งั้นปล่อยเรื่องยากค้างแล้ว % ดีขึ้น)
  assert.equal(onTimeSummary({ on_time: 1, late: 0, open_past_due: 1 }).pct, 50)
  // no_due/undated ไม่อยู่ในตัวหาร
  assert.equal(onTimeSummary({ on_time: 1, late: 1, no_due: 7, undated: 3, open_past_due: 0 }).pct, 50)
})

test('รวม % ทันกำหนดหลายชุด: รวมที่ตัวตั้ง/ตัวหาร ไม่เฉลี่ยร้อยละ', () => {
  const a = { on_time: 9, late: 1, open_past_due: 0 }   // 90%
  const b = { on_time: 0, late: 0, open_past_due: 10 }  // 0%
  const sum = sumOnTime([a, b])
  assert.deepEqual(sum, { completed: 0, onTime: 9, late: 1, noDue: 0, openPastDue: 10, undated: 0 })
  assert.equal(onTimeSummary(sum).pct, 45, '9 ÷ 20 ไม่ใช่ (90+0) ÷ 2 ที่บังเอิญเท่ากัน — ใช้ตัวเลขที่ชั่งน้ำหนักต่างกันเช็ค')
  const c = sumOnTime([{ on_time: 1, late: 0, open_past_due: 0 }, { on_time: 0, late: 0, open_past_due: 3 }])
  assert.equal(onTimeSummary(c).pct, 25, 'ไม่ใช่ (100+0)/2 = 50')
  assert.equal(onTimeSummary(sumOnTime([])).pct, null)
})

test('คะแนนเฉลี่ย: sum ÷ cnt ปัด 1 ตำแหน่ง · cnt 0 = null ไม่ใช่ 0 · อัตราตอบ = any_rated ÷ closed', () => {
  assert.equal(execAverage(7, 2), 3.5)
  assert.equal(execAverage(10, 3), 3.3)
  assert.equal(execAverage(0, 0), null)
  assert.equal(execAverage(5, 0), null)
  assert.equal(execAverage(null, null), null)
  assert.equal(execPercent(2, 3), 66.7)
  assert.equal(execPercent(0, 0), null)
  assert.equal(execPercent(3, 0), null)
})

const satRaw = {
  closed: 4, submitters: { citizen: 3 },
  sources: { verified: { complaints: 1, sum: 5, cnt: 1 }, via_link: { complaints: 1, sum: 2, cnt: 1 }, proxy: { complaints: 1, sum: 4, cnt: 1 } },
  genuine: { complaints: 2, sum: 7, cnt: 2 }, any_rated: 3,
  by_dept: [{ dept: 'D1', closed: 2, genuine_sum: 7, genuine_cnt: 2, all_sum: 11, all_cnt: 3 }, { dept: 'D2', closed: 1, genuine_sum: 0, genuine_cnt: 0, all_sum: 0, all_cnt: 0 }],
  general: { n: 1, sum: 1 }, low: { via_link: 1, general: 1 },
}

test('มุมมองคะแนน: เสียงจริงคู่ทุกที่มา + แยกที่มา (ที่มาไม่มีคะแนน = ขีด) + คะแนนต่ำ + อัตราตอบ', () => {
  const v = satisfactionView(E2.normalizeSatisfactionSummary(satRaw))
  assert.equal(v.genuineAvg, 3.5)
  assert.equal(v.genuineCnt, 2)
  assert.equal(v.allAvg, 3.7, '(5+2+4) ÷ 3')
  assert.equal(v.responseRate, 75, '3 ÷ 4')
  assert.deepEqual(v.sources.map((s) => [s.key, s.avg, s.cnt]), [['verified', 5, 1], ['via_link', 2, 1], ['proxy', 4, 1], ['linked_anon', null, 0]])
  assert.equal(v.general.avg, 1)
  assert.equal(v.lowTotal, 2)
  assert.deepEqual(v.low.map((x) => x.label), ['ผู้ถือลิงก์ติดตามเรื่อง', 'แบบประเมินภาพรวม'])
})

test('มุมมองคะแนน: ไม่มีข้อมูล → ขีด (null) ทุกค่า ไม่ใช่ 0', () => {
  const v = satisfactionView(E2.normalizeSatisfactionSummary(null))
  assert.equal(v.genuineAvg, null)
  assert.equal(v.allAvg, null)
  assert.equal(v.responseRate, null)
  assert.equal(v.general.avg, null)
  assert.equal(v.lowTotal, 0)
})

test('แถวรายกอง: ชื่อจากข้อมูล · ไม่มีรหัสกอง = "ไม่ระบุกอง" ท้ายตาราง · คะแนนเสียงจริงรายกอง (ไม่มีคะแนน = null) · ไม่จัดอันดับ', () => {
  const dept = E2.normalizeDepartmentsSummary({
    departments: [
      { id: 'D1', name: 'กองช่าง', short_name: 'ช่าง', complaints: { open: 2, overdue: 1, parked: 1, done: 3 }, docs: { open: 1, overdue: 0, done: 1 } },
      { id: 'D2', name: 'สำนักปลัด', short_name: 'ปลัด', complaints: { open: 0, overdue: 0, parked: 0, done: 0 }, docs: { open: 0, overdue: 0, done: 0 } },
      { id: null, name: null, short_name: null, complaints: { open: 1, overdue: 1, parked: 0, done: 0 }, docs: {} },
    ],
  })
  const rows = buildDeptRows(dept, E2.normalizeSatisfactionSummary(satRaw))
  assert.deepEqual(rows.map((r) => r.name), ['กองช่าง', 'สำนักปลัด', 'ไม่ระบุกอง'], 'คงลำดับจากฐานข้อมูล')
  assert.deepEqual([rows[0].openTotal, rows[0].overdueTotal, rows[0].doneTotal], [3, 1, 4])
  assert.deepEqual(rows[0].rating, { avg: 3.5, cnt: 2, allAvg: 3.7, allCnt: 3 })
  assert.equal(rows[1].rating.avg, null, 'กองที่มีเรื่องปิดแต่ไม่มีคะแนน = ขีด ไม่ใช่ 0')
  assert.equal(rows[2].rating, null)
  assert.equal(rows[2].key, EXEC_NO_DEPT_KEY)
  assert.deepEqual(buildDeptRows(null, null), [])
})

test('model: คีย์ที่ไม่ได้ขอ = missing · ok:false = error เฉพาะคีย์นั้น · ok ปรับรูปแล้ว · ผิดรูปไม่พัง', () => {
  const model = buildExecModel({
    complaints: { ok: true, data: complaintsRaw },
    fleet: { ok: false, error: '22012' },
    water: { ok: true, data: null },
    projects: { ok: true, data: { by_stage: { construction: '3', budgeted: null }, schedule: { behind: 'x' } } },
    nope: { ok: false, error: 'unknown_key' },
  })
  assert.equal(model.complaints.state, 'ok')
  assert.equal(model.complaints.data.period.total, 11)
  assert.equal(model.fleet.state, 'error')
  assert.equal(model.fleet.data, null)
  assert.equal(model.docRequests.state, 'missing')
  assert.equal(model.water.state, 'ok')
  assert.deepEqual(model.water.data.announcePending, { n: 0, draftedAt: null })
  assert.deepEqual(model.projects.data.byStage, { construction: 3 })
  assert.equal(model.projects.data.schedule.behind, 0)
  assert.deepEqual(Object.keys(buildExecModel(undefined)).sort(), Object.keys(buildExecModel({})).sort())
  assert.equal(buildExecModel(null).complaints.state, 'missing')
})

test('normalizeComplaintsSummary: ทุกช่องว่าง/null = 0 ไม่พัง · หมู่บ้านที่ n=0 หรือชื่อว่างถูกตัด', () => {
  const n = normalizeComplaintsSummary({ villages: [{ village: ' ', n: 3 }, { village: 'หมู่ 2', n: 0 }, { village: 'หมู่ 3', n: 2 }], backlog: [{ s: 'new', n: null }] })
  assert.deepEqual(n.villages, [{ village: 'หมู่ 3', n: 2 }])
  assert.equal(n.villagesUnlisted, 0)
  assert.deepEqual(n.backlog, [])
  assert.deepEqual(n.repeat, { days: 90, min: 3, groups: [] })
  assert.deepEqual(normalizeComplaintsSummary(null).period, { total: 0, citizen_online: 0, oss_counter: 0, confidential: 0, adhoc: 0 })
})

test('execSummaryKeys: ตัดซ้ำ/null · เรียงคงที่ (คีย์แคชต้องเท่ากันทุกรอบ)', () => {
  const entries = [{ summaryKey: 'water' }, { summaryKey: null }, { summaryKey: 'complaints' }, { summaryKey: 'water' }, {}]
  assert.deepEqual(execSummaryKeys(entries), ['complaints', 'water'])
  assert.deepEqual(execSummaryKeys(undefined), [])
})

test('execSummaryKeys จากทะเบียนจริง: ทุก summaryKey ที่ขอมี normalizer (EXEC_MODEL_FIELDS ครบ)', () => {
  const keys = execSummaryKeys(liveEntries(() => true, 'E2'))
  for (const k of keys) assert.ok(E2.EXEC_MODEL_FIELDS[k], `คีย์ ${k} ไม่มี normalizer`)
})

test('ตาราง ②-2 รุ่น E2: แถวคำขอจาก by_type (นับในฐานข้อมูล) + เลยกำหนด/% ทันกำหนด รายแถว', () => {
  const docs = normalizeDocRequestsSummary({
    by_type: [
      { t: 'building_permit', total: 3, pending: 0, processing: 1, completed: 1, rejected: 1, avg_days: 2 },
      { t: 'waste_collection', total: 2, pending: 1, processing: 0, completed: 1, rejected: 0, avg_days: null },
    ],
    on_time: { by_type: [
      { t: 'building_permit', completed: 1, on_time: 1, late: 0, no_due: 0, open_past_due: 0, undated: 0 },
      { t: 'waste_collection', completed: 1, on_time: 0, late: 1, no_due: 0, open_past_due: 1, undated: 0 },
    ] },
    backlog: [{ t: 'waste_collection', s: 'pending', due: '2026-11-08', c: '2026-11-01', n: 1 }, { t: 'building_permit', s: 'processing', due: '2026-11-30', c: '2026-11-05', n: 1 }],
    entered: { citizen: 2, council: 1, staff: 1, unknown: 1 },
  })
  const model = buildExecModel({ complaints: { ok: true, data: complaintsRaw }, doc_requests: { ok: true, data: { by_type: [], on_time: { by_type: [] }, backlog: [] } } })
  model.docRequests = { state: 'ok', data: docs }
  const base = buildServiceRows({ complaintStats: { total: 11, open: 3, in_progress: 1, resolved: 3, rejected: 1, avg_days: 4 }, docByType: docs.byType, tenant: tenantBase })
  const rows = decorateServiceRows(base, { model, today: NOW })
  const bp = rows.find((r) => r.docType === 'building_permit')
  const wc = rows.find((r) => r.docType === 'waste_collection')
  const cr = rows.find((r) => r.kind === 'complaint')
  assert.deepEqual([bp.total, bp.open, bp.done, bp.rejected, bp.avgDays], [3, 1, 1, 1, 2])
  assert.deepEqual([wc.total, wc.open, wc.done, wc.avgDays], [2, 1, 1, null], 'ไม่มีเรื่องที่เสร็จ = null ไม่ใช่ 0')
  assert.deepEqual([bp.overdue, bp.onTimePct], [0, 100])
  assert.deepEqual([wc.overdue, wc.onTimePct], [1, 0], 'ทัน 0 ÷ (0 + เกิน 1 + ค้างเลย 1) = 0%')
  assert.deepEqual([cr.overdue, cr.onTimePct], [6, 33.3])
  // ประเภทที่เปิดอยู่แต่ไม่มีเรื่อง: แสดง 0 · เลยกำหนด 0 · % = null (ขีด)
  const tax = rows.find((r) => r.docType === 'tax_notice')
  assert.deepEqual([tax.total, tax.overdue, tax.onTimePct], [0, 0, null])
  // การ์ดคำขอโหลดไม่ได้ = ขีด ไม่ใช่ 0
  const failed = decorateServiceRows(base, { model: { ...model, docRequests: { state: 'error', data: null } }, today: NOW })
  assert.deepEqual([failed.find((r) => r.docType === 'tax_notice').overdue, failed.find((r) => r.docType === 'tax_notice').onTimePct], [null, null])
})

test('รอตัดสิน ①: รอมากี่วันทำการจากวันที่ที่ข้อมูลให้ · timestamp แปลงเป็นวันที่ไทย · ไม่มีวันที่ = null (ไม่เดา)', () => {
  assert.equal(waitingWorkdays('2026-11-05', NOW), 3)   // 6,9,10
  assert.equal(waitingWorkdays('2026-11-10', NOW), 0)
  assert.equal(waitingWorkdays(null, NOW), null)
  assert.equal(waitingWorkdays('ไม่ใช่วันที่', NOW), null)
  // 17:30Z ของ 9 พ.ย. = 00:30 ของวันที่ 10 ไทย
  assert.equal(execDateOnly('2026-11-09T17:30:00Z'), '2026-11-10')
  assert.equal(waitingWorkdays('2026-11-09T17:30:00Z', NOW), 0)
  assert.equal(waitText(0), 'ตั้งแต่วันนี้')
  assert.equal(waitText(3), 'รอมา 3 วันทำการ')
  assert.equal(waitText(null), null)
})

function modelOf(raw) {
  return buildExecModel(raw)
}

test('คิวรอตัดสิน ①: แสดงเฉพาะที่มีเรื่อง · เกิน 2 วันทำการขึ้น warn (ครบ 2 ยังไม่ warn) · ร่างแผนไม่มีวันที่ = ไม่แสดงวันรอ', () => {
  const model = modelOf({
    borrowable_assets: { ok: true, data: { submitted: 2, oldest_submitted_on: '2026-11-05', settlement: 1 } },
    projects: { ok: true, data: { change_pending: { n: 1, oldest_on: '2026-11-06' } } },   // 6 → 10 พ.ย. = 2 วันทำการ (9,10)
    water: { ok: true, data: { announce_pending: { n: 1, drafted_at: '2026-11-09T17:30:00Z' }, open_events: { n: 0 } } },
    local_plan: { ok: true, data: { op_drafts: { n: 2 }, dev_drafts: 1, current_fy: null } },
  })
  const { items, failures } = buildDecisionQueue({ entries: liveEntries(() => true, 'E2'), model, today: NOW })
  assert.deepEqual(failures, [])
  const by = Object.fromEntries(items.map((i) => [i.id, i]))
  assert.equal(by['borrowable-assets:awaiting'].count, 2)
  assert.equal(by['borrowable-assets:awaiting'].waitDays, 3)
  assert.equal(by['borrowable-assets:awaiting'].warn, true)
  assert.equal(by['borrowable-assets:settlement'].waitDays, null)
  assert.equal(by['projects:change_pending'].waitDays, 2)
  assert.equal(by['projects:change_pending'].warn, false, 'ครบ 2 วันทำการพอดี ยังไม่ส้ม (เกิน 2 ถึงส้ม)')
  assert.equal(by['water-situation:announce_pending'].waitDays, 0)
  assert.equal(by['local-plan:drafts'].count, 3)
  assert.equal(by['local-plan:drafts'].waitDays, null)
  assert.ok(items.every((i) => i.kpi.formula.length > 8 && i.entry.link), 'ทุกรายการมีสูตร ⓘ และลิงก์จากทะเบียน')
})

test('คิวรอตัดสิน ①: ไม่มีเรื่อง = ว่าง · การ์ดโหลดไม่ได้ = failures (ไม่ปล่อยให้ดูเหมือนไม่มีเรื่อง) · โมดูลปิด = ไม่มีทั้งรายการและ failure', () => {
  const empty = buildDecisionQueue({ entries: liveEntries(() => true, 'E2'), model: modelOf({ borrowable_assets: { ok: true, data: {} } }), today: NOW })
  assert.deepEqual(empty.items, [])
  assert.deepEqual(empty.failures, [])
  const failed = buildDecisionQueue({ entries: liveEntries(() => true, 'E2'), model: modelOf({ projects: { ok: false, error: 'x' } }), today: NOW })
  assert.deepEqual(failed.failures, ['โครงการก่อสร้าง'])
  const closed = buildDecisionQueue({ entries: liveEntries((k) => k !== 'projects', 'E2'), model: modelOf({ projects: { ok: false, error: 'x' } }), today: NOW })
  assert.deepEqual(closed.failures, [])
})

test('สัญญาณเตือน ③: ขึ้นเฉพาะที่มีเรื่อง · critical ก่อน warn ก่อน info · มี rule จากทะเบียนทุกข้อ', () => {
  const model = modelOf({
    complaints: { ok: true, data: complaintsRaw },
    satisfaction: { ok: true, data: satRaw },
    doc_requests: { ok: true, data: { backlog: [{ t: 'tax_notice', s: 'pending', due: '2026-10-01', c: '2026-09-20', n: 4 }] } },
    fleet: { ok: true, data: { maintenance: { overdue: 2, oldest_due_on: '2026-10-20' }, incidents: { damage: 1, loss: 1 } } },
    borrowable_assets: { ok: true, data: { overdue_return: 1, oldest_return_due: '2026-11-01' } },
    projects: { ok: true, data: { schedule: { behind: 1, no_report: 2, stale_report: 1 }, contract: { ending_soon: 2, past_end: 1 } } },
    local_plan: { ok: true, data: { current_fy: { fiscal_year: 2570, published_main: false } } },
    water: { ok: true, data: { open_events: { n: 1, oldest_opened_at: '2026-11-08T03:00:00Z' } } },
  })
  const { items, failures } = buildAlerts({ entries: liveEntries(() => true, 'E2'), model, today: NOW, resultMissing: 4 })
  assert.deepEqual(failures, [])
  const by = Object.fromEntries(items.map((i) => [i.id, i]))
  assert.equal(by['complaints:overdue_5wd'].count, 3)
  assert.equal(by['complaints:low_rating'].count, 2)
  assert.equal(by['inbox:overdue_5wd'].count, 4)
  assert.equal(by['fleet:maintenance_due'].count, 2)
  assert.equal(by['fleet:incidents'].count, 2)
  assert.equal(by['borrowable-assets:overdue_return'].count, 1)
  assert.equal(by['projects:behind'].count, 1)
  assert.equal(by['projects:contract_ending'].count, 2)
  assert.equal(by['projects:contract_past'].count, 1)
  assert.equal(by['projects:report_missing'].count, 3, 'ไม่มีฉบับล็อก 2 + ฉบับเก่าเกิน 14 วัน 1')
  assert.equal(by['local-plan:result_missing'].count, 4)
  assert.equal(by['local-plan:no_published_plan'].showCount, false)
  assert.equal(by['water-situation:event_open'].count, 1)
  assert.match(by['water-situation:event_open'].detail, /เก่าสุดเปิดเมื่อ/)
  const sev = items.map((i) => i.severity)
  assert.deepEqual(sev, [...sev].sort((a, b) => ({ critical: 0, warn: 1, info: 2 }[a] - { critical: 0, warn: 1, info: 2 }[b])))
  assert.equal(sev[0], 'critical')
  assert.ok(items.every((i) => i.rule.length > 8), 'ทุกข้อมีกฎจากทะเบียน (ⓘ)')
})

test('สัญญาณเตือน ③: ไม่มีเรื่อง = ว่างทั้งหมด (โซนไม่ขึ้น) · การ์ดพัง = failures · ไม่มีตัวเลข = ไม่เตือน', () => {
  const calm = buildAlerts({
    entries: liveEntries(() => true, 'E2'),
    model: modelOf({ complaints: { ok: true, data: { backlog: [{ s: 'new', due: '2026-11-20', c: '2026-11-09', n: 3 }] } }, fleet: { ok: true, data: {} }, projects: { ok: true, data: {} } }),
    today: NOW,
  })
  assert.deepEqual(calm.items, [])
  assert.deepEqual(calm.failures, [])
  const broken = buildAlerts({ entries: liveEntries(() => true, 'E2'), model: modelOf({ fleet: { ok: false, error: 'x' }, complaints: { ok: true, data: {} } }), today: NOW })
  assert.deepEqual(broken.items, [])
  assert.deepEqual(broken.failures, ['ยานพาหนะและเชื้อเพลิง'])
})

test('สัญญาณเตือน ③: alert เฟส live ทุกข้อในทะเบียนมีกฎคำนวณ (ไม่งั้นเพิ่มใน PR หน้าแล้วเตือนหายเงียบ)', () => {
  const missing = []
  for (const e of liveEntries(() => true, 'E2')) {
    for (const a of e.alerts) {
      if (isPhaseLive(a.phase, 'E2') && !EXEC_ALERT_RULE_KEYS.includes(`${e.key}:${a.id}`)) missing.push(`${e.key}:${a.id}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('deriveExec: เลยกำหนดรวมคำร้อง+คำขอ · % ทันกำหนดแยกสองแหล่ง (ไม่มีค่ารวม) · การ์ดเดียวพังยังได้อีกชุด', () => {
  const both = deriveExec({
    model: modelOf({
      complaints: { ok: true, data: complaintsRaw },
      doc_requests: { ok: true, data: { on_time: { by_type: [{ t: 'a', on_time: 1, late: 0, open_past_due: 0 }, { t: 'b', on_time: 0, late: 1, open_past_due: 0 }] }, backlog: [{ t: 'a', s: 'pending', due: '2026-11-01', c: '2026-10-29', n: 2 }] } },
    }),
    today: NOW,
  })
  assert.deepEqual([both.overdue.total, both.overdue.complaints, both.overdue.docs, both.overdue.over5wd], [8, 6, 2, 5])
  assert.equal(both.complaintOnTime.pct, 33.3)
  assert.equal(both.docOnTime.pct, 50)
  // คำร้องนับวันทำการ คำขอนับวันปฏิทิน — ห้ามรวมเป็นค่าเดียว (เจ้าของระบบเลือก 2569-11-10)
  assert.equal('onTime' in both, false, 'deriveExec ต้องไม่คืนค่ารวม % ทันกำหนด')
  assert.deepEqual([both.complaintOnTime.onTime, both.complaintOnTime.denominator, both.docOnTime.onTime, both.docOnTime.denominator], [2, 6, 1, 2])
  const only = deriveExec({ model: modelOf({ doc_requests: { ok: false, error: 'x' }, complaints: { ok: true, data: complaintsRaw } }), today: NOW })
  assert.equal(only.overdue.docs, null)
  assert.equal(only.overdue.total, 6)
  assert.equal(deriveExec({ model: modelOf({}), today: NOW }).overdue, null)
  assert.equal(deriveExec({ model: modelOf({}), today: NOW }).complaintOnTime, null)
  assert.equal(deriveExec({ model: modelOf({}), today: NOW }).docOnTime, null)
})

test('โครงการตามขั้น: เรียงตามวงจร · ขั้นที่ไม่รู้จักไม่หายเงียบ · ขั้น 0 ไม่แสดง', () => {
  assert.deepEqual(projectStageRows({ construction: 2, budgeted: 1, contracted: 1, started: 0, zzz: 4 }).map((r) => [r.stage, r.label, r.n]), [
    ['budgeted', 'ตั้งงบประมาณ', 1], ['contracted', 'ลงนามสัญญา', 1], ['construction', 'ก่อสร้าง', 2], ['zzz', 'zzz', 4],
  ])
  assert.deepEqual(projectStageRows(null), [])
})

test('แผน: ถึงกำหนดแต่ยังไม่มีผล — เดือนสิ้นสุดผ่านแล้ว + ยังไม่มีผล + ไม่ได้ผูกงานก่อสร้าง · เฉพาะปีงบปัจจุบัน', () => {
  const row = (month_to, status, source = 'none') => ({ item: { month_to }, resolved: { status, source } })
  // วันนี้ 10 พ.ย. 2026 = ปีงบ 2570 (เริ่ม 1 ต.ค. 2026): เดือนที่ 1 (ต.ค.) ผ่านแล้ว · เดือนที่ 2 (พ.ย.) ยังไม่จบ
  assert.equal(fiscalYearOf(new Date(2026, 10, 10)), 2570)
  const rows = [row(1, 'none'), row(2, 'none'), row(1, 'done'), row(1, 'none', 'civil'), row(1, 'in_progress'), row(null, 'none'), row(12, 'none')]
  assert.equal(planResultMissingCount(rows, { today: NOW, fiscalYear: 2570 }), 1)
  assert.equal(planResultMissingCount(rows, { today: NOW, fiscalYear: 2569 }), 0, 'ไม่ใช่ปีงบปัจจุบัน = ไม่นับ')
  assert.equal(planResultMissingCount([], { today: NOW, fiscalYear: 2570 }), 0)
  assert.equal(planResultMissingCount(null, { today: NOW, fiscalYear: 2570 }), 0)
  // วันที่ 30 พ.ย. เดือนที่ 2 (พ.ย.) ยังไม่ "ผ่านไปแล้ว" · 1 ธ.ค. ผ่านแล้ว
  assert.equal(planResultMissingCount([row(2, 'none')], { today: '2026-11-30', fiscalYear: 2570 }), 0)
  assert.equal(planResultMissingCount([row(2, 'none')], { today: '2026-12-01', fiscalYear: 2570 }), 1)
})

test('กำหนดการ 7 วัน: วันนี้..+7 · หลายวันที่คาบเกี่ยวนับ · เรียงวัน/เวลา · ซ้ำ id ตัดทิ้ง · ไม่ส่งรายละเอียดต่อ', () => {
  const events = [
    { id: 'a', title: 'ประชุมสภา', event_date: '2026-11-12', event_time: '09:00:00', description: 'ลับ', attachment_urls: ['x'] },
    { id: 'b', title: 'งานบุญ', event_date: '2026-11-08', end_date: '2026-11-11' },                       // คาบเกี่ยว (เริ่มก่อนวันนี้)
    { id: 'c', title: 'หลังช่วง', event_date: '2026-11-18' },                                              // วันที่ 8 นับจากวันนี้ = นอกช่วง
    { id: 'd', title: 'ขอบช่วง', event_date: '2026-11-17', event_time: '08:00' },                          // วันนี้ + 7 = พอดี
    { id: 'e', title: 'ผ่านไปแล้ว', event_date: '2026-11-09' },
    { id: 'a', title: 'ซ้ำ', event_date: '2026-11-12' },
    { id: 'f', title: '  ', event_date: '2026-11-12', event_time: '07:30', is_personal: true },
    { id: 'g', title: 'ไม่มีวัน' },
  ]
  const out = upcomingEvents(events, NOW)
  assert.deepEqual(out.map((e) => e.id), ['b', 'f', 'a', 'd'])
  assert.equal(out[0].day, NOW, 'หลายวันที่เริ่มก่อนวันนี้ แสดงที่วันนี้')
  assert.equal(out[1].title, 'กิจกรรมไม่ระบุชื่อ')
  assert.equal(out[1].personal, true)
  assert.equal(out[2].time, '09:00')
  for (const e of out) assert.deepEqual(Object.keys(e).sort(), ['day', 'end', 'id', 'personal', 'start', 'time', 'title'], 'เก็บเฉพาะช่องที่ใช้')
  assert.deepEqual(upcomingEvents(null, NOW), [])
})

test('เทียบค่าที่ไม่ใช่จำนวนนับ: null = เทียบไม่ได้ · ทิศ/ผลต่างปัด 1 ตำแหน่ง', () => {
  assert.equal(compareMetric(null, 50), null)
  assert.equal(compareMetric(50, null), null)
  assert.equal(compareMetric(undefined, undefined), null)
  assert.deepEqual(compareMetric(45.5, 40), { current: 45.5, previous: 40, diff: 5.5, dir: 'up', pct: null })
  assert.equal(compareMetric(3.2, 3.9).dir, 'down')
  assert.equal(compareMetric(3.2, 3.2).dir, 'flat')
  assert.equal(compareMetric(0, 10).diff, -10, '0% เทียบได้ (ไม่ใช่ null)')
})

test('ป้ายวันของกำหนดการ: วันนี้/พรุ่งนี้/วันอื่นเป็นภาษาไทยตามเวลาไทย (ไม่ขึ้นกับโซนเวลาเครื่อง)', () => {
  assert.equal(thaiDayLabel('2026-11-10', NOW), 'วันนี้')
  assert.equal(thaiDayLabel('2026-11-11', NOW), 'พรุ่งนี้')
  assert.match(thaiDayLabel('2026-11-13', NOW), /13/)
  assert.match(thaiDayLabel('2026-11-13', NOW), /พ\.ย\./)
  assert.equal(thaiDayLabel('xx', NOW), 'xx')
})

console.log(`\nok — ${cases} cases`)
