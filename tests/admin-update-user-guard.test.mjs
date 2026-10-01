// กันบั๊ก "บันทึกบัญชีประชาชนแล้วหลุดสังกัด อปท." ไม่ให้กลับมาเป็นรอบที่ 3
//
// admin_update_user() ต้องคง municipality_id ของ citizen ไว้เสมอ ถ้าตั้งเป็น NULL บัญชีจะหายจากหน้า
// "จัดการผู้ใช้และการแต่งตั้ง" ทันทีที่กดบันทึก และแอดมินของ อปท. จะบันทึกบัญชีประชาชนไม่ได้เลย
// (ชนด่าน cannot move user to another municipality)
//
// ทำไมต้องมี: บั๊กนี้แก้ไปแล้ว 2 รอบ
//   - 20260829130000 แก้ครั้งแรก และขึ้นฐานจริงแล้ว
//   - 20260909140100 (#108 เพิ่ม asset_role) CREATE OR REPLACE ทั้งฟังก์ชันจากเนื้อรุ่นก่อนหน้านั้น
//     บั๊กกลับมาเงียบๆ 3 สัปดาห์ จนประชาชนทุ่งแค้วหลุดสังกัด 2 บัญชีเมื่อ 2026-10-01 (#359 แก้ซ้ำ)
// CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน (docs/ai/NOTES.md ข้อ 5) และฟังก์ชันนี้ถูกแตะบ่อย
// (fleet_role, asset_role) ใครตั้งต้นจากไฟล์เก่าอีก บั๊กจะกลับมาอีก
//
// เทสต์นี้อ่านเฉพาะไฟล์ในรีโป ไม่ต่อฐานข้อมูล ไม่ใช้ dependency จึงรันได้ทุกเครื่อง
// ⚠️ เห็นเฉพาะ migration ที่อยู่ในรีโป ถ้ามีคนรัน SQL ตรงบนฐานโดยไม่มีไฟล์ เทสต์นี้จับไม่ได้
//
// รัน: npm run test:admin-update-user
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = async (rel) => (await readFile(path.join(root, rel), 'utf8')).replace(/\r\n/g, '\n')

const FN = 'admin_update_user'
const MIGRATIONS = 'supabase/migrations'

// นิยามรุ่นเก่าที่ apply ไปแล้ว แก้ย้อนหลังไม่ได้ จึงยกเว้นให้เฉพาะรายชื่อนี้ (4 ใน 5 ไฟล์มีบั๊ก)
// ไฟล์อื่นทุกไฟล์ที่นิยามฟังก์ชันนี้ต้องผ่าน ไม่ว่าจะตั้งเลขเวอร์ชันย้อนหลังหรือไม่
// ห้ามเพิ่มชื่อไฟล์ใหม่เข้ารายชื่อนี้เพื่อให้เทสต์ผ่าน
const HISTORICAL = new Set([
  '20260730180100_158_harden_user_role_management.sql',
  '20260816120000_require_department_for_officer_role.sql',
  '20260819130000_admin_update_user_fleet_role.sql',
  '20260829130000_keep_citizen_municipality_on_admin_update.sql',
  '20260909140100_asset_role_admin_update_user.sql',
])

// บล็อกที่ต้องอยู่ในฟังก์ชันเสมอ — ใช้ทั้งเป็นตัวอย่างที่ถูกในเทสต์ และแสดงให้คนแก้เห็นตอนเทสต์ล้ม
const REQUIRED_BLOCK = `  IF v_new.role = 'superadmin' THEN
    v_new.municipality_id := NULL;
    v_new.department_id := NULL;
    v_new.position_id := NULL;
    v_new.is_dept_head := false;
  ELSIF v_new.role = 'citizen' THEN
    v_new.municipality_id := COALESCE(v_new.municipality_id, v_old.municipality_id, v_caller_muni);
    v_new.department_id := NULL;
    v_new.position_id := NULL;
    v_new.is_dept_head := false;
  ELSE
    v_new.municipality_id := COALESCE(v_new.municipality_id, v_old.municipality_id, v_caller_muni);
  END IF;`

