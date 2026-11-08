import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bot, Check, Copy, ExternalLink, Loader2, MessageSquarePlus, Send, Settings, Sparkles, Trash2 } from 'lucide-react'
import {
  countToday, deleteConversation, loadConversations, loadMessages, loadSettings, saveSettings, sendAdvisorMessage,
} from '../../lib/advisorApi'
import {
  ADVISOR_DAILY_CAP_MAX, ADVISOR_DAILY_CAP_MIN, ADVISOR_MESSAGE_MAX, conversationToText, newConversationId, validateAdvisorSettings,
} from '../../lib/advisorHelpers'
import { thaiDateTimeText } from '../../lib/thaiDate'

// ที่ปรึกษา AI (Gemini) — เฉพาะ Super Admin (เจ้าของระบบอนุมัติ 2569-11-08)
// ด่านที่ 1 ซ่อนเมนูใน AdminDashboard · ด่านที่ 2 ตรวจ role ตรงนี้ · ด่านที่ 3 RLS + Edge Function ฝั่งเซิร์ฟเวอร์
// ข้อความทั้งหมดแสดงเป็น text ธรรมดา (whitespace-pre-wrap) ไม่ render HTML/markdown — กัน XSS จากคำตอบของโมเดล

const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100'

function shortDateTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function SuperAdminAdvisor({ currentUserRole }) {
  if (currentUserRole !== 'superadmin') {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-sm text-gray-500">
        เมนูนี้ใช้ได้เฉพาะ Super Admin
      </div>
    )
  }
  return <AdvisorBody />
}

