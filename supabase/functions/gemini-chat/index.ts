// Supabase Edge Function: gemini-chat — ปิดถาวร (stub ตอบ 410 ไม่เรียก Google)
//
// ปิดตั้งแต่ 2026-09-15 (เจ้าของระบบสั่งปิด AI ฝั่งประชาชน/เจ้าหน้าที่ เพราะกลัวโควตาฟรีหมด)
// ตัวที่รันบน production เป็น stub มาตั้งแต่วันนั้น แต่โค้ดใน repo ยังเป็นตัวจริงที่เรียก Gemini ได้
// ใครรัน `supabase functions deploy` แบบไม่ระบุชื่อ บอทเก่าจะกลับมาเงียบๆ และใช้ GEMINI_API_KEY ร่วมกับ
// ที่ปรึกษา AI ของ Super Admin (superadmin-advisor) — ทั้งที่ใครถือ anon key ก็เรียกได้
// 2026-11-08 จึงแทนโค้ดใน repo ด้วย stub ให้ตรงกับ production (ตัวเดิมดูได้จากประวัติ git)
//
// AI ที่ยังเปิดอยู่มีตัวเดียว: supabase/functions/superadmin-advisor (เฉพาะ Super Admin)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  return new Response(JSON.stringify({ error: 'ปิดให้บริการแล้ว' }), {
    status: 410,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
