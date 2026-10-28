import { Link } from 'react-router-dom'
import { Bell, Inbox, Loader2, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import { useNotifications } from '../contexts/NotificationsContext'
import { usePushNotification } from '../hooks/usePushNotification'
import AccountPageLayout from '../components/profile/AccountPageLayout'

export default function AccountNotificationSettingsPage() {
  const { session } = useAuth()
  const { tenant } = useTenant()
  const { unreadCount, audience } = useNotifications()
  const push = usePushNotification({ userId: session?.user?.id, municipalityId: tenant?.id })
  const status = push.checking ? 'กำลังตรวจสอบ…' : !push.configured ? 'ระบบยังไม่เปิดการแจ้งเตือนนอกเว็บ'
    : !push.deviceSupported ? 'เบราว์เซอร์นี้ยังไม่รองรับ'
      : push.error ? 'ต้องตรวจสอบสถานะอีกครั้ง'
        : push.permission === 'denied' ? 'ถูกบล็อกโดยเบราว์เซอร์'
          : push.subscribed ? 'เปิดรับบนเครื่องนี้แล้ว' : 'ยังไม่ได้เปิดรับบนเครื่องนี้'
  return (
    <AccountPageLayout active="notifications" title="การแจ้งเตือนของฉัน" busy={push.loading}>
      <div className="space-y-4" data-notification-settings>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="account-inbox-title">
          <h2 id="account-inbox-title" className="flex items-center gap-2 text-sm font-bold text-slate-800"><Inbox size={19} aria-hidden="true" />การแจ้งเตือนในระบบ</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{audience === 'staff' ? 'งานที่เกี่ยวข้องแสดงในกล่องงานตามสิทธิ์ของคุณโดยอัตโนมัติ' : 'ดูความคืบหน้าคำร้องของคุณได้ในรายการแจ้งเตือน'} การเปิดหน้าตั้งค่านี้ไม่เปลี่ยนรายการเป็นอ่านแล้ว</p>
          <Link to="/notifications" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">{audience === 'staff' ? 'เปิดกล่องงาน' : 'ดูรายการแจ้งเตือน'}{unreadCount > 0 && <span className="rounded-full bg-white/20 px-2 text-xs">{unreadCount} ยังไม่อ่าน</span>}</Link>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="account-push-title">
          <h2 id="account-push-title" className="flex items-center gap-2 text-sm font-bold text-slate-800"><Bell size={19} aria-hidden="true" />แจ้งเตือนบนอุปกรณ์นี้</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">รับการแจ้งเตือนจากระบบผ่านเบราว์เซอร์ แม้ไม่ได้เปิดหน้ารายการอยู่ การตั้งค่านี้ใช้กับบัญชีและเบราว์เซอร์บนเครื่องนี้</p>
          {push.supported && <p className="mt-2 text-xs leading-6 text-slate-500">ควรเปิดรับบนอุปกรณ์ส่วนตัว เพราะข้อความอาจปรากฏแม้ปิดหน้าเว็บหรือออกจากระบบแล้ว</p>}
          <p role="status" className="mt-3 rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700" data-push-status>{status}</p>
          {push.error && <p role="alert" className="mt-3 text-sm leading-6 text-red-700">{push.error}</p>}
          {!push.configured ? <p className="mt-3 text-xs leading-6 text-slate-500">ยังดูรายการแจ้งเตือนและกล่องงานในระบบได้ตามปกติ เมื่อระบบพร้อมจึงจะเปิดรับนอกเว็บได้</p>
            : !push.deviceSupported ? <p className="mt-3 text-xs leading-6 text-slate-500">ใช้เบราว์เซอร์ที่รองรับการแจ้งเตือน บน iPhone/iPad อาจต้องเพิ่มเว็บไว้ที่หน้าจอโฮมก่อน แล้วเปิดจากไอคอนนั้น</p>
              : <div className="mt-4 flex flex-wrap gap-2">
                {push.permission !== 'denied' && <button type="button" disabled={push.checking || push.loading || Boolean(push.error)} onClick={push.subscribed ? push.unsubscribe : push.requestAndSubscribe}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50">{push.loading && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}{push.subscribed ? 'ปิดรับบนเครื่องนี้' : 'เปิดรับบนเครื่องนี้'}</button>}
                <button type="button" disabled={push.loading || push.checking} onClick={push.refresh} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50"><RefreshCw size={15} aria-hidden="true" />ตรวจสอบอีกครั้ง</button>
              </div>}
          {push.permission === 'denied' && push.configured && <p className="mt-3 text-xs leading-6 text-slate-500">เปิดสิทธิ์การแจ้งเตือนของเว็บไซต์ในการตั้งค่าเบราว์เซอร์ แล้วกลับมากด “ตรวจสอบอีกครั้ง”</p>}
          {push.supported && <p className="mt-3 text-xs leading-6 text-slate-500">การส่งถึงเครื่องขึ้นกับเครือข่ายและการตั้งค่าของอุปกรณ์ การปิดรับที่นี่ไม่เปลี่ยนสิทธิ์ที่เคยอนุญาตในเบราว์เซอร์</p>}
        </section>
      </div>
    </AccountPageLayout>
  )
}
