// ตารางแปลง emoji → ชื่อไอคอนทึบ (Phosphor "fill") สำหรับรูปแบบไอคอนหมวด 'glyph' (ไอคอนทึบสีเดียวตามสี อปท.)
// ที่มา: ทุ่งแค้วแจ้ง 2569-11-19 ว่าไอคอน OpenMoji ดูเหมือนการ์ตูน เจ้าของระบบเลือกแบบทึบสีเดียวเป็น "ตัวเลือกราย อปท."
//
// แยกเป็นไฟล์ "ชื่อล้วน" (สตริง ไม่มี React/ไอคอนจริง) เพราะ 2 เหตุผล
//  1) hasGlyphIcon() ต้องตอบได้ทันทีแบบ sync ไม่ต้องรอโหลดไอคอน — หน้าเลือกหมวดใช้ตัดสินใจเรื่องกล่องพื้นหลัง
//  2) ตัวไอคอนจริงอยู่ใน categoryGlyphIcons.js ซึ่ง categoryIcon.jsx โหลดแบบ lazy เฉพาะ อปท. ที่เลือก 'glyph'
//     (Phosphor ฝังทุกน้ำหนักเส้นไว้ในไฟล์เดียวต่อไอคอน ~3-4 KB/ตัว ไม่ควรแบกไปกับทุก อปท. ที่ไม่ได้ใช้)
//
// กติกาการเพิ่ม: แปลงเฉพาะ emoji ที่ไอคอน Phosphor "ความหมายตรงจริง" — ไม่มีตัวที่ตรง = ไม่ใส่ตาราง
// (CategoryIcon จะตกไปใช้ OpenMoji ชุดสีแทน ไม่ให้ไอคอนหาย) ห้ามเดาชื่อ: tests/category-glyph.test.mjs
// ตรวจว่าทุกชื่อในตารางนี้มีตัวไอคอนจริงใน categoryGlyphIcons.js
//
// คีย์ = emoji ที่ตัด U+FE0F (variation selector) ออกแล้ว — '🛣️' กับ '🛣' ถือเป็นตัวเดียวกัน
export const GLYPH_NAME_BY_EMOJI = {
  // สาธารณูปโภค / ก่อสร้าง
  '💡': 'Lightbulb',
  '⚡': 'Lightning',
  '🔌': 'Plug',
  '🛣': 'RoadHorizon',
  '🏗': 'Crane',
  '🚧': 'Barricade',
  '🏢': 'Buildings',
  '🏠': 'House',
  '🌉': 'Bridge',
  '🚿': 'Shower',
  '🔧': 'Wrench',
  '🔨': 'Hammer',
  '🪛': 'Screwdriver',
  '🔩': 'Nut',
  '🪜': 'Ladder',
  '⚙': 'Gear',
  // น้ำ / สิ่งแวดล้อม
  '💧': 'Drop',
  '🚰': 'Drop', // ก๊อกน้ำดื่ม — ไม่มีไอคอนก๊อกใน Phosphor ใช้หยดน้ำตามที่เจ้าของระบบกำหนดสำหรับช่องบริการประปา
  '🌊': 'Waves',
  '🌧': 'CloudRain',
  '☔': 'Umbrella',
  '🌬': 'Wind',
  '💨': 'Wind',
  '🌫': 'CloudFog',
  '🔥': 'Fire',
  '🌱': 'Plant',
  '🌳': 'Tree',
  '🌲': 'TreeEvergreen',
  '🌿': 'Leaf',
  '🍃': 'Leaf',
  '🌾': 'Grains',
  '🌵': 'Cactus',
  '🪴': 'PottedPlant',
  // ความสะอาด
  '🗑': 'Trash',
  '🚮': 'Trash',
  '♻': 'Recycle',
  '🧹': 'Broom',
  '🚽': 'Toilet',
  '🚛': 'Truck',
  '🧺': 'Basket',
  '🛁': 'Bathtub',
  // สัตว์ / แมลง
  '🐕': 'Dog',
  '🐾': 'PawPrint',
  '🐈': 'Cat',
  '🐟': 'Fish',
  '🦆': 'Bird',
  '🦟': 'Bug', // Phosphor ไม่มียุงโดยเฉพาะ — ใช้ไอคอนแมลง (หมวด "พ่นยุง") ให้เจ้าของระบบตรวจหน้าจอจริง
  '🐛': 'BugBeetle',
  // เสียง / ร้องเรียน
  '🔊': 'SpeakerHigh',
  '📣': 'Megaphone',
  '📢': 'Megaphone',
  '🔔': 'Bell',
  '🔕': 'BellSlash',
  '💬': 'ChatCircle',
  '🤬': 'SmileyAngry',
  '📞': 'Phone',
  '☎': 'Phone',
  // บริการสาธารณะ
  '🚒': 'FireTruck',
  '🚑': 'Ambulance',
  '🚔': 'PoliceCar',
  '🛡': 'Shield',
  '📋': 'ClipboardText',
  '📝': 'NotePencil',
  '📖': 'BookOpenText',
  '🧾': 'Receipt',
  '💰': 'Coins',
  '⚖': 'Scales',
  '📦': 'Package',
  '🏥': 'Hospital',
  '🚦': 'TrafficSignal',
  '📍': 'MapPin',
  '🗺': 'MapTrifold',
  // ทั่วไป
  '❓': 'Question',
  '✅': 'CheckCircle',
  '❗': 'WarningCircle',
  '⚠': 'Warning',
  '🚨': 'Siren',
  '🚩': 'Flag',
  '⭐': 'Star',
  '📊': 'ChartBar',
  '💼': 'Briefcase',
  '📮': 'Mailbox',
  '🏷': 'Tag',
  '🎫': 'Ticket',
}

// ตัด U+FE0F ออกก่อนเทียบ — แอดมินพิมพ์/เลือก emoji มาจากหลายแหล่งบางตัวมี FE0F บางตัวไม่มี
export function normalizeEmojiKey(emoji) {
  if (typeof emoji !== 'string') return ''
  return Array.from(emoji.trim()).filter(c => c !== '️').join('')
}

// ชื่อไอคอนทึบของ emoji นี้ — ไม่มี (หรือเป็น URL รูปที่แอดมินตั้งเอง) คืน null
export function glyphNameFor(emoji) {
  return GLYPH_NAME_BY_EMOJI[normalizeEmojiKey(emoji)] || null
}

// ให้หน้าอื่นใช้ตัดสินใจเรื่องกล่องพื้นหลัง: true = โหมด glyph จะวาดไอคอนทึบได้จริง
export function hasGlyphIcon(emoji) {
  return glyphNameFor(emoji) !== null
}

// true = อปท. ตั้ง 'glyph' และ emoji นี้มีไอคอนทึบจริง → หน้าที่วางไอคอนควร "ตัดกล่องสีรอง" ออก
// (ไอคอนทึบสีเดียวเหมือนแอปเมืองอื่น) — emoji ที่ไม่มีไอคอนทึบจะตกไปเป็นภาพ OpenMoji สี ซึ่งยังต้องมีกล่องสีรองรับเหมือนเดิม
// emoji ว่าง = 📋 ตรงกับที่ CategoryIcon ใช้แทนค่าว่าง
export function isPlainGlyph(style, emoji) {
  return style === 'glyph' && hasGlyphIcon(emoji || '📋')
}
