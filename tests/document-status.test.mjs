// ป้ายสถานะของคำขอในกล่องงาน — คำขอที่ประชาชนถอนเองต้องไม่ขึ้นว่า "ปฏิเสธ"
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { displayDocStatus } from '../src/lib/documentTypes.js'

test('คำขอรถรับ-ส่งผู้ป่วยที่ผู้ยื่นยกเลิกเอง แสดงเป็น cancelled ไม่ใช่ rejected', () => {
  const req = { status: 'rejected', patient_transport_requests: { workflow_status: 'cancelled' } }
  assert.equal(displayDocStatus(req), 'cancelled')
  // PostgREST คืนค่าเป็น array ได้ถ้ามองความสัมพันธ์เป็นหนึ่งต่อหลาย ต้องอ่านได้ทั้งสองแบบ
  assert.equal(displayDocStatus({ status: 'rejected', patient_transport_requests: [{ workflow_status: 'cancelled' }] }), 'cancelled')
})

test('เรื่องที่ อปท. ปฏิเสธจริง ยังต้องเป็น rejected', () => {
  assert.equal(displayDocStatus({ status: 'rejected', patient_transport_requests: { workflow_status: 'rejected' } }), 'rejected')
  assert.equal(displayDocStatus({ status: 'rejected', patient_transport_requests: null }), 'rejected')
  assert.equal(displayDocStatus({ status: 'rejected' }), 'rejected')
})

test('สถานะอื่นผ่านตรงไม่เปลี่ยน และแถวที่ยังไม่มีข้อมูลไม่พัง', () => {
  for (const status of ['pending', 'processing', 'completed']) {
    assert.equal(displayDocStatus({ status }), status)
    assert.equal(displayDocStatus({ status, patient_transport_requests: { workflow_status: 'forwarded' } }), status)
  }
  assert.equal(displayDocStatus(null), undefined)
  assert.equal(displayDocStatus({}), undefined)
})

test('หน้าเจ้าหน้าที่ต้องเรียกผ่านฟังก์ชันนี้ ไม่ใช่อ่าน req.status ตรงๆ ที่ป้ายสถานะ', () => {
  const source = readFileSync(new URL('../src/pages/StaffDashboard.jsx', import.meta.url), 'utf8')
  assert.equal(source.includes('<StatusBadge status={req.status} />'), false, 'ป้ายสถานะต้องใช้ displayDocStatus')
  assert.equal((source.match(/<StatusBadge status=\{displayDocStatus\(req\)\} \/>/g) || []).length, 3)
  // ถ้าลืมดึงตารางลูกมาด้วย ฟังก์ชันจะคืน 'rejected' ตลอดและบั๊กกลับมาเงียบๆ
  assert.match(source, /patient_transport_requests\(workflow_status\)/)
})
