// กันไม่ให้ role anon (ผู้ไม่ล็อกอิน) กลับมาเรียก public.rate_complaint() ได้ และกันไม่ให้ authenticated เสียสิทธิ์
//
// ที่มา: PR #682 (20261114100000_close_anon_ref_rating.sql) ถอน EXECUTE จาก anon ของ rate_complaint(uuid,int,text)
// เพื่อปิดช่อง "ยึดช่องคะแนน unverified" (ref_no เดาได้ → ไล่ยิงคะแนนปลอมใส่ทุกเรื่องที่ปิดแล้ว)
// แต่การถอนนี้เป็นแค่ REVOKE ไม่ได้อยู่ในตัวฟังก์ชัน ถ้าอนาคตใคร DROP + CREATE ฟังก์ชันนี้ใหม่
// (หรือเพิ่ม overload ใหม่) สิทธิ์จะกลับมาเงียบๆ จาก 2 ทาง:
//   1) Supabase ตั้ง default privileges ให้ anon/authenticated/service_role บนฟังก์ชันใหม่ใน schema public
//   2) Postgres ให้ EXECUTE กับ PUBLIC เป็นค่าตั้งต้นของฟังก์ชันใหม่ (anon เป็นสมาชิก PUBLIC เสมอ)
// ⇒ REVOKE ... FROM anon อย่างเดียวไม่พอ ต้อง REVOKE ALL ... FROM public ด้วย (docs/ai/NOTES.md ข้อ 5)
//
// วิธีตรวจ: จำลอง ACL ของแต่ละ signature ของ rate_complaint โดยไล่ migration ทุกไฟล์ใน supabase/migrations
// ตามลำดับชื่อไฟล์ (= ลำดับ apply) แล้วดูสถานะสุดท้าย
// สมมติฐานแบบอนุรักษ์: CREATE FUNCTION ใหม่ (หรือ CREATE OR REPLACE ที่ signature ยังไม่มี) ได้สิทธิ์ EXECUTE
// ทั้ง PUBLIC, anon และ authenticated ทันที (ไม่จำลอง ALTER DEFAULT PRIVILEGES เพราะถือว่าแจกเสมออยู่แล้ว)
// ⇒ ผู้เขียน migration ต้อง REVOKE เองเสมอ เทสต์จึงไม่ต้องรู้ว่าฐานจริงตั้ง default privileges ไว้อย่างไร
//
// ผ่านเมื่อ: ทุก signature ที่ยังมีอยู่ anon=false และ PUBLIC=false · และ rate_complaint(uuid,integer,text)
// ยังมีอยู่และ authenticated (หรือ PUBLIC) เรียกได้ — กันถอนเกินจนผู้ยื่นที่ล็อกอินประเมินไม่ได้
//
// ข้อจำกัด (เทสต์นี้อ่านเฉพาะไฟล์ในรีโป ไม่ต่อฐานข้อมูล ไม่ใช้ dependency):
//   ⚠️ เห็นเฉพาะ migration ที่อยู่ในรีโป ถ้ามีคนรัน SQL ตรงบนฐานโดยไม่มีไฟล์ เทสต์นี้จับไม่ได้
//   ⚠️ ไม่ตามเข้าไปใน EXECUTE format(...) ใน DO block — ถ้า DO block เอ่ยถึง rate_complaint ร่วมกับ
//      grant/revoke/drop/create จะล้มทันทีให้ไปเขียนเป็นคำสั่งตรง (ลูปบน pg_proc ที่ไม่เอ่ยชื่อฟังก์ชันจับไม่ได้)
//   ⚠️ ไม่ตาม ALTER DEFAULT PRIVILEGES, GRANT ... ON ALL FUNCTIONS IN SCHEMA ที่ไม่ใช่ public,
//      และฟังก์ชันที่เขียนตัวเนื้อแบบ BEGIN ATOMIC ... END (มี ; ในเนื้อโดยไม่มี dollar-quote)
//   • REVOKE GRANT OPTION FOR ... ถอนเฉพาะสิทธิ์ส่งต่อ ไม่ใช่ EXECUTE จึงไม่นับว่าถอน
//
// รัน: npm run test:rate-complaint-anon
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = 'supabase/migrations'
const FN = 'rate_complaint'
const MAIN_SIG = 'uuid,integer,text' // ตัวที่หน้าเว็บเรียกจริง
const HOLDERS = ['PUBLIC', 'anon', 'authenticated']
const NEED_REWRITE = 'รูปแบบใหม่ ต้องปรับเทสต์นี้ให้อ่านได้ (หรือเขียนเป็นคำสั่ง GRANT/REVOKE/DROP/CREATE ตรงๆ)'

