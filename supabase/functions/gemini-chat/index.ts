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

function systemInstruction(tenantName?: string) {
  return `คุณคือ "น้องสมายล์" 🦖 ผู้ช่วย AI ที่คอยช่วยเหลือและให้ข้อมูลประชาชนของ ${tenantName || 'เทศบาล/อบต.'}
กรุณาตอบคำถามอย่างสุภาพ อ่อนน้อม เป็นกันเอง และมีประโยชน์ โดยใช้ภาษาไทยที่อ่านง่ายและกระชับ
หากผู้ใช้สอบถามเกี่ยวกับการร้องเรียน/ร้องทุกข์ ปัญหาขยะ น้ำท่วม ไฟฟ้าถนน หรืออื่นๆ ให้แนะนำให้ไปที่เมนู "ร้องเรียน/ร้องทุกข์" บนหน้าแรก
หากผู้ใช้ต้องการขอเอกสารหรือยื่นเรื่อง ขอ E-Service ให้แนะนำให้ไปที่เมนู "E-Service" หรือ "บริการประชาชน" บนหน้าแรก
หากถามเรื่องการเดินทาง ท่องเที่ยว ที่พัก แนะนำให้ไปที่เมนู "ท่องเที่ยว" หรือ "เที่ยว กิน พัก OTOP" บนหน้าแรก
ตอบสั้นกระชับไม่เกิน 3 ประโยค ลงท้ายด้วย emoji 🦖 เสมอ`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { messages, userText, tenantName } = await req.json() as {
      messages?: { id: number; sender: 'user' | 'bot'; text: string }[]
      userText: string
      tenantName?: string
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

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemInstruction(tenantName) }] },
        }),
      }
    )

    if (!res.ok) {
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
