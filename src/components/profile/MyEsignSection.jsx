import { useCallback, useEffect, useState } from 'react'
import { Ban, KeyRound, Loader2, Plus, Star, Trash2 } from 'lucide-react'
import AddSignatureDialog from './AddSignatureDialog'
import { Chip, Notice } from '../esign/EsignBits'
import PinForm from '../esign/PinForm'
import { ESIGN_DECISION_LABEL, esignFailureText, esignMessage } from '../../lib/esign'
import {
  deleteMySignature, getMySignatureHistory, getMySignatures, getMySignerOverview, setDefaultSignature, suspendMyEsign,
} from '../../lib/esignApi'
import { SIGNATURE_CHECKER, SMALL_BUTTON_CLASS as SMALL_BUTTON, signatureDataUrl } from '../../lib/esignUi'
import { SIGNATURE_MAX_IMAGES } from '../../lib/signatureImage'
import { thaiDateTimeText } from '../../lib/thaiDate'

// เนื้อหาหน้า /staff/my-signatures — รวมของส่วนตัวของผู้ลงนามไว้ที่เดียว:
// ภาพลายเซ็น (วาด/อัปโหลด) · รหัสลงนาม 6 หลัก · ระงับการลงนามของฉัน · ประวัติการลงนามของฉัน
// เข้าหน้าแล้วโหลดข้อมูลทันที ไม่ซ่อนการจัดการไว้ในส่วนพับของหน้าโปรไฟล์
// หน้าตรวจสอบสาธารณะ/ใบพิมพ์ไม่เกี่ยวกับหน้านี้ — ที่นี่เห็นภาพของตัวเองเท่านั้น (ฐานข้อมูลคืนเฉพาะของผู้เรียก)

