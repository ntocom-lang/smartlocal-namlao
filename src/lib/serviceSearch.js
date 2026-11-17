// ตรรกะค้นหาบริการ/คำถามที่พบบ่อย/แบบฟอร์ม ของหน้าประชาชน /search — ฟังก์ชันบริสุทธิ์ล้วน
// ⚠️ ห้าม import supabase/React ที่นี่ เพื่อให้เทสต์ด้วย node ได้ (tests/service-search.test.mjs)
//
// หลักคิด: ชาวบ้านพิมพ์ "ไฟดับ" ไม่ใช่ "ไฟฟ้าสาธารณะ" — ตารางคำพ้องชุดกลาง (SERVICE_SYNONYMS) ผูกแนวคิดกับคำที่คนพิมพ์จริง
// ใช้ทั้งฝั่งข้อมูล (เติมคำพ้องของแนวคิดที่ชื่อรายการมี ลงใน haystack) และฝั่งคำค้น (คำค้นที่เป็นคำพ้อง → ถามหาแนวคิดนั้นด้วย)
// เป็นกฎตรงไปตรงมาที่อธิบายและตรวจย้อนได้ ไม่ใช้ AI · คำพ้องรายหน่วยงานเพิ่มได้ผ่านช่อง "คำค้นเพิ่ม" ของแต่ละรายการ

/**
 * แนวคิด → คำที่ชาวบ้านพิมพ์จริง
 * key = คำที่ปรากฏในชื่อหมวดคำร้อง/ประเภทคำขอ/เมนู (ตรงกับ DEFAULT_CATEGORIES ใน ComplaintCategory.jsx และ BASE_DOCUMENT_TYPES ใน documentTypes.js)
 * ทุกคำในลิสต์ต้องเป็นตัวพิมพ์ปกติ (normalizeThai ทำให้เองตอนใช้)
 */
