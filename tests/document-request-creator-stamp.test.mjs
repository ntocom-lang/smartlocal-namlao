// รอย "บัญชีที่สร้างแถวจริง" ของคำขอบริการ/เอกสาร — ตรวจไฟล์ migration (ไม่ต่อฐานข้อมูล ไม่ใช้ dependency)
//
// ทำไมต้องมี: created_by_uid เป็นหลักฐานเมื่อมีข้อพิพาทว่า "ใครกรอกแทนที่เคาน์เตอร์" (เจ้าของระบบสั่ง 2569-11-05)
// มันเชื่อได้เพราะตัวกระตุ้น 2 ตัวเท่านั้น — ตัวหนึ่งประทับ auth.uid() ทับค่าที่ client ส่งมา อีกตัวกันการแก้ภายหลัง
// ถ้ามีใครเขียน migration ทับ/ลบตัวกระตุ้นนี้ หรือแก้ให้เชื่อค่าจาก client รอยจะกลายเป็นของปลอมที่ดูเหมือนยืนยันแล้ว
// (บทเรียนเดียวกับ docs/ai/NOTES.md ข้อ 5: CREATE OR REPLACE เขียนทับทั้งฟังก์ชันได้เงียบๆ)
//
// ⚠️ เทสต์นี้อ่านเฉพาะไฟล์ในรีโป ไม่เห็น SQL ที่มีคนรันตรงบนฐาน — ตัวกระตุ้นจริงบนฐานต้องตรวจด้วย pg_trigger
// พฤติกรรมจริง (ประทับทับ/กันแก้/อยู่ร่วมกับตัวกระตุ้นเดิม) ทดสอบบน PGlite ตอนเขียน migration — ดูรายงาน PR
//
// รัน: npm run test:doc-creator-stamp
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(root, 'supabase/migrations')
const COLUMN_FILE = '20261105110000_document_requests_created_by_uid_column.sql'
const TRIGGER_FILE = '20261105110100_document_requests_stamp_creator_trigger.sql'
const read = async name => (await readFile(path.join(DIR, name), 'utf8')).replace(/\r\n/g, '\n')

// ตัดคอมเมนต์ (-- และ /* */) โดยเคารพสตริงเดี่ยว/dollar-quote — คอมเมนต์ในไฟล์เองก็เอ่ยถึงชื่อเหล่านี้
function stripSqlComments(sql) {
  let out = ''
  for (let i = 0; i < sql.length; i++) {
    const two = sql.slice(i, i + 2)
    if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1
      out += sql.slice(i, j + 1); i = j
    } else if (two === '--') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += '\n'
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 1
    } else out += sql[i]
  }
  return out
}

const columnSql = stripSqlComments(await read(COLUMN_FILE))
const triggerSql = stripSqlComments(await read(TRIGGER_FILE))

// ── ไฟล์ 1: คอลัมน์ ────────────────────────────────────────────────────────────
assert.match(columnSql, /ALTER TABLE public\.document_requests ADD COLUMN IF NOT EXISTS created_by_uid uuid;/, 'ต้องเพิ่มคอลัมน์ uuid แบบรันซ้ำได้')
assert.doesNotMatch(columnSql, /REFERENCES|FOREIGN KEY/i,
  'ห้ามผูก FK — รอยตรวจสอบต้องไม่ขวางการลบบัญชีเจ้าหน้าที่ และไม่หายตอนลบ (ON DELETE SET NULL ทำให้รอยหาย)')
assert.doesNotMatch(columnSql, /\bCREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|TRIGGER)\b/i, 'ไฟล์คอลัมน์ต้องไม่มีฟังก์ชัน/ตัวกระตุ้น (1 ไฟล์ = 1 เฟส)')
// ตัดข้อความในเครื่องหมายคำพูดออกก่อน — COMMENT ON COLUMN เอ่ยคำว่า INSERT ในคำอธิบายได้
assert.doesNotMatch(columnSql.replace(/'(?:[^']|'')*'/g, "''"), /\b(UPDATE|INSERT|DELETE)\b/i,
  'ห้ามย้อนเติมค่าให้แถวเก่า — จะกลายเป็นของปลอมที่ดูเหมือนฐานยืนยันแล้ว')

