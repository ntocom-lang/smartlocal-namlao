import { useState } from 'react'
import { MapPin, Camera, Loader2, Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import { OdorAckBadge } from './OdorFieldsDisplay'

// ตาราง/ตัวกรองของหมวดเฉพาะกิจ "กลิ่นเหม็นรบกวน" — ใช้ร่วมกัน 2 หน้า:
//   - แอดมิน  : ComplaintsManager.jsx แท็ป "กลิ่นเหม็นรบกวน (เฉพาะกิจ)"
//   - เจ้าหน้าที่: staff/OdorAcknowledgePanel.jsx (ผู้รับผิดชอบกดรับทราบ)
// เดิมสองหน้าเขียนตารางแยกกันคนละชุด คอลัมน์/ตัวกรอง/การเรียงลำดับไม่ตรงกัน และเวลาเพิ่มคอลัมน์ต้องแก้
// 2 รอบ (ปัญหาเดียวกับไอคอน Data Center ที่เพิ่งรวมเป็นจุดเดียวไป) — รวมมาที่นี่ที่เดียว
//
// ต่างกันแค่ mode:
//   admin → มีคอลัมน์ "ผู้รับผิดชอบ"
//   staff → ไม่มี เพราะทุกแถวเป็นชื่อตัวเอง (ซ้ำทุกบรรทัด เปลืองพื้นที่เปล่า)
// ส่วนปุ่มลบ/พิมพ์ (แอดมิน) และปุ่มรับทราบ (เจ้าหน้าที่) อยู่ในบ็อปอัพรายละเอียดของแต่ละหน้า
// ส่งเข้ามาทาง children ของ OdorDetailModal ไม่ได้ฝังไว้ในตารางนี้

// ตัวกรอง "ช่วงเวลา" — เวลาแจ้งแต่ละคำร้องมักไม่ซ้ำกันเป๊ะ ดึงมาเป็นดรอปดาวน์ตรงๆ แบบสถานที่/ความรุนแรง
// ไม่มีประโยชน์ (ตัวเลือกจะเยอะเกือบเท่าจำนวนแถว) จึงแบ่งเป็นช่วงคงที่ 4 ช่วงแทน
// มีประโยชน์กับ odor โดยเฉพาะ เพราะกลิ่น/ทิศทางลมมักสัมพันธ์กับช่วงเวลาของวัน
const ODOR_TIME_RANGES = [
  { value: 'dawn',      label: 'เช้ามืด (00:01–06:00)', from: 0,  to: 6 },
  { value: 'morning',   label: 'เช้า (06:01–12:00)',    from: 6,  to: 12 },
  { value: 'afternoon', label: 'บ่าย (12:01–18:00)',     from: 12, to: 18 },
  { value: 'evening',   label: 'ค่ำ/กลางคืน (18:01–24:00)', from: 18, to: 24 },
]
function odorTimeRangeOf(dateStr) {
  const h = new Date(dateStr).getHours()
  return ODOR_TIME_RANGES.find((r) => h >= r.from && h < r.to)?.value ?? null
}

const odorLocationOf = (c) => c.location_name || c.village || 'ไม่ระบุสถานที่'
const fmtDate = (s) => new Date(s).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })
const fmtTime = (s) => new Date(s).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })

// หัวคอลัมน์ที่กดเรียงลำดับได้ (cursor-pointer + hover + ลูกศรขึ้น/ลงเมื่อ active)
function OdorSortTh({ label, sortKey, sortConfig, onSort, align = 'left' }) {
  const active = sortConfig.key === sortKey
  return (
    <th
      className={`px-2 py-2.5 text-[11px] font-bold text-white border-r border-white/10 cursor-pointer hover:bg-white/10 transition-colors ${
        align === 'center' ? 'text-center' : 'text-left'
      }`}
      onClick={() => onSort(sortKey)}>
      <div className={`flex items-center gap-1 ${align === 'center' ? 'justify-center' : ''}`}>
        {label}
        {active && (sortConfig.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </div>
    </th>
  )
}

// บ็อปอัพรายละเอียด — โครงเดียวกันทั้ง 2 หน้า ปุ่มการทำงานส่งเข้ามาทาง children
// (แอดมิน: มอบหมายใหม่ + ลบ / เจ้าหน้าที่: รับทราบ)
export function OdorDetailModal({ loading, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-100 bg-white rounded-t-2xl">
          <h3 className="text-sm font-bold text-lime-800 flex items-center gap-1.5">
            💨 รายละเอียดคำร้องกลิ่นเหม็นรบกวน
          </h3>
          <button onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 size={22} className="animate-spin mr-2" /> กำลังโหลด...
            </div>
          ) : children}
        </div>
      </div>
    </div>
  )
}

