// แบบสำรวจความเห็นประชาชน — ตรรกะหน้าเว็บ + ตรวจให้หน้าเว็บกับฐานข้อมูลตรงกัน (ไม่ใช้เครือข่าย ไม่แตะข้อมูลจริง)
//   node tests/community-survey.test.mjs        (npm run test:community-survey)
// ฝั่งฐานข้อมูลตรวจแยกที่ tests/community-survey-db.test.mjs (ต้องใช้ PGlite) · หน้าจอจริงที่ tests/community-survey-browser.playwright.mjs
//
// สิ่งที่ต้องไม่พัง: (1) ตรวจฟอร์มก่อนส่งตรงกับที่ฐานข้อมูลตรวจ (2) ค่าคงที่/ลิสต์ role/ชื่อ RPC/พารามิเตอร์/รหัสผลลัพธ์ในหน้าเว็บ = ในฐานข้อมูล
// (3) หน้าเว็บไม่แตะตาราง survey_* ตรงๆ เลย (ผ่าน RPC เท่านั้น) (4) ป้าย "ไม่ใช่มติ" ขึ้นทุกหน้าที่แสดงคำถาม (5) หน้าตอบเปิดได้โดยไม่ล็อกอิน
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SURVEY_BUSY_MESSAGE, SURVEY_COMMENT_KEEP_DAYS, SURVEY_COMMENT_MAX, SURVEY_DAY_CHOICES, SURVEY_DEFAULT_DAYS, SURVEY_HOME_RECENT_DAYS,
  SURVEY_MANAGE_ERRORS, SURVEY_MAX_DAYS, SURVEY_MAX_OPEN, SURVEY_NOT_A_VOTE_NOTICE, SURVEY_OPTIONS_MAX, SURVEY_OPTIONS_MIN, SURVEY_OPTION_MAX,
  SURVEY_DELETE_ROLES, SURVEY_QUESTION_MAX, SURVEY_QUESTION_MIN, SURVEY_TEMPLATES, SURVEY_VOTE_ERRORS,
  formatSurveyDate, isSurveyBusy, isSurveyId, pickSurveyForHome, recallMyAnswer, rememberMyAnswer, surveyClosesAt, surveyDaysLeft,
  surveyDeleteWarning, surveyPath, surveyPercent, surveyShareText, surveyThanksText, validateSurveyDraft,
} from '../src/lib/survey.js'
import { OFFICIAL_ROLES } from '../src/lib/serviceAudience.js'
import { moduleForPath } from '../src/lib/staffModules.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = async rel => (await readFile(path.join(root, rel), 'utf8')).replace(/\r\n/g, '\n')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

const tablesSql = await read('supabase/migrations/20261020170000_community_survey_tables.sql')
const functionsSql = await read('supabase/migrations/20261020170100_community_survey_functions.sql')
// ลบแบบสำรวจ (20261021110000) แยกไฟล์ — sqlFunction() ค้นทั้งสองไฟล์
const deleteSql = await read('supabase/migrations/20261021110000_survey_delete.sql')
const allFunctionsSql = functionsSql + '\n' + deleteSql
const surveySources = {
  'src/lib/survey.js': await read('src/lib/survey.js'),
  'src/pages/SurveyPage.jsx': await read('src/pages/SurveyPage.jsx'),
  'src/pages/SurveysPage.jsx': await read('src/pages/SurveysPage.jsx'),
  'src/components/survey/SurveyHomeCard.jsx': await read('src/components/survey/SurveyHomeCard.jsx'),
  'src/components/survey/SurveyResultBars.jsx': await read('src/components/survey/SurveyResultBars.jsx'),
  'src/components/survey/SurveyShare.jsx': await read('src/components/survey/SurveyShare.jsx'),
  'src/components/survey/SurveyShell.jsx': await read('src/components/survey/SurveyShell.jsx'),
  'src/components/staff/SurveyManager.jsx': await read('src/components/staff/SurveyManager.jsx'),
}