// ตัดคอมเมนต์ออกก่อนตรวจ — คอมเมนต์ในไฟล์แก้บั๊กเองก็เอ่ยถึงโค้ดที่ผิด (`municipality_id := NULL`)
function stripSqlComments(sql) {
  let out = ''
  for (let i = 0; i < sql.length; i++) {
    const two = sql.slice(i, i + 2)
    if (sql[i] === "'") {
      // สตริง '...' คัดทั้งก้อน ('' คือ ' ที่ escape) ไม่ให้ -- ในข้อความถูกตัดเป็นคอมเมนต์
      let j = i + 1
      while (j < sql.length && (sql[j] !== "'" || sql[j + 1] === "'")) j += sql[j] === "'" ? 2 : 1
      out += sql.slice(i, j + 1)
      i = j
    } else if (two === '--') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += '\n'
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? sql.length : end + 1
      out += ' '
    } else {
      out += sql[i]
    }
  }
  return out
}

// รับทั้งรูปแบบที่เขียนเองและแบบที่ pg_dump/supabase db pull ใส่เครื่องหมายคำพูดครอบชื่อ
const DEFINES_FN = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?public"?\.)?"?${FN}"?\s*\(`, 'gi')

// เนื้อฟังก์ชัน (ตัดคอมเมนต์แล้ว) ของทุกจุดในไฟล์ที่นิยาม admin_update_user
function functionBodies(sql, file) {
  const code = stripSqlComments(sql)
  return [...code.matchAll(DEFINES_FN)].map((match) => {
    const open = /\bAS\s+(\$[A-Za-z0-9_]*\$)/.exec(code.slice(match.index))
    assert.ok(open, `${file}: หาจุดเริ่มเนื้อฟังก์ชัน ${FN} (AS $...$) ไม่เจอ — ต้องปรับเทสต์นี้ให้อ่านรูปแบบใหม่ได้`)
    const from = match.index + open.index + open[0].length
    const to = code.indexOf(open[1], from)
    assert.ok(to > from, `${file}: เนื้อฟังก์ชัน ${FN} ไม่มีตัวปิด ${open[1]}`)
    return code.slice(from, to)
  })
}

const squash = (text) => text.replace(/\s+/g, ' ').trim()

const SETS_MUNI_NULL = /\bmunicipality_id\s*:?=\s*NULL\b/gi
const KEEPS_CITIZEN_MUNI = /\b(?:IF|ELSE?IF) v_new\.role = 'citizen' THEN v_new\.municipality_id := COALESCE\(v_new\.municipality_id, v_old\.municipality_id, v_caller_muni\);/i
// กิ่ง IF/ELSIF หนึ่งกิ่ง: [1] เงื่อนไข [2] เนื้อจนถึง ELSIF/ELSE/END IF ตัวแรก
// IF ที่ซ้อนอยู่ข้างในจะตัดเนื้อสั้นลง ผลคือเทสต์ล้ม (ไม่ใช่ผ่านลวง) ให้มาปรับตรงนี้
const BRANCH = /(?:(?<!\bEND )\bIF\b|\bELSE?IF\b)((?:(?!\bTHEN\b)[\s\S])*)\bTHEN\b((?:(?!\b(?:ELSE?IF|ELSE|END IF)\b)[\s\S])*)/gi

