import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildCouncilComplaintHtml } from '../src/lib/councilFormPrint.js'
import { printableCategoryLabel, STANDARD_CATEGORY_LABEL, UNKNOWN_CATEGORY_LABEL } from '../src/lib/complaintCategoryLabels.js'

const signatories = {
  department_head: { name: '[TEST] หัวหน้ากองช่าง', title: 'ผู้อำนวยการกองช่าง' },
  clerk: { name: '[TEST] ปลัด', title: 'ปลัดเทศบาล' },
  mayor: { name: '[TEST] นายก', title: 'นายกเทศมนตรี' },
}

const baseArgs = {
  c: {
    id: '00000000-0000-4000-8000-000000000001',
    reporter_name: '[TEST] ผู้ยื่นคำร้อง',
    category: 'light',
    department: 'กองช่าง',
    detail: 'ไฟฟ้าสาธารณะชำรุดสำหรับทดสอบ',
    village: 'หมู่ทดสอบ',
  },
  tenant: {
    name: 'เทศบาลตำบลทดสอบ',
    org_type: 'เทศบาลตำบล',
    district: 'อำเภอทดสอบ',
    province: 'จังหวัดทดสอบ',
  },
  terminology: { mayor: 'นายกเทศมนตรี', clerk: 'ปลัดเทศบาล', council: 'สมาชิกสภาเทศบาล' },
  num: 'TEST-PRINT-001',
  thDate: '1 มกราคม 2570',
  cat: 'ไฟฟ้าสาธารณะ',
  phone: '0000000000',
}

