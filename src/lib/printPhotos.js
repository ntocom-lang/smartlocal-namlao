// โหลดรูปของคำร้องมาฝังในเอกสารพิมพ์ (ใช้กับแผ่น "ภาพประกอบคำร้อง" — complaintPhotoSheet.js)
//
// ทำไมต้องดึงมาฝังเป็น data URL ก่อน แทนที่จะใส่ <img src="…"> ตรงๆ ในหน้าต่างพิมพ์:
//   - รูป private ('drive:FILE_ID') ต้องแนบ access token ถึงจะอ่านได้ ใส่เป็น src ตรงๆ ไม่ได้
//   - หน้าต่างพิมพ์ที่เปิดด้วย document.write ไม่การันตีว่ารูปโหลดเสร็จก่อน print() (ของเดิมสั่งพิมพ์ที่ 0.5 วินาที)
// ไฟล์นี้ไม่ import driveStorage เอง (ผู้เรียกส่ง fetchImage เข้ามา) เพื่อให้เทสต์ใน node รันได้โดยไม่ต้องมี supabase client

function textRef(item) {
  if (typeof item === 'string') return item.trim()
  if (item && typeof item.url === 'string') return item.url.trim()
  return ''
}

function uniqueRefs(list) {
  const seen = new Set()
  const refs = []
  for (const item of Array.isArray(list) ? list : []) {
    const ref = textRef(item)
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    refs.push(ref)
  }
  return refs
}

// รูปที่ผูกกับคำร้อง: attachments = จากผู้แจ้ง (ก่อนดำเนินการ), work_photos = จากเจ้าหน้าที่ (หลังดำเนินการ)
// extraWorkPhotos = รูปที่เพิ่งอัปโหลดในหน้าจอนี้ แต่ข้อมูลคำร้องในหน้ายังไม่อัปเดตตาม
// ⚠️ คีย์ที่ไม่มีในข้อมูล (สิทธิ์ viewer/council ถูกตัดออกจาก get_complaint_private_detail) = ไม่มีรูปให้พิมพ์ → ไม่มีปุ่ม
export function complaintPhotoRefs(c, extraWorkPhotos = []) {
  return {
    before: uniqueRefs(c?.attachments),
    after: uniqueRefs([...(Array.isArray(c?.work_photos) ? c.work_photos : []), ...extraWorkPhotos]),
  }
}

export function complaintPhotoCount(c, extraWorkPhotos = []) {
  const { before, after } = complaintPhotoRefs(c, extraWorkPhotos)
  return before.length + after.length
}

// fetchImage(ref) → { dataUrl, error } (ดู fetchImageAsDataUrl ใน driveStorage.js)
// คืน { before, after } ตามลำดับเดิม; รูปที่โหลดไม่ได้เป็น { src: null } ไม่ถูกตัดทิ้ง
export async function loadPrintPhotos(c, fetchImage, extraWorkPhotos = []) {
  const refs = complaintPhotoRefs(c, extraWorkPhotos)
  const load = async (ref) => {
    try {
      const { dataUrl, error } = await fetchImage(ref)
      if (error || !dataUrl) return { src: null }
      return { src: dataUrl }
    } catch {
      return { src: null }
    }
  }
  const [before, after] = await Promise.all([
    Promise.all(refs.before.map(load)),
    Promise.all(refs.after.map(load)),
  ])
  return { before, after }
}

// รอให้รูปในหน้าต่างพิมพ์ถอดรหัสครบ (และรออย่างน้อย minWaitMs เท่าของเดิมเพื่อให้ฟอนต์ทัน) แล้วค่อยสั่งพิมพ์
// timeoutMs กันรูปเสียค้างจนไม่ได้พิมพ์ — เกินเวลาแล้วพิมพ์เท่าที่มี
export async function printWhenImagesReady(win, { minWaitMs = 500, timeoutMs = 10000 } = {}) {
  const images = [...win.document.images]
  const decoded = Promise.all(images.map((img) => (
    typeof img.decode === 'function'
      ? img.decode().catch(() => {})
      : new Promise((resolve) => {
          if (img.complete) { resolve(); return }
          img.onload = resolve
          img.onerror = resolve
        })
  )))
  await Promise.all([
    Promise.race([decoded, new Promise((resolve) => setTimeout(resolve, timeoutMs))]),
    new Promise((resolve) => setTimeout(resolve, minWaitMs)),
  ])
  if (win.closed) return
  win.focus()
  win.print()
}
