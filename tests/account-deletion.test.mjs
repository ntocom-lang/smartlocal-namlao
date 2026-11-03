// เทสต์ลบบัญชีด้วยตนเอง (ประชาชน) — รันด้วย: node tests/account-deletion.test.mjs
//
// ทำไมต้องมี:
// 1) ลำดับ "ลบรูปก่อน แล้วค่อยลบบัญชี" พังแบบเงียบได้ — Storage ตอบ 200 แม้นโยบายไม่ให้ลบ ถ้าโค้ดไม่นับเอง
//    บัญชีจะหายแต่ภาพใบหน้าค้างอยู่ในระบบโดยไม่มีใครลบได้อีก
// 2) ข้อความ "อะไรถูกลบ/อะไรถูกเก็บ" ที่บอกผู้ใช้ สโตร์บังคับให้ตรงกับความจริง ต้องตรงกับกติกา FK ใน migration
// 3) migration เขียนทับ guard 2 ตัวด้วย CREATE OR REPLACE (เขียนทับทั้งฟังก์ชัน) — ตรวจว่าทุกเงื่อนไขเดิม
//    ยังอยู่ครบ ต่างจากรุ่นก่อนหน้าเฉพาะจุดที่ตั้งใจแก้เท่านั้น
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ACCOUNT_DELETION_KEPT, ACCOUNT_DELETION_REMOVED, accountDeletionErrorText, canSelfDeleteRole,
  deleteMyAccount, isDeleteConfirmed, listAvatarPaths, removeOrphanAvatars,
} from '../src/lib/accountDeletion.js'

const UID = '11111111-2222-3333-4444-555555555555'
let passed = 0
async function check(name, fn) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

// supabase client ปลอม — จดลำดับการเรียกไว้ตรวจ
function fakeClient({ files = [], listError = null, removedCount, removeError = null, rpcError = null } = {}) {
  const calls = []
  const bucket = {
    async list(prefix) {
      calls.push(['list', prefix])
      return { data: listError ? null : files.map(name => ({ name })), error: listError }
    },
    async remove(paths) {
      calls.push(['remove', paths])
      const n = removedCount ?? paths.length
      return { data: removeError ? null : paths.slice(0, n).map(name => ({ name })), error: removeError }
    },
  }
  return {
    calls,
    storage: { from(name) { calls.push(['bucket', name]); return bucket } },
    async rpc(fn) { calls.push(['rpc', fn]); return { data: null, error: rpcError } },
  }
}

console.log('สิทธิ์และคำยืนยัน')
await check('ประชาชน/บัญชีที่ยังไม่มีโปรไฟล์ลบเองได้ เจ้าหน้าที่ทุกบทบาทลบเองไม่ได้', () => {
  for (const role of ['citizen', null, undefined, '']) assert.equal(canSelfDeleteRole(role), true, String(role))
  for (const role of ['staff', 'officer', 'technician', 'admin', 'superadmin', 'viewer', 'council']) {
    assert.equal(canSelfDeleteRole(role), false, role)
  }
})
await check('คำยืนยันไม่สนช่องว่างที่แป้นมือถือเติมมา แต่ต้องเป็นคำเต็ม', () => {
  assert.equal(isDeleteConfirmed('ลบบัญชี'), true)
  assert.equal(isDeleteConfirmed(' ลบ บัญชี '), true)
  assert.equal(isDeleteConfirmed('ลบ'), false)
  assert.equal(isDeleteConfirmed(''), false)
  assert.equal(isDeleteConfirmed(undefined), false)
})

