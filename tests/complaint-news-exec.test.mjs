// ภาพข่าวจากห้องผู้บริหาร + ปิดช่องโหว่หมวดอ่อนไหว (static — ไม่ต่อฐานข้อมูล ไม่ใช้เน็ต)
//   src/components/staff/executive/ExecNewsList.jsx · src/components/complaints/ComplaintNewsDialog.jsx (source="exec")
//   src/components/admin/ComplaintsManager.jsx · supabase/migrations/20261119100100_complaint_news_functions.sql
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

// ตัดคอมเมนต์ SQL (-- ถึงท้ายบรรทัด) ออกก่อนตรวจเนื้อฟังก์ชัน — คอมเมนต์หัวไฟล์พูดถึงคำที่ห้ามคืนค่า จึงต้องไม่นับ
const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, '')

// แยกฟังก์ชันตามชื่อ: จาก CREATE OR REPLACE FUNCTION public.<name>( ถึง $$; ตัวปิด
function functionBody(sql, name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  assert.ok(start >= 0, `ไม่พบฟังก์ชัน ${name}`)
  const open = sql.indexOf('$$', start)
  const close = sql.indexOf('$$;', open + 2)
  assert.ok(open > 0 && close > open, `หาขอบเขตฟังก์ชัน ${name} ไม่เจอ`)
  return sql.slice(start, close + 3)
}

