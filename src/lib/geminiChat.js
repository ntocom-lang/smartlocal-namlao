import { supabase, supabaseUrl, supabaseAnonKey } from './supabase'

// label ย่อยเฉพาะสำหรับสรุปให้ AI อ่าน (ชุดเดียวกับที่ใช้แสดงผลใน MyComplaints.jsx / MyDocRequests.jsx)
const STATUS_LABEL = {
  new: 'คำร้องใหม่', pending: 'คำร้องใหม่', received: 'รับเรื่องแล้ว',
  in_progress: 'กำลังดำเนินการ', processing: 'กำลังดำเนินการ',
  done: 'ดำเนินการแล้ว', completed: 'เสร็จสิ้น/ปิดเรื่องแล้ว', closed: 'ปิดเรื่องแล้ว',
  rejected: 'ปฏิเสธ',
}
const CATEGORY_LABEL = {
  road: 'ถนน/ทางสาธารณะ', light: 'ไฟฟ้าส่องสว่าง', trash: 'ขยะ/ความสะอาด',
  water: 'น้ำประปา', flood: 'น้ำท่วม/ระบายน้ำ', tree: 'ตัดต้นไม้', noise: 'แจ้งเหตุรำคาญ',
  drain: 'ท่อระบายน้ำ', waste_water: 'น้ำเสีย', suction: 'ดูดสิ่งปฏิกูล',
  manhole: 'ฝาท่อระบายน้ำ', vendor: 'ขายของบนทางสาธารณะ', building: 'ตรวจสอบอาคาร', mosquito: 'พ่นยุง',
}
const DOC_TYPE_LABEL = {
  residence_cert: 'ใบรับรองการอยู่อาศัย', personal_cert: 'หนังสือรับรองบุคคล',
  conduct_cert: 'หนังสือรับรองความประพฤติ', tax_notice: 'ชำระภาษีที่ดินและสิ่งปลูกสร้าง',
  waste_collection: 'ชำระค่าธรรมเนียมเก็บขนขยะ', other: 'คำขออื่นๆ',
}
const thDate = (s) => new Date(s).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })

// ดึงข้อมูลจริงมาสรุปให้ AI ใช้ตอบ — กิจกรรมสาธารณะ (ทุกคนดูได้) และคำร้อง/เอกสาร
// เฉพาะของผู้ใช้ที่ล็อกอินอยู่เท่านั้น (ห้ามหลุดข้อมูลของคนอื่น) เหมือนกฎเดียวกับ
// MyComplaints.jsx / MyDocRequests.jsx
async function buildContext(tenantId) {
  if (!tenantId) return ''
  const today = new Date().toISOString().split('T')[0]
  const lines = []

  const { data: events } = await supabase.from('events')
    .select('title, event_date, event_time, location')
    .eq('municipality_id', tenantId).contains('audiences', ['public'])
    .gte('event_date', today).order('event_date', { ascending: true }).limit(5)
  if (events?.length) {
    lines.push('กิจกรรมที่จะถึงเร็วๆ นี้ (เปิดให้ประชาชนทั่วไป):')
    for (const e of events) {
      const d = new Date(e.event_date + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
      lines.push(`- ${d}${e.event_time ? ' ' + e.event_time.slice(0, 5) + ' น.' : ''} ${e.title}${e.location ? ' ที่ ' + e.location : ''}`)
    }
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user?.id) {
    const { data: complaints } = await supabase.from('complaints')
      .select('id, category, status, created_at')
      .eq('municipality_id', tenantId).eq('user_id', session.user.id)
      .order('created_at', { ascending: false }).limit(5)
    if (complaints?.length) {
      lines.push('คำร้องเรียนของผู้ใช้คนนี้ (ล่าสุด):')
      for (const c of complaints) {
        lines.push(`- #${c.id.slice(0, 8)} ${CATEGORY_LABEL[c.category] ?? c.category} — สถานะ: ${STATUS_LABEL[c.status] ?? c.status} (แจ้งเมื่อ ${thDate(c.created_at)})`)
      }
    }

    const { data: docs } = await supabase.from('document_requests')
      .select('id, doc_type, status, created_at')
      .eq('municipality_id', tenantId).eq('user_id', session.user.id)
      .order('created_at', { ascending: false }).limit(5)
    if (docs?.length) {
      lines.push('คำขอเอกสาร/E-Service ของผู้ใช้คนนี้ (ล่าสุด):')
      for (const r of docs) {
        lines.push(`- #${r.id.slice(0, 8)} ${DOC_TYPE_LABEL[r.doc_type] ?? r.doc_type} — สถานะ: ${STATUS_LABEL[r.status] ?? r.status} (ยื่นเมื่อ ${thDate(r.created_at)})`)
      }
    }
  } else {
    lines.push('หมายเหตุ: ผู้ใช้คนนี้ยังไม่ได้ล็อกอิน ถ้าถามเรื่องสถานะคำร้อง/เอกสารส่วนตัว ให้แนะนำให้ล็อกอินก่อนแล้วเข้าเมนู "คำร้องของฉัน" หรือ "คำขอเอกสารของฉัน"')
  }

  return lines.join('\n')
}

export async function askGemini(messages, userText, tenantName, tenantId) {
  const context = await buildContext(tenantId).catch(() => '')

  const { data, error } = await supabase.functions.invoke('gemini-chat', {
    body: { messages, userText, tenantName, context },
  })

  if (error) throw error
  if (!data?.reply) throw new Error('empty reply from gemini-chat')

  return data.reply
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = () => reject(reader.error ?? new Error('อ่านไฟล์ไม่สำเร็จ'))
    reader.readAsDataURL(file)
  })
}

// เรียกตรงด้วย fetch (ไม่ผ่าน supabase.functions.invoke) เพราะ client กลาง
// ใน supabase.js มี timeout ตายตัว 25 วินาทีสำหรับทุก request (กันเคส auth ค้าง)
// แต่การอ่านรูป/PDF ด้วย Gemini กินเวลานานกว่านั้นได้ปกติ (เจอจริง ~80 วินาที)
const EXTRACT_TIMEOUT_MS = 120_000

export async function extractEventFromFile(file, categories, todayDate) {
  const base64Data = await fileToBase64(file)

  const res = await fetch(`${supabaseUrl}/functions/v1/gemini-extract-event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'apikey': supabaseAnonKey,
    },
    body: JSON.stringify({ mimeType: file.type, base64Data, categories, todayDate }),
    signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  if (!data?.extracted) throw new Error('empty extraction result')

  return data.extracted
}
