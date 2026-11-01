import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Loader2, LogIn, Trash2, UserX } from 'lucide-react'
import { supabase, signOutSafely } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import { appUrl } from '../lib/basename'
import {
  ACCOUNT_DELETE_CONFIRM_WORD, ACCOUNT_DELETION_KEPT, ACCOUNT_DELETION_REMOVED, ACCOUNT_DELETION_STAFF_NOTE,
  accountDeletionErrorText, canSelfDeleteRole, deleteMyAccount, isDeleteConfirmed,
} from '../lib/accountDeletion'

// หน้าลบบัญชีด้วยตนเอง — ใช้ทั้งเป็นทางลบในแอป (ลิงก์จากหน้าโปรไฟล์) และเป็น "ลิงก์เว็บ" ที่ Google Play
// บังคับให้กรอกใน Play Console (ต้องเปิดได้โดยไม่ต้องติดตั้งแอป) จึงเปิดได้โดยไม่ต้องล็อกอิน
// ยืนยันในหน้านี้เอง ไม่ใช่ในหน้าโปรไฟล์ เพราะทางพากลับหลังล็อกอิน (authReturnPath) ตัด query ทิ้ง
// ส่งต่อได้แค่ pathname — ผู้ใช้ที่ล็อกอินจากหน้านี้จะกลับมาถึงจุดยืนยันได้เสมอ
const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-4'

