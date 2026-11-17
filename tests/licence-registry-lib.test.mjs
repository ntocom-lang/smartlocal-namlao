// ทะเบียนใบอนุญาต (ขั้น 1B / E3) — ตัวช่วยฝั่งหน้าจอ (src/lib/licenceRegistry.js, licenceRegistryApi.js) เทียบกับ migration ฝั่ง DB
//   node tests/licence-registry-lib.test.mjs   (หรือ npm run test:licence)
// กันเรื่องที่เงียบแล้วพังตอนใช้จริง:
//   (1) กฎคำนวณฝั่งหน้าจอ (วันหมดอายุใหม่ ค่าปรับ ช่วงต่ออายุ พักใช้ 15 วัน) ไม่ตรงกับ RPC → หน้าจอบอกอย่างฐานปฏิเสธอีกอย่าง
//   (2) หน้าจอเรียก RPC/ตาราง/คอลัมน์ไม่ตรงชื่อ → PostgREST ตอบ PGRST202/42703 หลังขึ้นระบบ
//   (3) หน้าจอมีถ้อยคำว่าระบบตัดสินแทนคน (อนุมัติ/อนุญาต/พักใช้เอง) หรือเขียน "ไม่ใช้ AI" — ห้ามตามกติกาโครงการ
//   (4) เมนูลงทะเบียนไม่ครบ (staffModules / staffNavGroups / staffMenuAccess / StaffDashboard / ห้องผู้บริหาร) · ค่าเริ่มต้นต้องปิด
//   (5) นำเข้า Excel: วันที่ พ.ศ./เลขวัน Excel · แถวผิดต้องไม่เข้าชุดนำเข้า · ตัวอ่านไฟล์ที่แยกมาต้องไม่ทำของยานพาหนะพัง
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import * as L from '../src/lib/licenceRegistry.js'
import * as S from '../src/lib/spreadsheetRead.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const tablesSql = await read('../supabase/migrations/20261208100000_licence_registry_tables.sql')
const rpcSql = await read('../supabase/migrations/20261208100100_licence_registry_rls_rpc.sql')
const apiSource = await read('../src/lib/licenceRegistryApi.js')

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

const T = new Date('2026-11-17T05:00:00Z') // 12:00 น. เวลาไทย
const TODAY = '2026-11-17'
const licenceType = (over = {}) => ({ id: 't1', doc_kind: 'licence', validity_months: 12, renewal_by_fee: true, renewal_window_days: null, default_fee: 500, ...over })
const noticeType = (over = {}) => ({ id: 't2', doc_kind: 'notice_certificate', validity_months: null, renewal_by_fee: false, ...over })
const lic = (over = {}) => ({ id: 'l1', status: 'active', expires_on: '2026-12-31', next_fee_due_on: null, status_until: null, ...over })

// ── วันที่ ─────────────────────────────────────────────────────────────────────

await test('วันนี้ตามเวลาไทย ไม่ใช่เวลาเครื่อง: 17:30 UTC ของวันที่ 16 = วันที่ 17 ในไทย', () => {
  assert.equal(L.todayBangkok(new Date('2026-11-16T17:30:00Z')), '2026-11-17')
  assert.equal(L.todayBangkok(new Date('2026-11-16T16:59:00Z')), '2026-11-16')
})

