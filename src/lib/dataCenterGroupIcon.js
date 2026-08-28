// อิโมจิของ "กลุ่มหลัก" (data_center_entries.group_name) และ "ประเภทย่อย" (data_center_entries.category)
// ในศูนย์ข้อมูลดิจิทัล — ใช้ร่วมกันทั้งหน้ารายการ (DataCenterOverview.jsx) และแผนที่ (DataCenterMapView.jsx)
// กันอิโมจิไม่ตรงกันระหว่าง 2 หน้า (เดิมแต่ละไฟล์มี fallback แยกกันคนละชุด กลุ่มเดียวกันเคยขึ้นคนละอิโมจิ
// เช่น "สาธารณสุข" เป็น 🏥 ในหน้ารายการ แต่ ⛑️ บนแผนที่ และไอคอนรายประเภทย่อยเคยมีแต่บนแผนที่เท่านั้น)
// สีพื้นหลัง/กรอบยังคำนวณแยกกันตามบริบทของแต่ละหน้าเหมือนเดิม (การ์ดกับหมุดแผนที่ต้องการโทนสีคนละแบบ
// ไม่จำเป็นต้องตรงกันเป๊ะ) — มีแค่ตัวอิโมจิเท่านั้นที่รวมเป็นจุดเดียว
//
// ลำดับการเลือก (resolveEntryEmoji):
//   1) ค่าที่แอดมินตั้งเองให้ "ประเภทย่อย" นั้น (ตาราง data_center_group_icons แถวที่ category != '')
//   2) ค่าที่แอดมินตั้งเองให้ "กลุ่มหลัก" นั้น (แถวที่ category = '')
//   3) ประเภทย่อยที่รู้จักอยู่แล้ว (FIXED_CATEGORY_EMOJI)
//   4) กลุ่มหลักที่รู้จักอยู่แล้ว (FIXED_GROUP_EMOJI)
//   5) จับคู่คำสำคัญในชื่อกลุ่ม (KEYWORD_EMOJI)
//   6) 📍 ค่าเริ่มต้น

export const FIXED_GROUP_EMOJI = {
  'สาธารณสุข': '⛑️', 'สถานที่สำคัญ': '📍', 'สถานประกอบการ': '🏢', 'การจัดการขยะ': '🗑️',
  'สถานศึกษา': '🏫', 'โครงสร้างพื้นฐาน': '🏗️', 'สถานที่หลบภัย': '⛺', 'พื้นที่สีเขียว': '🌳',
  'คำร้อง': '📣', 'โครงการก่อสร้าง': '🚧', 'การท่องเที่ยว': '🏞️', 'สิ่งแวดล้อม': '🌱',
}

// ไอคอนเฉพาะประเภทย่อย (key ตรงกับ entry.category ที่พิมพ์ในฟอร์มเป๊ะๆ) — เดิมอยู่ในแผนที่ไฟล์เดียว
// ย้ายมาที่นี่เพื่อให้หน้ารายการใช้ด้วย ไม่ต้องใส่ครบทุกประเภท ที่ไม่มีจะ fallback ไปใช้ไอคอนกลุ่มหลัก
const FIXED_CATEGORY_EMOJI = {
  'โรงเรียน': '🏫',
  'แหล่งเรียนรู้ภูมิปัญญาท้องถิ่น': '🏺',
  'แหล่งเรียนรู้พอเพียง': '🌾',
}

