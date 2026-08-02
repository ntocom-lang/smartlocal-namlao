import { useState, useRef, useEffect } from 'react';
import { Send, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../contexts/TenantContext';
import { askGemini } from '../lib/geminiChat';

export default function ChatbotPage() {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const [messages, setMessages] = useState([
    { id: 1, sender: 'bot', text: `สวัสดีครับ... วันนี้มีอะไรให้ช่วยครับ ถามมาได้เลย น้ำเลาใจดี ยินดีให้บริการครับ 🤖` }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');
    setMessages(prev => [...prev, { id: Date.now(), sender: 'user', text: userText }]);
    setIsLoading(true);

    try {
      const replyText = await askGemini(messages, userText, tenant?.name, tenant?.id);
      setMessages(prev => [...prev, { id: Date.now(), sender: 'bot', text: replyText }]);
    } catch (error) {
      console.error('Error calling Gemini:', error);
      
      let reply = 'ตอนนี้ระบบเชื่อมต่อ AI ขัดข้องชั่วคราว น้ำเลาใจดีขอตอบแบบจำลองให้นะครับ: ';
      
      const text = userText.toLowerCase();
      if (text.includes('สวัสดี') || text.includes('ทักทาย') || text.includes('ดีจ้า') || text.includes('หวัดดี')) {
        reply += 'สวัสดีครับ! มีอะไรให้น้ำเลาใจดีดูแลและช่วยเหลือไหมครับ? 🤖';
      } else if (text.includes('ขยะ') || text.includes('ทิ้งขยะ') || text.includes('เก็บขยะ') || text.includes('ถังขยะ')) {
        reply += 'เรื่องขยะ แจ้งได้เลยครับ! สามารถไปที่เมนู "แจ้งเรื่องร้องเรียน" แล้วเลือกหมวดหมู่ "ขยะ / ความสะอาด" ได้เลยนะครับ 🤖';
      } else if (text.includes('เอกสาร') || text.includes('ทะเบียน') || text.includes('ใบอนุญาต')) {
        reply += 'คุณสามารถยื่นขอเอกสารต่างๆ หรือ E-Service ได้ที่หน้าแรก ตรงเมนู "E-Service" ครับ สะดวกและรวดเร็วมากๆ 🤖';
      } else if (text.includes('อากาศ') || text.includes('ฝน') || text.includes('พยากรณ์')) {
        reply += 'อยากทราบสภาพอากาศ สามารถกดดูได้ที่แบนเนอร์ "รายงานพยากรณ์อากาศ" ที่หน้าแรกได้เลยนะครับ 🤖';
      } else if (text.includes('ร้องเรียน') || text.includes('ร้องทุกข์') || text.includes('ปัญหา') || text.includes('เดือดร้อน')) {
        reply += 'พบเจอปัญหาเดือดร้อน แจ้งเราได้ทันทีครับ! กดที่ปุ่ม "ร้องเรียน/ร้องทุกข์" บนหน้าแรก เจ้าหน้าที่จะรับเรื่องและแก้ไขให้ไวที่สุดครับ 🤖';
      } else if (text.includes('ขอบคุณ') || text.includes('ขอบใจ')) {
        reply += 'ยินดีให้บริการเสมอครับ! ถ้านึกถึงความช่วยเหลือ นึกถึงน้ำเลาใจดีนะครับ 🤖';
      } else if (text.includes('เที่ยว') || text.includes('ที่พัก') || text.includes('ร้านอาหาร')) {
        reply += 'แหล่งท่องเที่ยว ที่พัก และร้านอาหารเด็ดๆ ดูได้ที่หมวด "เที่ยว กิน พัก OTOP" หน้าแรกเลยครับ แนะนำเพียบ! 🤖';
      } else {
        reply = 'ขออภัยครับ ระบบ AI ไม่พร้อมใช้งานชั่วคราว ลองใหม่อีกครั้งในภายหลังนะครับ 🤖';
      }

      setMessages(prev => [...prev, { id: Date.now(), sender: 'bot', text: reply }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-blue-50/50 relative overflow-hidden flex-1 pb-16 md:pb-2">
      {/* Header */}
      <div className="bg-blue-600 text-white p-3.5 shadow-md flex items-center gap-3 relative z-10 rounded-b-2xl shrink-0">
        <button onClick={() => navigate(-1)} className="p-1 hover:bg-white/20 rounded-full transition-colors">
          <ArrowLeft size={22} />
        </button>
        <div className="flex items-center gap-3">
          <img
            src="/images/nong-jaidee.png"
            alt="น้ำเลาใจดี"
            className="w-9 h-9 rounded-full object-cover border-2 border-yellow-400 bg-white p-0.5"
            onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }}
          />
          <div className="w-9 h-9 bg-white rounded-full hidden items-center justify-center shadow-sm text-xl border-2 border-yellow-400">
            🤖
          </div>
          <div>
            <h1 className="font-bold text-base leading-tight">น้ำเลาใจดี ยินดีให้บริการ</h1>
            <p className="text-[11px] text-blue-100">{tenant?.name || 'เทศบาล/อบต.'}</p>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 relative z-0">
        {/* Background Mascot Watermark */}
        <div className="fixed inset-0 pointer-events-none flex items-center justify-center opacity-[0.07]">
          <img src="/images/nong-jaidee.png" alt="น้ำเลาใจดี" className="w-56 h-56 object-contain pointer-events-none" />
        </div>

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} relative z-10`}>
            {msg.sender === 'bot' && (
              <img
                src="/images/nong-jaidee.png"
                alt="น้ำเลาใจดี"
                className="w-7 h-7 rounded-full object-cover mr-2 shrink-0 border border-yellow-400 bg-white p-0.5 shadow-xs"
                onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }}
              />
            )}
            {msg.sender === 'bot' && (
              <div className="w-7 h-7 rounded-full bg-white hidden items-center justify-center shadow-xs mr-2 shrink-0 border border-yellow-400 text-base">
                🤖
              </div>
            )}
            <div className={`max-w-[78%] p-3 shadow-xs ${msg.sender === 'user' ? 'bg-emerald-500 text-white rounded-2xl rounded-tr-xs' : 'bg-white text-gray-800 rounded-2xl rounded-tl-xs border border-gray-100'}`}>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start relative z-10">
            <img
              src="/images/nong-jaidee.png"
              alt="น้ำเลาใจดี"
              className="w-7 h-7 rounded-full object-cover mr-2 shrink-0 border border-yellow-400 bg-white p-0.5 shadow-xs"
              onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }}
            />
            <div className="w-7 h-7 rounded-full bg-white hidden items-center justify-center shadow-xs mr-2 shrink-0 border border-yellow-400 text-base">
              🤖
            </div>
            <div className="bg-white p-3.5 rounded-2xl rounded-tl-xs border border-gray-100 shadow-xs flex items-center gap-1">
              <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area anchored right above bottom nav */}
      <div className="shrink-0 px-3 py-2 z-20">
        <form onSubmit={handleSend} className="flex gap-2 bg-white p-1.5 rounded-full shadow-lg border border-blue-200 relative max-w-xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="พิมพ์ข้อความที่นี่..."
            className="flex-1 bg-transparent px-4 py-1.5 outline-none text-gray-700 text-sm placeholder-gray-400"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="w-9 h-9 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-full flex items-center justify-center transition-colors shadow-sm shrink-0"
          >
            <Send size={17} className="ml-0.5" />
          </button>
        </form>
      </div>
    </div>
  );
}
