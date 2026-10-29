import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, ChevronDown, Inbox, Loader2, RefreshCw, Send, Smartphone, Volume2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import { useNotifications } from '../contexts/NotificationsContext'
import { usePushNotification } from '../hooks/usePushNotification'
import { useNotificationDevicePrefs } from '../hooks/useNotificationDevicePrefs'
import { appBadgeSupported, deviceCanVibrate } from '../lib/notificationPrefs'
import { playNotificationSound } from '../lib/notificationSound'
import { listMyPushDevices, removePushDevice, selfTestResultText, sendSelfTest } from '../lib/pushDevices'
import AccountPageLayout from '../components/profile/AccountPageLayout'

// ส่งผ่านเส้นทางจริง (server → บริการ push ของเบราว์เซอร์ → เครื่อง) ไม่ใช่แค่โชว์ในหน้า — พิสูจน์ได้ว่าปิดเว็บแล้วยังได้รับ
function SelfTestButton({ endpoint }) {
  const [state, setState] = useState({ busy: false, note: '' })
  const run = async () => {
    setState({ busy: true, note: '' })
    const result = await sendSelfTest(endpoint).catch(() => ({ ok: false, status: 0 }))
    setState({ busy: false, note: selfTestResultText(result) })
  }
  return (
    <>
      <button type="button" disabled={state.busy} onClick={run} data-push-self-test
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50">
        {state.busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}ส่งทดสอบถึงเครื่องนี้
      </button>
      {state.note && <p role="status" className="basis-full text-xs leading-6 text-slate-600" data-push-self-test-result>{state.note}</p>}
    </>
  )
}

const formatThaiDate = (value) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