// คืนรายการสิ่งที่ผิดในเนื้อฟังก์ชัน (ว่าง = ผ่าน)
function problems(body) {
  const code = squash(body)
  const found = []
  // คำสั่ง SQL พิมพ์เล็กหรือใหญ่ก็ได้ แต่ค่า role ในสตริงต้องเป็น 'citizen' ตัวเล็กตรงตัว
  if (!code.match(KEEPS_CITIZEN_MUNI)?.[0].includes("'citizen'")) {
    found.push("ไม่มีกิ่ง `ELSIF v_new.role = 'citizen'` ที่คง municipality_id เดิมไว้ด้วย COALESCE")
  }
  // ที่เดียวที่ตั้ง NULL ได้คือกิ่ง superadmin (บัญชี cross-tenant โดยการออกแบบ)
  // นับแบบนี้จับได้ทั้ง `IN ('citizen', 'superadmin')` ของ #108 และแบบที่ปล่อยให้ citizen ตกไปกิ่ง ELSE
  const total = (code.match(SETS_MUNI_NULL) ?? []).length
  let inSuperadmin = 0
  for (const [, condition, block] of code.matchAll(BRANCH)) {
    if (squash(condition) === "v_new.role = 'superadmin'") inSuperadmin += (block.match(SETS_MUNI_NULL) ?? []).length
  }
  if (total !== inSuperadmin) {
    found.push(`ตั้ง municipality_id เป็น NULL นอกกิ่ง \`IF v_new.role = 'superadmin'\` ${total - inSuperadmin} จุด`)
  }
  return found
}

// ── 1) ตัวตรวจต้องล้มได้จริง ───────────────────────────────────────────────────────
// เทสต์ที่ผ่านเสมอคือเทสต์ที่ไม่มีอยู่จริง — ป้อนรูปแบบที่ผิดให้ดูก่อนว่าจับได้
const check = (specimen) => problems(stripSqlComments(specimen))

assert.deepEqual(check(REQUIRED_BLOCK), [], 'บล็อกที่ถูกต้องต้องผ่าน')
assert.deepEqual(
  check(REQUIRED_BLOCK.replace("'citizen' THEN", "'citizen' THEN -- ห้ามกลับไปเป็น v_new.municipality_id := NULL;")),
  [],
  'โค้ดที่ผิดซึ่งอยู่ในคอมเมนต์ต้องไม่ถูกนับ',
)

// รูปแบบของ #108: citizen ถูกรวมกับ superadmin
assert.equal(check(`
  IF v_new.role IN ('citizen', 'superadmin') THEN
    v_new.municipality_id := NULL;
    v_new.department_id := NULL;
  ELSE
    v_new.municipality_id := COALESCE(v_new.municipality_id, v_old.municipality_id, v_caller_muni);
  END IF;`).length, 2, 'ต้องจับรูปแบบของ #108 ได้ทั้ง 2 ข้อ')

// citizen ไม่ถูกเอ่ยถึงเลย แต่ตกไปกิ่ง ELSE ที่ตั้ง NULL
assert.equal(check(`
  IF v_new.role IN ('admin', 'officer', 'staff') THEN
    v_new.municipality_id := COALESCE(v_new.municipality_id, v_old.municipality_id, v_caller_muni);
  ELSE
    v_new.municipality_id := NULL;
  END IF;`).length, 2, 'ต้องจับแบบที่ citizen ตกไปกิ่ง ELSE ได้')

// ค่า role พิมพ์ใหญ่ไม่ตรงกับข้อมูลจริง กิ่งนี้จึงไม่มีวันทำงาน = ไม่ได้คง อปท. ให้ใครเลย
assert.equal(check(REQUIRED_BLOCK.replace("'citizen'", "'CITIZEN'")).length, 1, "'CITIZEN' พิมพ์ใหญ่ต้องไม่นับว่าผ่าน")
// คำสั่งพิมพ์เล็กทั้งบล็อกยังต้องผ่าน (ความหมายเดิม)
assert.deepEqual(
  check(REQUIRED_BLOCK.replace(/\b(?:IF|ELSIF|ELSE|END|THEN|COALESCE|NULL)\b/g, (word) => word.toLowerCase())),
  [],
  'คำสั่งพิมพ์เล็กต้องผ่าน',
)

