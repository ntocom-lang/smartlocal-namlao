// ตรวจ "งบรูป" หน้าแรกของแต่ละ อปท. จากข้อมูลจริงบน Supabase — รันก่อน/หลังเพิ่ม อปท. ใหม่ หรือหลังแอดมินอัปโหลดรูป
//
//   npm run check:image-budget                       (ทุก อปท.)
//   npm run check:image-budget -- --slug namlao      (เฉพาะรายเดียว)
//   npm run check:image-budget -- --verbose          (แสดงรูปทุกใบ ไม่ใช่แค่ 5 ใบที่ใหญ่สุด)
//   npm run check:image-budget -- --skip-drive       (ไม่วัดรูปบน Drive — ถูกกว่า แต่จะ "ตรวจไม่ครบ")
//   IMAGE_BUDGET_KB=1500 IMAGE_SINGLE_MAX_KB=300 npm run check:image-budget
//
// ทำไม: โควตา Cached Egress เป็นของทั้ง org และโตเป็นเส้นตรงกับ (จำนวน อปท.) × (ขนาดรูปต่อการเปิดครั้งแรก)
// เหตุการณ์ 2026-10-04: รูปหน้าแรกน้ำเลา ~12.8 MB ต่อการเปิดครั้งแรก → เกินโควตาแล้วโดนตัดทั้งระบบ (NOTES.md ข้อ 15)
// ด่านย่อรูปตอนอัปโหลด (limitPublicImage) กันของใหม่ แต่รูปที่ขึ้นก่อนมีด่าน/รูปที่ฝังมากับข้อมูลต้องมีตัววัดจริง
// (ตัวนี้เองเจอแบนเนอร์ตำหนักธรรม 5 ใบ 454–1,160 KB ที่รอบย่อรูปครั้งแรกมองข้ามไป)
//
// อ่านอย่างเดียว: ใช้ anon key (สิทธิ์เดียวกับประชาชนเปิดหน้าเว็บ) อ่านตารางสาธารณะ ไม่แตะข้อมูล ไม่ต้องมีรหัสผ่านใดๆ
//  - รูปบน Storage: HEAD ดู Content-Length (ไม่โหลดตัวไฟล์)
//  - รูปบน Drive (/functions/v1/drive-file): Edge Function ไม่ส่ง Content-Length ไม่รับ Range และไม่ถูก CDN แคช
//    จึงต้อง GET แล้วนับไบต์จริง → กิน egress เท่าขนาดรูปทุกใบต่อรอบ (ทุก อปท. รวมกันหลักไม่กี่ MB) อย่ารันถี่
//
// ตัวเลขที่รายงานคือ "ผลรวมทุกรูปที่หน้าแรกอ้างถึง" = กรณีเลวร้ายสุด (จริงโหลดน้อยกว่าเพราะ lazy-load) ไม่ใช่ขนาดที่วัดจากเบราว์เซอร์
// ไม่ผ่านเมื่อ: ยอดรวมเกินงบ · มีรูปเดี่ยวเกินเพดาน (รูปใหญ่ใบเดียวคือต้นเหตุที่เจอจริง) · วัดขนาดไม่ได้ (ห้ามถือว่าผ่านเงียบๆ)

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const DEFAULT_BUDGET_KB = 3072        // ผลรวมรูปทุกใบที่หน้าแรกอ้าง (กรณีเลวร้ายสุด) ต่อ อปท. — ที่โหลดจริงตอนเปิดครั้งแรกราว 55–60% ของตัวเลขนี้เพราะ lazy-load
export const DEFAULT_SINGLE_MAX_KB = 400     // รูปเดี่ยว
const NEWS_LIMIT = 5                         // ตรงกับ .limit(5) ของ Home ทุกธีม
const DRIVE_MEASURE_CAP = 8 * 1024 * 1024    // นับไบต์ Drive ได้ไม่เกินนี้ แล้วตัดสินว่า "ใหญ่เกิน" ไม่ดึงต่อ

const DRIVE_UC = /^https:\/\/drive\.google\.com\/uc\?id=([^&]+)/
const DRIVE_LH3 = /^https:\/\/lh3\.googleusercontent\.com\/d\/([^=&]+)=/

export const isDriveFileUrl = url => /\/functions\/v1\/drive-file\?/.test(url)

