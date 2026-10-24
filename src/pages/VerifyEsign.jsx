import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, Search, ShieldAlert } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { VERIFY_BUSY_MESSAGE, VERIFY_NOTE, isVerifyBusy, isVerifyCode, verifySlotRows, verifySummary } from '../lib/esignVerify'
import { thaiDateFromDateInput, thaiDateTimeText } from '../lib/thaiDate'

// หน้าตรวจสอบเอกสารลงนามออนไลน์ — ผู้รับใบพิมพ์สแกน QR ท้ายใบแล้วมาที่นี่ (/v/<รหัส 32 ตัว>) ไม่ต้องล็อกอิน
// ข้อมูลมาจาก esign_verify() อย่างเดียว: ไม่ส่งภาพลายเซ็น/เนื้อหาคำขอ/ปลายทาง จึงแสดงไม่ได้แม้โค้ดผิด (tests/esign-verify.playwright.mjs ตรวจ)
const TONES = {
  ok: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', Icon: CheckCircle2, icon: 'text-emerald-600' },
  warn: { box: 'border-amber-200 bg-amber-50 text-amber-900', Icon: Clock, icon: 'text-amber-600' },
  bad: { box: 'border-red-300 bg-red-50 text-red-900', Icon: ShieldAlert, icon: 'text-red-600' },
  mute: { box: 'border-gray-200 bg-gray-50 text-gray-700', Icon: Search, icon: 'text-gray-400' },
}

const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-4'

export default function VerifyEsign() {
  const { code } = useParams()
  const { tenant } = useTenant()
  const codeOk = isVerifyCode(code)
  const [phase, setPhase] = useState(codeOk ? 'loading' : 'notfound') // loading | ready | notfound | error | busy
  const [data, setData] = useState(null)

  // ลิงก์ที่แชร์ต่อไม่ควรไปโผล่ในผลค้นหา
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  const load = useCallback(async () => {
    if (!codeOk) return
    setPhase('loading')
    const { data: result, error } = await supabase.rpc('esign_verify', { p_code: code })
    if (error) { setPhase(isVerifyBusy(error) ? 'busy' : 'error'); return }
    if (!result?.found) { setPhase('notfound'); return }
    setData(result)
    setPhase('ready')
  }, [code, codeOk])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- โหลดข้อมูลจากลิงก์ครั้งแรกตอนเปิดหน้า (async ภายในฟังก์ชัน)
    load()
  }, [load])

  const summary = data ? verifySummary(data) : null
  const rows = data ? verifySlotRows(data) : []
  const tone = summary ? TONES[summary.tone] : null

  return (
    <div className="min-h-screen pb-12" style={{ backgroundColor: '#eef2f7' }}>
      <header style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
        <div className="mx-auto max-w-lg px-4 py-5 text-white">
          <p className="text-xs text-white/75">{data?.municipality_name || tenant?.name || 'หน่วยงาน'}</p>
          <h1 className="text-lg font-bold leading-tight">ตรวจสอบเอกสารลงนามออนไลน์</h1>
        </div>
      </header>

      <main data-verify-page className="mx-auto max-w-lg space-y-3 px-4 py-4">
        {phase === 'loading' && (
          <div className={`${card} flex items-center justify-center gap-2 py-10 text-sm text-gray-500`} role="status">
            <Loader2 size={18} className="animate-spin" aria-hidden="true" /> กำลังตรวจสอบ...
          </div>
        )}

        {phase === 'notfound' && (
          <div data-verify-notfound className={`${card} space-y-3 py-8 text-center`}>
            <Search size={32} className="mx-auto text-gray-300" aria-hidden="true" />
            <p className="text-base font-bold text-gray-800">ไม่พบเอกสารนี้ในระบบ</p>
            <p className="text-sm text-gray-500">ลิงก์หรือ QR อาจไม่ครบ หรือเอกสารนี้ไม่ได้ลงนามออนไลน์ผ่านระบบนี้ — อย่าถือว่าใบที่ถืออยู่ลงนามออนไลน์แล้ว ให้ตรวจกับหน่วยงานที่ออกเอกสาร</p>
          </div>
        )}

        {(phase === 'error' || phase === 'busy') && (
          <div data-verify-error className={`${card} space-y-3 py-8 text-center`}>
            <AlertTriangle size={32} className="mx-auto text-amber-400" aria-hidden="true" />
            <p className="text-sm text-gray-700">{phase === 'busy' ? VERIFY_BUSY_MESSAGE : 'ตรวจสอบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'}</p>
            <button type="button" onClick={load} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
              <RefreshCw size={16} aria-hidden="true" /> ลองใหม่
            </button>
          </div>
        )}

        {phase === 'ready' && data && summary && (
          <>
            <section data-verify-state={data.state} className={`rounded-2xl border p-4 ${tone.box}`} aria-labelledby="verify-state-title">
              <div className="flex items-start gap-3">
                <tone.Icon size={26} className={`mt-0.5 shrink-0 ${tone.icon}`} aria-hidden="true" />
                <div className="min-w-0 space-y-1">
                  <h2 id="verify-state-title" className="text-base font-bold leading-snug">{summary.title}</h2>
                  <p className="text-sm leading-6">{summary.detail}</p>
                  {summary.closedNote && <p data-verify-closed className="text-sm font-bold leading-6">{summary.closedNote}</p>}
                </div>
              </div>
            </section>

            <section className={`${card} space-y-1`} aria-label="เอกสาร">
              <p className="text-sm font-bold text-gray-800">{data.doc_label}</p>
              {data.document_date && <p className="text-xs text-gray-500">ลงวันที่ {thaiDateFromDateInput(data.document_date)}</p>}
            </section>

            <section className={`${card} space-y-3`} aria-labelledby="verify-slots-title">
              <h2 id="verify-slots-title" className="text-sm font-bold text-gray-800">ผู้ลงนามออนไลน์</h2>
              <ul className="space-y-2">
                {rows.map(row => (
                  <li key={row.key} data-verify-slot={row.key} data-verify-slot-signed={row.signed ? 'yes' : 'no'}
                    className="flex items-start gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
                    {row.signed
                      ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                      : <Clock size={18} className="mt-0.5 shrink-0 text-gray-300" aria-hidden="true" />}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-xs font-bold text-gray-600">{row.label}</p>
                      {row.signed ? (
                        <>
                          <p className="break-words text-sm font-semibold text-gray-900">{row.signerName}</p>
                          {row.position && <p className="break-words text-xs text-gray-600">{row.position}</p>}
                          <p className="text-xs text-gray-500">{row.decisionLabel}เมื่อ {thaiDateTimeText(row.signedAt)}</p>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500">ยังไม่ลงนามออนไลน์</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {data.revoked_count > 0 && (
                <p data-verify-revoked className="text-xs leading-5 text-gray-500">มีการถอนลายเซ็นมาแล้ว {data.revoked_count} ครั้ง (ลายเซ็นเดิมยังเก็บไว้เป็นหลักฐาน) — ที่แสดงข้างบนคือลายเซ็นที่ยังใช้อยู่</p>
              )}
            </section>

            <p data-verify-note className="px-1 text-xs leading-5 text-gray-500">{VERIFY_NOTE}</p>
          </>
        )}
      </main>
    </div>
  )
}
