// ล็อกตัวเลขสรุปรายเดือน ฝั่งหน้าจอ (เฟส 2 ส่วน 2/2) — src/lib/complaintMonthlyLock.js · MonthlyLockPanel.jsx · ComplaintStats.jsx
//   ชั้นแรก: ตรรกะล้วน (สิทธิ์ · ความต่างของตัวเลข · ข้อความ error) + อ่านซอร์สเทียบกับ migration ฝั่งฐานข้อมูล
//   ชั้นสอง: เรนเดอร์แผงจริงใน Chrome แล้วกดปุ่มจริง (ขั้นตอนยืนยัน · เหตุผลบังคับเมื่อล็อกใหม่ · กดซ้ำไม่ยิงซ้ำ)
// ไม่ใช้เน็ต ไม่ใช้บัญชี ไม่แตะฐานข้อมูล
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { bundleEntry } from './lib/infographicBrowser.mjs'

const Lock = await import('../src/lib/complaintMonthlyLock.js')
const { LOCK_ROLES, canLockMonth, categoryCountsOf, issueRowsOf, lockErrorText, noteIsValid, statsDifferences } = Lock

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261019140000_complaint_monthly_snapshots.sql')
const page = read('src/pages/ComplaintStats.jsx')

let cases = 0
const test = async (label, run) => {
  await run()
  cases++
  console.log('PASS ' + label)
}

await test('บทบาทที่เห็นปุ่มล็อกตรงกับบทบาทที่ฟังก์ชันฐานข้อมูลยอมให้ล็อก (ไม่มีปุ่มหลอก/ไม่มีผู้มีสิทธิ์ที่ไม่เห็นปุ่ม)', () => {
  const match = /v_role IN \(([^)]*)\)/.exec(migration)
  assert.ok(match, 'ต้องเจอเงื่อนไขบทบาทในฟังก์ชัน publish')
  const dbRoles = [...match[1].matchAll(/'([a-z]+)'/g)].map(m => m[1]).sort()
  assert.deepEqual([...LOCK_ROLES].sort(), dbRoles)
  assert.ok(migration.includes("v_role = 'superadmin'"))
})

await test('สิทธิ์เห็นปุ่ม: admin/officer/staff/superadmin เห็น · viewer/council/technician/citizen/ว่าง ไม่เห็น', () => {
  for (const role of ['admin', 'officer', 'staff', 'superadmin']) assert.equal(canLockMonth(role), true, role)
  for (const role of ['viewer', 'council', 'technician', 'citizen', '', null, undefined, 'ADMIN']) assert.equal(canLockMonth(role), false, String(role))
})

await test('ความต่างของตัวเลข: เท่ากัน = ว่าง · bigint สตริงเทียบเท่าตัวเลข · เรียงตามลำดับฟิลด์ · null เทียบกับตัวเลขนับว่าต่าง', () => {
  const locked = { total: 39, open: 1, in_progress: 1, resolved: 37, rejected: 0, avg_days: 1.5 }
  assert.deepEqual(statsDifferences(locked, { ...locked, total: '39', resolved: '37' }), [])
  const diff = statsDifferences(locked, { total: 40, open: 1, in_progress: 0, resolved: 39, rejected: 0, avg_days: null })
  assert.deepEqual(diff.map(d => [d.key, d.locked, d.live]), [['total', 39, 40], ['resolved', 37, 39], ['in_progress', 1, 0], ['avg_days', 1.5, null]])
  assert.ok(diff.every(d => typeof d.label === 'string' && d.label.length > 0))
  assert.deepEqual(statsDifferences(null, locked), [])
  assert.deepEqual(statsDifferences(locked, undefined), [])
})

await test('ยอดรายหมวดจากชุดที่ล็อก: ตัดแถวผิดรูป (ชื่อว่าง/ไม่ใช่สตริง/ยอดติดลบ/ไม่ใช่ตัวเลข) แปลง bigint สตริง', () => {
  const counts = categoryCountsOf({ categories: [
    { category: 'light', total: '9' }, { category: 'water', total: 4 }, { category: '', total: 1 }, { category: 5, total: 1 },
    { category: 'bad', total: -1 }, { category: 'nan', total: 'abc' }, null, { total: 3 },
  ] })
  assert.deepEqual(counts, [{ category: 'light', total: 9 }, { category: 'water', total: 4 }])
  assert.deepEqual(categoryCountsOf(null), [])
  assert.deepEqual(categoryCountsOf({ categories: 'x' }), [])
})