// ชุดอิโมจิให้กดเลือกในหน้า "จัดการหมวดหมู่" — คัดเฉพาะที่ใช้จริงกับข้อมูล อปท. ไม่ใช่ emoji picker ทั้งชุด
// จงใจไม่ลง dependency picker สำเร็จรูป (emoji-picker-react ฯลฯ) เพราะกินขนาด bundle หลักร้อย KB
// เพื่อแลกกับอิโมจิที่งานนี้ไม่มีวันได้ใช้ (ธง สีผิว อาหารต่างประเทศ) — ผู้ใช้ยังพิมพ์/วางเองได้อยู่ถ้าไม่มีในนี้
export const ICON_PALETTE = [
  { label: 'สถานที่ราชการ / ชุมชน', emojis: ['🏛️', '🏢', '🏬', '🏤', '🏘️', '🏠', '🗼', '⛺', '🏟️', '🎪'] },
  { label: 'การศึกษา / แหล่งเรียนรู้', emojis: ['🏫', '📚', '🎓', '🔬', '🏺', '📖', '🖥️'] },
  { label: 'สาธารณสุข', emojis: ['⛑️', '🏥', '💊', '🩺', '🚑', '🧪', '🦟'] },
  { label: 'โครงสร้างพื้นฐาน / สาธารณูปโภค', emojis: ['🏗️', '🛣️', '🌉', '🚧', '💡', '🔌', '⚡', '🚰', '💧', '📡', '🛢️'] },
  { label: 'สิ่งแวดล้อม / ขยะ', emojis: ['🌱', '🌳', '🌲', '🌿', '🍃', '🗑️', '♻️', '💨', '🔥', '🌊'] },
  { label: 'เกษตร / ปศุสัตว์', emojis: ['🌾', '🐄', '🐖', '🐓', '🐐', '🐟', '🦆', '🐝', '🚜', '🌽', '🥬'] },
  { label: 'เศรษฐกิจ / สถานประกอบการ', emojis: ['🛒', '🏪', '🏭', '🍜', '🏨', '⛽', '💰', '🧺'] },
  { label: 'ความปลอดภัย / บรรเทาสาธารณภัย', emojis: ['🛡️', '🚒', '🚓', '🚨', '🆘', '📢', '🎥'] },
  { label: 'ศาสนา / วัฒนธรรม', emojis: ['🛕', '⛩️', '🕌', '⛪', '🙏', '🎭', '🥁'] },
  { label: 'ท่องเที่ยว / นันทนาการ', emojis: ['🏞️', '🏕️', '🏖️', '⛰️', '🚴', '⚽', '🎣', '📸'] },
  { label: 'ทั่วไป / เน้นย้ำ', emojis: ['📍', '📌', '📣', '⭐', '⚠️', '❗', '🔴', '🟠', '🟢', '🔵', '🟣'] },
]

const KEYWORD_EMOJI = [
  { keywords: ['โครงสร้าง', 'คมนาคม', 'ถนน', 'สะพาน', 'โยธา'], emoji: '🏗️' },
  { keywords: ['ศึกษา', 'เรียน', 'โรงเรียน', 'ศูนย์เด็ก', 'การศึกษา'], emoji: '🏫' },
  { keywords: ['สาธารณสุข', 'หมอ', 'พยาบาล', 'อนามัย', 'การแพทย์', 'โรงพยาบาล'], emoji: '⛑️' },
  { keywords: ['เที่ยว', 'ท่องเที่ยว', 'จุดชมวิว', 'สวน'], emoji: '🏞️' },
  { keywords: ['สิ่งแวดล้อม', 'ขยะ', 'มลพิษ', 'ป่าไม้', 'ทรัพยากร'], emoji: '🌱' },
  { keywords: ['เกษตร', 'ไร่', 'นา', 'พืช', 'ปศุสัตว์'], emoji: '🌾' },
  { keywords: ['น้ำ', 'ประปา', 'ชลประทาน', 'คลอง', 'แหล่งน้ำ'], emoji: '💧' },
  { keywords: ['สวัสดิการ', 'สังคม', 'ชุมชน', 'ผู้สูงอายุ'], emoji: '🤝' },
  { keywords: ['ปลอดภัย', 'กู้ภัย', 'ป้องกัน', 'ดับเพลิง', 'บรรเทา'], emoji: '🛡️' },
  { keywords: ['เศรษฐกิจ', 'ตลาด', 'พาณิชย์', 'การค้า'], emoji: '🛒' },
  { keywords: ['วัฒนธรรม', 'วัด', 'ศาสนา', 'ประเพณี'], emoji: '🛕' },
]

// คีย์ของ overrides map — ประเภทย่อยผูกกับกลุ่มหลักเสมอ เพราะชื่อประเภทย่อยซ้ำข้ามกลุ่มได้
// (เช่น "ศูนย์เรียนรู้" อยู่ได้ทั้งกลุ่มการศึกษาและกลุ่มเกษตร) คั่นด้วย U+001F (unit separator)
// เพราะเป็นอักขระควบคุมที่ไม่มีทางโผล่ในชื่อกลุ่ม/ประเภทที่พนักงานพิมพ์
const KEY_SEPARATOR = String.fromCharCode(31)
export function iconKey(groupName, category) {
  return `${groupName ?? ''}${KEY_SEPARATOR}${category ?? ''}`
}

