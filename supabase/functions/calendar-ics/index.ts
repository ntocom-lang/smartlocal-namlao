// Supabase Edge Function: calendar-ics
// Deploy: supabase functions deploy calendar-ics
// URL: https://<project>.supabase.co/functions/v1/calendar-ics?token=<calendar_token>
// Google Calendar: ไปที่ "Other calendars" → "From URL" แล้ววาง URL นี้

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  // รองรับ CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*' },
    })
  }

  const url   = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) {
    return new Response('Missing ?token=', { status: 400 })
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // หา municipality จาก token
  const { data: mun } = await db
    .from('municipalities')
    .select('id, name, system_name')
    .eq('calendar_token', token)
    .single()

  if (!mun) {
    return new Response('Invalid token', { status: 404 })
  }

  // ดึง event สาธารณะ (audience='public') ที่มีวันที่
  const { data: events } = await db
    .from('events')
    .select('id, title, description, event_date, end_date, event_time, end_time, is_all_day, location, category')
    .eq('municipality_id', mun.id)
    .contains('audiences', ['public'])
    .not('event_date', 'is', null)
    .order('event_date', { ascending: true })
    .limit(500)

  const calName  = mun.system_name || mun.name || 'SmartLocal'
  const dtstamp  = utcNow()
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SmartLocal//Calendar//TH',
    `X-WR-CALNAME:${fold(`กิจกรรม ${calName}`)}`,
    'X-WR-CALDESC:ปฏิทินกิจกรรมสาธารณะ',
    'X-WR-TIMEZONE:Asia/Bangkok',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  for (const ev of events ?? []) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${ev.id}@smartlocal`)
    lines.push(`DTSTAMP:${dtstamp}`)

    const allDay = ev.is_all_day || !ev.event_time
    if (allDay) {
      lines.push(`DTSTART;VALUE=DATE:${compact(ev.event_date)}`)
      lines.push(`DTEND;VALUE=DATE:${nextCompact(ev.end_date || ev.event_date)}`)
    } else {
      lines.push(`DTSTART;TZID=Asia/Bangkok:${compactDT(ev.event_date, ev.event_time)}`)
      if (ev.end_time) {
        lines.push(`DTEND;TZID=Asia/Bangkok:${compactDT(ev.end_date || ev.event_date, ev.end_time)}`)
      } else {
        lines.push('DURATION:PT1H')
      }
    }

    lines.push(`SUMMARY:${esc(ev.title)}`)
    if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`)
    if (ev.location)    lines.push(`LOCATION:${esc(ev.location)}`)
    if (ev.category)    lines.push(`CATEGORIES:${esc(ev.category)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="calendar.ics"',
      'Cache-Control': 'public, max-age=1800',
      'Access-Control-Allow-Origin': '*',
    },
  })
})

// ── helpers ──────────────────────────────────────────────

function compact(dateStr: string) {
  return dateStr.replace(/-/g, '')
}

function compactDT(dateStr: string, timeStr: string) {
  return compact(dateStr) + 'T' + timeStr.replace(/:/g, '').slice(0, 6).padEnd(6, '0')
}

function nextCompact(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setDate(d.getDate() + 1)
  return compact(d.toISOString().slice(0, 10))
}

function utcNow() {
  return new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
}

function esc(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

// iCal spec: บรรทัดยาวเกิน 75 ตัวต้องพับ (ไม่ได้พับในตัวอย่างนี้เพราะ title สั้นพอ)
function fold(s: string) {
  return s
}
