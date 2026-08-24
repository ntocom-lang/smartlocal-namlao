import { ArrowLeft, MapPin, Phone, Globe, Mail, Printer, Network, Navigation, ExternalLink, MapPinned, ChevronRight, Building2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTenant } from '../contexts/TenantContext'

export default function ContactPage() {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  // fallback เป็นพิกัด namlao เฉพาะตอน tenant ยังไม่ตั้งพิกัดใน DB — เดิม hardcode พิกัด namlao ตรงๆ
  // ทำให้ทุก tenant กดปุ่ม "นำทาง"/แผนที่แล้วพาไปที่ office namlao หมด ไม่ว่าจะเป็นเทศบาลไหนก็ตาม
  const lat = tenant?.latitude ?? 18.259207
  const lng = tenant?.longitude ?? 100.3105803

  return (
    <div className="min-h-screen pb-28 md:pb-8" style={{ backgroundColor: '#eef2f7' }}>

      {/* Mobile header */}
      <div className="md:hidden sticky top-0 z-30 px-4 py-3 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-base font-bold text-gray-800">ติดต่อหน่วยงาน</h1>
        </div>
      </div>

      {/* PC header */}
      <div className="hidden md:flex items-center justify-between px-8 py-4 bg-white border-b border-gray-200 shadow-sm">
        <h1 className="text-lg font-bold text-gray-800">ติดต่อหน่วยงาน</h1>
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
          <ArrowLeft size={15} />
          ย้อนกลับ
        </button>
      </div>

      <div className="p-4 max-w-3xl mx-auto space-y-6 mt-2">
        
        {/* ─── ข้อมูลการติดต่อ ─── */}
        <section>
          <div className="flex items-center gap-2 mb-4 pl-1 border-l-4" style={{ borderColor: 'var(--color-primary, #2563eb)' }}>
            <h2 className="text-[17px] font-bold text-gray-800 ml-1">ข้อมูลการติดต่อ</h2>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 shadow-sm">
            {/* Address */}
            <div className="p-4 flex items-start gap-4">
              <div className="mt-0.5 text-blue-600">
                <MapPin size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 text-[15px] mb-1">ที่อยู่</p>
                <p className="text-[14px] text-gray-600 leading-relaxed whitespace-pre-wrap">
                  {tenant?.address || 'เลขที่ 101 หมู่ที่ 5 ตำบลน้ำเลา\nอำเภอร้องกวาง จังหวัดแพร่ 54140'}
                </p>
              </div>
            </div>

            {/* Phone */}
            <a href={`tel:${tenant?.phone || '054-546-092'}`} className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
              <div className="text-green-600">
                <Phone size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 text-[15px] mb-0.5">โทรศัพท์</p>
                <p className="text-[14px] text-gray-600">{tenant?.phone || '054-546-092'}</p>
              </div>
              <ChevronRight size={18} className="text-gray-300" />
            </a>

            {/* Fax — ซ่อนไปเลยถ้า tenant ยังไม่กรอก แทนที่จะโชว์เบอร์ของ namlao ค้างแบบเดิม */}
            {tenant?.fax && (
              <div className="p-4 flex items-center gap-4">
                <div className="text-teal-600">
                  <Printer size={22} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 text-[15px] mb-0.5">โทรสาร (แฟกซ์)</p>
                  <p className="text-[14px] text-gray-600">{tenant.fax}</p>
                </div>
              </div>
            )}

            {/* Email */}
            <a href={`mailto:${tenant?.email || 'phrae_namlao101@hotmail.co.th'}`} className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
              <div style={{ color: 'var(--color-primary)' }}>
                <Mail size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 text-[15px] mb-0.5">อีเมล</p>
                <p className="text-[14px] text-gray-600 truncate">{tenant?.email || 'phrae_namlao101@hotmail.co.th'}</p>
              </div>
              <ChevronRight size={18} className="text-gray-300" />
            </a>

            {/* Website */}
            <a href={tenant?.website_url || 'http://www.namlao.go.th'} target="_blank" rel="noreferrer" className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
              <div className="text-indigo-600">
                <Globe size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 text-[15px] mb-0.5">เว็บไซต์</p>
                <p className="text-[14px] text-gray-600 truncate">{tenant?.website_url?.replace(/^https?:\/\//, '') || 'www.namlao.go.th'}</p>
              </div>
              <ChevronRight size={18} className="text-gray-300" />
            </a>

            {/* Facebook */}
            <a href={tenant?.facebook_url || 'https://www.facebook.com/namlao101'} target="_blank" rel="noreferrer" className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
              <div className="text-blue-600">
                <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-facebook"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 text-[15px] mb-0.5">Facebook</p>
                <p className="text-[14px] text-gray-600 truncate">{tenant?.name || 'เทศบาลตำบลน้ำเลา'}</p>
              </div>
              <ChevronRight size={18} className="text-gray-300" />
            </a>
          </div>
        </section>

        {/* ─── หมายเลขภายใน ─── แต่ละเทศบาลกรอกเอง (โครงสร้างกองไม่เท่ากัน) ซ่อนทั้ง section ถ้ายังไม่กรอก
            แทนที่จะโชว์ 5 กองของ namlao ค้างแบบเดิม — ดูตั้งค่าที่ SystemSettingsAdmin.jsx */}
        {tenant?.internal_extensions?.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4 pl-1 border-l-4" style={{ borderColor: 'var(--color-primary, #2563eb)' }}>
              <h2 className="text-[17px] font-bold text-gray-800 ml-1">หมายเลขภายใน</h2>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div className="bg-gray-50 border-b border-gray-200 px-4 py-3.5 flex items-center gap-2.5">
                <Network size={18} className="text-gray-600" />
                <span className="font-semibold text-gray-800 text-[15px]">สายตรงแต่ละกอง / ฝ่าย</span>
              </div>

              <div className="divide-y divide-gray-100">
                {tenant.internal_extensions.map((item, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <Building2 size={18} className="text-gray-400" />
                      <span className="text-[14px] font-medium text-gray-700">{item.name}</span>
                    </div>
                    <span className="text-[14px] font-bold text-gray-800">ต่อ {item.ext}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ─── แผนที่ ─── */}
        <section>
          <div className="flex items-center gap-2 mb-4 pl-1 border-l-4" style={{ borderColor: 'var(--color-primary, #2563eb)' }}>
            <h2 className="text-[17px] font-bold text-gray-800 ml-1">แผนที่ตั้งหน่วยงาน</h2>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
            <div className="p-4 flex items-center justify-between gap-3 bg-white z-10 border-b border-gray-100">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0">
                  <MapPinned size={20} />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-800 text-[14px] truncate">{tenant?.name || 'เทศบาลตำบลน้ำเลา'}</p>
                  <p className="text-[12px] text-gray-500 mt-0.5 font-mono">{lat}, {lng}</p>
                </div>
              </div>
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`} target="_blank" rel="noreferrer"
                 className="shrink-0 text-white px-3 py-1.5 rounded-lg text-[13px] font-semibold flex items-center gap-1.5 transition-colors hover:opacity-90"
                 style={{ backgroundColor: 'var(--color-primary)' }}>
                <Navigation size={14} /> นำทาง
              </a>
            </div>

            {/* Map Iframe */}
            <div className="h-56 md:h-64 bg-gray-200 relative w-full pointer-events-auto">
              <iframe
                src={`https://maps.google.com/maps?q=${lat},${lng}&t=k&z=17&ie=UTF8&iwloc=&output=embed`}
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen=""
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0"
                title="Map"
              />
            </div>

            {/* Open in maps footer */}
            <a href={`https://maps.google.com/?q=${lat},${lng}`} target="_blank" rel="noreferrer"
               className="flex items-center justify-center gap-2 py-3 bg-gray-50 hover:bg-gray-100 text-gray-700 text-[14px] font-semibold transition-colors border-t border-gray-200">
              <ExternalLink size={16} /> เปิดใน Google Maps
            </a>
          </div>
        </section>

      </div>
    </div>
  )
}