const namedHtml = buildCouncilComplaintHtml({ ...baseArgs, signatories })
for (const person of Object.values(signatories)) {
  assert.match(namedHtml, new RegExp(person.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
}

// ผู้ลงนามที่ไม่ใช่เจ้าของตำแหน่งต้องแสดงฐานอำนาจในเอกสาร ไม่ใช่เก็บไว้แต่ในฐานข้อมูล
const actingHtml = buildCouncilComplaintHtml({
  ...baseArgs,
  signatories: {
    ...signatories,
    department_head: {
      name: '[TEST] ผู้รักษาราชการแทน',
      title: 'รักษาราชการแทน ผู้อำนวยการกองช่าง',
      authority_reference: 'คำสั่งที่ [TEST] 45/2570',
    },
  },
})
assert.ok(actingHtml.includes('คำสั่งที่ [TEST] 45/2570'))
// ไม่มีเลขคำสั่ง = ต้องไม่มีวงเล็บเปล่าเกินมาใต้ตำแหน่ง
assert.ok(!buildCouncilComplaintHtml({ ...baseArgs, signatories }).includes('font-size:12px;margin-top:2px'))

const blankHtml = buildCouncilComplaintHtml({ ...baseArgs, signatories: {} })
assert.doesNotMatch(blankHtml, /นายชัยศักดิ์ ชัยธรรม/)
assert.match(blankHtml, /\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\.\./)

const draftHtml = buildCouncilComplaintHtml({
  ...baseArgs,
  signatories,
  includeStaffSignatures: false,
})
assert.doesNotMatch(draftHtml, /\[TEST\] หัวหน้ากองช่าง/)
// ⚠️ ตรวจจาก "โครงสร้างช่องลงนาม" ไม่ใช่จากข้อความเส้นจุด — ข้อความเปลี่ยนได้ทุกครั้งที่
// มาตรฐานช่องลงนามเปลี่ยน (เปลี่ยนมาแล้ว 2569-09-12) แล้วเทสต์จะผ่านลวงทั้งที่บล็อกยังอยู่
assert.doesNotMatch(draftHtml, /class="sign-row"/)
assert.match(namedHtml, /class="sign-row"/,
  'ใบที่พิมพ์ปกติต้องมีบล็อกลงชื่อ ไม่งั้นข้อบนไม่ได้พิสูจน์อะไรเลย')

// ชื่อหมวดบนใบคำร้องต้องเป็นภาษาไทยเสมอ — เจ้าของระบบแจ้ง 2569-10-02 จากใบที่พิมพ์จริง: "ขอให้พิจารณาดำเนินการเกี่ยวกับwater_repair"
// สาเหตุ: หน้าจอส่ง `CATEGORY_LABEL[รหัส] ?? รหัส` มา ถ้าชื่อจากฐานข้อมูลยังไม่ merge/หมวดไม่มีแถว ก็ได้รหัสดิบ
{
  const bodyText = html => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const printed = (category, cat) => bodyText(buildCouncilComplaintHtml({ ...baseArgs, c: { ...baseArgs.c, category }, cat, signatories }))

  // เคสจริง: ผู้เรียกส่งรหัสดิบมาเป็นชื่อหมวด
  const raw = printed('water_repair', 'water_repair')
  assert.ok(!/[A-Za-z]{3,}_[A-Za-z]+|water_repair/.test(raw), 'ใบคำร้องยังมีรหัสหมวดดิบ: ' + raw.match(/.{0,30}water_repair.{0,20}/)?.[0])
  assert.ok(raw.includes('ขอให้พิจารณาดำเนินการเกี่ยวกับซ่อมน้ำประปา'), 'หัวเรื่องต้องใช้ชื่อไทยมาตรฐานของหมวด')
  assert.ok(raw.includes('คำร้องขอให้พิจารณาดำเนินการเกี่ยวกับซ่อมน้ำประปา'), 'หัวใบต้องใช้ชื่อไทยมาตรฐานของหมวด')

  // ชื่อที่ อปท. ตั้งเองเป็นไทย ใช้ตามนั้น ไม่ทับด้วยชื่อมาตรฐาน
  assert.ok(printed('water_repair', 'แจ้งท่อประปาแตก').includes('เกี่ยวกับแจ้งท่อประปาแตก'), 'ชื่อไทยที่ อปท. ตั้งเองต้องไม่ถูกทับ')
  // หมวดไม่รู้จัก/ชื่อว่าง/ขีดกลาง → "เรื่องที่แจ้ง" ไม่ปล่อยรหัสหรือขีดกลางลงกระดาษ
  for (const cat of ['cat_mtsubkz2', '', undefined, '—']) {
    const text = printed('cat_mtsubkz2', cat)
    assert.ok(!text.includes('cat_mtsubkz2'), `รหัสสุ่มหลุดลงกระดาษ (cat=${JSON.stringify(cat)})`)
    assert.ok(text.includes(`เกี่ยวกับ${UNKNOWN_CATEGORY_LABEL}`), `ต้องใช้ "${UNKNOWN_CATEGORY_LABEL}" (cat=${JSON.stringify(cat)})`)
  }
  // ชื่อที่ไม่ใช่ไทยแต่ไม่เหมือนรหัส (แอดมินตั้งเอง) คงไว้ ไม่เดาแทน
  assert.equal(printableCategoryLabel('wifi_zone', 'Wi-Fi สาธารณะ'), 'Wi-Fi สาธารณะ')
  assert.equal(printableCategoryLabel('wifi_zone', 'Free WiFi'), 'Free WiFi')

  // ชื่อมาตรฐานทุกตัวต้องเป็นไทย และไม่ซ้ำรหัส — กันมีคนเพิ่มรหัสใหม่แล้วใส่ชื่ออังกฤษ
  for (const [code, label] of Object.entries(STANDARD_CATEGORY_LABEL)) {
    assert.ok(/[ก-๙]/.test(label), `ชื่อมาตรฐานของ ${code} ไม่มีอักษรไทย: "${label}"`)
    assert.equal(printableCategoryLabel(code, code), label, `รหัส ${code} ต้องแปลงเป็นชื่อมาตรฐาน`)
  }
  // หมวดมาตรฐานที่ค่าตั้งต้นของแอดมินสร้างให้ทุก อปท. ต้องมีชื่อมาตรฐานครบ (water_repair คือตัวที่ขาดจนหลุด)
  const adminSource = await readFile(new URL('../src/pages/AdminDashboard.jsx', import.meta.url), 'utf8')
  const seed = adminSource.slice(adminSource.indexOf('const DEFAULT_SEED'), adminSource.indexOf('const EMOJI_HINTS'))
  for (const [, code] of seed.matchAll(/value:\s*'([a-z_]+)'/g)) {
    assert.ok(STANDARD_CATEGORY_LABEL[code], `หมวดตั้งต้น "${code}" ไม่มีชื่อมาตรฐานใน complaintCategoryLabels.js`)
  }
}

// รายงานผู้บริหารที่พิมพ์/ส่งออก CSV (ReportManager + ชุดซ้ำในหน้าแอดมิน) และเมนูผลการปฏิบัติงาน ต้องกรองชื่อหมวดด้วยตัวเดียวกัน
// — ฟังก์ชันพิมพ์ไม่ได้ export และ import supabase จึงเทสต์พฤติกรรมไม่ได้ ตรวจจากต้นฉบับว่ายังเรียกใช้และไม่กลับไปใช้ `ชื่อ ?? รหัส`
for (const file of ['src/components/admin/ReportManager.jsx', 'src/pages/AdminDashboard.jsx', 'src/components/staff/StaffPerformanceModule.jsx']) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.ok(source.includes('printableCategoryLabel'), `${file} ไม่ได้ใช้ printableCategoryLabel`)
}
for (const file of ['src/components/admin/ReportManager.jsx', 'src/pages/AdminDashboard.jsx']) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  // ตารางประเภทคำร้องของรายงาน (catDataAll) และคอลัมน์ประเภทของ CSV ต้องผ่านตัวกรอง
  assert.match(source, /name: printableCategoryLabel\(cat, CATEGORY_LABEL\[cat\] \?\? cat\)/, `${file}: ตารางประเภทคำร้องของรายงานกลับไปใช้ชื่อดิบ`)
  assert.match(source, /c\.category \? printableCategoryLabel\(c\.category, CATEGORY_LABEL\[c\.category\] \?\? c\.category\) : ''/, `${file}: คอลัมน์ประเภทของ CSV กลับไปใช้ชื่อดิบ`)
  assert.doesNotMatch(source, /name: CATEGORY_LABEL\[cat\] \?\? cat/, `${file}: ยังมีชื่อหมวดแบบ ชื่อ ?? รหัส ในตารางรายงาน`)
}

