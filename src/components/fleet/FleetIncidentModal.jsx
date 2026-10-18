import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { assetIdentifier } from '../../lib/fleetAssets'
import { notifyTelegram } from '../../lib/notifyTelegram'
import { todayBangkok } from '../../lib/documentSignatories'
import { defaultAddressee } from '../../lib/fleetFuelMemoPrint'
import { buildFleetForm5Html, INCIDENT_KIND_LABEL } from '../../lib/fleetForm5Print'

// รายงานการสูญหาย/ความเสียหายยานพาหนะ (แบบ 5 ระเบียบ มท. ยานพาหนะ อปท. 2569 ข้อ 18)
// กรอกในระบบแล้วพิมพ์ได้ทุกเมื่อ (เจ้าของระบบเลือก 2026-10-18) · เฉพาะผู้ดูแลยานพาหนะ (RLS fleet_is_manager)
//
// ⚠️ PDPA: ชื่อ/อายุ/ที่อยู่/เลขใบขับขี่ของคนนอกอยู่ใน fleet_incident_people เท่านั้น
// ห้ามใส่ลง logAction/console/Telegram — audit ฝั่ง DB บันทึกแค่ชื่อคอลัมน์ที่เปลี่ยน

const inp = 'w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-transparent'
const lbl = 'text-xs font-semibold text-gray-600 mb-1 block'

const INCIDENT_FIELDS = [
  'incident_kind', 'report_date', 'addressee', 'incident_date', 'incident_time', 'location', 'speed_kmh',
  'origin', 'destination', 'damage', 'other_vehicle', 'other_plate', 'other_cause', 'other_damage',
  'police_station', 'case_result',
]
const PERSON_FIELDS = ['full_name', 'age', 'address', 'license_no']
const SINGLE_ROLES = ['other_driver', 'other_owner', 'investigator']
const LIST_ROLES = ['injured', 'witness']

const ERROR_TEXT = {
  FLEET_INCIDENT_VEHICLE_MISMATCH: 'ยานพาหนะไม่ใช่ของหน่วยงานนี้',
  FLEET_INCIDENT_TRIP_MISMATCH: 'การใช้รถที่อ้างถึงไม่ใช่ของยานพาหนะคันนี้',
  FLEET_INCIDENT_MUNICIPALITY_IMMUTABLE: 'ย้ายรายงานข้ามหน่วยงานไม่ได้',
}

const emptyPerson = () => ({ id: null, full_name: '', age: '', address: '', license_no: '' })
const personHasData = person => PERSON_FIELDS.some(key => String(person?.[key] ?? '').trim() !== '')

function emptyForm() {
  return Object.fromEntries(INCIDENT_FIELDS.map(key => [key, '']))
}

function emptyPeople() {
  return { other_driver: emptyPerson(), other_owner: emptyPerson(), investigator: emptyPerson(), injured: [], witness: [] }
}

function toForm(row) {
  const form = emptyForm()
  for (const key of INCIDENT_FIELDS) form[key] = row?.[key] ?? ''
  form.incident_time = String(form.incident_time ?? '').slice(0, 5)
  return form
}

function toPeople(rows) {
  const people = emptyPeople()
  for (const row of [...(rows ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const person = { id: row.id, full_name: row.full_name ?? '', age: row.age ?? '', address: row.address ?? '', license_no: row.license_no ?? '' }
    if (SINGLE_ROLES.includes(row.role)) people[row.role] = person
    else if (LIST_ROLES.includes(row.role)) people[row.role].push(person)
  }
  return people
}

function bangkokDate(iso) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(iso))
}

function friendlyError(error) {
  const message = String(error?.message ?? error ?? '')
  const code = Object.keys(ERROR_TEXT).find(key => message.includes(key))
  if (code) return ERROR_TEXT[code]
  if (error?.code === '42501' || /row-level security/i.test(message)) return 'บันทึกได้เฉพาะผู้ดูแลระบบยานพาหนะ'
  return message || 'บันทึกไม่สำเร็จ'
}

