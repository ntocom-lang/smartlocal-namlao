// ไอคอนแอปแบบ maskable ที่สร้างจากโลโก้ อปท. ในเบราว์เซอร์ของแอดมิน
//
// manifest ที่มีแต่โลโก้แบบ "any" ทำให้ Android วางตราลงกล่องขาวแล้วย่อเหลือราว 64% ของกรอบ
// ส่วนไอคอน maskable ถูกขยายเต็มรูปทรงของ launcher (วงกลม/สี่เหลี่ยมมน) ตราจึงใหญ่ขึ้นชัดเจน
//
// ตราหน่วยงานเป็นวงกลมเต็มกรอบ ถ้าประกาศโลโก้เดิมเป็น maskable ขอบตราจะถูกขลิบ
// จึงวางตราลงพื้นขาวที่ 80% ของกรอบ = เส้นผ่านศูนย์กลางของ safe zone ตามสเปก
// (วงกลมรัศมี 40% กลางภาพ https://www.w3.org/TR/appmanifest/#icon-masks)
//
// ใช้ canvas ของเบราว์เซอร์ ไม่ต้องพึ่งบริการย่อรูปที่เสียเงิน — worker/manifestIcons.js เป็นฝั่งอ่าน

export const APP_ICON_SIZE = 512
export const APP_ICON_LOGO_RATIO = 0.8
export const APP_ICON_BACKGROUND = '#ffffff'

// ตำแหน่งวางโลโก้แบบ contain ในกล่อง 80% กลางภาพ — โลโก้ไม่จัตุรัสก็ไม่ยืดและไม่ล้น safe zone
export function appIconLayout(imgWidth, imgHeight, size = APP_ICON_SIZE, ratio = APP_ICON_LOGO_RATIO) {
  if (!(imgWidth > 0) || !(imgHeight > 0)) throw new Error('ขนาดโลโก้ไม่ถูกต้อง')
  const box = size * ratio
  const scale = box / Math.max(imgWidth, imgHeight)
  const width = Math.round(imgWidth * scale)
  const height = Math.round(imgHeight * scale)
  return {
    x: Math.round((size - width) / 2),
    y: Math.round((size - height) / 2),
    width,
    height,
  }
}

// รับ Blob ของโลโก้ (ไฟล์ที่เพิ่งอัปโหลด หรือที่ fetch มาจาก logo_url) คืน Blob PNG 512x512
export function buildAppIconBlob(logoBlob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(logoBlob)
    const img = new Image()
    const cleanup = () => {
      clearTimeout(timer)
      URL.revokeObjectURL(objectUrl)
    }
    // กันค้างแบบเดียวกับ resizeImage ใน SystemSettingsAdmin — decode ไม่ได้บางไฟล์ไม่ยิง onerror
    const timer = setTimeout(() => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('โหลดโลโก้เพื่อสร้างไอคอนแอปไม่สำเร็จ (หมดเวลา)'))
    }, 15000)

    img.onload = () => {
      try {
        const { x, y, width, height } = appIconLayout(img.naturalWidth, img.naturalHeight)
        const canvas = document.createElement('canvas')
        canvas.width = APP_ICON_SIZE
        canvas.height = APP_ICON_SIZE
        const ctx = canvas.getContext('2d')
        // พื้นทึบเต็มกรอบ — maskable ห้ามมีส่วนโปร่งใส ไม่งั้น launcher เติมสีดำ/สีเดาเอง
        ctx.fillStyle = APP_ICON_BACKGROUND
        ctx.fillRect(0, 0, APP_ICON_SIZE, APP_ICON_SIZE)
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, x, y, width, height)
        canvas.toBlob(blob => {
          cleanup()
          if (blob) resolve(blob)
          else reject(new Error('สร้างไฟล์ไอคอนแอปไม่สำเร็จ'))
        }, 'image/png')
      } catch (err) {
        cleanup()
        reject(err)
      }
    }
    img.onerror = () => {
      cleanup()
      reject(new Error('เปิดโลโก้เพื่อสร้างไอคอนแอปไม่สำเร็จ'))
    }
    img.src = objectUrl
  })
}