const citizenFormSource = await readFile(new URL('../src/pages/CitizenForm.jsx', import.meta.url), 'utf8')
const ossFormSource = await readFile(new URL('../src/components/admin/OssIntakeForm.jsx', import.meta.url), 'utf8')
const printSource = await readFile(new URL('../src/lib/councilFormPrint.js', import.meta.url), 'utf8')
const migrationSource = await readFile(new URL('../supabase/migrations/20260901160000_complaint_routing_and_signatories.sql', import.meta.url), 'utf8')
const manualSignatoryMigrationSource = await readFile(new URL('../supabase/migrations/20260901170000_manual_document_signatories.sql', import.meta.url), 'utf8')
const signatorySettingsSource = await readFile(new URL('../src/components/admin/SignatorySettings.jsx', import.meta.url), 'utf8')
// ทะเบียนผู้ลงนามเป็นของกลาง ไม่ได้ผูกกับคำร้องแล้ว — วันที่/scope ย้ายมารวมที่ helper ตัวนี้
const signatoryLibSource = await readFile(new URL('../src/lib/documentSignatories.js', import.meta.url), 'utf8')

assert.doesNotMatch(citizenFormSource, /CATEGORY_DEPT/)
assert.doesNotMatch(ossFormSource, /CATEGORY_DEPT/)
assert.match(citizenFormSource, /submit_citizen_complaint_v4/)
assert.match(ossFormSource, /submit_citizen_complaint_v4/)
assert.doesNotMatch(printSource, /staffList|title\?\.includes|นายชัยศักดิ์ ชัยธรรม/)
assert.match(migrationSource, /GRANT SELECT ON TABLE public\.document_signatories TO authenticated/)
assert.match(migrationSource, /p_user_id IS DISTINCT FROM auth\.uid\(\)/)
assert.match(migrationSource, /auth\.role\(\) IN \('anon', 'authenticated'\)/)
assert.match(migrationSource, /รายละเอียดคำร้องต้องมี 10-5000 ตัวอักษร/)
assert.match(migrationSource, /p_effective_from IS NULL OR p_effective_from > v_today/)
assert.match(migrationSource, /timezone\('Asia\/Bangkok', now\(\)\)::date/)
// หน้าจอย้ายไป v3 แล้ว (รองรับแถวที่แอดมินสร้างเอง) — v2 ยังอยู่ในฐานข้อมูลไว้ย้อนดูของเดิม
// แต่ต้องไม่มีใครเรียกจากโค้ดอีก ไม่งั้นการบันทึกจะข้ามกติกาของ custom_label ไปได้
assert.match(signatorySettingsSource, /set_document_signatory_v4/)
assert.doesNotMatch(signatorySettingsSource, /set_document_signatory_v[23]/)
assert.match(signatorySettingsSource, /กรอกชื่อเอง/)
assert.match(signatorySettingsSource, /ใช้สำหรับผู้ลงนามที่ไม่มีบัญชีในระบบ/)
assert.match(manualSignatoryMigrationSource, /ADD COLUMN IF NOT EXISTS manual_name text/)
assert.match(manualSignatoryMigrationSource, /ALTER COLUMN profile_id DROP NOT NULL/)
assert.match(manualSignatoryMigrationSource, /CREATE OR REPLACE FUNCTION public\.set_document_signatory_v2/)
assert.match(manualSignatoryMigrationSource, /LEFT JOIN public\.profiles AS profile/)
assert.match(manualSignatoryMigrationSource, /NULLIF\(btrim\(signatory\.manual_name\), ''\)/)