// ── ไฟล์ 2: ตัวกระตุ้น ──────────────────────────────────────────────────────────
function fnBody(name) {
  const m = triggerSql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`))
  assert.ok(m, `ไม่พบฟังก์ชัน ${name}`)
  return { whole: m[0], body: m[1] }
}
const stamp = fnBody('stamp_document_request_creator')
const keep = fnBody('keep_document_request_creator')

assert.match(stamp.body, /NEW\.created_by_uid\s*:=\s*auth\.uid\(\)\s*;/, 'ต้องประทับ auth.uid() ตรงๆ')
assert.doesNotMatch(stamp.body, /COALESCE|NULLIF|CASE|OLD\./i, 'ห้ามเชื่อค่าที่ client ส่งมา (COALESCE/CASE) — ต้องทับทุกครั้ง')
assert.match(keep.body, /NEW\.created_by_uid\s*:=\s*OLD\.created_by_uid\s*;/, 'ต้องคืนค่าเดิมทุกครั้งที่มีการสั่งแก้')
assert.doesNotMatch(keep.body, /RAISE/i, 'ไม่ RAISE — การ UPDATE ทั้งแถวที่แตะคอลัมน์นี้ต้องไม่พังทั้งก้อน แค่แก้ค่านี้ไม่ได้')
for (const [name, fn] of [['stamp', stamp], ['keep', keep]]) {
  assert.match(fn.body, /RETURN NEW;/, `${name}: ต้อง RETURN NEW (ไม่งั้น 2F005 กับทุกการเขียน — docs/ai/NOTES.md ข้อ 5)`)
  assert.match(fn.whole, /RETURNS trigger/, `${name}: ต้องเป็นฟังก์ชัน trigger`)
  assert.match(fn.whole, /SET search_path = ''/, `${name}: ต้องตั้ง search_path ว่าง`)
}
for (const name of ['stamp_document_request_creator', 'keep_document_request_creator']) {
  assert.match(triggerSql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(\\) FROM PUBLIC, anon, authenticated;`), `${name}: ต้องเพิกถอนสิทธิ์เรียกตรง`)
}
assert.match(triggerSql,
  /CREATE TRIGGER stamp_document_request_creator_trigger\s+BEFORE INSERT ON public\.document_requests\s+FOR EACH ROW EXECUTE FUNCTION public\.stamp_document_request_creator\(\);/)
assert.match(triggerSql,
  /CREATE TRIGGER keep_document_request_creator_trigger\s+BEFORE UPDATE OF created_by_uid ON public\.document_requests\s+FOR EACH ROW EXECUTE FUNCTION public\.keep_document_request_creator\(\);/)
assert.match(triggerSql, /document_requests\.created_by_uid/, 'ด่านตรวจหัวไฟล์ต้องเช็กว่าไฟล์คอลัมน์รันแล้ว')
assert.match(await read(TRIGGER_FILE), /ต้อง apply 20261105110000 ก่อน/)

// ต้องไม่ทับฟังก์ชันเดิมของตาราง (ไฟล์นี้สร้างของใหม่ชื่อใหม่ล้วน)
for (const existing of ['protect_document_request_scope', 'route_document_request_department', 'guard_cctv_footage_request']) {
  assert.doesNotMatch(triggerSql, new RegExp(`FUNCTION public\\.${existing}\\b`), `ห้ามแตะฟังก์ชันเดิม ${existing}`)
}

// ── ไฟล์อื่นในรีโปต้องไม่รื้อตัวกระตุ้นนี้ ───────────────────────────────────────
const offenders = []
for (const name of (await readdir(DIR)).filter(n => n.endsWith('.sql') && n !== TRIGGER_FILE)) {
  const sql = stripSqlComments(await read(name))
  if (/DROP TRIGGER\s+(IF EXISTS\s+)?(stamp|keep)_document_request_creator_trigger/i.test(sql)
    || /(CREATE OR REPLACE )?FUNCTION public\.(stamp|keep)_document_request_creator\b/i.test(sql)
    || /ALTER TABLE public\.document_requests\s+(DISABLE|ENABLE) TRIGGER\s+(stamp|keep)_document_request_creator_trigger/i.test(sql)
    || /ALTER TABLE public\.document_requests\s+DISABLE TRIGGER\s+(ALL|USER)\b/i.test(sql)) offenders.push(name)
}
assert.deepEqual(offenders, [], `migration เหล่านี้รื้อ/ปิดตัวกระตุ้นรอย created_by_uid: ${offenders.join(', ')}`)

// ลำดับชื่อไฟล์: ไฟล์คอลัมน์ต้องมาก่อนไฟล์ตัวกระตุ้น
assert.ok(COLUMN_FILE < TRIGGER_FILE, 'ไฟล์คอลัมน์ต้องเรียงก่อนไฟล์ตัวกระตุ้น')

console.log('PASS document-request-creator-stamp: คอลัมน์ไม่มี FK/ไม่ย้อนเติม · ตัวกระตุ้นทับค่า client + กันแก้ + RETURN NEW + ไม่ทับฟังก์ชันเดิม')