// อิโมจิระดับกลุ่มหลัก (ใช้กับหัวข้อหน้ารายการ, panel สรุปบนแผนที่ ที่ยังไม่รู้ประเภทย่อย)
export function resolveGroupEmoji(name, overrides = {}) {
  if (!name) return '📍'
  const override = overrides[iconKey(name, '')]
  if (override) return override
  if (FIXED_GROUP_EMOJI[name]) return FIXED_GROUP_EMOJI[name]
  const lower = name.toLowerCase()
  for (const item of KEYWORD_EMOJI) {
    if (item.keywords.some((k) => lower.includes(k))) return item.emoji
  }
  return '📍'
}

// อิโมจิของ "หนึ่งรายการ" — ประเภทย่อยชนะกลุ่มหลักเสมอ ใช้กับแถวในตารางและหมุดบนแผนที่
export function resolveEntryEmoji(groupName, category, overrides = {}) {
  if (category) {
    const override = overrides[iconKey(groupName, category)]
    if (override) return override
  }
  const groupOverride = groupName ? overrides[iconKey(groupName, '')] : null
  if (groupOverride) return groupOverride
  if (category && FIXED_CATEGORY_EMOJI[category]) return FIXED_CATEGORY_EMOJI[category]
  return resolveGroupEmoji(groupName, overrides)
}

// ดึง override ทั้งหมดของเทศบาลหนึ่ง คืนเป็น { [iconKey(group, category)]: emoji }
export async function fetchGroupIconOverrides(supabase, municipalityId) {
  if (!municipalityId) return {}
  const { data, error } = await supabase
    .from('data_center_group_icons')
    .select('group_name, category, emoji')
    .eq('municipality_id', municipalityId)
  if (error || !data) return {}
  return Object.fromEntries(data.map((row) => [iconKey(row.group_name, row.category), row.emoji]))
}

// บันทึก/ล้าง override — category ว่าง = ระดับกลุ่มหลัก, emoji ว่าง = ลบแถวทิ้ง กลับไปใช้ fallback อัตโนมัติ
export async function saveGroupIconOverride(supabase, { municipalityId, groupName, category = '', emoji, userId }) {
  const trimmed = (emoji ?? '').trim()
  const cat = category ?? ''
  if (!trimmed) {
    return supabase.from('data_center_group_icons')
      .delete()
      .eq('municipality_id', municipalityId)
      .eq('group_name', groupName)
      .eq('category', cat)
  }
  return supabase.from('data_center_group_icons')
    .upsert(
      { municipality_id: municipalityId, group_name: groupName, category: cat, emoji: trimmed, updated_by: userId, updated_at: new Date().toISOString() },
      { onConflict: 'municipality_id,group_name,category' },
    )
}