// เคาน์เตอร์ OSS รับคำร้องได้ทุกกอง จึงต้องพิมพ์ใบรับเรื่องคืนผู้มาติดต่อได้ทุกกองด้วย
assert.ok(manualSignatoryMigrationSource.includes("OR v_complaint.channel = 'oss_counter'"))
// ชื่อผู้ลงนามที่ resolve ไม่ได้ต้องตกเป็น missing_roles ไม่ใช่พิมพ์วงเล็บเปล่าออกมาเป็นเอกสารราชการ
assert.ok(manualSignatoryMigrationSource.includes("      ) IS NOT NULL"))
// เลขที่คำสั่ง/หนังสือรักษาราชการแทนเป็นเลขเอกสารราชการ ไม่ใช่ข้อมูลส่วนบุคคล จึงต้องอยู่ใน audit trail
assert.ok(manualSignatoryMigrationSource.includes("'authority_reference', NULLIF(btrim(p_authority_reference), '')"))
assert.ok(!manualSignatoryMigrationSource.includes("has_authority_reference"))
// หมวดที่เปิดใช้งานแต่ไม่มีกอง = ประชาชนส่งคำร้องหมวดนั้นไม่ได้ ต้องกันที่ DB ไม่ใช่เชื่อ Browser
assert.ok(manualSignatoryMigrationSource.includes("trg_active_category_requires_department"))

// แบบพิมพ์คำร้องต้องหยิบผู้ลงนามแค่ 3 บทบาทนี้เท่านั้น — ทะเบียนเป็นของกลางและมีบทบาท
// 'vehicle_authority' (ผู้รับมอบอำนาจสั่งใช้รถ) เพิ่มเข้ามาแล้ว ถ้า whitelist นี้ถูกแก้ให้กว้างขึ้น
// คำร้องจะถูกลงนามโดยผู้ที่ได้รับมอบอำนาจมาเฉพาะเรื่องรถ ซึ่งเป็นการระบุผู้ลงนามผิดตัว
assert.ok(manualSignatoryMigrationSource.includes(
  "(signatory.signatory_role = 'department_head'"))
assert.ok(manualSignatoryMigrationSource.includes(
  "OR (signatory.signatory_role IN ('clerk', 'mayor')"))
// รายการนับ "ขาดผู้ลงนาม" ก็ต้องคงไว้ 3 บทบาท ไม่งั้นทุก อปท. ที่ไม่ได้มอบอำนาจ
// จะพิมพ์คำร้องไม่ได้เพราะระบบหาว่ายังตั้งค่าไม่ครบ
assert.ok(manualSignatoryMigrationSource.includes(
  "VALUES ('department_head'::text, 1), ('clerk'::text, 2), ('mayor'::text, 3)"))
assert.ok(!manualSignatoryMigrationSource.includes('vehicle_authority'))
// v1 เป็นทางเขียนที่สองที่ข้ามกติกา manual signer ทั้งชุด
assert.ok(manualSignatoryMigrationSource.includes("REVOKE EXECUTE ON FUNCTION public.set_document_signatory("))