// ── 1) แยกคำสั่ง ────────────────────────────────────────────────────────────────────
// เดินทีละตัวอักษรเพื่อให้เคารพ: '...' (รวม E'...' และ '' ที่ escape), "..." ชื่อ identifier,
// --, /* */ (ซ้อนกันได้แบบ Postgres) และ $tag$...$tag$ (tag ว่างได้) แล้วตัดคำสั่งด้วย ; ที่อยู่นอกสิ่งเหล่านี้เท่านั้น
// คืนรายการ { code, bodies }
//   code   = คำสั่งที่ตัดคอมเมนต์แล้ว · ข้อความในสตริง '...' ถูกแทนด้วย '' · เนื้อ dollar-quote ถูกแทนด้วย $$ $$
//            (กัน ; / คำว่า grant ในสตริงหรือเนื้อฟังก์ชันไปปนกับตัวคำสั่ง)
//   bodies = เนื้อ dollar-quote ดิบ (ตัดคอมเมนต์แล้ว) ใช้ตรวจ DO block เท่านั้น
const IDENT_CHAR = /[A-Za-z0-9_$\u0080-￿]/
const DOLLAR_TAG = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/

// ตัดเฉพาะคอมเมนต์ (เคารพสตริง/identifier) ใช้กับเนื้อ DO block
function stripSqlComments(sql) {
  let out = ''
  for (let i = 0; i < sql.length; i++) {
    const two = sql.slice(i, i + 2)
    if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length && (sql[j] !== "'" || sql[j + 1] === "'")) j += sql[j] === "'" ? 2 : 1
      out += sql.slice(i, j + 1)
      i = j
    } else if (two === '--') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += '\n'
    } else if (two === '/*') {
      let depth = 1
      let j = i + 2
      while (j < sql.length && depth > 0) {
        if (sql.startsWith('/*', j)) { depth++; j += 2 } else if (sql.startsWith('*/', j)) { depth--; j += 2 } else j++
      }
      i = j - 1
      out += ' '
    } else {
      out += sql[i]
    }
  }
  return out
}

function splitStatements(sql, file) {
  const statements = []
  let code = ''
  let bodies = []
  const flush = () => {
    if (code.trim()) statements.push({ code: code.replace(/\s+/g, ' ').trim(), bodies })
    code = ''
    bodies = []
  }
  const unterminated = (what) => assert.fail(`${file}: ${what} ไม่มีตัวปิด — อ่านไฟล์ไม่จบ (${NEED_REWRITE})`)

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const two = sql.slice(i, i + 2)
    if (ch === "'") {
      // E'...' ใช้ \ escape ได้ · '...' ธรรมดาใช้ '' เท่านั้น
      const escapeString = /[eE]/.test(sql[i - 1] ?? '') && !IDENT_CHAR.test(sql[i - 2] ?? ' ')
      let j = i + 1
      for (;;) {
        if (j >= sql.length) unterminated("สตริง '...'")
        if (escapeString && sql[j] === '\\') { j += 2; continue }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue }
          break
        }
        j++
      }
      code += "''"
      i = j
    } else if (ch === '"') {
      let j = i + 1
      for (;;) {
        if (j >= sql.length) unterminated('identifier "..."')
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue }
          break
        }
        j++
      }
      code += sql.slice(i, j + 1)
      i = j
    } else if (two === '--') {
      while (i < sql.length && sql[i] !== '\n') i++
      code += ' '
    } else if (two === '/*') {
      let depth = 1
      let j = i + 2
      while (j < sql.length && depth > 0) {
        if (sql.startsWith('/*', j)) { depth++; j += 2 } else if (sql.startsWith('*/', j)) { depth--; j += 2 } else j++
      }
      if (depth > 0) unterminated('คอมเมนต์ /* */')
      i = j - 1
      code += ' '
    } else if (ch === '$' && !IDENT_CHAR.test(sql[i - 1] ?? ' ') && DOLLAR_TAG.test(sql.slice(i, i + 80))) {
      const open = DOLLAR_TAG.exec(sql.slice(i, i + 80))[0]
      const end = sql.indexOf(open, i + open.length)
      if (end < 0) unterminated(`dollar-quote ${open}`)
      bodies.push(stripSqlComments(sql.slice(i + open.length, end)))
      code += '$$ $$'
      i = end + open.length - 1
    } else if (ch === ';') {
      flush()
    } else {
      code += ch
    }
  }
  flush()
  return statements
}

// ── 2) อ่านชื่อฟังก์ชัน + signature ───────────────────────────────────────────────────
const skipWs = (s, i) => { while (i < s.length && /\s/.test(s[i])) i++; return i }