export const SERVICE_SYNONYMS = Object.freeze({
  ไฟฟ้าสาธารณะ: ['ไฟดับ', 'ไฟถนน', 'เสาไฟ', 'หลอดไฟ', 'ไฟฟ้า', 'ไฟสาธารณะ', 'โคมไฟ', 'ไฟส่องสว่าง', 'ไฟเสีย', 'ไฟไม่ติด'],
  ขยะ: ['เก็บขยะ', 'ถังขยะ', 'รถขยะ', 'มูลฝอย', 'ขยะมูลฝอย', 'ทิ้งขยะ', 'ขยะตกค้าง', 'ขยะล้น', 'ค่าขยะ'],
  ประปา: ['น้ำไม่ไหล', 'มาตรน้ำ', 'มิเตอร์', 'มิเตอร์น้ำ', 'น้ำประปา', 'ปะปา', 'น้ำปะปา', 'ใช้น้ำ', 'ค่าน้ำ', 'ท่อประปา', 'ท่อแตก'],
  น้ำอุปโภค: ['น้ำแล้ง', 'ขอน้ำ', 'น้ำดื่ม', 'น้ำใช้', 'รถน้ำ', 'ขาดน้ำ', 'น้ำไม่พอ'],
  ต้นไม้: ['ตัดต้นไม้', 'กิ่งไม้', 'ต้นไม้ล้ม', 'ต้นไม้โค่น', 'ต้นไม้ใหญ่', 'กิ่งไม้หัก'],
  ท่อระบายน้ำ: ['ท่อตัน', 'น้ำขัง', 'ลอกท่อ', 'ท่อน้ำ', 'ท่ออุดตัน', 'ท่อน้ำทิ้ง', 'รางระบายน้ำ', 'ท่อระบาย'],
  ฝาท่อ: ['ฝาท่อหาย', 'ฝาท่อแตก', 'ฝาบ่อ', 'บ่อพัก', 'ท่อเปิด'],
  ถนน: ['ถนนพัง', 'หลุม', 'หลุมบ่อ', 'ถนนชำรุด', 'ซ่อมถนน', 'ทางเท้า', 'ถนนเป็นหลุม', 'ผิวถนน'],
  ก่อสร้าง: ['สร้างบ้าน', 'ต่อเติม', 'ขออนุญาตก่อสร้าง', 'ปลูกสร้าง', 'รื้อถอน', 'สร้างอาคาร', 'ดัดแปลงอาคาร', 'ข.1', 'แบบแปลน'],
  อาคาร: ['ต่อเติม', 'สร้างบ้าน', 'ตึกร้าว', 'อาคารเสี่ยงอันตราย', 'ก่อสร้าง'],
  ภาษี: ['ภาษีที่ดิน', 'ภาษีป้าย', 'ภาษีที่ดินและสิ่งปลูกสร้าง', 'เสียภาษี', 'ภาษีบำรุงท้องที่', 'ชำระภาษี', 'ยอดภาษี'],
  ค่าธรรมเนียม: ['ยอดชำระ', 'ค่าบริการ', 'ชำระเงิน', 'ค่าใบอนุญาต', 'ค่าปรับ'],
  สุนัข: ['หมา', 'หมาจรจัด', 'หมาจร', 'หมากัด', 'สุนัขจรจัด', 'แมวจรจัด', 'สัตว์จรจัด', 'หมาเห่า'],
  ผู้ป่วย: ['รถรับส่งผู้ป่วย', 'โรงพยาบาล', 'ไปหาหมอ', 'รถพยาบาล', 'ผู้ป่วยติดเตียง', 'รถรับส่ง', 'ฟอกไต', 'นัดหมอ'],
  ยืม: ['เต็นท์', 'โต๊ะ', 'เก้าอี้', 'ยืมของ', 'ยืมเต็นท์', 'ขอยืม', 'ยืมโต๊ะ', 'ยืมเก้าอี้', 'ยืมอุปกรณ์'],
  พัสดุ: ['เต็นท์', 'โต๊ะ', 'เก้าอี้', 'ยืมของ', 'ครุภัณฑ์'],
  ช่วยเหลือ: ['เงินช่วยเหลือ', 'ผู้ยากไร้', 'ผู้สูงอายุ', 'ผู้พิการ', 'ผู้ด้อยโอกาส', 'ขอความช่วยเหลือ', 'ซ่อมบ้าน', 'ภัยพิบัติ', 'ผู้ประสบภัย'],
  กล้องวงจรปิด: ['cctv', 'ซีซีทีวี', 'ภาพกล้อง', 'ขอดูกล้อง', 'ดูกล้อง', 'ภาพวงจรปิด'],
  น้ำท่วม: ['น้ำท่วมขัง', 'อุทกภัย', 'ฝนตกหนัก', 'น้ำหลาก', 'น้ำล้น', 'ระบายน้ำ'],
  ยุง: ['ไข้เลือดออก', 'พ่นหมอกควัน', 'ยุงลาย', 'พ่นยุง', 'กำจัดยุง', 'ลูกน้ำ'],
  เสียง: ['เสียงดัง', 'ลำโพง', 'คาราโอเกะ', 'เสียงรบกวน', 'เปิดเพลงดัง'],
  รำคาญ: ['เหตุรำคาญ', 'กลิ่นเหม็น', 'เสียงดัง', 'ควันรบกวน', 'เหม็น'],
  มลพิษ: ['ควัน', 'เผาขยะ', 'ฝุ่น', 'pm2.5', 'กลิ่น', 'เผาไร่', 'หมอกควัน', 'ฝุ่นละออง'],
  น้ำเสีย: ['น้ำเน่า', 'น้ำครำ', 'น้ำเสียไหลลงคลอง', 'น้ำทิ้ง', 'น้ำเหม็น'],
  สิ่งปฏิกูล: ['ส้วม', 'ดูดส้วม', 'ส้วมเต็ม', 'ถังเกรอะ', 'สูบส้วม', 'ส้วมตัน'],
  คลอง: ['ลอกคลอง', 'คูน้ำ', 'ขุดลอก', 'คลองตื้นเขิน', 'ผักตบชวา', 'ลำเหมือง'],
  ทุจริต: ['โกง', 'คอร์รัปชัน', 'ทุจริตคอร์รัปชัน', 'เรียกรับเงิน', 'ผิดระเบียบ', 'ฮั้ว'],
  ร้องทุกข์: ['ร้องเรียน', 'แจ้งปัญหา', 'ไม่พอใจ', 'ร้องเรียนเจ้าหน้าที่'],
  โรคติดต่อ: ['โรคระบาด', 'ไข้หวัด', 'ไข้เลือดออก', 'โควิด', 'มือเท้าปาก', 'ระบาด'],
  ติดต่อ: ['เบอร์โทร', 'ที่อยู่', 'เวลาทำการ', 'แผนที่'],
  ฉุกเฉิน: ['สายด่วน', 'แจ้งเหตุ', 'เหตุด่วน', 'ไฟไหม้', 'อุบัติเหตุ', '1669', '191'],
  เก็บขยะ: ['ตารางเก็บขยะ', 'วันเก็บขยะ', 'รถขยะมา', 'ขยะวันไหน'],
  ข่าว: ['ประกาศ', 'ประชาสัมพันธ์', 'กิจกรรม'],
  กิจกรรม: ['ปฏิทิน', 'งานประเพณี', 'ข่าวกิจกรรม'],
  ท่องเที่ยว: ['ที่เที่ยว', 'ร้านอาหาร', 'ที่พัก', 'โอทอป', 'otop', 'ของฝาก'],
  แบบฟอร์ม: ['ใบคำร้อง', 'ดาวน์โหลด', 'แบบคำขอ', 'ใบสมัคร', 'เอกสาร'],
})