await test('รายการย่อยจากชุดที่ล็อก: หาตามหมวด · ไม่มี/ผิดรูป = null', () => {
  const snapshot = { issue_breakdown: [{ category: 'light', rows: [{ issue_label: 'ไฟกระพริบ', total: 2 }] }] }
  assert.deepEqual(issueRowsOf(snapshot, 'light'), [{ issue_label: 'ไฟกระพริบ', total: 2 }])
  assert.equal(issueRowsOf(snapshot, 'trash'), null)
  assert.equal(issueRowsOf({ issue_breakdown: [] }, 'light'), null)
  assert.equal(issueRowsOf({ issue_breakdown: [{ category: 'light', rows: 'x' }] }, 'light'), null)
  assert.equal(issueRowsOf(null, 'light'), null)
})

await test('ข้อความ error ของการล็อก: ข้อความไทยที่ฐานข้อมูลยกเองแสดงตรงๆ · ข้อความอื่น/ภาษาอังกฤษไม่แสดงดิบ', () => {
  assert.ok(lockErrorText({ code: '42501', message: 'x' }).includes('ไม่มีสิทธิ์'))
  assert.ok(lockErrorText({ code: '40001', message: 'x' }).includes('กดอีกครั้ง'))
  assert.equal(lockErrorText({ code: '22023', message: 'เดือนนี้ล็อกไว้แล้ว และตัวเลขตอนนี้ต่างจากที่ล็อก — ต้องระบุเหตุผลที่ล็อกใหม่' }),
    'เดือนนี้ล็อกไว้แล้ว และตัวเลขตอนนี้ต่างจากที่ล็อก — ต้องระบุเหตุผลที่ล็อกใหม่')
  assert.ok(lockErrorText({ code: '22023', message: 'invalid input syntax for type date: "x"' }).includes('ไม่สำเร็จ'))
  assert.ok(lockErrorText({ code: 'PGRST202', message: 'Could not find the function' }).includes('ยังไม่พร้อม'))
  for (const error of [null, undefined, {}, { code: 'XX000', message: 'secret internal detail' }, new TypeError('Failed to fetch')]) {
    const text = lockErrorText(error)
    assert.ok(text.includes('ไม่สำเร็จ') && !text.includes('secret') && !text.includes('fetch'), String(error))
  }
})

await test('เหตุผลที่ล็อกใหม่: ตัดช่องว่างแล้วต้อง 5–500 ตัวอักษร', () => {
  assert.equal(noteIsValid('  สั้น '), false)
  assert.equal(noteIsValid('     '), false)
  assert.equal(noteIsValid(null), false)
  assert.equal(noteIsValid('มีเรื่องปิดหลังเผยแพร่'), true)
  assert.equal(noteIsValid('ก'.repeat(500)), true)
  assert.equal(noteIsValid('ก'.repeat(501)), false)
})