console.log('ลำดับการลบ')
await check('ลบรูปในโฟลเดอร์ของตัวเองก่อน แล้วค่อยเรียก delete_my_account', async () => {
  const client = fakeClient({ files: ['avatar.jpg', 'avatar.png'] })
  await deleteMyAccount(client, UID)
  assert.deepEqual(client.calls, [
    ['bucket', 'avatars'],
    ['list', UID],
    ['remove', [`${UID}/avatar.jpg`, `${UID}/avatar.png`]],
    ['rpc', 'delete_my_account'],
  ])
})
await check('ไม่มีรูปโปรไฟล์ ไม่เรียกลบรูป', async () => {
  const client = fakeClient()
  await deleteMyAccount(client, UID)
  assert.equal(client.calls.some(([op]) => op === 'remove'), false)
  assert.deepEqual(client.calls.at(-1), ['rpc', 'delete_my_account'])
})
await check('Storage ตอบสำเร็จแต่ลบไม่ครบ (นโยบายไม่ให้ลบ) = หยุด ไม่ลบบัญชี', async () => {
  const client = fakeClient({ files: ['avatar.jpg'], removedCount: 0 })
  await assert.rejects(deleteMyAccount(client, UID), (err) => err.step === 'avatar')
  assert.equal(client.calls.some(([op]) => op === 'rpc'), false)
})
await check('อ่านรายการรูปไม่ได้ = หยุด ไม่ลบบัญชี', async () => {
  const client = fakeClient({ listError: { message: 'network' } })
  await assert.rejects(deleteMyAccount(client, UID), (err) => err.step === 'avatar')
  assert.equal(client.calls.some(([op]) => op === 'rpc'), false)
})
await check('ลบรูปแล้ว error = หยุด ไม่ลบบัญชี', async () => {
  const client = fakeClient({ files: ['avatar.jpg'], removeError: { message: 'denied' } })
  await assert.rejects(deleteMyAccount(client, UID), (err) => err.step === 'avatar')
  assert.equal(client.calls.some(([op]) => op === 'rpc'), false)
})
await check('ไม่มีรหัสผู้ใช้ ไม่แตะอะไรเลย', async () => {
  const client = fakeClient()
  await assert.rejects(deleteMyAccount(client, ''), (err) => err.step === 'session')
  assert.deepEqual(client.calls, [])
})
await check('ฐานข้อมูลปฏิเสธ ส่งข้อความไทยของฐานถึงผู้ใช้ตรงๆ ข้อความเทคนิคแปลงเป็นข้อความกลาง', async () => {
  const staff = fakeClient({ rpcError: { message: 'บัญชีเจ้าหน้าที่ลบเองไม่ได้ เพราะผูกกับงานและลายเซ็นในเอกสาร กรุณาติดต่อผู้ดูแลระบบของหน่วยงาน' } })
  const err = await deleteMyAccount(staff, UID).catch(e => e)
  assert.equal(err.step, 'rpc')
  assert.match(accountDeletionErrorText(err), /^บัญชีเจ้าหน้าที่ลบเองไม่ได้/)

  const missing = fakeClient({ rpcError: { message: 'Could not find the function public.delete_my_account' } })
  const err2 = await deleteMyAccount(missing, UID).catch(e => e)
  assert.equal(accountDeletionErrorText(err2), 'ลบบัญชีไม่สำเร็จ บัญชีของคุณยังไม่ถูกลบ กรุณาลองใหม่อีกครั้ง')
  assert.match(accountDeletionErrorText({ step: 'avatar' }), /บัญชีของคุณยังไม่ถูกลบ/)
})

console.log('ข้อความที่บอกผู้ใช้ตรงกับกติกา FK')
const fkSql = readFileSync(new URL('../supabase/migrations/20261101100000_self_delete_account_fk.sql', import.meta.url), 'utf8')
const RULES = [
  // [ตาราง, คอลัมน์, กติกา, รายการข้อความที่ต้องพูดถึง, คำที่ต้องมี]
  ['document_requests', 'user_id', 'SET NULL', ACCOUNT_DELETION_KEPT, 'คำขอบริการ'],
  ['satisfaction_responses', 'user_id', 'SET NULL', ACCOUNT_DELETION_KEPT, 'คะแนนความพึงพอใจ'],
  ['patient_bookings', 'created_by', 'SET NULL', ACCOUNT_DELETION_KEPT, 'การจองรถรับ-ส่งผู้ป่วย'],
  ['patient_booking_events', 'actor_id', 'SET NULL', null, null],
  ['patient_booking_operations', 'actor_id', 'SET NULL', null, null],
  ['tourism_reviews', 'user_id', 'CASCADE', ACCOUNT_DELETION_REMOVED, 'รีวิว'],
  ['patient_booking_notices', 'recipient_id', 'CASCADE', null, null],
]
await check('migration มีกติกาครบ 7 ตัว และข้อความบนหน้าจอพูดถึงข้อมูลแต่ละกลุ่มถูกฝั่ง', () => {
  for (const [table, column, rule, list, word] of RULES) {
    const row = new RegExp(`\\('public\\.${table}'::regclass,\\s*'${column}'::name,\\s*'${rule}'\\)`)
    assert.match(fkSql, row, `${table}.${column} → ${rule}`)
    if (list) assert.ok(list.some(text => text.includes(word)), `ข้อความต้องพูดถึง "${word}"`)
  }
  assert.equal((fkSql.match(/::regclass,\s*'\w+'::name,/g) ?? []).length, RULES.length, 'จำนวนกติกาต้องตรงกับเทสต์')
  assert.ok(ACCOUNT_DELETION_KEPT.some(text => text.includes('คำร้อง')), 'คำร้อง (SET NULL อยู่แล้วบนฐานจริง) ต้องอยู่ในฝั่งเก็บ')
  for (const [table, column] of [['patient_bookings', 'created_by'], ['patient_booking_events', 'actor_id'], ['patient_booking_operations', 'actor_id']]) {
    assert.match(fkSql, new RegExp(`ALTER TABLE public\\.${table}\\s+ALTER COLUMN ${column}\\s+DROP NOT NULL;`),
      `${table}.${column} ต้องปลด NOT NULL ก่อนใช้ SET NULL`)
  }
})