// เครื่องที่บัญชีนี้เปิดรับไว้ทั้งหมด — โหลดเมื่อกดดูเท่านั้น (ไม่เพิ่มการอ่านฐานข้อมูลตอนเปิดหน้า)
// ใช้นำเครื่องเก่า/เครื่องที่ไม่ได้ใช้แล้วออก เพราะแจ้งเตือนขึ้นจอได้แม้ออกจากระบบแล้ว
function PushDeviceList({ userId, currentEndpoint, onChanged }) {
  const [state, setState] = useState({ open: false, loading: false, error: '', devices: [] })
  const load = async () => {
    setState((s) => ({ ...s, open: true, loading: true, error: '' }))
    try {
      const devices = await listMyPushDevices(userId)
      setState((s) => ({ ...s, loading: false, devices }))
    } catch {
      setState((s) => ({ ...s, loading: false, error: 'โหลดรายการเครื่องไม่สำเร็จ กรุณาลองใหม่' }))
    }
  }
  const remove = async (device) => {
    const current = device.endpoint === currentEndpoint
    const name = device.device_label || 'อุปกรณ์ไม่ทราบชื่อ'
    if (!window.confirm(current
      ? 'นำเครื่องนี้ออก? เครื่องนี้จะไม่ได้รับแจ้งเตือนจนกว่าจะกดเปิดรับใหม่'
      : `นำ "${name}" ออก? เครื่องนั้นจะไม่ได้รับแจ้งเตือนจากบัญชีนี้อีก`)) return
    try {
      await removePushDevice(userId, device.id)
      if (current) onChanged()
      await load()
    } catch {
      setState((s) => ({ ...s, error: 'นำเครื่องออกไม่สำเร็จ กรุณาลองใหม่' }))
    }
  }
  return (
    <div className="mt-4 border-t border-slate-100 pt-3" data-push-devices>
      <button type="button" aria-expanded={state.open} onClick={() => (state.open ? setState((s) => ({ ...s, open: false })) : load())}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl text-left text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
        <span className="flex items-center gap-2"><Smartphone size={16} aria-hidden="true" />เครื่องที่เปิดรับไว้{state.open && !state.loading && !state.error ? ` (${state.devices.length})` : ''}</span>
        <ChevronDown size={16} aria-hidden="true" className={`transition-transform ${state.open ? 'rotate-180' : ''}`} />
      </button>
      {state.open && (
        <div className="mt-1">
          {state.loading && <p className="py-2 text-xs text-slate-500">กำลังโหลด…</p>}
          {state.error && <p role="alert" className="py-2 text-xs text-red-700">{state.error}</p>}
          {!state.loading && !state.error && state.devices.length === 0 && <p className="py-2 text-xs leading-6 text-slate-500">ยังไม่มีเครื่องที่เปิดรับไว้</p>}
          <ul className="divide-y divide-slate-100">
            {state.devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-push-device>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">
                    {device.device_label || 'อุปกรณ์ไม่ทราบชื่อ'}
                    {device.endpoint === currentEndpoint && <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800" data-push-device-current>เครื่องนี้</span>}
                  </span>
                  <span className="block text-xs text-slate-500">เปิดรับเมื่อ {formatThaiDate(device.created_at)}</span>
                </span>
                <button type="button" onClick={() => remove(device)} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-red-700 hover:bg-red-50">นำออก</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SwitchRow({ id, label, hint, checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(id, !checked)} data-device-pref={id}
      className="flex min-h-11 w-full items-center gap-3 border-t border-slate-100 py-3 text-left first:border-t-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        <span className="block text-xs leading-5 text-slate-500">{hint}</span>
      </span>
      <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-teal-700' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

// ป๊อปอัป/เสียง/สั่น ตอนมีรายการใหม่เข้ากระดิ่งระหว่างเปิดระบบอยู่ — ตั้งรายเครื่อง เก็บในเครื่อง ไม่ขึ้นเซิร์ฟเวอร์
function DeviceAlertSettings({ uid, previewAlert }) {
  const [prefs, update] = useNotificationDevicePrefs(uid)
  const [note, setNote] = useState('')
  // ความสามารถของเครื่องไม่เปลี่ยนระหว่างเปิดหน้า — อ่านครั้งเดียว
  const [device] = useState(() => ({
    vibrate: deviceCanVibrate(),
    touch: typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches),
    badge: appBadgeSupported(),
  }))
  const testSound = () => setNote(playNotificationSound()
    ? 'เล่นเสียงตัวอย่างแล้ว ถ้าไม่ได้ยิน ให้ตรวจระดับเสียงของเครื่องและเบราว์เซอร์'
    : 'เบราว์เซอร์นี้เล่นเสียงแจ้งเตือนไม่ได้')
  const change = (id, value) => {
    const { saved } = update({ [id]: value })
    if (!saved) {
      // บันทึกไม่ได้ สวิตช์จึงไม่ขยับ (อ่านค่าจริงจากเครื่อง ไม่หลอกว่าเปิดแล้ว)
      setNote('บันทึกไม่สำเร็จ เบราว์เซอร์อาจปิดการเก็บข้อมูลไว้ (เช่น โหมดไม่ระบุตัวตน)')
    } else if (id === 'sound' && value) {
      // เปิดเสียงแล้วเล่นให้ฟังทันที — การกดสวิตช์ยังปลดล็อกเสียงของเบราว์เซอร์ด้วย
      testSound()
    } else {
      setNote('บันทึกแล้ว ใช้เฉพาะบัญชีนี้บนเครื่องนี้')
    }
  }
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="account-device-alerts-title" data-device-alert-settings>
      <h2 id="account-device-alerts-title" className="flex items-center gap-2 text-sm font-bold text-slate-800"><Volume2 size={19} aria-hidden="true" />ป๊อปอัปและเสียง ขณะเปิดระบบอยู่</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">เมื่อมีรายการใหม่เข้ากระดิ่งระหว่างที่เปิดระบบอยู่ ตั้งแยกได้ทีละเครื่อง เช่น คอมที่ทำงานเปิดเสียง มือถือปิดเสียง เปลี่ยนแล้วมีผลทันที</p>
      <div className="mt-2">
        <SwitchRow id="popup" label="ป๊อปอัปบนหน้าจอ" hint="กล่องข้อความพร้อมปุ่มเปิดดู ครั้งละไม่เกิน 2 รายการ ปิดเองใน 8 วินาที" checked={prefs.popup} onChange={change} />
        <SwitchRow id="sound" label="เสียงแจ้งเตือน" hint="เสียงสั้นเบาๆ เบราว์เซอร์จะเล่นได้หลังแตะหน้าเว็บอย่างน้อยหนึ่งครั้ง" checked={prefs.sound} onChange={change} />
        {device.vibrate && <SwitchRow id="vibrate" label="สั่นบนมือถือ" hint="สั่นสั้นๆ เมื่อมีรายการใหม่" checked={prefs.vibrate} onChange={change} />}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={previewAlert} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50">ทดลองป๊อปอัป</button>
        <button type="button" onClick={testSound} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><Volume2 size={15} aria-hidden="true" />ทดลองฟังเสียง</button>
      </div>
      <p role="status" className="mt-3 min-h-6 text-xs leading-6 text-slate-600" data-device-pref-status>{note}</p>
      {!device.vibrate && device.touch && <p className="text-xs leading-6 text-slate-500">เครื่องนี้ไม่รองรับการสั่นจากเว็บ (เช่น iPhone/iPad)</p>}
      {device.badge && <p className="text-xs leading-6 text-slate-500">จำนวนรายการที่ยังไม่อ่านขึ้นบนไอคอนแอปให้อัตโนมัติ เมื่อเปิดจากแอปที่ติดตั้งไว้</p>}
    </section>
  )
}

export default function AccountNotificationSettingsPage() {
  const { session } = useAuth()
  const { tenant } = useTenant()
  const { unreadCount, audience, previewAlert } = useNotifications()
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
        <DeviceAlertSettings uid={session?.user?.id} previewAlert={previewAlert} />
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
                {push.subscribed && push.endpoint && !push.loading && <SelfTestButton endpoint={push.endpoint} />}
              </div>}
          {push.permission === 'denied' && push.configured && <p className="mt-3 text-xs leading-6 text-slate-500">เปิดสิทธิ์การแจ้งเตือนของเว็บไซต์ในการตั้งค่าเบราว์เซอร์ แล้วกลับมากด “ตรวจสอบอีกครั้ง”</p>}
          {push.supported && <p className="mt-3 text-xs leading-6 text-slate-500">การส่งถึงเครื่องขึ้นกับเครือข่ายและการตั้งค่าของอุปกรณ์ การปิดรับที่นี่ไม่เปลี่ยนสิทธิ์ที่เคยอนุญาตในเบราว์เซอร์</p>}
          {push.configured && session?.user?.id && <PushDeviceList userId={session.user.id} currentEndpoint={push.endpoint} onChanged={push.refresh} />}
        </section>
      </div>
    </AccountPageLayout>
  )
}