// มีบล็อกที่ถูกแล้ว แต่มีโค้ดข้างล่างมาตั้ง NULL ทับอีกที (ตัวพิมพ์เล็ก + ใช้ = แทน :=)
assert.deepEqual(check(`${REQUIRED_BLOCK}
  if v_new.role = 'citizen' then
    v_new.municipality_id = null;
  end if;`), ["ตั้ง municipality_id เป็น NULL นอกกิ่ง `IF v_new.role = 'superadmin'` 1 จุด"])

// ── 2) migration ในรีโป ─────────────────────────────────────────────────────────────
const files = (await readdir(path.join(root, MIGRATIONS))).filter((name) => name.endsWith('.sql')).sort()
const definers = []
for (const file of files) {
  const sql = await read(`${MIGRATIONS}/${file}`)
  if (!sql.toLowerCase().includes(FN)) continue
  const bodies = functionBodies(sql, file)
  if (bodies.length) definers.push({ file, body: bodies.at(-1) })
}
assert.ok(definers.length > 0, `ไม่เจอ migration ที่นิยาม ${FN}() ใน ${MIGRATIONS} — ถ้าย้ายหรือเปลี่ยนชื่อฟังก์ชัน ต้องย้ายเทสต์นี้ตาม`)

// ตัวล่าสุดต้องผ่านเสมอ (แม้จะเป็นไฟล์ในรายชื่อเก่า เช่น ไฟล์แก้ถูกลบทิ้ง) + ทุกไฟล์ที่ไม่อยู่ในรายชื่อเก่า
const latest = definers.at(-1)
const mustPass = definers.filter((definer) => definer === latest || !HISTORICAL.has(definer.file))
const lastGood = [...definers].reverse().find((definer) => problems(definer.body).length === 0)
for (const { file, body } of mustPass) {
  const found = problems(body)
  assert.ok(found.length === 0, [
    `${MIGRATIONS}/${file}`,
    `${FN}() รุ่นนี้จะตัดสังกัด อปท. ของประชาชนทุกครั้งที่กดบันทึก (บั๊ก 2026-10-01 กลับมา):`,
    ...found.map((problem) => `  • ${problem}`),
    '',
    'วิธีแก้: CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน ต้องตั้งต้นจากเนื้อรุ่นล่าสุดเสมอ ไม่ใช่ไฟล์เก่า',
    lastGood
      ? `  ใช้เนื้อฟังก์ชันจาก ${MIGRATIONS}/${lastGood.file} เป็นฐาน แล้วเทียบกับ pg_get_functiondef ของฐานจริง`
      : '  ไม่เหลือ migration ไหนที่ถูกเลย ให้ดึง pg_get_functiondef ของฐานจริงมาเป็นฐาน',
    '  แล้วคงบล็อกนี้ไว้:',
    REQUIRED_BLOCK,
  ].join('\n'))
}

// ── 3) เทสต์นี้ต้องเฝ้าฟังก์ชันตัวที่หน้าเว็บเรียกจริง ────────────────────────────────────
// ถ้าย้ายไป RPC ชื่อใหม่ (เช่น admin_update_user_v2) ข้อ 2 จะยังผ่านทั้งที่ไม่ได้ตรวจตัวใหม่เลย
assert.match(
  await read('src/lib/adminUpdateUser.js'),
  new RegExp(String.raw`\.rpc\('${FN}',`),
  `src/lib/adminUpdateUser.js ไม่ได้เรียก RPC ${FN} แล้ว — ย้ายเทสต์นี้ไปเฝ้าฟังก์ชันตัวใหม่ด้วย`,
)

console.log(`admin-update-user-guard: ผ่านทุกข้อ (นิยามล่าสุด ${latest.file} · ตรวจ ${mustPass.length} จาก ${definers.length} ไฟล์ที่นิยามฟังก์ชัน)`)
