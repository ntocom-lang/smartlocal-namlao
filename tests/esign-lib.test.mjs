// ลงนามออนไลน์รายเรื่อง — ตัวช่วยฝั่งหน้าจอ (src/lib/esign.js, src/lib/esignApi.js) เทียบกับ migration ฝั่ง DB
//   node tests/esign-lib.test.mjs   (หรือ npm run test:esign)
// กันเรื่องที่เงียบแล้วพังตอนใช้จริง: (1) DB เพิ่มรหัสผลลัพธ์ใหม่แต่หน้าจอไม่มีข้อความ ผู้ใช้เห็นรหัสดิบ/ข้อความว่าง
// (2) หน้าจอเรียก RPC ไม่ครบ argument → PostgREST ตอบ PGRST202 ที่อ่านไม่ออก (3) ช่องลงนามหน้าจอไม่ตรงกับ DB
// (4) ร่างประกาศอ้างมาตรา/ข้อที่ไม่ได้ตรวจกับตัวบท
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  ESIGN_DECISION_LABEL, ESIGN_DUTY_TEXT, ESIGN_FLEET_SLOTS, ESIGN_MESSAGES, ESIGN_TRIP_EXCEPTIONS, esignAnnouncementDraft, esignAnyOnline, esignBlockers,
  esignFailureText, esignGateItems, esignMessage, esignModesFromStatus, esignRevokeTargets,
} from '../src/lib/esign.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const functionsOldSql = await read('../supabase/migrations/20261022100200_esign_functions.sql')
// ชุด B1.5 ยกฟังก์ชันที่แก้มาเต็มตัวในไฟล์ใหม่ — นิยามหลังสุดชนะ (ลำดับเดียวกับที่ apply บนฐานจริง)
const gateRelaxSql = await read('../supabase/migrations/20261022110100_esign_gate_relax_functions.sql')
// ชุด S1 (ภาพลายเซ็น) เป็นฟังก์ชันใหม่ล้วน ไม่ทับของเดิม
const imageFunctionsSql = await read('../supabase/migrations/20261023100100_esign_image_functions.sql')
// ชุด S3a: แก้ esign_trip_status (ยกมาเต็มตัว) + เพิ่ม esign_my_pending — นิยามหลังสุดชนะ
const tripPanelSql = await read('../supabase/migrations/20261023110000_esign_trip_panel_functions.sql')
const functionsSql = functionsOldSql + '\n' + gateRelaxSql + '\n' + imageFunctionsSql + '\n' + tripPanelSql
const apiSource = await read('../src/lib/esignApi.js')

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
  }
  // esignApi/signatureCanvas ต้องใช้ supabase/DOM จึง import ใน Node ไม่ได้ — อ่านรายชื่อ export จากซอร์ส
  const exportsOf = source => new Set([...source.matchAll(/export (?:const|async function|function) (\w+)/g)].map(match => match[1]))
  const sources = { esignApi: exportsOf(apiSource), signatureCanvas: exportsOf(await read('../src/lib/signatureCanvas.js')) }
  const components = [
    '../src/components/admin/EsignSettings.jsx', '../src/components/profile/MyEsignSection.jsx',
    '../src/components/profile/AddSignatureDialog.jsx', '../src/components/profile/SignaturePad.jsx',
    '../src/components/esign/PinForm.jsx', '../src/components/esign/SignTripDialog.jsx', '../src/components/esign/TripEsignPanel.jsx', '../src/components/fleet/FleetTrips.jsx',
  ]
  let checked = 0
  for (const path of components) {
    const component = await read(path)
    for (const match of component.matchAll(/import \{([^}]*)\} from '(?:\.\.\/)+lib\/(esign|esignApi|esignUi|signatureImage|signatureCanvas)'/g)) {
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

await test('ลายเซ็นของฉัน: ทุกฟังก์ชัน DB ของหน้านี้มีตัวเรียกฝั่งหน้าจอ · ส่วนลายเซ็นในโปรไฟล์เห็นเฉพาะเจ้าหน้าที่ · เมนูกดชื่อลิงก์มาถูกที่', async () => {
  const wrappers = new Set([...apiSource.matchAll(/callEsign\('(\w+)'/g)].map(match => match[1]))
  for (const name of ['esign_my_signer_overview', 'esign_my_signatures', 'esign_my_signature_add', 'esign_my_signature_set_default',
    'esign_my_signature_delete', 'esign_my_signature_history', 'set_esign_pin', 'esign_suspend_me']) {
    assert.ok(wrappers.has(name), `esignApi ไม่มีตัวเรียก ${name}`)
  }
  const profile = await read('../src/pages/ProfilePage.jsx')
  assert.ok(/STAFF_ROLES\.includes\(contextRole \?\? profile\.role\) && <MyEsignSection \/>/.test(profile), 'ส่วนลายเซ็นต้องแสดงเฉพาะเจ้าหน้าที่')
  const menu = await read('../src/components/layout/StaffAccountMenu.jsx')
  assert.ok(menu.includes('to="/profile#signature"') && menu.includes('data-account-signature'))
  const section = await read('../src/components/profile/MyEsignSection.jsx')
  assert.ok(/hash === '#signature'/.test(section), 'ส่วนลายเซ็นต้องเปิดเองเมื่อมาด้วย #signature')
  // ห้ามอ้างเลขมาตราของ พ.ร.บ./พ.ร.ฎ. ในข้อความหน้าจอของส่วนนี้ (ต้องตรวจกับตัวบทก่อน — เคยผิดมาแล้ว)
  for (const source of [section, await read('../src/components/profile/AddSignatureDialog.jsx')]) {
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

console.log(`\nผ่านทั้งหมด ${cases} กรณี`)