// ตรงกับ toReliableImageUrl ใน src/lib/driveStorage.js — URL Drive แบบเก่าจริงๆ ถูกเสิร์ฟผ่าน Edge Function
export function normalizeImageUrl(url, supabaseUrl) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null
  const uc = url.match(DRIVE_UC)
  if (uc) return `${supabaseUrl}/functions/v1/drive-file?id=${uc[1]}`
  const lh3 = url.match(DRIVE_LH3)
  if (lh3) return `${supabaseUrl}/functions/v1/drive-file?id=${lh3[1]}`
  return url
}

/** รวม URL รูปที่หน้าแรกของ อปท. หนึ่งแห่งอ้างถึง (ไม่ซ้ำ) แยกตามที่มา */
export function collectImageRefs({ tenant, banners = [], posts = [], places = [] }, supabaseUrl) {
  const refs = []
  const seen = new Set()
  const add = (source, raw) => {
    const url = normalizeImageUrl(raw, supabaseUrl)
    if (!url || seen.has(url)) return
    seen.add(url)
    refs.push({ source, url })
  }
  add('โลโก้', tenant.logo_url)
  add('ภาพหัวเว็บ', tenant.header_image_url)
  add('Smart City', tenant.smart_city_image_url)
  add('พื้นหลังท่องเที่ยว', tenant.tourism_background_url)
  for (const b of banners) add('แบนเนอร์', b.image_url)
  for (const p of posts) add('ข่าว/กิจกรรม', p.image_url)
  for (const t of places) add('ท่องเที่ยว', t.image_url)
  return refs
}

/**
 * @param {{source:string,url:string,bytes:number|null}[]} sized  bytes = null แปลว่าวัดไม่ได้
 * @returns {{ totalBytes:number, unknown:number, over:boolean, overSingle:object[], top:object[], all:object[], passed:boolean }}
 */
export function summarizeBudget(sized, { budgetKb = DEFAULT_BUDGET_KB, singleMaxKb = DEFAULT_SINGLE_MAX_KB } = {}) {
  const known = sized.filter(r => typeof r.bytes === 'number')
  const totalBytes = known.reduce((sum, r) => sum + r.bytes, 0)
  const ranked = [...known].sort((a, b) => b.bytes - a.bytes)
  const unknown = sized.length - known.length
  const over = totalBytes > budgetKb * 1024
  const overSingle = ranked.filter(r => r.bytes > singleMaxKb * 1024)
  return {
    totalBytes,
    unknown,
    over,
    overSingle,
    top: ranked.slice(0, 5),
    all: ranked,
    // วัดไม่ได้ = ไม่ผ่าน: ตัวตรวจที่มองไม่เห็นรูปแล้วรายงานเขียวคือตัวตรวจที่โกหก
    passed: !over && overSingle.length === 0 && unknown === 0,
  }
}

const kb = bytes => `${Math.round(bytes / 1024).toLocaleString('en-US')} KB`
const shortUrl = url => {
  try {
    const u = new URL(url)
    if (u.searchParams.get('id')) return `drive:${u.searchParams.get('id').slice(0, 10)}…`
    return u.pathname.split('/').slice(-2).join('/')
  } catch { return url.slice(-40) }
}

export function formatReport(results, limits, { verbose = false } = {}) {
  const lines = []
  for (const r of results) {
    const s = r.summary
    const icon = s.passed ? '✅' : '❌'
    const note = s.unknown ? `  ⚠️ วัดขนาดไม่ได้ ${s.unknown} รูป` : ''
    lines.push(`${icon} ${r.slug.padEnd(12)} ${String(r.count).padStart(3)} รูป  รวม ${kb(s.totalBytes).padStart(9)}  (งบ ${limits.budgetKb} KB)${note}`)
    if (!s.passed || verbose) {
      for (const item of verbose ? s.all : s.top) {
        const flag = item.bytes > limits.singleMaxKb * 1024 ? ' ◀ เกินเพดานรูปเดี่ยว' : ''
        lines.push(`      ${kb(item.bytes).padStart(9)}  ${item.source.padEnd(14)} ${shortUrl(item.url)}${flag}`)
      }
      for (const item of r.unmeasured ?? []) lines.push(`      ${'?'.padStart(9)}  ${item.source.padEnd(14)} ${shortUrl(item.url)} ◀ วัดขนาดไม่ได้`)
    }
  }
  return lines.join('\n')
}

