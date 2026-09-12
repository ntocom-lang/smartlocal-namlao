// เทสต์การแปลงค่า online_url เป็นลิงก์ปุ่มบริการออนไลน์ของโมดูลเที่ยว กิน พัก ชอป บริการ
// รันด้วย: node tests/tourism-service-url.test.mjs
//
// ที่มา: ปุ่ม "สั่งซื้อเลย" ของ วิสาหกิจชุมชนน้ำพริกลาบริมยม (ทุ่งแค้ว) กดแล้วได้หน้าขาว
// เพราะ online_url เก็บเบอร์โทร "0983819257" ไว้ แล้วถูกยัดลง href ดิบๆ
import assert from 'node:assert/strict'
import { resolveServiceUrl, serviceChannelLabel } from '../src/lib/tourismPlaces.js'

const at = (online_url, phone = null) => resolveServiceUrl({ online_url, phone })

// ── ลิงก์ปกติ ผ่านตรงๆ ไม่แตะต้อง ────────────────────────────────────────────
// (เคสนี้คือร้านส่วนใหญ่ที่ทำงานดีอยู่แล้ว ห้ามเปลี่ยนพฤติกรรมเด็ดขาด)
assert.deepEqual(at('https://shopee.co.th/bannrimyom'),
  { href: 'https://shopee.co.th/bannrimyom', kind: 'web', source: 'online_url' })
assert.equal(at('http://example.com/x').kind, 'web')
assert.equal(at('http://example.com/x').href, 'http://example.com/x')

// ── ด่านความปลอดภัย: scheme นอก allowlist ต้องไม่ออกมาเป็นลิงก์เด็ดขาด ─────────
for (const evil of [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'java\tscript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
]) {
  assert.equal(at(evil), null, `ต้องปฏิเสธ scheme อันตราย: ${evil}`)
  // ถ้าร้านมีเบอร์โทร ให้ตกไปใช้เบอร์ ไม่ใช่เอา scheme อันตรายมาใช้
  assert.equal(at(evil, '053-123456').kind, 'phone', `ต้องตกไปใช้เบอร์แทน: ${evil}`)
}

// ── เบอร์โทรล้วน (เคสจริงของน้ำพริกลาบริมยม) ──────────────────────────────────
assert.deepEqual(at('0983819257'),
  { href: 'tel:0983819257', kind: 'phone', source: 'online_url' })
assert.equal(at('098-381-9257').href, 'tel:0983819257')
assert.equal(at('098 381 9257').href, 'tel:0983819257')
assert.equal(at('(098) 381-9257').href, 'tel:0983819257')
// เบอร์บ้าน 9 หลัก
assert.equal(at('054620111').href, 'tel:054620111')
// tel: ที่พิมพ์มาเต็มรูปแบบแล้ว
assert.equal(at('tel:0983819257').kind, 'phone')

// ── Line ID (เคสจริงของร้านจิปาถะ) ────────────────────────────────────────────
// "ld.0876084038" มีจุดแต่ไม่ใช่โดเมน — ถ้าเผลอเติม https:// จะได้ลิงก์ที่เปิดไม่ได้
assert.deepEqual(at('ld.0876084038'),
  { href: 'https://line.me/R/ti/p/~ld.0876084038', kind: 'line', source: 'online_url' })
assert.equal(at('riimyom').href, 'https://line.me/R/ti/p/~riimyom')
assert.equal(at('shop_2569').href, 'https://line.me/R/ti/p/~shop_2569')
// Official Account ขึ้นต้นด้วย @ ใช้รูปแบบไม่มี ~
assert.deepEqual(at('@bannrimyom'),
  { href: 'https://line.me/R/ti/p/@bannrimyom', kind: 'line', source: 'online_url' })