// ฟังก์ชันหนึ่งตัวในไฟล์ SQL: คืนข้อความตั้งแต่ CREATE ถึง $$; (หรือถึงท้ายถ้ามีตัวเดียวสั้นๆ)
const sqlFunction = (name) => {
  const start = allFunctionsSql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`))
  assert.ok(start >= 0, `ไม่พบฟังก์ชัน ${name} ใน SQL`)
  const rest = allFunctionsSql.slice(start)
  const end = rest.search(/\n\$\$;/)
  assert.ok(end > 0, `หาที่ปิด $$; ของ ${name} ไม่เจอ`)
  return rest.slice(0, end)
}
// ชื่อพารามิเตอร์ของฟังก์ชัน SQL (ตามลำดับ)
const sqlParams = (name) => {
  const body = sqlFunction(name)
  const open = body.indexOf('(')
  const close = body.indexOf('\n)\nRETURNS') >= 0 ? body.indexOf('\n)\nRETURNS') : body.indexOf(')\nRETURNS')
  const list = body.slice(open + 1, close)
  return list.split(',').map(p => p.trim().split(/\s+/)[0]).filter(Boolean)
}

await test('validateSurveyDraft: ตัดช่องว่างและตัวเลือกว่าง · ตรวจจำนวน ความยาว ซ้ำ ตรงกับที่ฐานข้อมูลตรวจ', () => {
  const good = validateSurveyDraft({ question: '  ควรทำเรื่องใดก่อน?  ', options: [' ถนน ', '', 'ไฟ', '  '] })
  assert.equal(good.ok, true)
  assert.deepEqual(good.clean, { question: 'ควรทำเรื่องใดก่อน?', options: ['ถนน', 'ไฟ'] })

  const q = (question, options = ['ก', 'ข']) => validateSurveyDraft({ question, options })
  assert.ok(q('สั้น').errors.question)
  assert.ok(q('    ').errors.question)
  assert.ok(q('ก'.repeat(SURVEY_QUESTION_MAX + 1)).errors.question)
  assert.equal(q('ก'.repeat(SURVEY_QUESTION_MIN)).ok, true)
  assert.equal(q('ก'.repeat(SURVEY_QUESTION_MAX)).ok, true)

  const o = options => validateSurveyDraft({ question: 'คำถามปกติข้อหนึ่ง', options })
  assert.ok(o(['ก']).errors.options)
  assert.ok(o(['ก', '']).errors.options, 'ตัวเลือกว่างถูกตัดทิ้งก่อนนับ เหลือ 1 ข้อ')
  assert.ok(o(['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ']).errors.options)
  assert.ok(o(['ก', 'ก']).errors.options)
  assert.ok(o(['Yes', 'yes']).errors.options, 'ซ้ำแบบไม่สนตัวพิมพ์เล็กใหญ่')
  assert.ok(o(['ก', 'ข'.repeat(SURVEY_OPTION_MAX + 1)]).errors.options)
  assert.equal(o(['ก', 'ข'.repeat(SURVEY_OPTION_MAX)]).ok, true)
  assert.equal(o(['ก', 'ข', 'ค', 'ง', 'จ']).ok, true)
  assert.equal(SURVEY_TEMPLATES.length, 3)
  const filled = SURVEY_TEMPLATES.filter(t => t.key !== 'blank')
  for (const t of filled) assert.equal(validateSurveyDraft({ question: t.question, options: t.options }).ok, true, `แม่แบบ ${t.key} ต้องส่งได้ทันที`)
  const blank = SURVEY_TEMPLATES.find(t => t.key === 'blank')
  assert.equal(validateSurveyDraft({ question: blank.question, options: blank.options }).ok, false, 'แม่แบบเปิดว่างต้องให้พิมพ์เองก่อน')
})

await test('surveyClosesAt / surveyDaysLeft / surveyPercent', () => {
  const now = Date.UTC(2026, 9, 20, 3, 0, 0)
  assert.equal(surveyClosesAt(14, now), new Date(now + 14 * 86400e3).toISOString())
  assert.equal(surveyClosesAt(7, now), new Date(now + 7 * 86400e3).toISOString())
  assert.equal(surveyClosesAt(999, now), new Date(now + SURVEY_DEFAULT_DAYS * 86400e3).toISOString(), 'ค่าที่ไม่อยู่ในตัวเลือก → ค่าเริ่มต้น')
  for (const d of SURVEY_DAY_CHOICES) assert.ok(d >= 1 && d <= SURVEY_MAX_DAYS, `${d} วันต้องอยู่ในช่วงที่ฐานข้อมูลรับ`)
  assert.ok(SURVEY_DAY_CHOICES.includes(SURVEY_DEFAULT_DAYS))

  assert.equal(surveyDaysLeft(new Date(now + 9 * 86400e3).toISOString(), now), 9)
  assert.equal(surveyDaysLeft(new Date(now + 3 * 3600e3).toISOString(), now), 1, 'ต่ำกว่า 1 วันยังเหลือ 1')
  assert.equal(surveyDaysLeft(new Date(now + 86400e3 + 1).toISOString(), now), 2, 'ปัดขึ้น')
  assert.equal(surveyDaysLeft(new Date(now - 1).toISOString(), now), 0)
  assert.equal(surveyDaysLeft('ไม่ใช่วันที่', now), 0)

  assert.equal(surveyPercent(9, 23), 39)
  assert.equal(surveyPercent(0, 23), 0)
  assert.equal(surveyPercent(5, 0), 0)
  assert.equal(surveyPercent(1, 3), 33)
})

await test('formatSurveyDate: ปีพุทธ เวลาไทยเสมอ ไม่ขึ้นกับ timezone เครื่อง (สลับ 4 เขต)', () => {
  // 2026-10-19 18:00 UTC = 2026-10-20 01:00 ไทย → ต้องเป็นวันที่ 20 ในทุก timezone
  const iso = '2026-10-19T18:00:00.000Z'
  const original = process.env.TZ
  try {
    for (const tz of ['Asia/Bangkok', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = tz
      const text = formatSurveyDate(iso)
      assert.match(text, /^20 ต\.ค\. 69$/, `${tz}: ${text}`)
    }
  } finally {
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
  }
  assert.equal(formatSurveyDate(null), '')
  assert.equal(formatSurveyDate('ไม่ใช่วันที่'), '')
})

await test('isSurveyId / surveyPath / ข้อความแชร์ไม่มีข้อมูลส่วนตัว', () => {
  const id = '54a610f5-774f-4a00-9e5b-1ec6ef0e441d'
  assert.equal(isSurveyId(id), true)
  assert.equal(isSurveyId(id.toUpperCase()), false)
  assert.equal(isSurveyId(`${id}x`), false)
  assert.equal(isSurveyId('../admin'), false)
  assert.equal(isSurveyId(null), false)
  assert.equal(surveyPath(id), `/survey/${id}`)
  const text = surveyShareText({ orgName: 'เทศบาลตำบลสาธิต' })
  assert.match(text, /เทศบาลตำบลสาธิต/)
  assert.ok(!/https?:|\d{4,}/.test(text), 'ข้อความแชร์ไม่ซ้ำลิงก์/ไม่มีเลขยาว (ลิงก์แนบแยกต่างหาก)')
  assert.equal(surveyShareText({}), 'ร่วมตอบแบบสำรวจความเห็น ใช้เวลาไม่ถึง 1 นาที')
  assert.equal(text, 'ร่วมตอบแบบสำรวจความเห็นของ เทศบาลตำบลสาธิต ใช้เวลาไม่ถึง 1 นาที')
})

await test('คำตอบของฉัน: จำในเครื่อง · พื้นที่เก็บใช้ไม่ได้ก็ไม่พัง', () => {
  const store = new Map()
  const storage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) }
  rememberMyAnswer('s1', 'o1', storage)
  assert.equal(recallMyAnswer('s1', storage), 'o1')
  assert.equal(recallMyAnswer('s2', storage), null)
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.doesNotThrow(() => rememberMyAnswer('s1', 'o1', broken))
  assert.equal(recallMyAnswer('s1', broken), null)
  assert.equal(recallMyAnswer('s1', undefined), null)
})

await test('pickSurveyForHome: ที่ยังไม่ตอบก่อน → ตอบแล้ว → เพิ่งปิดไม่เกิน 14 วัน → ไม่โชว์', () => {
  const now = Date.UTC(2026, 9, 20)
  const day = n => new Date(now + n * 86400e3).toISOString()
  const open = (id, voted) => ({ id, status: 'open', has_voted: voted, closes_at: day(5), total: 3 })
  const closed = (id, ago) => ({ id, status: 'closed', has_voted: true, closes_at: day(-ago), total: 3 })

  assert.equal(pickSurveyForHome([], now), null)
  assert.equal(pickSurveyForHome(null, now), null)
  assert.equal(pickSurveyForHome([closed('c', SURVEY_HOME_RECENT_DAYS + 1)], now), null, 'ปิดเกินกำหนดไม่ขึ้นหน้าแรก')
  assert.deepEqual(pickSurveyForHome([closed('c', SURVEY_HOME_RECENT_DAYS)], now), { kind: 'result', survey: closed('c', SURVEY_HOME_RECENT_DAYS), moreCount: 0 })
  assert.equal(pickSurveyForHome([open('a', true), open('b', false)], now).survey.id, 'b', 'ตัวที่ยังไม่ตอบมาก่อน')
  assert.equal(pickSurveyForHome([open('a', true), open('b', false)], now).kind, 'invite')
  assert.equal(pickSurveyForHome([open('a', true)], now).kind, 'thanks')
  assert.equal(pickSurveyForHome([open('a', true), closed('c', 1)], now).kind, 'thanks', 'ที่เปิดอยู่ชนะที่ปิดแล้ว')
  assert.equal(pickSurveyForHome([open('a', false), closed('c', 1), closed('d', 2)], now).moreCount, 2)
})

await test('ข้อความ: ทุกรหัสผลลัพธ์ที่ฐานข้อมูลคืนมีข้อความไทยรองรับ · PT429 แยกจากข้อผิดพลาดอื่น', () => {
  const codes = fn => [...sqlFunction(fn).matchAll(/'code',\s*'([a-z_]+)'/g)].map(m => m[1])
  for (const code of new Set(codes('cast_survey_vote'))) assert.ok(SURVEY_VOTE_ERRORS[code], `cast_survey_vote คืน ${code} แต่หน้าเว็บไม่มีข้อความ`)
  const manage = new Set(['create_survey', 'close_survey_early', 'set_survey_comment_enabled', 'delete_survey_comment', 'delete_survey'].flatMap(codes))
  for (const code of manage) assert.ok(SURVEY_MANAGE_ERRORS[code], `ฟังก์ชันจัดการคืน ${code} แต่หน้าเว็บไม่มีข้อความ`)
  // และห้ามมีข้อความของรหัสที่ฐานข้อมูลไม่เคยคืน (ตกค้าง)
  const used = new Set([...codes('cast_survey_vote'), ...manage])
  for (const code of Object.keys(SURVEY_VOTE_ERRORS)) assert.ok(used.has(code), `ข้อความ ${code} ไม่มีรหัสนี้ในฐานข้อมูล`)
  for (const code of Object.keys(SURVEY_MANAGE_ERRORS)) assert.ok(used.has(code), `ข้อความ ${code} ไม่มีรหัสนี้ในฐานข้อมูล`)
  for (const text of [...Object.values(SURVEY_VOTE_ERRORS), ...Object.values(SURVEY_MANAGE_ERRORS), SURVEY_BUSY_MESSAGE]) assert.match(text, /[฀-๿]/)
  assert.equal(isSurveyBusy({ code: 'PT429' }), true)
  assert.equal(isSurveyBusy({ message: 'ส่งถี่เกินไป กรุณารอ' }), true)
  assert.equal(isSurveyBusy({ code: '42501', message: 'permission denied' }), false)
  assert.equal(isSurveyBusy(null), false)
  assert.match(surveyThanksText({ comment_masked: true }), /ซ่อน/)
  assert.doesNotMatch(surveyThanksText({ comment_masked: false }), /ซ่อน/)
})

await test('ค่าคงที่หน้าเว็บ = ฐานข้อมูล: คำถาม ตัวเลือก ความเห็น จำนวนเรื่องที่เปิดพร้อมกัน วันเริ่มต้น/สูงสุด วันเก็บความเห็น', () => {
  assert.match(tablesSql, new RegExp(`char_length\\(btrim\\(question\\)\\) BETWEEN ${SURVEY_QUESTION_MIN} AND ${SURVEY_QUESTION_MAX}`))
  assert.match(tablesSql, new RegExp(`char_length\\(btrim\\(label\\)\\) BETWEEN 1 AND ${SURVEY_OPTION_MAX}`))
  assert.match(tablesSql, new RegExp(`position\\s+smallint\\s+NOT NULL CHECK \\(position BETWEEN 1 AND ${SURVEY_OPTIONS_MAX}\\)`))
  assert.match(tablesSql, new RegExp(`char_length\\(comment\\) <= ${SURVEY_COMMENT_MAX}`))
  const create = sqlFunction('create_survey')
  assert.match(create, new RegExp(`char_length\\(v_question\\) < ${SURVEY_QUESTION_MIN} OR char_length\\(v_question\\) > ${SURVEY_QUESTION_MAX}`))
  assert.match(create, new RegExp(`cardinality\\(v_labels\\) < ${SURVEY_OPTIONS_MIN} OR cardinality\\(v_labels\\) > ${SURVEY_OPTIONS_MAX}`))
  assert.match(create, new RegExp(`char_length\\(l\\) > ${SURVEY_OPTION_MAX}`))
  assert.match(create, new RegExp(`interval '${SURVEY_DEFAULT_DAYS} days'`))
  assert.match(create, new RegExp(`v_closes > now\\(\\) \\+ interval '${SURVEY_MAX_DAYS} days'`))
  assert.match(create, new RegExp(`>= ${SURVEY_MAX_OPEN} THEN`))
  assert.match(sqlFunction('cast_survey_vote'), new RegExp(`char_length\\(v_comment\\) > ${SURVEY_COMMENT_MAX}`))
  assert.match(sqlFunction('survey_comment_keep_days'), new RegExp(`SELECT ${SURVEY_COMMENT_KEEP_DAYS} `))
})

await test('ผู้มีตำแหน่งในฐานข้อมูล (survey_voter_group) = OFFICIAL_ROLES · ผู้จัดการ (survey_can_manage) = ชุดเดียวกับที่แท็บในหน้าเว็บแสดง', async () => {
  const roleList = sql => [...sql.matchAll(/'([a-z]+)'/g)].map(m => m[1])
  const groupBody = sqlFunction('survey_voter_group')
  const inList = groupBody.match(/get_my_role\(\) IN \(([^)]*)\)/)
  assert.ok(inList, 'ไม่พบลิสต์ role ใน survey_voter_group')
  assert.deepEqual([...roleList(inList[1])].sort(), [...OFFICIAL_ROLES].sort(), 'ผู้มีตำแหน่งต้องเป็นชุดเดียวกับ serviceAudience.js')

  const manageBody = sqlFunction('survey_can_manage')
  const manageIn = manageBody.match(/get_my_role\(\) IN \(([^)]*)\)/)
  assert.ok(manageIn)
  const sqlManage = ['superadmin', ...roleList(manageIn[1])]
  const posts = await read('src/components/staff/PostsManager.jsx')
  const tabList = posts.match(/const canSurvey = \[([^\]]*)\]/)
  assert.ok(tabList, 'ไม่พบ canSurvey ใน PostsManager')
  assert.deepEqual([...roleList(tabList[1])].sort(), [...sqlManage].sort(), 'แท็บแบบสำรวจต้องแสดงให้ชุด role ที่ฐานข้อมูลอนุญาตจัดการเท่านั้น')
})

await test('ชื่อ RPC และพารามิเตอร์ที่หน้าเว็บเรียก = ที่ฐานข้อมูลมี (ครบ ไม่เกิน ไม่ผิดชื่อ)', () => {
  const calls = []
  for (const [file, source] of Object.entries(surveySources)) {
    // เรียกตรง supabase.rpc('ชื่อ', {...}) และผ่านตัวช่วยของหน้าเจ้าหน้าที่ run(ป้าย, 'ชื่อ', {...})
    const found = [
      ...source.matchAll(/supabase\.rpc\(\s*'([a-z_]+)'\s*(?:,\s*\{([^}]*)\})?/g),
      ...source.matchAll(/run\(\s*[^,]+,\s*'([a-z_]+)',\s*\{([^}]*)\}/g),
    ]
    for (const match of found) {
      const keys = [...(match[2] ?? '').matchAll(/(?:^|[\s,])((?:_|p_)[a-z_]+)\s*:/g)].map(m => m[1])
      calls.push({ file, name: match[1], keys })
    }
  }
  assert.ok(calls.length >= 9, `พบการเรียก RPC แค่ ${calls.length}`)
  const names = new Set(calls.map(c => c.name))
  for (const expected of ['list_surveys', 'get_survey', 'cast_survey_vote', 'create_survey', 'close_survey_early', 'set_survey_comment_enabled', 'list_surveys_manage', 'get_survey_staff', 'delete_survey_comment', 'delete_survey']) {
    assert.ok(names.has(expected), `หน้าเว็บไม่เรียก ${expected}`)
  }
  for (const call of calls) {
    assert.deepEqual([...call.keys].sort(), [...sqlParams(call.name)].sort(), `${call.file}: พารามิเตอร์ของ ${call.name}`)
  }
})

await test('หน้าเว็บไม่แตะตาราง survey_* ตรงๆ (ผ่าน RPC เท่านั้น) และไม่อ้างตัวระบุผู้ตอบ', () => {
  for (const [file, source] of Object.entries(surveySources)) {
    assert.doesNotMatch(source, /\.from\(\s*['"`]survey_/, `${file} เรียกตาราง survey_* ตรงๆ`)
    assert.doesNotMatch(source, /\.from\(\s*['"`]surveys['"`]/, `${file} เรียกตาราง surveys ตรงๆ`)
    assert.doesNotMatch(source, /survey_voters|survey_ballots/, `${file} อ้างตารางทะเบียน/หีบบัตร`)
    assert.doesNotMatch(source, /\buser_id\b|\bvoter\b|session\??\.user|useAuth/, `${file} อ้างตัวระบุผู้ตอบ/ผู้ใช้`)
  }
})