console.log('guard ที่เขียนทับ ต่างจากรุ่นเดิมเฉพาะจุดที่ตั้งใจ')
const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
function functionBody(sql, fn) {
  const start = sql.indexOf(`FUNCTION public.${fn}()`)
  assert.ok(start >= 0, `ไม่พบ ${fn}`)
  const open = sql.indexOf('AS $$', start) + 'AS $$'.length
  const close = sql.indexOf('$$;', open)
  return sql.slice(open, close)
}
const normalize = (body) => body.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()
const fnSql = migration('20261101100100_self_delete_account_functions.sql')

await check('guard_adhoc_complaint_write = รุ่น 20260902120000 + ยกเว้นการล้าง user_id ตอนลบบัญชี', () => {
  const before = normalize(functionBody(migration('20260902120000_complaint_contact_retention.sql'), 'guard_adhoc_complaint_write'))
  const after = normalize(functionBody(fnSql, 'guard_adhoc_complaint_write'))
  const reverted = after
    .replace(' v_owner_cleared boolean;', '')
    .replace(" v_owner_cleared := coalesce(current_setting('app.account_delete', true), '') = '1' AND NEW.user_id IS NULL;", '')
    .replace('OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NOT v_owner_cleared)', 'OR NEW.user_id IS DISTINCT FROM OLD.user_id')
  assert.equal(reverted, before)
})
await check('protect_document_request_scope = รุ่น 20260907120000 + ยกเว้นการล้าง user_id ตอนลบบัญชี', () => {
  const before = normalize(functionBody(migration('20260907120000_route_document_request_by_assignment.sql'), 'protect_document_request_scope'))
  const after = normalize(functionBody(fnSql, 'protect_document_request_scope'))
  const reverted = after.replace(
    "(NEW.user_id IS DISTINCT FROM OLD.user_id AND NOT (coalesce(current_setting('app.account_delete', true), '') = '1' AND NEW.user_id IS NULL))",
    'NEW.user_id IS DISTINCT FROM OLD.user_id',
  )
  assert.equal(reverted, before)
})
await check('delete_my_account รับเฉพาะประชาชน ไม่เก็บชื่อใน audit และไม่เปิดให้ anon', () => {
  const body = normalize(functionBody(fnSql, 'delete_my_account'))
  assert.match(body, /IF v_role IS NOT NULL AND v_role <> 'citizen' THEN RAISE EXCEPTION/)
  assert.match(body, /'self_delete_account', 'profile', v_uid::text, NULL,/)
  assert.match(body, /PERFORM set_config\('app\.account_delete', '1', true\); BEGIN DELETE FROM auth\.users WHERE id = v_uid;/)
  assert.match(fnSql, /REVOKE ALL ON FUNCTION public\.delete_my_account\(\) FROM PUBLIC, anon;/)
  assert.match(fnSql, /GRANT EXECUTE ON FUNCTION public\.delete_my_account\(\) TO authenticated;/)
})

