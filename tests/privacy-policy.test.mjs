// เทสต์นโยบายความเป็นส่วนตัว — รันด้วย: node tests/privacy-policy.test.mjs
//
// ทำไมต้องมี:
// 1) สโตร์ตรวจหัวข้อบังคับ (Apple 5.1.1(i): ข้อมูลที่เก็บ/การใช้/บุคคลที่สาม/ระยะเก็บ/วิธีขอลบ · Google Play:
//    ข้อมูลผู้พัฒนา ช่องทางติดต่อ ระยะเก็บและการลบ) และ PDPA ต้องมีผู้ควบคุมข้อมูล ฐานทางกฎหมาย และสิทธิครบ
// 2) นโยบายคือคำสัญญาต่อประชาชน — ทุกข้อที่อ้างถึงพฤติกรรมของระบบต้องตรงกับโค้ด ข้อไหนโค้ดเปลี่ยนแล้วนโยบาย
//    ไม่เปลี่ยนตาม เทสต์นี้ต้องแดง (ประกาศไว้แต่ทำไม่ได้ = แย่กว่าไม่ประกาศ)
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PRIVACY_POLICY_EFFECTIVE, PRIVACY_POLICY_VERSION, buildPrivacyPolicy } from '../src/lib/privacyPolicy.js'
import { ACCOUNT_DELETION_KEPT } from '../src/lib/accountDeletion.js'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const TENANT = {
  name: 'เทศบาลตำบลทดสอบ', system_name: 'TEST ระบบบริการประชาชน', developer_name: 'TEST ผู้พัฒนาระบบ',
  address: '99 หมู่ 1 ตำบลทดสอบ', phone: '053-000000, 053-111111', email: 'saraban@example.go.th',
}
const policy = buildPrivacyPolicy(TENANT)
const section = (id) => policy.sections.find(s => s.id === id)
const textOf = (value) => JSON.stringify(value)
let passed = 0
function check(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`) }

console.log('หัวข้อบังคับของสโตร์และ PDPA')
check('ครบ 10 หัวข้อตามลำดับ และหัวข้อใหญ่ชื่อ "นโยบายความเป็นส่วนตัว"', () => {
  assert.equal(policy.title, 'นโยบายความเป็นส่วนตัว')
  assert.deepEqual(policy.sections.map(s => s.id),
    ['controller', 'data', 'purposes', 'recipients', 'transfer', 'retention', 'rights', 'security', 'contact', 'changes'])
  for (const s of policy.sections) {
    assert.ok((s.paragraphs?.length ?? 0) + (s.items?.length ?? 0) > 0, `${s.id} ต้องมีเนื้อหา`)
  }
})
check('ผู้ควบคุมข้อมูล + ผู้พัฒนา + ช่องทางติดต่อมาจากข้อมูลหน่วยงาน (Google: ข้อมูลผู้พัฒนาและช่องทางติดต่อ)', () => {
  assert.match(textOf(section('controller')), /เทศบาลตำบลทดสอบ เป็นผู้ควบคุมข้อมูลส่วนบุคคล/)
  // ผู้พัฒนามาจากค่ากลาง (src/lib/platform.js) ไม่ใช่ developer_name ซึ่งเป็นข้อความท้ายเว็บที่ อปท. กรอกเอง
  assert.match(textOf(section('controller')), /ผู้พัฒนาและดูแลระบบและแอป SmartLocal/)
  assert.ok(!textOf(policy).includes('TEST ผู้พัฒนาระบบ'), 'ห้ามดึง developer_name มาเป็นชื่อผู้พัฒนา')
  for (const id of ['controller', 'contact']) {
    assert.deepEqual(section(id).contacts.map(c => c.kind), ['address', 'phone', 'email'], id)
  }
})
check('บอกข้อมูลที่เก็บ วัตถุประสงค์ และฐานทางกฎหมาย (Apple: data + uses · PDPA: ฐาน)', () => {
  const data = textOf(section('data'))
  for (const word of ['บัญชีผู้ใช้', 'คำร้องเรียน', 'คำขอบริการ', 'รถรับ-ส่งผู้ป่วย', 'บ่งชี้สุขภาพ', 'ตำแหน่งของอุปกรณ์', 'หมายเลข IP']) {
    assert.ok(data.includes(word), `ข้อมูลที่เก็บต้องพูดถึง ${word}`)
  }
  const purposes = textOf(section('purposes'))
  for (const basis of ['ประโยชน์สาธารณะ', 'การปฏิบัติตามกฎหมาย', 'ประโยชน์โดยชอบด้วยกฎหมาย', 'ความยินยอม']) {
    assert.ok(purposes.includes(basis), `ต้องมีฐาน ${basis}`)
  }
  assert.match(purposes, /ไม่ใช้ข้อมูลของท่านเพื่อโฆษณา ไม่ขายข้อมูล/)
})
check('บอกบุคคลที่สามและการส่งข้อมูลไปต่างประเทศ (Apple: third parties · PDPA: cross-border)', () => {
  const recipients = textOf(section('recipients'))
  for (const vendor of ['Supabase', 'Cloudflare', 'Google', 'LINE', 'Telegram', 'OpenStreetMap', 'Open-Meteo']) {
    assert.ok(recipients.includes(vendor), `ต้องเปิดเผย ${vendor}`)
  }
  assert.match(textOf(section('transfer')), /ประเทศญี่ปุ่น/)
})
check('ระยะเก็บ + วิธีขอลบ + สิทธิครบ (Apple: retention/deletion · PDPA: สิทธิ)', () => {
  const retention = section('retention')
  assert.ok(retention.links.some(l => l.to === '/account/delete'), 'หัวข้อระยะเก็บต้องลิงก์ไปหน้าลบบัญชี')
  const rights = textOf(section('rights'))
  for (const right of ['ขอเข้าถึง', 'แก้ไข', 'ลบ', 'คัดค้าน', 'ระงับ', 'ขอรับหรือขอให้ส่งข้อมูล', 'ถอนความยินยอม', 'สำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล']) {
    assert.ok(rights.includes(right), `สิทธิต้องมี ${right}`)
  }
  assert.ok(section('rights').links.some(l => l.to === '/account/delete'))
})
check('รุ่นและวันที่มีผลแสดงในหัวข้อการเปลี่ยนแปลง', () => {
  assert.match(PRIVACY_POLICY_VERSION, /^\d+\.\d+$/)
  assert.match(textOf(section('changes')), new RegExp(`รุ่น ${PRIVACY_POLICY_VERSION.replace('.', '\\.')} มีผลตั้งแต่วันที่ ${PRIVACY_POLICY_EFFECTIVE}`))
})

console.log('ข้อมูลหน่วยงานไม่ครบต้องไม่โผล่คำว่า undefined/null')
check('หน่วยงานไม่มีข้อมูลติดต่อเลย ใช้คำกลางแทน และไม่มีช่องติดต่อว่าง', () => {
  for (const tenant of [undefined, {}, { name: 'อบต.ทดสอบ', phone: null, email: '', address: undefined }]) {
    const p = buildPrivacyPolicy(tenant)
    const all = textOf(p)
    assert.doesNotMatch(all, /undefined|null|NaN/, JSON.stringify(tenant))
    assert.equal(p.sections.find(s => s.id === 'contact').contacts.length, 0)
  }
  assert.match(textOf(buildPrivacyPolicy(undefined).sections[0]), /หน่วยงาน เป็นผู้ควบคุม/)
})

console.log('คำสัญญาในนโยบายตรงกับโค้ดจริง')
check('ระยะเก็บข้อมูลติดต่อในคำร้อง = ข้อความในป๊อปอัป PDPA ของฟอร์มคำร้อง', () => {
  assert.ok(read('src/pages/CitizenForm.jsx').includes('เก็บไว้ 5 ปีนับจากวันปิดเรื่อง'))
  assert.ok(textOf(section('retention')).includes('เก็บไว้ 5 ปีนับจากวันปิดเรื่อง'))
})
check('ลบบัญชีแล้วเอกสารราชการยังอยู่ — ตรงกับข้อความในหน้าลบบัญชี', () => {
  assert.ok(ACCOUNT_DELETION_KEPT.some(t => t.includes('เอกสารราชการ')))
  assert.match(textOf(section('retention')), /แม้ท่านลบบัญชีแล้ว เอกสารเหล่านี้ยังอยู่/)
})
check('Telegram ไม่ส่งชื่อ/เบอร์/รายละเอียดผู้แจ้ง — กติกานี้ยังอยู่ใน notify-telegram', () => {
  assert.match(read('supabase/functions/notify-telegram/index.ts'), /ห้ามใส่ reporter_name, phone, requester_\* หรือรายละเอียด/)
  assert.match(textOf(section('recipients')), /ไม่มีชื่อ เบอร์โทรศัพท์ หรือรายละเอียดที่ท่านพิมพ์/)
})
check('รถรับ-ส่งผู้ป่วยขอความยินยอมเป็นช่องแยกที่ไม่ติ๊กไว้ให้ (นโยบายอ้างถึง)', () => {
  assert.match(read('src/components/patientTransport/BookingReviewSheet.jsx'), /const \[consent, setConsent\] = useState\(false\)/)
  assert.match(textOf(section('purposes')), /ขอความยินยอมไว้ในขั้นตอนจอง/)
})
check('หน้าเว็บไม่มีโฆษณา/ตัวติดตามของบุคคลภายนอก (นโยบายประกาศว่าไม่มี)', () => {
  const TRACKERS = /googletagmanager\.com|google-analytics\.com|gtag\(|clarity\.ms|hotjar|connect\.facebook\.net|plausible\.io|posthog|mixpanel|sentry\.io|doubleclick/i
  const files = ['index.html']
  const walk = (dir) => {
    for (const name of readdirSync(new URL(dir, root))) {
      const path = join(dir, name).replaceAll('\\', '/')
      if (statSync(new URL(path, root)).isDirectory()) walk(`${path}/`)
      else if (/\.(jsx?|html)$/.test(name)) files.push(path)
    }
  }
  walk('src/')
  const hits = files.filter(path => TRACKERS.test(read(path)))
  assert.deepEqual(hits, [])
})
check('ลิงก์ในนโยบายชี้ route ที่มีอยู่จริง และหน้าต่างๆ ลิงก์กลับมาที่นโยบาย', () => {
  const app = read('src/App.jsx')
  for (const to of new Set(policy.sections.flatMap(s => s.links ?? []).map(l => l.to).concat('/privacy'))) {
    assert.ok(app.includes(`path="${to}"`), `ไม่มี route ${to}`)
  }
  assert.match(read('src/pages/MorePage.jsx'), /to: '\/privacy'/)
  assert.match(read('src/pages/AuthPage.jsx'), /data-auth-privacy-link[\s\S]{0,300}to="\/privacy"/)
  assert.match(read('src/pages/AccountDeletePage.jsx'), /to="\/privacy#retention"/)
  assert.match(read('src/pages/CitizenForm.jsx'), /to="\/privacy"[^>]*data-pdpa-full-policy/)
})

console.log(`\nผ่านทั้งหมด ${passed} ข้อ`)
