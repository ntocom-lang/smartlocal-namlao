// เทสต์แอปเดียวรวมทุก อปท. (โดเมนกลาง app.rk-networks.com) — รันด้วย: node tests/platform.test.mjs
//
// ทำไมต้องมี:
// 1) หน้าแรกของแอปจากสโตร์คือหน้าเลือกหน่วยงาน ถ้าตรรกะ "จำ/พาไป/ขอเลือกใหม่" ผิด ประชาชนจะต้องเลือกใหม่ทุกครั้ง
//    หรือถูกพาไปหน่วยงานที่ปิดแล้วทุกครั้งที่เปิดแอป — ผิดเงียบ ไม่มี error ให้เห็น
// 2) หน้ากลาง 3 หน้า (นโยบาย / ลบบัญชี / ช่วยเหลือ) คือ URL ที่กรอกในสโตร์ ผู้ตรวจของสโตร์เปิดดูจริง
//    เนื้อหาต้องอ้างชื่อแอป มีทางลบบัญชีที่ไม่ต้องลงแอปใหม่ และสาระเรื่องข้อมูลต้องตรงกับนโยบายของ อปท.
// 3) โดเมนกลางต้องไม่ถูกตีความเป็นรหัสหน่วยงานจาก path (บั๊กเดิม: app.rk-networks.com/privacy = หน่วยงาน "privacy")
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CHANGE_TENANT_PARAM, PLATFORM_APP_NAME, PLATFORM_DEVELOPER, PUBLIC_TENANT_COLUMNS, VIA_APP_PATH,
  autoOpenSlug, captureViaApp, fetchActiveTenants, forgetRememberedTenant, isPlatformHost, openedViaApp,
  platformHref, platformPageFor, readRememberedTenant, rememberTenant, shouldOfferAppDownload, sortTenants, tenantArea, tenantHref,
} from '../src/lib/platform.js'
import { buildPlatformPrivacyPolicy, buildPrivacyPolicy } from '../src/lib/privacyPolicy.js'
import { buildPlatformAccountDeletion, buildPlatformSupport } from '../src/lib/platformInfo.js'
import {
  ACCOUNT_DELETE_CONFIRM_WORD, ACCOUNT_DELETION_KEPT, ACCOUNT_DELETION_REMOVED,
} from '../src/lib/accountDeletion.js'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const textOf = (value) => JSON.stringify(value)
const APP_HOST = 'app.rk-networks.com'
const TENANTS = [
  { slug: 'thungkaew', name: 'TEST อบต.ข', province: 'แพร่', district: 'หนองม่วงไข่', phone: '054-000001', email: 'b@example.go.th', address: 'ที่อยู่ ข', isDemo: false },
  { slug: 'namlao', name: 'TEST ทต.ก', province: 'แพร่', district: 'ร้องกวาง', phone: '054-000002', email: null, address: '', isDemo: false },
  { slug: 'demo', name: 'TEST สาธิต', province: 'แพร่', district: 'เมืองแพร่', phone: '054-000000', isDemo: true },
]
let passed = 0
function check(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`) }
async function checkAsync(name, fn) { await fn(); passed++; console.log(`  ✓ ${name}`) }

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)) },
    removeItem: (k) => { data.delete(k) },
    dump: () => Object.fromEntries(data),
  }
}
const brokenStorage = {
  getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') },
}

console.log('ลิงก์และโดเมน')
check('ลิงก์เว็บ อปท. / โดเมนกลาง ใช้ https และโดเมนหลักเดียวกับที่เปิดอยู่', () => {
  assert.equal(tenantHref('namlao', '/', APP_HOST), 'https://namlao.rk-networks.com/')
  assert.equal(tenantHref('namlao', VIA_APP_PATH, APP_HOST), 'https://namlao.rk-networks.com/?via=app')
  assert.equal(tenantHref('namlao', '/privacy', 'thungkaw.rk-networks.com'), 'https://namlao.rk-networks.com/privacy', 'subdomain พิมพ์ผิด')
  assert.equal(platformHref(`/?${CHANGE_TENANT_PARAM}=1`, 'namlao.rk-networks.com'), 'https://app.rk-networks.com/?change=1')
  // ที่ที่บอกโดเมนไม่ได้ (เครื่องนักพัฒนา, vercel) ถอยไปโดเมนหลักของระบบ
  for (const host of ['localhost', '127.0.0.1', 'smartlocal-demo.vercel.app', '192.168.1.5']) {
    assert.equal(tenantHref('demo', '/', host), 'https://demo.rk-networks.com/', host)
    assert.equal(platformHref('/', host), 'https://app.rk-networks.com/', host)
  }
})
check('โดเมนกลางของแอป = app.* เท่านั้น (www/โดเมน อปท./เครื่องนักพัฒนา ไม่ใช่)', () => {
  assert.equal(isPlatformHost(APP_HOST), true)
  for (const host of ['www.rk-networks.com', 'namlao.rk-networks.com', 'localhost', 'smartlocal-app.vercel.app', '127.0.0.1']) {
    assert.equal(isPlatformHost(host), false, host)
  }
})
check('หน้ากลาง 4 หน้า: /privacy /account/delete /support /download (ทับ / ท้ายได้) — path อื่นเป็นหน้าเลือกหน่วยงาน', () => {
  assert.equal(platformPageFor('/privacy'), 'privacy')
  assert.equal(platformPageFor('/privacy/'), 'privacy')
  assert.equal(platformPageFor('/account/delete'), 'account-delete')
  assert.equal(platformPageFor('/support'), 'support')
  assert.equal(platformPageFor('/download'), 'download')
  for (const path of ['/', '', '/profile', '/account', '/privacy/x', '/complaint', undefined]) {
    assert.equal(platformPageFor(path), null, String(path))
  }
})

console.log('จำหน่วยงานที่เลือก')
check('เปิดแอปครั้งต่อไปพาเข้าหน่วยงานที่จำไว้ — เฉพาะที่ยังเปิดใช้ และไม่พาไปเมื่อขอเลือกใหม่', () => {
  assert.equal(autoOpenSlug({ remembered: 'namlao', tenants: TENANTS, wantsChange: false }), 'namlao')
  assert.equal(autoOpenSlug({ remembered: 'demo', tenants: TENANTS, wantsChange: false }), 'demo', 'ผู้ตรวจสโตร์เลือกสาธิตไว้')
  assert.equal(autoOpenSlug({ remembered: 'namlao', tenants: TENANTS, wantsChange: true }), null, '?change=1')
  assert.equal(autoOpenSlug({ remembered: 'closed', tenants: TENANTS, wantsChange: false }), null, 'หน่วยงานที่ปิดแล้ว')
  assert.equal(autoOpenSlug({ remembered: null, tenants: TENANTS, wantsChange: false }), null, 'ยังไม่เคยเลือก')
})
check('จำ/อ่าน/ลืม ใน storage — เครื่องที่ปิด storage ไม่พัง', () => {
  const storage = memoryStorage()
  assert.equal(readRememberedTenant(storage), null)
  rememberTenant('thungkaew', storage)
  assert.equal(readRememberedTenant(storage), 'thungkaew')
  forgetRememberedTenant(storage)
  assert.equal(readRememberedTenant(storage), null)
  assert.doesNotThrow(() => { rememberTenant('x', brokenStorage); forgetRememberedTenant(brokenStorage) })
  assert.equal(readRememberedTenant(brokenStorage), null)
  assert.equal(readRememberedTenant(null), null)
})

console.log('จำว่าเครื่องนี้ใช้ผ่านแอป (?via=app)')
check('เจอ ?via=app: จำไว้ + ลบพารามิเตอร์ออก คง path/query อื่น/hash/state ของ router ไว้', () => {
  const storage = memoryStorage()
  const calls = []
  const hist = { state: { idx: 0, key: 'k' }, replaceState: (...args) => calls.push(args) }
  const loc = { pathname: '/complaint', search: '?x=1&via=app', hash: '#top' }
  assert.equal(captureViaApp(loc, hist, storage), true)
  assert.deepEqual(calls, [[{ idx: 0, key: 'k' }, '', '/complaint?x=1#top']])
  assert.equal(openedViaApp(storage), true)

  const plain = []
  assert.equal(captureViaApp({ pathname: '/', search: '?via=app', hash: '' }, { state: null, replaceState: (...a) => plain.push(a) }, memoryStorage()), true)
  assert.deepEqual(plain[0].slice(1), ['', '/'])
})
check('ไม่มี ?via=app (หรือค่าอื่น) = ไม่จำ ไม่แตะ URL · storage พังยังลบพารามิเตอร์ได้', () => {
  const storage = memoryStorage()
  const calls = []
  const hist = { state: null, replaceState: (...a) => calls.push(a) }
  assert.equal(captureViaApp({ pathname: '/', search: '', hash: '' }, hist, storage), false)
  assert.equal(captureViaApp({ pathname: '/', search: '?via=web', hash: '' }, hist, storage), false)
  assert.deepEqual(calls, [])
  assert.equal(openedViaApp(storage), false)
  assert.equal(captureViaApp({ pathname: '/', search: '?via=app', hash: '' }, hist, brokenStorage), true)
  assert.equal(calls.length, 1)
  assert.equal(openedViaApp(brokenStorage), false)
  assert.equal(captureViaApp(undefined, undefined, storage), false, 'node/ไม่มี window')
})
check('เมนู "ดาวน์โหลดแอป" บนเว็บ อปท.: เห็นเฉพาะคนที่ยังไม่ได้ใช้ผ่านแอปและยังไม่ได้ติดตั้งเป็นแอป', () => {
  assert.equal(shouldOfferAppDownload({ storage: memoryStorage() }), true, 'เปิดเว็บปกติ')
  assert.equal(shouldOfferAppDownload({ storage: memoryStorage({ sl_via_app: '1' }) }), false, 'ใช้ผ่านแอปจากสโตร์/APK')
  assert.equal(shouldOfferAppDownload({ installed: true, storage: memoryStorage() }), false, 'ติดตั้งเป็นแอปบนหน้าจอหลักแล้ว')
  assert.equal(shouldOfferAppDownload({ storage: brokenStorage }), true, 'storage พังยังเห็นเมนู ไม่ทำให้หน้าล้ม')
})

console.log('รายชื่อหน่วยงาน')
await checkAsync('ดึงเฉพาะที่เปิดใช้ ตัดแถวไม่มีชื่อ เรียงจังหวัดแล้วชื่อ (ภาษาไทย) และติดป้ายสาธิต', async () => {
  const seen = {}
  const client = {
    from(table) {
      seen.table = table
      return {
        select(cols) { seen.cols = cols; return this },
        eq(col, val) { seen.eq = [col, val]; return Promise.resolve({ data: [TENANTS[0], { slug: '', name: 'x' }, TENANTS[2], TENANTS[1], { slug: 'y', name: null }], error: null }) },
      }
    },
  }
  const list = await fetchActiveTenants(client)
  assert.deepEqual(seen, { table: 'municipalities', cols: PUBLIC_TENANT_COLUMNS, eq: ['is_active', true] })
  // จังหวัดเดียวกัน → เรียงตามชื่อแบบพจนานุกรมไทย: ท (ทต.ก) < ส (สาธิต) < อ (อบต.ข)
  assert.deepEqual(list.map((t) => [t.slug, t.isDemo]), [['namlao', false], ['demo', true], ['thungkaew', false]])
  assert.deepEqual(sortTenants([{ name: 'ข', province: 'น่าน' }, { name: 'ก', province: 'แพร่' }, { name: 'ค' }]).map((t) => t.name), ['ค', 'ข', 'ก'], 'จังหวัดก่อนชื่อ (ไม่มีจังหวัดขึ้นก่อน)')
  await assert.rejects(fetchActiveTenants({ from: () => ({ select() { return this }, eq: () => Promise.resolve({ data: null, error: new Error('42501') }) }) }))
})
check('คอลัมน์ที่ขอ anon อ่านได้จริง — ทุกคอลัมน์ต้องอยู่ในชุดที่ TenantContext ขอตอนประชาชนเปิดเว็บ (ไม่ล็อกอิน)', () => {
  const tenantSelect = read('src/contexts/TenantContext.jsx').match(/from\('municipalities'\)\s*\.select\('([^']+)'\)/)[1]
  const granted = new Set(tenantSelect.split(',').map((c) => c.trim()))
  for (const col of PUBLIC_TENANT_COLUMNS.split(',').map((c) => c.trim())) {
    assert.ok(granted.has(col), `${col} ไม่อยู่ในชุดที่ anon อ่านได้ — query จะล้มด้วย 42501`)
  }
  assert.equal(tenantArea({ district: 'ร้องกวาง', province: 'แพร่' }), 'อ.ร้องกวาง จ.แพร่')
  assert.equal(tenantArea({}), '')
})

console.log('หน้ากลางที่กรอกในสโตร์')
const privacy = buildPlatformPrivacyPolicy(TENANTS, APP_HOST)
const deletion = buildPlatformAccountDeletion(TENANTS, APP_HOST)
const support = buildPlatformSupport(TENANTS, APP_HOST)
const sectionOf = (doc, id) => doc.sections.find((s) => s.id === id)
check('นโยบายฉบับรวม: สาระเรื่องข้อมูลชุดเดียวกับฉบับของ อปท. ทุกคำ ต่างแค่ผู้ควบคุมข้อมูลและช่องทางติดต่อ', () => {
  const tenantPolicy = buildPrivacyPolicy({ name: 'TEST ทต.ก' })
  assert.equal(privacy.title, 'นโยบายความเป็นส่วนตัว', 'Play: ต้องติดป้ายว่าเป็นนโยบายความเป็นส่วนตัว')
  assert.deepEqual(privacy.sections.map((s) => s.id), tenantPolicy.sections.map((s) => s.id))
  for (const id of ['data', 'purposes', 'recipients', 'transfer', 'retention', 'security', 'changes']) {
    assert.deepEqual(sectionOf(privacy, id), sectionOf(tenantPolicy, id), id)
  }
  assert.deepEqual(sectionOf(privacy, 'rights').items, sectionOf(tenantPolicy, 'rights').items)
  assert.ok(!sectionOf(privacy, 'rights').links.some((l) => l.to === '/profile'), 'โดเมนกลางไม่มีหน้าบัญชีของฉัน')
  assert.ok(sectionOf(privacy, 'contact').links.some((l) => l.to === '/support'))
})
check('นโยบายฉบับรวม: ระบุชื่อแอป + ผู้ควบคุมข้อมูลทุก อปท. (ไม่รวมสาธิต) พร้อมลิงก์นโยบายฉบับของแต่ละแห่ง', () => {
  assert.ok(privacy.intro.includes(`แอป ${PLATFORM_APP_NAME}`), 'Play: ต้องระบุชื่อแอปหรือผู้พัฒนาในนโยบาย')
  const orgs = sectionOf(privacy, 'controller').orgs
  assert.deepEqual(orgs.map((o) => [o.key, o.href]), [
    ['thungkaew', 'https://thungkaew.rk-networks.com/privacy'],
    ['namlao', 'https://namlao.rk-networks.com/privacy'],
  ])
  assert.deepEqual(orgs[0].contacts.map((c) => c.kind), ['address', 'phone', 'email'])
  assert.deepEqual(orgs[1].contacts.map((c) => c.kind), ['phone'], 'ช่องว่างไม่แสดง')
  assert.doesNotMatch(textOf(privacy), /undefined|null|NaN/)
})
check('ชื่อผู้พัฒนามาจากค่ากลางจุดเดียว ไม่ใช่ developer_name ของ อปท. (น้ำเลาใส่คำขวัญไว้ในช่องนั้น)', () => {
  const tagline = 'TEST คำขวัญท้ายเว็บ Smart Governance'
  const policy = buildPrivacyPolicy({ name: 'TEST ทต.ก', developer_name: tagline })
  assert.ok(!textOf(policy).includes(tagline))
  const line = sectionOf(policy, 'controller').paragraphs[1]
  assert.ok(line.includes(`แอป ${PLATFORM_APP_NAME}`), line)
  if (PLATFORM_DEVELOPER.name) assert.ok(line.startsWith(PLATFORM_DEVELOPER.name), line)
  else assert.ok(line.startsWith('ผู้พัฒนาและดูแลระบบและแอป'), line)
  assert.equal(sectionOf(policy, 'controller').paragraphs[1], sectionOf(privacy, 'controller').paragraphs[1], 'สองฉบับเรียกผู้พัฒนาเหมือนกัน')
})
check('หน้าลบบัญชีกลาง: อ้างชื่อแอป ทางลบเห็นชัด ไม่ต้องลงแอปใหม่ ลิงก์ไปหน้าลบของทุก อปท. (Play answer/13327111)', () => {
  assert.ok(deletion.intro.includes(`แอป ${PLATFORM_APP_NAME}`))
  assert.ok(deletion.intro.includes('ไม่ต้องติดตั้งแอปใหม่'))
  assert.equal(deletion.sections[0].id, 'steps', 'ขั้นตอนลบอยู่บนสุด')
  assert.ok(deletion.sections[0].steps.some((s) => s.includes(`"${ACCOUNT_DELETE_CONFIRM_WORD}"`)), 'คำยืนยันต้องตรงกับหน้าลบจริง')
  assert.deepEqual(deletion.sections[0].orgs.map((o) => o.href), [
    'https://thungkaew.rk-networks.com/account/delete', 'https://namlao.rk-networks.com/account/delete',
  ])
  assert.deepEqual(sectionOf(deletion, 'removed').items, ACCOUNT_DELETION_REMOVED)
  assert.deepEqual(sectionOf(deletion, 'kept').items, ACCOUNT_DELETION_KEPT)
  assert.doesNotMatch(textOf(deletion), /undefined|null|NaN/)
})
check('หน้าช่วยเหลือ: ช่องทางติดต่อทุก อปท. + ลิงก์หน้า /contact ของแต่ละแห่ง + คำตอบเรื่องเปลี่ยนหน่วยงาน', () => {
  assert.deepEqual(sectionOf(support, 'contacts').orgs.map((o) => o.href), [
    'https://thungkaew.rk-networks.com/contact', 'https://namlao.rk-networks.com/contact',
  ])
  assert.match(textOf(sectionOf(support, 'faq')), /เปลี่ยนหน่วยงาน/)
  assert.equal(Boolean(sectionOf(support, 'developer')), Boolean(PLATFORM_DEVELOPER.email), 'มีอีเมลผู้พัฒนาจึงแสดงหัวข้อนี้')
  assert.doesNotMatch(textOf(support), /undefined|null|NaN/)
})
check('ลิงก์ภายในของหน้ากลางทุกอันพาไปหน้ากลางที่มีอยู่จริง (ไม่หลุดไปหน้าเลือกหน่วยงาน)', () => {
  const links = [privacy, deletion, support].flatMap((doc) => doc.sections.flatMap((s) => s.links ?? []))
  assert.ok(links.length >= 4)
  for (const link of links) {
    assert.ok(platformPageFor(link.to.split('#')[0]), `${link.to} ไม่ใช่หน้ากลาง`)
  }
})
check('ไม่มีรายชื่อหน่วยงาน (โหลดไม่สำเร็จ/ยังไม่มี) ทุกหน้ายังวาดได้ ไม่มีคำว่า undefined', () => {
  for (const doc of [buildPlatformPrivacyPolicy([], APP_HOST), buildPlatformAccountDeletion([], APP_HOST), buildPlatformSupport([], APP_HOST)]) {
    assert.doesNotMatch(textOf(doc), /undefined|null|NaN/)
    assert.ok(doc.sections.every((s) => !s.orgs || Array.isArray(s.orgs)))
  }
})

console.log('โดเมนกลางไม่ถูกตีความเป็นรหัสหน่วยงาน')
check('detectTenantSlug: app/www/admin ไม่มี slug ทุก path · โดเมน อปท./vercel/dev ทำงานเหมือนเดิม', () => {
  const src = read('src/contexts/TenantContext.jsx')
  // \r?\n — เครื่อง Windows checkout เป็น CRLF
  const fnSrc = src.match(/function detectTenantSlug\(\) \{[\s\S]*?\r?\n\}\r?\n/)[0].replaceAll('import.meta.env.VITE_TENANT_SLUG', 'PINNED')
  const detect = (href, pinned = undefined) => {
    const url = new URL(href)
    return new Function('window', 'PINNED', `${fnSrc}; return detectTenantSlug()`)({ location: { hostname: url.hostname, pathname: url.pathname } }, pinned)
  }
  for (const href of ['https://app.rk-networks.com/privacy', 'https://app.rk-networks.com/', 'https://www.rk-networks.com/namlao', 'https://admin.rk-networks.com/support']) {
    assert.equal(detect(href), null, href)
  }
  assert.equal(detect('https://namlao.rk-networks.com/privacy'), 'namlao')
  assert.equal(detect('https://smartlocal-thungkaew.vercel.app/complaint'), 'thungkaew')
  assert.equal(detect('https://smartlocal.vercel.app/namlao/complaint'), 'namlao', 'path mode ของ deployment กลางยังอยู่')
  assert.equal(detect('http://localhost:5173/complaint', 'demo'), 'demo')
})

console.log('ทางเข้าในแอป')
check('main.jsx จำ ?via=app ก่อน render · เมนูเปลี่ยนหน่วยงานผูกกับ openedViaApp ทั้งสองธีม · ธีม kledkaew มีลิงก์นโยบาย', () => {
  const main = read('src/main.jsx')
  assert.ok(main.indexOf('captureViaApp()') > 0 && main.indexOf('captureViaApp()') < main.indexOf('createRoot('))
  for (const file of ['src/pages/MorePage.jsx', 'src/components/citizen/templates/Kledkaew/More.jsx']) {
    assert.match(read(file), /openedViaApp\(\) && \{[^}]*'เปลี่ยนหน่วยงาน'[^}]*platformHref\(`\/\?\$\{CHANGE_TENANT_PARAM\}=1`\)/, file)
  }
  assert.match(read('src/components/citizen/templates/Kledkaew/More.jsx'), /'นโยบายความเป็นส่วนตัว'[^}]*href: '\/privacy'/)
  // เมนู "ดาวน์โหลดแอป ท้องถิ่นของเรา" ไปหน้า /download ของโดเมนกลาง ทั้งสองธีม และซ่อนเมื่อใช้ผ่านแอป/ติดตั้งแล้ว
  for (const file of ['src/pages/MorePage.jsx', 'src/components/citizen/templates/Kledkaew/More.jsx']) {
    const src = read(file)
    assert.match(src, /shouldOfferAppDownload\(\{ installed: installState === 'installed' \}\)/, file)
    assert.match(src, /ดาวน์โหลดแอป ท้องถิ่นของเรา[^}]*platformHref\('\/download'\)/, file)
  }
  assert.match(read('src/App.jsx'), /platformPageFor\(location\.pathname\)/)
})

console.log(`\nผ่านทั้งหมด ${passed} ข้อ`)