await test('ป้าย "ความเห็นประกอบการพิจารณา ไม่ใช่มติ" ขึ้นทุกหน้าที่แสดงคำถาม/ผล และไม่อ้างว่าแทนประชาคม', () => {
  assert.match(SURVEY_NOT_A_VOTE_NOTICE, /ไม่ใช่มติ/)
  assert.match(SURVEY_NOT_A_VOTE_NOTICE, /ไม่ใช่การประชาคม/)
  for (const file of ['src/pages/SurveyPage.jsx', 'src/pages/SurveysPage.jsx', 'src/components/staff/SurveyManager.jsx']) {
    // ต้องถูกวางใน JSX จริง (ไม่ใช่แค่ import ค้างไว้) — red-check เคยจับได้ว่าลบการ์ดป้ายออกแล้วเทสต์ยังผ่านเพราะ import ยังอยู่
    assert.match(surveySources[file], /\{SURVEY_NOT_A_VOTE_NOTICE\}/, `${file} ไม่แสดงป้าย`)
  }
  for (const [file, source] of Object.entries(surveySources)) {
    assert.doesNotMatch(source, /ผลประชามติ|มติประชาชน|แทนประชาคม(?!ตาม|ไม่)/, `${file} มีคำที่อาจสื่อว่าเป็นมติ`)
  }
})

