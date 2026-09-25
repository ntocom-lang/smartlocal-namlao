// ใครยื่นบริการประเภทนี้ได้ (ทุกคน / เฉพาะผู้มีตำแหน่ง) — ตรวจ 3 ชั้นให้ตรงกันเสมอ
//   1) กติกาฝั่งหน้าเว็บ src/lib/serviceAudience.js ทุก role × ทุกระดับ
//   2) ด่านจริงใน DB (submit_citizen_complaint_v4) ใช้ลิสต์ role ชุดเดียวกัน และไม่หลุดผ่านด้วย NULL/ช่องทาง
//   3) ทุกจุดที่ประชาชนเลือกหมวดคำร้องได้ ต้องกรองด้วย helper ตัวเดียวกัน
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  OFFICIAL_ROLES,
  SUBMIT_AUDIENCE_OFFICIALS,
  SUBMIT_AUDIENCE_PUBLIC,
  canSubmitCategory,
  isOfficialRole,
  withoutOfficialsOnlyCategories,
} from '../src/lib/serviceAudience.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = async (rel) => (await readFile(path.join(root, rel), 'utf8')).replace(/\r\n/g, '\n')

// ── 1) กติกาฝั่งหน้าเว็บ ─────────────────────────────────────────────────────────
// role เป็น null ทั้งตอนไม่ล็อกอินและตอนกำลังโหลดโปรไฟล์ → ถือเป็นประชาชนเสมอ (ปลอดภัยไว้ก่อน)
const OFFICIALS = ['superadmin', 'admin', 'officer', 'staff', 'technician', 'viewer', 'council']
const NOT_OFFICIALS = ['citizen', null, undefined, '', 'kamnan']

assert.deepEqual([...OFFICIAL_ROLES].sort(), [...OFFICIALS].sort(), 'ผู้มีตำแหน่ง = role ที่ไม่ใช่ประชาชนทุกตัว')
for (const role of OFFICIALS) assert.equal(isOfficialRole(role), true, `${role} ต้องเป็นผู้มีตำแหน่ง`)
for (const role of NOT_OFFICIALS) assert.equal(isOfficialRole(role), false, `${role} ต้องไม่ใช่ผู้มีตำแหน่ง`)

for (const role of [...OFFICIALS, ...NOT_OFFICIALS]) {
  // หมวดทุกคน (และข้อมูลที่ไม่มีคอลัมน์นี้ เช่น ค่าสำรองในโค้ด) ยื่นได้ทุก role
  assert.equal(canSubmitCategory({ submit_audience: SUBMIT_AUDIENCE_PUBLIC }, role), true)
  assert.equal(canSubmitCategory({ value: 'light' }, role), true)
  assert.equal(canSubmitCategory(null, role), true)
  assert.equal(
    canSubmitCategory({ submit_audience: SUBMIT_AUDIENCE_OFFICIALS }, role),
    OFFICIALS.includes(role),
    `หมวดเฉพาะผู้มีตำแหน่ง: role ${role}`,
  )
}

const cats = [
  { value: 'light', submit_audience: 'officials' },
  { value: 'road', submit_audience: 'public' },
  { value: 'tree' },
]
assert.deepEqual(withoutOfficialsOnlyCategories(cats, 'citizen').map(c => c.value), ['road', 'tree'])
assert.deepEqual(withoutOfficialsOnlyCategories(cats, null).map(c => c.value), ['road', 'tree'])
assert.deepEqual(withoutOfficialsOnlyCategories(cats, 'council').map(c => c.value), ['light', 'road', 'tree'])
assert.equal(withoutOfficialsOnlyCategories(undefined, 'citizen'), undefined)

// ── 2) ด่านจริงในฐานข้อมูล ────────────────────────────────────────────────────────
const ddl = await read('supabase/migrations/20260925100000_complaint_category_submit_audience.sql')
assert.match(ddl, /ADD COLUMN IF NOT EXISTS submit_audience text NOT NULL DEFAULT 'public'/)
assert.match(ddl, /CHECK \(submit_audience IN \('public', 'officials'\)\)/)
assert.equal(SUBMIT_AUDIENCE_PUBLIC, 'public')
assert.equal(SUBMIT_AUDIENCE_OFFICIALS, 'officials')

const fnSql = await read('supabase/migrations/20260925100100_complaint_submit_audience_check.sql')
const BLOCK_START = '\n\n  -- ── ใครแจ้งหมวดนี้ได้'
const blockFrom = fnSql.indexOf(BLOCK_START)
assert.ok(blockFrom > 0, 'ต้องมีบล็อกตรวจผู้ยื่น')
const blockTo = fnSql.indexOf('  END IF;', fnSql.indexOf("USING ERRCODE = '42501';", blockFrom)) + '  END IF;'.length
const block = fnSql.slice(blockFrom, blockTo)
// ตรวจเฉพาะโค้ด — คอมเมนต์ในบล็อกเอ่ยถึง p_channel เพื่อเตือนว่าห้ามใช้
const blockCode = block.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')