function AdvisorBody() {
  const [tab, setTab] = useState('chat')
  const [settings, setSettings] = useState(null)
  const [settingsError, setSettingsError] = useState('')
  const [usedToday, setUsedToday] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadSettings()
      .then(s => {
        if (cancelled) return
        if (s) setSettings(s)
        else setSettingsError('ไม่พบแถวตั้งค่า (ต้องรัน migration ก่อน)')
      })
      .catch(e => { if (!cancelled) setSettingsError(e.message) })
    countToday().then(n => { if (!cancelled) setUsedToday(n) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2">
          <Sparkles size={20} className="text-violet-600 shrink-0" />
          <h2 className="text-base font-bold text-gray-800">ที่ปรึกษา AI (Gemini)</h2>
        </div>
        <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p>Gemini แบบไม่เสียเงิน — Google นำข้อความไปพัฒนาผลิตภัณฑ์ได้ ห้ามพิมพ์/วางข้อมูลส่วนบุคคลของประชาชน ระบบปิดบังเลขบัตรและเบอร์โทรให้อีกชั้น</p>
            <p className="mt-1">คำตอบเรื่องกฎหมาย/ระเบียบต้องตรวจตัวบทเองก่อนใช้ทุกครั้ง</p>
          </div>
        </div>
        <div className="mt-3 flex gap-1 rounded-xl bg-slate-100 p-1">
          {[['chat', 'ปรึกษา', Bot], ['settings', 'ตั้งค่า', Settings]].map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${tab === key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'chat'
        ? <ChatTab settings={settings} usedToday={usedToday} setUsedToday={setUsedToday} setSettings={setSettings} />
        : <SettingsTab settings={settings} error={settingsError} onSaved={setSettings} />}
    </div>
  )
}

function ChatTab({ settings, usedToday, setUsedToday, setSettings }) {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(() => newConversationId())
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [maskedNotice, setMaskedNotice] = useState(0)
  const [copiedKey, setCopiedKey] = useState('')
  const [claudeNotice, setClaudeNotice] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const scrollRef = useRef(null)
  const openToken = useRef(0)
  // เก็บ activeId ล่าสุดไว้ให้ send() อ่านหลัง await (closure ของ send ถือค่าเก่า)
  const activeIdRef = useRef(activeId)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])

  const refreshList = useCallback(async () => {
    try { setConversations(await loadConversations()) } catch (e) { setError(e.message) }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadConversations()
      .then(list => { if (!cancelled) setConversations(list) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoadingList(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  const dailyCap = settings?.daily_cap ?? null
  const disabledByAdmin = settings && settings.enabled === false
  const isKnown = conversations.some(c => c.id === activeId)

  async function openConversation(id) {
    if (!id || id === activeId || sending) return
    const token = ++openToken.current
    setActiveId(id); setMessages([]); setError(''); setMaskedNotice(0); setClaudeNotice('')
    try {
      const rows = await loadMessages(id)
      if (token === openToken.current) setMessages(rows)
    } catch (e) {
      if (token === openToken.current) setError(e.message)
    }
  }

  function startNew() {
    if (sending) return
    openToken.current++
    setActiveId(newConversationId()); setMessages([]); setInput(''); setError(''); setMaskedNotice(0); setClaudeNotice('')
  }

  async function removeConversation() {
    if (!isKnown || sending) return
    if (!window.confirm('ลบบทสนทนานี้ถาวร? กู้คืนไม่ได้')) return
    try {
      await deleteConversation(activeId)
      startNew()
      await refreshList()
      countToday().then(setUsedToday).catch(() => {})
    } catch (e) { setError(e.message) }
  }

  async function send() {
    const text = input.trim()
    if (!text || sending || disabledByAdmin) return
    if (text.length > ADVISOR_MESSAGE_MAX) { setError(`ข้อความยาวเกิน ${ADVISOR_MESSAGE_MAX} ตัวอักษร`); return }
    const sentId = activeId
    const optimistic = { id: `tmp-${Date.now()}`, role: 'user', content: text }
    setMessages(prev => [...prev, optimistic])
    setInput(''); setError(''); setMaskedNotice(0); setClaudeNotice(''); setSending(true)
    try {
      const res = await sendAdvisorMessage({ conversationId: sentId, message: text })
      // ถ้าระหว่างรอผู้ใช้ย้ายไปเรื่องอื่น ไม่ยัดคำตอบเข้าหน้าผิดเรื่อง (ข้อมูลถูกบันทึกฝั่งเซิร์ฟเวอร์แล้ว)
      setMessages(prev => sentId === activeIdRef.current
        ? [...prev, { id: `ai-${Date.now()}`, role: 'model', content: res.reply }]
        : prev)
      setMaskedNotice(Number(res.masked) || 0)
      if (Number.isFinite(res.used_today)) setUsedToday(res.used_today)
      if (Number.isFinite(res.daily_cap) && settings && res.daily_cap !== settings.daily_cap) {
        setSettings({ ...settings, daily_cap: res.daily_cap })
      }
      refreshList()
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id))
      setInput(text)
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  async function copyText(text, key) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(k => (k === key ? '' : k)), 1500)
    } catch {
      setError('คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาตให้เข้าถึงคลิปบอร์ด')
    }
  }

  async function askClaude() {
    if (!messages.length) return
    // เปิดแท็บก่อน await เพราะเบราว์เซอร์มือถือบล็อก window.open ที่เรียกหลังรอ clipboard
    window.open('https://claude.ai/new', '_blank', 'noopener')
    try {
      await navigator.clipboard.writeText(conversationToText(messages))
      setClaudeNotice('คัดลอกแล้ว วางในช่องแชตของ Claude ได้เลย')
    } catch {
      setError('คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาตให้เข้าถึงคลิปบอร์ด')
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  const listButton = (c) => (
    <button key={c.id} type="button" onClick={() => openConversation(c.id)}
      className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${c.id === activeId ? 'bg-blue-50 border border-blue-200' : 'border border-transparent hover:bg-slate-50'}`}>
      <p className="truncate text-sm font-semibold text-slate-800">{c.title}</p>
      <p className="text-[12px] text-slate-400">{shortDateTime(c.lastAt)} · {c.count} ข้อความ</p>
    </button>
  )

  return (
    <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
      {/* รายการบทสนทนา: มือถือเป็น dropdown, เดสก์ท็อปเป็นรายการด้านซ้าย */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-2 min-w-0 self-start">
        <div className="flex gap-2">
          <button type="button" onClick={startNew} disabled={sending}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            <MessageSquarePlus size={15} /> เรื่องใหม่
          </button>
          <button type="button" onClick={removeConversation} disabled={!isKnown || sending} aria-label="ลบเรื่องนี้"
            className="inline-flex items-center justify-center rounded-xl border border-red-200 px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-40">
            <Trash2 size={15} />
          </button>
        </div>
        <select className={`${inputCls} md:hidden`} value={isKnown ? activeId : ''} onChange={e => openConversation(e.target.value)} disabled={sending}>
          <option value="">{isKnown ? 'เลือกเรื่องที่เคยคุย' : 'เรื่องใหม่ (ยังไม่ได้ส่ง)'}</option>
          {conversations.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <div className="hidden md:block max-h-[60vh] overflow-y-auto space-y-1">
          {loadingList ? (
            <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-gray-400" /></div>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-3 text-[13px] text-slate-400">ยังไม่มีบทสนทนา</p>
          ) : conversations.map(listButton)}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-3 min-w-0 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-slate-500">
          <span>ใช้วันนี้ {usedToday ?? '-'}/{dailyCap ?? '-'} ครั้ง</span>
          <button type="button" onClick={askClaude} disabled={!messages.length}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            <ExternalLink size={13} /> ถามต่อที่ Claude
          </button>
        </div>
        {disabledByAdmin && (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-[13px] text-slate-600">ที่ปรึกษา AI ปิดใช้งานอยู่ — เปิดได้ที่แท็บ "ตั้งค่า"</p>
        )}

        <div ref={scrollRef} className="h-[50vh] min-h-[260px] overflow-y-auto space-y-3 rounded-xl bg-slate-50 p-3">
          {messages.length === 0 && !sending && (
            <p className="py-10 text-center text-sm text-slate-400">เริ่มถามได้เลย — เช่น ให้ช่วยร่างแนวคิด วิเคราะห์ข้อดีข้อเสีย หรืออธิบายเรื่องเทคนิค</p>
          )}
          {messages.map(m => {
            const mine = m.role === 'user'
            const key = String(m.id)
            return (
              <div key={key} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[92%] md:max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${mine ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-800'}`}>
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.content}</p>
                  {!mine && (
                    <button type="button" onClick={() => copyText(m.content, key)}
                      className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500 hover:text-blue-600">
                      {copiedKey === key ? <><Check size={12} /> คัดลอกแล้ว</> : <><Copy size={12} /> คัดลอก</>}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {sending && (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-500">
                <Loader2 size={15} className="animate-spin" /> กำลังคิด...
              </div>
            </div>
          )}
        </div>

        {maskedNotice > 0 && (
          <p className="text-[13px] text-amber-700">ปิดบังข้อมูลส่วนบุคคล {maskedNotice} จุดก่อนส่ง</p>
        )}
        {claudeNotice && <p className="text-[13px] text-green-700">{claudeNotice}</p>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700" role="alert">{error}</p>}

        <div className="space-y-1.5">
          <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKeyDown}
            rows={3} maxLength={ADVISOR_MESSAGE_MAX} disabled={sending || disabledByAdmin}
            placeholder="พิมพ์คำถาม (Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่)"
            className={`${inputCls} resize-y`} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-slate-400">{input.length.toLocaleString('th-TH')}/{ADVISOR_MESSAGE_MAX.toLocaleString('th-TH')}</span>
            <button type="button" onClick={send} disabled={sending || disabledByAdmin || !input.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} ส่ง
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsTab({ settings, error, onSaved }) {
  if (error) return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>
  if (!settings) return <div className="flex justify-center py-10"><Loader2 size={24} className="animate-spin text-gray-400" /></div>
  return <SettingsForm settings={settings} onSaved={onSaved} />
}

function SettingsForm({ settings, onSaved }) {
  const [form, setForm] = useState(() => ({ enabled: settings.enabled, model: settings.model, daily_cap: String(settings.daily_cap) }))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })

  async function save(e) {
    e.preventDefault()
    const problem = validateAdvisorSettings(form)
    if (problem) { setMsg({ type: 'error', text: problem }); return }
    setSaving(true); setMsg({ type: '', text: '' })
    try {
      const saved = await saveSettings(form)
      onSaved(saved)
      setMsg({ type: 'ok', text: 'บันทึกแล้ว' })
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl border border-gray-200 p-4 space-y-4 max-w-xl">
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-semibold text-slate-800">เปิดใช้งานที่ปรึกษา AI</span>
          <span className="block text-[13px] text-slate-500">ปิดแล้วจะส่งคำถามไม่ได้ (ประวัติยังอยู่)</span>
        </span>
        <input type="checkbox" role="switch" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })}
          className="h-6 w-11 shrink-0 cursor-pointer accent-blue-600" />
      </label>
      <div>
        <label htmlFor="advisor-model" className="mb-1 block text-sm font-semibold text-slate-800">ชื่อโมเดล</label>
        <input id="advisor-model" className={inputCls} value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}
          autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <p className="mt-1 text-[12px] text-slate-400">ตัวพิมพ์เล็ก ตัวเลข จุด ขีดกลาง เช่น gemini-2.5-flash</p>
      </div>
      <div>
        <label htmlFor="advisor-cap" className="mb-1 block text-sm font-semibold text-slate-800">เพดานคำถามต่อวัน</label>
        <input id="advisor-cap" type="number" inputMode="numeric" className={inputCls} min={ADVISOR_DAILY_CAP_MIN} max={ADVISOR_DAILY_CAP_MAX} step={1}
          value={form.daily_cap} onChange={e => setForm({ ...form, daily_cap: e.target.value })} />
        <p className="mt-1 text-[12px] text-slate-400">{ADVISOR_DAILY_CAP_MIN}–{ADVISOR_DAILY_CAP_MAX} ครั้ง นับใหม่ทุกเที่ยงคืนเวลาไทย</p>
      </div>
      {settings.updated_at && (
        <p className="text-[13px] text-slate-500">แก้ล่าสุดเมื่อ {thaiDateTimeText(settings.updated_at)}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} บันทึก
        </button>
        {msg.text && <span className={`text-[13px] ${msg.type === 'ok' ? 'text-green-700' : 'text-red-700'}`} role="status">{msg.text}</span>}
      </div>
    </form>
  )
}
