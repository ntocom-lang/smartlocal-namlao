import { supabase, supabaseUrl, supabaseAnonKey } from './supabase'

const PERSONNEL_IDENTITY_QUERY = /(?:ใคร|ชื่อ|รายชื่อ|คนไหน|ผู้ใด|ปัจจุบัน|ดำรงตำแหน่ง|ตำแหน่งอะไร)/
const OFFICIAL_POSITION_QUERY = /(?:นายก|รองนายก|ปลัด|รองปลัด|ประธานสภา|รองประธานสภา|สมาชิกสภา|เลขานุการสภา|ผู้บริหาร|ผู้อำนวยการ|หัวหน้ากอง|หัวหน้าสำนัก|หัวหน้าหน่วย|บุคลากร)/

function isOfficialDirectoryQuestion(text) {
  return PERSONNEL_IDENTITY_QUERY.test(text) && OFFICIAL_POSITION_QUERY.test(text)
}

function filterDirectoryByQuestion(rows, question) {
  const includesPosition = (pattern) => rows.filter((row) => pattern.test(row.position_name || ''))
  const namedPerson = rows.filter((row) => row.full_name && question.includes(row.full_name))
  if (namedPerson.length) return namedPerson
  if (/รอง\s*นายก/.test(question)) return includesPosition(/รองนายก/)
  if (/นายก/.test(question)) return rows.filter((row) => /^(นายกเทศมนตรี|นายกองค์การบริหารส่วนตำบล)/.test(row.position_name || ''))
  if (/รอง\s*ปลัด/.test(question)) return includesPosition(/รองปลัด/)
  if (/ปลัด/.test(question)) return rows.filter((row) => /^(ปลัดเทศบาล|ปลัดองค์การบริหารส่วนตำบล)/.test(row.position_name || ''))
  if (/รอง\s*ประธานสภา/.test(question)) return includesPosition(/รองประธานสภา/)
  if (/ประธานสภา/.test(question)) return rows.filter((row) => /^ประธานสภา/.test(row.position_name || ''))
  if (/สมาชิกสภา/.test(question)) return includesPosition(/สมาชิกสภา/)
  if (/เลขานุการสภา/.test(question)) return includesPosition(/เลขานุการสภา/)

  const departmentMatch = rows.filter((row) => {
    const department = (row.position_name || '').match(/(?:กอง|สำนัก|หน่วย)[^/]+/)?.[0]?.trim()
    return department && question.includes(department)
  })
  if (departmentMatch.length) return departmentMatch
  if (/ผู้อำนวยการ|หัวหน้ากอง|หัวหน้าสำนัก|หัวหน้าหน่วย/.test(question)) {
    return rows.filter((row) => row.position_category === 'dept_head')
  }
  if (/ผู้บริหาร/.test(question)) {
    return rows.filter((row) => ['political_exec', 'top_admin'].includes(row.position_category))
  }
  return rows
}

function positionNameForTenant(positionName, tenantName) {
  const choices = String(positionName || '').split('/').map((choice) => choice.trim()).filter(Boolean)
  if (choices.length < 2) return choices[0] || 'ไม่ระบุตำแหน่ง'
  const isMunicipality = String(tenantName || '').includes('เทศบาล')
  return isMunicipality ? choices[0] : choices[1]
}

async function answerOfficialDirectoryQuestion(tenantId, tenantName, question) {
  if (!tenantId) return 'ยังไม่สามารถระบุหน่วยงานเพื่อค้นหาข้อมูลการแต่งตั้งได้ครับ 🤖'
  const { data, error } = await supabase.rpc('get_public_official_directory', {
    p_municipality_id: tenantId,
  })
  if (error) {
    console.error('official directory lookup failed:', error)
    return 'ขณะนี้ตรวจสอบข้อมูลการแต่งตั้งจากระบบไม่ได้ กรุณาลองใหม่อีกครั้งครับ 🤖'
  }

  const matched = filterDirectoryByQuestion(data || [], question).slice(0, 12)
  if (!matched.length) {
    return 'ยังไม่พบข้อมูลการแต่งตั้งตำแหน่งนี้ในระบบ กรุณาตรวจสอบกับเทศบาลโดยตรงครับ 🤖'
  }
  if (matched.length === 1) {
    return `${positionNameForTenant(matched[0].position_name, tenantName)} คือ ${matched[0].full_name} ครับ 🤖`
  }
  return `ข้อมูลการแต่งตั้งในระบบครับ\n${matched.map((row) => `• ${positionNameForTenant(row.position_name, tenantName)}: ${row.full_name}`).join('\n')} 🤖`
}

