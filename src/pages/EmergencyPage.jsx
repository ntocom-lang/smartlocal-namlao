import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Phone, PhoneCall } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTenant } from '../contexts/TenantContext'

const FALLBACK = [
  { id: '1', label: 'ตำรวจ',          number: '191',  emoji: '👮', color: '#1d4ed8', bg: '#dbeafe' },
  { id: '2', label: 'กู้ชีพ / EMS',   number: '1669', emoji: '🚑', color: '#dc2626', bg: '#fee2e2' },
  { id: '3', label: 'การไฟฟ้า',       number: '1129', emoji: '⚡', color: '#d97706', bg: '#fef3c7' },
  { id: '4', label: 'ดับเพลิง',       number: '199',  emoji: '🚒', color: '#ea580c', bg: '#ffedd5' },
  { id: '5', label: 'ประปา',          number: '1662', emoji: '💧', color: '#0284c7', bg: '#e0f2fe' },
  { id: '6', label: 'สายด่วนรัฐบาล', number: '1111', emoji: '📞', color: '#7c3aed', bg: '#ede9fe' },
]

export default function EmergencyPage() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const [contacts, setContacts] = useState(FALLBACK)

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('emergency_contacts')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('display_order')
      .then(({ data }) => {
        if (data && data.length > 0) setContacts(data)
      })
  }, [tenant?.id])

  return (
    <div className="max-w-lg mx-auto pb-28">

      {/* Header */}
      <div className="sticky top-0 z-30 px-4 pt-3 pb-2 bg-gray-50/95 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-1 rounded-xl hover:bg-gray-200/60 text-gray-500 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">สายด่วนฉุกเฉิน</h1>
        </div>
      </div>

      <div className="px-4 pt-1 space-y-5">

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
        <div className="grid grid-cols-2 gap-3">
          {contacts.map(({ id, label, number, emoji, color, bg }) => (
            <a key={id} href={`tel:${number}`}
               className="flex flex-col items-center gap-2.5 p-4 rounded-2xl bg-white border border-gray-100 shadow-sm active:scale-95 transition-transform text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl"
                   style={{ backgroundColor: bg }}>
                {emoji}
              </div>
              <div>
                <p className="text-2xl font-extrabold leading-none tracking-wide" style={{ color }}>
                  {number}
                </p>
                <p className="text-sm text-gray-500 mt-1">{label}</p>
              </div>
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-white text-xs font-semibold"
                    style={{ backgroundColor: color }}>
                <Phone size={12} />
                โทรเลย
              </span>
            </a>
          ))}
        </div>

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
