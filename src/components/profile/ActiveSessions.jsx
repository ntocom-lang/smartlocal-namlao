import { useEffect, useState } from 'react'
import { supabase, signOutSafely } from '../../lib/supabase'
import { describeDevice, relativeTimeTh } from '../../lib/deviceLabel'
import { Loader2, Monitor, Smartphone, Tablet, HelpCircle, LogOut, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'

// "อุปกรณ์ที่ล็อกอินอยู่" — ให้เจ้าของบัญชีเห็นเองว่า session ค้างอยู่ที่เครื่องไหนบ้าง
// แล้วเตะออกทีละเครื่องได้ แก้ปัญหาลืมกดออกจากระบบบนเครื่องคนอื่นโดยไม่ต้องให้ระบบ
// เดาเองว่าเครื่องไหนคือ PC/แท็บเล็ต (UA เชื่อไม่ได้ 100% — iPad ส่ง UA เป็น Macintosh)
//
// ข้อมูลมาจาก RPC list_my_sessions()/revoke_my_session() ที่กรองด้วย user_id = auth.uid()
// ในฝั่งฐานข้อมูลเสมอ (supabase/migrations/20260901110000_my_active_sessions.sql)

const ICONS = { desktop: Monitor, mobile: Smartphone, tablet: Tablet, unknown: HelpCircle }

export default function ActiveSessions() {
  // พับไว้ก่อน กดแล้วค่อยกาง — หน้าโปรไฟล์เป็นหน้าที่คนเข้าบ่อยเพื่อแก้ชื่อ/ที่อยู่
  // รายการอุปกรณ์เป็นของที่นานๆ ใช้ที ไม่ควรกินพื้นที่และไม่ควรยิง RPC ทุกครั้งที่เปิดหน้า
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  // เพิ่มค่านี้เพื่อสั่งโหลดใหม่ — ดึง fetch ไว้ในตัว effect ทั้งก้อนตามสไตล์ที่ใช้อยู่ในโปรเจกต์
  // (เรียกฟังก์ชันที่ setState จากใน effect โดยตรงจะโดน react-hooks/set-state-in-effect)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    supabase.rpc('list_my_sessions').then(({ data, error: rpcError }) => {
      if (cancelled) return
      if (rpcError) {
        console.error('[sessions] อ่านรายการอุปกรณ์ไม่สำเร็จ:', rpcError.message)
        setError('อ่านรายการอุปกรณ์ไม่สำเร็จ กรุณาลองใหม่')
        setRows([])
      } else {
        setError('')
        setRows(data ?? [])
      }
      setLoading(false)
      setBusyId(null)
    })
    return () => { cancelled = true }
  }, [open, reloadKey])

  async function handleRevoke(row) {
    const device = describeDevice(row.user_agent).label
    const question = row.is_current
      ? `ออกจากระบบเครื่องนี้ (${device}) ใช่ไหม?\n\nจะต้องเข้าสู่ระบบใหม่ทันที`
      : `เตะ ${device} ออกจากระบบใช่ไหม?\n\nเครื่องนั้นจะใช้งานต่อได้อีกไม่เกิน 1 ชั่วโมงก่อนหลุดจริง`
    if (!window.confirm(question)) return

    setBusyId(row.session_id)
    const { error: rpcError } = await supabase.rpc('revoke_my_session', { p_session_id: row.session_id })
    if (rpcError) {
      console.error('[sessions] เตะอุปกรณ์ไม่สำเร็จ:', rpcError.message)
      setError('ทำรายการไม่สำเร็จ กรุณาลองใหม่')
      setBusyId(null)
      return
    }

    // เตะเครื่องตัวเอง = ออกจากระบบ ต้องล้าง token ในเครื่องทันที ไม่ปล่อยให้ค้างรอ
    // access token หมดอายุ (ไม่เกิน 1 ชม.) ไม่งั้นหน้าจอจะดูเหมือนยังล็อกอินอยู่
    // แล้วไปเด้งออกเองตอนต่ออายุ token ซึ่งผู้ใช้จะงงว่าทำไมหลุดตอนนั้น
    if (row.is_current) {
      await signOutSafely('/')
      return
    }

    setReloadKey((k) => k + 1)
  }

  return (
    <div className="bg-white rounded-2xl shadow-xs overflow-hidden">
      <div className={`flex items-center gap-2 px-5 py-4 ${open ? 'border-b border-gray-100' : ''}`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex-1 flex items-center gap-2 text-left"
        >
          {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          <span className="text-sm font-semibold text-gray-700">อุปกรณ์ที่ล็อกอินอยู่</span>
        </button>
        {open && (
          <button
            type="button"
            onClick={() => { setLoading(true); setReloadKey((k) => k + 1) }}
            className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            aria-label="โหลดรายการใหม่"
          >
            <RefreshCw size={15} />
          </button>
        )}
      </div>

      {!open ? null : loading ? (
        <div className="px-5 py-6 flex items-center justify-center text-gray-400">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.length === 0 && (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">ไม่พบอุปกรณ์ที่ล็อกอินอยู่</p>
          )}

          {rows.map((row) => {
            const { label, kind } = describeDevice(row.user_agent)
            const Icon = ICONS[kind] ?? HelpCircle
            return (
              <div key={row.session_id} className="flex items-center gap-3 px-5 py-3.5">
                <Icon size={18} className="shrink-0 text-gray-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">
                    {label}
                    {row.is_current && (
                      <span className="ml-2 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full align-middle">
                        เครื่องนี้
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    ใช้งานล่าสุด {relativeTimeTh(row.last_seen_at)}
                    {row.ip ? ` · ${row.ip}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevoke(row)}
                  disabled={busyId === row.session_id}
                  className={`shrink-0 flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                    row.is_current
                      ? 'text-gray-500 border-gray-200 hover:bg-gray-50'
                      : 'text-red-600 border-red-200 hover:bg-red-50'
                  }`}
                >
                  {busyId === row.session_id ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                  {row.is_current ? 'ออกจากเครื่องนี้' : 'เตะออก'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {open && error && <p className="px-5 pb-4 text-xs text-red-500 font-semibold">{error}</p>}

      {/* สองข้อนี้ต้องเขียนไว้ให้เห็น ไม่ใช่ให้ผู้ใช้ไปเจอเอาเองตอนใช้งานจริง */}
      {open && <p className="px-5 py-3 text-[11px] text-gray-400 leading-relaxed border-t border-gray-100">
        เครื่องที่ถูกเตะออกจะเข้าใช้งานต่อได้อีกไม่เกิน 1 ชั่วโมงก่อนหลุดจริง
        เพราะสิทธิ์ที่เครื่องนั้นถืออยู่ต้องรอหมดอายุตามรอบ<br />
        ถ้าเตะมือถือของตัวเองออก จะอนุมัติการเข้าสู่ระบบด้วยรหัส 6 หลักบนคอมพิวเตอร์ไม่ได้
        จนกว่าจะเข้าสู่ระบบบนมือถือใหม่
      </p>}
    </div>
  )
}