function ItemList({ items, tone }) {
  return (
    <ul className="space-y-2">
      {items.map(text => (
        <li key={text} className="flex items-start gap-2 text-sm leading-6 text-gray-700">
          <span aria-hidden="true" className={`mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'removed' ? 'bg-red-400' : 'bg-emerald-500'}`} />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  )
}

function DeletionScope() {
  return (
    <>
      <section className={`${card} space-y-3`} aria-labelledby="account-delete-removed">
        <h2 id="account-delete-removed" className="text-sm font-bold text-gray-800">สิ่งที่ถูกลบทันที</h2>
        <ItemList items={ACCOUNT_DELETION_REMOVED} tone="removed" />
      </section>
      <section className={`${card} space-y-3`} aria-labelledby="account-delete-kept">
        <h2 id="account-delete-kept" className="text-sm font-bold text-gray-800">สิ่งที่หน่วยงานยังเก็บไว้</h2>
        <ItemList items={ACCOUNT_DELETION_KEPT} tone="kept" />
        <Link to="/privacy#retention" data-account-delete-privacy-link className="inline-flex min-h-11 items-center text-sm font-semibold underline" style={{ color: 'var(--color-primary)' }}>
          ดูระยะเวลาเก็บรักษาในนโยบายความเป็นส่วนตัว
        </Link>
      </section>
    </>
  )
}

export default function AccountDeletePage() {
  const navigate = useNavigate()
  const { search } = useLocation()
  const done = new URLSearchParams(search).get('done') === '1'
  const { session, role, profileLoading } = useAuth()
  const { tenant } = useTenant()
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const confirmed = isDeleteConfirmed(confirmText)

  async function handleDelete() {
    if (!confirmed || busy || !session) return
    setBusy(true)
    setError('')
    try {
      await deleteMyAccount(supabase, session.user.id)
    } catch (err) {
      console.error('[account-delete] ลบบัญชีไม่สำเร็จ:', err?.step, err?.message ?? err)
      setError(accountDeletionErrorText(err))
      setBusy(false)
      return
    }
    // บัญชีหายจากฐานแล้ว — ล้าง session ในเครื่อง แล้วโหลดใหม่ทั้งหน้า เพราะ state ในหน่วยความจำของแอป
    // (บริบทผู้ใช้ กระดิ่ง realtime) ยังผูกบัญชีเดิมอยู่
    const doneUrl = appUrl('/account/delete?done=1')
    const result = await signOutSafely(doneUrl)
    if (!result?.forced) window.location.replace(doneUrl)
  }

  const loading = !done && (session === undefined || (session && profileLoading))

  return (
    <div className="min-h-screen pb-12" style={{ backgroundColor: '#eef2f7' }}>
      <header style={{ background: 'linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%)' }}>
        <div className="mx-auto max-w-lg px-4 py-5 text-white">
          <p className="text-xs text-white/75">{tenant?.name || 'หน่วยงาน'}</p>
          <h1 className="text-lg font-bold leading-tight">ลบบัญชีผู้ใช้</h1>
        </div>
      </header>

      <main data-account-delete-page className="mx-auto max-w-lg space-y-3 px-4 py-4">
        {loading && (
          <div className={`${card} flex items-center justify-center gap-2 py-10 text-sm text-gray-500`} role="status">
            <Loader2 size={18} className="animate-spin" aria-hidden="true" /> กำลังโหลด...
          </div>
        )}

        {done && (
          <>
            <section data-account-delete-state="done" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900" role="status">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={26} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <div className="min-w-0 space-y-1">
                  <h2 className="text-base font-bold leading-snug">ลบบัญชีของคุณเรียบร้อยแล้ว</h2>
                  <p className="text-sm leading-6">ออกจากระบบแล้ว และเข้าสู่ระบบด้วยบัญชีเดิมไม่ได้อีก หากต้องการใช้บริการอีกครั้ง สมัครบัญชีใหม่ได้ทุกเมื่อ</p>
                </div>
              </div>
            </section>
            <section className={`${card} space-y-3`} aria-labelledby="account-delete-kept-done">
              <h2 id="account-delete-kept-done" className="text-sm font-bold text-gray-800">สิ่งที่หน่วยงานยังเก็บไว้</h2>
              <ItemList items={ACCOUNT_DELETION_KEPT} tone="kept" />
            </section>
            <button type="button" onClick={() => navigate('/', { replace: true })}
              className="flex min-h-[48px] w-full items-center justify-center rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              กลับหน้าแรก
            </button>
          </>
        )}

        {!done && !loading && !session && (
          <>
            <section data-account-delete-state="signed-out" className={`${card} space-y-3`}>
              <p className="text-sm leading-6 text-gray-700">ลบบัญชีได้ด้วยตัวเองทันที ไม่ต้องติดต่อเจ้าหน้าที่ และไม่ต้องรอการอนุมัติ</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-gray-700">
                <li>เข้าสู่ระบบด้วยบัญชีที่ต้องการลบ</li>
                <li>ระบบจะพากลับมาที่หน้านี้</li>
                <li>พิมพ์คำว่า “{ACCOUNT_DELETE_CONFIRM_WORD}” แล้วกดยืนยัน</li>
              </ol>
              <button type="button" onClick={() => navigate('/auth', { state: { from: '/account/delete' } })}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}>
                <LogIn size={16} aria-hidden="true" /> เข้าสู่ระบบเพื่อลบบัญชี
              </button>
            </section>
            <DeletionScope />
            <p className="px-1 text-xs leading-5 text-gray-500">
              เข้าสู่ระบบไม่ได้ หรือต้องการให้หน่วยงานช่วยลบให้ ติดต่อ{tenant?.name || 'หน่วยงาน'}
              {tenant?.phone ? <> โทร <a href={`tel:${tenant.phone}`} className="font-semibold text-gray-700 underline">{tenant.phone}</a></> : null}
            </p>
          </>
        )}

        {!done && !loading && session && !canSelfDeleteRole(role) && (
          <section data-account-delete-state="staff" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <div className="flex items-start gap-3">
              <UserX size={24} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
              <p className="text-sm leading-6">{ACCOUNT_DELETION_STAFF_NOTE}</p>
            </div>
          </section>
        )}

        {!done && !loading && session && canSelfDeleteRole(role) && (
          <>
            <section data-account-delete-state="confirm" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
              <div className="flex items-start gap-3">
                <AlertTriangle size={24} className="mt-0.5 shrink-0 text-red-500" aria-hidden="true" />
                <p className="text-sm leading-6">ลบแล้วกู้คืนไม่ได้ บัญชีที่เข้าสู่ระบบอยู่ตอนนี้{session.user.email ? ` (${session.user.email})` : ''} จะถูกลบทันทีเมื่อกดยืนยัน</p>
              </div>
            </section>
            <DeletionScope />
            <section className={`${card} space-y-3`}>
              <label htmlFor="account-delete-confirm" className="block text-sm font-bold text-gray-800">
                พิมพ์คำว่า “{ACCOUNT_DELETE_CONFIRM_WORD}” เพื่อยืนยัน
              </label>
              <input id="account-delete-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off" disabled={busy} placeholder={ACCOUNT_DELETE_CONFIRM_WORD}
                className="min-h-[48px] w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-base text-gray-800 outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100" />
              {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-sm text-red-600">{error}</p>}
              <button type="button" onClick={handleDelete} disabled={!confirmed || busy} data-account-delete-submit
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-bold text-white transition-opacity disabled:opacity-40">
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                {busy ? 'กำลังลบบัญชี...' : 'ลบบัญชีถาวร'}
              </button>
              <Link to="/profile" className="flex min-h-[44px] items-center justify-center text-sm font-semibold text-gray-600 hover:underline">
                ยกเลิก กลับไปหน้าบัญชีของฉัน
              </Link>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
