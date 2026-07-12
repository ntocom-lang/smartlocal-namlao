import { Link } from 'react-router-dom'
import { useTenant } from '../../../../contexts/TenantContext'
import WeatherWidget from '../../../../components/home/WeatherWidget'
import PostsHighlight from '../../../../components/home/PostsHighlight'
import { Megaphone, ChevronRight, Map, Utensils, Bed, ShoppingBag, Eye, HelpCircle, Droplets, MapPin, Trash2, Lightbulb } from 'lucide-react'

export default function Home() {
  const { tenant } = useTenant()

  return (
    <div className="bg-[#f4f7fb] min-h-screen pb-28 font-sans">
      {/* Wave transition from header */}
      <div className="w-full h-12" style={{ background: 'linear-gradient(180deg, #004080 0%, transparent 100%)' }}></div>

      {/* Services Dropdown styled section */}
      <div className="px-4 -mt-10 relative z-20 max-w-6xl mx-auto">
        <h2 className="text-[17px] font-black text-blue-900 mb-3 px-2 drop-shadow-sm">บริการยอดนิยม</h2>
        
        <div className="flex justify-between items-center bg-blue-900/10 backdrop-blur-sm rounded-3xl p-4 shadow-inner overflow-x-auto gap-4 hide-scrollbar border border-blue-200/50">
          {[
            { label: 'ร้องเรียน\nร้องทุกข์', icon: <HelpCircle size={28} className="text-pink-500" /> },
            { label: 'สถานที่\nออกกำลังกาย', icon: <span className="text-3xl drop-shadow-sm">🏃</span> },
            { label: 'ชำระ\nค่าเก็บขยะ', icon: <Trash2 size={28} className="text-red-500" /> },
            { label: 'ชำระภาษี', icon: <span className="text-3xl drop-shadow-sm">💰</span> },
          ].map((srv, i) => (
            <Link to="/complaint" key={i} className="flex flex-col items-center shrink-0 w-[72px] group">
              <div className="w-[60px] h-[60px] flex items-center justify-center shadow-lg relative bg-gradient-to-br from-white to-blue-50 transition-transform group-active:scale-95"
                   style={{
                     borderRadius: '50% 50% 50% 0',
                     transform: 'rotate(-45deg)',
                     border: '2px solid #7dd3fc',
                     boxShadow: '0 4px 15px rgba(2, 132, 199, 0.2)'
                   }}>
                <div style={{ transform: 'rotate(45deg)' }}>
                  {srv.icon}
                </div>
              </div>
              <span className="text-[11px] font-bold text-blue-950 mt-3 text-center whitespace-pre-line leading-tight">
                {srv.label}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Recommended for you */}
      <div className="px-4 mt-8 max-w-6xl mx-auto">
        <h2 className="text-[17px] font-black text-blue-900 mb-3 px-2">แนะนำสำหรับคุณ</h2>
        <div className="grid grid-cols-2 gap-3">
           <div className="rounded-2xl overflow-hidden shadow-sm relative h-32 bg-blue-50 border border-blue-100/50">
             <div className="absolute top-0 left-0 bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-br-lg z-10 shadow-sm">รายงานพยากรณ์อากาศ</div>
             <div className="absolute inset-0 pt-4 scale-[0.85] origin-top">
               <WeatherWidget />
             </div>
           </div>
           <div className="rounded-2xl overflow-hidden shadow-sm relative h-32 border border-gray-100">
             <img src="https://images.unsplash.com/photo-1576091160550-2173ff9e5ee5?auto=format&fit=crop&w=400&q=80" alt="Health" className="w-full h-full object-cover" />
             <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent flex items-end p-3">
               <p className="text-white text-xs font-bold leading-snug drop-shadow-md">กองทุน<br/>หลักประกันสุขภาพ<br/>{tenant?.name}</p>
             </div>
           </div>
           <div className="rounded-2xl overflow-hidden shadow-sm relative h-32 col-span-2 border border-gray-100">
             <img src="https://images.unsplash.com/photo-1516302752625-fcc3c50ae61f?auto=format&fit=crop&w=800&q=80" alt="Elderly" className="w-full h-full object-cover" />
             <div className="absolute inset-0 bg-gradient-to-r from-blue-900/60 to-transparent flex items-center p-4">
               <div className="bg-[#0ea5e9] text-white p-3 rounded-full font-black text-sm text-center shadow-xl w-[100px] h-[100px] flex items-center justify-center border-4 border-white/20">
                 ลงทะเบียน<br/>รับเบี้ย<br/>ผู้สูงอายุ
               </div>
             </div>
           </div>
        </div>
      </div>

      {/* Complaints Grid */}
      <div className="px-4 mt-10 max-w-6xl mx-auto">
        <div className="bg-white rounded-[24px] shadow-sm border border-gray-100 p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-14 bg-gradient-to-b from-[#f0f9ff] to-transparent rounded-t-[24px]"></div>
          
          <div className="relative z-10 flex justify-between items-start mb-5">
            <h2 className="text-[17px] font-black text-[#1e3a8a] leading-tight">แจ้งเรื่องร้องเรียน<br/>/ร้องทุกข์</h2>
            <Link to="/complaint" className="bg-yellow-400 text-yellow-900 text-[11px] font-black px-4 py-1.5 rounded-full shadow-sm hover:bg-yellow-300 transition-colors">
              ดูทั้งหมด
            </Link>
          </div>
          
          <div className="grid grid-cols-3 gap-3 relative z-10">
            {[
              { label: 'ไฟฟ้าสาธารณะ', icon: <Lightbulb size={32} className="text-[#0284c7]" strokeWidth={1.5} />, bg: 'from-blue-50 to-blue-100' },
              { label: 'ท่อระบายน้ำ', icon: <Droplets size={32} className="text-[#059669]" strokeWidth={1.5} />, bg: 'from-green-50 to-green-100' },
              { label: 'ถนน/ทางเท้า', icon: <MapPin size={32} className="text-[#0284c7]" strokeWidth={1.5} />, bg: 'from-blue-50 to-blue-100' },
              { label: 'น้ำเสีย', icon: <Droplets size={32} className="text-[#0284c7]" strokeWidth={1.5} />, bg: 'from-blue-50 to-blue-100' },
              { label: 'ดูดสิ่งปฏิกูล', icon: <Trash2 size={32} className="text-[#059669]" strokeWidth={1.5} />, bg: 'from-green-50 to-green-100' },
              { label: 'ขอถังขยะ/แจ้งเก็บ', icon: <Trash2 size={32} className="text-[#0ea5e9]" strokeWidth={1.5} />, bg: 'from-sky-50 to-sky-100' },
            ].map((item, i) => (
              <Link to={`/complaint?type=${i}`} key={i} className="flex flex-col items-center group">
                <div className="w-full aspect-square rounded-2xl bg-white shadow-sm border border-gray-100 flex flex-col items-center justify-center gap-2 transition-transform group-active:scale-95 p-1.5">
                  <div className={`w-full h-full bg-gradient-to-b ${item.bg} rounded-xl flex items-center justify-center shadow-inner`}>
                    {item.icon}
                  </div>
                </div>
                <span className="text-[11px] font-bold text-gray-700 mt-2 text-center leading-tight">{item.label}</span>
              </Link>
            ))}
          </div>

          <div className="mt-5 relative overflow-hidden rounded-l-md rounded-r-full inline-block">
             <Link to="/my-complaints" className="block bg-[#38bdf8] hover:bg-[#0284c7] transition-colors text-white text-xs font-bold px-5 py-2.5 shadow-md relative z-10">
               ติดตามเรื่องร้องเรียน &gt;
             </Link>
          </div>
          
          <div className="mt-6 pt-4 border-t border-blue-50">
             <h3 className="text-sm font-bold text-blue-900">บรรเทาความเดือดร้อนล่าสุด</h3>
             {/* Can embed recent resolved complaints here in future */}
          </div>
        </div>
      </div>

      {/* Local Products & Tourism */}
      <div className="mt-10 relative">
        <div className="bg-gradient-to-b from-[#e0f2fe] to-transparent pt-6 pb-6 px-4">
          <div className="text-center mb-5">
            <h2 className="text-2xl font-black text-[#0284c7] drop-shadow-sm">ชาวบ้านฝากขาย</h2>
            <p className="text-sm font-black text-blue-900 mt-0.5">{tenant?.name}</p>
          </div>
          
          <div className="bg-white/60 backdrop-blur-md rounded-[24px] p-3 shadow-sm border border-white flex gap-4 overflow-x-auto hide-scrollbar">
            <div className="shrink-0 w-44 rounded-[20px] overflow-hidden shadow-sm border border-gray-100 relative bg-white pb-2">
              <img src="https://images.unsplash.com/photo-1610832958506-aa56368176cf?auto=format&fit=crop&w=400&q=80" alt="Fruit" className="w-full h-28 object-cover rounded-t-[20px]" />
              <div className="p-3">
                <h3 className="font-bold text-gray-800 text-sm">ผลไม้สด</h3>
                <p className="text-[10px] text-gray-500 mt-1">ผลไม้ส่งตรงจากสวน</p>
                <div className="flex items-center gap-1.5 mt-2.5 text-[10px] font-medium text-gray-400">
                  <MapPin size={12} className="text-[#0284c7]" /> บ้านพร้อมชัย
                </div>
                <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-gray-400">
                  <Eye size={12} /> 91
                </div>
              </div>
            </div>
            {/* Add more mockup cards if desired */}
            <div className="shrink-0 w-44 rounded-[20px] overflow-hidden shadow-sm border border-gray-100 relative bg-white pb-2 flex items-center justify-center">
              <span className="text-sm font-bold text-gray-400">ดูสินค้าเพิ่มเติม &gt;</span>
            </div>
          </div>
          
          <div className="flex justify-center gap-3 mt-5">
            <button className="bg-[#3b82f6] text-white text-xs font-bold px-5 py-2.5 rounded-full shadow-md hover:bg-blue-600 transition-colors">สมัครขายสินค้า &gt;</button>
            <button className="bg-[#1e3a8a] text-white text-xs font-bold px-5 py-2.5 rounded-full shadow-md hover:bg-blue-900 transition-colors">ดูทั้งหมด &gt;</button>
          </div>
        </div>
      </div>

      {/* Tour tabs */}
      <div className="mt-8 px-4 max-w-6xl mx-auto relative">
        <div className="relative rounded-[24px] overflow-hidden shadow-sm h-48">
           <img src="https://images.unsplash.com/photo-1542259009477-d625272157b7?auto=format&fit=crop&w=1000&q=80" alt="Tour banner" className="w-full h-full object-cover" />
           <div className="absolute inset-0 bg-black/10"></div>
           <div className="absolute top-4 right-4 bg-black/40 backdrop-blur-sm text-white text-[10px] px-3 py-1.5 rounded-full flex items-center gap-1 font-medium">
             พยากรณ์อากาศ <ChevronRight size={12} />
           </div>
        </div>
        
        <div className="bg-white rounded-2xl shadow-xl -mt-10 mx-3 flex justify-between p-2 relative z-10 border border-gray-100">
          {[
            { label: 'เที่ยว', icon: <Map size={24} strokeWidth={2} />, active: true },
            { label: 'กิน', icon: <Utensils size={24} strokeWidth={2} /> },
            { label: 'พัก', icon: <Bed size={24} strokeWidth={2} /> },
            { label: 'OTOP', icon: <ShoppingBag size={24} strokeWidth={2} /> },
          ].map((tab, i) => (
            <button key={i} className={`flex flex-col items-center p-2.5 flex-1 rounded-xl transition-all ${tab.active ? 'bg-[#e11d48] text-white shadow-lg transform -translate-y-6 relative' : 'text-gray-700 hover:bg-gray-50'}`}>
              {tab.active && (
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#e11d48] rotate-45"></div>
              )}
              {tab.icon}
              <span className="text-xs font-bold mt-1.5">{tab.label}</span>
            </button>
          ))}
        </div>
        
        <div className="grid grid-cols-2 gap-3 mt-5">
          <div className="rounded-[20px] overflow-hidden shadow-sm bg-white pb-3 border border-gray-100">
            <img src="https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80" alt="Place" className="w-full h-28 object-cover" />
            <p className="text-[13px] font-bold text-gray-800 px-3 pt-3 truncate">หาดทรายแก้ว</p>
          </div>
          <div className="rounded-[20px] overflow-hidden shadow-sm bg-white pb-3 border border-gray-100">
            <img src="https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?auto=format&fit=crop&w=400&q=80" alt="Place" className="w-full h-28 object-cover" />
            <p className="text-[13px] font-bold text-gray-800 px-3 pt-3 truncate">สวนนงนุชพัทยา</p>
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button className="bg-yellow-400 text-yellow-900 text-[11px] font-black px-5 py-2 rounded-full shadow-sm hover:bg-yellow-300 transition-colors">ดูทั้งหมด</button>
        </div>
      </div>

      {/* Today section */}
      <div className="mt-12 bg-gradient-to-b from-[#e0f2fe] to-[#bae6fd] pt-8 pb-10 rounded-t-[40px] border-t-4 border-white relative shadow-[0_-10px_30px_rgba(2,132,199,0.1)]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#38bdf8] text-white px-8 py-2 rounded-full font-black text-lg shadow-lg border-2 border-white">
          {tenant?.name}วันนี้
        </div>
        
        <div className="px-4 max-w-6xl mx-auto mt-4">
          <div className="bg-[#fef3c7] rounded-r-full rounded-l-full shadow-sm border border-yellow-200 flex items-center p-1.5 mb-6">
             <div className="bg-[#e11d48] text-white w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-md">
               <Megaphone size={18} />
             </div>
             <p className="flex-1 text-center font-bold text-gray-800 text-[15px] pr-4">"ยินดีต้อนรับ"</p>
          </div>
          
          <PostsHighlight hideHeader={true} />
        </div>
      </div>
    </div>
  )
}
