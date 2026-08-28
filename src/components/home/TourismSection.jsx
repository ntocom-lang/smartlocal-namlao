import { useState, useEffect } from 'react'
import { withModule } from '../../lib/withModule'
import { useNavigate } from 'react-router-dom'
import { Luggage, Utensils, BedDouble, ShoppingBag, Wrench, ChevronRight, MapPin, Compass } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toReliableImageUrl } from '../../lib/driveStorage'
import { useTenant } from '../../contexts/TenantContext'

const CATS = [
  { key: 'travel',  label: 'เที่ยว',  Icon: Luggage,     from: '#f59e0b', to: '#b45309', glow: '#f59e0b60', emoji: '🏛️' },
  { key: 'food',    label: 'กิน',     Icon: Utensils,    from: '#22c55e', to: '#15803d', glow: '#22c55e60', emoji: '🍽️' },
  { key: 'stay',    label: 'พัก',     Icon: BedDouble,   from: '#38bdf8', to: '#0284c7', glow: '#38bdf860', emoji: '🏨' },
  { key: 'shop',    label: 'ชอป',    Icon: ShoppingBag, from: '#f472b6', to: '#be185d', glow: '#f472b660', emoji: '🛍️' },
  { key: 'service', label: 'บริการ',  Icon: Wrench,      from: '#fb923c', to: '#c2410c', glow: '#fb923c60', emoji: '🔧' },
]