const isZeroWidth = (code) => (code >= 0x200b && code <= 0x200d) || code === 0x2060 || code === 0xfeff

/** ทำให้ข้อความเทียบกันได้: ตัวพิมพ์เล็ก · ตัดอักขระความกว้างศูนย์ · ยุบช่องว่างซ้อน · trim */
export function normalizeThai(value) {
  // ตัดอักขระความกว้างศูนย์ด้วยรหัสอักขระ (ไม่ฝังตัวอักษรล่องหนในซอร์ส)
  return Array.from(String(value ?? '').normalize('NFC'))
    .filter((ch) => !isZeroWidth(ch.codePointAt(0)))
    .join('')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// ตารางที่ normalize แล้ว (คำนวณครั้งเดียวตอนโหลดโมดูล)
const CONCEPTS = Object.entries(SERVICE_SYNONYMS).map(([key, words]) => ({
  key: normalizeThai(key),
  words: words.map(normalizeThai),
}))

/** คำพ้องทั้งหมดของแนวคิดที่ "ข้อความนี้มี" (ใช้เติม haystack ของรายการ) */
function synonymsForText(normalizedText) {
  const out = []
  for (const c of CONCEPTS) {
    if (normalizedText.includes(c.key)) out.push(c.key, ...c.words)
  }
  return out
}

/** คำค้น 1 คำ → ชุดคำที่ถือว่าตรง (ตัวมันเอง + แนวคิดที่คำนั้นเป็นคำพ้อง/เป็นชื่อแนวคิด) */
function expandTerm(term) {
  const set = new Set([term]) // ตัวแรกต้องเป็นคำที่พิมพ์จริงเสมอ (scoreTerm ใช้ลำดับนี้)
  for (const c of CONCEPTS) {
    if (c.key === term || c.words.includes(term)) set.add(c.key)
  }
  return [...set]
}

/**
 * ลิงก์ที่ปลอดภัยให้กดได้ — กันข้อมูลเก่า/ปลอม (javascript: data: //โดเมน) ซ้ำอีกชั้นนอกเหนือ CHECK ในฐานข้อมูล
 *  - path ภายในเว็บ: ขึ้นต้น "/" ตัวที่สองห้ามเป็น "/" และใช้ชุดอักขระเดียวกับ CHECK ของ service_faqs.link_url
 *  - https:// เท่านั้น (ไม่รับ http:)
 *  - อื่นๆ → null (หน้าจอต้องไม่แสดงปุ่ม)
 * @returns {{ internal: true, to: string } | { internal: false, href: string } | null}
 */
export function safeLink(url) {
  if (typeof url !== 'string') return null
  const value = url.trim()
  if (!value || value.length > 500) return null
  // ห้ามช่องว่าง/ตัวควบคุม/backslash — "/\evil.com" เบราว์เซอร์ตีความเป็น "//evil.com" (ออกนอกเว็บ)
  if (/[\s\\]/.test(value) || Array.from(value).some((ch) => ch.codePointAt(0) <= 0x1f || ch.codePointAt(0) === 0x7f)) return null
  // ต้องตรงกับ CHECK ของ service_faqs.link_url (20261203100000_service_help_tables.sql) เป๊ะ
  if (/^\/([A-Za-z0-9_?=&%.#~+-][A-Za-z0-9/_?=&%.#~+-]*)?$/.test(value)) {
    return value.length <= 300 ? { internal: true, to: value } : null
  }
  if (/^https:\/\//i.test(value)) {
    try {
      const u = new URL(value)
      if (u.protocol !== 'https:' || !u.hostname) return null
      return { internal: false, href: value }
    } catch {
      return null
    }
  }
  return null
}

/**
 * สร้างดัชนีค้นหา (ผู้เรียกกรองสิทธิ์/โมดูลแล้ว — ฟังก์ชันนี้ไม่รู้จักบทบาทหรือโมดูล)
 * @param {{
 *   services?: Array<{ id: string, title: string, subtitle?: string, href: string, keywords?: string }>,
 *   faqs?: Array<{ id: string, question: string, answer?: string, keywords?: string|null, link_url?: string|null, link_label?: string|null }>,
 *   forms?: Array<{ id: string, title: string, description?: string|null, keywords?: string|null, file_url: string, department_id?: string|null, file_name?: string|null }>,
 * }} input
 * @returns {Array<{ kind: 'service'|'faq'|'form', id: string, title: string, subtitle: string, href: string|null, external: boolean,
 *   haystack: string, source: object, titleText: string, keywordText: string, subtitleText: string, answerText: string }>}
 */
export function buildServiceIndex({ services = [], faqs = [], forms = [] } = {}) {
  const items = []

  const push = ({ kind, id, title, subtitle = '', href, external, keywords = '', answer = '', source }) => {
    const titleText = normalizeThai(title)
    const subtitleText = normalizeThai(subtitle)
    const answerText = normalizeThai(answer)
    const kw = normalizeThai(keywords)
    // คำพ้องของแนวคิดที่ "ชื่อ" มี (ไม่ใช่คำตอบ — คำตอบยาวจะลากคำพ้องเกินจริง) + คำค้นเพิ่มของรายการ
    const keywordText = [kw, ...synonymsForText(`${titleText} ${kw}`)].filter(Boolean).join(' ')
    items.push({
      kind, id: String(id), title, subtitle, href, external, source,
      titleText, keywordText, subtitleText, answerText,
      haystack: [titleText, subtitleText, keywordText, answerText].filter(Boolean).join(' '),
    })
  }

  for (const s of services) {
    const link = safeLink(s?.href)
    if (!link || !s?.title) continue
    push({
      kind: 'service', id: s.id ?? s.href, title: s.title, subtitle: s.subtitle ?? '',
      href: link.internal ? link.to : link.href, external: !link.internal, keywords: s.keywords ?? '', source: s,
    })
  }
  for (const f of faqs) {
    if (!f?.question) continue
    push({
      kind: 'faq', id: f.id, title: f.question, subtitle: '', href: null, external: false,
      keywords: f.keywords ?? '', answer: f.answer ?? '', source: f,
    })
  }
  for (const f of forms) {
    const link = safeLink(f?.file_url)
    // ไฟล์ดาวน์โหลดต้องเป็น https:// เท่านั้น — path ภายในเว็บไม่ใช่ไฟล์แบบฟอร์ม
    if (!f?.title || !link || link.internal) continue
    push({
      kind: 'form', id: f.id, title: f.title, subtitle: f.description ?? '', href: link.href, external: true,
      keywords: f.keywords ?? '', source: f,
    })
  }
  return items
}

// คะแนนต่อ 1 คำค้น (สูง = ตรงกว่า): ชื่อขึ้นต้นด้วยคำค้น > ชื่อมีคำค้น > คำค้นเพิ่ม/คำพ้อง > คำอธิบายย่อย > คำตอบ
const SCORE = { titleStarts: 100, titleHas: 60, keyword: 30, subtitle: 15, answer: 5 }

// variants[0] = คำที่ผู้ใช้พิมพ์จริง (ได้คะแนนเต็ม) · ตัวที่เหลือคือแนวคิดที่ขยายมา — ตรงชื่อก็นับได้ไม่เกินระดับ "คำพ้อง"
// ไม่งั้นคำค้น "เต็นท์" จะดันรายการที่ชื่อขึ้นต้นด้วย "ยืม" ขึ้นเหนือรายการที่ชื่อมีคำว่าเต็นท์จริง
function scoreTerm(item, variants) {
  let best = 0
  variants.forEach((v, i) => {
    let s = 0
    if (item.titleText.startsWith(v)) s = SCORE.titleStarts
    else if (item.titleText.includes(v)) s = SCORE.titleHas
    else if (item.keywordText.includes(v)) s = SCORE.keyword
    else if (item.subtitleText.includes(v)) s = SCORE.subtitle
    else if (item.answerText.includes(v)) s = SCORE.answer
    if (i > 0 && s > SCORE.keyword) s = SCORE.keyword
    if (s > best) best = s
  })
  return best // 0 = ไม่เจอ
}

/**
 * ค้นหาในดัชนี: แยกคำด้วยช่องว่าง "ทุกคำต้องเจอ" (หรือคำพ้องของมัน) · เรียงคะแนนมาก→น้อย เท่ากันคงลำดับเดิมของดัชนี
 * คำค้นว่าง = [] (หน้าจอแสดงรายการทั้งหมดเอง)
 */
export function searchServices(index, query, { limit = 30 } = {}) {
  const terms = normalizeThai(query).split(' ').filter(Boolean)
  if (terms.length === 0) return []
  const variantsByTerm = terms.map(expandTerm)
  const scored = []
  index.forEach((item, order) => {
    let total = 0
    for (const variants of variantsByTerm) {
      const s = scoreTerm(item, variants)
      if (s === 0) return // มีคำใดคำหนึ่งไม่เจอ → ตัดทิ้ง
      total += s
    }
    scored.push({ item, total, order })
  })
  scored.sort((a, b) => b.total - a.total || a.order - b.order)
  return scored.slice(0, Math.max(0, limit)).map((x) => x.item)
}