export default function OdorComplaintTable({
  complaints,
  mode = 'admin',
  technicians = [],
  detailLoadingId = null,
  onRowClick,
  // ({ filtered, filterSummary }) => node — แอดมินใช้ใส่ปุ่มพิมพ์รายงานที่ต้องรู้ผลลัพธ์หลังกรอง
  renderToolbarExtra,
  emptyText = 'ยังไม่มีคำร้องหมวดกลิ่นเหม็นรบกวน',
}) {
  const [filterLocation, setFilterLocation] = useState('')
  const [filterIntensity, setFilterIntensity] = useState('')
  const [filterHealth, setFilterHealth] = useState('')
  const [filterTimeRange, setFilterTimeRange] = useState('')
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })

  function handleSort(key) {
    setSortConfig((prev) => prev.key === key
      ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' })
  }

  const showAssignee = mode === 'admin'

  // ตัวเลือกตัวกรอง — ดึงจากค่าที่มีอยู่จริงในข้อมูลเท่านั้น (ไม่ hardcode) พร้อมนับจำนวนต่อค่า
  // ให้เห็นว่าเลือกแล้วจะเหลือกี่รายการก่อนกด
  const countBy = (getter) => Object.entries(
    complaints.reduce((acc, c) => {
      const v = getter(c)
      if (v != null && v !== '') acc[v] = (acc[v] || 0) + 1
      return acc
    }, {})
  )
  const locationOptions = countBy((c) => c.location_name || c.village).sort((a, b) => b[1] - a[1])
  const intensityOptions = countBy((c) => c.extra_data?.odor_intensity).sort((a, b) => Number(a[0]) - Number(b[0]))
  const healthOptions = countBy((c) => c.extra_data?.health_effect).sort((a, b) => b[1] - a[1])
  const timeRangeCounts = complaints.reduce((acc, c) => {
    const r = odorTimeRangeOf(c.created_at)
    if (r) acc[r] = (acc[r] || 0) + 1
    return acc
  }, {})

  const filtered = complaints.filter((c) => {
    if (filterLocation && (c.location_name || c.village || '') !== filterLocation) return false
    if (filterIntensity && String(c.extra_data?.odor_intensity ?? '') !== filterIntensity) return false
    if (filterHealth && (c.extra_data?.health_effect || '') !== filterHealth) return false
    if (filterTimeRange && odorTimeRangeOf(c.created_at) !== filterTimeRange) return false
    return true
  })

  const sortGetters = {
    location: (c) => (c.location_name || c.village || '').toLowerCase(),
    created_at: (c) => c.created_at || '',
    intensity: (c) => c.extra_data?.odor_intensity ?? -1,
    health: (c) => (c.extra_data?.health_effect || '').toLowerCase(),
    assignee: (c) => (technicians.find((t) => t.id === c.assigned_to)?.full_name || '').toLowerCase(),
    status: (c) => c.extra_data?.acknowledged_at || '',
  }
  const sorted = sortConfig.key
    ? [...filtered].sort((a, b) => {
        const get = sortGetters[sortConfig.key]
        const av = get(a), bv = get(b)
        const dir = sortConfig.direction === 'asc' ? 1 : -1
        if (av < bv) return -1 * dir
        if (av > bv) return 1 * dir
        return 0
      })
    : filtered

  const hasFilter = Boolean(filterLocation || filterIntensity || filterHealth || filterTimeRange)
  // ข้อความสรุปตัวกรองที่ใช้อยู่ — หน้าแอดมินเอาไปพิมพ์กำกับหัวรายงานให้ผู้บังคับบัญชารู้ว่ากรองอะไรมา
  const filterSummary = [
    filterLocation && `สถานที่: ${filterLocation}`,
    filterIntensity && `ความรุนแรง: ${filterIntensity}/5`,
    filterHealth && `อาการ: ${filterHealth}`,
    filterTimeRange && `ช่วงเวลา: ${ODOR_TIME_RANGES.find((r) => r.value === filterTimeRange)?.label}`,
  ].filter(Boolean).join(' · ')

  const selectCls = 'px-2.5 py-1.5 rounded-xl border border-lime-200 bg-white text-xs text-gray-700 focus:outline-none focus:border-lime-400'

  if (complaints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <Search size={32} className="mb-2 opacity-30" />
        <p className="text-sm">{emptyText}</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100 bg-lime-50/40">
        <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)} className={selectCls}>
          <option value="">สถานที่ทั้งหมด</option>
          {locationOptions.map(([loc, count]) => <option key={loc} value={loc}>{loc} ({count})</option>)}
        </select>
        <select value={filterIntensity} onChange={(e) => setFilterIntensity(e.target.value)} className={selectCls}>
          <option value="">ความรุนแรงทั้งหมด</option>
          {intensityOptions.map(([lv, count]) => <option key={lv} value={lv}>{lv} / 5 ({count})</option>)}
        </select>
        <select value={filterHealth} onChange={(e) => setFilterHealth(e.target.value)} className={selectCls}>
          <option value="">อาการทางสุขภาพทั้งหมด</option>
          {healthOptions.map(([h, count]) => <option key={h} value={h}>{h} ({count})</option>)}
        </select>
        <select value={filterTimeRange} onChange={(e) => setFilterTimeRange(e.target.value)} className={selectCls}>
          <option value="">ช่วงเวลาทั้งหมด</option>
          {ODOR_TIME_RANGES.map((r) => (
            <option key={r.value} value={r.value}>{r.label} ({timeRangeCounts[r.value] ?? 0})</option>
          ))}
        </select>
        {hasFilter && (
          <button type="button"
            onClick={() => { setFilterLocation(''); setFilterIntensity(''); setFilterHealth(''); setFilterTimeRange('') }}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 transition-colors flex items-center gap-1">
            <X size={12} /> ล้างตัวกรอง
          </button>
        )}
        {sortConfig.key && (
          <button type="button" onClick={() => setSortConfig({ key: null, direction: 'asc' })}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors flex items-center gap-1">
            <X size={12} /> ล้างการเรียงลำดับ
          </button>
        )}
        {renderToolbarExtra?.({ filtered: sorted, filterSummary })}
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Search size={32} className="mb-2 opacity-30" />
          <p className="text-sm">ไม่พบรายการที่ตรงกับตัวกรอง</p>
        </div>
      ) : (
        <>
          {/* Mobile: การ์ด — ชื่อผู้แจ้งอยู่ในบ็อปอัพรายละเอียดเท่านั้น ใช้สถานที่เป็นตัวระบุหลัก */}
          <div className="md:hidden divide-y divide-gray-100">
            {sorted.map((c) => (
              <div key={c.id} className="px-4 py-3.5">
                <button type="button" onClick={() => onRowClick?.(c)}
                  className="w-full flex items-center justify-between gap-3 text-left">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate flex items-center gap-1.5">
                      {odorLocationOf(c)}
                      {c.latitude && <MapPin size={11} className="text-orange-500 shrink-0" />}
                      {c.attachments?.length > 0 && <Camera size={11} className="text-blue-500 shrink-0" />}
                    </p>
                    <p className="text-xs text-gray-400">
                      {fmtDate(c.created_at)} · {fmtTime(c.created_at)} · ความรุนแรง {c.extra_data?.odor_intensity ?? '-'}/5
                    </p>
                  </div>
                  {detailLoadingId === c.id
                    ? <Loader2 size={14} className="animate-spin text-lime-500 shrink-0" />
                    : <OdorAckBadge complaint={c} />}
                </button>
              </div>
            ))}
          </div>

          {/* Desktop: table-auto ให้แต่ละคอลัมน์กว้างตามเนื้อหาจริง ไม่ตัดข้อความด้วย truncate
              (เดิมใช้ table-fixed แล้วอาการทางสุขภาพ/ชื่อผู้รับผิดชอบโดนตัด) แลกกับจอแคบอาจต้อง
              เลื่อนซ้ายขวาบ้าง — "เห็นข้อความทั้งหมด" สำคัญกว่า "ไม่มีสกอลเลย" */}
          <div className="hidden md:block w-full max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full table-auto text-sm border-collapse">
              <thead>
                <tr style={{ backgroundColor: '#65a30d' }}>
                  <th className="px-2 py-2.5 text-center text-[11px] font-bold text-white border-r border-white/10">ที่</th>
                  <OdorSortTh label="สถานที่" sortKey="location" sortConfig={sortConfig} onSort={handleSort} />
                  <OdorSortTh label="วันที่แจ้ง" sortKey="created_at" sortConfig={sortConfig} onSort={handleSort} />
                  {/* เวลา = ส่วนเวลาของ created_at เดียวกับคอลัมน์วันที่แจ้ง จึงใช้ sortKey เดียวกัน */}
                  <OdorSortTh label="เวลา" sortKey="created_at" sortConfig={sortConfig} onSort={handleSort} align="center" />
                  <OdorSortTh label="ความรุนแรง" sortKey="intensity" sortConfig={sortConfig} onSort={handleSort} align="center" />
                  <OdorSortTh label="อาการทางสุขภาพ" sortKey="health" sortConfig={sortConfig} onSort={handleSort} />
                  {showAssignee && (
                    <OdorSortTh label="ผู้รับผิดชอบ" sortKey="assignee" sortConfig={sortConfig} onSort={handleSort} />
                  )}
                  <OdorSortTh label="สถานะ" sortKey="status" sortConfig={sortConfig} onSort={handleSort} align="center" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sorted.map((c, i) => {
                  const assignee = technicians.find((t) => t.id === c.assigned_to)?.full_name
                  return (
                    <tr key={c.id} className="cursor-pointer transition-colors"
                      style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#f7faf0' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#ecfccb' }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = i % 2 === 0 ? '#fff' : '#f7faf0' }}
                      onClick={() => onRowClick?.(c)}>
                      <td className="px-2 py-2 text-center text-xs text-gray-500 border-r border-gray-200">{i + 1}</td>
                      <td className="px-2 py-2 text-gray-500 text-xs whitespace-nowrap border-r border-gray-200">
                        <span className="flex items-center gap-1">
                          {c.latitude && <MapPin size={10} className="text-orange-500 shrink-0" />}
                          <span>{odorLocationOf(c)}</span>
                          {c.attachments?.length > 0 && <Camera size={10} className="text-blue-500 shrink-0" />}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-gray-500 text-xs whitespace-nowrap border-r border-gray-200">{fmtDate(c.created_at)}</td>
                      <td className="px-2 py-2 text-center text-gray-500 text-xs whitespace-nowrap border-r border-gray-200">{fmtTime(c.created_at)}</td>
                      <td className="px-2 py-2 text-center text-gray-600 text-xs whitespace-nowrap border-r border-gray-200">
                        {c.extra_data?.odor_intensity ?? '-'} / 5
                      </td>
                      <td className="px-2 py-2 text-gray-600 text-xs whitespace-nowrap border-r border-gray-200">
                        {c.extra_data?.health_effect || <span className="text-gray-300">ไม่มี</span>}
                      </td>
                      {showAssignee && (
                        <td className="px-2 py-2 text-xs whitespace-nowrap border-r border-gray-200">
                          {assignee
                            ? <span className="text-blue-700 font-medium">{assignee}</span>
                            : <span className="text-gray-300">ยังไม่ได้ตั้งค่า</span>}
                        </td>
                      )}
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        {detailLoadingId === c.id
                          ? <Loader2 size={14} className="inline animate-spin text-lime-500" />
                          : <OdorAckBadge complaint={c} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
