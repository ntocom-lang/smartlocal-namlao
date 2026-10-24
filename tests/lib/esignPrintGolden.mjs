// พิมพ์ค่า sha256 ของ HTML ใบแบบ ๓/สก.๑ "ก่อนใส่ลายเซ็นออนไลน์" — ใช้สร้างค่าอ้างอิงไว้ใน tests/esign-print.test.mjs
//   node tests/lib/esignPrintGolden.mjs
// ใบที่ไม่ใช่โหมดออนไลน์ต้องได้ HTML เหมือนเดิมทุกไบต์ (ห้ามกระทบ อปท. ที่ไม่เปิดใช้)
import crypto from 'node:crypto'
import { buildFleetSk1Html, buildFleetTripRequestHtml } from '../../src/lib/fleetTripPrint.js'
import { deptHead, orderAuthority, tenant, trip } from './esignPrintFixtures.mjs'

const sha = text => crypto.createHash('sha256').update(text).digest('hex')
export const goldenInputs = {
  form3Full: () => buildFleetTripRequestHtml({ trip, tenant, orderAuthority, deptHead }),
  form3Blank: () => buildFleetTripRequestHtml({ trip: { ...trip, approved_by: null, approver: null, status: 'pending' }, tenant }),
  form3Rejected: () => buildFleetTripRequestHtml({ trip: { ...trip, status: 'rejected', reject_reason: 'ไม่มีรถว่าง' }, tenant, orderAuthority }),
  sk1: () => buildFleetSk1Html({ trip: { ...trip, returned_at: '2026-09-01T09:30:00.000Z' }, tenant }),
}
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}` || process.argv[1]?.endsWith('esignPrintGolden.mjs')) {
  for (const [name, build] of Object.entries(goldenInputs)) console.log(name, sha(build()))
}