await test('ก) ExecNewsList + โหมด exec ไม่อ่านตาราง complaints / complaint_timeline ตรง', async () => {
  const list = await read('src/components/staff/executive/ExecNewsList.jsx')
  assert.ok(!/\.from\(\s*['"`](complaints|complaint_timeline)['"`]\s*\)/.test(list), 'ExecNewsList อ่านตารางตรง')
  assert.match(list, /rpc\('exec_complaint_news_items'/)
  assert.match(list, /source="exec"/)

  const dialog = await read('src/components/complaints/ComplaintNewsDialog.jsx')
  // โหมด exec โหลดผ่าน RPC
  assert.match(dialog, /rpc\('exec_complaint_news_detail'/)
  // การอ่าน complaint_timeline มีที่เดียว (โหมด staff) และต้องอยู่หลังด่าน if (isExec) return — โหมด exec ไม่ถึงบรรทัดนี้
  const fromCalls = dialog.match(/\.from\(\s*['"`][a-z_]+['"`]\s*\)/g) ?? []
  assert.deepEqual(fromCalls, [".from('complaint_timeline')"], 'กล่องต้องอ่านตารางตรงได้เฉพาะ complaint_timeline ของโหมด staff')
  const effectStart = dialog.indexOf(".from('complaint_timeline')")
  const guard = dialog.lastIndexOf('if (isExec) return undefined', effectStart)
  assert.ok(guard > 0 && effectStart - guard < 120, 'การอ่าน complaint_timeline ต้องถูกกันด้วย if (isExec) return')
  assert.ok(!/\.from\(\s*['"`]complaints['"`]\s*\)/.test(dialog), 'กล่องภาพข่าวอ่านตาราง complaints ตรง')
})

await test('ข) โหมด exec ไม่แสดงส่วนรูปผู้แจ้ง · ไม่ส่ง attachments เข้ากล่อง', async () => {
  const dialog = await read('src/components/complaints/ComplaintNewsDialog.jsx')
  // รายการรูปผู้แจ้งว่างเสมอเมื่อ exec
  assert.match(dialog, /const reporterRefs = useMemo\(\(\) => \(isExec \? \[\] :/)
  // ส่วน UI รูปผู้แจ้งต้องมีเงื่อนไข !isExec นำหน้า
  assert.match(dialog, /\{!isExec && reporterRefs\.length > 0 && \(/)
  // ตัวโหลดโหมด exec สร้างวัตถุเรื่องเองจากฟิลด์ RPC — ต้องไม่ใส่ attachments
  const loader = dialog.slice(dialog.indexOf('function ExecNewsDialogLoader'), dialog.indexOf('function NewsDialogBody'))
  assert.ok(loader.length > 200)
  assert.ok(!/attachments\s*:/.test(loader), 'ตัวโหลดโหมด exec ใส่ attachments')
  assert.ok(!/d\.attachments/.test(loader))
  // ใช้ note จาก RPC เป็นรายละเอียด
  assert.match(dialog, /execNote=\{d\.note \?\? ''\}/)
  assert.match(dialog, /isExec \? execNote :/)
})

await test('ฝั่งห้องผู้บริหาร: ปุ่มพับ/กางโหลดเมื่อกางเท่านั้น · ไม่มีชื่อผู้ร้อง/ปุ่มอนุมัติ/ลิงก์เข้าไปแก้เรื่อง', async () => {
  const blocks = await read('src/components/staff/executive/ExecServiceBlocks.jsx')
  assert.match(blocks, /export function NewsListToggle/)
  assert.match(blocks, /\{open && <ExecNewsList tenant=\{tenant\} \/>\}/)
  assert.match(blocks, /ดูเรื่องที่ดำเนินการแล้ว · ทำภาพข่าว/)
  const zone = await read('src/components/staff/executive/ExecServiceZone.jsx')
  assert.match(zone, /\{hasComplaints && <NewsListToggle tenant=\{tenant\} \/>\}/)

  const list = await read('src/components/staff/executive/ExecNewsList.jsx')
  assert.match(list, /ยังไม่มีเรื่องที่ดำเนินการแล้วและมีรูปใน/)
  assert.match(list, /แสดง \{execNf\(data\.limit\)\} จาก \{execNf\(data\.total\)\} เรื่อง/)
  assert.match(list, /SectionError/)
  assert.match(list, /#c2410c/)
  // PDPA + กติกาห้องผู้บริหาร (ตรวจเฉพาะโค้ด ไม่นับคอมเมนต์)
  const code = list.replace(/\/\/[^\n]*/g, '')
  for (const banned of ['reporter', 'อนุมัติ', 'Approve', 'href=', 'navigate(', 'onOpenComplaint']) {
    assert.ok(!code.includes(banned), `ExecNewsList มี "${banned}"`)
  }
  assert.ok(!/phone/i.test(code), 'ExecNewsList มี phone') // ไม่ใช้ includes — ชื่อไอคอน Megaphone มีคำนี้
})

await test('ค) ComplaintsManager ซ่อนปุ่มภาพข่าวด้วย newsCategoryAllowed ทั้ง 2 จุด + กติกาปิดตายเมื่อไม่แน่ใจ', async () => {
  const manager = await read('src/components/admin/ComplaintsManager.jsx')
  const marker = "normalizeActionStatus(c.status) === 'closed' && c.category !== 'odor'"
  const parts = manager.split(marker).slice(1)
  assert.equal(parts.length, 2, 'ต้องมีปุ่มภาพข่าว 2 จุด')
  for (const part of parts) {
    const head = part.slice(0, 200)
    assert.match(head, /newsCategoryAllowed\(c\.category, categoryMeta\)/)
    // เงื่อนไขซ่อนต้องมาก่อนเงื่อนไขสิทธิ์ (ซ่อนทุก role รวม admin)
    assert.ok(head.indexOf('newsCategoryAllowed') < head.indexOf('isAdmin ||'), 'เงื่อนไขหมวดต้องมาก่อนสิทธิ์')
  }
  // กติกาเดียวกับ exec_complaint_news_base: ไม่รู้จักหมวด/อ่อนไหว/เฉพาะกิจ/odor/corruption = ไม่ได้
  const { newsCategoryAllowed, withNewsPhotoUrl } = await import('../src/lib/complaintNewsImage.js')
  const meta = {
    road: { is_adhoc: false, requires_manual_intake: false },
    staff_conduct: { is_adhoc: false, requires_manual_intake: true },
    flood_ops: { is_adhoc: true, requires_manual_intake: false },
    corruption: { is_adhoc: false, requires_manual_intake: false },
    odor: { is_adhoc: false, requires_manual_intake: false },
  }
  assert.equal(newsCategoryAllowed('road', meta), true)
  for (const blocked of ['staff_conduct', 'flood_ops', 'corruption', 'odor', 'unknown', '', null]) {
    assert.equal(newsCategoryAllowed(blocked, meta), false, `หมวด ${blocked} ต้องทำภาพข่าวไม่ได้`)
  }
  assert.equal(newsCategoryAllowed('road', {}), false, 'หมวดยังโหลดไม่เสร็จ = ไม่ได้')
  const sql = await read('supabase/migrations/20261119100100_complaint_news_functions.sql')
  assert.match(sql, /c\.category NOT IN \('odor', 'corruption'\)/)
  assert.match(sql, /cat\.requires_manual_intake IS FALSE/)
  // file id → URL ประกอบที่หน้าเว็บ · id ผิดรูปแบบ = ไม่มีรูป
  assert.equal(withNewsPhotoUrl({ photo_file_id: 'abcDEF_123-xyz' }, 'https://x.supabase.co/').photo_url,
    'https://x.supabase.co/functions/v1/drive-file?id=abcDEF_123-xyz')
  assert.equal(withNewsPhotoUrl({ photo_file_id: 'bad id"><script>' }, 'https://x.supabase.co').photo_url, null)
  assert.equal(withNewsPhotoUrl(null, 'https://x.supabase.co'), null)
  // categoryMeta ในไฟล์นี้ต้องดึง requires_manual_intake มาจริง (ไม่ใช่ค่าที่ไม่เคยถูกเติม)
  assert.match(manager, /select\('value, label, emoji, is_adhoc, requires_manual_intake'\)/)
  assert.match(manager, /meta\[c\.value\] = \{ is_adhoc: !!c\.is_adhoc, requires_manual_intake: !!c\.requires_manual_intake \}/)
})

await test('ง) migration: exec_* เรียก exec_assert_viewer เป็นคำสั่งแรก · REVOKE ครบ · current_mayor ไม่มี GRANT · ไม่คืนข้อมูลผู้แจ้ง', async () => {
  const raw = await read('supabase/migrations/20261119100100_complaint_news_functions.sql')
  const sql = stripSqlComments(raw)

  for (const name of ['exec_complaint_news_items', 'exec_complaint_news_detail']) {
    const body = functionBody(sql, name)
    // คำสั่งแรกหลัง BEGIN ต้องเป็น PERFORM exec_assert_viewer (มีได้แค่ DECLARE นำหน้า)
    const afterBegin = body.slice(body.indexOf('BEGIN') + 'BEGIN'.length).trimStart()
    assert.ok(afterBegin.startsWith('PERFORM public.exec_assert_viewer(_municipality_id);'), `${name}: คำสั่งแรกต้องเป็น exec_assert_viewer`)
    // ไม่คืนข้อมูลผู้แจ้ง
    for (const banned of ['phone', 'reporter', 'description', 'attachments', 'latitude', 'longitude']) {
      assert.ok(!new RegExp(`\\b${banned}\\b`, 'i').test(body), `${name} มีคำต้องห้าม: ${banned}`)
    }
  }

  // REVOKE ... FROM PUBLIC, anon, authenticated ครบทุกฟังก์ชัน
  const functions = [
    ['complaint_news_current_mayor', 'uuid'],
    ['exec_complaint_news_base', 'uuid'],
    ['complaint_news_branding', 'uuid'],
    ['set_complaint_news_executive_photo', 'uuid, text'],
    ['exec_complaint_news_items', 'uuid'],
    ['exec_complaint_news_detail', 'uuid, uuid'],
  ]
  for (const [name, args] of functions) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${name}(${args}) FROM PUBLIC, anon, authenticated;`), `${name}: ไม่มี REVOKE ... FROM PUBLIC, anon, authenticated`)
  }
  // ฟังก์ชันภายในไม่มี GRANT เลย · อีก 4 ตัวให้เฉพาะ authenticated
  for (const internal of ['complaint_news_current_mayor', 'exec_complaint_news_base']) {
    assert.ok(!new RegExp(`GRANT[^;]*${internal}`, 'i').test(sql.replace(/REVOKE[^;]*;/g, '')), `${internal} มี GRANT`)
    // ฟังก์ชันภายในไม่เป็น DEFINER (รันในนามเจ้าของผ่านผู้เรียกที่เป็น DEFINER อยู่แล้ว)
    assert.ok(!/SECURITY DEFINER/.test(functionBody(sql, internal).split('AS $$')[0] ?? ''), `${internal} ไม่ควรเป็น SECURITY DEFINER`)
  }
  // ทั้งสองฟังก์ชัน exec_* ใช้ exec_complaint_news_base ตัวเดียวกัน (เงื่อนไขเดียวกัน ไม่มีทางกว้างกว่ากัน)
  for (const name of ['exec_complaint_news_items', 'exec_complaint_news_detail']) {
    assert.match(functionBody(sql, name), /FROM public\.exec_complaint_news_base\(_municipality_id\) AS b/)
  }
  // ด่านท้ายไฟล์: เจ้าของ + ตารางสิทธิ์ EXECUTE
  assert.match(sql, /เจ้าของฟังก์ชันไม่ตรงกับ executive_overview/)
  assert.match(sql, /สิทธิ์ EXECUTE ไม่ตรงแผน/)
  const grants = [...sql.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)\(([^)]*)\) TO (\w+);/g)]
  assert.deepEqual(grants.map(m => m[1]).sort(), ['complaint_news_branding', 'exec_complaint_news_detail', 'exec_complaint_news_items', 'set_complaint_news_executive_photo'])
  assert.ok(grants.every(m => m[3] === 'authenticated'), 'GRANT ให้ role อื่นนอกจาก authenticated')
  assert.ok(!/GRANT\s[^;]*\sTO\s[^;]*\b(anon|PUBLIC)\b/.test(sql.replace(/REVOKE[^;]*;/g, '')), 'มี GRANT ให้ anon/PUBLIC')
  // SECURITY DEFINER ทุกตัวต้องล็อก search_path
  assert.equal((sql.match(/SECURITY DEFINER/g) ?? []).length, 4)
  assert.equal((sql.match(/SET search_path = ''/g) ?? []).length, 6)
})

console.log(`\n${cases} cases passed`)
