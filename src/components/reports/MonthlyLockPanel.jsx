import { useState } from 'react'
import { CheckCircle2, Lock, TriangleAlert } from 'lucide-react'
import { MAX_NOTE_LENGTH, MIN_NOTE_LENGTH, lockErrorText, noteIsValid, statsDifferences } from '../../lib/complaintMonthlyLock'

// แผงล็อกตัวเลขสรุปรายเดือน (เฟส 2) — เห็นเฉพาะผู้มีสิทธิ์ ในเดือนที่จบแล้ว · ผู้อ่านทั่วไปเห็นแค่หมายเหตุ "ล็อกเมื่อ…" ในตัวสรุป
// ไม่รู้จัก supabase: รับ onPublish(note) จากหน้าที่เรียก (คืน { error } หรือ { unchanged }) เพื่อให้เทสต์ควบคุมได้
//
// ขั้นตอนตั้งใจให้เบา: ล็อกครั้งแรก = กดปุ่ม + ยืนยัน 1 ครั้ง (ไม่ต้องพิมพ์อะไร) · ล็อกใหม่เมื่อตัวเลขสดต่างจากที่ล็อก
// ต้องพิมพ์เหตุผลสั้นๆ (ผู้อ่านจะเห็นว่าตัวเลขถูกแก้ไข) · ตัวเลขสดเท่าที่ล็อก = ไม่มีปุ่มให้กด (ไม่มีงานให้ทำ)
const buttonBase = 'flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold disabled:opacity-50 max-sm:w-full'

export default function MonthlyLockPanel({ monthLabel, lock, lockedStats, liveStats, onPublish }) {
  const [step, setStep] = useState('idle') // idle | confirm | note
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const differences = lock ? statsDifferences(lockedStats, liveStats) : []

  async function publish() {
    if (busy) return
    setBusy(true)
    setError('')
    setDone('')
    try {
      const result = await onPublish(lock ? note.trim() : null)
      if (result?.error) {
        setError(lockErrorText(result.error))
        return
      }
      setDone(result?.unchanged
        ? 'ตัวเลขปัจจุบันเท่ากับที่ล็อกไว้แล้ว ไม่มีอะไรเปลี่ยน'
        : 'ล็อกตัวเลขแล้ว ภาพและใบ A4 ของเดือนนี้ใช้ตัวเลขชุดนี้')
      setStep('idle')
      setNote('')
    } catch {
      setError(lockErrorText(null))
    } finally {
      setBusy(false)
    }
  }

  const tone = !lock || differences.length > 0
    ? 'border-amber-200 bg-amber-50'
    : 'border-emerald-200 bg-emerald-50'

  return (
    <section aria-label="ล็อกตัวเลขสรุปรายเดือน" data-testid="monthly-lock-panel"
      className={`rounded-2xl border p-3 md:p-4 print:hidden ${tone}`}>
      {!lock ? (
        <>
          <p className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Lock size={16} aria-hidden="true" />ตัวเลขของเดือน{monthLabel} ยังเป็นตัวเลขสด
          </p>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            ร้อยละที่แล้วเสร็จจะขยับเมื่อมีเรื่องปิดทีหลัง ตรวจตัวเลขในหน้านี้แล้วกดล็อก —
            หน้านี้ ภาพ และใบ A4 ของเดือนนี้จะใช้ตัวเลขชุดนี้ ไม่ขยับอีก
          </p>
        </>
      ) : differences.length === 0 ? (
        <p className="flex items-start gap-2 text-sm font-bold text-emerald-900">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>ล็อกตัวเลขแล้วเมื่อวันที่ {lock.publishedAtText}{lock.revision > 1 ? ` (แก้ไขครั้งที่ ${lock.revision - 1})` : ''}
            <span className="block text-xs font-normal text-emerald-800">ตรงกับตัวเลขสดตอนนี้ ไม่มีอะไรต้องทำ</span></span>
        </p>
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <TriangleAlert size={16} className="shrink-0 text-amber-600" aria-hidden="true" />
            ตัวเลขสดตอนนี้ต่างจากที่ล็อกไว้เมื่อวันที่ {lock.publishedAtText}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-gray-700">
            {differences.map(({ key, label, locked, live }) => (
              <li key={key}>{label}: ล็อกไว้ {locked ?? '—'} · ตอนนี้ {live ?? '—'}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            หน้านี้ยังแสดงตัวเลขที่ล็อกไว้ จะเปลี่ยนก็ต่อเมื่อล็อกใหม่ (ต้องระบุเหตุผล และผู้อ่านจะเห็นว่าตัวเลขถูกแก้ไข)
          </p>
        </>
      )}

      {/* ปุ่ม: ไม่มีปุ่มเมื่อชุดที่ล็อกตรงกับตัวเลขสดแล้ว */}
      {(!lock || differences.length > 0) && step === 'idle' && (
        <button type="button" disabled={busy} onClick={() => setStep(lock ? 'note' : 'confirm')}
          className={`${buttonBase} mt-3 text-white`} style={{ backgroundColor: 'var(--color-primary)' }}>
          <Lock size={16} aria-hidden="true" />{lock ? 'ล็อกใหม่ด้วยตัวเลขปัจจุบัน' : 'ล็อกตัวเลขของเดือนนี้'}
        </button>
      )}

      {step === 'confirm' && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700">ล็อกตัวเลขที่เห็นอยู่ตอนนี้ใช่ไหม? แก้ภายหลังได้ (ต้องระบุเหตุผล)</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={publish}
              className={`${buttonBase} text-white`} style={{ backgroundColor: 'var(--color-primary)' }}>
              {busy ? 'กำลังล็อก...' : 'ยืนยันล็อก'}
            </button>
            <button type="button" disabled={busy} onClick={() => { setStep('idle'); setError('') }}
              className={`${buttonBase} border border-gray-300 bg-white text-gray-700`}>ยกเลิก</button>
          </div>
        </div>
      )}

      {step === 'note' && (
        <div className="mt-3 space-y-2">
          <label htmlFor="lock-note" className="block text-xs font-semibold text-gray-700">
            เหตุผลที่ล็อกใหม่ (จำเป็น · อย่างน้อย {MIN_NOTE_LENGTH} ตัวอักษร)
          </label>
          <textarea id="lock-note" rows={2} maxLength={MAX_NOTE_LENGTH} value={note} onChange={event => setNote(event.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2"
            style={{ '--tw-ring-color': 'var(--color-primary)' }} placeholder="เช่น มีเรื่องที่ปิดหลังเผยแพร่รอบแรก" />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !noteIsValid(note)} onClick={publish}
              className={`${buttonBase} text-white`} style={{ backgroundColor: 'var(--color-primary)' }}>
              {busy ? 'กำลังล็อก...' : 'ยืนยันล็อกใหม่'}
            </button>
            <button type="button" disabled={busy} onClick={() => { setStep('idle'); setNote(''); setError('') }}
              className={`${buttonBase} border border-gray-300 bg-white text-gray-700`}>ยกเลิก</button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{error}</p>}
      {done && <p role="status" className="mt-2 text-xs font-semibold text-emerald-800">{done}</p>}
    </section>
  )
}