await test('ผลรายตัวเลือกแสดงจำนวนคนจริงคู่เปอร์เซ็นต์ · ไฮไลต์คำตอบของฉันเฉพาะเมื่อเครื่องจำได้', () => {
  const bars = surveySources['src/components/survey/SurveyResultBars.jsx']
  assert.match(bars, /\{count\} คน · \{pct\}%/)
  assert.match(bars, /ยังไม่มีผู้ตอบ/)
  assert.match(bars, /mineId && o\.id === mineId/)
  const page = surveySources['src/pages/SurveyPage.jsx']
  assert.match(page, /recallMyAnswer\(id\)/)
  assert.match(page, /rememberMyAnswer\(id, choice\)/)
})

await test('เส้นทาง /survey/:id และ /surveys เปิดได้โดยไม่ล็อกอินและไม่ผูกโมดูล · ส่งต่อไปล็อกอินแล้วกลับมาที่หน้านี้', async () => {
  const app = await read('src/App.jsx')
  for (const [route, element] of [['/survey/:id', 'SurveyPage'], ['/surveys', 'SurveysPage']]) {
    const line = app.split('\n').find(l => l.includes(`path="${route}"`))
    assert.ok(line, `ไม่พบเส้นทาง ${route}`)
    assert.match(line, new RegExp(`element=\\{<${element} />\\}`), 'ห้ามห่อด้วย RequireAuth')
  }
  assert.match(app, /const SurveyPage = lazyWithRetry\(\(\) => import\('\.\/pages\/SurveyPage'\)\)/)
  assert.equal(moduleForPath('/survey/54a610f5-774f-4a00-9e5b-1ec6ef0e441d'), null, 'ไม่ขึ้นกับสวิตช์โมดูลของ อปท.')
  assert.equal(moduleForPath('/surveys'), null)
  assert.match(surveySources['src/pages/SurveyPage.jsx'], /to="\/auth" state=\{\{ from: surveyPath\(id\) \}\}/, 'ล็อกอินแล้วต้องกลับมาที่หน้าแบบสำรวจเดิม')
})