function TourismSection() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [places, setPlaces] = useState([])
  const [activeCat, setActiveCat] = useState('travel')
  const [backgroundUrl, setBackgroundUrl] = useState(() => toReliableImageUrl(tenant?.tourism_background_url) || '/tourism-bg.jpg')

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('tourism_places')
      .select('*')
      .eq('municipality_id', tenant.id)
      .eq('is_active', true)
      .order('display_order')
      .then(({ data }) => { if (data) setPlaces(data) })
  }, [tenant?.id])

  useEffect(() => {
    let cancelled = false
    if (!tenant?.id) return undefined

    supabase
      .from('municipalities')
      .select('tourism_background_url')
      .eq('id', tenant.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled && !error) {
          setBackgroundUrl(toReliableImageUrl(data?.tourism_background_url) || '/tourism-bg.jpg')
        }
      })

    return () => { cancelled = true }
  }, [tenant?.id, tenant?.tourism_background_url])

  const filtered = activeCat ? places.filter(p => p.category === activeCat) : places
  const catData  = CATS.find(c => c.key === activeCat)
  const catCount = (key) => places.filter(p => p.category === key).length

  const hero = filtered[0]
  const subs = filtered.slice(1, 3)

  const shortName = tenant?.name
    ?.replace(/^(องค์การบริหารส่วนตำบล|เทศบาลตำบล|เทศบาลเมือง|เทศบาลนคร|เทศบาล)/, '')
    ?.trim() || 'ของเรา'

  return (
    <section className="relative w-full rounded-3xl overflow-hidden shadow-2xl">

      {/* ── Base background image ── */}
      <div className="absolute inset-0 bg-cover bg-center scale-105"
           style={{ backgroundImage: backgroundUrl === '/tourism-bg.jpg' ? "url('/tourism-bg.jpg')" : `url("${backgroundUrl}"), url('/tourism-bg.jpg')` }} />

      {/* ── Dark base overlay ── */}
      <div className="absolute inset-0 bg-linear-to-b from-black/75 via-black/30 to-black/90" />

      {/* ── Dynamic category color bloom (transitions with active cat) ── */}
      <div className="absolute inset-0 transition-all duration-700 pointer-events-none"
           style={{ background: catData ? `radial-gradient(ellipse 120% 50% at 50% 0%, ${catData.from}55 0%, transparent 70%)` : 'transparent' }} />

      {/* ── Decorative orbs ── */}
      <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full blur-3xl pointer-events-none transition-all duration-700"
           style={{ backgroundColor: catData ? `${catData.from}30` : 'transparent' }} />
      <div className="absolute top-1/3 -left-8 w-32 h-32 rounded-full blur-2xl pointer-events-none"
           style={{ backgroundColor: 'rgba(255,255,255,0.04)' }} />

      {/* ─────────────── MOBILE layout ─────────────── */}
      <div className="relative z-10 pt-4 flex flex-col md:hidden">
        <div className="px-5 mb-3">
          <p className="text-[10px] font-bold text-white/50 uppercase tracking-widest mb-1 flex items-center gap-1">
            <Compass size={9} /> ค้นพบสถานที่น่าไป
          </p>
          <h2 className="leading-none mb-0.5">
            <span className="text-[1.9rem] font-black drop-shadow-lg"
                  style={{ color: catData?.from ?? '#34d399', textShadow: `0 0 24px ${catData?.glow ?? '#34d39960'}` }}>มา</span>
            <span className="text-[1.9rem] font-black text-white drop-shadow-lg">{shortName}</span>
          </h2>
          <p className="text-white/70 text-sm font-bold drop-shadow">...ต้องไม่พลาด ✦</p>
        </div>
        <div className="flex gap-2 px-5 mb-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {CATS.map(({ key, label, Icon, from, to, glow }) => {
            const isActive = activeCat === key
            const count = catCount(key)
            return (
              <button key={key} onClick={() => setActiveCat(isActive ? null : key)}
                      className="shrink-0 flex flex-col items-center gap-1 transition-all duration-250 active:scale-90" style={{ minWidth: 52 }}>
                <div className="relative flex items-center justify-center rounded-xl transition-all duration-300"
                     style={isActive
                       ? { width: 48, height: 48, background: `linear-gradient(140deg, ${from}, ${to})`, boxShadow: `0 6px 20px ${glow}, 0 2px 6px rgba(0,0,0,0.4)`, transform: 'scale(1.1) translateY(-2px)' }
                       : { width: 48, height: 48, backgroundColor: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.22)' }}>
                  <Icon size={20} className="text-white" strokeWidth={isActive ? 2 : 1.5} />
                  {count > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-0.5 flex items-center justify-center rounded-full text-[9px] font-bold text-white"
                          style={{ background: isActive ? 'rgba(255,255,255,0.3)' : `linear-gradient(135deg, ${from}, ${to})` }}>{count}</span>
                  )}
                </div>
                <span className={`text-[10px] font-bold drop-shadow transition-all duration-200 ${isActive ? 'text-white scale-105' : 'text-white/60'}`}>{label}</span>
              </button>
            )
          })}
        </div>
        <div className="backdrop-blur-xl rounded-t-3xl px-4 pt-3 pb-4 border-t border-white/10" style={{ backgroundColor: 'rgba(0,0,0,0.28)' }}>
          {filtered.length === 0 ? (
            <div className="py-8 flex flex-col items-center text-center">
              <div className="relative flex items-center justify-center rounded-full mb-3 animate-pulse"
                   style={{ width: 72, height: 72,
                            background: `radial-gradient(circle, ${catData?.from ?? '#64748b'}33 0%, transparent 70%)`,
                            border: `1.5px solid ${catData?.from ?? '#64748b'}55`,
                            boxShadow: `0 0 28px ${catData?.glow ?? 'rgba(255,255,255,0.1)'}` }}>
                <span className="text-4xl drop-shadow-lg">{catData?.emoji ?? '🗺️'}</span>
              </div>
              <p className="text-white/70 text-sm font-bold">ยังไม่มีข้อมูลในหมวดนี้</p>
              <p className="text-white/35 text-xs mt-0.5">แอดมินกำลังรวบรวมข้อมูลเพิ่มเติม ✦</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 mb-3">
              {hero && (
                <button onClick={() => navigate(`/tourism/${hero.id}`)}
                        className="relative w-full rounded-2xl overflow-hidden active:scale-[0.97] transition-transform group" style={{ height: 148 }}>
                  {hero.image_url
                    ? <img src={hero.image_url} alt={hero.name} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    : <div className="absolute inset-0 flex items-center justify-center text-5xl" style={{ background: `linear-gradient(135deg, ${catData?.from}aa, ${catData?.to})` }}>{catData?.emoji ?? '🏙️'}</div>}
                  <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-black/10" />
                  <div className="absolute inset-x-0 top-0 h-0.5 rounded-t-2xl" style={{ background: `linear-gradient(90deg, ${catData?.from}, ${catData?.to})` }} />
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full backdrop-blur-md" style={{ background: `linear-gradient(135deg, ${catData?.from}cc, ${catData?.to}cc)` }}>
                    <span className="text-[9px] font-black text-white uppercase tracking-wider">✦ แนะนำ</span>
                  </div>
                  <div className="absolute bottom-0 inset-x-0 px-3 py-2.5">
                    <div className="flex items-center gap-1 mb-0.5"><MapPin size={9} className="text-white/60" /><p className="text-[10px] text-white/60 font-medium">{catData?.label}</p></div>
                    <p className="text-[15px] font-black text-white drop-shadow-xl leading-tight">{hero.name}</p>
                  </div>
                </button>
              )}
              {subs.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {subs.map((place, idx) => (
                    <button key={place.id} onClick={() => navigate(`/tourism/${place.id}`)}
                            className="relative rounded-2xl overflow-hidden active:scale-[0.96] transition-transform group" style={{ height: 100 }}>
                      {place.image_url
                        ? <img src={place.image_url} alt={place.name} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        : <div className="absolute inset-0 flex items-center justify-center text-4xl" style={{ background: `linear-gradient(135deg, ${catData?.from}88, ${catData?.to})` }}>{catData?.emoji ?? '🏙️'}</div>}
                      <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" />
                      <div className="absolute top-2 left-2 w-5 h-5 rounded-full flex items-center justify-center backdrop-blur-md" style={{ backgroundColor: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)' }}>
                        <span className="text-[9px] font-black text-white">{idx + 2}</span>
                      </div>
                      <p className="absolute bottom-2 left-2.5 right-2.5 text-[12px] font-bold text-white drop-shadow-lg leading-tight line-clamp-2">{place.name}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={() => navigate(`/tourism${activeCat ? `?cat=${activeCat}` : ''}`)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-black tracking-wide transition-all active:scale-[0.97] relative overflow-hidden"
            style={catData ? { background: `linear-gradient(135deg, ${catData.from}, ${catData.to})`, color: '#fff', boxShadow: `0 4px 16px ${catData.glow}` } : { backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff' }}>
            <span>ดูทั้งหมด {filtered.length > 0 ? `(${filtered.length})` : ''}</span>
            <ChevronRight size={15} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* ─────────────── DESKTOP layout ─────────────── */}
      <div className="relative z-10 hidden md:flex gap-0 p-5">

        {/* Left: header + category pills */}
        <div className="w-44 shrink-0 flex flex-col justify-between pr-4">
          <div>
            <p className="text-[9px] font-bold text-white/50 uppercase tracking-widest mb-2 flex items-center gap-1">
              <Compass size={9} /> ค้นพบสถานที่น่าไป
            </p>
            <h2 className="leading-none mb-1">
              <span className="text-2xl font-black drop-shadow-lg"
                    style={{ color: catData?.from ?? '#34d399', textShadow: `0 0 20px ${catData?.glow ?? '#34d39960'}` }}>มา</span>
              <span className="text-2xl font-black text-white drop-shadow-lg">{shortName}</span>
            </h2>
            <p className="text-white/60 text-xs font-bold drop-shadow mb-4">...ต้องไม่พลาด ✦</p>

            {/* Category pills — vertical */}
            <div className="flex flex-col gap-1.5">
              {CATS.map(({ key, label, Icon, from, to, glow }) => {
                const isActive = activeCat === key
                const count = catCount(key)
                return (
                  <button key={key} onClick={() => setActiveCat(isActive ? null : key)}
                          className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl transition-all duration-200"
                          style={isActive
                            ? { background: `linear-gradient(135deg, ${from}dd, ${to}dd)`, boxShadow: `0 4px 12px ${glow}` }
                            : { backgroundColor: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}>
                    <Icon size={14} className="text-white shrink-0" strokeWidth={isActive ? 2 : 1.5} />
                    <span className={`text-xs font-bold flex-1 text-left ${isActive ? 'text-white' : 'text-white/60'}`}>{label}</span>
                    {count > 0 && (
                      <span className="text-[10px] font-bold text-white/70">{count}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <button onClick={() => navigate(`/tourism${activeCat ? `?cat=${activeCat}` : ''}`)}
            className="mt-4 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all"
            style={catData ? { background: `linear-gradient(135deg, ${catData.from}, ${catData.to})`, color: '#fff' } : { backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff' }}>
            ดูทั้งหมด {filtered.length > 0 ? `(${filtered.length})` : ''}
            <ChevronRight size={13} strokeWidth={2.5} />
          </button>
        </div>

        {/* Right: cards — hero wide + 2 subs */}
        <div className="flex-1 min-w-0">
          {filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center py-6">
              <div className="relative flex items-center justify-center rounded-full mb-3 animate-pulse"
                   style={{ width: 80, height: 80,
                            background: `radial-gradient(circle, ${catData?.from ?? '#64748b'}33 0%, transparent 70%)`,
                            border: `1.5px solid ${catData?.from ?? '#64748b'}55`,
                            boxShadow: `0 0 32px ${catData?.glow ?? 'rgba(255,255,255,0.1)'}` }}>
                <span className="text-5xl drop-shadow-lg">{catData?.emoji ?? '🗺️'}</span>
              </div>
              <p className="text-white/70 text-sm font-bold">ยังไม่มีข้อมูลในหมวดนี้</p>
              <p className="text-white/35 text-xs mt-0.5">แอดมินกำลังรวบรวมข้อมูลเพิ่มเติม ✦</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5 h-full">
              {/* Hero — spans 2 rows */}
              {hero && (
                <button onClick={() => navigate(`/tourism/${hero.id}`)}
                        className="relative col-span-2 rounded-2xl overflow-hidden active:scale-[0.98] transition-transform group" style={{ height: 180 }}>
                  {hero.image_url
                    ? <img src={hero.image_url} alt={hero.name} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    : <div className="absolute inset-0 flex items-center justify-center text-5xl" style={{ background: `linear-gradient(135deg, ${catData?.from}aa, ${catData?.to})` }}>{catData?.emoji ?? '🏙️'}</div>}
                  <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-black/10" />
                  <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: `linear-gradient(90deg, ${catData?.from}, ${catData?.to})` }} />
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full backdrop-blur-md" style={{ background: `linear-gradient(135deg, ${catData?.from}cc, ${catData?.to}cc)` }}>
                    <span className="text-[9px] font-black text-white uppercase tracking-wider">✦ แนะนำ</span>
                  </div>
                  <div className="absolute bottom-0 inset-x-0 px-3 py-2.5">
                    <div className="flex items-center gap-1 mb-0.5"><MapPin size={9} className="text-white/60" /><p className="text-[10px] text-white/60">{catData?.label}</p></div>
                    <p className="text-sm font-black text-white drop-shadow-xl leading-tight">{hero.name}</p>
                  </div>
                </button>
              )}
              {/* Subs stacked in 3rd column */}
              <div className="flex flex-col gap-2.5" style={{ height: 180 }}>
                {filtered.slice(1, 3).map((place) => (
                  <button key={place.id} onClick={() => navigate(`/tourism/${place.id}`)}
                          className="relative flex-1 rounded-2xl overflow-hidden active:scale-[0.97] transition-transform group">
                    {place.image_url
                      ? <img src={place.image_url} alt={place.name} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      : <div className="absolute inset-0 flex items-center justify-center text-3xl" style={{ background: `linear-gradient(135deg, ${catData?.from}88, ${catData?.to})` }}>{catData?.emoji ?? '🏙️'}</div>}
                    <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/10 to-transparent" />
                    <p className="absolute bottom-2 left-2.5 right-2.5 text-[11px] font-bold text-white drop-shadow-lg leading-tight line-clamp-2">{place.name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ซ่อนทั้งแถบเมื่อ อปท. ไม่ได้เปิดโมดูล 'tourism' — โมดูลคือแพ็กเกจที่ขายเป็นเรื่องๆ
export default withModule('tourism', TourismSection)
