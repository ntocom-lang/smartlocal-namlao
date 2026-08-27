// PromptPay EMVCo QR payload generator (Thai standard)

function crc16(str) {
  let crc = 0xFFFF
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function tlv(tag, value) {
  return `${tag}${String(value.length).padStart(2, '0')}${value}`
}

/**
 * สร้าง PromptPay QR payload string
 * @param {string} target  เบอร์โทร (0812345678) หรือเลขประชาชน/นิติบุคคล 13 หลัก
 * @param {number} amount  จำนวนเงิน (บาท) — 0 = ไม่ระบุจำนวน
 */
export function generatePromptPayPayload(target, amount = 0) {
  if (!target) return null

  const isPhone = /^0[689]\d{8}$/.test(target)
  const formattedTarget = isPhone
    ? '0066' + target.slice(1)  // 0812345678 → 0066812345678
    : target                     // เลขบัตร/นิติบุคคล ใช้ตรง

  const subTag = isPhone ? '01' : '02'

  const guid = 'A000000677010111'
  const merchantAcct = tlv('00', guid) + tlv(subTag, formattedTarget)

  const parts = [
    tlv('00', '01'),
    // Point of Initiation Method: '11' = static QR (สแกนซ้ำได้ ไม่ระบุจำนวนเงิน)
    // '12' = dynamic QR (ใช้ครั้งเดียว มีจำนวนเงินกำกับ) เดิม hardcode '12' ไว้ตลอด
    // ทำให้ QR ที่ไม่ระบุจำนวนเงินถูกแอปธนาคารบางตัวปฏิเสธเมื่อสแกนซ้ำ
    tlv('01', amount > 0 ? '12' : '11'),
    tlv('29', merchantAcct),
    tlv('53', '764'),
    ...(amount > 0 ? [tlv('54', amount.toFixed(2))] : []),
    tlv('58', 'TH'),
    '6304',
  ]

  const payload = parts.join('')
  return payload + crc16(payload)
}