// ลิงก์ line.me ที่กรอกมาเต็มแล้ว ต้องรู้ว่าเป็น line ไม่ใช่ web ทั่วไป
assert.equal(at('https://line.me/R/ti/p/@bannrimyom').kind, 'line')
assert.equal(at('https://lin.ee/abc123').kind, 'web')  // ลิงก์ย่อ ตีเป็นเว็บ เปิดได้เหมือนกัน
assert.equal(at('line://ti/p/@bannrimyom').kind, 'line')
// สั้นกว่า 4 ตัวไม่ใช่ Line ID ที่ถูกต้อง
assert.equal(at('abc'), null)

// ── โดเมนที่ลืมใส่ scheme ─────────────────────────────────────────────────────
assert.equal(at('www.facebook.com/bannrimyom').href, 'https://www.facebook.com/bannrimyom')
assert.equal(at('www.facebook.com/bannrimyom').kind, 'web')
assert.equal(at('shopee.co.th/x?sp=1').href, 'https://shopee.co.th/x?sp=1')
assert.equal(at('//example.com/x').href, 'https://example.com/x')

// ── เดาไม่ออก → ตกไปใช้เบอร์ร้าน ถ้าไม่มีเบอร์ก็ไม่ต้องแสดงปุ่ม ────────────────
assert.equal(at('ทักไลน์ได้เลยครับ'), null)
assert.deepEqual(at('ทักไลน์ได้เลยครับ', '087-177-2405'),
  { href: 'tel:0871772405', kind: 'phone', source: 'phone' })
assert.equal(at(''), null)
assert.equal(at(null), null)
assert.equal(at(undefined), null)
assert.equal(at('   '), null)
assert.equal(resolveServiceUrl(null), null)
assert.equal(resolveServiceUrl({}), null)

// ── ช่องว่างหัวท้ายต้องไม่ทำให้ค่าดีๆ ตกเคส ────────────────────────────────────
assert.equal(at('  https://shopee.co.th/x  ').kind, 'web')
assert.equal(at('  0983819257  ').href, 'tel:0983819257')

// ── เบอร์ร้านที่ใช้ fallback ต้องเป็นเบอร์ที่ใช้ได้จริงเท่านั้น ─────────────────
assert.equal(at('', 'ติดต่อที่ อบต.'), null)
assert.equal(at('', '123'), null)

// ── ป้ายปุ่มต้องบอกช่องทางจริง ──
const lb = serviceChannelLabel
assert.equal(lb('order', 'phone'), 'โทรสั่งซื้อ')
assert.equal(lb('book', 'phone'), 'โทรจอง')
assert.equal(lb('line', 'phone'), 'โทรติดต่อร้าน')
assert.equal(lb('website', 'phone'), 'โทรติดต่อร้าน')
assert.equal(lb('order', 'line'), 'สั่งซื้อทาง LINE')
assert.equal(lb('book', 'line'), 'จองทาง LINE')
assert.equal(lb('website', 'line'), 'ติดต่อทาง LINE')
// kind 'web' ใช้ป้ายเดิมของแต่ละหน้า ห้ามเปลี่ยนคำที่ใช้อยู่
assert.equal(lb('order', 'web'), null)
assert.equal(lb('book', 'web'), null)
// แบบสั้นสำหรับปุ่มใต้การ์ดในหน้ารวม (พื้นที่แคบ ตัวอักษร 11px)
assert.equal(lb('order', 'phone', { short: true }), 'โทรสั่ง')
assert.equal(lb('website', 'phone', { short: true }), 'โทร')
assert.equal(lb('order', 'line', { short: true }), 'LINE')
assert.equal(lb('book', 'line', { short: true }), 'LINE')
for (const svc of ['order', 'book', 'line', 'website']) {
  for (const kind of ['phone', 'line']) {
    assert.ok(lb(svc, kind, { short: true }).length <= 9, `ป้ายสั้นต้องไม่ยาวเกิน: ${svc}/${kind}`)
  }
}

console.log('✅ tourism-service-url: ผ่านทั้งหมด')
