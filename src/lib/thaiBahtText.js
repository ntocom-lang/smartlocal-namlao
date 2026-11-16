/**
 * แปลงจำนวนเงินตัวเลขเป็นตัวหนังสือภาษาไทย (Thai Baht Text)
 * สำหรับเอกสารการเงินและพัสดุราชการ (บก.01, ปร.6, บันทึกข้อความ)
 * Zero dependency · รองรับจำนวนเต็มและสตางค์ (ทศนิยม 2 ตำแหน่ง)
 */

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const POSITIONS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']

/**
 * แปลงตัวเลขกลุ่มไม่เกิน 6 หลัก (1 - 999,999) เป็นข้อความภาษาไทย
 * @param {string} digits สตริงตัวเลขความยาวไม่เกิน 6 หลัก
 * @returns {string}
 */
function convertGroup(digits) {
  const len = digits.length
  let text = ''

  for (let i = 0; i < len; i++) {
    const digit = Number(digits[i])
    const pos = len - i - 1

    if (digit === 0) continue

    if (pos === 0) {
      if (digit === 1 && len > 1) {
        text += 'เอ็ด'
      } else {
        text += DIGITS[digit]
      }
    } else if (pos === 1) {
      if (digit === 1) {
        text += 'สิบ'
      } else if (digit === 2) {
        text += 'ยี่สิบ'
      } else {
        text += DIGITS[digit] + 'สิบ'
      }
    } else {
      text += DIGITS[digit] + POSITIONS[pos]
    }
  }

  return text
}

/**
 * แปลงจำนวนเงินเป็นตัวหนังสือภาษาไทย
 * @param {number|string} amount จำนวนเงิน (เช่น 1250000.50 หรือ "1,250,000")
 * @returns {string} ข้อความบาทถ้วน หรือ บาท...สตางค์ (เช่น "หนึ่งล้านสองแสนห้าหมื่นบาทถ้วน")
 */
export function thaiBahtText(amount) {
  if (amount === null || amount === undefined || amount === '') return ''

  const cleanStr = String(amount).replace(/,/g, '').trim()
  const num = Number(cleanStr)

  if (!Number.isFinite(num) || num < 0) return ''

  const fixed = num.toFixed(2)
  const [bahtPart, satangPart] = fixed.split('.')

  let bahtText = ''
  if (BigInt(bahtPart) === 0n) {
    if (Number(satangPart) === 0) {
      return 'ศูนย์บาทถ้วน'
    }
  } else {
    const groups = []
    let str = bahtPart
    while (str.length > 0) {
      const take = Math.min(6, str.length)
      groups.unshift(str.slice(-take))
      str = str.slice(0, -take)
    }

    for (let i = 0; i < groups.length; i++) {
      const groupText = convertGroup(groups[i])
      bahtText += groupText
      const remainingMillions = groups.length - 1 - i
      if (remainingMillions > 0 && groupText.length > 0) {
        bahtText += 'ล้าน'
      }
    }
    bahtText += 'บาท'
  }

  const satangVal = Number(satangPart)
  if (satangVal === 0) {
    return bahtText + 'ถ้วน'
  }

  const satangText = convertGroup(satangPart) + 'สตางค์'
  return bahtText + satangText
}