export default function MyEsignSection() {
  const [overview, setOverview] = useState(null)
  const [library, setLibrary] = useState([])
  const [history, setHistory] = useState([])
  // ยังไม่แสดงสถานะ PIN/คลังจนกว่าจะได้ผลอ่านจริง ป้องกันข้อความสถานะว่างแวบก่อนข้อมูลมา
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [showAdd, setShowAdd] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [busy, setBusy] = useState('')
  const [notices, setNotices] = useState({})
  const [suspendAsk, setSuspendAsk] = useState(false)
  const [suspendReason, setSuspendReason] = useState('')
  useEffect(() => {
    let cancelled = false
    Promise.all([getMySignerOverview(), getMySignatures(), getMySignatureHistory(10)]).then(([ov, lib, hist]) => {
      if (cancelled) return
      const failed = [ov, lib, hist].find(result => !result?.ok)
      if (failed) {
        setLoadError(esignMessage(failed))
      } else {
        setLoadError('')
        setOverview(ov)
        setLibrary(lib.items ?? [])
        setHistory(hist.items ?? [])
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [reloadKey])

  const reload = useCallback(() => { setLoading(true); setReloadKey(key => key + 1) }, [])
  const setNotice = (key, notice) => setNotices(current => ({ ...current, [key]: notice }))

  async function runAction(key, action, successText) {
    setBusy(key)
    setNotice(key, null)
    const result = await action()
    setBusy('')
    if (!result?.ok) {
      setNotice(key, { ok: false, text: esignFailureText(result) })
      return null
    }
    setNotice(key, { ok: true, text: typeof successText === 'function' ? successText(result) : successText })
    reload()
    return result
  }

  const pinSet = Boolean(overview?.pin_set)
  const suspended = Boolean(overview?.suspended)
  const atLimit = library.length >= SIGNATURE_MAX_IMAGES

  return (
    <div id="signature" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-my-esign>
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
        <h2 className="text-sm font-bold text-slate-800">จัดการลายเซ็นและรหัสลงนาม</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">ภาพลายเซ็น · รหัสลงนาม · สถานะการใช้งาน · ประวัติของฉัน</p>
      </div>

      {loading && !overview ? (
        <div role="status" aria-label="กำลังโหลดลายเซ็นของฉัน" className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-gray-500"><Loader2 size={18} className="animate-spin" /> กำลังโหลดข้อมูลลายเซ็น</div>
      ) : loadError ? (
        <div className="space-y-3 p-5">
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">⚠️ {loadError}</p>
          <button type="button" onClick={reload} disabled={loading} className={`${SMALL_BUTTON} border-slate-200 text-slate-700`}>{loading ? 'กำลังโหลด…' : 'ลองใหม่'}</button>
        </div>
      ) : (
        <div className="space-y-6 px-4 py-5 sm:px-5">
          {/* สถานะ */}
          <div className="flex flex-wrap gap-2" data-esign-status>
            {suspended ? <Chip tone="bad">ระงับการลงนามอยู่</Chip>
              : overview?.locked_until ? <Chip tone="warn">รหัสถูกล็อกถึง {thaiDateTimeText(overview.locked_until)}</Chip>
                : <Chip tone={pinSet ? 'ok' : 'warn'}>{pinSet ? 'ตั้งรหัสลงนามแล้ว' : 'ยังไม่ได้ตั้งรหัสลงนาม'}</Chip>}
            <Chip tone="mute">ลายเซ็นภาพ {library.length}/{SIGNATURE_MAX_IMAGES} แบบ</Chip>
            <Chip tone="mute">ลงนามแล้ว {overview?.signature_count ?? 0} ครั้ง (เดือนนี้ {overview?.signature_count_month ?? 0})</Chip>
          </div>

          {/* คลังลายเซ็น */}
          <section className="space-y-3" aria-labelledby="my-signatures-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 id="my-signatures-title" className="text-sm font-bold text-gray-800">ลายเซ็นที่บันทึกไว้</h3>
                <p className="text-xs leading-5 text-gray-500">ตอนลงนามระบบแนบภาพค่าเริ่มต้นให้เอง (ปิดหรือเลือกแบบอื่นได้ทุกครั้ง) ภาพนี้เห็นเฉพาะคุณ และผู้ที่เปิดดูใบขอใช้รถใบที่คุณลงนาม</p>
              </div>
              <button type="button" onClick={() => setShowAdd(true)} disabled={atLimit} data-add-signature
                className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold text-white disabled:opacity-50 sm:w-auto"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                <Plus size={16} /> เพิ่มลายเซ็น
              </button>
            </div>
            {atLimit && <p className="text-xs text-amber-700">มีครบ {SIGNATURE_MAX_IMAGES} แบบแล้ว ลบแบบเก่าก่อนจึงเพิ่มใหม่ได้</p>}
            <Notice notice={notices.library} />
            {library.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-xs leading-5 text-gray-500" data-signature-empty>
                ยังไม่มีลายเซ็นภาพ — ไม่บังคับ ลงนามด้วยรหัสอย่างเดียวได้ แต่ใบพิมพ์จะแสดงเฉพาะชื่อ ตำแหน่ง เวลา และรหัสตรวจสอบ ไม่มีภาพลายเซ็น
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {library.map(item => (
                  <li key={item.id} data-signature-card className={`space-y-2 rounded-xl border p-3 ${item.is_default ? 'border-emerald-400 bg-emerald-50/40' : 'border-gray-200'}`}>
                    <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg border border-gray-100 bg-white p-2" style={SIGNATURE_CHECKER}>
                      <img src={signatureDataUrl(item.png_base64)} alt={`ลายเซ็น ${item.label}`} className="max-h-full max-w-full object-contain" />
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">{item.label}</p>
                      {item.is_default && <Chip tone="ok">ค่าเริ่มต้น</Chip>}
                    </div>
                    {confirmDeleteId === item.id ? (
                      <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
                        <p className="text-xs leading-5 text-red-800">
                          ลบแบบนี้ออกจากคลังของคุณ ใบที่เคยลงนามด้วยภาพนี้ไปแล้วจะยังแสดงภาพเดิม (เก็บไว้เป็นหลักฐาน แก้หรือลบไม่ได้)
                        </p>
                        <div className="flex gap-2">
                          <button type="button" disabled={busy === 'library'} data-confirm-delete
                            onClick={async () => {
                              const done = await runAction('library', () => deleteMySignature(item.id),
                                result => (result.kept_as_evidence
                                  ? 'ลบออกจากคลังแล้ว — ใบที่เคยลงนามด้วยภาพนี้ยังแสดงภาพเดิม (เก็บไว้เป็นหลักฐาน)'
                                  : 'ลบลายเซ็นแล้ว'))
                              if (done) setConfirmDeleteId(null)
                            }}
                            className={`${SMALL_BUTTON} border-red-300 bg-red-600 text-white`}>
                            {busy === 'library' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} ยืนยันลบ
                          </button>
                          <button type="button" onClick={() => setConfirmDeleteId(null)} className={`${SMALL_BUTTON} border-gray-200 bg-white text-gray-600`}>ยกเลิก</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {!item.is_default && (
                          <button type="button" disabled={busy === 'library'} onClick={() => runAction('library', () => setDefaultSignature(item.id), 'ตั้งเป็นค่าเริ่มต้นแล้ว')}
                            className={`${SMALL_BUTTON} min-w-[9rem] flex-1 whitespace-nowrap border-gray-200 text-gray-700 hover:bg-gray-50`}>
                            <Star size={13} /> ตั้งเป็นค่าเริ่มต้น
                          </button>
                        )}
                        <button type="button" onClick={() => setConfirmDeleteId(item.id)} aria-label={`ลบลายเซ็น ${item.label}`} data-delete-signature
                          className={`${SMALL_BUTTON} min-w-[5rem] flex-1 whitespace-nowrap border-red-200 text-red-600 hover:bg-red-50`}>
                          <Trash2 size={13} /> ลบ
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* รหัสลงนาม */}
          <section className="space-y-3 border-t border-gray-100 pt-5" aria-labelledby="my-pin-title">
            <div className="flex items-center gap-2">
              <KeyRound size={16} className="text-gray-500" />
              <h3 id="my-pin-title" className="text-sm font-bold text-gray-800">{pinSet ? 'เปลี่ยนรหัสลงนาม' : 'ตั้งรหัสลงนาม'}</h3>
            </div>
            <PinForm pinSet={pinSet} onDone={reload} />
          </section>

          {/* ระงับ */}
          <section className="space-y-3 border-t border-gray-100 pt-5" aria-labelledby="my-suspend-title">
            <div className="flex items-center gap-2">
              <Ban size={16} className="text-gray-500" />
              <h3 id="my-suspend-title" className="text-sm font-bold text-gray-800">ระงับการลงนามของฉัน</h3>
            </div>
            {suspended ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-800" data-suspended-note>
                การลงนามของคุณถูกระงับอยู่ — ลงนามไม่ได้จนกว่าผู้ดูแลระบบของหน่วยงานจะเปิดคืนให้ (เมนู ผู้ดูแล → ลงนามออนไลน์) การตั้งรหัสใหม่ไม่ปลดระงับ
              </p>
            ) : (
              <>
                <p className="text-xs leading-5 text-gray-500">
                  ใช้เมื่อสงสัยว่ารหัสลงนามรั่ว หรือมือถือ/เครื่องหาย — ลงนามไม่ได้ทันที ลายเซ็นที่ลงไปแล้วไม่เปลี่ยน ผู้ดูแลระบบของหน่วยงานเป็นคนเปิดคืนให้
                </p>
                {suspendAsk ? (
                  <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
                    <label className="block text-xs font-semibold text-red-900" htmlFor="esign-suspend-reason">เหตุผล (ไม่บังคับ)
                      <input id="esign-suspend-reason" value={suspendReason} maxLength={500} onChange={event => setSuspendReason(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm text-gray-800 outline-none" placeholder="เช่น โทรศัพท์หาย" />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy === 'suspend'} data-confirm-suspend
                        onClick={async () => {
                          const done = await runAction('suspend', () => suspendMyEsign(suspendReason), 'ระงับการลงนามของคุณแล้ว — แจ้งผู้ดูแลระบบให้เปิดคืนเมื่อพร้อม')
                          if (done) { setSuspendAsk(false); setSuspendReason('') }
                        }}
                        className={`${SMALL_BUTTON} border-red-300 bg-red-600 text-white`}>
                        {busy === 'suspend' && <Loader2 size={13} className="animate-spin" />} ยืนยันระงับ
                      </button>
                      <button type="button" onClick={() => setSuspendAsk(false)} className={`${SMALL_BUTTON} border-gray-200 bg-white text-gray-600`}>ยกเลิก</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setSuspendAsk(true)} data-suspend-me className={`${SMALL_BUTTON} border-red-200 text-red-600 hover:bg-red-50`}>
                    <Ban size={13} /> ระงับการลงนามของฉัน
                  </button>
                )}
              </>
            )}
            <Notice notice={notices.suspend} />
          </section>

          {/* ประวัติ */}
          <section className="space-y-3 border-t border-gray-100 pt-5" aria-labelledby="my-history-title">
            <h3 id="my-history-title" className="text-sm font-bold text-gray-800">ประวัติการลงนามของฉัน <span className="font-normal text-gray-400">(10 รายการล่าสุด)</span></h3>
            {history.length === 0 ? (
              <p className="text-xs text-gray-400" data-history-empty>ยังไม่เคยลงนามในระบบ</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100" data-history-list>
                {history.map(item => (
                  <li key={item.signature_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-xs">
                    <span className="font-semibold text-gray-800">{ESIGN_DECISION_LABEL[item.decision] ?? 'ลงนาม'}: {item.slot_label}</span>
                    <span className="text-gray-400">{thaiDateTimeText(item.signed_at)}</span>
                    {item.with_image && <Chip tone="mute">แนบภาพ</Chip>}
                    {item.revoked && <Chip tone="warn">ถอนแล้ว</Chip>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] leading-5 text-gray-400">ประวัติไม่แสดงปลายทางหรือรายละเอียดของคำขอ — ดูรายละเอียดได้ที่หน้ายานพาหนะตามสิทธิ์ของคุณ</p>
          </section>

          {/* คำถามที่พบบ่อย — ตอบสิ่งที่ผู้ใช้มักถามก่อนใช้ */}
          <section className="space-y-2 border-t border-gray-100 pt-5" aria-label="คำถามที่พบบ่อย">
            <h3 className="text-sm font-bold text-gray-800">คำถามที่พบบ่อย</h3>
            {[
              ['ภาพลายเซ็นมีผลทางกฎหมายไหม?', 'ภาพใช้แสดงบนใบพิมพ์ให้ดูเหมือนลายเซ็นเดิมเท่านั้น หลักฐานการลงนามจริงคือบันทึกในระบบ: ชื่อ ตำแหน่ง เวลาจากเซิร์ฟเวอร์ รหัสลงนามของคุณ และค่าตรวจสอบเนื้อหาคำขอ ใบพิมพ์จึงมีรหัสตรวจสอบให้สแกนยืนยันกับระบบ'],
              ['ใครเห็นภาพลายเซ็นของฉัน?', 'เฉพาะคุณ และผู้ที่เปิดดูใบขอใช้รถใบที่คุณลงนามด้วยภาพ (ผู้ขอ ผู้ลงนามช่องอื่น เจ้าหน้าที่ดูแลรถ) แอดมินดูคลังของคุณไม่ได้ หน้าตรวจสอบสาธารณะไม่แสดงภาพ'],
              ['ระบบเก็บอะไรเกี่ยวกับการลงนามของฉัน?', 'ในบันทึกลงนามมี ชื่อ ตำแหน่ง ฐานะที่ลงนาม เวลา ผลตรวจเนื้อหาคำขอ และภาพ (ถ้าแนบ) — ไม่มีที่อยู่ไอพีและตำแหน่งที่ตั้ง'],
              ['ลบลายเซ็นแล้วใบเก่าจะหายไหม?', 'ไม่หาย ใบที่เคยลงนามด้วยภาพนั้นแล้วยังแสดงภาพเดิม เพราะเป็นหลักฐาน แก้หรือลบไม่ได้ ที่ลบได้คือภาพในคลังที่จะใช้กับใบต่อไป'],
              ['ลืมรหัสลงนามทำอย่างไร?', 'ตั้งรหัสใหม่ต้องใส่รหัสเดิม ถ้าลืมจริงให้ผู้ดูแลระบบของหน่วยงานช่วยตรวจสอบ ห้ามบอกรหัสให้ผู้อื่น และห้ามลงนามแทนกัน'],
            ].map(([question, answer]) => (
              <details key={question} className="rounded-xl border border-gray-200 px-3.5 py-2.5">
                <summary className="cursor-pointer text-xs font-semibold text-gray-700">{question}</summary>
                <p className="mt-2 text-xs leading-5 text-gray-500">{answer}</p>
              </details>
            ))}
          </section>
        </div>
      )}

      {showAdd && (
        <AddSignatureDialog isFirst={library.length === 0} onClose={() => setShowAdd(false)}
          onSaved={async () => { setShowAdd(false); setNotice('library', { ok: true, text: 'บันทึกลายเซ็นแล้ว' }); reload() }} />
      )}
    </div>
  )
}
