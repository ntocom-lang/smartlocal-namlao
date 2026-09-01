import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Phone, PhoneCall, Settings } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'
import { useAuth } from '../contexts/AuthContext'

export default function EmergencyPage() {
  const navigate = useNavigate()
  const { tenant, loading: tenantLoading } = useTenant()
  const { role } = useAuth()
  const [contacts, setContacts] = useState(null)   // null = ยังไม่ได้โหลด, [] = โหลดแล้วแต่ไม่มีข้อมูล

  // เบอร์สายด่วนต่างกันทุก อปท. จึงไม่มีเบอร์กลางสำรอง — แต่ละแห่งต้องกรอกเองจากหลังบ้าน
  useEffect(() => {
    if (!tenant?.id) return
    let alive = true
    supabase
      .from('emergency_contacts')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('display_order')
      .then(({ data }) => { if (alive) setContacts(data || []) })
    return () => { alive = false }
  }, [tenant?.id])

  // tenant ยังโหลดไม่เสร็จ หรือมี tenant แล้วแต่ query ยังไม่กลับ = ยังโหลดอยู่
  // ถ้า tenant โหลดจบแล้วแต่หา tenant ไม่เจอ ให้ตกไปที่ empty state แทนที่จะค้าง skeleton
  const loading = tenantLoading || Boolean(tenant?.id && contacts === null)
  const canManage = role === 'admin' || role === 'superadmin'

  return (
    <div className="max-w-lg mx-auto pb-28 md:pb-8">

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-30 px-4 pt-3 pb-2 bg-gray-50/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">สายด่วนฉุกเฉิน</h1>
        </div>
      </div>

      {/* PC header */}
      <div className="hidden md:flex items-center gap-3 px-4 pt-8 pb-5 border-b border-gray-100 mb-2">
        <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0"
             style={{ background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)' }}>
          📞
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">สายด่วนฉุกเฉิน</h1>
          <p className="text-sm text-gray-500 mt-0.5">เบอร์โทรศัพท์ฉุกเฉิน 24 ชั่วโมง</p>
        </div>
      </div>

      <div className="px-4 pt-1 md:pt-4 space-y-5">

        {/* Hero */}
        <div className="rounded-2xl p-5 flex items-center gap-4"
             style={{ background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)' }}>
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
            <PhoneCall size={24} className="text-white" />
          </div>
          <div className="text-white">
            <h2 className="font-bold text-lg leading-tight">สายด่วนฉุกเฉิน 24 ชั่วโมง</h2>
            <p className="text-white/80 text-xs mt-0.5">กดที่การ์ดเพื่อโทรหาหน่วยงานได้เลย</p>
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-[148px] md:h-[176px] rounded-2xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : !contacts || contacts.length === 0 ? (
          <div className="rounded-2xl bg-white border border-gray-100 shadow-sm px-5 py-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <PhoneCall size={26} className="text-gray-400" />
            </div>
            <p className="font-semibold text-gray-700">ยังไม่มีข้อมูลสายด่วนฉุกเฉิน</p>
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">
              {tenant?.name || 'หน่วยงาน'}ยังไม่ได้บันทึกเบอร์สายด่วน
              {tenant?.phone ? ' กรุณาติดต่อสำนักงานตามเบอร์ด้านล่าง' : ' กรุณาติดต่อสำนักงานโดยตรง'}
            </p>
            {canManage && (
              <Link to="/admin" state={{ page: 'emergency' }}
                    className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl text-white text-sm font-semibold"
                    style={{ backgroundColor: '#ef4444' }}>
                <Settings size={14} />
                เพิ่มเบอร์สายด่วน
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
            {contacts.map(({ id, label, number, emoji, color, bg }) => (
              <a key={id} href={`tel:${number}`}
                 className="flex flex-col items-center gap-2 p-3 md:p-4 rounded-2xl bg-white border border-gray-100 shadow-sm active:scale-95 transition-transform text-center">
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center text-2xl md:text-3xl"
                     style={{ backgroundColor: bg }}>
                  {emoji}
                </div>
                <div>
                  <p className="text-xl md:text-2xl font-extrabold leading-none tracking-wide" style={{ color }}>
                    {number}
                  </p>
                  <p className="text-xs md:text-sm text-gray-500 mt-1">{label}</p>
                </div>
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-white text-[10px] md:text-xs font-semibold"
                      style={{ backgroundColor: color }}>
                  <Phone size={12} />
                  โทรเลย
                </span>
              </a>
            ))}
          </div>
        )}

        {/* Tenant contact */}
        {tenant?.phone && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1 mb-2">
              ติดต่อ{tenant.name}
            </p>
            <a href={`tel:${tenant.phone}`}
               className="flex items-center gap-4 bg-white rounded-2xl px-4 py-4 shadow-sm border border-gray-100 active:scale-95 transition-transform">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                   style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, white)' }}>
                <Phone size={20} style={{ color: 'var(--color-primary)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 truncate">{tenant.name}</p>
                <p className="text-xl font-extrabold leading-tight" style={{ color: 'var(--color-primary)' }}>
                  {tenant.phone}
                </p>
              </div>
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-white text-xs font-semibold shrink-0"
                    style={{ backgroundColor: 'var(--color-primary)' }}>
                <Phone size={12} />
                โทร
              </span>
            </a>
          </div>
        )}

      </div>
    </div>
  )
}
