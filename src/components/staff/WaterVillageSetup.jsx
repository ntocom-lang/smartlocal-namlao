import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, MapPin, Sparkles, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { logAction } from '../../lib/auditLog'
import {
  VILLAGE_NEARBY_KM, VILLAGE_STATUSES, rankStations, resolveLinks, suggestStations, villageStatus, villageTitle,
} from '../../lib/waterVillage'

// ตัวปักหมุดหนักพอสมควร (Leaflet) และใช้แค่ตอนกดปักพิกัด — โหลดเมื่อเปิดจริง
const LeafletMapPicker = lazy(() => import('../common/LeafletMapPicker'))

const TYPE_LABEL = { rain: 'ฝน', waterlevel: 'ระดับน้ำ', dam: 'อ่างเก็บน้ำ' }
const btn = 'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const btnPrimary = `${btn} bg-sky-600 text-white hover:bg-sky-700`
const btnGhost = `${btn} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50`
const inp = 'w-24 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-sky-200'

const linkKey = (moo, type, code) => `${moo}|${type}:${code}`

function StatusPill({ status }) {
  const info = VILLAGE_STATUSES[status.status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${info.chip}`}>
      <span aria-hidden="true">{info.glyph}</span>{info.label}
    </span>
  )
}

// ระยะที่เห็นบนแถวสถานี — บอกที่มาของตัวเลขเสมอ (จากหมู่ / จากสำนักงาน) ไม่ให้เข้าใจผิดว่าวัดจากหมู่
function distanceLabel({ km, from }) {
  if (km === null) return { text: 'ไม่ทราบระยะ', far: false }
  const n = km.toLocaleString('th-TH', { maximumFractionDigits: 1 })
  const base = from === 'village' ? `ห่างจากหมู่ ${n} กม.` : `ห่างจากสำนักงาน ${n} กม.`
  return { text: base, far: km > VILLAGE_NEARBY_KM }
}

function errorText(error) {
  return error?.code === '42501' ? 'คุณไม่มีสิทธิ์แก้ไขรายการนี้' : error?.message || 'ไม่ทราบสาเหตุ'
}

/**
 * ตั้งค่า "หมู่ของฉัน" ของหน้าสถานการณ์น้ำ–ฝน — ฝั่งเจ้าหน้าที่ ตั้งครั้งเดียว
 *
 * ทำไมต้องมีคนตั้ง: ระบบรู้ระยะสถานีจากพิกัด แต่ไม่รู้ว่า "สถานีนี้อยู่ลำน้ำเดียวกับหมู่ไหม" จึงแนะนำให้
 * แล้วให้คนกดยืนยัน ไม่ผูกให้เองเงียบๆ (สถานีแม่น้ำห่าง 5 กม. ไม่ได้บอกสถานการณ์ของห้วยเล็กในหมู่)
 * ไม่มีงานรายวัน ไม่มีปุ่มยืนยันประจำ · ติ๊กแล้วบันทึกทันที ไม่มีสถานะ "ยังไม่ได้บันทึก" ให้ลืม
 *
 * ทะเบียนหมู่ใช้ตารางเดียวกับเมนูตารางเก็บขยะ (waste_villages) ไม่สร้างซ้ำ · ชื่อบ้านแก้ที่เมนูนั้น
 * สิทธิ์แก้ไขตัดสินที่ can_manage_waste_schedule() ฝั่งฐานข้อมูล (ปุ่มที่ซ่อนตรงนี้เป็นแค่ความสะดวก)
 */
export default function WaterVillageSetup({ tenant }) {
  const tenantId = tenant?.id
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [villages, setVillages] = useState([])
  const [links, setLinks] = useState([])
  const [situation, setSituation] = useState(null)
  const [canManage, setCanManage] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [pinFor, setPinFor] = useState(null)
  const [mooCount, setMooCount] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  // ตัวอย่างสถานะต้องเดินตามเวลา (สถานีค้างเกิน 3 ชม. เปลี่ยนเป็น "ข้อมูลไม่พอ") ไม่ใช่ค่าตอนเปิดหน้า
  const [now, setNow] = useState(Date.now)
  const reload = () => setReloadKey(k => k + 1)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!tenantId) return
    let alive = true
    Promise.all([
      supabase.from('waste_villages').select('id, moo_no, name, latitude, longitude')
        .eq('municipality_id', tenantId).order('moo_no'),
      supabase.from('water_village_stations').select('moo_no, station_type, station_code')
        .eq('municipality_id', tenantId),
      // หน้านี้อ่านตาราง water_station_config ตรงไม่ได้ (ถอนสิทธิ์ไว้) — ใช้ RPC เดียวกับหน้าประชาชน
      supabase.rpc('get_public_water_situation', { _municipality_id: tenantId }),
      supabase.rpc('can_manage_waste_schedule', { p_municipality_id: tenantId }),
    ]).then(([vRes, lRes, sRes, pRes]) => {
      if (!alive) return
      setLoading(false)
      const failed = vRes.error || lRes.error || sRes.error
      if (failed) { setLoadError(failed.message); return }
      setLoadError('')
      setVillages(vRes.data ?? [])
      setLinks(lRes.data ?? [])
      setSituation(sRes.data ?? { stations: [], warnings: [] })
      setCanManage(Boolean(pRes.data))
    }).catch(error => {
      if (alive) { setLoading(false); setLoadError(error?.message || 'โหลดข้อมูลไม่สำเร็จ') }
    })
    return () => { alive = false }
  }, [tenantId, reloadKey])

  const stations = situation?.stations ?? []
  const warnings = situation?.warnings ?? []

  const villageObjs = useMemo(() => villages.map(v => ({
    ...v, stations: links.filter(l => l.moo_no === v.moo_no).map(l => ({ station_type: l.station_type, station_code: l.station_code })),
  })), [villages, links])

  const configured = villageObjs.filter(v => v.stations.length > 0).length
  const pending = villageObjs.filter(v => v.stations.length === 0)

  async function toggleLink(village, station, on) {
    const key = linkKey(village.moo_no, station.station_type, station.station_code)
    const row = { municipality_id: tenantId, moo_no: village.moo_no, station_type: station.station_type, station_code: station.station_code }
    setBusy(key)
    setNotice('')
    // delete ที่ RLS ไม่อนุญาตไม่ error แต่ลบ 0 แถว — ขอแถวที่ถูกลบกลับมานับ ไม่งั้นหน้าจอบอกว่าเอาออกแล้วทั้งที่ยังอยู่
    const { data, error } = on
      ? await supabase.from('water_village_stations').insert(row).select('moo_no')
      : await supabase.from('water_village_stations').delete().match(row).select('moo_no')
    if (error || !data?.length) {
      setBusy('')
      setNotice(`บันทึกไม่สำเร็จ: ${error ? errorText(error) : 'ไม่มีสิทธิ์ หรือรายการนี้ถูกแก้ไปแล้ว'}`)
      reload()
      return
    }
    setLinks(prev => on
      ? [...prev, { moo_no: village.moo_no, station_type: station.station_type, station_code: station.station_code }]
      : prev.filter(l => !(l.moo_no === village.moo_no && l.station_type === station.station_type && l.station_code === station.station_code)))
    // รอบันทึกร่องรอยจนเสร็จก่อนปลดแถว — ไม่รอ แล้วผู้ใช้ปิดแท็บทันที คำขอบันทึกจะถูกยกเลิกกลางทาง (เจอตอนทดสอบ)
    await logAction({
      action: on ? 'create' : 'delete', resourceType: 'water_village_station',
      resourceId: key, resourceLabel: `${villageTitle(village)} ↔ ${station.station_name || station.station_code}`,
      municipalityId: tenantId,
    })
    setBusy('')
  }

  async function applySuggestions() {
    const plan = pending.map(v => ({ village: v, list: suggestStations(v, stations).list }))
    const rows = plan.flatMap(p => p.list.map(s => ({
      municipality_id: tenantId, moo_no: p.village.moo_no, station_type: s.station_type, station_code: s.station_code,
    })))
    if (rows.length === 0) {
      alert(`ไม่มีสถานีฝนหรือระดับน้ำอยู่ในระยะ ${VILLAGE_NEARBY_KM} กม. ของหมู่ที่ยังไม่ได้ตั้ง — เลือกสถานีเองในแต่ละหมู่ หรือปักพิกัดหมู่ก่อน`)
      return
    }
    const withNone = plan.filter(p => p.list.length === 0).length
    const first = links.length === 0
    const message = [
      `ผูกสถานีที่ระบบแนะนำให้ ${plan.length - withNone} หมู่ (${rows.length} รายการ)`,
      withNone > 0 ? `อีก ${withNone} หมู่ไม่มีสถานีในระยะ ${VILLAGE_NEARBY_KM} กม. จะขึ้นว่า "ข้อมูลไม่พอ"` : '',
      'ระบบแนะนำจากระยะทางเท่านั้น — ตรวจชื่อลำน้ำของแต่ละสถานีว่าเป็นลำน้ำเดียวกับหมู่จริงก่อนยืนยัน',
      first ? '\nประชาชนจะเห็นส่วน "หมู่ของฉัน" บนหน้าสถานการณ์น้ำ–ฝนทันที' : '',
      '\nบันทึกต่อหรือไม่?',
    ].filter(Boolean).join('\n')
    if (!confirm(message)) return
    setBusy('batch')
    setNotice('')
    const { data, error } = await supabase.from('water_village_stations').insert(rows).select('moo_no')
    if (error || !data?.length) {
      setBusy('')
      setNotice(`บันทึกไม่สำเร็จ: ${error ? errorText(error) : 'ไม่มีสิทธิ์แก้ไข'}`)
      reload()
      return
    }
    await logAction({
      action: 'create', resourceType: 'water_village_station', resourceId: `${tenantId}:batch`,
      resourceLabel: `ผูกสถานีตามที่ระบบแนะนำ ${rows.length} รายการ`, municipalityId: tenantId,
      metadata: { villages: plan.length - withNone, rows: rows.length },
    })
    setBusy('')
    reload()
  }

  async function savePin(village, point) {
    const latitude = Number(point.lat.toFixed(6))
    const longitude = Number(point.lng.toFixed(6))
    setPinFor(null)
    setBusy(`pin|${village.moo_no}`)
    setNotice('')
    const { data, error } = await supabase.from('waste_villages').update({ latitude, longitude }).eq('id', village.id).select('id')
    if (error || !data?.length) {
      setBusy('')
      setNotice(`บันทึกพิกัดไม่สำเร็จ: ${error ? errorText(error) : 'ไม่มีสิทธิ์แก้ไข'}`)
      return
    }
    setVillages(prev => prev.map(v => (v.id === village.id ? { ...v, latitude, longitude } : v)))
    await logAction({ action: 'update', resourceType: 'water_village_coords', resourceId: village.id, resourceLabel: `${villageTitle(village)} พิกัดกลางหมู่`, municipalityId: tenantId })
    setBusy('')
  }

  async function clearPin(village) {
    setBusy(`pin|${village.moo_no}`)
    setNotice('')
    const { data, error } = await supabase.from('waste_villages').update({ latitude: null, longitude: null }).eq('id', village.id).select('id')
    if (error || !data?.length) {
      setBusy('')
      setNotice(`ลบพิกัดไม่สำเร็จ: ${error ? errorText(error) : 'ไม่มีสิทธิ์แก้ไข'}`)
      return
    }
    setVillages(prev => prev.map(v => (v.id === village.id ? { ...v, latitude: null, longitude: null } : v)))
    await logAction({ action: 'delete', resourceType: 'water_village_coords', resourceId: village.id, resourceLabel: `${villageTitle(village)} พิกัดกลางหมู่`, municipalityId: tenantId })
    setBusy('')
  }

  async function createVillages() {
    const count = Number.parseInt(mooCount, 10)
    if (!Number.isInteger(count) || count < 1 || count > 99) return alert('จำนวนหมู่ต้องอยู่ระหว่าง 1 ถึง 99')
    setBusy('villages')
    setNotice('')
    // รูปแบบเดียวกับเมนูตารางเก็บขยะ (upsert เลขหมู่ ไม่ส่งชื่อ → ไม่ทับชื่อบ้านที่เคยกรอก)
    const rows = Array.from({ length: count }, (_, i) => ({ municipality_id: tenantId, moo_no: i + 1 }))
    const { error } = await supabase.from('waste_villages').upsert(rows, { onConflict: 'municipality_id,moo_no', ignoreDuplicates: true })
    setBusy('')
    if (error) { setNotice(`สร้างรายการหมู่ไม่สำเร็จ: ${errorText(error)}`); return }
    reload()
  }

  if (loading) {
    return <div className="flex min-h-40 items-center justify-center" role="status"><Loader2 size={24} className="animate-spin text-sky-500" /></div>
  }
  if (loadError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
        โหลดข้อมูลไม่สำเร็จ: {loadError}
        <button onClick={reload} className={`${btnGhost} mt-3 block`}>ลองใหม่</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm leading-relaxed text-sky-950">
        <p className="flex items-center gap-2 font-semibold"><Info size={18} className="shrink-0" /> อ่านก่อนตั้งค่า</p>
        <ul className="list-disc space-y-1 pl-9 text-sky-900">
          <li>ประชาชนเลือกหมู่ของตัวเองบนหน้าสถานการณ์น้ำ–ฝน แล้วเห็นค่าจากสถานีที่เลือกไว้ที่นี่ (ติดป้ายว่าไม่ใช่ประกาศของ อบต.)</li>
          <li>ระบบแนะนำสถานีจากระยะทางเท่านั้น <b>ระบบรู้ไม่ได้ว่าสถานีอยู่ลำน้ำเดียวกับหมู่หรือไม่</b> ให้ดูชื่อลำน้ำแล้วตัดสินเอง</li>
          <li>หมู่ที่ไม่เลือกสถานีจะขึ้น "ข้อมูลไม่พอ" ไม่ใช่ "ปกติ" · รายการหมู่ใช้ร่วมกับเมนูตารางเก็บขยะ (ชื่อบ้านแก้ที่นั่น)</li>
        </ul>
      </section>

      {!canManage && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          คุณดูได้อย่างเดียว — แก้ไขได้เฉพาะผู้ดูแลระบบและเจ้าหน้าที่สำนักปลัด
        </p>
      )}
      {notice && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{notice}</p>}

      {villages.length === 0 ? (
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-semibold text-gray-800">ยังไม่มีรายการหมู่ของหน่วยงานนี้</p>
          {canManage ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-semibold text-gray-500">
                มีกี่หมู่
                <input type="number" inputMode="numeric" min="1" max="99" value={mooCount}
                  onChange={e => setMooCount(e.target.value)} className={`${inp} mt-1 block`} />
              </label>
              <button type="button" onClick={createVillages} disabled={busy === 'villages' || !mooCount} className={btnPrimary}>
                {busy === 'villages' && <Loader2 size={16} className="animate-spin" />} สร้างรายการหมู่
              </button>
            </div>
          ) : <p className="text-sm text-gray-500">ผู้ดูแลระบบหรือเจ้าหน้าที่สำนักปลัดต้องสร้างรายการหมู่ก่อน</p>}
        </section>
      ) : stations.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          หน่วยงานนี้ยังไม่มีสถานีวัดน้ำ–ฝนในระบบ จึงยังเลือกสถานีให้หมู่ไม่ได้
        </p>
      ) : (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-700">
              ตั้งค่าแล้ว <b>{configured}</b> จาก <b>{villageObjs.length}</b> หมู่
              {configured === 0 && <span className="block text-xs text-gray-500">ประชาชนยังไม่เห็นส่วน "หมู่ของฉัน" จนกว่าจะเลือกสถานีให้หมู่แรก</span>}
            </p>
            {canManage && pending.length > 0 && (
              <button type="button" onClick={applySuggestions} disabled={Boolean(busy)} className={btnPrimary}>
                {busy === 'batch' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                ใช้ตามที่ระบบแนะนำกับ {pending.length} หมู่ที่ยังไม่ตั้ง
              </button>
            )}
          </section>

          <div className="space-y-3">
            {villageObjs.map(village => (
              <VillageCard key={village.id} village={village} stations={stations} warnings={warnings} now={now}
                canManage={canManage} busy={busy}
                onToggle={(station, on) => toggleLink(village, station, on)}
                onPin={() => setPinFor(village)} onClearPin={() => clearPin(village)} />
            ))}
          </div>
        </>
      )}

      {pinFor && (
        <Suspense fallback={null}>
          <LeafletMapPicker
            initialPos={pinFor.latitude !== null && pinFor.longitude !== null ? { lat: Number(pinFor.latitude), lng: Number(pinFor.longitude) } : null}
            fallbackPos={tenant?.latitude ? { lat: Number(tenant.latitude), lng: Number(tenant.longitude) } : null}
            skipGeolocation
            onConfirm={point => savePin(pinFor, point)}
            onClose={() => setPinFor(null)}
          />
        </Suspense>
      )}
    </div>
  )
}

function VillageCard({ village, stations, warnings, now, canManage, busy, onToggle, onPin, onClearPin }) {
  const status = villageStatus({ village, stations, warnings, now })
  const ranked = rankStations(village, stations)
  const suggested = new Set(suggestStations(village, stations).list.map(s => `${s.station_type}:${s.station_code}`))
  const linked = new Set(village.stations.map(l => `${l.station_type}:${l.station_code}`))
  const { missing } = resolveLinks(village, stations)
  const hasPin = village.latitude !== null && village.latitude !== undefined && village.longitude !== null && village.longitude !== undefined
  const pinBusy = busy === `pin|${village.moo_no}`

  return (
    <details className="group rounded-2xl border border-gray-200 bg-white">
      <summary className="flex min-h-[56px] cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-4">
        <span className="font-bold text-gray-900">{villageTitle(village)}</span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">{village.stations.length > 0 ? `เลือก ${village.stations.length} สถานี` : 'ยังไม่เลือกสถานี'}</span>
          <StatusPill status={status} />
        </span>
      </summary>

      <div className="space-y-4 border-t border-gray-100 p-4">
        <p className="text-sm text-gray-700">
          <b>ที่ประชาชนจะเห็น:</b> {status.label}
          {status.reason && <span className="text-gray-500"> — {status.reason}</span>}
          {status.stale.length > 0 && status.status !== 'nodata' && <span className="block text-xs text-amber-700">สถานี{status.stale.map(s => s.station_name).join(', ')} ไม่มีค่าใหม่</span>}
        </p>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500">พิกัดกลางหมู่ (ไม่บังคับ — ใช้คำนวณระยะถึงสถานีให้แม่นขึ้น)</p>
          <div className="flex flex-wrap items-center gap-2">
            {hasPin ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800">
                <CheckCircle2 size={14} /> ปักแล้ว ({Number(village.latitude).toFixed(4)}, {Number(village.longitude).toFixed(4)})
              </span>
            ) : <span className="text-xs text-gray-500">ยังไม่ได้ปัก — ระบบใช้ระยะจากสำนักงานแทน</span>}
            {canManage && (
              <>
                <button type="button" onClick={onPin} disabled={pinBusy} className={btnGhost}>
                  {pinBusy ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />} {hasPin ? 'ปักใหม่' : 'ปักพิกัดหมู่'}
                </button>
                {hasPin && <button type="button" onClick={onClearPin} disabled={pinBusy} className={btnGhost}><X size={16} /> ลบพิกัด</button>}
              </>
            )}
          </div>
          <p className="text-xs text-gray-500">ปักที่ศาลาประชาคมหรือที่ทำการผู้ใหญ่บ้าน ไม่ปักที่บ้านของบุคคล</p>
        </div>

        <fieldset className="space-y-1" disabled={!canManage}>
          <legend className="mb-1 text-xs font-semibold text-gray-500">สถานีที่ใช้อ่านสถานการณ์ของหมู่นี้ (ติ๊กแล้วบันทึกทันที)</legend>
          {ranked.map(({ station, km, from }) => {
            const code = `${station.station_type}:${station.station_code}`
            const key = linkKey(village.moo_no, station.station_type, station.station_code)
            const on = linked.has(code)
            const dist = distanceLabel({ km, from })
            const place = [station.tambon_name && `ต.${station.tambon_name}`, station.amphoe_name && `อ.${station.amphoe_name}`].filter(Boolean).join(' ')
            return (
              <label key={key} className={`flex min-h-[48px] items-start gap-3 rounded-xl border px-3 py-2.5 ${on ? 'border-sky-300 bg-sky-50' : 'border-gray-200 bg-white'} ${canManage ? 'cursor-pointer' : 'cursor-default'}`}>
                <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-sky-600" checked={on}
                  disabled={!canManage || busy === key} onChange={e => onToggle(station, e.target.checked)} />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-gray-900">{TYPE_LABEL[station.station_type]} · {station.station_name}</span>
                    {suggested.has(code) && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800">ระบบแนะนำ</span>}
                    {busy === key && <Loader2 size={14} className="animate-spin text-gray-400" />}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {station.river_name ? `ลำน้ำ ${station.river_name} · ` : ''}{place}{place ? ' · ' : ''}{station.agency_name ? `${station.agency_name} · ` : ''}
                    <span className={dist.far || km === null ? 'font-semibold text-amber-700' : ''}>{dist.text}{dist.far ? ` (ไกลกว่า ${VILLAGE_NEARBY_KM} กม.)` : ''}</span>
                  </span>
                  {station.station_type === 'dam' && <span className="block text-xs text-gray-400">ปริมาตรอ่างไม่ได้บอกน้ำที่หมู่โดยตรง ระบบไม่แนะนำให้</span>}
                </span>
              </label>
            )
          })}
          {missing.map(link => {
            const key = linkKey(village.moo_no, link.station_type, link.station_code)
            return (
              <div key={key} className="flex min-h-[48px] items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span>{TYPE_LABEL[link.station_type]} · {link.station_code} — สถานีนี้ถูกถอดออกจากระบบ (หมู่จะขึ้น "ข้อมูลไม่พอ")</span>
                {canManage && (
                  <button type="button" onClick={() => onToggle({ station_type: link.station_type, station_code: link.station_code, station_name: link.station_code }, false)}
                    disabled={busy === key} className={btnGhost}><Trash2 size={16} /> เอาออก</button>
                )}
              </div>
            )
          })}
        </fieldset>
      </div>
    </details>
  )
}
