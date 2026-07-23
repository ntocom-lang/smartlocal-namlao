// Supabase Edge Function: gemini-extract-event
// Deploy: supabase functions deploy gemini-extract-event
// Secrets required (Supabase Dashboard → Settings → Edge Functions → Secrets):
//   GEMINI_API_KEY = <key from https://aistudio.google.com/apikey>
//
// Reads an attached image/PDF (poster, memo, document) and extracts
// structured fields for the "เพิ่มกิจกรรม" (add event) form.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const GEMINI_MODEL = 'gemini-3.5-flash'
const API_KEY = Deno.env.get('GEMINI_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function buildSchema(categories: string[]) {
  return {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING', description: 'ชื่อกิจกรรม' },
      description: { type: 'STRING', description: 'รายละเอียดกิจกรรม สรุปจากเอกสาร' },
      event_date: { type: 'STRING', nullable: true, description: 'วันที่เริ่มกิจกรรม รูปแบบ YYYY-MM-DD หรือ null ถ้าเอกสารไม่ได้ระบุวันที่ชัดเจน' },
      event_time: { type: 'STRING', nullable: true, description: 'เวลาเริ่ม รูปแบบ HH:mm (24 ชม.) หรือ null ถ้าไม่ได้ระบุ' },
      end_time: { type: 'STRING', nullable: true, description: 'เวลาสิ้นสุด รูปแบบ HH:mm หรือ null ถ้าไม่ได้ระบุ' },
      end_date: { type: 'STRING', nullable: true, description: 'วันที่สิ้นสุด (ถ้ากิจกรรมหลายวัน) รูปแบบ YYYY-MM-DD หรือ null' },
      location: { type: 'STRING', description: 'สถานที่จัดกิจกรรม' },
      category: { type: 'STRING', enum: categories, description: 'ประเภทกิจกรรมที่ใกล้เคียงที่สุดจากตัวเลือกที่กำหนด' },
    },
    required: ['title', 'description', 'location', 'category'],
  }
}

// โมเดลของ Google บางช่วงโหลดสูงชั่วคราวแล้วตอบ 503 กลับมา (ข้อความ "high demand...
// try again later") — ลองใหม่เองสัก 2 ครั้งก่อนค่อยส่ง error กลับไปให้ผู้ใช้กดเอง
async function fetchGeminiWithRetry(url: string, body: unknown, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status !== 503 || attempt >= retries) return res
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
  }
}

function extractPrompt(todayDate: string, categories: string[]) {
  return `คุณกำลังอ่านเอกสาร/รูปภาพ (โปสเตอร์ หนังสือเวียน กำหนดการ ฯลฯ) ของหน่วยงานราชการส่วนท้องถิ่นในประเทศไทย เพื่อดึงข้อมูลไปกรอกฟอร์ม "เพิ่มกิจกรรม"

วันนี้คือวันที่ ${todayDate} (ใช้อ้างอิงถ้าเอกสารพูดถึงวันแบบสัมพัทธ์ เช่น "พรุ่งนี้", "ศุกร์นี้")
ประเภทกิจกรรมที่เลือกได้มีเฉพาะ: ${categories.join(', ')} — เลือกอันที่ใกล้เคียงที่สุด

กติกาสำคัญ:
- title, description, location, category: ให้สรุป/อนุมานจากเนื้อหาเอกสารให้ดีที่สุดเสมอ ห้ามเว้นว่าง
- event_date, event_time, end_date, end_time: ใส่ค่าเฉพาะกรณีที่เอกสารระบุ "ชัดเจน" เท่านั้น ถ้าเอกสารไม่ได้บอกวันที่/เวลาไว้ชัดเจน ให้ตอบ null ห้ามเดาวันที่ขึ้นมาเอง เพราะจะถูกนำไปบันทึกในปฏิทินจริง ความผิดพลาดเรื่องวันที่มีผลกระทบสูงกว่าข้อมูลอื่น`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { mimeType, base64Data, categories, todayDate } = await req.json() as {
      mimeType: string
      base64Data: string
      categories: string[]
      todayDate: string
    }

    if (!mimeType || !base64Data) {
      return new Response(JSON.stringify({ error: 'missing mimeType or base64Data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!API_KEY) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not set' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const cats = categories?.length ? categories : ['ประชาสัมพันธ์', 'ประชุม', 'กำหนดการ', 'อบรม', 'อื่นๆ']

    const res = await fetchGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`,
      {
        contents: [{
          role: 'user',
          parts: [
            { text: extractPrompt(todayDate || new Date().toISOString().split('T')[0], cats) },
            { inline_data: { mime_type: mimeType, data: base64Data } },
          ],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: buildSchema(cats),
        },
      }
    )

    if (!res.ok) {
      if (res.status === 503) {
        return new Response(JSON.stringify({ error: 'ตอนนี้ระบบ AI มีผู้ใช้งานหนาแน่น กรุณาลองใหม่อีกครั้งในอีกสักครู่' }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const errorData = await res.json().catch(() => ({}))
      return new Response(JSON.stringify({ error: errorData?.error?.message || `HTTP ${res.status}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const data = await res.json()
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) {
      return new Response(JSON.stringify({ error: 'empty response from Gemini' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let extracted
    try {
      extracted = JSON.parse(raw)
    } catch {
      return new Response(JSON.stringify({ error: 'Gemini returned invalid JSON' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ extracted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
