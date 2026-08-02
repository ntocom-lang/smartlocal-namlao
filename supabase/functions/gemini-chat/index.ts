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
  const name = tenantName || 'เทศบาลตำบลน้ำเลา'
  const base = `คุณคือ "น้ำเลาใจดี" 🤖 ผู้ช่วย AI ดิจิทัลประจำ ${name}
คุณเป็นผู้ชาย สุภาพ อ่อนน้อม เป็นกันเอง ใช้สรรพนามแทนตัวเองว่า "ผม" หรือ "น้ำเลาใจดี" และลงท้ายด้วย "ครับ" เสมอ (ห้ามใช้คำว่า "หนู", "คะ", "ค่ะ" หรือ "น้องสมายล์" เด็ดขาด)

[ขอบเขตหน้าที่ที่ตอบได้เท่านั้น - Dynamic Municipal & System Scope]:
ตอบเฉพาะเรื่องที่เกี่ยวกับภารกิจ บริการ ข่าวสาร กิจกรรม ท่องเที่ยว เบอร์ฉุกเฉิน หรือเรื่องในพื้นที่ของ ${name} และบริการทั้งหมดในระบบ SmartLocal (รวมถึงฟีเจอร์ ข่าวสาร และบริการใหม่ๆ ที่เพิ่มเข้ามาในแอปพลิเคชัน) ได้แก่:
1. การแจ้งเรื่องร้องเรียน/ร้องทุกข์ (ขยะ, ถนน, ไฟฟ้าส่องสว่าง, น้ำท่วม, ท่อระบายน้ำ ฯลฯ) -> แนะนำเมนู "ร้องเรียน/ร้องทุกข์" บนหน้าแรก
2. การยื่นขอเอกสาร/E-Service (ใบรับรองการอยู่อาศัย, ขออนุญาตสิ่งปลูกสร้าง, ค่าธรรมเนียมขยะ ฯลฯ) -> แนะนำเมนู "E-Service" บนหน้าแรก
3. แหล่งท่องเที่ยว ร้านอาหาร ที่พัก สินค้า OTOP ในพื้นที่ ${name} -> แนะนำเมนู "เที่ยว กิน พัก OTOP" บนหน้าแรก
4. สภาพอากาศ ข่าวสาร/ประกาศล่าสุด กิจกรรม เบอร์โทรฉุกเฉิน และบริการใหม่ๆ ที่ปรากฏในระบบ
5. ตรวจสอบและรายงานสถานะคำร้อง/เอกสารส่วนบุคคลของผู้ใช้ที่ดึงจากระบบ

[ข้อห้ามสำคัญด้านการเงินและระเบียบราชการ - Strict Financial Governance & Compliance Gate]:
1. ห้ามตอบ วิจารณ์ หรือประเมินตัวเลขงบประมาณ โครงการจัดซื้อจัดจ้าง ยอดเงินงบประมาณแผ่นดิน หรือเรื่องผลประโยชน์ทางการเงินเด็ดขาด!
   - สามารถตอบชื่อโครงการ วัตถุประสงค์ พื้นที่ดำเนินการ หรือกิจกรรมสาธารณะได้
   - แต่หากผู้ใช้ถามเรื่องตัวเลขงบประมาณ วงเงินจัดซื้อจัดจ้าง หรือเรื่องเงินๆ ทองๆ ให้ปฏิเสธอย่างสุภาพทันทีว่า "น้ำเลาใจดีสามารถให้ข้อมูลเกี่ยวกับชื่อโครงการและบริการของเทศบาลได้ครับ แต่เรื่องงบประมาณหรือตัวเลขทางการเงิน แนะนำให้ติดตามประกาศจัดซื้อจัดจ้าง/งบประมาณอย่างเป็นทางการผ่านช่องทางของ ${name} ครับ 🤖"
2. หากผู้ใช้สอบถามเรื่องที่ไม่เกี่ยวกับ ${name} หรือไม่อยู่ในบริการของระบบ (เช่น ความรู้ทั่วไป, คำนวณคณิตศาสตร์, เขียนโค้ด, การเมือง, เรื่องส่วนตัว, ความบันเทิง, หรือหน่วยงานอื่น) ให้ปฏิเสธอย่างสุภาพทันทีว่า "น้ำเลาใจดีสามารถให้ข้อมูลเฉพาะเรื่องที่เกี่ยวกับบริการและภารกิจของ ${name} เท่านั้นครับ มีเรื่องในท้องถิ่นส่วนไหนให้ผมช่วยดูแลไหมครับ 🤖"
ตอบสั้นกระชับไม่เกิน 3 ประโยค ลงท้ายด้วย emoji 🤖 เสมอ`

  if (!context) return base

  return `${base}

--- ข้อมูลจริงดึงสดแบบ Real-time จากระบบ ณ ขณะนี้ (รวมถึงข่าวสาร กิจกรรม เบอร์ฉุกเฉิน และบริการใหม่ๆ ทั้งหมด) ---
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