// ส่งให้ AI เฉพาะข้อมูลสาธารณะ ห้ามรวมข้อมูลบัญชีหรือข้อมูลคำร้องส่วนบุคคล
async function buildContext(tenantId) {
  if (!tenantId) return ''
  const today = new Date().toISOString().split('T')[0]
  const lines = []

  // 1. ข่าวสาร/ประกาศล่าสุด (Posts)
  const { data: posts } = await supabase.from('posts')
    .select('title, type, created_at')
    .eq('municipality_id', tenantId)
    .eq('is_published', true)
    .order('created_at', { ascending: false }).limit(4).catch(() => ({ data: null }))
  if (posts?.length) {
    lines.push('ข่าวสาร/ประกาศล่าสุดของเทศบาล:')
    for (const p of posts) {
      lines.push(`- ${p.title} (หมวด: ${p.type || 'ทั่วไป'})`)
    }
  }

  // 2. กิจกรรมสาธารณะ (Events)
  const { data: events } = await supabase.from('events')
    .select('title, event_date, event_time, location')
    .eq('municipality_id', tenantId).contains('audiences', ['public'])
    .gte('event_date', today).order('event_date', { ascending: true }).limit(4).catch(() => ({ data: null }))
  if (events?.length) {
    lines.push('กิจกรรมที่จะถึงเร็วๆ นี้:')
    for (const e of events) {
      const d = new Date(e.event_date + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
      lines.push(`- ${d}${e.event_time ? ' ' + e.event_time.slice(0, 5) + ' น.' : ''} ${e.title}${e.location ? ' ที่ ' + e.location : ''}`)
    }
  }

  // 3. เบอร์โทรฉุกเฉินประจำท้องถิ่น (Emergency Contacts)
  const { data: emergency } = await supabase.from('emergency_contacts')
    .select('name, phone_number')
    .eq('municipality_id', tenantId).limit(5).catch(() => ({ data: null }))
  if (emergency?.length) {
    lines.push('เบอร์โทรฉุกเฉินประจำท้องถิ่น:')
    for (const em of emergency) {
      lines.push(`- ${em.name}: ${em.phone_number}`)
    }
  }

  // 4. สถานที่ท่องเที่ยว/OTOP เด่น (Tourism Spots)
  const { data: spots } = await supabase.from('tourism_spots')
    .select('name, category')
    .eq('municipality_id', tenantId).limit(5).catch(() => ({ data: null }))
  if (spots?.length) {
    lines.push('แหล่งท่องเที่ยว/ร้านอาหาร/OTOP ในพื้นที่:')
    for (const s of spots) {
      lines.push(`- ${s.name} (${s.category || 'ท่องเที่ยว/OTOP'})`)
    }
  }

  return lines.join('\n')
}

export async function askGemini(messages, userText, tenantName, tenantId) {
  // ชื่อและตำแหน่งตอบตรงจากฐานข้อมูล ไม่ส่งชื่อบุคลากรไปยัง Gemini
  if (isOfficialDirectoryQuestion(userText)) {
    return answerOfficialDirectoryQuestion(tenantId, tenantName, userText)
  }
  const publicContext = await buildContext(tenantId).catch(() => '')

  const { data, error } = await supabase.functions.invoke('gemini-chat', {
    body: { messages, userText, tenantName, context: publicContext },
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
