import { useState } from 'react'
import { FileJson, FileSpreadsheet, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchOpenEntries, entriesToGeoJSON, entriesToCsv, datedFilename, downloadTextFile } from '../../lib/dataCenterExport'
import { ghostBtnCls } from './dcTheme'

// ปุ่มดาวน์โหลดข้อมูลเปิดของศูนย์รวมข้อมูลดิจิทัล — ใช้ทั้งหน้าแผนที่สาธารณะ (variant="hero" บนแถบสีน้ำเงิน)
// และแผง "ข้อมูลเปิด" ฝั่งเจ้าหน้าที่ (variant="panel")
// ข้อมูลที่ได้ = รายการที่เปิดใช้งานของ อปท. นี้ ชุดเดียวกับที่แผนที่สาธารณะแสดงอยู่แล้ว (ดู src/lib/dataCenterExport.js)
export default function OpenDataDownload({ tenant, variant = 'hero', isLight = true, onDone }) {
  const [busy, setBusy] = useState(null) // 'geojson' | 'csv' | null
  const [status, setStatus] = useState(null) // { ok, text }

  async function run(kind) {
    if (!tenant?.id || busy) return
    setBusy(kind)
    setStatus(null)
    try {
      const rows = await fetchOpenEntries(supabase, tenant.id)
      const base = `${tenant.slug || 'data-center'}-data-center`
      if (kind === 'geojson') {
        const geo = entriesToGeoJSON(rows, { publisher: tenant.name ?? '', slug: tenant.slug ?? '' })
        downloadTextFile(datedFilename(base, 'geojson'), JSON.stringify(geo, null, 2), 'application/geo+json')
        setStatus({ ok: true, text: `ดาวน์โหลด GeoJSON แล้ว ${geo.metadata.record_count} รายการ` })
      } else {
        downloadTextFile(datedFilename(base, 'csv'), entriesToCsv(rows), 'text/csv;charset=utf-8')
        setStatus({ ok: true, text: `ดาวน์โหลด CSV แล้ว ${rows.length} รายการ` })
      }
      onDone?.(kind, rows.length)
    } catch (e) {
      setStatus({ ok: false, text: e.message || 'ดาวน์โหลดไม่สำเร็จ' })
    } finally {
      setBusy(null)
    }
  }

  const hero = variant === 'hero'
  const btn = hero
    ? 'bg-white/10 hover:bg-white/20 border-white/25 text-white text-[11px] px-3 py-1.5'
    : `${ghostBtnCls(isLight)} text-xs px-4 py-2`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => run('geojson')} disabled={!!busy}
        title="ไฟล์พิกัดมาตรฐาน GeoJSON เปิดใน QGIS / ArcGIS / Google My Maps ได้ทันที"
        className={`inline-flex items-center gap-1.5 rounded-xl border font-bold transition-colors disabled:opacity-60 ${btn}`}>
        {busy === 'geojson' ? <Loader2 size={13} className="animate-spin" /> : <FileJson size={13} />} GeoJSON
      </button>
      <button type="button" onClick={() => run('csv')} disabled={!!busy}
        title="ตาราง CSV (UTF-8) เปิดใน Excel ได้ มีละติจูด/ลองจิจูดแยกคอลัมน์"
        className={`inline-flex items-center gap-1.5 rounded-xl border font-bold transition-colors disabled:opacity-60 ${btn}`}>
        {busy === 'csv' ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />} CSV
      </button>
      {status && (
        <span role="status" className={`text-[11px] font-semibold ${hero ? (status.ok ? 'text-emerald-200' : 'text-red-200') : (status.ok ? (isLight ? 'text-emerald-700' : 'text-emerald-400') : (isLight ? 'text-red-600' : 'text-red-400'))}`}>
          {status.text}
        </span>
      )}
    </div>
  )
}