// identifier ไม่มี " → ตัวพิมพ์เล็ก (Postgres fold) · มี " → ตามที่เขียน
function readIdent(s, i) {
  if (s[i] === '"') {
    let j = i + 1
    let value = ''
    while (j < s.length) {
      if (s[j] === '"') {
        if (s[j + 1] === '"') { value += '"'; j += 2; continue }
        break
      }
      value += s[j++]
    }
    return { value, end: j + 1 }
  }
  const m = /^[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*/.exec(s.slice(i))
  return m ? { value: m[0].toLowerCase(), end: i + m[0].length } : null
}

// แยกด้วย , ที่ depth 0 (นอก "..." และนอกวงเล็บ)
function splitTop(text) {
  const parts = []
  let depth = 0
  let inQuote = false
  let cur = ''
  for (const ch of text) {
    if (ch === '"') inQuote = !inQuote
    if (!inQuote) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue }
    }
    cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

// อ่านรายการ [schema.]name[(args)] คั่นด้วย , คืน { refs, rest }
function parseRefs(s) {
  const refs = []
  let i = 0
  for (;;) {
    i = skipWs(s, i)
    const first = readIdent(s, i)
    if (!first) break
    let schema = null
    let name = first.value
    i = skipWs(s, first.end)
    if (s[i] === '.') {
      const second = readIdent(s, skipWs(s, i + 1))
      if (!second) break
      schema = first.value
      name = second.value
      i = skipWs(s, second.end)
    }
    let args = null
    if (s[i] === '(') {
      let depth = 0
      let inQuote = false
      let j = i
      for (; j < s.length; j++) {
        if (s[j] === '"') inQuote = !inQuote
        if (inQuote) continue
        if (s[j] === '(') depth++
        else if (s[j] === ')' && --depth === 0) break
      }
      args = splitTop(s.slice(i + 1, j))
      i = skipWs(s, j + 1)
    }
    refs.push({ schema, name, args })
    if (s[i] === ',') { i++; continue }
    break
  }
  return { refs, rest: s.slice(i).trim() }
}

// ชื่อชนิดแบบที่ Postgres ใช้เทียบ signature
const TYPE_ALIASES = new Map([
  ['int', 'integer'], ['int4', 'integer'], ['integer', 'integer'],
  ['int2', 'smallint'], ['smallint', 'smallint'],
  ['int8', 'bigint'], ['bigint', 'bigint'],
  ['bool', 'boolean'], ['boolean', 'boolean'],
  ['varchar', 'character varying'], ['character varying', 'character varying'], ['char varying', 'character varying'],
  ['char', 'character'], ['character', 'character'], ['bpchar', 'character'],
  ['float8', 'double precision'], ['double precision', 'double precision'], ['float', 'double precision'],
  ['float4', 'real'], ['real', 'real'],
  ['decimal', 'numeric'], ['numeric', 'numeric'],
  ['timestamptz', 'timestamp with time zone'], ['timestamp with time zone', 'timestamp with time zone'],
  ['timestamp', 'timestamp without time zone'], ['timestamp without time zone', 'timestamp without time zone'],
  ['timetz', 'time with time zone'], ['time with time zone', 'time with time zone'],
  ['time', 'time without time zone'], ['time without time zone', 'time without time zone'],
])
// ชนิดหลายคำ — ใช้แยก "ชื่อพารามิเตอร์ + ชนิด" ออกจาก "ชนิดล้วน"
const MULTIWORD_TYPE = /^(?:character varying|char varying|double precision|bit varying|national character(?: varying)?|(?:timestamp|time) (?:with|without) time zone)(?:\[\])*$/

function normalizeType(raw) {
  let t = raw.replace(/"/g, '').trim().toLowerCase().replace(/^(?:public|pg_catalog)\./, '')
  let dims = 0
  t = t.replace(/\[\s*\d*\s*\]/g, () => { dims++; return '' })
  t = t.replace(/\s+array\b/g, () => { dims++; return '' })
  t = t.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() // varchar(20) / numeric(10,2) / timestamp(3)
  return (TYPE_ALIASES.get(t) ?? t) + '[]'.repeat(dims)
}

// คืนชนิดของพารามิเตอร์ 1 ตัว (null = OUT ไม่นับใน signature)
function argType(arg) {
  let a = arg.split(/\s+default\b|\s*=/i)[0].trim()
  const mode = /^(in|out|inout|variadic)\s+/i.exec(a)
  if (mode) {
    if (mode[1].toLowerCase() === 'out') return null
    a = a.slice(mode[0].length)
  }
  a = a.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[\s*\d*\s*\]/g, '[]').replace(/\s+array\b/gi, '[]').trim()
  const tokens = a.split(/\s+/)
  const whole = a.toLowerCase().replace(/"/g, '')
  const typeText = tokens.length === 1 || MULTIWORD_TYPE.test(whole) ? a : tokens.slice(1).join(' ')
  return normalizeType(typeText)
}

const sigKey = (args) => args.map(argType).filter((type) => type !== null).join(',')
const isTarget = (ref) => ref.name === FN && (ref.schema === null || ref.schema === 'public')

// ── 3) จำลองสิทธิ์ ─────────────────────────────────────────────────────────────────
const GRANTEE = new Map([['public', 'PUBLIC'], ['anon', 'anon'], ['authenticated', 'authenticated']])

function newEntry(file) {
  const entry = { exists: true, files: new Set([file]), last: {} }
  for (const holder of HOLDERS) { entry[holder] = true; entry.last[holder] = file }
  return entry
}

function setHolders(entry, holders, value, file) {
  entry.files.add(file)
  for (const holder of holders) {
    if (entry[holder] !== value) { entry[holder] = value; entry.last[holder] = file }
  }
}

function parseGrantees(text, file) {
  const list = text
    .replace(/\s+with\s+grant\s+option\b/i, '')
    .replace(/\s+granted\s+by\s+.+$/i, '')
    .replace(/\s+(?:cascade|restrict)\s*$/i, '')
  const holders = []
  for (const item of splitTop(list)) {
    const ident = readIdent(item.replace(/^group\s+/i, '').trim(), 0)
    if (!ident) assert.fail(`${file}: อ่านรายชื่อผู้รับสิทธิ์ไม่ได้ "${text}" — ${NEED_REWRITE}`)
    const holder = GRANTEE.get(ident.value)
    if (holder) holders.push(holder)
  }
  return holders
}

// replay: ไล่ migration ตามลำดับที่ให้ แล้วคืนสถานะของทุก signature ของ rate_complaint
function replay(files) {
  const sigs = new Map()
  let matched = 0
  const touchedFiles = new Set()

  const touch = (file) => { matched++; touchedFiles.add(file) }
  const existing = () => [...sigs.entries()].filter(([, entry]) => entry.exists)
  const need = (cond, file, code, why) => { if (!cond) assert.fail(`${file}: ${why}\n  คำสั่ง: ${code.slice(0, 200)}\n  ${NEED_REWRITE}`) }

  const targets = (ref, file, code, { mustExist }) => {
    if (ref.args === null) return existing()
    const key = sigKey(ref.args)
    const entry = sigs.get(key)
    if (mustExist) need(entry?.exists, file, code, `GRANT/REVOKE บน ${FN}(${key}) ที่ยังไม่มีในประวัติ migration (หา CREATE ไม่เจอ หรือเรียงไฟล์ผิด)`)
    return entry?.exists ? [[key, entry]] : []
  }

  const grantRevoke = (st, file) => {
    const code = st.code
    const head = /^(grant|revoke)\s+(grant\s+option\s+for\s+)?(execute|all(?:\s+privileges)?)\s+on\s+(.*)$/i.exec(code)
    const mentions = new RegExp(String.raw`(?<![\w$.])(?:"?public"?\s*\.\s*)?"?${FN}"?(?![\w$])`, 'i').test(code)
    if (!head) {
      need(!mentions, file, code, `คำสั่ง ${code.split(' ')[0].toUpperCase()} ที่เอ่ยถึง ${FN} แต่อ่านรูปแบบไม่ได้`)
      return
    }
    const verb = head[1].toLowerCase()
    const grantOptionOnly = Boolean(head[2])
    const rest = head[4]
    const prep = verb === 'grant' ? 'to' : 'from'
    const apply = (entry, holders) => {
      if (grantOptionOnly) return // ถอนเฉพาะสิทธิ์ส่งต่อ ไม่แตะ EXECUTE
      setHolders(entry, holders, verb === 'grant', file)
    }

    const all = /^all\s+(?:functions|routines)\s+in\s+schema\s+(.+?)\s+(to|from)\s+(.+)$/i.exec(rest)
    if (all) {
      need(all[2].toLowerCase() === prep, file, code, 'คำบุพบท TO/FROM ไม่ตรงกับ GRANT/REVOKE')
      const schemas = splitTop(all[1]).map((item) => readIdent(item.trim(), 0)?.value)
      if (!schemas.includes('public')) return
      const holders = parseGrantees(all[3], file)
      const hit = existing()
      for (const [, entry] of hit) apply(entry, holders)
      if (hit.length) touch(file)
      return
    }

    const fn = /^(?:function|routine)\s+(.*)$/i.exec(rest)
    if (!fn) {
      need(!mentions, file, code, `GRANT/REVOKE ที่เอ่ยถึง ${FN} แต่ไม่ใช่ ON FUNCTION/ROUTINE`)
      return
    }
    const { refs, rest: tail } = parseRefs(fn[1])
    const to = new RegExp(String.raw`^${prep}\s+(.+)$`, 'i').exec(tail)
    need(to, file, code, `อ่านท้ายคำสั่ง (${prep.toUpperCase()} ...) ไม่ได้`)
    const holders = parseGrantees(to[1], file)
    for (const ref of refs) {
      if (!isTarget(ref)) continue
      touch(file)
      for (const [, entry] of targets(ref, file, code, { mustExist: true })) apply(entry, holders)
    }
  }

  const createFn = (st, file) => {
    const m = /^create\s+(or\s+replace\s+)?function\s+(.*)$/i.exec(st.code)
    const { refs } = parseRefs(m[2])
    const ref = refs[0]
    if (!ref || !isTarget(ref)) return
    need(ref.args !== null, file, st.code, `CREATE FUNCTION ${FN} ไม่มีวงเล็บพารามิเตอร์`)
    touch(file)
    const key = sigKey(ref.args)
    const entry = sigs.get(key)
    if (m[1] && entry?.exists) { entry.files.add(file); return } // OR REPLACE ของเดิม: ACL คงเดิม
    sigs.set(key, newEntry(file)) // ใหม่ (หรือสร้างซ้ำหลัง DROP): ได้สิทธิ์ทุกหัวตามค่าตั้งต้น
  }

  const dropFn = (st, file) => {
    const m = /^drop\s+(?:function|routine)\s+(?:if\s+exists\s+)?(.*)$/i.exec(st.code)
    const { refs, rest } = parseRefs(m[1])
    need(/^(?:cascade|restrict)?$/i.test(rest), file, st.code, 'อ่านท้ายคำสั่ง DROP FUNCTION ไม่ได้')
    for (const ref of refs) {
      if (!isTarget(ref)) continue
      touch(file)
      const hit = ref.args === null ? existing() : targets(ref, file, st.code, { mustExist: false })
      for (const [, entry] of hit) {
        entry.exists = false // ล้าง ACL ไปกับตัวฟังก์ชัน
        entry.files.add(file)
        for (const holder of HOLDERS) { entry[holder] = false; entry.last[holder] = file }
      }
    }
  }

  const alterFn = (st, file) => {
    const m = /^alter\s+(?:function|routine)\s+(.*)$/i.exec(st.code)
    const { refs, rest } = parseRefs(m[1])
    const ref = refs[0]
    if (!ref) return
    const rename = /^rename\s+to\s+(.+)$/i.exec(rest)
    const setSchema = /^set\s+schema\s+(.+)$/i.exec(rest)
    const renamedTo = rename ? readIdent(rename[1].trim(), 0)?.value : null
    const movedTo = setSchema ? readIdent(setSchema[1].trim(), 0)?.value : null
    // ชื่ออื่น/schema อื่น ถูกเปลี่ยนมาเป็น rate_complaint ใน public — ไม่รู้ ACL เดิม
    need(!(renamedTo === FN && !isTarget(ref)), file, st.code, `ALTER FUNCTION ... RENAME TO ${FN} (ไม่รู้สิทธิ์เดิม)`)
    need(!(ref.name === FN && ref.schema !== null && ref.schema !== 'public' && movedTo === 'public'), file, st.code, `ALTER FUNCTION ... SET SCHEMA public ของ ${FN}`)
    if (!isTarget(ref)) return
    touch(file)
    const gone = (rename && renamedTo !== FN) || (setSchema && movedTo !== 'public')
    const hit = ref.args === null ? existing() : targets(ref, file, st.code, { mustExist: false })
    for (const [, entry] of hit) {
      entry.files.add(file)
      if (gone) {
        entry.exists = false // ย้ายชื่อ/schema ออกไปแล้ว ชื่อ public.rate_complaint ไม่มีตัวนี้อีก
        for (const holder of HOLDERS) { entry[holder] = false; entry.last[holder] = file }
      }
    }
  }

  const doBlock = (st, file) => {
    const body = st.bodies.join('\n')
    const touchesFn = new RegExp(String.raw`(?<![\w$])${FN}(?![\w$])`, 'i').test(body)
    const changesAcl = /\b(?:grant|revoke)\b|\bdrop\s+(?:function|routine)\b|\bcreate\s+(?:or\s+replace\s+)?function\b|\balter\s+(?:function|routine)\b/i.test(body)
    if (touchesFn && changesAcl) {
      assert.fail(`${file}: dynamic SQL แตะ ${FN} เทสต์ตามไม่ได้ ให้เขียนเป็นคำสั่งตรง (GRANT/REVOKE/DROP/CREATE นอก DO block)`)
    }
  }

  for (const { file, sql } of files) {
    for (const st of splitStatements(sql, file)) {
      if (/^do\b/i.test(st.code)) doBlock(st, file)
      else if (/^(?:grant|revoke)\b/i.test(st.code)) grantRevoke(st, file)
      else if (/^create\s+(?:or\s+replace\s+)?function\b/i.test(st.code)) createFn(st, file)
      else if (/^drop\s+(?:function|routine)\b/i.test(st.code)) dropFn(st, file)
      else if (/^alter\s+(?:function|routine)\b/i.test(st.code)) alterFn(st, file)
    }
  }
  return { sigs, matched, files: touchedFiles }
}

// ── 4) ตัดสิน ───────────────────────────────────────────────────────────────────────
// คืนรายการสิ่งที่ผิด { code, key, file? } (ว่าง = ผ่าน)
function violations({ sigs }) {
  const found = []
  for (const [key, entry] of sigs) {
    if (!entry.exists) continue
    if (entry.anon) found.push({ code: 'anon', key, file: entry.last.anon })
    if (entry.PUBLIC) found.push({ code: 'public', key, file: entry.last.PUBLIC })
  }
  const main = sigs.get(MAIN_SIG)
  if (!main?.exists) found.push({ code: 'missing', key: MAIN_SIG })
  else if (!main.authenticated && !main.PUBLIC) found.push({ code: 'auth-lost', key: MAIN_SIG, file: main.last.authenticated })
  return found
}

function explain(found) {
  return found.flatMap(({ code, key, file }) => {
    const sig = key.split(',').join(', ')
    const fix = [
      `  วิธีแก้: ท้ายไฟล์ migration ที่สร้าง/เปลี่ยน ${FN}(${sig}) ต้องมีทั้งสองบรรทัด`,
      `    REVOKE ALL ON FUNCTION public.${FN}(${sig}) FROM public;`,
      `    REVOKE EXECUTE ON FUNCTION public.${FN}(${sig}) FROM anon;`,
      '  (DROP + CREATE / overload ใหม่ ได้ EXECUTE คืนมาทั้งจาก default privileges ของ Supabase และจาก PUBLIC)',
    ]
    if (code === 'anon') return [`${MIGRATIONS}/${file}`, `${FN}(${sig}): anon ยังได้สิทธิ์ EXECUTE โดยตรง (ไฟล์ล่าสุดที่ทำให้สิทธิ์นี้อยู่/กลับมา)`, ...fix]
    if (code === 'public') return [`${MIGRATIONS}/${file}`, `${FN}(${sig}): PUBLIC ยังได้สิทธิ์ EXECUTE — anon เป็นสมาชิก PUBLIC จึงเรียกได้เท่ากับ anon`, ...fix]
    if (code === 'missing') return [`ไม่เหลือ ${FN}(${sig}) ในประวัติ migration — หน้าเว็บเรียกตัวนี้ ถ้าย้าย/เปลี่ยนชื่อ ต้องย้ายเทสต์ตาม`]
    return [`${MIGRATIONS}/${file}`, `${FN}(${sig}): authenticated เสียสิทธิ์ EXECUTE — ผู้ยื่นที่ล็อกอินจะประเมินคำร้องไม่ได้`, `  วิธีแก้: GRANT EXECUTE ON FUNCTION public.${FN}(${sig}) TO authenticated;`]
  })
}

const run = (...sqls) => replay(sqls.map((sql, i) => ({ file: `specimen-${i + 1}.sql`, sql })))
const codes = (result) => violations(result).map(({ code }) => code)

// ── 5) ตัวตรวจต้องล้มได้จริง ──────────────────────────────────────────────────────────
// เทสต์ที่ผ่านเสมอคือเทสต์ที่ไม่มีอยู่จริง — ป้อนรูปแบบที่ผิดให้ดูก่อนว่าจับได้
const CREATE = `create function public.rate_complaint(p_complaint_id uuid, p_rating int, p_comment text default null)
  returns jsonb language plpgsql security definer as $$ begin return null; end; $$;`
const SAFE = `${CREATE}
  revoke all on function public.rate_complaint(uuid, int, text) from public;
  grant execute on function public.rate_complaint(uuid, int, text) to anon, authenticated;
  revoke execute on function public.rate_complaint(uuid, int, text) from anon;`
const SIG_ARGS = 'public.rate_complaint(uuid, int, text)'

// 5.1 ชุดถูก
{
  const ok = run(SAFE)
  assert.deepEqual(codes(ok), [], 'ชุดที่ถูกต้องต้องผ่าน')
  const entry = ok.sigs.get(MAIN_SIG)
  assert.deepEqual([entry.PUBLIC, entry.anon, entry.authenticated], [false, false, true])
}

// 5.2 DROP แล้ว CREATE ใหม่ไม่ revoke → anon กลับมา (และ PUBLIC)
{
  const bad = run(SAFE, `drop function ${SIG_ARGS}; ${CREATE}`)
  assert.deepEqual(codes(bad).sort(), ['anon', 'public'])
  assert.equal(violations(bad)[0].file, 'specimen-2.sql', 'ต้องชี้ไฟล์ที่ทำให้สิทธิ์กลับมา')
}

// 5.3 DROP+CREATE แล้ว revoke จาก anon อย่างเดียว → PUBLIC ยังเปิด (ช่องที่ migration #682 เสี่ยงที่สุด)
assert.deepEqual(
  codes(run(SAFE, `drop function ${SIG_ARGS}; ${CREATE} revoke execute on function ${SIG_ARGS} from anon;`)),
  ['public'],
)
// DROP โดยไม่ระบุ arg (ลบทุก overload) + IF EXISTS + CASCADE ก็ต้องล้าง state
assert.deepEqual(codes(run(SAFE, `drop function if exists public.rate_complaint cascade; ${CREATE}`)).sort(), ['anon', 'public'])

// 5.4 GRANT ให้ anon ท้ายสุด
assert.deepEqual(codes(run(SAFE, `grant execute on function ${SIG_ARGS} to anon, authenticated;`)), ['anon'])

// 5.5 overload ใหม่ไม่ revoke
{
  const bad = run(SAFE, `create function public.rate_complaint(p_id uuid, p_rating int, p_comment text, p_x boolean) returns jsonb language sql as $$ select null::jsonb $$;`)
  assert.deepEqual(violations(bad).map(({ code, key }) => `${code}:${key}`).sort(), ['anon:uuid,integer,text,boolean', 'public:uuid,integer,text,boolean'])
}

// 5.6 GRANT ON ALL FUNCTIONS IN SCHEMA public (และ ROUTINES) · schema อื่นไม่นับ
assert.deepEqual(codes(run(SAFE, 'grant execute on all functions in schema public to anon;')), ['anon'])
assert.deepEqual(codes(run(SAFE, 'GRANT ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA "public", extensions TO anon;')), ['anon'])
assert.deepEqual(codes(run(SAFE, 'grant execute on all functions in schema extensions to anon;')), [])
// revoke แบบกวาดทั้ง schema ต้องถอนได้จริง
assert.deepEqual(codes(run(CREATE, 'revoke all on all functions in schema public from public, anon; grant execute on function public.rate_complaint(uuid,int,text) to authenticated;')), [])

// 5.7 authenticated เสียสิทธิ์
assert.deepEqual(codes(run(SAFE, `revoke execute on function ${SIG_ARGS} from authenticated; revoke all on function ${SIG_ARGS} from public;`)), ['auth-lost'])
// ถอนจาก authenticated อย่างเดียวแต่ PUBLIC ยังเปิด: authenticated ยังเรียกได้ผ่าน PUBLIC (แต่ PUBLIC เปิด = anon เรียกได้ จึงล้มเรื่อง anon)
assert.deepEqual(codes(run(CREATE, `revoke execute on function ${SIG_ARGS} from authenticated, anon;`)), ['public'])
// ไม่มีฟังก์ชันเลย (ย้ายชื่อ/ลบ) → ล้ม ไม่ใช่ผ่านลวง
assert.deepEqual(codes(run(SAFE, `drop function ${SIG_ARGS};`)), ['missing'])
assert.deepEqual(codes(run(SAFE, `alter function ${SIG_ARGS} rename to rate_complaint_old;`)), ['missing'])
assert.deepEqual(codes(run('select 1;')), ['missing'], 'parser หาอะไรไม่เจอเลยต้องไม่ผ่านลวง')
// GRANT OPTION FOR ไม่ได้ถอน EXECUTE
assert.deepEqual(codes(run(CREATE, `revoke execute on function ${SIG_ARGS} from public, anon; revoke grant option for execute on function ${SIG_ARGS} from authenticated;`)), [])

// 5.8 คำสั่งที่อยู่ในคอมเมนต์/สตริง ไม่นับ
assert.deepEqual(codes(run(`${SAFE}
  -- grant execute on function ${SIG_ARGS} to anon;
  /* grant execute on function ${SIG_ARGS} to anon;
     /* ซ้อน */ grant execute on function ${SIG_ARGS} to public; */
  select 'grant execute on function ${SIG_ARGS} to anon;';
  comment on function ${SIG_ARGS} is 'อย่า grant ... to anon; -- ห้าม';
  select E'it\\'s; grant execute on function ${SIG_ARGS} to anon;';`)), [])
// -- ที่อยู่ในสตริงไม่ใช่คอมเมนต์ คำสั่งถัดไปต้องยังถูกนับ
assert.deepEqual(codes(run(SAFE, `select '--'; grant execute on function ${SIG_ARGS} to anon;`)), ['anon'])
// ไม่มี ; คั่นท้ายไฟล์ก็ต้องนับคำสั่งสุดท้าย
assert.deepEqual(codes(run(SAFE, `grant execute on function ${SIG_ARGS} to anon`)), ['anon'])

// 5.9 ฟังก์ชันชื่อขึ้นต้นเหมือนกันต้องไม่ถูกนับ
assert.deepEqual(codes(run(`${SAFE}
  grant execute on function public.rate_complaint_on_behalf(uuid, int, text) to anon;
  grant execute on function public.rate_complaint_by_track_token(text, int, text) to anon, public;
  grant execute on all functions in schema extensions to anon;
  create function public.rate_complaint_on_behalf(uuid, int, text) returns jsonb language sql as $$ select null::jsonb $$;
  drop function public.rate_complaint_on_behalf(uuid, int, text);
  grant execute on function other_schema.rate_complaint(uuid, int, text) to anon;`)), [])

// 5.10 ; และ grant ในเนื้อ dollar-quote ไม่ทำให้แยกคำสั่งผิด
assert.deepEqual(codes(run(`
  create function public.rate_complaint(p_complaint_id uuid, p_rating int, p_comment text default null)
  returns jsonb language plpgsql as $function$
  begin
    perform 1; -- ; -- grant execute on function ${SIG_ARGS} to anon;
    execute 'grant execute on function ${SIG_ARGS} to anon';
    return null;
  end;
  $function$;
  revoke all on function ${SIG_ARGS} from public;
  revoke execute on function ${SIG_ARGS} from anon;
  create function public.helper() returns void language plpgsql as $a$ begin perform $b$ ; grant execute on function ${SIG_ARGS} to anon; $b$; end; $a$;
  create function public.helper2() returns void language plpgsql as $$ begin perform 1; grant execute on function ${SIG_ARGS} to public; end; $$;`)), [])

// 5.11 ชนิดเขียนต่างกัน = signature เดียวกัน · ชื่อพารามิเตอร์/DEFAULT/IN ไม่ปนในคีย์
{
  const mixed = run(
    `CREATE OR REPLACE FUNCTION "public"."rate_complaint"(IN p_a uuid, "p_b" INT4, p_c text DEFAULT 'x,y)'::text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
     REVOKE ALL ON FUNCTION "public"."rate_complaint"(uuid, integer, text) FROM PUBLIC;
     GRANT EXECUTE ON FUNCTION RATE_COMPLAINT(UUID,INT,TEXT) TO authenticated;`,
  )
  assert.deepEqual([...mixed.sigs.keys()], [MAIN_SIG])
  // ถอน PUBLIC อย่างเดียว: anon ยังได้สิทธิ์จาก default privileges ของฟังก์ชันใหม่ → ต้องล้ม
  assert.deepEqual(codes(mixed), ['anon'], 'ถอน PUBLIC แล้วแต่ไม่ revoke anon ต้องล้ม (default ตั้งต้น anon=true)')
}
assert.deepEqual(codes(run(`${CREATE} revoke all on function public.rate_complaint(uuid,int4,text) from public, anon;
  grant execute on routine rate_complaint(uuid, integer, text) to authenticated;`)), [])
for (const [raw, key] of [
  [['uuid', 'int', 'text'], 'uuid,integer,text'],
  [['p uuid', 'q int4', 'r text default null'], 'uuid,integer,text'],
  [['a varchar(20)', 'character varying', 'b character varying(10)'], 'character varying,character varying,character varying'],
  [['a timestamptz', 'timestamp with time zone', 'b timestamp with time zone default now()', 'c timestamp(3) without time zone'],
    'timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp without time zone'],
  [['double precision', 'x double precision', 'y float8', 'z numeric(10, 2)', 'bool', 'w boolean'], 'double precision,double precision,double precision,numeric,boolean,boolean'],
  [['a text[]', 'text []', 'b int array', 'c smallint', 'd int8'], 'text[],text[],integer[],smallint,bigint'],
  [['out o text', 'inout io int', 'variadic v text[]', 'in i uuid'], 'integer,text[],uuid'],
  [[], ''],
]) assert.equal(sigKey(raw), key, `normalize ${JSON.stringify(raw)}`)

// 5.12 dynamic SQL ใน DO block ที่แตะ rate_complaint → ล้มด้วยข้อความ dynamic
assert.throws(
  () => run(SAFE, `do $$ begin execute format('grant execute on function public.rate_complaint(uuid,int,text) to %I', 'anon'); end $$;`),
  /dynamic SQL แตะ rate_complaint/,
)
assert.throws(() => run(SAFE, `do $x$ begin revoke all on function public.rate_complaint(uuid,int,text) from public; end $x$;`), /dynamic SQL แตะ rate_complaint/)
// DO block ที่ไม่ใช่การแก้สิทธิ์ (ด่านยืนยันแบบใน 20261114100000) ต้องไม่ถูกนับ · คอมเมนต์ใน DO ไม่นับ
assert.deepEqual(codes(run(`${SAFE}
  do $$ begin
    -- grant revoke drop function create function rate_complaint
    if has_function_privilege('anon', 'public.rate_complaint(uuid,int,text)', 'EXECUTE') then
      raise exception 'anon ยังเรียก rate_complaint ได้';
    end if;
  end $$;`)), [])
// DO block ที่ grant อย่างอื่นที่ไม่เกี่ยวกับ rate_complaint ผ่านได้
assert.deepEqual(codes(run(SAFE, `do $$ begin grant execute on function public.other_fn() to anon; end $$;`)), [])

// รูปแบบที่เทสต์ไม่รู้จัก ต้องล้ม ไม่ใช่เมินเงียบๆ
assert.throws(() => run(SAFE, 'alter function other_fn() rename to rate_complaint;'), /รูปแบบใหม่/)
assert.throws(() => run(SAFE, `grant execute on function public.rate_complaint(uuid, int, bigint) to anon;`), /ยังไม่มีในประวัติ/)
assert.throws(() => run(`select 'ไม่ปิด`), /ไม่มีตัวปิด/)
assert.deepEqual(codes(run(SAFE, `alter function ${SIG_ARGS} owner to postgres; alter function ${SIG_ARGS} set search_path = public;`)), [])
assert.deepEqual(codes(run(SAFE, `alter function ${SIG_ARGS} set schema other_schema; alter function other_schema.rate_complaint(uuid,int,text) rename to x;`)), ['missing'])

// ── 6) migration จริงในรีโป ─────────────────────────────────────────────────────────────
const names = (await readdir(path.join(root, MIGRATIONS))).filter((name) => name.endsWith('.sql')).sort()
const files = []
for (const file of names) {
  files.push({ file, sql: (await readFile(path.join(root, MIGRATIONS, file), 'utf8')).replace(/\r\n/g, '\n') })
}
const result = replay(files)
const found = violations(result)
assert.ok(found.length === 0, [
  `rate_complaint() ใน migration ของรีโปมีสิทธิ์ผิด ${found.length} จุด (ห้าม apply ขึ้นฐานจริง):`,
  '',
  ...explain(found),
].join('\n'))

// กันผ่านลวง: parser ต้องเห็นคำสั่งที่เรารู้ว่ามีอยู่จริงใน 2 ไฟล์นี้
const main = result.sigs.get(MAIN_SIG)
for (const required of ['20260830150000_rate_complaint_rpc.sql', '20261114100000_close_anon_ref_rating.sql']) {
  assert.ok(main?.files.has(required), `parser ไม่เห็นคำสั่งของ ${FN}(${MAIN_SIG}) ใน ${required} — เทสต์อ่านรูปแบบไม่ได้ หรือไฟล์ถูกย้าย/ลบ`)
}
assert.deepEqual([main.PUBLIC, main.anon, main.authenticated], [false, false, true], 'state สุดท้ายต้องเป็น anon=f public=f authenticated=t')

for (const [key, entry] of result.sigs) {
  if (!entry.exists) continue
  const flag = (value) => (value ? 't' : 'f')
  console.log(`PASS ${FN}(${key}): anon=${flag(entry.anon)} public=${flag(entry.PUBLIC)} authenticated=${flag(entry.authenticated)} (จาก ${result.matched} คำสั่งใน ${result.files.size} ไฟล์)`)
}
