import React, { useState, useRef, useEffect } from 'react';
import { Send, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '../contexts/TenantContext';
import { askGemini } from '../lib/geminiChat';

export default function ChatbotPage() {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const [messages, setMessages] = useState([
    { id: 1, sender: 'bot', text: `สวัสดีค่ะ... วันนี้มีอะไรให้ช่วยคะ ถามมาได้เลย น้องสมายล์ ยินดีให้บริการค่ะ 🦖` }
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
      const replyText = await askGemini(messages, userText, tenant?.name);
      setMessages(prev => [...prev, { id: Date.now(), sender: 'bot', text: replyText }]);
    } catch (error) {
      console.error('Error calling Gemini:', error);
      
      // กรณีคีย์ยังไม่พร้อมใช้งานหรือเกิดข้อผิดพลาด ให้ใช้วิธีจำลองระบบเดิมเพื่อความปลอดภัย
      let reply = 'ตอนนี้น้องสมายล์กำลังปรับปรุงระบบการเชื่อมต่อ AI ขอจำลองคำตอบให้ชั่วคราวนะคะ: ';
      
      const text = userText.toLowerCase();
      if (text.includes('สวัสดี') || text.includes('ทักทาย') || text.includes('ดีจ้า') || text.includes('หวัดดี')) {
        reply += 'สวัสดีค่ะ! มีอะไรให้น้องสมายล์ดูแลและช่วยเหลือไหมคะ? 🦖';
      } else if (text.includes('ขยะ') || text.includes('ทิ้งขยะ') || text.includes('เก็บขยะ') || text.includes('ถังขยะ')) {
        reply += 'เรื่องขยะ แจ้งได้เลยค่ะ! สามารถไปที่เมนู "แจ้งเรื่องร้องเรียน" แล้วเลือกหมวดหมู่ "ขยะ / ความสะอาด" ได้เลยนะคะ 🦖';
      } else if (text.includes('เอกสาร') || text.includes('ทะเบียน') || text.includes('ใบอนุญาต')) {
        reply += 'คุณสามารถยื่นขอเอกสารต่างๆ หรือ E-Service ได้ที่หน้าแรก ตรงเมนู "E-Service" ค่ะ สะดวกและรวดเร็วมากๆ 🦖';
      } else if (text.includes('อากาศ') || text.includes('ฝน') || text.includes('พยากรณ์')) {
        reply += 'อยากทราบสภาพอากาศ สามารถกดดูได้ที่แบนเนอร์ "รายงานพยากรณ์อากาศ" ที่หน้าแรกได้เลยนะคะ 🦖';
      } else if (text.includes('ร้องเรียน') || text.includes('ร้องทุกข์') || text.includes('ปัญหา') || text.includes('เดือดร้อน')) {
        reply += 'พบเจอปัญหาเดือดร้อน แจ้งเราได้ทันทีค่ะ! กดที่ปุ่ม "ร้องเรียน/ร้องทุกข์" บนหน้าแรก เจ้าหน้าที่จะรับเรื่องและแก้ไขให้ไวที่สุดค่ะ 🦖';
      } else if (text.includes('ขอบคุณ') || text.includes('ขอบใจ')) {
        reply += 'ยินดีให้บริการเสมอค่ะ! ถ้านึกถึงความช่วยเหลือ นึกถึงน้องสมายล์นะคะ 🦖';
      } else if (text.includes('เที่ยว') || text.includes('ที่พัก') || text.includes('ร้านอาหาร')) {
        reply += 'แหล่งท่องเที่ยว ที่พัก และร้านอาหารเด็ดๆ ดูได้ที่หมวด "เที่ยว กิน พัก OTOP" หน้าแรกเลยค่ะ แนะนำเพียบ! 🦖';
      } else {
        reply = 'ขออภัยค่ะ ระบบ AI ไม่พร้อมใช้งานชั่วคราว ลองใหม่อีกครั้งในภายหลังนะคะ 🦖';
      }

      setMessages(prev => [...prev, { id: Date.now(), sender: 'bot', text: reply }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-blue-50/50 min-h-screen relative" style={{ paddingBottom: '70px' }}>
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 shadow-md flex items-center gap-3 relative z-10 rounded-b-3xl">
        <button onClick={() => navigate(-1)} className="p-1 hover:bg-white/20 rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm text-2xl border-2 border-yellow-400">
            🦖
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">น้องสมายล์ ยินดีให้บริการ</h1>
            <p className="text-xs text-blue-100">{tenant?.name || 'เทศบาล/อบต.'}</p>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 relative z-0">
        {/* Background Mascot Watermark */}
        <div className="fixed inset-0 pointer-events-none flex items-center justify-center opacity-5">
           <span className="text-[200px]">🦖</span>
        </div>

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} relative z-10`}>
            {msg.sender === 'bot' && (
              <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm mr-2 shrink-0 border border-yellow-400 text-lg">
                🦖
              </div>
            )}
            <div className={`max-w-[75%] p-3 shadow-sm ${msg.sender === 'user' ? 'bg-emerald-500 text-white rounded-2xl rounded-tr-sm' : 'bg-white text-gray-800 rounded-2xl rounded-tl-sm border border-gray-100'}`}>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start relative z-10">
             <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm mr-2 shrink-0 border border-yellow-400 text-lg">
                🦖
              </div>
            <div className="bg-white p-4 rounded-2xl rounded-tl-sm border border-gray-100 shadow-sm flex items-center gap-1">
              <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="fixed bottom-16 md:bottom-[70px] left-0 right-0 bg-transparent px-4 py-2 z-20">
        <form onSubmit={handleSend} className="flex gap-2 bg-white p-1.5 rounded-full shadow-lg border border-blue-100 relative max-w-md mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="พิมพ์ข้อความที่นี่..."
            className="flex-1 bg-transparent px-4 py-2 outline-none text-gray-700 text-sm placeholder-gray-400"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="w-10 h-10 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-full flex items-center justify-center transition-colors shadow-sm shrink-0"
          >
            <Send size={18} className="ml-1" />
          </button>
        </form>
      </div>
    </div>
  );
}