await test('หน้า ComplaintStats: ถามชุดที่ล็อกด้วยวันที่ 1 ของเดือน เฉพาะเดือนที่จบแล้ว · ล็อกโดยส่งแค่ อปท./เดือน/เหตุผล (ไม่ส่งตัวเลขจากหน้าจอ)', () => {
  assert.ok(page.includes("supabase.rpc('complaint_monthly_snapshot_get', {\n            _municipality_id: tenantId, _period_month: selectedMonth.from,")
    || /rpc\('complaint_monthly_snapshot_get',\s*\{\s*_municipality_id: tenantId, _period_month: selectedMonth\.from,/.test(page))
  assert.ok(page.includes('selectedMonth && !isCurrentMonth(selectedMonth) ? [supabase.rpc('))
  const publish = /rpc\('publish_complaint_monthly_snapshot',\s*\{([^}]*)\}\)/.exec(page)
  assert.ok(publish, 'ต้องเรียก publish_complaint_monthly_snapshot')
  const keys = [...publish[1].matchAll(/(_[a-z_]+):/g)].map(m => m[1])
  assert.deepEqual(keys, ['_municipality_id', '_period_month', '_note'], 'ห้ามส่งตัวเลขจากหน้าจอไปให้ฐานข้อมูล')
})

await test('หน้า ComplaintStats: เดือนที่ล็อกใช้ชุดที่ล็อกทั้งหน้า · แผงล็อกเห็นเฉพาะผู้มีสิทธิ์/เดือนที่จบแล้ว/ฟังก์ชันตอบได้ · แผงอยู่เหนือการ์ดภาพ', () => {
  assert.ok(page.includes('const stats = lockedSnapshot ? lockedSnapshot.stats : liveStats'))
  assert.ok(page.includes('categoryCounts: lockedCategoryCounts'))
  assert.ok(page.includes('lock: lockedSnapshot ? { publishedAt: lockedSnapshot.published_at, revision: lockedSnapshot.revision } : null'))
  assert.ok(page.includes('const showLockPanel = !!selectedMonth && snapshot.supported && canLockMonth(role) && !isCurrentMonth(selectedMonth)'))
  assert.ok(page.includes('const isTruncated = !lockedSnapshot && stats?.total > rows.length'))
  const panelAt = page.indexOf('<MonthlyLockPanel')
  const infographicAt = page.indexOf('<ComplaintMonthlyInfographic')
  assert.ok(panelAt > 0 && infographicAt > panelAt, 'แผงล็อกต้องมาก่อนการ์ดภาพ')
  assert.equal(page.split('<MonthlyLockPanel').length - 1, 1)
})

await test('หมวดที่ดึงยอดย่อยในหน้าเว็บ = หมวดที่ฟังก์ชันล็อกเก็บยอดย่อยใน SQL (สองที่ต้องตรงกัน)', () => {
  const sql = /c_breakdown_category constant text := '([a-z_]+)'/.exec(migration)?.[1]
  const web = /const ISSUE_BREAKDOWN_CATEGORY = '([a-z_]+)'/.exec(page)?.[1]
  assert.ok(sql && web)
  assert.equal(web, sql)
})

// ── ชั้นสอง: แผงจริงใน Chrome ──
const bundle = await bundleEntry(fileURLToPath(new URL('./lib/lockPanelEntry.js', import.meta.url)), 'LockPanelBundle')
const browser = await chromium.launch({ channel: 'chrome' })
try {
  const tab = await browser.newPage()
  await tab.route('**/*', route => route.abort())
  await tab.setContent('<!doctype html><body></body>')
  await tab.addScriptTag({ content: bundle })
  // onPublish ของแผงถูกแทนด้วยตัวบันทึกการเรียก: ผลลัพธ์/ความหน่วงกำหนดจากเทสต์
  await tab.evaluate(() => {
    window.__calls = []
    window.__next = { result: { unchanged: false }, delay: 0 }
    window.__publish = note => {
      window.__calls.push(note)
      return new Promise(resolve => setTimeout(() => resolve(window.__next.result), window.__next.delay))
    }
  })
  const reset = () => tab.evaluate(() => { window.LockPanelBundle.unmountAll(); window.__calls = []; window.__next = { result: { unchanged: false }, delay: 0 } })
  const mount = props => tab.evaluate(p => { window.LockPanelBundle.mount(p) }, props)
  const settle = () => tab.waitForTimeout(80)
  const text = () => tab.locator('[data-testid="monthly-lock-panel"]').innerText()
  const button = name => tab.getByRole('button', { name })
  const STATS = { total: 39, open: 1, in_progress: 1, resolved: 37, rejected: 0, avg_days: 1.5 }
  const LOCKED = { revision: 1, publishedAtText: '2 พฤษภาคม 2569' }

  await test('แผง (ยังไม่ล็อก): ปุ่มเดียว → ยืนยัน 1 ครั้ง → เรียกล็อกโดยไม่มีเหตุผล (null) · ยกเลิกแล้วไม่เรียก', async () => {
    await reset()
    await mount({ monthLabel: 'กันยายน 2569', lock: null, lockedStats: null, liveStats: STATS })
    assert.ok((await text()).includes('ยังเป็นตัวเลขสด'))
    assert.equal(await tab.getByRole('button').count(), 1)
    await button('ล็อกตัวเลขของเดือนนี้').click()
    assert.ok((await text()).includes('ล็อกตัวเลขที่เห็นอยู่ตอนนี้ใช่ไหม'))
    await button('ยกเลิก').click()
    assert.equal(await tab.evaluate(() => window.__calls.length), 0)
    await button('ล็อกตัวเลขของเดือนนี้').click()
    await button('ยืนยันล็อก').click()
    await settle()
    assert.deepEqual(await tab.evaluate(() => window.__calls), [null])
    assert.ok((await text()).includes('ล็อกตัวเลขแล้ว'))
  })

  await test('แผง (ล็อกแล้วและตัวเลขสดเท่าเดิม): บอกว่าล็อกแล้วเมื่อไร ไม่มีปุ่มให้กด (ไม่มีงานให้ทำ)', async () => {
    await reset()
    await mount({ monthLabel: 'กันยายน 2569', lock: LOCKED, lockedStats: STATS, liveStats: { ...STATS } })
    const content = await text()
    assert.ok(content.includes('ล็อกตัวเลขแล้วเมื่อวันที่ 2 พฤษภาคม 2569'))
    assert.ok(!content.includes('แก้ไขครั้งที่'))
    assert.equal(await tab.getByRole('button').count(), 0)
    await reset()
    await mount({ monthLabel: 'กันยายน 2569', lock: { revision: 3, publishedAtText: '9 พฤษภาคม 2569' }, lockedStats: STATS, liveStats: STATS })
    assert.ok((await text()).includes('(แก้ไขครั้งที่ 2)'))
  })

  await test('แผง (ล็อกแล้วแต่ตัวเลขสดต่าง): แสดงความต่าง · ล็อกใหม่ต้องพิมพ์เหตุผล (≥ 5 ตัวอักษร) · ส่งเหตุผลที่ตัดช่องว่างแล้ว', async () => {
    await reset()
    await mount({ monthLabel: 'กันยายน 2569', lock: LOCKED, lockedStats: STATS, liveStats: { ...STATS, resolved: 38, in_progress: 0 } })
    const content = await text()
    assert.ok(content.includes('เสร็จสิ้น: ล็อกไว้ 37 · ตอนนี้ 38'))
    assert.ok(content.includes('กำลังดำเนินการ: ล็อกไว้ 1 · ตอนนี้ 0'))
    await button('ล็อกใหม่ด้วยตัวเลขปัจจุบัน').click()
    const confirm = button('ยืนยันล็อกใหม่')
    assert.equal(await confirm.isDisabled(), true, 'ไม่มีเหตุผล = กดไม่ได้')
    await tab.locator('#lock-note').fill('สั้น')
    assert.equal(await confirm.isDisabled(), true, 'เหตุผลสั้นกว่า 5 = กดไม่ได้')
    await tab.locator('#lock-note').fill('  มีเรื่องปิดหลังเผยแพร่รอบแรก  ')
    assert.equal(await confirm.isDisabled(), false)
    await confirm.click()
    await settle()
    assert.deepEqual(await tab.evaluate(() => window.__calls), ['มีเรื่องปิดหลังเผยแพร่รอบแรก'])
  })

  await test('ฐานข้อมูลปฏิเสธ: แสดงข้อความไทยที่เข้าใจได้ ไม่ปิดแผง · ผลคือ "ไม่มีอะไรเปลี่ยน" ก็บอกตรงๆ', async () => {
    await reset()
    await mount({ monthLabel: 'กันยายน 2569', lock: null, lockedStats: null, liveStats: STATS })
    await tab.evaluate(() => { window.__next = { result: { error: { code: '42501', message: 'permission denied' } }, delay: 0 } })
    await button('ล็อกตัวเลขของเดือนนี้').click()
    await button('ยืนยันล็อก').click()
    await settle()
    assert.ok((await tab.getByRole('alert').innerText()).includes('ไม่มีสิทธิ์ล็อกตัวเลข'))
    assert.ok(!(await text()).includes('permission denied'))
    await tab.evaluate(() => { window.__next = { result: { unchanged: true }, delay: 0 } })
    await button('ยืนยันล็อก').click()
    await settle()
    assert.ok((await text()).includes('เท่ากับที่ล็อกไว้แล้ว'))
  })

  await test('กดซ้ำระหว่างรอ: ยิงล็อกครั้งเดียว (ปุ่มปิดระหว่างทำงาน)', async () => {
    await reset()
    await mount({ monthLabel: 'กันยายน 2569', lock: null, lockedStats: null, liveStats: STATS })
    await tab.evaluate(() => { window.__next = { result: { unchanged: false }, delay: 400 } })
    await button('ล็อกตัวเลขของเดือนนี้').click()
    const confirm = button('ยืนยันล็อก')
    await confirm.click()
    await tab.waitForTimeout(40)
    assert.equal(await tab.getByRole('button', { name: 'กำลังล็อก...' }).isDisabled(), true)
    await tab.evaluate(() => document.querySelector('[data-testid="monthly-lock-panel"] button')?.click())
    await tab.waitForTimeout(500)
    assert.equal(await tab.evaluate(() => window.__calls.length), 1)
  })
} finally {
  await browser.close()
}

console.log(`\n${cases} cases passed`)
