import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2, CircleAlert, CloudCog, Eye, EyeOff, Globe2, KeyRound,
  Loader2, Mail, RefreshCw, Save, ShieldCheck, Sparkles, Zap,
} from 'lucide-react'
import { useTenant } from '../../contexts/TenantContext'
import { supabase } from '../../lib/supabase'
import { loadGoogleMaps } from '../../lib/googleMaps'

const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100'
const GOOGLE_BROWSER_KEY_PATTERN = /^AIza[0-9A-Za-z_-]{20,}$/

function maskKey(value) {
  if (!value) return 'ยังไม่ได้ตั้งค่า'
  return `••••••••••••••••••••${value.slice(-4)}`
}

export default function GoogleMapsSettings() {
  const { tenant, patchTenant } = useTenant()
  const tenantKey = tenant?.google_maps_api_key?.trim() || ''
  const environmentKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() || ''
  const effectiveKey = tenantKey || environmentKey
  const keySource = tenantKey ? 'Key เฉพาะเทศบาล' : environmentKey ? 'Key ส่วนกลางจาก Environment' : 'ยังไม่มี Key'

  const [editingKey, setEditingKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [engine, setEngine] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('smartlocal_map_engine') : null) || 'leaflet')
  const [email, setEmail] = useState('')
  const [projectId, setProjectId] = useState('')
  const [saving, setSaving] = useState(false)
  // ยังไม่รู้ว่าค่าเดิมในฐานข้อมูลคืออะไร จนกว่า RPC จะตอบกลับสำเร็จ ระหว่างนั้นห้ามส่ง
  // สองฟิลด์นี้ไปกับคำสั่งบันทึกเด็ดขาด — ดูเหตุผลที่ saveSettings
  const [cloudInfoLoaded, setCloudInfoLoaded] = useState(false)

  // google_cloud_email/google_project_id ไม่ได้อยู่ใน TenantContext แล้ว (ตั้งใจไม่ส่งให้ผู้เยี่ยมชมทุกคน
  // ผ่าน public tenant fetch) — หน้าตั้งค่านี้เข้าถึงได้เฉพาะแอดมิน จึงดึง 2 ฟิลด์นี้เองตอนเปิดหน้า
  //
  // เดิม SELECT ตรงจากตาราง แต่ column grant เป็นสิทธิ์ระดับ role ไม่ใช่ระดับแถว ผู้ใช้ที่ล็อกอิน
  // คนไหนก็ได้จึงยิง REST อ่าน 2 ฟิลด์นี้ของ *ทุก* อปท. ได้ ตอนนี้ตัดสิทธิ์ทิ้งแล้วใน
  // 20260830220000 และย้ายมาเรียกผ่าน RPC ที่ตรวจว่าเป็นแอดมินของหน่วยงานนั้นจริง
  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    supabase.rpc('get_google_cloud_settings', { _municipality_id: tenant.id })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.warn('[google-maps] อ่านค่า Google Cloud ไม่สำเร็จ:', error.message)
          return
        }
        // RETURNS TABLE คืนเป็น array เสมอ — ว่างแปลว่าสิทธิ์ไม่ผ่านหรือไม่พบหน่วยงาน
        // ต่างจาก "แถวมีอยู่แต่ค่าเป็น null" ซึ่งถือว่าโหลดสำเร็จและแก้ไขได้
        const row = data?.[0]
        if (!row) return
        setEmail(row.google_cloud_email || '')
        setProjectId(row.google_project_id || '')
        setCloudInfoLoaded(true)
      })
    return () => { cancelled = true }
  }, [tenant?.id])
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const maskedKey = useMemo(() => maskKey(effectiveKey), [effectiveKey])

  async function saveSettings(e) {
    e.preventDefault()
    const replacementKey = newKey.trim()
    if (editingKey && !GOOGLE_BROWSER_KEY_PATTERN.test(replacementKey)) {
      setTestResult({ ok: false, message: 'รูปแบบ Google Maps Browser API Key ไม่ถูกต้อง' })
      return
    }
    if (!tenant?.id) return

    setSaving(true)
    setSaved(false)
    try {
      // ⚠️ ห้ามส่ง google_cloud_email/google_project_id ถ้า RPC ยังโหลดค่าเดิมไม่สำเร็จ
      // ทั้งสอง state เริ่มจาก '' แล้วรอ RPC มาเติมทีหลัง ถ้าโหลดพลาด (เน็ตหลุด สิทธิ์ไม่ผ่าน
      // หรือกดบันทึกก่อนโหลดเสร็จ) แล้วยังส่งไปด้วย `email.trim() || null` จะกลายเป็นการเอา
      // null ไปทับค่าเดิมในฐานข้อมูล = ลบข้อมูลทิ้งโดยที่คนกดตั้งใจจะแก้แค่ API Key
      // เกิดจริงแล้ว 2026-08-28 ระหว่างที่สิทธิ์ใน DB ถูกตัดไปก่อนโค้ดใหม่จะ deploy
      //
      // ระบบราชการต้องย้อนรอยได้ ปุ่มที่ลบข้อมูลโดยคนกดไม่รู้ตัวจึงรับไม่ได้ — โครงการนี้
      // อยู่บน free tier ที่ไม่มี PITR ข้อมูลที่ทับไปแล้วกู้คืนไม่ได้เลย
      const payload = {
        ...(cloudInfoLoaded ? {
          google_cloud_email: email.trim() || null,
          google_project_id: projectId.trim() || null,
        } : {}),
        ...(editingKey ? { google_maps_api_key: replacementKey } : {}),
      }
      if (Object.keys(payload).length === 0) {
        setTestResult({ ok: false, message: 'ยังโหลดข้อมูลทะเบียน Google Cloud ไม่สำเร็จ — รีเฟรชหน้าก่อนบันทึก' })
        return
      }
      const { data, error } = await supabase
        .from('municipalities')
        .update(payload)
        .eq('id', tenant.id)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('ไม่มีสิทธิ์ปรับปรุงข้อมูล (RLS Lock)')

      patchTenant(payload)
      setEditingKey(false)
      setShowKey(false)
      setNewKey('')
      setSaved(true)
      setTestResult(null)
      window.setTimeout(() => setSaved(false), 2500)
    } catch (error) {
      setTestResult({ ok: false, message: `บันทึกไม่สำเร็จ: ${error.message}` })
    } finally {
      setSaving(false)
    }
  }

  async function testSdk() {
    const candidate = editingKey && newKey.trim() ? newKey.trim() : effectiveKey
    if (!candidate) {
      setTestResult({ ok: false, message: 'ยังไม่มี API Key สำหรับทดสอบ' })
      return
    }
    if (!GOOGLE_BROWSER_KEY_PATTERN.test(candidate)) {
      setTestResult({ ok: false, message: 'รูปแบบ Google Maps Browser API Key ไม่ถูกต้อง' })
      return
    }

    setTesting(true)
    setTestResult(null)
    try {
      const sdk = await loadGoogleMaps(candidate)
      if (!sdk?.Map) throw new Error('โหลด Maps library ไม่สำเร็จ')
      setTestResult({ ok: true, message: 'Google Maps SDK พร้อมใช้งานในเบราว์เซอร์นี้' })
    } catch (error) {
      setTestResult({ ok: false, message: `เชื่อมต่อไม่สำเร็จ: ${error.message}` })
    } finally {
      setTesting(false)
    }
  }

  async function useEnvironmentKey() {
    if (!tenantKey || !window.confirm('ลบ Key เฉพาะเทศบาลและกลับไปใช้ Key ส่วนกลางจาก Environment?')) return
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('municipalities')
        .update({ google_maps_api_key: null })
        .eq('id', tenant.id)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('ไม่มีสิทธิ์ปรับปรุงข้อมูล (RLS Lock)')
      patchTenant({ google_maps_api_key: null })
      setEditingKey(false)
      setNewKey('')
      setTestResult({ ok: true, message: environmentKey ? 'เปลี่ยนกลับมาใช้ Key ส่วนกลางแล้ว' : 'ลบ Key แล้ว แต่ยังไม่มี Key ส่วนกลางใน Environment' })
    } catch (error) {
      setTestResult({ ok: false, message: `เปลี่ยน Key ไม่สำเร็จ: ${error.message}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Map Engine Selector */}
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-slate-900/5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                <Sparkles size={12} /> $0 Budget Ready
              </span>
              <h3 className="text-base font-black text-slate-900">ระบบประมวลผลแผนที่ (Map Engine)</h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">เลือกสถาปัตยกรรมแผนที่ที่ต้องการใช้งานทั่วทั้งระบบ SmartLocal</p>
          </div>
          <Link
            to="/map-demo"
            className="flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100"
          >
            <Sparkles size={14} /> เปิดหน้าทดลอง (Demo Sandbox)
          </Link>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {/* Leaflet Option */}
          <button
            type="button"
            onClick={() => {
              setEngine('leaflet')
              localStorage.setItem('smartlocal_map_engine', 'leaflet')
            }}
            className={`flex flex-col items-start rounded-2xl border p-4 text-left transition-all ${
              engine === 'leaflet'
                ? 'border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-400'
                : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-black text-emerald-900">
                <Zap size={16} className="text-emerald-600" /> Leaflet Open-Source
              </span>
              {engine === 'leaflet' && (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">กำลังใช้งาน</span>
              )}
            </div>
            <p className="mt-2 text-xs font-semibold text-emerald-700">ฟรี 100% / ไม่ต้องใช้ API Key / $0 Budget</p>
            <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
              ใช้ภาพถ่ายดาวเทียม Esri World Imagery + แผนที่ CartoDB + ค้นหาที่อยู่ไทยผ่าน OSM Nominatim
            </p>
          </button>

          {/* Google Maps Option */}
          <button
            type="button"
            onClick={() => {
              setEngine('google')
              localStorage.setItem('smartlocal_map_engine', 'google')
            }}
            className={`flex flex-col items-start rounded-2xl border p-4 text-left transition-all ${
              engine === 'google'
                ? 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-400'
                : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm font-black text-blue-900">
                <Globe2 size={16} className="text-blue-600" /> Google Maps JS API
              </span>
              {engine === 'google' && (
                <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">กำลังใช้งาน</span>
              )}
            </div>
            <p className="mt-2 text-xs font-semibold text-blue-700">ต้องมี API Key / พึ่งพา Google Cloud Platform</p>
            <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
              ใช้ Google Maps Platform SDK มาตรฐานเดิมตามการตั้งค่าด้านล่าง
            </p>
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <div className="bg-gradient-to-r from-slate-950 via-blue-950 to-indigo-950 px-5 py-5 text-white sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-300/20">
              <CloudCog size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-black">Google Maps Platform</p>
              <p className="mt-1 text-xs leading-relaxed text-cyan-100/60">การตั้งค่าระดับระบบสำหรับแผนที่ การค้นหาสถานที่ และการปักหมุด</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${effectiveKey ? 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/20' : 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/20'}`}>
              {effectiveKey ? 'พร้อมใช้งาน' : 'ยังไม่ตั้งค่า'}
            </span>
          </div>
        </div>

        <form onSubmit={saveSettings} className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                <KeyRound size={15} className="text-blue-500" /> API Key ที่ใช้งาน
              </div>
              <p className="mt-2 truncate font-mono text-sm font-bold tracking-wide text-slate-800">{maskedKey}</p>
              <p className="mt-1 text-[11px] text-slate-400">{keySource}</p>
            </div>
            <div className="flex gap-2 sm:flex-col">
              <button type="button" onClick={() => { setEditingKey(v => !v); setNewKey(''); setShowKey(false); setTestResult(null) }}
                className="flex-1 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100">
                {editingKey ? 'ยกเลิกเปลี่ยน Key' : 'เปลี่ยน API Key'}
              </button>
              <button type="button" onClick={testSdk} disabled={testing}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50">
                {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                ทดสอบ SDK
              </button>
            </div>
          </div>

          {editingKey && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
              <label className="mb-1.5 block text-xs font-bold text-slate-700">Google Maps Browser API Key ใหม่</label>
              <div className="relative">
                <input type={showKey ? 'text' : 'password'} value={newKey} onChange={e => setNewKey(e.target.value)}
                  autoComplete="new-password" spellCheck={false} placeholder="กรอก Key ใหม่"
                  className={`${inputCls} pr-12 font-mono text-xs`} />
                <button type="button" onClick={() => setShowKey(v => !v)} aria-label={showKey ? 'ซ่อน API Key' : 'แสดง API Key'}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-700">
                  {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
                <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                จำกัด HTTP Referrer, API scope และ quota ใน Google Cloud Console ก่อนบันทึก ห้ามใช้ Service Account key หรือไฟล์ credential ในช่องนี้
              </div>
            </div>
          )}

          {testResult && (
            <div className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-xs font-semibold ${testResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {testResult.ok ? <CheckCircle2 size={16} className="shrink-0" /> : <CircleAlert size={16} className="shrink-0" />}
              {testResult.message}
            </div>
          )}

          <details className="group rounded-2xl border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-xs font-bold text-slate-600">ข้อมูลทะเบียน Google Cloud <span className="font-normal text-slate-400">(ข้อมูลประกอบ)</span></summary>
            <div className="border-t border-slate-100 p-4">
              {/* ช่องว่างสองความหมาย "ยังโหลดไม่เสร็จ" กับ "ในฐานข้อมูลไม่มีค่า" หน้าตาเหมือนกันเป๊ะ
                  ต้องบอกให้ชัดว่ากำลังอยู่สถานะไหน ไม่งั้นแอดมินพิมพ์ทับของเดิมโดยไม่รู้ตัว */}
              {!cloudInfoLoaded && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
                  <CircleAlert size={15} className="mt-0.5 shrink-0" />
                  ยังอ่านค่าเดิมจากฐานข้อมูลไม่สำเร็จ — ช่องด้านล่างถูกล็อกไว้กันเผลอบันทึกทับของเดิม
                  กด &quot;เปลี่ยน API Key&quot; และบันทึกได้ตามปกติ ถ้าต้องแก้ข้อมูลทะเบียนให้รีเฟรชหน้าก่อน
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><Mail size={14} /> อีเมลผู้รับผิดชอบ</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={!cloudInfoLoaded}
                    className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-60`} placeholder="gis@example.go.th" />
                </div>
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><CloudCog size={14} /> Project ID</label>
                  <input type="text" value={projectId} onChange={e => setProjectId(e.target.value)} disabled={!cloudInfoLoaded}
                    className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-60`} placeholder="municipality-maps" />
                </div>
              </div>
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition-all active:scale-95 disabled:opacity-50">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              บันทึกการตั้งค่า
            </button>
            {tenantKey && (
              <button type="button" onClick={useEnvironmentKey} disabled={saving}
                className="rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50">
                ใช้ Key ส่วนกลางแทน
              </button>
            )}
            {saved && <span className="flex items-center gap-1 text-xs font-bold text-emerald-600"><CheckCircle2 size={15} /> บันทึกแล้ว</span>}
          </div>
        </form>
      </section>

      <p className="px-1 text-[11px] leading-relaxed text-slate-400">หมายเหตุ: Browser API Key จะถูกส่งไปยังเบราว์เซอร์เพื่อโหลด Google Maps SDK จึงต้องป้องกันด้วยข้อจำกัดบน Google Cloud ไม่ใช่อาศัยการซ่อนข้อความบนหน้าจอเพียงอย่างเดียว</p>
    </div>
  )
}