// ── ส่วนที่ติดต่อเครือข่าย (ไม่ถูกเรียกตอน import ในเทสต์) ───────────────────────────────────────────
async function loadEnv() {
  const env = { ...process.env }
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) return env
  try {
    const text = await readFile(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*(.*?)\s*$/)
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ไม่มีไฟล์ — ให้ตรวจด้านล่างแจ้งเอง */ }
  return env
}

async function rest(base, key, path) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`${path.split('?')[0]} → HTTP ${res.status}`)
  return res.json()
}

// นับไบต์จริงของ response (ใช้กับ Drive ที่ไม่มี Content-Length) — ตัดการดึงเมื่อเกินเพดานแล้วคืนค่าเพดาน+1
async function countBody(res) {
  let total = 0
  const reader = res.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > DRIVE_MEASURE_CAP) { await reader.cancel().catch(() => {}); return total }
  }
  return total
}

async function sizeOf(url, { skipDrive }) {
  if (isDriveFileUrl(url)) {
    if (skipDrive) return null
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok || !/^image\//i.test(res.headers.get('content-type') || '')) { res.body?.cancel().catch(() => {}); return null }
      const declared = Number(res.headers.get('content-length'))
      if (declared > 0) { res.body?.cancel().catch(() => {}); return declared }
      return await countBody(res)
    } catch { return null }
  }
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(20_000) })
    const length = Number(res.headers.get('content-length'))
    return res.ok && length > 0 ? length : null
  } catch { return null }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}

async function main() {
  const argv = process.argv.slice(2)
  const slugArg = argv.includes('--slug') ? argv[argv.indexOf('--slug') + 1] : null
  const verbose = argv.includes('--verbose')
  const skipDrive = argv.includes('--skip-drive')
  const env = await loadEnv()
  const base = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const key = env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) {
    console.error('ไม่พบ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (ตั้งเป็น env หรือมีใน .env.local)')
    process.exit(2)
  }
  const limits = {
    budgetKb: Number(env.IMAGE_BUDGET_KB) || DEFAULT_BUDGET_KB,
    singleMaxKb: Number(env.IMAGE_SINGLE_MAX_KB) || DEFAULT_SINGLE_MAX_KB,
  }

  const cols = 'id,slug,logo_url,header_image_url,smart_city_image_url,tourism_background_url'
  let tenants = await rest(base, key, `municipalities?select=${cols}&order=slug`)
  if (slugArg) tenants = tenants.filter(t => t.slug === slugArg)
  if (!tenants.length) { console.error(slugArg ? `ไม่พบ อปท. รหัส ${slugArg}` : 'ไม่พบ อปท. เลย'); process.exit(2) }

  const results = []
  for (const tenant of tenants) {
    const id = encodeURIComponent(tenant.id)
    const postQuery = type => `posts?select=image_url&municipality_id=eq.${id}&type=eq.${type}&is_published=eq.true&order=event_date.desc.nullslast,created_at.desc&limit=${NEWS_LIMIT}`
    const [banners, news, activities, places] = await Promise.all([
      rest(base, key, `banners?select=image_url&municipality_id=eq.${id}&is_active=eq.true&order=sort_order`),
      rest(base, key, postQuery('news')),
      rest(base, key, postQuery('activity')),
      rest(base, key, `tourism_places?select=image_url&municipality_id=eq.${id}&is_active=eq.true&order=display_order`),
    ])
    const refs = collectImageRefs({ tenant, banners, posts: [...news, ...activities], places }, base)
    const sized = await mapLimit(refs, 6, async ref => ({ ...ref, bytes: await sizeOf(ref.url, { skipDrive }) }))
    results.push({
      slug: tenant.slug,
      count: refs.length,
      summary: summarizeBudget(sized, limits),
      unmeasured: sized.filter(r => r.bytes === null),
    })
  }

  console.log(formatReport(results, limits, { verbose }))
  const failed = results.filter(r => !r.summary.passed)
  if (failed.length) {
    console.error(`\n${failed.length}/${results.length} อปท. ไม่ผ่านงบรูป — ย่อรูปที่ระบุข้างบน (ขั้นตอนใน NOTES.md ข้อ 15) หรือปรับงบถ้าตั้งใจ`)
    process.exit(1)
  }
  console.log(`\nผ่านครบ ${results.length} อปท.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error('ตรวจงบรูปไม่สำเร็จ:', err.message); process.exit(2) })
}