function printHtml(html) {
  const win = window.open('', '_blank', 'width=900,height=760')
  if (!win) return alert('เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต pop-up แล้วลองใหม่')
  win.document.open()
  win.document.write(html)
  win.document.close()
  setTimeout(async () => {
    try {
      if (win.document.fonts?.ready) {
        await Promise.race([win.document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1200))])
      }
    } catch { /* โหลดฟอนต์ไม่ทันก็พิมพ์ด้วยฟอนต์บนเครื่อง */ }
    win.focus()
    win.print()
  }, 200)
}

/**
 * props:
 *  - vehicle: { id, name, license_plate, asset_code } (จำเป็น)
 *  - trip: ทริปที่เกิดเหตุ (ถ้ามี) — ใช้เติมวันที่/ปลายทาง และเปิดรายงานเดิมของทริปนั้นถ้ามีแล้ว
 *  - incidentId: เปิดรายงานที่มีอยู่
 */
export default function FleetIncidentModal({ tenant, vehicle, trip = null, incidentId = null, onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [currentId, setCurrentId] = useState(incidentId)
  const [form, setForm] = useState(emptyForm)
  const [people, setPeople] = useState(emptyPeople)
  const [loadedPersonIds, setLoadedPersonIds] = useState([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      let id = incidentId
      // ทริปเดียวมีรายงานแล้ว → เปิดฉบับเดิมแก้ต่อ ไม่สร้างซ้ำ
      if (!id && trip?.id) {
        const { data } = await supabase.from('fleet_incidents').select('id')
          .eq('trip_id', trip.id).order('created_at', { ascending: false }).limit(1)
        id = data?.[0]?.id ?? null
      }
      if (id) {
        const [{ data: row, error }, { data: rows }] = await Promise.all([
          supabase.from('fleet_incidents').select('*').eq('id', id).maybeSingle(),
          supabase.from('fleet_incident_people').select('*').eq('incident_id', id),
        ])
        if (cancelled) return
        if (error || !row) {
          alert('เปิดรายงานไม่สำเร็จ หรือไม่มีสิทธิ์ดูรายงานนี้')
          onClose?.()
          return
        }
        setCurrentId(id)
        setForm(toForm(row))
        setPeople(toPeople(rows))
        setLoadedPersonIds((rows ?? []).map(person => person.id))
      } else if (!cancelled) {
        // ระบบเติมจากทริปให้ — เจ้าหน้าที่แก้ทับได้ทุกช่อง
        setForm({
          ...emptyForm(),
          incident_kind: 'damage',
          report_date: todayBangkok(),
          incident_date: trip ? (bangkokDate(trip.started_at) || trip.trip_date || '') : '',
          origin: trip ? (tenant?.name ?? '') : '',
          destination: trip?.destination ?? '',
        })
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // เปิด modal ครั้งเดียวต่อรายงาน/ทริป
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId, trip?.id])

  const set = key => event => setForm(prev => ({ ...prev, [key]: event.target.value }))
  const setSingle = (role, key) => event => setPeople(prev => ({ ...prev, [role]: { ...prev[role], [key]: event.target.value } }))
  const setListItem = (role, index, key) => event => setPeople(prev => ({
    ...prev, [role]: prev[role].map((person, i) => (i === index ? { ...person, [key]: event.target.value } : person)),
  }))
  const addListItem = role => setPeople(prev => ({ ...prev, [role]: [...prev[role], emptyPerson()] }))
  const removeListItem = (role, index) => setPeople(prev => ({ ...prev, [role]: prev[role].filter((_, i) => i !== index) }))

  function incidentPayload() {
    const payload = {}
    for (const key of INCIDENT_FIELDS) {
      const value = typeof form[key] === 'string' ? form[key].trim() : form[key]
      payload[key] = value === '' ? null : value
    }
    payload.incident_kind = payload.incident_kind || 'damage'
    payload.report_date = payload.report_date || todayBangkok()
    payload.speed_kmh = payload.speed_kmh === null ? null : Number(payload.speed_kmh)
    return payload
  }

  function desiredPeople() {
    const rows = []
    for (const role of SINGLE_ROLES) {
      if (personHasData(people[role])) rows.push({ ...people[role], role, sort_order: 0 })
    }
    for (const role of LIST_ROLES) {
      people[role].filter(personHasData).forEach((person, index) => rows.push({ ...person, role, sort_order: index }))
    }
    return rows.map(person => ({
      id: person.id,
      role: person.role,
      sort_order: person.sort_order,
      full_name: String(person.full_name ?? '').trim() || null,
      age: String(person.age ?? '').trim() === '' ? null : Number(person.age),
      address: String(person.address ?? '').trim() || null,
      license_no: person.role === 'other_driver' ? (String(person.license_no ?? '').trim() || null) : null,
    }))
  }

  function validate() {
    const payload = incidentPayload()
    if (payload.speed_kmh !== null && !(payload.speed_kmh >= 0 && payload.speed_kmh <= 300)) return 'ความเร็วต้องอยู่ระหว่าง 0–300 กม./ชม.'
    for (const person of desiredPeople()) {
      if (person.age !== null && !(Number.isInteger(person.age) && person.age >= 0 && person.age <= 130)) return 'อายุต้องเป็นจำนวนเต็ม 0–130 ปี'
    }
    return null
  }

  // บันทึก → คืนข้อมูลที่บันทึกแล้วจริงจาก DB (ใช้พิมพ์ต่อ) หรือ null ถ้าไม่สำเร็จ
  async function save() {
    const problem = validate()
    if (problem) { alert(problem); return null }
    setSaving(true)
    try {
      const payload = incidentPayload()
      const isNew = !currentId
      let id = currentId
      if (isNew) {
        const { data, error } = await supabase.from('fleet_incidents')
          .insert({ ...payload, municipality_id: tenant.id, vehicle_id: vehicle.id, trip_id: trip?.id ?? null })
          .select('id').single()
        if (error) throw error
        id = data.id
        setCurrentId(id)
      } else {
        const { error } = await supabase.from('fleet_incidents').update(payload).eq('id', id)
        if (error) throw error
      }

      const desired = desiredPeople()
      const keepIds = new Set(desired.filter(person => person.id).map(person => person.id))
      const removed = loadedPersonIds.filter(personId => !keepIds.has(personId))
      if (removed.length) {
        const { error } = await supabase.from('fleet_incident_people').delete().in('id', removed)
        if (error) throw error
      }
      for (const person of desired.filter(item => item.id)) {
        const { id: personId, ...values } = person
        const { error } = await supabase.from('fleet_incident_people').update(values).eq('id', personId)
        if (error) throw error
      }
      const inserts = desired.filter(item => !item.id).map(item => {
        const values = { ...item, municipality_id: tenant.id, incident_id: id }
        delete values.id
        return values
      })
      if (inserts.length) {
        const { error } = await supabase.from('fleet_incident_people').insert(inserts)
        if (error) throw error
      }

      const [{ data: row }, { data: rows }] = await Promise.all([
        supabase.from('fleet_incidents').select('*').eq('id', id).single(),
        supabase.from('fleet_incident_people').select('*').eq('incident_id', id),
      ])
      setForm(toForm(row))
      setPeople(toPeople(rows))
      setLoadedPersonIds((rows ?? []).map(person => person.id))
      // ข้อ 18 ให้รายงานผู้บริหารทราบทันที — แจ้งกลุ่มเฉพาะตอนสร้าง ข้อความไม่มีข้อมูลบุคคล
      if (isNew) notifyTelegram('fleet_incident_reported', id)
      onSaved?.(row)
      return { incident: row, people: rows ?? [] }
    } catch (error) {
      alert(friendlyError(error))
      return null
    } finally {
      setSaving(false)
    }
  }

  async function saveAndPrint() {
    const saved = await save()
    if (!saved) return
    printHtml(buildFleetForm5Html({ incident: saved.incident, people: saved.people, vehicle, orgName: tenant?.name ?? '' }))
  }

  async function handleDelete() {
    if (!currentId) return
    if (!confirm('ลบรายงานนี้พร้อมรายชื่อบุคคลทั้งหมด? ลบแล้วกู้คืนไม่ได้')) return
    setSaving(true)
    const { error } = await supabase.from('fleet_incidents').delete().eq('id', currentId)
    setSaving(false)
    if (error) return alert(friendlyError(error))
    onSaved?.(null)
    onClose?.()
  }

  function personFields(person, onChange, { license = false } = {}) {
    return (
      <div className="grid grid-cols-6 gap-2">
        <div className="col-span-4">
          <label className={lbl}>ชื่อ-สกุล</label>
          <input value={person.full_name} onChange={onChange('full_name')} className={inp} />
        </div>
        <div className="col-span-2">
          <label className={lbl}>อายุ (ปี)</label>
          <input type="number" inputMode="numeric" min="0" max="130" value={person.age} onChange={onChange('age')} className={inp} />
        </div>
        {license && (
          <div className="col-span-6">
            <label className={lbl}>ใบอนุญาตขับขี่เลขที่</label>
            <input value={person.license_no} onChange={onChange('license_no')} className={inp} />
          </div>
        )}
        <div className="col-span-6">
          <label className={lbl}>ที่อยู่</label>
          <input value={person.address} onChange={onChange('address')} className={inp} />
        </div>
      </div>
    )
  }

  function personList(role, title) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-gray-600">{title}</p>
          <button type="button" onClick={() => addListItem(role)}
            className="px-2 py-1 rounded-lg text-[11px] font-bold border border-gray-200 text-gray-600 hover:bg-gray-50">+ เพิ่ม</button>
        </div>
        {people[role].length === 0 && <p className="text-[11px] text-gray-400">ไม่มี (ใบพิมพ์เว้นช่องว่างไว้ 2 คนตามแบบ)</p>}
        {people[role].map((person, index) => (
          <div key={person.id ?? `new-${index}`} className="rounded-xl border border-gray-100 bg-gray-50 p-2.5 space-y-2">
            {personFields(person, key => setListItem(role, index, key))}
            <button type="button" onClick={() => removeListItem(role, index)}
              className="text-[11px] font-semibold text-red-500 hover:underline">ลบคนนี้</button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-t-3xl md:rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl">
        <div className="shrink-0 px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-black text-gray-800">รายงานการสูญหาย/ความเสียหาย (แบบ 5)</h2>
            <p className="text-xs text-gray-400">{vehicle?.name} · {assetIdentifier(vehicle)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-5 h-5 border-4 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: 'var(--color-primary)' }} />
          </div>
        ) : (
          <div className="overflow-y-auto p-5 space-y-4 flex-1">
            <p className="text-[11px] leading-relaxed text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              🔒 ข้อมูลบุคคลในรายงานนี้ (คู่กรณี ผู้บาดเจ็บ พยาน) เห็นเฉพาะผู้ดูแลระบบยานพาหนะ และไม่ถูกส่งเข้า Telegram
              ระบบแจ้งกลุ่มแค่ว่ามีรายงานเหตุของรถคันไหน วันไหน ที่ไหน
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex gap-2">
                {Object.entries(INCIDENT_KIND_LABEL).map(([value, text]) => (
                  <label key={value} className={`flex-1 text-center text-sm font-bold rounded-xl border py-2 cursor-pointer ${form.incident_kind === value ? 'border-red-400 bg-red-50 text-red-600' : 'border-gray-200 text-gray-500'}`}>
                    <input type="radio" name="incident_kind" value={value} checked={form.incident_kind === value} onChange={set('incident_kind')} className="sr-only" />
                    {text}
                  </label>
                ))}
              </div>
              <div>
                <label className={lbl}>วันที่รายงาน</label>
                <input type="date" value={form.report_date} onChange={set('report_date')} className={inp} />
              </div>
              <div>
                <label className={lbl}>เรียน</label>
                <input value={form.addressee} onChange={set('addressee')} placeholder={defaultAddressee(tenant?.name)} className={inp} />
              </div>
              <div>
                <label className={lbl}>เหตุเกิดเมื่อวันที่</label>
                <input type="date" value={form.incident_date} onChange={set('incident_date')} className={inp} />
              </div>
              <div>
                <label className={lbl}>เวลา</label>
                <input type="time" value={form.incident_time} onChange={set('incident_time')} className={inp} />
              </div>
              <div className="col-span-2">
                <label className={lbl}>สถานที่เกิดเหตุ</label>
                <input value={form.location} onChange={set('location')} placeholder="เช่น ถนนสาย 101 หน้าโรงเรียนบ้าน…" className={inp} />
                <p className="text-[10px] text-gray-400 mt-1">ระบุถนน/หมู่บ้าน/จุดสังเกต ไม่ต้องใส่ชื่อบุคคล (ข้อความนี้ขึ้นใน Telegram) · แผนที่สังเขปแนบกระดาษตามเดิม</p>
              </div>
              <div>
                <label className={lbl}>ความเร็วขณะเกิดเหตุ (กม./ชม.)</label>
                <input type="number" inputMode="decimal" min="0" max="300" value={form.speed_kmh} onChange={set('speed_kmh')} className={inp} />
              </div>
              <div />
              <div>
                <label className={lbl}>ก่อนเกิดเหตุเดินทางจาก</label>
                <input value={form.origin} onChange={set('origin')} className={inp} />
              </div>
              <div>
                <label className={lbl}>จะไป</label>
                <input value={form.destination} onChange={set('destination')} className={inp} />
              </div>
              <div className="col-span-2">
                <label className={lbl}>ความเสียหาย</label>
                <textarea rows={2} value={form.damage} onChange={set('damage')} className={inp} />
                <p className="text-[10px] text-gray-400 mt-1">บรรยายความเสียหายของรถ/ทรัพย์สิน ไม่ต้องใส่อาการบาดเจ็บ (เป็นข้อมูลสุขภาพ)</p>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-xs font-bold text-gray-700">ยานพาหนะหรือทรัพย์สินฝ่ายตรงข้าม</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>ยานพาหนะ</label>
                  <input value={form.other_vehicle} onChange={set('other_vehicle')} className={inp} />
                </div>
                <div>
                  <label className={lbl}>หมายเลขทะเบียน</label>
                  <input value={form.other_plate} onChange={set('other_plate')} className={inp} />
                </div>
              </div>
              <p className="text-[11px] font-semibold text-gray-500">ผู้ขับขี่</p>
              {personFields(people.other_driver, key => setSingle('other_driver', key), { license: true })}
              <div>
                <label className={lbl}>ชื่อเจ้าของยานพาหนะ</label>
                <input value={people.other_owner.full_name} onChange={setSingle('other_owner', 'full_name')} className={inp} />
              </div>
              <div>
                <label className={lbl}>เหตุเกิดจาก</label>
                <textarea rows={2} value={form.other_cause} onChange={set('other_cause')} className={inp} />
              </div>
              <div>
                <label className={lbl}>ความเสียหาย (ฝ่ายตรงข้าม)</label>
                <textarea rows={2} value={form.other_damage} onChange={set('other_damage')} className={inp} />
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              {personList('injured', 'ผู้บาดเจ็บ')}
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-3">
              <p className="text-xs font-bold text-gray-700">ผู้สอบสวนและพยาน</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>พนักงานสอบสวนชื่อ</label>
                  <input value={people.investigator.full_name} onChange={setSingle('investigator', 'full_name')} className={inp} />
                </div>
                <div>
                  <label className={lbl}>สถานีตำรวจ</label>
                  <input value={form.police_station} onChange={set('police_station')} className={inp} />
                </div>
              </div>
              {personList('witness', 'พยาน')}
              <div>
                <label className={lbl}>ผลของคดี</label>
                <textarea rows={2} value={form.case_result} onChange={set('case_result')} placeholder="กรอกภายหลังเมื่อทราบผลได้" className={inp} />
              </div>
            </div>
          </div>
        )}

        <div className="shrink-0 grid grid-cols-2 gap-2 px-5 pb-5 pt-3 border-t border-gray-100">
          <button onClick={save} disabled={loading || saving}
            className="rounded-xl py-3 text-sm font-bold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
          </button>
          <button onClick={saveAndPrint} disabled={loading || saving}
            className="rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--color-primary)' }}>
            🖨️ บันทึกและพิมพ์แบบ 5
          </button>
          {currentId && (
            <button onClick={handleDelete} disabled={saving}
              className="col-span-2 text-[11px] font-semibold text-red-500 hover:underline disabled:opacity-50">
              ลบรายงานนี้
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
