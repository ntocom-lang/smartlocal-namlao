import { DAY_KEYS, DAY_LABEL_TH } from '../../lib/tourismPlaces'

// ตัวกรอกเวลาทำการ 7 วัน → เก็บเป็น jsonb { "mon": ["08:30","16:30"], "tue": null }
//
// ทำเป็นตารางติ๊กเปิด/ปิดรายวันแทนช่องข้อความอิสระ เพราะข้อความอิสระ ("จ-ศ 8.30-16.30 น.")
// เอาไปคำนวณป้าย "เปิดอยู่ตอนนี้" ไม่ได้เลย ซึ่งเป็นข้อมูลที่ประชาชนต้องการที่สุดตอนหาร้าน
// ส่วนข้อความที่ตารางรับไม่ได้ (เช่น "ปิดวันพระ") ให้ไปอยู่ในช่อง "หมายเหตุเวลาทำการ" แทน

export default function OpeningHoursEditor({ enabled, onToggle, rows, onChange }) {
  const inputCls = 'border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200'

  function setRow(i, patch) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  function applyPreset(preset) {
    if (preset === 'office') {
      // จ-ศ ราชการ
      onChange(DAY_KEYS.map((k) => (k === 'sat' || k === 'sun'
        ? { enabled: false, from: '08:30', to: '16:30' }
        : { enabled: true, from: '08:30', to: '16:30' })))
    } else if (preset === 'everyday') {
      onChange(DAY_KEYS.map(() => ({ enabled: true, from: '08:00', to: '18:00' })))
    } else if (preset === 'copyMon') {
      const mon = rows[1]
      onChange(rows.map(() => ({ ...mon })))
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={e => onToggle(e.target.checked)}
          className="w-4 h-4 rounded accent-blue-500" />
        <span className="text-sm font-semibold text-gray-700">ระบุเวลาทำการ</span>
        <span className="text-[11px] text-gray-400">(ไม่ติ๊ก = ไม่แสดงป้ายเปิด/ปิด)</span>
      </label>

      {enabled && (
        <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-100">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => applyPreset('office')}
              className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600">
              จ-ศ 08:30-16:30
            </button>
            <button type="button" onClick={() => applyPreset('everyday')}
              className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600">
              ทุกวัน 08:00-18:00
            </button>
            <button type="button" onClick={() => applyPreset('copyMon')}
              className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600">
              ใช้เวลาวันจันทร์ทุกวัน
            </button>
          </div>

          {DAY_KEYS.map((k, i) => (
            <div key={k} className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 w-24 shrink-0 cursor-pointer">
                <input type="checkbox" checked={rows[i].enabled}
                  onChange={e => setRow(i, { enabled: e.target.checked })}
                  className="w-4 h-4 rounded accent-blue-500" />
                <span className="text-sm text-gray-700">{DAY_LABEL_TH[k]}</span>
              </label>
              {rows[i].enabled ? (
                <div className="flex items-center gap-1.5">
                  <input type="time" value={rows[i].from} onChange={e => setRow(i, { from: e.target.value })}
                    className={inputCls} aria-label={`เวลาเปิดวัน${DAY_LABEL_TH[k]}`} />
                  <span className="text-gray-400 text-sm">-</span>
                  <input type="time" value={rows[i].to} onChange={e => setRow(i, { to: e.target.value })}
                    className={inputCls} aria-label={`เวลาปิดวัน${DAY_LABEL_TH[k]}`} />
                </div>
              ) : (
                <span className="text-sm text-gray-400">ปิด</span>
              )}
            </div>
          ))}
          <p className="text-[11px] text-gray-400 leading-relaxed">
            ร้านที่เปิดข้ามเที่ยงคืน ให้ใส่เวลาปิดเป็นเวลาของวันถัดไปได้เลย เช่น 18:00 - 01:00
          </p>
        </div>
      )}
    </div>
  )
}
