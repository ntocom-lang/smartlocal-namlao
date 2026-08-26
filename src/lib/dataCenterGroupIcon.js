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