await test('บวกเดือนแบบ Postgres: สิ้นเดือนถอยเป็นวันสุดท้ายของเดือนปลายทาง · ข้ามปี · ปีอธิกสุรทิน', () => {
  assert.equal(L.addMonths('2026-12-31', 12), '2027-12-31')
  assert.equal(L.addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(L.addMonths('2028-02-29', 12), '2029-02-28')
  assert.equal(L.addMonths('2026-11-17', 3), '2027-02-17')
  assert.equal(L.addMonths('bad', 1), null)
  assert.equal(L.daysBetween('2026-11-17', '2026-12-17'), 30)
  assert.equal(L.daysBetween('2026-11-17', '2026-11-10'), -7)
  assert.equal(L.isIsoDate('2026-02-30'), false)
})

// ── ป้ายสถานะ ──────────────────────────────────────────────────────────────────

await test('ป้ายสถานะ: ใช้งาน / ใกล้หมดอายุ / หมดอายุแล้ว (คำนวณจากวัน ไม่ใช่ค่าในฐาน) ทั้งขอบเขต', () => {
  const id = (l, kind = 'licence', soon) => L.licenceBadge(l, kind, TODAY, soon).id
  assert.equal(id(lic({ expires_on: '2027-06-01' })), 'active')
  assert.equal(id(lic({ expires_on: '2027-01-16' })), 'expiring')            // เหลือ 60 วัน = ขอบเกณฑ์เริ่มต้น → ใกล้หมดอายุ
  assert.equal(id(lic({ expires_on: '2027-01-17' })), 'active')              // เหลือ 61 วัน
  assert.equal(id(lic({ expires_on: '2027-01-16' }), 'licence', 59), 'active') // อปท. ตั้งวันเตือนสูงสุด 59
  assert.equal(id(lic({ expires_on: '2026-11-17' })), 'expiring')     // วันสุดท้ายยังใช้ได้
  assert.equal(id(lic({ expires_on: '2026-11-16' })), 'expired')
})

await test('ป้ายสถานะ: หนังสือรับรองการแจ้ง ครบกำหนดชำระ / ค้างชำระ · พักใช้ / พ้นกำหนดพักใช้ / เพิกถอน / เลิกกิจการ', () => {
  const n = over => lic({ expires_on: null, next_fee_due_on: '2027-03-01', ...over })
  assert.equal(L.licenceBadge(n(), 'notice_certificate', TODAY).id, 'active')
  assert.equal(L.licenceBadge(n({ next_fee_due_on: '2026-12-01' }), 'notice_certificate', TODAY).id, 'due')
  assert.equal(L.licenceBadge(n({ next_fee_due_on: '2026-11-16' }), 'notice_certificate', TODAY).id, 'overdue')
  assert.equal(L.licenceBadge(lic({ status: 'suspended', status_until: '2026-11-20' }), 'licence', TODAY).id, 'suspended')
  assert.equal(L.licenceBadge(lic({ status: 'suspended', status_until: '2026-11-16' }), 'licence', TODAY).id, 'suspension_over')
  assert.equal(L.licenceBadge(lic({ status: 'revoked' }), 'licence', TODAY).label, 'เพิกถอน')
  assert.equal(L.licenceBadge(lic({ status: 'closed' }), 'licence', TODAY).label, 'เลิกกิจการ')
  // เพิกถอน/เลิกกิจการไม่เข้า "ต้องดำเนินการ"
  assert.equal(L.actionKind(lic({ status: 'revoked', expires_on: '2020-01-01' }), 'licence', TODAY), null)
  assert.equal(L.actionKind(lic({ status: 'suspended', expires_on: '2026-11-16' }), 'licence', TODAY), 'expired')
  // ทุกป้ายที่ฟังก์ชันคืนมีในตัวกรองสถานะ
  const ids = new Set(L.BADGE_FILTERS.map(f => f.id))
  for (const need of ['active', 'expiring', 'expired', 'due', 'overdue', 'suspended', 'revoked', 'closed']) assert.ok(ids.has(need), need)
})

await test('วันคงเหลือ: ใบอนุญาตใช้ expires_on · หนังสือรับรองใช้ next_fee_due_on · ข้อความ', () => {
  assert.equal(L.daysRemaining(lic({ expires_on: '2026-11-27' }), 'licence', TODAY), 10)
  assert.equal(L.daysRemaining(lic({ expires_on: null, next_fee_due_on: '2026-11-10' }), 'notice_certificate', TODAY), -7)
  assert.equal(L.daysRemaining(lic({ expires_on: null }), 'licence', TODAY), null)
  assert.equal(L.remainingText(12), 'อีก 12 วัน')
  assert.equal(L.remainingText(0), 'วันนี้')
  assert.equal(L.remainingText(-5), 'เลยมา 5 วัน')
  assert.equal(L.remainingText(null), '—')
})

// ── ต่ออายุ / ค่าธรรมเนียม ─────────────────────────────────────────────────────

await test('ต่ออายุ (พ.ร.ฎ. 2564): ชำระ ≤ วันสุดท้ายผ่าน · หลังสิ้นอายุไม่ผ่านพร้อมเหตุผล · ช่วงล่วงหน้า · ประเภทที่ไม่ใช่ renewal_by_fee', () => {
  const l = lic({ expires_on: '2026-12-31' })
  assert.equal(L.checkRenewal({ licence: l, type: licenceType(), paidOn: '2026-12-31' }).ok, true)
  const late = L.checkRenewal({ licence: l, type: licenceType(), paidOn: '2027-01-01' })
  assert.equal(late.ok, false)
  assert.match(late.reason, /สิ้นอายุ.*ยื่นคำขอรับใบอนุญาตใหม่/)
  // ช่วงต่ออายุล่วงหน้า 90 วัน: 2026-10-02 = ล่วงหน้า 90 วันพอดี ผ่าน · 2026-10-01 = 91 วัน ไม่ผ่าน
  const win = licenceType({ renewal_window_days: 90 })
  assert.equal(L.checkRenewal({ licence: l, type: win, paidOn: '2026-10-02' }).ok, true)
  assert.match(L.checkRenewal({ licence: l, type: win, paidOn: '2026-10-01' }).reason, /ล่วงหน้าได้ไม่เกิน 90 วัน/)
  assert.match(L.checkRenewal({ licence: l, type: licenceType({ renewal_by_fee: false }), paidOn: TODAY }).reason, /ไม่ได้ตั้งให้ต่ออายุโดยชำระค่าธรรมเนียม/)
  assert.match(L.checkRenewal({ licence: lic({ status: 'revoked' }), type: licenceType(), paidOn: TODAY }).reason, /เพิกถอน/)
  assert.match(L.checkRenewal({ licence: l, type: licenceType(), paidOn: TODAY, noMaterialChange: false }).reason, /ไม่เปลี่ยนแปลงสาระสำคัญ/)
  assert.equal(L.checkRenewal({ licence: lic({ expires_on: null }), type: noticeType(), paidOn: TODAY }).ok, false)
  // ต่อซ้อนเกิน 1 รอบไม่ได้ (ด่านใหม่ใน licence_record_fee): ใบที่ต่อไว้แล้วถึง 2027-11-30 รับเงินวันที่ 2026-11-17 ไม่ได้ · 2026-12-01 ได้
  assert.match(L.checkRenewal({ licence: lic({ expires_on: '2027-11-30' }), type: licenceType(), paidOn: TODAY }).reason, /ต่อซ้อนเกิน 1 รอบไม่ได้/)
  assert.equal(L.checkRenewal({ licence: lic({ expires_on: '2027-11-30' }), type: licenceType(), paidOn: '2026-12-01' }).ok, true)
  assert.match(rpcSql, /p_paid_on < \(\(v_lic\.expires_on \+ 1\) - make_interval\(months => v_type\.validity_months\)\)::date/)
  // รายปี: ชำระซ้อนเกิน 1 รอบไม่ได้
  assert.equal(L.checkAnnual({ licence: lic({ expires_on: null, next_fee_due_on: '2026-12-01' }), paidOn: TODAY }).ok, true)
  assert.match(L.checkAnnual({ licence: lic({ expires_on: null, next_fee_due_on: '2027-12-01' }), paidOn: TODAY }).reason, /ซ้อนเกิน 1 รอบ/)
  assert.equal(L.checkAnnual({ licence: lic({ expires_on: null, next_fee_due_on: null }), paidOn: TODAY }).ok, false)
  assert.match(rpcSql, /p_paid_on < \(v_lic\.next_fee_due_on - interval '12 months'\)::date/)
})

await test('ปุ่มรับค่าธรรมเนียม: ปิดพร้อมเหตุผลเมื่อใบอนุญาตสิ้นอายุ/ไม่ใช่ renewal_by_fee/ถูกเพิกถอน · หนังสือรับรองเปิดเมื่อมีวันครบกำหนด', () => {
  const st = (l, t) => L.feeButtonState({ licence: l, type: t, today: TODAY })
  assert.deepEqual(st(lic({ expires_on: '2026-12-31' }), licenceType()), { enabled: true, kind: 'renewal', reason: '' })
  assert.equal(st(lic({ expires_on: '2026-11-17' }), licenceType()).enabled, true)  // วันสุดท้ายยังต่อได้
  const expired = st(lic({ expires_on: '2026-11-16' }), licenceType())
  assert.equal(expired.enabled, false)
  assert.match(expired.reason, /สิ้นอายุแล้ว.*ยื่นคำขอรับใบอนุญาตใหม่/)
  // ต่ออายุไว้ล่วงหน้าแล้ว (ใช้ได้ถึง 2027-11-30) / ชำระรายปีไว้แล้ว → ปุ่มปิดพร้อมเหตุผล
  const stacked = st(lic({ expires_on: '2027-11-30' }), licenceType())
  assert.equal(stacked.enabled, false)
  assert.match(stacked.reason, /ต่อซ้อนเกิน 1 รอบไม่ได้/)
  const paidAnnual = st(lic({ expires_on: null, next_fee_due_on: '2027-12-01' }), noticeType())
  assert.equal(paidAnnual.enabled, false)
  assert.match(paidAnnual.reason, /ซ้อนเกิน 1 รอบ/)
  assert.equal(st(lic(), licenceType({ renewal_by_fee: false })).enabled, false)
  assert.equal(st(lic({ status: 'closed' }), licenceType()).enabled, false)
  assert.deepEqual(st(lic({ expires_on: null, next_fee_due_on: '2027-01-01' }), noticeType()), { enabled: true, kind: 'annual', reason: '' })
  assert.equal(st(lic({ expires_on: null, next_fee_due_on: null }), noticeType()).enabled, false)
})

await test('ตัวอย่างผลก่อนยืนยันตรงกับสูตรใน licence_record_fee: ต่ออายุ = หมดอายุเดิม + อายุใบ · รายปี = ครบกำหนดเดิม + 12 เดือน', () => {
  const r = L.previewFeeResult({ kind: 'renewal', licence: lic({ expires_on: '2026-12-31' }), type: licenceType() })
  assert.deepEqual([r.from, r.to, r.newDate], ['2027-01-01', '2027-12-31', '2027-12-31'])
  const a = L.previewFeeResult({ kind: 'annual', licence: lic({ expires_on: null, next_fee_due_on: '2026-12-01' }), type: noticeType() })
  assert.deepEqual([a.from, a.to, a.newDate], ['2026-12-01', '2027-11-30', '2027-12-01'])
  // สูตรจริงใน SQL ที่หน้าจอเลียนแบบ (ถ้าฐานเปลี่ยนสูตร เทสต์นี้ล้ม)
  assert.match(rpcSql, /v_from := v_lic\.expires_on \+ 1;/)
  assert.match(rpcSql, /v_to := \(v_from \+ make_interval\(months => v_type\.validity_months\)\)::date - 1;/)
  assert.match(rpcSql, /v_to := \(\(v_lic\.next_fee_due_on \+ interval '12 months'\)::date\) - 1/)
  assert.match(rpcSql, /next_fee_due_on = v_to \+ 1/)
  // นับจากวันเริ่มรอบใหม่ แล้วลบ 1 วัน (ไม่ใช่ หมดอายุเดิม + เดือน): หมดอายุ 28 ก.พ. 2569 อายุ 1 เดือน → 31 มี.ค. ไม่ใช่ 28 มี.ค.
  assert.equal(L.previewFeeResult({ kind: 'renewal', licence: lic({ expires_on: '2026-02-28' }), type: licenceType({ validity_months: 1 }) }).newDate, '2026-03-31')
  // 2028-02-29 + 12 เดือน = 2029-02-28
  assert.equal(L.previewFeeResult({ kind: 'renewal', licence: lic({ expires_on: '2028-02-29' }), type: licenceType() }).newDate, '2029-02-28')
})

await test('ค่าปรับ 20% (ม.65): เสนอเมื่อชำระหลังวันครบกำหนด · ปัดสตางค์ · ศูนย์/ติดลบ/ไม่ใช่ตัวเลข = 0', () => {
  assert.equal(L.suggestSurcharge(500), 100)
  assert.equal(L.suggestSurcharge(333.33), 66.67)
  assert.equal(L.suggestSurcharge(0), 0)
  assert.equal(L.suggestSurcharge(-5), 0)
  assert.equal(L.suggestSurcharge('abc'), 0)
  assert.equal(L.isLateAnnual('2026-12-02', '2026-12-01'), true)
  assert.equal(L.isLateAnnual('2026-12-01', '2026-12-01'), false)
  assert.equal(L.SURCHARGE_RATE, 0.2)
})

await test('กล่องบันทึกคำสั่ง: พักใช้ต้องมีเลขคำสั่ง+วัน ไม่เกิน 15 วัน · เพิกถอนต้องมีเลขคำสั่ง · ต้องมีเหตุผล · คืนสถานะใบเพิกถอนต้องมีเลขคำสั่ง', () => {
  const base = { status: 'suspended', reason: 'ผลตรวจพบสิ่งปฏิกูล', orderRef: 'คำสั่ง 12/2569', from: '2026-11-17', until: '2026-12-01', currentStatus: 'active' }
  assert.equal(L.validateStatusOrder(base), '')                                       // 15 วันพอดี (นับวันเริ่มเป็นวันที่ 1)
  assert.match(L.validateStatusOrder({ ...base, until: '2026-12-02' }), /ไม่เกิน 15 วัน/)
  assert.match(L.validateStatusOrder({ ...base, orderRef: '' }), /เลขที่คำสั่ง/)
  assert.match(L.validateStatusOrder({ ...base, reason: 'ก' }), /เหตุผล/)
  assert.match(L.validateStatusOrder({ ...base, until: '2026-11-16' }), /ก่อนวันเริ่ม/)
  assert.match(L.validateStatusOrder({ ...base, status: 'revoked', orderRef: '' }), /เพิกถอนต้องระบุเลขที่คำสั่ง/)
  assert.equal(L.validateStatusOrder({ ...base, status: 'closed', orderRef: '' }), '')
  assert.match(L.validateStatusOrder({ ...base, status: 'active', orderRef: '', currentStatus: 'revoked' }), /ใบที่ถูกเพิกถอน/)
  // เลิกกิจการ → สถานะอื่น ต้องมีเลขคำสั่ง เหมือนเพิกถอน (กติกาใหม่ใน licence_set_status)
  assert.match(L.validateStatusOrder({ ...base, status: 'active', orderRef: '', currentStatus: 'closed' }), /เพิกถอน\/เลิกกิจการ/)
  assert.equal(L.validateStatusOrder({ ...base, status: 'active', orderRef: 'หนังสือ 5/2569', currentStatus: 'closed' }), '')
  assert.match(rpcSql, /v_lic\.status IN \('revoked', 'closed'\) AND p_status <> v_lic\.status AND v_ref IS NULL/)
  assert.equal(L.suspendDays('2026-11-17', '2026-12-01'), 15)
  assert.match(rpcSql, /\(p_until - p_from \+ 1\) > 15/)
})

// ── หมวด / ประเภท ──────────────────────────────────────────────────────────────

await test('หมวด 7 หมวดตรงกับ CHECK ในฐาน · ป้ายไทย + ฐานกฎหมายเริ่มต้นของ พ.ร.บ.การสาธารณสุข · waste_service เริ่มต้นไม่ต่ออายุโดยชำระค่าธรรมเนียม', () => {
  const dbValues = [...tablesSql.match(/category\s+text NOT NULL CHECK \(category IN \(([\s\S]*?)\)\),/)[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1])
  assert.deepEqual(L.LICENCE_CATEGORIES.map(c => c.value).sort(), [...dbValues].sort())
  assert.equal(L.LICENCE_CATEGORIES.length, 7)
  const by = Object.fromEntries(L.LICENCE_CATEGORIES.map(c => [c.value, c]))
  assert.match(by.health_hazard.legalBasis, /ม\.33/)
  assert.match(by.market.legalBasis, /ม\.34/)
  assert.match(by.food_premises.legalBasis, /ม\.38/)
  assert.match(by.food_premises.label, /เกิน 200 ตร\.ม\./)
  assert.match(by.food_notice.legalBasis, /ม\.38\/48/)
  assert.match(by.food_notice.label, /ไม่เกิน 200 ตร\.ม\./)
  assert.match(by.street_vending.legalBasis, /ม\.41/)
  assert.match(by.waste_service.legalBasis, /ม\.19/)
  for (const c of L.LICENCE_CATEGORIES) { assert.match(c.label, /[฀-๿]/); if (c.value !== 'other') assert.match(c.legalBasis, /พ\.ร\.บ\.การสาธารณสุข พ\.ศ\. 2535/) }
  assert.equal(by.waste_service.renewalByFee, false)
  assert.equal(by.food_notice.docKind, 'notice_certificate')
  assert.equal(by.food_notice.renewalByFee, false)
  assert.deepEqual(L.categoryDefaults('food_notice'), { doc_kind: 'notice_certificate', validity_months: null, renewal_by_fee: false, legal_basis: by.food_notice.legalBasis })
  assert.equal(L.categoryDefaults('market').validity_months, 12)
  // ฐานคำนวณ doc_kind จากหมวดแบบเดียวกัน
  assert.match(rpcSql, /IF NEW\.category = 'food_notice' THEN\s+NEW\.doc_kind := 'notice_certificate'/)
})

await test('ฟอร์มประเภท: ลิงก์ภายนอก https เท่านั้น · ช่วงต่ออายุ · ชื่อ · อายุใบหมวดอื่น', () => {
  assert.equal(L.isSafeExternalUrl('https://bizportal.go.th/x'), true)
  for (const bad of ['http://bizportal.go.th', 'javascript:alert(1)', 'https://a b.com', '', 'ftp://x.y', 'https://x.y/"><script>', `https://${'a'.repeat(500)}.com`]) assert.equal(L.isSafeExternalUrl(bad), false, bad)
  const ok = { category: 'market', name: 'ตลาดสด', renewal_window_days: '', default_fee: '', external_url: '' }
  assert.equal(L.validateTypeForm(ok), '')
  assert.match(L.validateTypeForm({ ...ok, name: 'ก' }), /ชื่อประเภท/)
  assert.match(L.validateTypeForm({ ...ok, category: '' }), /หมวด/)
  assert.match(L.validateTypeForm({ ...ok, renewal_window_days: '400' }), /1–365/)
  assert.match(L.validateTypeForm({ ...ok, external_url: 'http://x.y' }), /https/)
  assert.match(L.validateTypeForm({ ...ok, category: 'other', validity_months: '0' }), /อายุใบ/)
  assert.equal(L.validateTypeForm({ ...ok, category: 'other', validity_months: '24' }), '')
  assert.match(tablesSql, /external_url ~ '\^https:\/\/\[\^\\s<>"\]\+\$'/)
})

await test('วันเตือน: 0–180 ไม่ซ้ำ เรียงมาก→น้อย สูงสุด 6 ค่า · ไม่ตั้ง = 60/30/7/0 · ตรงกับ CHECK ในฐาน', () => {
  assert.deepEqual(L.normalizeRemindDays([7, 30, '60', 0, 30, 999, -1, 'x', 1.5]), [60, 30, 7, 0])
  assert.deepEqual(L.normalizeRemindDays([1, 2, 3, 4, 5, 6, 7]), [7, 6, 5, 4, 3, 2])
  assert.deepEqual(L.effectiveRemindDays(null), [60, 30, 7, 0])
  assert.deepEqual(L.effectiveRemindDays([]), [60, 30, 7, 0])
  assert.equal(L.validateRemindDays([60, 30]), '')
  assert.match(L.validateRemindDays([]), /อย่างน้อย 1/)
  assert.match(L.validateRemindDays([1, 2, 3, 4, 5, 6, 7]), /สูงสุด 6/)
  assert.match(L.validateRemindDays([181]), /0–180/)
  assert.match(L.validateRemindDays([5, 5]), /ซ้ำ/)
  assert.match(tablesSql, /cardinality\(remind_days\) BETWEEN 1 AND 6/)
  assert.match(tablesSql, /180 >= ALL \(remind_days\)/)
  assert.deepEqual(L.DEFAULT_REMIND_DAYS, [60, 30, 7, 0])
  assert.match(tablesSql, /DEFAULT ARRAY\[60, 30, 7, 0\]/)
})

await test('ฟอร์มใบ: ใบอนุญาตต้องมีวันหมดอายุ · เบอร์โทร · วันหมดอายุหลังวันออก · เสนอวันหมดอายุ = ออกใบ + อายุ − 1 วัน', () => {
  const type = licenceType()
  const ok = { licence_type_id: 't1', business_name: 'ร้านก', holder_name: 'นายข', expires_on: '2027-01-01', holder_phone: '081-234-5678' }
  assert.equal(L.validateLicenceForm(ok, type), '')
  assert.match(L.validateLicenceForm({ ...ok, expires_on: '' }, type), /วันหมดอายุ/)
  assert.match(L.validateLicenceForm({ ...ok, holder_phone: 'abc' }, type), /เบอร์โทร/)
  assert.match(L.validateLicenceForm({ ...ok, issued_on: '2027-01-01' }, type), /หลังวันที่ออกใบ/)
  assert.equal(L.validateLicenceForm({ ...ok, expires_on: '' }, noticeType()), '')
  assert.equal(L.suggestExpiry('2026-01-15', type), '2027-01-14')
  assert.equal(L.suggestExpiry('2026-01-15', noticeType()), null)
  assert.match(tablesSql, /holder_phone ~ '\^\[0-9\+\\-\ \]\{6,20\}\$'/)
})

// ── นำเข้า Excel ───────────────────────────────────────────────────────────────

await test('วันที่นำเข้า: ISO · พ.ศ./ค.ศ. แบบ วว/ดด/ปปปป · เลขวัน Excel · ว่าง = null · ผิด = undefined', () => {
  assert.equal(L.parseImportDate('2026-01-15'), '2026-01-15')
  assert.equal(L.parseImportDate('2569-01-15'), '2026-01-15')
  assert.equal(L.parseImportDate('15/01/2569'), '2026-01-15')
  assert.equal(L.parseImportDate('5/1/2026'), '2026-01-05')
  assert.equal(L.parseImportDate('15.01.2569'), '2026-01-15')
  assert.equal(L.parseImportDate('46037'), '2026-01-15')    // เลขวัน Excel (ระบบวันที่ 1900) — 2026-01-15
  assert.equal(L.parseImportDate(''), null)
  assert.equal(L.parseImportDate(null), null)
  for (const bad of ['31/02/2569', 'abc', '2026-13-01', '99', '999999999']) assert.equal(L.parseImportDate(bad), undefined, bad)
})

const importTypes = [
  { id: 'tl', name: 'ตลาดสด', doc_kind: 'licence' },
  { id: 'tn', name: 'ร้านอาหาร ไม่เกิน 200 ตร.ม.', doc_kind: 'notice_certificate' },
]
const HEAD = ['ประเภท', 'เลขที่ใบอนุญาต', 'ชื่อสถานประกอบการ', 'ชื่อผู้ประกอบการ', 'วันที่ออกใบ', 'วันหมดอายุ', 'วันครบกำหนดชำระ', 'ค่าธรรมเนียม', 'พื้นที่ (ตร.ม.)', 'หมู่บ้าน']

await test('แมปหัวคอลัมน์ไทย (ไม่สนช่องว่าง/วงเล็บ/ตัวพิมพ์) · ขาดหัวที่จำเป็น = บอกชื่อหัวที่ขาด ไม่พรีวิวแถว', () => {
  const idx = L.mapImportHeaders(['ประเภท', ' ชื่อ สถานประกอบการ ', 'พื้นที่ (ตร.ม.)', 'ค่าธรรมเนียมต่อปี', 'หมายเหตุ'])
  assert.equal(idx.type_name, 0)
  assert.equal(idx.business_name, 1)
  assert.equal(idx.area_sqm, 2)
  assert.equal(idx.fee_amount, 3)
  assert.equal(idx.holder_name, -1)
  const r = L.buildImportPreview([['ประเภท', 'ชื่อสถานประกอบการ'], ['ตลาดสด', 'ร้านก']], { types: importTypes })
  assert.deepEqual(r.missingHeaders, ['ชื่อผู้ประกอบการ'])
  assert.equal(r.rows.length, 0)
  for (const h of L.IMPORT_TEMPLATE_HEADERS) assert.ok(Object.values(L.mapImportHeaders(L.IMPORT_TEMPLATE_HEADERS)).filter(i => i >= 0).length >= 14, h)
})

await test('ตรวจแถวนำเข้า: แถวดีเป็น ready · แถวผิดบอกเหตุผลรายแถว+เลขแถวในไฟล์ · เลขที่ซ้ำ (ในไฟล์/ในทะเบียน) · ประเภทไม่พบ · วันหมดอายุผิดชนิด', () => {
  const matrix = [HEAD,
    ['ตลาดสด', 'ก-001', 'ร้านก', 'นายข', '2569-01-15', '2570-01-14', '', '1,200.50', '35', 'หมู่ 1'],        // ดี (พ.ศ.)
    ['ตลาดสด', 'ก-001', 'ร้านซ้ำในไฟล์', 'นายค', '2026-01-15', '2027-01-14', '', '', '', ''],              // ซ้ำในไฟล์
    ['ตลาดสด', 'ก-002', 'ร้านซ้ำทะเบียน', 'นายง', '', '2027-01-14', '', '', '', ''],                         // ซ้ำกับของเดิม
    ['ไม่มีประเภทนี้', '', 'ร้านจ', 'นายจ', '', '', '', '', '', ''],
    ['ตลาดสด', '', 'ร้านไม่มีหมดอายุ', 'นายฉ', '', '', '', '', '', ''],
    ['ร้านอาหาร ไม่เกิน 200 ตร.ม.', '', 'ร้านอาหาร', 'นายช', '', '', '2027-03-01', '300', '', ''],         // หนังสือรับรอง ดี
    ['ร้านอาหาร ไม่เกิน 200 ตร.ม.', '', 'ร้านมีหมดอายุ', 'นายซ', '', '2027-03-01', '', '', '', ''],        // ผิดชนิด
    ['ตลาดสด', '', '', 'นายญ', '', '2027-01-14', '', 'abc', '', ''],                                      // ไม่มีชื่อร้าน + ค่าธรรมเนียมผิด
    ['ตลาดสด', 'ข-9', 'ร้านวันผิด', 'นายฎ', '31/02/2569', '2027-01-14', '', '', '', ''],
  ]
  const { rows, missingHeaders } = L.buildImportPreview(matrix, { types: importTypes, existing: [{ licence_type_id: 'tl', licence_no: 'ก-002' }] })
  assert.deepEqual(missingHeaders, [])
  assert.deepEqual(rows.map(r => r.status), ['ready', 'invalid', 'invalid', 'invalid', 'invalid', 'ready', 'invalid', 'invalid', 'invalid'])
  assert.deepEqual(rows.map(r => r.line), [2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.deepEqual(rows[0].payload, {
    licence_type_id: 'tl', licence_no: 'ก-001', business_name: 'ร้านก', sub_type: null, holder_name: 'นายข', holder_phone: null, address: null, village: 'หมู่ 1',
    area_sqm: 35, fee_amount: 1200.5, issued_on: '2026-01-15', expires_on: '2027-01-14', next_fee_due_on: null, note: null,
  })
  assert.equal(rows[1].payload, null)                    // แถวผิดไม่มี payload = ไม่มีทางหลุดเข้าชุดนำเข้า
  assert.match(rows[1].errors.join(), /ซ้ำ/)
  assert.match(rows[2].errors.join(), /ซ้ำ/)
  assert.match(rows[3].errors.join(), /ไม่พบประเภท/)
  assert.match(rows[4].errors.join(), /ต้องมีวันหมดอายุ/)
  assert.equal(rows[5].payload.next_fee_due_on, '2027-03-01')
  assert.equal(rows[5].payload.expires_on, null)
  assert.match(rows[6].errors.join(), /ไม่มีวันหมดอายุ/)
  assert.match(rows[7].errors.join(), /ชื่อสถานประกอบการ/)
  assert.match(rows[7].errors.join(), /ค่าธรรมเนียม/)
  assert.match(rows[8].errors.join(), /อ่านไม่ได้/)
})

await test('แบ่งก้อนนำเข้า 200 แถว · ฟังก์ชันนำเข้าใส่ import_batch เดียวทั้งชุด (crypto.randomUUID) · ยกเลิกชุด = DELETE ตาม import_batch + อปท.', () => {
  assert.equal(L.IMPORT_BATCH_SIZE, 200)
  const parts = L.chunk(Array.from({ length: 450 }, (_, i) => i))
  assert.deepEqual(parts.map(p => p.length), [200, 200, 50])
  assert.deepEqual(L.chunk([]), [])
  const api = stripComments(apiSource)
  assert.match(api, /const batchId = crypto\.randomUUID\(\)/)
  assert.match(api, /import_batch: batchId/)
  assert.match(api, /chunk\(payloads, IMPORT_BATCH_SIZE\)/)
  assert.match(api, /\.delete\(\{ count: 'exact' \}\)[\s\S]{0,120}\.eq\('municipality_id', municipalityId\)\.eq\('import_batch', batchId\)/)
})

await test('ตัวอ่านไฟล์ที่แยกมาเป็น helper ร่วม: CSV (อ้างคำพูด/บรรทัดใหม่ในช่อง/CRLF) ได้ผลเท่าเดิม · FleetImportModal ใช้ตัวร่วม ไม่เหลือสำเนา', async () => {
  assert.deepEqual(S.parseCsv('a,b,c\r\n"x,1","y ""q""",z\n\n1,2,3'), [['a', 'b', 'c'], ['x,1', 'y "q"', 'z'], ['1', '2', '3']])
  assert.deepEqual(S.parseCsv('"ก\nข",ค'), [['ก\nข', 'ค']])
  assert.equal(S.normalizeHeader(' ชื่อ_รถ (ทะเบียน) '), 'ชื่อรถทะเบียน')
  assert.equal(typeof S.parseXlsx, 'function')
  const fleet = await read('../src/components/fleet/FleetImportModal.jsx')
  assert.match(fleet, /import \{ normalizeHeader, parseCsv, parseXlsx \} from '\.\.\/\.\.\/lib\/spreadsheetRead'/)
  assert.doesNotMatch(fleet, /function (parseCsv|parseXlsx|excelColumnIndex|normalizeHeader)\b/)
  const licenceImport = await read('../src/components/staff/licence/LicenceImportSheet.jsx')
  assert.match(licenceImport, /from '\.\.\/\.\.\/\.\.\/lib\/spreadsheetRead'/)
  assert.doesNotMatch(await read('../package.json'), /"(xlsx|exceljs|sheetjs|papaparse)"/)
})

// ── API ต้องตรงกับฐาน ───────────────────────────────────────────────────────────

await test('RPC ที่หน้าจอเรียก: มีในฐาน + ชื่อ argument ตรงทุกตัว (กัน PGRST202) · ส่งครบทุก argument', () => {
  const api = stripComments(apiSource)
  const rpcs = [...api.matchAll(/supabase\.rpc\('([a-z_]+)'(?:, \{([\s\S]*?)\})?\)/g)]
  const names = rpcs.map(m => m[1]).sort()
  assert.deepEqual(names, ['licence_is_admin', 'licence_is_manager', 'licence_record_fee', 'licence_set_status', 'licence_today', 'licence_void_fee'].sort())
  for (const [, name, argText] of rpcs) {
    const def = rpcSql.match(new RegExp(`FUNCTION public\\.${name}\\(([\\s\\S]*?)\\)\\s*RETURNS`))
    assert.ok(def, `ไม่พบ ${name} ใน migration`)
    const dbArgs = [...def[1].matchAll(/\b(p_[a-z_]+)\b/g)].map(m => m[1])
    const sent = [...(argText ?? '').matchAll(/\b(p_[a-z_]+):/g)].map(m => m[1])
    assert.deepEqual(sent, dbArgs, `${name}: ชื่อ/ลำดับ argument ไม่ตรงฐาน`)
  }
})

await test('ตาราง/คอลัมน์ที่หน้าจออ่านเขียน มีจริงในฐาน · ไม่เขียน licence_fee_payments / licence_events ตรงๆ (RPC เท่านั้น)', () => {
  const api = stripComments(apiSource)
  const colsOf = (table) => {
    const m = tablesSql.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\(([\\s\\S]*?)\\n\\);`))
    assert.ok(m, table)
    return new Set([...m[1].matchAll(/^\s{2}([a-z_]+)\s/gm)].map(x => x[1]))
  }
  const consts = { TYPE_COLS: 'licence_types', LICENCE_COLS: 'licences' }
  for (const [name, table] of Object.entries(consts)) {
    const list = api.match(new RegExp(`const ${name} = '([^']+)'`))[1].split(',').map(s => s.trim())
    const cols = colsOf(table)
    assert.deepEqual(list.filter(c => !cols.has(c)), [], `${name} มีคอลัมน์ที่ไม่มีในฐาน`)
  }
  const selects = [...api.matchAll(/\.from\('(licence_[a-z_]+)'\)\s*\.select\('([^']+)'/g)]
  assert.ok(selects.length >= 3, "จับ select ตรงๆ ได้ " + selects.length)
  for (const [, table, list] of selects) {
    const cols = colsOf(table)
    assert.deepEqual(list.split(',').map(s => s.trim()).filter(c => !cols.has(c)), [], `${table}: คอลัมน์ที่ select ไม่มีในฐาน`)
  }
  assert.doesNotMatch(api, /from\('licence_fee_payments'\)\s*\.(insert|update|delete)/)
  assert.doesNotMatch(api, /from\('licence_events'\)\s*\.(insert|update|delete)/)
  assert.match(api, /\.from\('licence_fee_payments'\)\s*\.select/)
  // ทุก query ของทะเบียน/ประเภท กรอง อปท. (superadmin อ่านได้ทุก อปท.)
  assert.ok((api.match(/\.eq\('municipality_id', municipalityId\)/g) ?? []).length >= 7)
  // อ่านทะเบียนไล่ทีละหน้า (เพดาน 1,000 แถวของ PostgREST)
  assert.match(api, /async function fetchAll/)
  assert.match(api, /fetchAll\(\(\) => supabase\.from\('licences'\)/)
})

await test('ข้อความผิดพลาดจากฐาน (ไทย) แสดงตรงๆ · รหัสทั่วไปแปลเป็นไทย', async () => {
  // friendlyError อยู่ในไฟล์ที่ import supabase → อ่านจากซอร์สแล้วประเมินเฉพาะฟังก์ชันนั้น
  const src = apiSource.slice(apiSource.indexOf('export function friendlyError'), apiSource.indexOf('// ── สิทธิ์'))
  const friendlyError = new Function(`${src.replace('export function', 'function')}; return friendlyError`)()
  assert.equal(friendlyError({ code: '22023', message: 'ชำระหลังใบอนุญาตสิ้นอายุ (2026-01-01) — ต่ออายุไม่ได้' }), 'ชำระหลังใบอนุญาตสิ้นอายุ (2026-01-01) — ต่ออายุไม่ได้')
  assert.match(friendlyError({ code: '42501', message: 'new row violates row-level security policy' }), /ไม่มีสิทธิ์/)
  assert.match(friendlyError({ code: '23503', message: 'violates foreign key' }), /ลบไม่ได้/)
  assert.match(friendlyError({ code: '23505', message: 'duplicate key' }), /ซ้ำ/)
  assert.match(friendlyError({ code: 'XX000', message: 'boom' }), /[฀-๿]/)
  assert.equal(friendlyError(null), '')
})

// ── ถ้อยคำบนจอ (กติกา: ระบบไม่ตัดสินแทนคน · ห้ามเขียน "ไม่ใช้ AI") ─────────────────

await test('หน้าจอ/ไลบรารีไม่มีถ้อยคำว่าระบบอนุมัติ/อนุญาต/พักใช้เอง · ไม่รับรองความถูกต้องตามกฎหมาย · ไม่มีคำว่า "ไม่ใช้ AI"', async () => {
  const dir = new URL('../src/components/staff/licence/', import.meta.url)
  const files = (await readdir(dir)).filter(f => /\.(jsx|js)$/.test(f))
  assert.ok(files.length >= 14, `พบไฟล์หน้าจอ ${files.length}`)
  const sources = Object.fromEntries(await Promise.all(files.map(async f => [`components/staff/licence/${f}`, await readFile(new URL(f, dir), 'utf8')])))
  sources['lib/licenceRegistry.js'] = await read('../src/lib/licenceRegistry.js')
  sources['lib/licenceRegistryApi.js'] = apiSource
  sources['functions/_shared/licenceExpiryNotify.ts'] = await read('../supabase/functions/_shared/licenceExpiryNotify.ts')
  const forbidden = [
    /(?<!เจ้าของ)ระบบ(อนุมัติ|อนุญาต|พักใช้|เพิกถอน|ตัดสิน)(ให้|เอง)?/,  // (เจ้าของระบบอนุมัติ = ผู้ตัดสินในโครงการ ไม่ใช่ระบบ)
    /(อนุมัติ|อนุญาต|พักใช้|เพิกถอน)อัตโนมัติ/, /ไม่ใช้\s*AI|ไม่มี\s*AI|ปราศจาก\s*AI|without AI/i,
    /ถูกต้องตามกฎหมาย|ถูกต้องตามระเบียบ|ชอบด้วยกฎหมาย|ชอบด้วยระเบียบ|ผ่านตามระเบียบ/,
  ]
  for (const [file, text] of Object.entries(sources)) {
    for (const re of forbidden) assert.ok(!re.test(text), `${file} มีวลีต้องห้าม ${re}`)
  }
  // ปุ่มหลักใช้คำที่เจ้าของระบบกำหนด
  const all = Object.values(sources).join('\n')
  assert.match(all, /บันทึกรับค่าธรรมเนียม/)
  assert.match(all, /บันทึกคำสั่ง/)
  assert.doesNotMatch(all, />\s*(อนุมัติ|อนุญาต|ต่ออายุให้|พักใช้ใบ|เพิกถอนใบ)\s*</)
})

await test('ข้อความหน้าจอไม่มีชื่อผู้ประกอบการหลุดออกนอกหน้านี้: แจ้งเตือน Telegram + ห้องผู้บริหารไม่มีช่องชื่อร้าน/ผู้ประกอบการ', async () => {
  const shared = stripComments(await read('../supabase/functions/_shared/licenceExpiryNotify.ts'))
  assert.doesNotMatch(shared, /business_name|holder_name|licence_no|holder_phone/)
  const fn = stripComments(await read('../supabase/functions/licence-expiry-notify/index.ts'))
  const selects = [...fn.matchAll(/\.select\('([^']+)'/g)].map(m => m[1]).join(',')
  assert.doesNotMatch(selects, /business_name|holder_name|licence_no|holder_phone|address/)
  const reg = await read('../src/lib/executiveRegistry.js')
  const entry = reg.slice(reg.indexOf("key: 'licence-registry'"), reg.indexOf("key: 'water-situation'"))
  assert.match(entry, /kpis: \[\], alerts: \[\]/)
  assert.doesNotMatch(entry, /summaryKey: '/)
})

// ── ลงทะเบียนเมนู ──────────────────────────────────────────────────────────────

await test('โมดูล licence-registry: อยู่ใน MODULE_GROUPS (สำนักปลัด) · MANAGED_MODULE_KEYS · เมนูซ้าย · STAFF_MENU_MODULE_KEYS · StaffDashboard lazy + render ตรวจสิทธิ์ซ้ำ', async () => {
  const { MODULE_GROUPS: adminGroups, MANAGED_MODULE_KEYS } = await import('../src/lib/staffModules.js')
  const group = adminGroups.find(g => g.items.some(m => m.key === 'licence-registry'))
  assert.equal(group?.group, 'สำนักปลัด')
  assert.equal(group.items.find(m => m.key === 'licence-registry').label, 'ทะเบียนใบอนุญาต')
  assert.ok(MANAGED_MODULE_KEYS.includes('licence-registry'))
  const nav = await read('../src/lib/staffNavGroups.js')
  assert.match(nav, /key: 'licence-registry', label: 'ทะเบียนใบอนุญาต', Icon: FileCheck2/)
  const access = await import('../src/lib/staffMenuAccess.js')
  assert.ok(access.STAFF_MENU_MODULE_KEYS.includes('licence-registry'))
  const dash = await read('../src/pages/StaffDashboard.jsx')
  assert.match(dash, /const LicenceModule = lazy\(\(\) => import\('\.\.\/components\/staff\/licence\/LicenceModule'\)\)/)
  assert.match(dash, /activeModule === 'licence-registry' && visibleModules\.some\(m => m\.key === 'licence-registry'\) && <LicenceModule tenant=\{tenant\} profile=\{profile\} \/>/)
  const exec = await import('../src/lib/executiveRegistry.js')
  assert.ok(exec.EXECUTIVE_REGISTRY.some(e => e.key === 'licence-registry' && e.link.module === 'licence-registry'))
  assert.equal(L.LICENCE_MODULE_KEY, 'licence-registry')
})

await test('เห็นเมนู: admin/officer/staff/superadmin เท่านั้น (ช่าง/ผู้บริหาร/สภา/ประชาชนไม่เห็น) · ค่าเริ่มต้นปิด = ต้องมีคีย์ใน enabled_modules', async () => {
  const { staffVisibleModuleKeys } = await import('../src/lib/staffMenuAccess.js')
  const { MANAGED_MODULE_KEYS } = await import('../src/lib/staffModules.js')
  const on = { enabled_modules: [...MANAGED_MODULE_KEYS] }
  for (const role of ['admin', 'officer', 'staff', 'superadmin']) assert.ok(staffVisibleModuleKeys({ role, tenant: on }).includes('licence-registry'), role)
  for (const role of ['technician', 'viewer', 'council', 'citizen', undefined]) assert.ok(!staffVisibleModuleKeys({ role, tenant: on }).includes('licence-registry'), String(role))
  const off = { enabled_modules: MANAGED_MODULE_KEYS.filter(k => k !== 'licence-registry') }
  assert.ok(!staffVisibleModuleKeys({ role: 'admin', tenant: off }).includes('licence-registry'))
  // ไม่มีไฟล์ migration ใดเติม licence-registry ลง enabled_modules ให้ทุกแถว (ต้องเปิดเป็นรายหน่วยงาน)
  for (const f of ['20261208100000_licence_registry_tables.sql', '20261208100100_licence_registry_rls_rpc.sql', '20261208100200_licence_expiry_notify_cron.sql']) {
    assert.doesNotMatch(stripComments(await read('../supabase/migrations/' + f)).replace(/--.*$/gm, ''), /UPDATE\s+public\.municipalities[\s\S]{0,200}enabled_modules/i, f)
  }
})

await test('แท็บ: ทะเบียน | ต้องดำเนินการ | ประเภทใบอนุญาต | ตั้งค่า (เฉพาะ licence_is_admin) · ไม่ใช่ผู้จัดการ = ข้อความกองที่ถือเรื่อง', async () => {
  const mod = await read('../src/components/staff/licence/LicenceModule.jsx')
  for (const label of ["label: 'ทะเบียน'", 'ต้องดำเนินการ', "label: 'ประเภทใบอนุญาต'", "label: 'ตั้งค่า'"]) assert.ok(mod.includes(label), label)
  assert.match(mod, /\.\.\.\(state\.isAdmin \? \[\{ id: 'settings'/)
  assert.match(mod, /!state\.isManager/)
  assert.match(mod, /เมนูนี้สำหรับกองที่ถือเรื่องใบอนุญาต ผู้ดูแลระบบตั้งได้ที่แท็บตั้งค่า/)
  const settings = await read('../src/components/staff/licence/LicenceSettingsTab.jsx')
  assert.match(settings, /fetchDepartments|departments\.map/)
  assert.match(mod, /fetchDepartments\(tenantId\)/)
  // คอลัมน์ดำเนินการปักขวา (กติกากล่องงาน)
  assert.match(await read('../src/components/staff/licence/LicenceTable.jsx'), /sticky right-0/)
})

await test('หน้าจอ: ข้อความใต้ช่องหมายเหตุห้ามใส่เบอร์โทร/ข้อมูลส่วนตัว (ประวัติถาวร) · ลบใบที่มีรายการรับเงินไม่ได้ = บอกให้เปลี่ยนเป็นเลิกกิจการ · เลิกกิจการ→อื่นต้องมีเลขคำสั่ง', async () => {
  const form = await read('../src/components/staff/licence/LicenceFormSheet.jsx')
  assert.match(form, /ห้ามใส่เบอร์โทร เลขบัตรประชาชน หรือข้อมูลส่วนตัวอื่น — ประวัติการแก้ไขเก็บถาวร/)
  assert.match(form, /err\.code === '23503'/)
  assert.match(form, /เปลี่ยนสถานะเป็น "เลิกกิจการ"/)
  const status = await read('../src/components/staff/licence/LicenceStatusSheet.jsx')
  assert.match(status, /\['revoked', 'closed'\]\.includes\(licence\.status\)/)
})

console.log(`\n${cases} cases passed`)

