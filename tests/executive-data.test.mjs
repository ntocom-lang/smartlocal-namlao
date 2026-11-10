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
  const all = liveEntries(() => true)
  assert.ok(all.every((e) => e.phase === 'E1'))
  assert.ok(all.some((e) => e.key === 'src:esign'))
  assert.equal(all.some((e) => e.key === 'projects'), false, 'projects เป็น E2')
  const noComplaints = liveEntries((key) => key !== 'complaints')
  assert.equal(noComplaints.some((e) => e.key === 'complaints'), false)
  assert.ok(noComplaints.some((e) => e.key === 'src:esign'))
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
})

console.log(`\nok — ${cases} cases`)