// แอดมินลบบัญชีคนอื่น (delete_user_by_id) เดิมไม่ลบรูปโปรไฟล์ — ภาพใบหน้าค้างใน bucket สาธารณะตลอดไป
// ลบด้วย SQL ไม่ได้ (ไฟล์จริงค้างเป็นกำพร้า) ต้องผ่าน Storage API ซึ่งตัดสินด้วยนโยบายของ storage.objects
console.log('แอดมินลบบัญชีคนอื่น: รูปไม่ค้างใน bucket')
await check('จำชื่อไฟล์ไว้ก่อนลบบัญชี อ่านรายการไม่ได้ไม่โยน error (ต้องไม่ขวางการลบบัญชีที่แอดมินสั่ง)', async () => {
  const client = fakeClient({ files: ['avatar.jpg'] })
  assert.deepEqual(await listAvatarPaths(client, UID), { paths: [`${UID}/avatar.jpg`], ok: true })
  assert.deepEqual(client.calls, [['bucket', 'avatars'], ['list', UID]])
  assert.deepEqual(await listAvatarPaths(fakeClient(), UID), { paths: [], ok: true })
  assert.deepEqual(await listAvatarPaths(fakeClient({ listError: { message: 'network' } }), UID), { paths: [], ok: false })
  assert.deepEqual(await listAvatarPaths(fakeClient(), ''), { paths: [], ok: false })
})
await check('ลบไฟล์ที่จำไว้ นับเองว่าครบไหม — Storage ตอบ 200 แต่ไม่ลบ (นโยบายไม่ให้) ต้องไม่เงียบ', async () => {
  const paths = [`${UID}/avatar.jpg`, `${UID}/avatar.png`]
  assert.equal(await removeOrphanAvatars(fakeClient(), paths), 0)
  assert.equal(await removeOrphanAvatars(fakeClient({ removedCount: 1 }), paths), 1)
  assert.equal(await removeOrphanAvatars(fakeClient({ removedCount: 0 }), paths), 2)
  assert.equal(await removeOrphanAvatars(fakeClient({ removeError: { message: 'denied' } }), paths), 2)
  const none = fakeClient()
  assert.equal(await removeOrphanAvatars(none, []), 0)
  assert.deepEqual(none.calls, [], 'ไม่มีไฟล์ ไม่แตะ Storage')
})
await check('AdminDashboard.deleteUser: อ่านรายการรูปก่อนลบบัญชี ลบไฟล์หลังบัญชีหาย และไม่ลบถ้าลบบัญชีไม่ผ่าน', () => {
  const src = readFileSync(new URL('../src/pages/AdminDashboard.jsx', import.meta.url), 'utf8')
  const start = src.indexOf('async function deleteUser(userId) {')
  assert.ok(start >= 0, 'ไม่พบ deleteUser')
  const body = src.slice(start, src.indexOf('\n  }\n', start))
  const list = body.indexOf('listAvatarPaths(supabase, userId)')
  const rpc = body.indexOf("rpc('delete_user_by_id'")
  const remove = body.indexOf('removeOrphanAvatars(')
  assert.ok(list >= 0 && list < rpc && rpc < remove, 'ลำดับต้องเป็น list → rpc → remove')
  assert.match(body, /const avatarsLeft = error \? 0 : await removeOrphanAvatars\(supabase, avatars\.paths\)/,
    'ลบบัญชีไม่ผ่านต้องไม่ลบรูป (รูปของคนที่ยังอยู่ห้ามหาย)')
})
const avatarFnSql = migration('20261103100000_admin_delete_orphan_avatars_fn.sql')
const avatarPolicySql = migration('20261103100100_admin_delete_orphan_avatars_policy.sql')
await check('ฟังก์ชันตัดสินสิทธิ์: เฉพาะแอดมิน + โฟลเดอร์ที่ไม่มีเจ้าของ · ปิดทาง anon · ไม่ใช่ตัวไล่ถามว่ามีผู้ใช้ไหม', () => {
  const body = normalize(functionBody(avatarFnSql.replace('admin_may_delete_avatar(p_folder text)', 'admin_may_delete_avatar()'), 'admin_may_delete_avatar'))
  assert.match(body, /coalesce\(public\.get_my_role\(\) IN \('admin', 'superadmin'\), false\)/)
  assert.match(body, /AND p_folder IS NOT NULL/)
  assert.match(body, /AND NOT EXISTS \(SELECT 1 FROM auth\.users u WHERE u\.id::text = p_folder\)/)
  assert.match(avatarFnSql, /SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/)
  assert.match(avatarFnSql, /REVOKE ALL ON FUNCTION public\.admin_may_delete_avatar\(text\) FROM PUBLIC, anon;/)
  assert.match(avatarFnSql, /GRANT EXECUTE ON FUNCTION public\.admin_may_delete_avatar\(text\) TO authenticated;/)
})
await check('นโยบายลบรูป: เฉพาะ bucket avatars ผ่านฟังก์ชัน เป็นนโยบายเพิ่ม ไม่แตะนโยบายลบรูปตัวเอง · ไม่แตะ delete_user_by_id', () => {
  assert.match(avatarPolicySql, /CREATE POLICY "Admins can delete orphan avatars" ON storage\.objects\s+FOR DELETE TO authenticated\s+USING \(bucket_id = 'avatars' AND public\.admin_may_delete_avatar\(\(storage\.foldername\(name\)\)\[1\]\)\);/)
  assert.ok(!/Users can delete own avatar/.test(avatarPolicySql.replace(/--[^\n]*/g, '')), 'ห้ามแตะนโยบายเดิม')
  for (const sql of [avatarFnSql, avatarPolicySql]) {
    assert.ok(!/delete_user_by_id/.test(sql.replace(/--[^\n]*/g, '')), 'ฟังก์ชันนั้นถูกเขียนทับมา 7 รุ่น ไม่แตะซ้ำ')
    assert.ok(!/DELETE FROM storage\.objects/i.test(sql.replace(/--[^\n]*/g, '')), 'ลบด้วย SQL ไม่ได้ ไฟล์จริงค้าง')
  }
})

console.log(`\nผ่านทั้งหมด ${passed} ข้อ`)