const sqlRoles = block.match(/actor\.role IN \(([^)]*)\)/)[1].split(',').map(s => s.trim().replace(/'/g, ''))
assert.deepEqual(
  [...sqlRoles, 'superadmin'].sort(),
  [...OFFICIAL_ROLES].sort(),
  'ลิสต์ role ในด่าน DB ต้องตรงกับ OFFICIAL_ROLES ใน src/lib/serviceAudience.js',
)
assert.match(block, /actor\.role = 'superadmin'/)
// ผู้มีตำแหน่งของ อปท. อื่นต้องไม่ผ่าน (หน้าเว็บลด role เป็น citizen เองเมื่อข้าม อปท. — DB ต้องกันเท่ากัน)
assert.match(block, /actor\.municipality_id = p_municipality_id/)
// ผู้ไม่ล็อกอินได้ NULL — ไม่มี COALESCE จะหลุดผ่าน IF NOT NULL
assert.match(block, /AND NOT COALESCE\(\(/)
assert.match(block, /\), false\)\n\s+THEN/)
assert.match(block, /WHERE actor\.id = auth\.uid\(\)/)
// ตัดสินจากตัวผู้เรียกเท่านั้น — p_channel ปลอมเป็น 'oss_counter' ได้จาก client
assert.doesNotMatch(blockCode, /p_channel/)
assert.doesNotMatch(blockCode, /p_user_id/)
assert.match(block, /USING ERRCODE = '42501'/)

// ส่วนอื่นของฟังก์ชันต้องเหมือนรุ่นก่อนหน้าทุกตัวอักษร — ฟังก์ชันนี้คือทางเข้าเดียวของคำร้องทุกใบ
const fnBody = (sql) => sql.slice(
  sql.indexOf('CREATE OR REPLACE FUNCTION public.submit_citizen_complaint_v4('),
  sql.indexOf('$function$;') + '$function$;'.length,
)
const previous = await read('supabase/migrations/20260917110000_complaint_detail_no_min_length.sql')
assert.equal(fnBody(fnSql.slice(0, blockFrom) + fnSql.slice(blockTo)), fnBody(previous),
  'ต่างจาก 20260917110000 ได้เฉพาะบล็อกตรวจผู้ยื่นเท่านั้น')
// ต้องตรวจหลังรู้หมวด (v_category) และก่อน INSERT
assert.ok(blockFrom > fnSql.indexOf("'ประเภทคำร้องนี้ยังไม่ได้กำหนดกองรับผิดชอบ'"))
assert.ok(blockTo < fnSql.indexOf('INSERT INTO public.complaints'))
// ด่านรันก่อนคอลัมน์มีไม่ได้
assert.match(fnSql, /RAISE EXCEPTION 'ต้อง apply 20260925100000_complaint_category_submit_audience\.sql ก่อนไฟล์นี้'/)

// ── 3) ทุกจุดที่ประชาชนเลือกหมวดได้ ต้องกรองด้วย helper ────────────────────────────
async function walk(dir) {
  const out = []
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(rel))
    else if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(rel)
  }
  return out
}

// จุดที่ดึงหมวดคำร้องแล้วพาไปยื่นเรื่อง = ตัวเลือกยื่นใหม่ของประชาชน (ไฟล์ใหม่ในอนาคตจะถูกจับอัตโนมัติ)
const listingFiles = []
for (const file of await walk('src')) {
  const src = await read(file)
  if (src.includes("from('complaint_categories')") && src.includes('/request?category=')) listingFiles.push(file)
}
const EXPECTED_LISTINGS = [
  'src/components/citizen/templates/Kledkaew/Home.jsx',
  'src/components/home/AdhocBand.jsx',
  'src/components/home/ComplaintBand.jsx',
  'src/components/home/ServiceButtons.jsx',
  'src/pages/ComplaintCategory.jsx',
]
assert.deepEqual(listingFiles.sort(), EXPECTED_LISTINGS, 'จุดเลือกหมวดของประชาชนเปลี่ยน — ตรวจว่ากรองด้วย serviceAudience แล้ว')

for (const file of [...listingFiles, 'src/pages/CitizenForm.jsx']) {
  const src = await read(file)
  assert.match(src, /from '[./]+lib\/serviceAudience'/, `${file} ต้อง import serviceAudience`)
  // ไม่ดึงคอลัมน์มา = กรองไม่ได้ ทุกหมวดจะกลายเป็น "ทุกคน" เงียบๆ
  assert.match(src, /from\('complaint_categories'\)[\s\S]{0,120}submit_audience/, `${file} ต้อง select submit_audience`)
}

// ServiceButtons ต้องตัด 8 ช่องหลังกรอง ไม่ใช่ .limit(8) ตอนดึง (ประชาชนจะเหลือไม่ถึง 8)
const serviceButtons = await read('src/components/home/ServiceButtons.jsx')
assert.doesNotMatch(serviceButtons, /\.order\('sort_order'\)\s*\.limit\(/)
assert.match(serviceButtons, /\)\.slice\(0, 8\)\.map/)

// ฟอร์มคำร้อง: ลิงก์เก่าต้องขึ้นแถบบอกช่องทางอื่น ปุ่มส่งต้องปิด และข้อความไม่ใช่ "ปิดรับแล้ว"
const citizenForm = await read('src/pages/CitizenForm.jsx')
assert.match(citizenForm, /disabled=\{submitting \|\| categoryDisabled \|\| categoryOfficialsOnly\}/)
assert.match(citizenForm, /officialsOnlyHiddenValues\.has\(form\.category\)/)
assert.match(citizenForm, /ยังไม่เปิดให้ประชาชนแจ้งทางออนไลน์/)
assert.match(citizenForm, /navigate\('\/contact'\)/)

// หน้าแอดมิน: เปลี่ยนค่าต้องอ่านกลับจาก DB และบันทึก audit log
const admin = await read('src/pages/AdminDashboard.jsx')
assert.match(admin, /\.update\(\{ submit_audience: next \}\)\.eq\('id', id\)\.select\('id, submit_audience'\)/)
assert.match(admin, /action: 'update_submit_audience'/)
assert.match(await read('src/components/admin/AuditLogViewer.jsx'), /update_submit_audience:/)

console.log('service-audience: ผ่านทุกข้อ')
