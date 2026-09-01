import { useState } from 'react'
import {
  ArrowLeft, CheckCircle2, Compass, Eye, Flame, Globe2, Layers,
  MapPin, Navigation, ShieldCheck, Sparkles, Zap,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import LeafletMapCanvas from '../components/common/LeafletMapCanvas'
import LeafletMapPicker from '../components/common/LeafletMapPicker'
import GoogleMapCanvas from '../components/common/GoogleMapCanvas'
import { useTenant } from '../contexts/TenantContext'
import { setMapEngine, useMapEngine } from '../lib/mapEngine'

// ตัวอย่างหมุดสำหรับทดสอบ Multi-Pins GIS
const SAMPLE_PINS = [
  { id: '1', position: { lat: 18.1452, lng: 100.1172 }, shape: 'circle', color: '#dc2626', label: '⛑️', title: 'รพ.สต. น้ำเลา', subtitle: 'สาธารณสุข • เปิด 08:30 - 16:30 น.' },
  { id: '2', position: { lat: 18.1425, lng: 100.1150 }, shape: 'circle', color: '#2563eb', label: '🏫', title: 'โรงเรียนบ้านน้ำเลา', subtitle: 'สถานศึกษา • สพป. แพร่ เขต 1' },
  { id: '3', position: { lat: 18.1470, lng: 100.1190 }, shape: 'circle', color: '#059669', label: '📍', title: 'วัดน้ำเลา', subtitle: 'สถานที่สำคัญ • พระอารามชุมชน' },
  { id: '4', position: { lat: 18.1438, lng: 100.1210 }, shape: 'circle', color: '#7c3aed', label: '🚧', title: 'โครงการปรับปรุงถนน คสล.', subtitle: 'โครงการก่อสร้าง • งบประมาณ 450,000 บาท' },
  { id: '5', position: { lat: 18.1460, lng: 100.1145 }, shape: 'circle', color: '#d97706', label: '🏢', title: 'ตลาดชุมชนน้ำเลา', subtitle: 'สถานประกอบการ • เปิดทุกวัน' },
]

const SAMPLE_POLYLINE = [
  {
    id: 'road-1',
    color: '#2563eb',
    weight: 5,
    path: [
      { lat: 18.1420, lng: 100.1130 },
      { lat: 18.1440, lng: 100.1160 },
      { lat: 18.1465, lng: 100.1185 },
      { lat: 18.1480, lng: 100.1220 },
    ],
  },
  {
    id: 'pipe-1',
    color: '#0891b2',
    weight: 4,
    dashArray: '6, 6',
    path: [
      { lat: 18.1430, lng: 100.1140 },
      { lat: 18.1450, lng: 100.1170 },
      { lat: 18.1470, lng: 100.1200 },
    ],
  },
]

export default function MapEngineDemoPage() {
  const { tenant } = useTenant()
  const defaultPos = {
    lat: Number(tenant?.latitude) || 18.1448,
    lng: Number(tenant?.longitude) || 100.1167,
  }

  // อ่านจาก store กลาง เพื่อให้หน้านี้กับการ์ดในหน้าตั้งค่า Google Maps เห็นค่าตรงกันเสมอ
  const activeEngine = useMapEngine()

  const [activeTab, setActiveTab] = useState('picker') // 'picker' | 'datacenter' | 'compare'
  const [selectedLocation, setSelectedLocation] = useState(defaultPos)
  const [clickedFeature, setClickedFeature] = useState(null)
  const [savedSuccess, setSavedSuccess] = useState(false)

  function handleSetEngine(engine) {
    setMapEngine(engine)
    setSavedSuccess(true)
    setTimeout(() => setSavedSuccess(false), 2000)
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20 pt-6">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Top Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/dev"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-100"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                  <Sparkles size={12} /> $0 Budget Sandbox
                </span>
                <span className="text-xs font-semibold text-slate-400">SmartLocal GIS v1.1</span>
              </div>
              <h1 className="text-xl font-black text-slate-900 sm:text-2xl">
                ศูนย์ทดสอบระบบแผนที่ Open-Source ($0 Budget)
              </h1>
            </div>
          </div>

          {/* Engine Selector */}
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
            <button
              type="button"
              onClick={() => handleSetEngine('leaflet')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all active:scale-95 ${
                activeEngine === 'leaflet'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Zap size={15} /> Leaflet (ฟรี 100% / ไม่ใช้ API Key)
            </button>
            <button
              type="button"
              onClick={() => handleSetEngine('google')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all active:scale-95 ${
                activeEngine === 'google'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Globe2 size={15} /> Google Maps (API Key เดิม)
            </button>
          </div>
        </div>

        {savedSuccess && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800 animate-in fade-in">
            <CheckCircle2 size={16} /> บันทึกการเลือก Engine แผนที่เรียบร้อยแล้ว — หน้าทั้งหมดจะแสดงผลตาม Engine นี้
          </div>
        )}

        {/* Highlight Card */}
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <Flame size={15} className="text-amber-500" /> ค่าใช้จ่าย API (TCO)
            </div>
            <p className="mt-2 text-xl font-black text-emerald-600">0 บาท (ฟรีตลอดชีพ)</p>
            <p className="text-[11px] text-slate-400">ไม่ต้องผูกบัตรเครดิต ไม่มีบิลส่วนเกิน</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <Layers size={15} className="text-blue-500" /> ภาพถ่ายดาวเทียมความคมชัดสูง
            </div>
            <p className="mt-2 text-xl font-black text-slate-800">Esri World Imagery</p>
            <p className="text-[11px] text-slate-400">เห็นหลังคาเรือน + ซ้อนเส้นถนนภาษาไทย</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <Navigation size={15} className="text-purple-500" /> แปลงพิกัด & ค้นหาสถานที่
            </div>
            <p className="mt-2 text-xl font-black text-slate-800">OSM Nominatim API</p>
            <p className="text-[11px] text-slate-400">ค้นหาที่อยู่ภาษาไทย & อ่าน GPS ได้ทันที</p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="mb-6 flex gap-2 border-b border-slate-200 pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('picker')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
              activeTab === 'picker'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            <MapPin size={16} /> 1. ทดสอบระบบปักหมุดตำแหน่ง (Map Picker)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('datacenter')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
              activeTab === 'datacenter'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Compass size={16} /> 2. ทดสอบแผนที่ศูนย์ข้อมูล GIS (Multi-Pins & Boundary)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('compare')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
              activeTab === 'compare'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Eye size={16} /> 3. เทียบเคียง 2 ฝั่ง (Leaflet vs Google)
          </button>
        </div>

        {/* TAB 1: Map Picker */}
        {activeTab === 'picker' && (
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-lg sm:p-6">
              <div className="mb-4">
                <h2 className="text-base font-bold text-slate-800">
                  ระบบปักหมุดตำแหน่งแจ้งเรื่องร้องทุกข์ & เพิ่มข้อมูล (ทดสอบ Leaflet Open-Source)
                </h2>
                <p className="text-xs text-slate-500">
                  ทดสอบพิมพ์ค้นหาชื่อสถานที่, กดปุ่ม &quot;ตำแหน่งของฉัน&quot;, และลากแผนที่เพื่อดูการแปลงพิกัดเป็นที่อยู่ภาษาไทยอัตโนมัติ
                </p>
              </div>

              <LeafletMapPicker
                initialPos={selectedLocation}
                onLocationSelect={loc => setSelectedLocation(loc)}
                mapClassName="w-full h-96 min-h-[380px]"
                modal={false}
              />
            </div>
          </div>
        )}

        {/* TAB 2: Multi-Pins & GIS */}
        {activeTab === 'datacenter' && (
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-lg sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-800">
                    แผนที่ศูนย์รวมข้อมูลดิจิทัล (GIS Multi-Layer Simulation)
                  </h2>
                  <p className="text-xs text-slate-500">
                    แสดงหมุดอิโมจิ, ขอบเขตตำบล (GeoJSON Dashed Ring), และเส้นทางถนน/ท่อระบายน้ำ (Polylines)
                  </p>
                </div>
                {clickedFeature && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-800">
                    คลิกเลือก: {clickedFeature.title || clickedFeature.id}
                  </div>
                )}
              </div>

              <div className="h-[460px] w-full overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
                <LeafletMapCanvas
                  center={defaultPos}
                  zoom={15}
                  markers={SAMPLE_PINS}
                  polylines={SAMPLE_POLYLINE}
                  showBoundary
                  onFeatureClick={feature => setClickedFeature(feature)}
                  className="h-full w-full"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Side-by-Side Comparison */}
        {activeTab === 'compare' && (
          <div className="space-y-4">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Leaflet Side */}
              <div className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-lg">
                <div className="mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">
                    🍃 Leaflet Open-Source ($0 Free)
                  </span>
                  <span className="text-[11px] font-bold text-slate-400">ไม่ต้องใช้ API Key</span>
                </div>
                <div className="h-80 w-full overflow-hidden rounded-2xl border border-slate-200">
                  <LeafletMapCanvas
                    center={defaultPos}
                    zoom={15}
                    markers={SAMPLE_PINS}
                    polylines={SAMPLE_POLYLINE}
                    showBoundary
                    className="h-full w-full"
                  />
                </div>
              </div>

              {/* Google Maps Side */}
              <div className="rounded-3xl border border-blue-200 bg-white p-5 shadow-lg">
                <div className="mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-black text-blue-800">
                    🌐 Google Maps (SDK เดิม)
                  </span>
                  <span className="text-[11px] font-bold text-slate-400">ใช้ API Key</span>
                </div>
                <div className="h-80 w-full overflow-hidden rounded-2xl border border-slate-200">
                  <GoogleMapCanvas
                    center={defaultPos}
                    zoom={15}
                    markers={SAMPLE_PINS}
                    polylines={SAMPLE_POLYLINE}
                    showBoundary
                    className="h-full w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bottom Safety Switch Note */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500 shadow-sm">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <ShieldCheck size={16} className="text-emerald-600" /> นโยบายความปลอดภัยและการย้อนกลับ (Zero Risk Policy)
          </div>
          <p className="mt-1 leading-relaxed text-slate-600">
            ท่านสามารถทดลองใช้งานในหน้านี้ได้เต็มรูปแบบ หากตรวจสอบแล้วพึงพอใจ สามารถกดเลือก <strong>Leaflet (ฟรี 100%)</strong> เพื่อใช้งานทั้งระบบได้ทันที หรือหากต้องการกลับไปใช้ Google Maps ก็สามารถสลับกลับได้ทุกเวลาเพียง 1 คลิก โดยไม่มีผลกระทบต่อฐานข้อมูลและข้อมูลเดิม
          </p>
        </div>
      </div>
    </div>
  )
}
