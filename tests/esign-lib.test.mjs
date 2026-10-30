// ลงนามออนไลน์รายเรื่อง — ตัวช่วยฝั่งหน้าจอ (src/lib/esign.js, src/lib/esignApi.js) เทียบกับ migration ฝั่ง DB
//   node tests/esign-lib.test.mjs   (หรือ npm run test:esign)
// กันเรื่องที่เงียบแล้วพังตอนใช้จริง: (1) DB เพิ่มรหัสผลลัพธ์ใหม่แต่หน้าจอไม่มีข้อความ ผู้ใช้เห็นรหัสดิบ/ข้อความว่าง
// (2) หน้าจอเรียก RPC ไม่ครบ argument → PostgREST ตอบ PGRST202 ที่อ่านไม่ออก (3) ช่องลงนามหน้าจอไม่ตรงกับ DB
// (4) ร่างประกาศอ้างมาตรา/ข้อที่ไม่ได้ตรวจกับตัวบท
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  ESIGN_DECISION_LABEL, ESIGN_DUTY_TEXT, ESIGN_FLEET_SLOTS, ESIGN_MESSAGES, ESIGN_TRIP_EXCEPTIONS, esignAnnouncementDraft, esignAnyOnline, esignBlockers,
  esignDepartWarning, esignFailureText, esignGateItems, esignMessage, esignModesFromStatus, esignPendingFromRpc, esignPendingKey, esignPendingRow, esignRevokeTargets,
} from '../src/lib/esign.js'
import { isVerifyBusy, isVerifyCode, verifySlotRows, verifySummary } from '../src/lib/esignVerify.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const functionsOldSql = await read('../supabase/migrations/20261022100200_esign_functions.sql')
// ชุด B1.5 ยกฟังก์ชันที่แก้มาเต็มตัวในไฟล์ใหม่ — นิยามหลังสุดชนะ (ลำดับเดียวกับที่ apply บนฐานจริง)
const gateRelaxSql = await read('../supabase/migrations/20261022110100_esign_gate_relax_functions.sql')
// ชุด S1 (ภาพลายเซ็น) เป็นฟังก์ชันใหม่ล้วน ไม่ทับของเดิม
const imageFunctionsSql = await read('../supabase/migrations/20261023100100_esign_image_functions.sql')
// ชุด S3a: แก้ esign_trip_status (ยกมาเต็มตัว) + เพิ่ม esign_my_pending — นิยามหลังสุดชนะ
const tripPanelSql = await read('../supabase/migrations/20261023110000_esign_trip_panel_functions.sql')
// 2569-10-25: แอดมินลบทริปที่มีลายเซ็นได้ — ยก esign_fleet_trip_guard มาเต็มตัวในไฟล์ใหม่ (นิยามหลังสุดชนะ)
const adminDeleteSql = await read('../supabase/migrations/20261025120000_esign_trip_admin_delete.sql')
const functionsSql = functionsOldSql + '\n' + gateRelaxSql + '\n' + imageFunctionsSql + '\n' + tripPanelSql + '\n' + adminDeleteSql
const apiSource = await read('../src/lib/esignApi.js')
const esignLibSource = await read('../src/lib/esign.js')

// รหัสที่ถูกถอดจากฟังก์ชันแล้ว (ยังค้างอยู่ในไฟล์ชุด A เพราะ migration ที่ apply แล้วแก้ย้อนไม่ได้) — หน้าจอไม่ต้องมีข้อความ
const RETIRED_CODES = ['gate_policy_missing']

let cases = 0
const test = async (label, run) => { await run(); cases++; console.log('PASS ' + label) }