// UI: ค่าจากอีกโหมดต้องไม่ไหลข้ามมา และวันที่ต้องอิง Asia/Bangkok ให้ตรงกับที่ RPC ตรวจ
assert.ok(signatorySettingsSource.includes("function switchMode(nextMode)"))
assert.ok(signatoryLibSource.includes("timeZone: 'Asia/Bangkok'"))
assert.ok(signatorySettingsSource.includes('todayBangkok'))
assert.ok(!signatorySettingsSource.includes("getTimezoneOffset"))
assert.ok(!signatoryLibSource.includes("getTimezoneOffset"))
assert.ok(signatorySettingsSource.includes("Boolean(selected)"))

// RLS ปัดตก UPDATE แล้วคืน 204 ไม่มี error — การเขียน department_id ต้องนับแถวที่เขียนจริงเสมอ
const adminDashboardSource = await readFile(new URL('../src/pages/AdminDashboard.jsx', import.meta.url), 'utf8')
assert.ok(adminDashboardSource.includes("async function writeCategoryDepartment"))
assert.ok(!adminDashboardSource.includes(".update({ department_id: d.department_id || null }).eq('id', cat.id)"))
assert.ok(!adminDashboardSource.includes(".update({ department_id: departmentId || null }).eq('id', cat.id)"))
assert.ok(!adminDashboardSource.includes(".update({ is_active: !current }).eq('id', id)\n"))

// เลขที่คำสั่งกับช่วงวันที่ถูกถอดออกจากหน้าจอตามการตัดสินใจของผู้ดูแลระบบ
// ทั้งสองฝั่งต้องถอดพร้อมกัน: ถ้า UI ไม่มีช่องกรอกแต่ RPC ยังบังคับเลขที่คำสั่งของผู้ลงนามนอกกอง
// ผู้ดูแลจะกดบันทึกไม่ผ่านโดยไม่มีทางแก้จากหน้าจอเลย
assert.ok(!manualSignatoryMigrationSource.includes("ผู้ลงนามอยู่นอกกอง ต้องระบุเลขที่คำสั่ง"))
// PostgREST จับคู่ฟังก์ชันจากชุดชื่อ argument ที่ส่งไป การละ argument ที่มี DEFAULT ทำให้เสี่ยง
// PGRST202 ที่อ่านไม่ออก จึงต้องส่งครบทั้ง 9 ตัวเสมอ แม้ตัวที่หน้าจอไม่ให้กรอกแล้ว
assert.ok(signatorySettingsSource.includes("p_authority_reference: null"))
assert.ok(signatorySettingsSource.includes("p_effective_from: null"))
assert.ok(signatorySettingsSource.includes("p_effective_to: null"))
assert.ok(signatorySettingsSource.includes("PGRST202"))
// วันเริ่มมีผลต้องมาจาก DB ไม่ใช่นาฬิกาเครื่องผู้ใช้ (หน้าจอไม่มีช่องให้แก้แล้ว)
assert.ok(manualSignatoryMigrationSource.includes("v_effective_from date := coalesce(p_effective_from, v_today)"))
assert.ok(!manualSignatoryMigrationSource.includes("IF p_effective_from IS NULL OR p_effective_from > v_today THEN"))
// พารามิเตอร์ยังต้องอยู่ในลายเซ็นฟังก์ชัน เผื่อกลับมาบังคับใช้โดยไม่ต้องแก้ signature
assert.ok(manualSignatoryMigrationSource.includes("p_authority_reference text DEFAULT NULL"))
assert.ok(manualSignatoryMigrationSource.includes("p_effective_from date DEFAULT (timezone('Asia/Bangkok', now())::date)"))

// fetchPersonnelSignatories คือทางเดาชื่อผู้ลงนามแบบเก่า ต้องไม่เหลือไว้ให้เผลอเรียกอีก
const personnelDirectorySource = await readFile(new URL('../src/lib/personnelDirectory.js', import.meta.url), 'utf8')
assert.ok(!personnelDirectorySource.includes("fetchPersonnelSignatories"))

console.log('complaint print/routing assertions passed')