// ตามชื่อกลุ่ม/ประเภทย่อยที่ถูกเปลี่ยนในหน้า "จัดการหมวดหมู่" — ไอคอนผูกกับ "ชื่อ" ไม่ใช่ id
// ถ้าไม่ย้ายตามจะกลายเป็นแถวกำพร้า ไอคอนที่ตั้งไว้หายไปเฉยๆ
//   - เปลี่ยนชื่อกลุ่มหลัก: ไม่ส่ง category มา → ย้ายทุกแถวของกลุ่มนั้น (ทั้งไอคอนกลุ่มและของประเภทย่อย)
//   - เปลี่ยนชื่อประเภทย่อย: ส่ง category + newCategory → ย้ายเฉพาะแถวนั้น
// ปลายทางมีไอคอนอยู่แล้ว (rename แบบรวมหมวดเข้าด้วยกัน) = ลบของต้นทางทิ้ง ให้ไอคอนปลายทางชนะ
// ตรงกับพฤติกรรมรวมหมวดของ data_center_entries
export async function renameIconTarget(supabase, { municipalityId, groupName, newGroupName = null, category = null, newCategory = null }) {
  const isGroupRename = category === null || category === undefined

  let sourceQuery = supabase.from('data_center_group_icons')
    .select('id, category')
    .eq('municipality_id', municipalityId)
    .eq('group_name', groupName)
  if (!isGroupRename) sourceQuery = sourceQuery.eq('category', category)
  const { data: sources } = await sourceQuery
  if (!sources?.length) return

  const targetGroup = newGroupName ?? groupName
  const { data: targets } = await supabase.from('data_center_group_icons')
    .select('category')
    .eq('municipality_id', municipalityId)
    .eq('group_name', targetGroup)
  const takenCategories = new Set((targets ?? []).map((r) => r.category))

  for (const row of sources) {
    const targetCat = isGroupRename ? row.category : (newCategory ?? row.category)
    if (targetGroup === groupName && targetCat === row.category) continue
    if (takenCategories.has(targetCat)) {
      await supabase.from('data_center_group_icons').delete().eq('id', row.id)
    } else {
      await supabase.from('data_center_group_icons')
        .update({ group_name: targetGroup, category: targetCat })
        .eq('id', row.id)
      takenCategories.add(targetCat)
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// ไอคอนรูปภาพที่แอดมินแนบจากเครื่องเอง
//
// เก็บใน "คอลัมน์ emoji เดิม" เป็น data URL ไม่ได้แยกตาราง/ไม่ใช้ Storage เพราะ:
//   - แผนที่สาธารณะ (/data-center/public) อ่านด้วย role anon อยู่แล้ว ถ้าไปเก็บ Storage/Drive
//     ต้องเปิด public bucket + เขียน policy เพิ่มเพื่อไอคอนไม่กี่สิบรูป ไม่คุ้มความเสี่ยง
//   - ไม่มี broken link ในอนาคต ไอคอนย้ายตามแถวเดิมเวลา rename (renameIconTarget) ได้ฟรี
//
// ราคาที่ต้องจ่าย: fetchGroupIconOverrides() ดึงทุกแถวของเทศบาลทุกครั้งที่เปิดหน้ารายการ/แผนที่
// รูปจึงต้องเล็กจริง มิฉะนั้น egress บาน (Supabase free tier 5GB/เดือน) — ทุกไฟล์ที่แนบเข้ามาเลย
// ถูก rasterize ใหม่เป็น PNG 64×64 ผ่าน <canvas> เสมอ (~3-6KB) ไม่เคยเก็บไฟล์ต้นฉบับดิบ
// และ DB มี CHECK length(emoji) <= ICON_IMAGE_MAX_CHARS กันคนยิง REST ตรงข้ามหน้าเว็บ
// (supabase/migrations/20260831090000_data_center_icon_image_limit.sql)
export const ICON_IMAGE_MAX_PX = 64
export const ICON_IMAGE_MAX_CHARS = 16384
export const ICON_UPLOAD_MAX_BYTES = 2 * 1024 * 1024
// จงใจไม่รับ image/svg+xml — SVG พา <script>/onload มาได้ และแอดมิน อปท. มักโหลดไอคอนจากเน็ตมาแนบ
// โดยไม่ได้เปิดดูข้างใน การ rasterize ผ่าน canvas ยังทิ้ง metadata (EXIF/GPS) ของรูปถ่ายให้ด้วย
export const ICON_UPLOAD_MIME = ['image/png', 'image/jpeg', 'image/webp']
export const ICON_UPLOAD_ACCEPT = ICON_UPLOAD_MIME.join(',')

export function isIconImage(value) {
  return typeof value === 'string' && (
    value.startsWith('data:image/') || value.startsWith('http://') ||
    value.startsWith('https://') || value.startsWith('/')
  )
}

async function loadIconBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file) } catch { /* Safari เก่าบางรุ่นไม่รับ Blob → ตกไปใช้ <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ ไฟล์อาจเสียหายหรือไม่ใช่รูปภาพจริง'))
      img.src = url
    })
  } finally { URL.revokeObjectURL(url) }
}

// หา "กรอบของเนื้อรูปจริง" เพื่อตัดขอบว่างรอบๆ ทิ้งก่อนย่อ
//
// ทำไมต้องมี: ไฟล์ไอคอน/โลโก้ที่โหลดมาจากเน็ตเกือบทุกไฟล์มีขอบเปล่ารอบตัวลาย 10-25% (บางไฟล์เป็น
// ภาพจัตุรัสที่ลายอยู่ตรงกลางเล็กนิดเดียว) ถ้า contain-fit ทั้งภาพลงกรอบ 64×64 ตรงๆ ตัวลายจริงจะเหลือ
// แค่ ~40px ขณะที่อิโมจิข้างๆ วาดเต็มกล่อง — บนหมุดแผนที่วงกลม 18px เห็นชัดมากว่าไอคอนที่แนบ "เล็กกว่า"
// ทั้งที่ตั้งขนาดเท่ากัน ตัดขอบทิ้งก่อนแล้วทุกไฟล์จะได้ตัวลายเต็มกรอบเท่ากันหมด ไม่ว่าต้นทางจะเว้นขอบแค่ไหน
//
// รองรับ 2 แบบ: PNG/WebP โปร่งใส (ดู alpha) และ JPEG/PNG ทึบที่พื้นหลังสีเดียว (ดูสีจาก 4 มุม —
// เอาไว้เฉพาะเมื่อทั้ง 4 มุมเป็นสีเดียวกันจริง กันภาพถ่ายที่มุมบังเอิญคล้ายกันโดนตัดผิด)
const TRIM_ALPHA_MIN = 16
const TRIM_COLOR_TOLERANCE = 24
const TRIM_SAMPLE_MAX_PX = 512

function findContentBounds(bitmap, srcW, srcH) {
  const scale = Math.min(1, TRIM_SAMPLE_MAX_PX / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const probe = document.createElement('canvas')
  probe.width = w
  probe.height = h
  const pctx = probe.getContext('2d', { willReadFrequently: true })
  pctx.drawImage(bitmap, 0, 0, w, h)

  let data
  try {
    data = pctx.getImageData(0, 0, w, h).data
  } catch {
    return null // canvas ปนเปื้อน (ไม่น่าเกิดกับไฟล์ในเครื่อง) — ข้ามการตัดขอบไปเลย ดีกว่าพัง
  }

  const at = (x, y) => (y * w + x) * 4
  const cornerIdx = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)]
  let bg = null
  if (data[cornerIdx[0] + 3] >= TRIM_ALPHA_MIN) {
    const [r, g, b] = [data[cornerIdx[0]], data[cornerIdx[0] + 1], data[cornerIdx[0] + 2]]
    const allCornersMatch = cornerIdx.every((i) => data[i + 3] >= TRIM_ALPHA_MIN
      && Math.abs(data[i] - r) <= TRIM_COLOR_TOLERANCE
      && Math.abs(data[i + 1] - g) <= TRIM_COLOR_TOLERANCE
      && Math.abs(data[i + 2] - b) <= TRIM_COLOR_TOLERANCE)
    if (allCornersMatch) bg = [r, g, b]
  }

  const isContent = (i) => {
    if (data[i + 3] < TRIM_ALPHA_MIN) return false
    if (!bg) return true
    return Math.abs(data[i] - bg[0]) > TRIM_COLOR_TOLERANCE
      || Math.abs(data[i + 1] - bg[1]) > TRIM_COLOR_TOLERANCE
      || Math.abs(data[i + 2] - bg[2]) > TRIM_COLOR_TOLERANCE
  }

  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!isContent(at(x, y))) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX || maxY < minY) return null // ภาพว่าง/โปร่งใสล้วน → ใช้ทั้งภาพตามเดิม

  // แปลงพิกัดกลับไปสเกลต้นฉบับ แล้วเผื่อขอบ 1px กันตัดโดนเส้นขอบของตัวลายเอง
  const back = 1 / scale
  const x = Math.max(0, Math.floor(minX * back) - 1)
  const y = Math.max(0, Math.floor(minY * back) - 1)
  return {
    x,
    y,
    w: Math.min(srcW, Math.ceil((maxX + 1) * back) + 1) - x,
    h: Math.min(srcH, Math.ceil((maxY + 1) * back) + 1) - y,
    bg, // สีพื้นหลังทึบที่ตรวจเจอ (null = ไฟล์โปร่งใสอยู่แล้ว) ใช้ต่อใน removeFlatBackdrop()
  }
}

// ลบพื้นหลังทึบสีเดียว (ขาว/เทา) ออกให้กลายเป็นโปร่งใส — ไล่จาก "ขอบภาพเข้ามา" แบบ flood fill
// ไม่ใช่ลบทุก pixel ที่สีตรงกับพื้นหลัง เพราะไอคอนส่วนใหญ่มีสีขาวอยู่ในตัวลายด้วย (ตากล้อง ตัวอักษร
// ช่องว่างในสัญลักษณ์) ถ้าลบแบบเหมารวมลายจะทะลุเป็นรู — ขาวที่ไม่ได้เชื่อมกับขอบภาพจึงถูกเก็บไว้เสมอ
//
// ทำไมต้องลบ: ไฟล์ไอคอนที่โหลดจากเน็ตมักเป็น JPG/PNG พื้นขาวทึบ ถ้าไม่ลบ ตัวไอคอนวงกลมจะมี
// "มุมขาว 4 มุม" ติดไปด้วย เห็นชัดมากเวลาวางบนภาพดาวเทียมของแผนที่
// tolerance กว้างกว่าตอน trim เพราะ JPEG มี artifact รอบขอบลาย
const BACKDROP_TOLERANCE = 34
function removeFlatBackdrop(ctx, size, bg) {
  const image = ctx.getImageData(0, 0, size, size)
  const d = image.data
  const seen = new Uint8Array(size * size)
  const stack = []
  const push = (x, y) => {
    const p = y * size + x
    if (!seen[p]) { seen[p] = 1; stack.push(p) }
  }
  for (let i = 0; i < size; i += 1) {
    push(i, 0); push(i, size - 1); push(0, i); push(size - 1, i)
  }
  while (stack.length) {
    const p = stack.pop()
    const i = p * 4
    if (d[i + 3] !== 0) {
      const matchesBackdrop = Math.abs(d[i] - bg[0]) <= BACKDROP_TOLERANCE
        && Math.abs(d[i + 1] - bg[1]) <= BACKDROP_TOLERANCE
        && Math.abs(d[i + 2] - bg[2]) <= BACKDROP_TOLERANCE
      if (!matchesBackdrop) continue // เจอตัวลายแล้ว หยุดลามต่อในทิศนี้
      d[i + 3] = 0
    }
    const x = p % size
    const y = (p - x) / size
    if (x > 0) push(x - 1, y)
    if (x < size - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < size - 1) push(x, y + 1)
  }
  ctx.putImageData(image, 0, 0)
}

// แปลงไฟล์ที่ผู้ใช้เลือก → data URL ไอคอนสี่เหลี่ยมจัตุรัส 64×64 พื้นหลังโปร่งใส
// ตัดขอบว่างรอบตัวลายทิ้งก่อน แล้ว contain-fit ให้เต็มกรอบ (ไม่บีบสัดส่วน)
// โยน Error พร้อมข้อความภาษาไทยที่เอาไปโชว์ผู้ใช้ได้ตรงๆ เมื่อไฟล์ไม่ผ่านเงื่อนไข
export async function fileToIconDataUrl(file, { size = ICON_IMAGE_MAX_PX } = {}) {
  if (!file) throw new Error('ยังไม่ได้เลือกไฟล์')
  if (!ICON_UPLOAD_MIME.includes(file.type)) {
    throw new Error('รองรับเฉพาะไฟล์ PNG / JPG / WebP (ไม่รับไฟล์ SVG ด้วยเหตุผลด้านความปลอดภัย)')
  }
  if (file.size > ICON_UPLOAD_MAX_BYTES) {
    throw new Error(`ไฟล์ใหญ่เกิน ${Math.round(ICON_UPLOAD_MAX_BYTES / 1024 / 1024)} MB กรุณาย่อรูปก่อนแนบ`)
  }

  const bitmap = await loadIconBitmap(file)
  try {
    const srcW = bitmap.naturalWidth || bitmap.width
    const srcH = bitmap.naturalHeight || bitmap.height
    if (!srcW || !srcH) throw new Error('อ่านขนาดของรูปไม่ได้ ลองบันทึกไฟล์ใหม่แล้วแนบอีกครั้ง')

    const crop = findContentBounds(bitmap, srcW, srcH) ?? { x: 0, y: 0, w: srcW, h: srcH, bg: null }

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    const scale = Math.min(size / crop.w, size / crop.h)
    const w = Math.max(1, Math.round(crop.w * scale))
    const h = Math.max(1, Math.round(crop.h * scale))
    ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h,
      Math.round((size - w) / 2), Math.round((size - h) / 2), w, h)
    if (crop.bg) removeFlatBackdrop(ctx, size, crop.bg)

    // PNG ก่อน (คมสุด + โปร่งใส) ถ้าเป็นรูปถ่ายรายละเอียดเยอะจนเกินโควตา ค่อยลด WebP ตามลำดับ
    // toDataURL ของเบราว์เซอร์ที่ไม่รองรับ webp จะเงียบๆ คืน PNG กลับมา จึงต้องเช็ค prefix ที่ได้จริง
    for (const [type, quality] of [['image/png', undefined], ['image/webp', 0.85], ['image/webp', 0.6]]) {
      const url = canvas.toDataURL(type, quality)
      if (url.startsWith(`data:${type}`) && url.length <= ICON_IMAGE_MAX_CHARS) return url
    }
    throw new Error('ย่อรูปแล้วยังมีขนาดใหญ่เกินไป ลองใช้ไอคอนลายเส้น/พื้นหลังโปร่งใสแทนรูปถ่าย')
  } finally {
    bitmap.close?.()
  }
}