await test('การ์ดหน้าแรกอยู่ใต้แถบเตือนน้ำในแม่แบบที่ อปท. จริงใช้ครบ 3 แบบ (eco_friendly · kledkaew · service_hub)', async () => {
  for (const template of ['EcoFriendly', 'Kledkaew', 'ServiceHub']) {
    const home = await read(`src/components/citizen/templates/${template}/Home.jsx`)
    assert.match(home, /import SurveyHomeCard from '\.\.\/\.\.\/\.\.\/survey\/SurveyHomeCard'/, template)
    const water = home.indexOf('<WaterAlertBanner')
    const survey = home.indexOf('<SurveyHomeCard')
    assert.ok(water >= 0 && survey > water, `${template}: การ์ดแบบสำรวจต้องอยู่ใต้แถบเตือนน้ำ`)
    assert.equal(home.split('<SurveyHomeCard').length - 1, 1, `${template}: ต้องมีการ์ดเดียว`)
  }
})

await test('แท็บ "แบบสำรวจ" ใน PostsManager: เห็นเฉพาะผู้จัดการได้ · ไม่ดึงตาราง posts ตอนอยู่แท็บนี้ · ปุ่มเพิ่มข่าวไม่ขึ้น', async () => {
  const posts = await read('src/components/staff/PostsManager.jsx')
  assert.match(posts, /\{ key: 'survey',\s+label: 'แบบสำรวจ', Icon: ClipboardList \}/)
  assert.match(posts, /TABS\.filter\(t => t\.key !== 'survey' \|\| canSurvey\)/)
  assert.match(posts, /if \(tab !== 'survey'\) fetchPosts\(\)/)
  assert.match(posts, /\{canCreate && tab !== 'survey' && \(/)
  assert.match(posts, /\{tab === 'survey' \? <SurveyManager canDelete=\{canDeleteSurvey\} \/> : \(<>/)
  // ต้องไม่ใช้ module key ใหม่ — ใช้เมนูข่าวสารเดิม ไม่ต้องเติม enabled_modules ให้ทุก อปท.
  const modules = await read('src/lib/staffModules.js')
  assert.doesNotMatch(modules, /survey/i, 'ไม่ควรเพิ่มคีย์โมดูล survey')
})

await test('ลบแบบสำรวจ (ฐานข้อมูล): ตรวจสิทธิ์ก่อน · ลงประวัติก่อนลบ · ลบแถวเดียว · ประวัติมีแต่ตัวเลข · สิทธิ์เรียกปิดจาก anon · ไม่ทับฟังก์ชันเดิม', () => {
  const del = sqlFunction('delete_survey')
  assert.match(del, /IF auth\.uid\(\) IS NULL OR NOT public\.survey_can_delete\(v_s\.municipality_id\) THEN/)
  assert.ok(del.indexOf('survey_audit') > 0 && del.indexOf('survey_audit') < del.indexOf('DELETE FROM public.surveys'), 'ต้องลงประวัติก่อนลบ (ธุรกรรมเดียวกัน)')
  assert.match(del, /survey_audit\(v_s\.municipality_id, 'delete', v_s\.id, v_s\.question,/)
  assert.match(del, /jsonb_build_object\('status', v_status, 'answers', v_answers, 'comments', v_comments\)/)
  assert.equal(del.split('DELETE FROM').length - 1, 1, 'ต้องมีคำสั่งลบเดียว')
  assert.match(del, /DELETE FROM public\.surveys WHERE id = v_s\.id;/)
  assert.match(deleteSql, /REVOKE ALL ON FUNCTION public\.delete_survey\(uuid\)\s+FROM PUBLIC, anon, authenticated;/)
  assert.match(deleteSql, /GRANT EXECUTE ON FUNCTION public\.delete_survey\(uuid\)\s+TO authenticated;/)
  assert.match(deleteSql, /REVOKE ALL ON FUNCTION public\.survey_can_delete\(uuid\) FROM PUBLIC, anon, authenticated;/)
  assert.doesNotMatch(deleteSql, /GRANT EXECUTE ON FUNCTION public\.survey_can_delete/)
  // ฟังก์ชันใหม่ล้วน — ห้ามมี CREATE OR REPLACE ทับฟังก์ชันเดิมของแบบสำรวจ (docs/ai/NOTES.md ข้อ 5)
  const created = [...deleteSql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)].map(m => m[1]).sort()
  assert.deepEqual(created, ['delete_survey', 'survey_can_delete'])
  for (const name of created) assert.ok(!new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`).test(functionsSql), `${name} ซ้ำกับไฟล์เดิม`)
})

await test('ผู้ลบแบบสำรวจได้: ฐานข้อมูล (survey_can_delete) = SURVEY_DELETE_ROLES · แคบกว่าผู้จัดการ · แท็บแบบสำรวจเห็นได้ทุกคนที่ลบได้ · PostsManager ส่งสิทธิ์ให้ SurveyManager', async () => {
  const roleList = sql => [...sql.matchAll(/'([a-z]+)'/g)].map(m => m[1])
  assert.deepEqual(roleList(sqlFunction('survey_can_delete')).sort(), [...SURVEY_DELETE_ROLES].sort())
  const manageRoles = ['superadmin', ...roleList(sqlFunction('survey_can_manage').match(/get_my_role\(\) IN \(([^)]*)\)/)[1])]
  for (const role of SURVEY_DELETE_ROLES) assert.ok(manageRoles.includes(role), `${role} ลบได้แต่จัดการไม่ได้`)
  assert.ok(SURVEY_DELETE_ROLES.length < manageRoles.length, 'ผู้ลบต้องแคบกว่าผู้จัดการ (ลบแล้วกู้คืนไม่ได้)')
  assert.ok(!SURVEY_DELETE_ROLES.includes('officer') && !SURVEY_DELETE_ROLES.includes('staff'))
  const posts = await read('src/components/staff/PostsManager.jsx')
  assert.match(posts, /const canDeleteSurvey = SURVEY_DELETE_ROLES\.includes\(currentUserRole\)/)
  assert.match(posts, /import \{ SURVEY_DELETE_ROLES \} from '\.\.\/\.\.\/lib\/survey'/)
})

await test('ปุ่มลบแบบสำรวจ: ขึ้นเฉพาะ canDelete (ค่าเริ่มต้น false) · กดครั้งแรกแค่ขอยืนยัน · ยืนยันแล้วค่อยเรียก RPC · ลบสำเร็จกลับหน้ารายการ ไม่โหลดเรื่องที่หายแล้วซ้ำ', () => {
  const manager = surveySources['src/components/staff/SurveyManager.jsx']
  assert.match(manager, /export default function SurveyManager\(\{ canDelete = false \}\)/)
  assert.match(manager, /\{canDelete && \(\s*<section[^>]*data-survey-delete/)
  assert.equal(manager.split("'delete_survey'").length - 1, 1, 'ต้องเรียก delete_survey จุดเดียว')
  assert.match(manager, /supabase\.rpc\('delete_survey', \{ _survey_id: surveyId \}\)/)
  assert.match(manager, /setConfirm\('delete'\)/)
  assert.equal(manager.split('onClick={remove}').length - 1, 1, 'remove ผูกกับปุ่มยืนยันเท่านั้น')
  const confirmBranch = manager.slice(manager.indexOf("confirm === 'delete' ? ("), manager.indexOf('ลบแบบสำรวจนี้</button>'))
  assert.match(confirmBranch, /onClick=\{remove\}/, 'ปุ่ม remove ต้องอยู่ในขั้นยืนยัน')
  assert.match(confirmBranch, /ยืนยันลบถาวร/)
  assert.match(manager, /surveyDeleteWarning\(\{ open, total: data\.split\.total, comments: data\.comments\.length \}\)/)
  const remove = manager.slice(manager.indexOf('async function remove()'), manager.indexOf("const open = data?.status === 'open'"))
  assert.match(remove, /^async function remove\(\) \{/)
  assert.equal(remove.split('load(true)').length - 1, 1)
  assert.match(remove, /res\?\.code === 'not_found'\) await load\(true\)/, 'โหลดซ้ำเฉพาะตอน not_found')
  assert.match(remove, /\n    onDeleted\(\)\n/)
  assert.match(manager, /onDeleted=\{\(\) => setView\(\{ name: 'list', notice: 'ลบแบบสำรวจแล้ว' \}\)\}/)
})

await test('surveyDeleteWarning: บอกตัวเลขจริงของเรื่องที่จะลบ · เรื่องที่ยังเปิดอยู่ถูกเตือน · เรื่องว่างไม่อ้างว่ามีผู้ตอบ · ทุกกรณีบอกว่ากู้คืนไม่ได้', () => {
  assert.equal(surveyDeleteWarning({ open: true, total: 12, comments: 3 }),
    'ยังเปิดรับอยู่ · ตอบแล้ว 12 คน ความเห็น 3 รายการ จะหายทั้งหมด · ลบแล้วกู้คืนไม่ได้ ลิงก์ที่แชร์ไว้จะขึ้น "ไม่พบแบบสำรวจนี้"')
  const closedNoComment = surveyDeleteWarning({ open: false, total: 5, comments: 0 })
  assert.match(closedNoComment, /ตอบแล้ว 5 คน จะหายทั้งหมด/)
  assert.doesNotMatch(closedNoComment, /ความเห็น|ยังเปิดรับอยู่/)
  const empty = surveyDeleteWarning({ open: false, total: 0, comments: 0 })
  assert.match(empty, /ยังไม่มีผู้ตอบ/)
  assert.doesNotMatch(empty, /ตอบแล้ว|จะหายทั้งหมด/)
  for (const w of [closedNoComment, empty, surveyDeleteWarning({ open: true, total: 1, comments: 1 })]) assert.match(w, /กู้คืนไม่ได้/)
})

await test('ฟอร์มเจ้าหน้าที่: งานที่เพิ่มมีแค่สร้าง · ค่าเริ่มต้นใช้ได้ทันที (แม่แบบแรก 14 วัน เปิดช่องความเห็น) · ส่งเวลาปิดเป็น null เมื่อใช้ค่าเริ่มต้นเพื่อไม่พึ่งนาฬิกาเครื่อง', () => {
  const manager = surveySources['src/components/staff/SurveyManager.jsx']
  assert.match(manager, /useState\(first\.question\)/)
  assert.match(manager, /useState\(SURVEY_DEFAULT_DAYS\)/)
  assert.match(manager, /useState\(true\)/)
  assert.match(manager, /p_closes_at: days === SURVEY_DEFAULT_DAYS \? null : surveyClosesAt\(days\)/)
  // แก้ช่องที่ผิดแล้วข้อความผิดพลาดของช่องนั้นต้องหาย (เคยค้างอยู่ใต้คำถามที่พิมพ์ถูกแล้ว)
  assert.match(manager, /setQuestion\(e\.target\.value\); clearError\('question'\)/)
  assert.match(manager, /clearError\('options'\)/)
  // ปุ่มปิดก่อนกำหนดและลบความเห็นต้องยืนยัน 2 ขั้น
  assert.match(manager, /ยืนยันปิดตอนนี้/)
  assert.match(manager, /setConfirm\(c\.id\)/)
  // ไม่มีการนับ/ปิดอัตโนมัติฝั่งเจ้าหน้าที่: ไม่มีปุ่มนับคะแนน/อนุมัติ
  const withoutComments = manager.replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  assert.doesNotMatch(withoutComments, /อนุมัติ|นับคะแนน|ยืนยันรายวัน/)
})

console.log(`\nครบ ${cases} กลุ่ม`)
