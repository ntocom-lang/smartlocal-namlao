// ข้อมูลทดสอบของใบพิมพ์ลงนามออนไลน์ (ชุด S4) — ใช้ร่วมกันระหว่างเทสต์เนื้อหา (Node) และเทสต์เลย์เอาต์ (เบราว์เซอร์)
import zlib from 'node:zlib'

export const tenant = { name: 'เทศบาลตำบลสาธิต', province: 'แพร่' }

export const VERIFY_CODE = '0123456789abcdef0123456789abcdef'
export const VERIFY_URL = `https://demo.example.go.th/v/${VERIFY_CODE}`

// แบบ ๓ เนื้อหายาวที่สุดที่เจอได้จริง (เหมือน tests/fleet-form3-layout.test.mjs) — ใบต้องจบ 1 หน้าแม้ลงนามออนไลน์ครบ
export const trip = {
  id: 't1',
  status: 'approved',
  created_at: '2026-09-01T02:00:00.000Z',
  planned_departure: '2026-09-01T02:00:00.000Z',
  planned_return: '2026-09-01T09:00:00.000Z',
  destination: 'ศาลากลางจังหวัดแพร่ และสำนักงานส่งเสริมการปกครองท้องถิ่นจังหวัดแพร่',
  destination_locality: 'อำเภอเมืองแพร่',
  destination_province: 'แพร่',
  purpose: 'ประชุมชี้แจงแนวทางการปฏิบัติงานประจำปีงบประมาณ',
  passengers: 4,
  requester: { full_name: 'นางสาวจันทร์จิรา คันธสังข์', job_title: 'นักจัดการงานทั่วไปชำนาญการ' },
  requester_position: 'นักจัดการงานทั่วไปชำนาญการ',
  driver: { full_name: 'นายสมศักดิ์ ขับเคลื่อนยานยนต์' },
  vehicle: { license_plate: 'กข 1234 แพร่' },
  approved_by: 'x',
  approver: { full_name: 'นายสมนึก ธนเดชากุล' },
}

export const onlineTrip = { ...trip, approved_by: null, approver: null, esign_slots: { requester: 'online', dept_head: 'online', authority: 'online', sk1: 'wet' }, esign_verify_code: VERIFY_CODE }

export const orderAuthority = { name: 'นายสมนึก ธนเดชากุล', title: 'นายกเทศมนตรีตำบลสาธิต' }
export const deptHead = { name: 'นางสาวจันทร์จิรา คันธสังข์', title: 'ผู้อำนวยการกองสาธารณสุขและสิ่งแวดล้อม' }

// PNG โปร่งใสเล็กๆ ที่ถอดรหัสได้จริง (เส้นเฉียงสีน้ำเงิน) — ใช้ตรวจว่าภาพโผล่ในใบและขนาดไม่ดันเลย์เอาต์
const crc = (type, data) => {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const sum = Buffer.alloc(4); sum.writeUInt32BE(zlib.crc32(body) >>> 0)
  return Buffer.concat([length, body, sum])
}
export function samplePng(width = 320, height = 120) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4)
    for (let x = 0; x < width; x++) {
      const onStroke = Math.abs((x * height) / width - (height - y)) < 3
      row.set(onStroke ? [20, 40, 160, 255] : [0, 0, 0, 0], 1 + x * 4)
    }
    rows.push(row)
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), crc('IHDR', ihdr), crc('IDAT', zlib.deflateSync(Buffer.concat(rows))), crc('IEND', Buffer.alloc(0))])
}

// ── สถานะทริปจำลองตามรูปของ esign_trip_status + ภาพที่แนบตามรูปของ esign_trip_stamps ──
export const PNG = samplePng(80, 30).toString('base64')
export const slotStatus = (slot, extra = {}) => ({
  slot, label: slot, mode: 'online', applicable: true, signed: false, signature: null, ...extra,
})
export const signature = (name, extra = {}) => ({
  signer_name: name, signer_position: 'ตำแหน่งของ ' + name, signed_as: '', decision: 'sign', signed_at: '2026-10-23T04:00:00Z', content_matches: true, mine: false, with_image: true, ...extra,
})
// ทริปที่ลงนามครบสามช่อง (ผู้ขอ/ผอ.กอง/ผู้มีอำนาจ) สก.๑ เซ็นสด
export const fullStatus = (overrides = {}) => ({
  found: true, mode: 'online', verify_code: VERIFY_CODE, trip_status: 'approved', complete: true,
  slots: [
    slotStatus('requester', { signed: true, signature: signature('นางสาวผู้ขอ ทดสอบ') }),
    slotStatus('dept_head', { signed: true, signature: signature('นางผอ. กองทดสอบ', { signed_as: 'ผู้อำนวยการกองช่าง', signed_at: '2026-10-23T05:30:00Z' }) }),
    slotStatus('authority', { signed: true, signature: signature('นายนายก ทดสอบ', { decision: 'approve', signed_as: 'นายกเทศมนตรีตำบลสาธิต', signed_at: '2026-10-23T06:45:00Z' }) }),
    slotStatus('sk1', { mode: 'wet', applicable: false }),
  ],
  ...overrides,
})
export const stampsFor = slots => ({ ok: true, items: slots.map(slot => ({ slot, signature_id: 's-' + slot, width: 80, height: 30, png_base64: PNG })) })
