// Supabase Edge Function: gemini-chat
// Deploy: supabase functions deploy gemini-chat
// Secrets required (Supabase Dashboard → Settings → Edge Functions → Secrets):
//   GEMINI_API_KEY = <key from https://aistudio.google.com/apikey>

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const GEMINI_MODEL = 'gemini-3.5-flash'
const API_KEY = Deno.env.get('GEMINI_API_KEY')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function systemInstruction(tenantName?: string, context?: string) {
  const base = `คุณคือ "น้องสมายล์" 🦖 ผู้ช่วย AI ที่คอยช่วยเหลือและให้ข้อมูลประชาชนของ ${tenantName || 'เทศบาล/อบต.'}
กรุณาตอบคำถามอย่างสุภาพ อ่อนน้อม เป็นกันเอง และมีประโยชน์ โดยใช้ภาษาไทยที่อ่านง่ายและกระชับ
หากผู้ใช้สอบถามเกี่ยวกับการร้องเรียน/ร้องทุกข์ ปัญหาขยะ น้ำท่วม ไฟฟ้าถนน หรืออื่นๆ ให้แนะนำให้ไปที่เมนู "ร้องเรียน/ร้องทุกข์" บนหน้าแรก
หากผู้ใช้ต้องการขอเอกสารหรือยื่นเรื่อง ขอ E-Service ให้แนะนำให้ไปที่เมนู "E-Service" หรือ "บริการประชาชน" บนหน้าแรก
หากถามเรื่องการเดินทาง ท่องเที่ยว ที่พัก แนะนำให้ไปที่เมนู "ท่องเที่ยว" หรือ "เที่ยว กิน พัก OTOP" บนหน้าแรก
ตอบสั้นกระชับไม่เกิน 3 ประโยค ลงท้ายด้วย emoji 🦖 เสมอ`

  if (!context) return base

  return `${base}

--- ข้อมูลจริงที่ดึงมาจากระบบ ณ ขณะนี้ (ใช้ตอบได้เฉพาะเรื่องที่ตรงกับข้อมูลนี้เท่านั้น) ---
${context}
--- จบข้อมูลจริง ---
ห้ามอ้างว่ามีข้อมูลอื่นนอกเหนือจากที่ให้มาข้างต้น ถ้าผู้ใช้ถามเรื่องสถานะคำร้อง/เอกสาร/กิจกรรมที่ไม่มีในข้อมูลนี้ ให้ตอบตรงๆ ว่าไม่พบข้อมูล ห้ามเดาหรือมั่ว`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { messages, userText, tenantName, context } = await req.json() as {
      messages?: { id: number; sender: 'user' | 'bot'; text: string }[]
      userText: string
      tenantName?: string
      context?: string
    }

    if (!userText) {
      return new Response(JSON.stringify({ error: 'missing userText' }), {
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

    const contents = (messages ?? [])
      .filter((m) => m.id !== 1)
      .map((m) => ({ role: m.sender === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }))
    contents.push({ role: 'user', parts: [{ text: userText }] })

    const res = await fetchGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`,
      {
        contents,
        systemInstruction: { parts: [{ text: systemInstruction(tenantName, context) }] },
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
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? null

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