await test('ทุกรหัสผลลัพธ์ (code/reason) ที่ฟังก์ชัน DB คืนได้ มีข้อความภาษาไทยในหน้าจอ', () => {
  const codes = new Set([...functionsSql.matchAll(/'(?:code|reason)',\s*'([a-z_]+)'/g)].map(match => match[1]))
  assert.ok(codes.size >= 30, `อ่านรหัสจาก migration ได้น้อยผิดปกติ (${codes.size})`)
  for (const retired of RETIRED_CODES) {
    assert.ok(codes.has(retired), `${retired} ไม่อยู่ในไฟล์ชุด A แล้ว — เอาออกจาก RETIRED_CODES`)
    assert.ok(!gateRelaxSql.match(new RegExp(`'(?:code|reason)',\\s*'${retired}'`)), `${retired} ถูกถอดแล้ว แต่ไฟล์ B1.5 ยังคืนรหัสนี้`)
    assert.equal(ESIGN_MESSAGES[retired], undefined, `${retired} ถูกถอดแล้ว ไม่ควรมีข้อความค้างในหน้าจอ`)
    codes.delete(retired)
  }
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

await test('ทุกชื่อที่หน้าจอ import จาก lib/esign · esignApi · signatureImage · signatureCanvas มี export จริง (eslint ไม่จับ — เคยหลุดไปถึง build)', async () => {
  const libs = {
    esign: await import('../src/lib/esign.js'),
    esignUi: await import('../src/lib/esignUi.js'),
    signatureImage: await import('../src/lib/signatureImage.js'),
    esignPrint: await import('../src/lib/esignPrint.js'),
    esignVerify: await import('../src/lib/esignVerify.js'),
  }
  // esignApi/signatureCanvas ต้องใช้ supabase/DOM จึง import ใน Node ไม่ได้ — อ่านรายชื่อ export จากซอร์ส
  const exportsOf = source => new Set([...source.matchAll(/export (?:const|async function|function) (\w+)/g)].map(match => match[1]))
  const sources = { esignApi: exportsOf(apiSource), signatureCanvas: exportsOf(await read('../src/lib/signatureCanvas.js')) }
  const components = [
    '../src/components/admin/EsignSettings.jsx', '../src/components/profile/MyEsignSection.jsx',
    '../src/components/profile/AddSignatureDialog.jsx', '../src/components/profile/SignaturePad.jsx',
    '../src/components/esign/PinForm.jsx', '../src/components/esign/SignTripDialog.jsx', '../src/components/esign/TripEsignPanel.jsx', '../src/components/fleet/FleetTrips.jsx',
    '../src/components/esign/MyPendingSignatures.jsx', '../src/components/staff/StaffOperationalDashboard.jsx', '../src/pages/VerifyEsign.jsx',
  ]
  let checked = 0
  for (const path of components) {
    const component = await read(path)
    for (const match of component.matchAll(/import \{([^}]*)\} from '(?:\.\.\/)+lib\/(esign|esignApi|esignUi|signatureImage|signatureCanvas|esignPrint|esignVerify)'/g)) {
      const names = match[1].split(',').map(name => name.trim().split(/\s+as\s+/)[0]).filter(Boolean)
      for (const name of names) {
        const exported = libs[match[2]] ? name in libs[match[2]] : sources[match[2]].has(name)
        assert.ok(exported, `${path}: lib/${match[2]} ไม่มี export ${name}`)
        checked++
      }
    }
  }
  assert.ok(checked >= 30, `ตรวจชื่อ import ได้น้อยผิดปกติ (${checked})`)
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

await test('ประตู: ปิดทั้งหมดไม่ติดอะไร · เปิดต้องยืนยันทดลองเท่านั้น (ประกาศไม่เป็นเงื่อนไข) · ช่องผู้มีอำนาจ/หัวหน้ากองต้องผูกบัญชีเมื่อเลือกออนไลน์เท่านั้น', () => {
  const none = { policy: null, authority_linked: 0, dept_head_linked: 0 }
  const wet = { requester: 'wet', dept_head: 'wet', authority: 'wet', sk1: 'wet' }
  assert.deepEqual(esignBlockers(none, wet), [], 'ปิดทั้งหมดเปิดได้เสมอ (ไม่ใช่การเปิด)')
  assert.deepEqual(esignBlockers(none, { ...wet, requester: 'online' }), ['trial'], 'ไม่มีประกาศต้องไม่ขวาง — ติดแค่ยังไม่ยืนยันทดลอง')
  const announcedNoTrial = { policy: { announcement_no: 'ก 1', trial_confirmed_at: null }, authority_linked: 0, dept_head_linked: 0 }
  assert.deepEqual(esignBlockers(announcedNoTrial, { ...wet, requester: 'online' }), ['trial'], 'มีประกาศก็ไม่แทนการยืนยันทดลอง')
  // แถวนโยบายที่เกิดจากการกดยืนยันทดลองอย่างเดียว (ไม่มีเลขที่ประกาศ) = ผ่านประตู
  const trialOnly = { policy: { announcement_no: null, trial_confirmed_at: '2026-10-22T05:00:00Z' }, authority_linked: 0, dept_head_linked: 0 }
  assert.deepEqual(esignBlockers(trialOnly, { ...wet, requester: 'online' }), [])
  const ready = { policy: { announcement_no: 'ก 1', trial_confirmed_at: '2026-10-22T05:00:00Z' }, authority_linked: 1, dept_head_linked: 0 }
  assert.deepEqual(esignBlockers(ready, { ...wet, requester: 'online', authority: 'online' }), [])
  assert.deepEqual(esignBlockers(ready, { ...wet, dept_head: 'online' }), ['dept_head'])
  assert.deepEqual(esignBlockers(ready, { ...wet, authority: 'online', dept_head: 'online' }), ['dept_head'])
  const items = esignGateItems(ready, { ...wet, authority: 'online' })
  assert.deepEqual(items.map(item => [item.key, item.required, item.ok]),
    [['trial', true, true], ['authority', true, true], ['dept_head', false, false]])
  assert.ok(!items.some(item => item.key === 'policy'), 'ห้ามมีประตูประกาศกลับมาโดยไม่ได้รับคำสั่งเจ้าของระบบ')
})

await test('บันทึกประกาศ: ทุกช่องส่งเป็น null เมื่อว่าง (วันที่ว่าง "" จะตก date cast error ที่ PostgREST) · หน้าตั้งค่าไม่บังคับกรอก', async () => {
  const call = /callEsign\('set_esign_policy',\s*\{([^}]*)\}/.exec(apiSource)
  assert.ok(call, 'ไม่พบ setEsignPolicy')
  for (const arg of ['p_announcement_no', 'p_announcement_date', 'p_approval_ref', 'p_announcement_url']) {
    assert.ok(new RegExp(`${arg}:\\s*orNull\\(`).test(call[1]), `${arg} ต้องผ่าน orNull`)
  }
  const component = await read('../src/components/admin/EsignSettings.jsx')
  // ช่องประกาศต้องไม่มีเครื่องหมายบังคับ (*) และปุ่มบันทึกต้องไม่ถูกล็อกด้วยการกรอกไม่ครบ
  assert.ok(!/htmlFor="esign-(?:no|date|approval)">[^<]*\*/.test(component), 'ช่องประกาศมี * บังคับกรอก')
  assert.ok(!/policyComplete/.test(component), 'ปุ่มบันทึกประกาศยังผูกกับ policyComplete')
  assert.ok(!/policyReady/.test(component), 'ข้อทดลอง/ข้ออื่นยังรอการบันทึกประกาศ (policyReady)')
  // ปุ่มยืนยันทดลองและปุ่มบันทึกช่องลงนาม ต้องไม่ผูกกับสถานะประกาศแม้ใช้ชื่อตัวแปรอื่น
  const trialDisabled = /disabled=\{busy === 'trial'([^}]*)\}/.exec(component)
  assert.ok(trialDisabled, 'ไม่พบเงื่อนไข disabled ของปุ่มยืนยันทดลอง')
  assert.ok(!/policy|announcement|approval/i.test(trialDisabled[1]), `ปุ่มยืนยันทดลองผูกกับประกาศ: ${trialDisabled[1]}`)
  const modesDisabled = /disabled=\{busy === 'modes' \|\| !modesDirty([^}]*)\}/.exec(component)
  assert.ok(modesDisabled, 'ไม่พบเงื่อนไข disabled ของปุ่มบันทึกช่องลงนาม')
  assert.ok(!/policy|announcement|approval/i.test(modesDisabled[1]), `ปุ่มบันทึกช่องลงนามผูกกับประกาศ: ${modesDisabled[1]}`)
})

await test('ลายเซ็นของฉัน: RPC ครบ · หน้าเฉพาะคุมด้วย staffOnly · โปรไฟล์/เมนู/แท็บไปเส้นทางเดียวกัน · ลิงก์เก่ายัง redirect', async () => {
  const wrappers = new Set([...apiSource.matchAll(/callEsign\('(\w+)'/g)].map(match => match[1]))
  for (const name of ['esign_my_signer_overview', 'esign_my_signatures', 'esign_my_signature_add', 'esign_my_signature_set_default',
    'esign_my_signature_delete', 'esign_my_signature_history', 'set_esign_pin', 'esign_suspend_me']) {
    assert.ok(wrappers.has(name), `esignApi ไม่มีตัวเรียก ${name}`)
  }
  const app = await read('../src/App.jsx')
  assert.match(app, /<Route\s+path="\/staff\/my-signatures"\s+element=\{\s*<RequireAuth\s+staffOnly>\s*<MySignaturesPage\s*\/>\s*<\/RequireAuth>\s*\}\s*\/>/, 'หน้าเฉพาะต้องอยู่ใต้ RequireAuth staffOnly')
  const page = await read('../src/pages/MySignaturesPage.jsx')
  assert.match(page, /<AccountPageLayout\s+active="signatures"/, 'หน้าเฉพาะต้องเลือกแท็บลายเซ็น')
  assert.match(page, /<MyEsignSection\s*\/>/, 'หน้าเฉพาะต้องแสดงคลังลายเซ็นโดยตรง')
  const profile = await read('../src/pages/ProfilePage.jsx')
  assert.doesNotMatch(profile, /<MyEsignSection\b/, 'หน้าโปรไฟล์ต้องไม่ mount หรืออ่านคลังลายเซ็นของแท็บที่ไม่ได้เปิด')
  assert.match(profile, /STAFF_ROLES\.includes\(contextRole \?\? profile\.role\) && \(\s*<Link to="\/staff\/my-signatures"[^>]*data-profile-signatures/, 'ทางเข้าจากโปรไฟล์ต้องแสดงเฉพาะเจ้าหน้าที่')
  assert.match(profile, /if \(hash === '#signature' && !profileLoading && !profileError && STAFF_ROLES\.includes\(contextRole\)\) \{\s*return <Navigate to="\/staff\/my-signatures"/, 'ลิงก์เก่า #signature ต้องรอสิทธิ์พร้อมแล้ว redirect ไปหน้าเฉพาะ')
  const menu = await read('../src/components/layout/StaffAccountMenu.jsx')
  assert.match(menu, /canAccessStaffPortal\(role\) && <Link to="\/staff\/my-signatures"[^>]*data-account-signature/, 'เมนูบัญชีต้องไปหน้าเฉพาะและแสดงเฉพาะผู้มีสิทธิ์')
  const tabs = await read('../src/components/profile/AccountTabs.jsx')
  assert.match(tabs, /!profileLoading && !profileError && canAccessStaffPortal\(role\)/, 'แท็บลายเซ็นต้องรอสิทธิ์พร้อมก่อนแสดง')
  assert.match(tabs, /id: 'signatures', label: 'ลายเซ็นของฉัน', to: '\/staff\/my-signatures'/, 'แท็บต้องใช้เส้นทางเดียวกับหน้าเฉพาะ')
  const section = await read('../src/components/profile/MyEsignSection.jsx')
  // ห้ามอ้างเลขมาตราของ พ.ร.บ./พ.ร.ฎ. ในข้อความหน้าจอของส่วนนี้ (ต้องตรวจกับตัวบทก่อน — เคยผิดมาแล้ว)
  for (const source of [page, section, await read('../src/components/profile/AddSignatureDialog.jsx')]) {
    assert.ok(!/มาตรา\s*[๐-๙0-9]/.test(source), 'หน้าลายเซ็นของฉันห้ามอ้างเลขมาตราลอยๆ')
  }
  assert.ok(ESIGN_DUTY_TEXT.length > 40 && !/มาตรา/.test(ESIGN_DUTY_TEXT))
  assert.deepEqual(Object.keys(ESIGN_DECISION_LABEL).sort(), ['approve', 'sign'])
})

await test('ชื่อฟิลด์ที่หน้า "ลายเซ็นของฉัน" อ่านจากผลของ RPC มีอยู่จริงใน SQL (หน้าจอใช้ฐานข้อมูลจำลองในเทสต์เบราว์เซอร์ จึงต้องเทียบกับ SQL ตรงนี้)', async () => {
  const section = await read('../src/components/profile/MyEsignSection.jsx')
  const sqlKeys = new Set([...functionsSql.matchAll(/'([a-z0-9_]+)',\s/g)].map(match => match[1]))
  const fromOverview = [...section.matchAll(/overview\?\.([a-z_]+)/g)].map(match => match[1])
  const explicit = ['items', 'png_base64', 'is_default', 'label', 'slot_label', 'decision', 'signed_at', 'revoked', 'with_image',
    'signature_id', 'kept_as_evidence', 'remaining', 'width', 'height']
  assert.ok(fromOverview.length >= 4, 'อ่านชื่อฟิลด์ของภาพรวมจากหน้าจอได้น้อยผิดปกติ')
  for (const key of new Set([...fromOverview, ...explicit])) {
    assert.ok(sqlKeys.has(key), `หน้าจออ่านฟิลด์ "${key}" แต่ไม่มีใน jsonb ของฟังก์ชัน DB ที่คืนค่า`)
  }
})

await test('แผงลงนามในหน้าทริป: ตัวเรียก RPC ครบ · ชื่อฟิลด์ที่แผง/กล่องอ่านมีอยู่จริงใน SQL · ต่อเข้า FleetTrips เฉพาะทริปโหมดออนไลน์', async () => {
  const wrappers = new Set([...apiSource.matchAll(/callEsign\('(\w+)'/g)].map(match => match[1]))
  for (const name of ['esign_trip_status', 'esign_sign_fleet_trip_stamped', 'esign_revoke_fleet_trip', 'esign_my_pending']) assert.ok(wrappers.has(name), `esignApi ไม่มีตัวเรียก ${name}`)
  const panel = await read('../src/components/esign/TripEsignPanel.jsx')
  const dialog = await read('../src/components/esign/SignTripDialog.jsx')
  const sqlKeys = new Set([...functionsSql.matchAll(/'([a-z0-9_]+)',\s/g)].map(match => match[1]))
  // ฟิลด์ที่อ่านจากสถานะทริป (slot.xxx / signature.xxx / status.xxx) ต้องมีใน jsonb ของ esign_trip_status จริง
  // (เทสต์เบราว์เซอร์ของแผงใช้ฐานข้อมูลจำลอง จึงต้องเทียบกับ SQL ตรงนี้)
  const fromPanel = [...panel.matchAll(/\b(?:slot|signature|status)\.([a-z_]+)/g)].map(match => match[1])
  assert.ok(fromPanel.length >= 15, `อ่านชื่อฟิลด์จากแผงได้น้อยผิดปกติ (${fromPanel.length})`)
  const notFromStatusJson = new Set(['revoked', 'message', 'code', 'length', 'key']) // ฟิลด์ของผลฟังก์ชันถอน/ตัวช่วย JS (ESIGN_FLEET_SLOTS.key) ไม่ใช่ของสถานะทริป
  for (const key of new Set(fromPanel)) {
    if (notFromStatusJson.has(key)) continue
    assert.ok(sqlKeys.has(key), `แผงอ่านฟิลด์ "${key}" แต่ไม่มีใน jsonb ของฟังก์ชัน DB`)
  }
  // ผลของ esign_sign_fleet_trip_stamped ที่หน้าจออ่าน และของ esign_my_signer_overview ที่กล่องอ่าน
  for (const key of ['stamped', 'complete', 'already', 'remaining', 'revoked']) assert.ok(sqlKeys.has(key), `ไม่มีฟิลด์ ${key} ใน SQL`)
  const fromOverview = [...dialog.matchAll(/overview\??\.([a-z_]+)/g)].map(match => match[1])
  assert.ok(fromOverview.length >= 3)
  for (const key of new Set(fromOverview)) assert.ok(sqlKeys.has(key), `กล่องลงนามอ่านฟิลด์ "${key}" แต่ไม่มีใน esign_my_signer_overview`)

  // ห้ามอ้างเลขมาตราลอยๆ ในข้อความหน้าจอของแผง/กล่อง (ต้องตรวจกับตัวบทก่อน)
  for (const source of [panel, dialog, await read('../src/components/esign/PinForm.jsx')]) assert.ok(!/มาตรา\s*[๐-๙0-9]/.test(source), 'หน้าจอลงนามห้ามอ้างเลขมาตราลอยๆ')

  // FleetTrips: แผงขึ้นเฉพาะทริปที่ DB ตรึงโหมดออนไลน์ไว้ · ปุ่มลบแปลง error · แปล error ของ trigger ลงนาม
  const fleet = await read('../src/components/fleet/FleetTrips.jsx')
  assert.ok(/\{t\.esign_slots && <TripEsignPanel trip=\{t\}/.test(fleet), 'แผงต้องขึ้นเฉพาะทริปที่มี esign_slots')
  assert.ok(/\.\.\.ESIGN_TRIP_EXCEPTIONS,/.test(fleet), 'TRIP_ERROR_TH ต้องรวมข้อความ error ของ trigger ลงนาม')
  assert.ok(/'ลบไม่สำเร็จ: ' \+ tripErrorMessage\(error\)/.test(fleet), 'ปุ่มลบต้องแปล error ผ่าน tripErrorMessage ไม่โชว์ error ดิบของ DB')
})

await test('ข้อความ error ของ trigger บน fleet_trips: ทุกรหัส ESIGN_… ที่ migration โยนมีข้อความไทยพร้อมบอกว่าต้องทำอะไรต่อ · ถอนช่องไหนแล้วตามไปกี่ช่องตรงกับ SQL', () => {
  const thrown = new Set([...functionsSql.matchAll(/RAISE EXCEPTION '(ESIGN_[A-Z_]+)/g)].map(match => match[1]))
  assert.ok(thrown.has('ESIGN_TRIP_LOCKED') && thrown.has('ESIGN_TRIP_HAS_SIGNATURES'), 'ไม่พบ exception ของ trigger ใน migration')
  // รหัสภายในที่หน้ายานพาหนะไม่มีวันเจอ: ESIGN_STAMP_MISMATCH เกิดในฟังก์ชัน RPC (ผ่าน callEsign ได้ข้อความกลาง)
  // ESIGN_APPEND_ONLY เกิดเมื่อมีคนแก้/ลบตารางลายเซ็นตรงๆ (ไม่มีทางทำผ่านแอป)
  const INTERNAL = ['ESIGN_STAMP_MISMATCH', 'ESIGN_APPEND_ONLY']
  const viaFleetPage = [...thrown].filter(code => !INTERNAL.includes(code))
  assert.deepEqual(viaFleetPage.sort(), Object.keys(ESIGN_TRIP_EXCEPTIONS).sort())
  assert.ok(ESIGN_TRIP_EXCEPTIONS.ESIGN_TRIP_LOCKED.includes('ถอนลายเซ็น'), 'ต้องบอกให้ไปถอนลายเซ็น')
  assert.ok(ESIGN_TRIP_EXCEPTIONS.ESIGN_TRIP_HAS_SIGNATURES.includes('ยกเลิก'), 'ต้องบอกทางเลือกแทนการลบ')

  const chain = /v_chain\s+text\[\]\s*:=\s*ARRAY\[([^\]]+)\]/.exec(functionsSql)
  assert.ok(chain, 'ไม่พบ v_chain ใน esign_revoke_fleet_trip')
  const dbChain = [...chain[1].matchAll(/'([a-z0-9_]+)'/g)].map(match => match[1])
  assert.deepEqual(esignRevokeTargets('requester'), dbChain)
  assert.deepEqual(esignRevokeTargets('dept_head'), dbChain.slice(1))
  assert.deepEqual(esignRevokeTargets('authority'), dbChain.slice(2))
  assert.deepEqual(esignRevokeTargets('sk1'), ['sk1'], 'สก.๑ ไม่อยู่ในสาย ถอนเดี่ยว')
  assert.deepEqual(esignRevokeTargets(null), ESIGN_FLEET_SLOTS.map(slot => slot.key), 'ไม่ระบุช่อง = ถอนทุกช่อง')
})

await test('esignFailureText: รหัสผิดเตือนเรื่องล็อกเสมอ (มี/ไม่มีจำนวนที่เหลือ) · ความผิดพลาดอื่นไม่ถูกเติมคำเตือน', () => {
  assert.equal(esignFailureText({ ok: false, code: 'bad_pin', remaining: 3 }), ESIGN_MESSAGES.bad_pin + ' (เหลืออีก 3 ครั้งก่อนระบบล็อก 15 นาที)')
  assert.equal(esignFailureText({ ok: false, code: 'bad_pin', remaining: 0 }), ESIGN_MESSAGES.bad_pin + ' (เหลืออีก 0 ครั้งก่อนระบบล็อก 15 นาที)')
  // set_esign_pin ไม่ส่ง remaining กลับ แต่นับเข้าตัวล็อกเดียวกัน — ต้องเตือนแบบไม่มีตัวเลข
  const noCount = esignFailureText({ ok: false, code: 'bad_pin' })
  assert.ok(noCount.startsWith(ESIGN_MESSAGES.bad_pin) && noCount.includes('ครบ 5 ครั้ง') && noCount.includes('15 นาที'), noCount)
  assert.equal(esignFailureText({ ok: false, code: 'pin_locked' }), ESIGN_MESSAGES.pin_locked)
  assert.equal(esignFailureText({ ok: false, code: 'wait_previous' }), ESIGN_MESSAGES.wait_previous)
  assert.equal(esignFailureText(null), ESIGN_MESSAGES.error)
})

await test('ร่างประกาศ: ใส่ชื่อหน่วยงาน · มีส่วนให้หน่วยงานกรอกเอง · อ้างตัวบทเท่าที่ตรวจแล้วเท่านั้น', async () => {
  const text = esignAnnouncementDraft('องค์การบริหารส่วนตำบลทดสอบ')
  assert.ok(text.startsWith('ประกาศองค์การบริหารส่วนตำบลทดสอบ'))
  assert.ok(text.includes('[ระบุ'), 'ต้องมีช่อง [ระบุ…] ให้หน่วยงานตัดสินใจเอง (สำรอง/ความเห็นชอบ/DPO)')
  assert.ok(esignAnnouncementDraft('').includes('[ชื่อหน่วยงาน]'))
  // ตัวบทที่ตรวจแล้ว (อ่านจากสำเนาทางการ): พ.ร.บ.ธุรกรรมฯ ๒๕๔๔ มาตรา ๙ · พ.ร.ฎ. ๒๕๔๙ มาตรา ๗ — ห้ามมีมาตราอื่นลอยมาจากความจำ
  // พ.ร.ฎ. ฉบับนี้เรียก "มาตรา" ไม่ใช่ "ข้อ" (เคยเขียนผิดเป็น "ข้อ ๗" ใน PR #558 — ตรวจกับตัวบทแล้วแก้ใน B1.5)
  assert.deepEqual([...new Set([...text.matchAll(/มาตรา\s*([๐-๙0-9]+)/g)].map(match => match[1]))].sort(), ['๗', '๙'])
  assert.ok(text.includes('พ.ศ. ๒๕๔๔'))
  assert.ok(/พ\.ศ\. ๒๕๔๙ มาตรา ๗/.test(text))
  const wrongForm = new RegExp('๒๕๔๙ ' + 'ข้อ')
  const uiSources = [text, await read('../src/components/admin/EsignSettings.jsx'), await read('../src/lib/esign.js')]
  for (const source of uiSources) assert.ok(!wrongForm.test(source), 'อ้าง พ.ร.ฎ. ๒๕๔๙ เป็น "ข้อ" — ตัวบทใช้ "มาตรา"')
  for (const unverified of ['ข้อ ๑๒', 'ข้อ ๘๙', 'พ.ร.บ.การปฏิบัติราชการทางอิเล็กทรอนิกส์', 'คุ้มครองข้อมูลส่วนบุคคล พ.ศ.']) {
    assert.ok(!text.includes(unverified), `ร่างอ้างสิ่งที่ยังไม่ได้ตรวจตัวบท: ${unverified}`)
  }
  // ไม่สัญญาว่าระบบทำสิ่งที่ยังไม่มี (สำรองข้อมูลเป็นหน้าที่ที่หน่วยงานกำหนดเอง)
  assert.ok(!/ระบบ(จะ)?สำรองข้อมูล/.test(text))
})

await test('S3b รายการใบรอลงนาม: ดึงพลาด/ผลผิดรูปเป็น error ไม่ใช่ "ไม่มีใบรอ" · แถวมีข้อความและปุ่มตามช่อง · ชื่อฟิลด์ตรงกับ esign_my_pending ใน SQL', () => {
  const item = { trip_id: 't1', slot: 'authority', slot_label: 'ผู้มีอำนาจสั่งใช้ยานพาหนะ', decision: 'approve', trip_status: 'approved', requester_name: 'สมหมาย', vehicle_name: 'กระบะ กข 1234', destination: 'อำเภอเมือง', purpose: 'ประชุม', planned_departure: '2026-10-25T01:00:00Z' }
  // ยังไม่รู้ผล (idle/loading) ส่งต่อสถานะเดิม รายการว่าง
  assert.deepEqual(esignPendingFromRpc({ status: 'loading', data: null }), { status: 'loading', items: [] })
  assert.deepEqual(esignPendingFromRpc({ status: 'idle', data: null }), { status: 'idle', items: [] })
  assert.deepEqual(esignPendingFromRpc(undefined), { status: 'idle', items: [] })
  assert.deepEqual(esignPendingFromRpc({ status: 'error', data: null }), { status: 'error', items: [] })
  // ดึงสำเร็จแต่ฟังก์ชันตอบ ok:false หรือรูปผิด = error (ไม่งั้นหน้าแรกขึ้นไฟเขียวทั้งที่อาจมีใบรอผู้ใช้อยู่)
  assert.equal(esignPendingFromRpc({ status: 'ok', data: { ok: false, code: 'not_authenticated' } }).status, 'error')
  assert.equal(esignPendingFromRpc({ status: 'ok', data: { ok: true, items: 'x' } }).status, 'error')
  assert.equal(esignPendingFromRpc({ status: 'ok', data: [] }).status, 'error')
  const ok = esignPendingFromRpc({ status: 'ok', data: { ok: true, count: 2, items: [item, { slot: 'x' }, null] } })
  assert.equal(ok.status, 'ok')
  assert.deepEqual(ok.items, [item], 'แถวที่ไม่มี trip_id/slot ถูกตัดทิ้ง')
  assert.equal(esignPendingFromRpc({ status: 'ok', data: { ok: true, count: 0, items: [] } }).items.length, 0)

  assert.equal(esignPendingKey(item), 't1:authority')
  const row = esignPendingRow(item)
  assert.equal(row.title, 'สมหมาย ขอใช้รถไป อำเภอเมือง')
  assert.equal(row.actionLabel, 'อนุมัติ (ลงนาม)', 'ช่องผู้มีอำนาจคืออนุมัติ')
  assert.equal(row.slotLabel, 'ผู้มีอำนาจสั่งใช้ยานพาหนะ')
  assert.deepEqual(row.summary, { requesterName: 'สมหมาย', vehicleName: 'กระบะ กข 1234', destination: 'อำเภอเมือง', purpose: 'ประชุม', plannedDeparture: '2026-10-25T01:00:00Z' })
  const bare = esignPendingRow({ trip_id: 't2', slot: 'dept_head', decision: 'sign' })
  assert.equal(bare.title, 'ผู้ขอ ขอใช้รถ')
  assert.equal(bare.actionLabel, 'ลงนาม')
  assert.equal(bare.slotLabel, ESIGN_FLEET_SLOTS.find(slot => slot.key === 'dept_head').label, 'ไม่มี slot_label ใช้ชื่อช่องในหน้าจอ')

  // ชื่อฟิลด์ที่ esignPendingRow/esignPendingKey อ่านต้องมีใน jsonb ของ esign_my_pending จริง (หน้าจอทดสอบด้วยข้อมูลจำลอง)
  const body = /FUNCTION public\.esign_my_pending\(\)[\s\S]*?\n\$\$;/.exec(tripPanelSql)?.[0]
  assert.ok(body, 'ไม่พบ esign_my_pending ใน migration')
  const returned = new Set([...body.matchAll(/'([a-z_]+)',\s/g)].map(match => match[1]))
  const lib = esignLibSource.replace(/\r\n/g, '\n')
  const rowSource = /export function esignPendingRow[\s\S]*?\n}\n/.exec(lib)?.[0] ?? ''
  const keySource = /export const esignPendingKey[^\n]*/.exec(lib)?.[0] ?? ''
  const readFields = [...new Set([...rowSource.matchAll(/\bitem\.([a-z_]+)/g), ...keySource.matchAll(/\bitem\.([a-z_]+)/g)].map(match => match[1]))]
  assert.ok(readFields.length >= 9, `อ่านชื่อฟิลด์ได้น้อยผิดปกติ (${readFields.join(',')})`)
  for (const key of readFields) assert.ok(returned.has(key), `หน้าจออ่านฟิลด์ "${key}" แต่ esign_my_pending ไม่ส่งมา`)
})

await test('S3b เตือนตอนออกรถ: เตือนเฉพาะช่องผู้มีอำนาจออนไลน์ที่ยังไม่ลงนาม · ลงแล้ว/เซ็นสด/ทริปปิด/อ่านสถานะไม่ได้ = ไม่เตือน', () => {
  const slot = (name, extra = {}) => ({ slot: name, label: name + '-label', mode: 'online', applicable: true, signed: false, expected_name: null, blocked: null, ...extra })
  const base = (slots, extra = {}) => ({ found: true, trip_status: 'approved', slots, ...extra })
  const w = esignDepartWarning(base([slot('requester', { signed: true }), slot('dept_head', { signed: true }), slot('authority', { expected_name: 'นายก ก.' }), slot('sk1', { applicable: false })]))
  assert.deepEqual(w, { missing: ['authority-label'], expectedName: 'นายก ก.', blocked: null })
  const all = esignDepartWarning(base([slot('requester'), slot('dept_head'), slot('authority')]))
  assert.deepEqual(all.missing, ['requester-label', 'dept_head-label', 'authority-label'], 'ไล่ตามลำดับสายลงนาม')
  assert.equal(esignDepartWarning(base([slot('authority', { blocked: 'signatory_not_linked' })])).blocked, 'signatory_not_linked')
  assert.equal(esignDepartWarning(base([slot('authority', { signed: true })])), null, 'ลงนามแล้ว')
  assert.equal(esignDepartWarning(base([slot('authority', { mode: 'wet' })])), null, 'เซ็นสด ไม่ใช่เรื่องของระบบ')
  assert.equal(esignDepartWarning(base([slot('requester'), slot('authority', { signed: true })])), null, 'ช่องผู้มีอำนาจครบแล้ว ไม่เตือนเรื่องช่องอื่น')
  assert.equal(esignDepartWarning(base([slot('authority')], { trip_status: 'cancelled' })), null)
  assert.equal(esignDepartWarning({ found: false }), null)
  assert.equal(esignDepartWarning({ ok: false, code: 'error' }), null)
  assert.equal(esignDepartWarning(null), null)
})

await test('S3b การต่อสาย: esign_my_pending ไม่รับอาร์กิวเมนต์ ต้องส่ง args {} ทุกจุด (useHomeRpc ปกติส่ง p_muni → PGRST202) · แถบอยู่หน้าการใช้รถ · เตือนออกรถเฉพาะทริปโหมดออนไลน์', async () => {
  assert.ok(/CREATE OR REPLACE FUNCTION public\.esign_my_pending\(\)/.test(tripPanelSql), 'esign_my_pending ต้องไม่รับอาร์กิวเมนต์ — ถ้าเปลี่ยนต้องแก้ args ที่หน้าจอ')
  const home = await read('../src/components/staff/StaffOperationalDashboard.jsx')
  const fleet = await read('../src/components/fleet/FleetTrips.jsx')
  const homeData = await read('../src/lib/staffHomeData.js')
  for (const [name, source] of [['StaffOperationalDashboard', home], ['FleetTrips', fleet]]) {
    const calls = [...source.matchAll(/useHomeRpc\(\{[^\n]*rpc: 'esign_my_pending'[^\n]*\}\)/g)].map(match => match[0])
    assert.equal(calls.length, 1, `${name}: ต้องเรียก useHomeRpc ของ esign_my_pending หนึ่งจุด`)
    assert.ok(/args: \{\}/.test(calls[0]), `${name}: esign_my_pending ต้องส่ง args: {}`)
  }
  // ค่าเริ่มต้นของ useHomeRpc ยังเป็น p_muni (RPC หน้าแรกชุดเดิมไม่ถูกกระทบ)
  assert.ok(/argsJson == null \? \{ p_muni: tenantId \}/.test(homeData), 'useHomeRpc ไม่ส่ง args ต้องยังส่ง p_muni เหมือนเดิม')
  assert.ok(/variant="banner"/.test(fleet) && /\{selTrip\.esign_slots && <DepartEsignNotice tripId=\{selTrip\.id\} \/>\}/.test(fleet), 'แถบอยู่บนหน้าการใช้รถ · เตือนออกรถเฉพาะทริปที่มี esign_slots')
  assert.ok(/onSigned=\{\(\) => \{ esignRpc\.reload\(\); loadTrips\(\) \}\}/.test(fleet), 'ลงนามจากแถบแล้วต้องโหลดทั้งแถบและรายการทริปใหม่')
  // ไฟเขียว "ไม่มีงานค้าง" ต้องรู้เรื่องใบรอลงนาม: นับจำนวน + สถานะ loading/error เข้า todoState
  assert.ok(/esignPending\.items\.length\]/.test(home) && /\['loading', 'error'\]\.includes\(esignPending\.status\)/.test(home), 'todoState ต้องรวมใบรอลงนามทั้งจำนวนและสถานะ')
  // ลงใบสุดท้ายแล้วส่วน "ต้องทำตอนนี้" ต้องไม่หายทั้งก้อน (ข้อความ "ลงนามแล้ว" ต้องอยู่) — เทสต์เบราว์เซอร์ใช้บัญชีที่มีงานอื่นค้างอยู่เสมอ จึงจับกรณีนี้ไม่ได้ ตรวจที่ซอร์สแทน
  assert.ok(/esignPending\.status === 'error' \|\| esignTouched/.test(home) && /setEsignTouched\(true\)/.test(home), 'ส่วน "ต้องทำตอนนี้" ต้องค้างอยู่หลังลงนามใบสุดท้าย (esignTouched)')
  // กล่องลงนามที่ใช้ร่วม: ห้ามอ้างเลขมาตราลอยๆ
  assert.ok(!/มาตรา\s*[๐-๙0-9]/.test(await read('../src/components/esign/MyPendingSignatures.jsx')))
})

await test('S4 หน้าตรวจสอบสาธารณะ: สรุปสถานะ/แถวช่อง/คำเตือนคำขอที่ปิดแล้ว · ถึงโควตาเปิดดูถี่ = busy · รหัสผิดรูปไม่ถูกส่งไปถาม DB', () => {
  assert.equal(isVerifyCode('0123456789abcdef0123456789abcdef'), true)
  for (const bad of ['', 'ABCDEF0123456789ABCDEF0123456789', '0123456789abcdef0123456789abcde', '0123456789abcdef0123456789abcdefg', null, undefined]) assert.equal(isVerifyCode(bad), false, String(bad))
  assert.deepEqual(verifySummary({ state: 'complete', required: 3, signed_count: 3, trip_status: 'active' }), { tone: 'ok', title: 'ลงนามออนไลน์ครบทุกช่อง', detail: 'เนื้อหาตรงกับที่ลงนามไว้' })
  const partial = verifySummary({ state: 'partial', required: 3, signed_count: 2, trip_status: 'active' })
  assert.equal(partial.tone, 'warn')
  assert.ok(partial.title.includes('2 จาก 3 ช่อง'))
  assert.equal(verifySummary({ state: 'unsigned', required: 3, signed_count: 0 }).tone, 'mute')
  const modified = verifySummary({ state: 'modified', required: 3, signed_count: 3, trip_status: 'active' })
  assert.equal(modified.tone, 'bad')
  assert.ok(modified.detail.includes('ห้ามใช้'))
  // ลายเซ็นครบแต่คำขอถูกยกเลิก/ไม่อนุมัติ: ห้ามดูเหมือนเอกสารใช้ได้ (ไม่เป็นสีเขียว) และบอกชัด
  const cancelled = verifySummary({ state: 'complete', required: 3, signed_count: 3, trip_status: 'cancelled' })
  assert.equal(cancelled.tone, 'warn')
  assert.ok(cancelled.closedNote.includes('ยกเลิก') && cancelled.closedNote.includes('ไม่ใช่เอกสารที่ใช้อนุมัติ'))
  assert.ok(verifySummary({ state: 'complete', required: 3, signed_count: 3, trip_status: 'rejected' }).closedNote.includes('ไม่อนุมัติ'))
  assert.equal(verifySummary({ state: 'modified', trip_status: 'cancelled' }).tone, 'bad', 'เนื้อหาไม่ตรงยังแดงแม้คำขอปิดแล้ว')
  const rows = verifySlotRows({ slots: [
    { slot: 'requester', label: 'ผู้ขออนุญาต', signed: true, signer_name: 'สมหญิง', signer_position: 'ตำแหน่งโปรไฟล์', signed_as: 'ตำแหน่งที่ลงนาม', decision: 'sign', signed_at: '2026-10-23T04:00:00Z' },
    { slot: 'authority', label: 'ผู้มีอำนาจ', signed: true, signer_name: 'นายก', signer_position: 'ตำแหน่งโปรไฟล์', signed_as: '', decision: 'approve', signed_at: '2026-10-23T05:00:00Z' },
    { slot: 'dept_head', label: 'ผอ.กอง', signed: false },
  ] })
  assert.equal(rows[0].position, 'ตำแหน่งที่ลงนาม', 'ตำแหน่งที่ลงนามจริงมาก่อนตำแหน่งในโปรไฟล์')
  assert.equal(rows[0].decisionLabel, 'ลงนาม')
  assert.equal(rows[1].position, 'ตำแหน่งโปรไฟล์')
  assert.equal(rows[1].decisionLabel, 'อนุมัติ')
  assert.deepEqual([rows[2].signed, rows[2].signerName, rows[2].position, rows[2].signedAt], [false, '', '', null], 'ช่องที่ยังไม่ลงนามไม่มีชื่อ/เวลา')
  assert.deepEqual(verifySlotRows(null), [])
  assert.equal(isVerifyBusy({ code: 'PT429' }), true)
  assert.equal(isVerifyBusy({ message: 'เปิดดูถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' }), true)
  assert.equal(isVerifyBusy({ code: '500', message: 'boom' }), false)
})

await test('S4 ใบพิมพ์/หน้าตรวจสอบ: ตัวเรียก esign_trip_stamps · ชื่อฟิลด์ที่อ่านมีอยู่จริงใน SQL · ปุ่มพิมพ์ดึงลายเซ็นเฉพาะทริปโหมดออนไลน์ · หน้าตรวจสอบไม่มีรูป/ไม่อ้างเลขมาตรา', async () => {
  const wrappers = new Set([...apiSource.matchAll(/callEsign\('(\w+)'/g)].map(match => match[1]))
  assert.ok(wrappers.has('esign_trip_stamps'), 'esignApi ไม่มีตัวเรียก esign_trip_stamps')
  assert.ok(/export const getTripEsignStamps = tripId => callEsign\('esign_trip_stamps', \{ p_trip_id: tripId \}\)/.test(apiSource), 'esign_trip_stamps ต้องส่ง p_trip_id ตรงชื่ออาร์กิวเมนต์ใน SQL')
  assert.ok(/FUNCTION public\.esign_trip_stamps\(p_trip_id uuid\)/.test(imageFunctionsSql))

  // ฟิลด์ที่ esignPrintData อ่านจาก esign_trip_status / esign_trip_stamps ต้องมีใน jsonb ของฟังก์ชันจริง
  const sqlKeys = new Set([...functionsSql.matchAll(/'([a-z0-9_]+)',\s/g)].map(match => match[1]))
  const printSource = (await read('../src/lib/esignPrint.js')).replace(/\r\n/g, '\n')
  const printBody = /export function esignPrintData[\s\S]*?\n}\n/.exec(printSource)?.[0] ?? ''
  const internal = new Set(['length']) // ของ JS ไม่ใช่ฟิลด์ DB
  const printFields = [...new Set([...printBody.matchAll(/\b(?:status|slot|signature|item|stamps)\??\.([a-z]+(?:_[a-z0-9]+)*)\b/g)].map(match => match[1]))].filter(key => !internal.has(key))
  assert.ok(printFields.length >= 14, `อ่านชื่อฟิลด์ของใบพิมพ์ได้น้อยผิดปกติ (${printFields.join(',')})`)
  for (const key of printFields) assert.ok(sqlKeys.has(key), `ใบพิมพ์อ่านฟิลด์ "${key}" แต่ไม่มีใน jsonb ของฟังก์ชัน DB`)

  // หน้าตรวจสอบ: ทุกฟิลด์ที่อ่านต้องมีใน esign_verify และไม่มีทางแสดงภาพ/เนื้อหาคำขอ
  const verifyBody = /FUNCTION public\.esign_verify\(p_code text\)[\s\S]*?\n\$\$;/.exec(functionsOldSql)?.[0] ?? ''
  const verifyKeys = new Set([...verifyBody.matchAll(/'([a-z0-9_]+)',\s/g)].map(match => match[1]))
  assert.ok(verifyKeys.size >= 15, 'อ่านคีย์ของ esign_verify ไม่ได้')
  const verifySources = [await read('../src/lib/esignVerify.js'), await read('../src/pages/VerifyEsign.jsx')]
  const verifyFields = new Set()
  for (const source of verifySources) for (const match of source.matchAll(/\b(?:data|result|slot)\??\.([a-z]+(?:_[a-z0-9]+)+|found|state|required|slots|signed|label|slot|decision)\b/g)) verifyFields.add(match[1])
  assert.ok(verifyFields.size >= 12, `อ่านชื่อฟิลด์ของหน้าตรวจสอบได้น้อยผิดปกติ (${[...verifyFields].join(',')})`)
  for (const key of verifyFields) assert.ok(verifyKeys.has(key), `หน้าตรวจสอบอ่านฟิลด์ "${key}" แต่ esign_verify ไม่ส่งมา`)
  for (const secret of ['png_base64', 'esign_trip_stamps', '<img', 'destination', 'purpose', 'passengers']) {
    for (const source of verifySources) assert.ok(!source.includes(secret), `หน้าตรวจสอบสาธารณะต้องไม่แตะ "${secret}" (ไม่แสดงภาพลายเซ็น/เนื้อหาคำขอ)`)
  }
  assert.ok(/esign_verify', \{ p_code: code \}/.test(verifySources[1]), 'หน้าตรวจสอบต้องเรียก esign_verify ด้วย p_code')
  // รหัสผิดรูปไม่ถูกส่งไปถาม DB (ไม่เปลืองโควตา 30 ครั้ง/5 นาที) และหน้านี้ noindex
  assert.ok(/useState\(codeOk \? 'loading' : 'notfound'\)/.test(verifySources[1]) && /if \(!codeOk\) return/.test(verifySources[1]))
  assert.ok(/meta\.name = 'robots'[\s\S]*meta\.content = 'noindex'/.test(verifySources[1]), 'หน้าตรวจสอบต้อง noindex')
  assert.ok(/<Route path="\/v\/:code" element=\{<VerifyEsign \/>\} \/>/.test(await read('../src/App.jsx')), 'ไม่มี route /v/:code')

  // ปุ่มพิมพ์: ทริปโหมดออนไลน์ดึงลายเซ็นก่อน (ส่ง promise เข้า openPrintWindow — เปิดหน้าต่างก่อน await กัน pop-up ถูกบล็อก) · ทริปปกติสร้างใบเดิม
  const fleet = await read('../src/components/fleet/FleetTrips.jsx')
  assert.ok(/openPrintWindow\(t\.esign_slots \? loadEsignForPrint\(t\)\.then\(build\) : build\(null\)\)/.test(fleet), 'แบบ ๓ ต้องดึงลายเซ็นเฉพาะทริปที่มี esign_slots')
  assert.ok(/loadEsignForPrint\(t\)\.then\(esign => buildFleetSk1Html\(\{ trip: t, tenant, esign \}\)\)/.test(fleet), 'สก.๑ ต้องดึงลายเซ็นเฉพาะทริปที่มี esign_slots')
  assert.ok(/!esign \|\| \(needsImages && !stamps\?\.ok\)/.test(fleet), 'ดึงลายเซ็นไม่ได้ต้องไม่พิมพ์ (ใบเส้นว่างทั้งที่ลงนามแล้วทำให้เข้าใจผิด)')
  assert.ok(/const win = window\.open\([^)]*\)\r?\n\s+if \(!win\)[^\n]*\r?\n\s+if \(typeof source === 'string'\)/.test(fleet), 'openPrintWindow ต้องเปิดหน้าต่างก่อนค่อยรอ promise')
  // ข้อความหลังยื่นคำขอ: โหมดออนไลน์ไม่ให้พิมพ์ใบไปเวียนเซ็น
  assert.ok(/\.select\('id,status,waitlist_reasons,esign_slots'\)/.test(fleet) && /alert\(saved\.esign_slots/.test(fleet), 'ข้อความหลังยื่นคำขอต้องแยกโหมดออนไลน์')
  // ใบพิมพ์/หน้าตรวจสอบ/คู่มือ ไม่อ้างเลขมาตราลอยๆ (ต้องตรวจกับตัวบทก่อน)
  for (const source of [printSource, ...verifySources]) assert.ok(!/มาตรา\s*[๐-๙0-9]/.test(source), 'ห้ามอ้างเลขมาตราลอยๆ')
  const manual = await read('../public/manual-staff.html')
  const esignManual = manual.slice(manual.indexOf('id="esign"'), manual.indexOf('12 — พัสดุ/ครุภัณฑ์'))
  assert.ok(esignManual.length > 2000 && !/มาตรา\s*[๐-๙0-9]/.test(esignManual) && manual.includes('href="#esign"'), 'คู่มือต้องมีหัวข้อลงนามออนไลน์ในสารบัญ และไม่อ้างเลขมาตรา')
})

await test('แอดมินลบทริปที่มีลายเซ็นได้: migration เช็กแอดมินก่อนผ่าน + เขียน audit · หน้าจอเตือนก่อนลบทริปโหมดออนไลน์ · ข้อความ error บอกว่าลบได้เฉพาะแอดมิน', async () => {
  const guard = adminDeleteSql.slice(adminDeleteSql.indexOf('CREATE OR REPLACE FUNCTION public.esign_fleet_trip_guard'))
  const del = guard.slice(guard.indexOf('-- DELETE:'))
  assert.ok(del.includes('esign_is_tenant_admin(OLD.municipality_id)'), 'ต้องเช็กแอดมินของ อปท. ของทริป')
  assert.ok(del.indexOf('esign_is_tenant_admin') < del.indexOf("'esign_trip_deleted'"), 'ต้องเช็กสิทธิ์ก่อนเขียน audit/ลบ')
  assert.ok(del.includes("esign_audit(OLD.municipality_id, 'esign_trip_deleted'"), 'ต้องเขียน audit ก่อนลบ')
  assert.ok(!/OLD\.(destination|purpose|esign_verify_code)/.test(del), 'audit การลบห้ามมีปลายทาง/วัตถุประสงค์/รหัสตรวจสอบ')
  assert.ok(del.trimEnd().endsWith('RETURN OLD;\nEND;\n$$;\n\nREVOKE ALL ON FUNCTION public.esign_fleet_trip_guard() FROM PUBLIC, anon, authenticated;') || del.includes('RETURN OLD;'), 'ทุกเส้นทางต้องมี RETURN')
  assert.ok(ESIGN_TRIP_EXCEPTIONS.ESIGN_TRIP_HAS_SIGNATURES.includes('ผู้ดูแลระบบ') && ESIGN_TRIP_EXCEPTIONS.ESIGN_TRIP_HAS_SIGNATURES.includes('ยกเลิก'))
  const fleet = await read('../src/components/fleet/FleetTrips.jsx')
  const handler = fleet.slice(fleet.indexOf('async function handleDelete'), fleet.indexOf('/* ── Derived ── */'))
  assert.ok(handler.includes('t.esign_slots') && handler.includes('esignWarning') && handler.includes('ไม่พบ'), 'ลบทริปโหมดออนไลน์ต้องเตือนผลก่อนยืนยัน')
  assert.ok(/confirm\(`[^\n]*\$\{esignWarning\}/.test(handler), 'คำเตือนต้องอยู่ในกล่องยืนยัน')
})

console.log(`\nผ่านทั้งหมด ${cases} กรณี`)
