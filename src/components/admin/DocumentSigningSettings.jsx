import { useState } from 'react'
import { ArrowRight, FileSignature, UserRoundCheck } from 'lucide-react'
import SignatorySettings from './SignatorySettings'
import EsignSettings from './EsignSettings'

// เมนู "การลงนามเอกสาร" — รวมสองเมนูเดิม (ผู้ลงนามเอกสาร · ลงนามออนไลน์) ที่เคยแยกกัน (เจ้าของระบบอนุมัติ 2569-10-30)
// เหตุ: สองเมนูชื่อซ้ำคำ "ลงนาม" และทะเบียนผู้ลงนามดูซ้ำกับหน้าแต่งตั้ง แอดมินไม่รู้ว่าต้องเข้าเมนูไหน
// หน้านี้ตอบคำถามเดียว "ช่องลงนามท้ายเอกสาร ใครลงชื่อ และลงบนกระดาษหรือในระบบ"
// ส่วนคน กอง ตำแหน่ง และสิทธิ์เข้าเมนู อยู่ที่ "จัดการผู้ใช้และการแต่งตั้ง" ที่เดียว (แท็บ ① เสนอชื่อจากที่นั่นให้)
// คีย์แท็บใช้ชื่อเดิมของ activePage ('signatories' / 'esign') — ทางเข้าเก่าที่ยังเรียกด้วยคีย์นี้จึงเปิดถูกแท็บ
const SIGNING_TABS = [
  {
    key: 'signatories', step: 1, label: 'ผู้ลงนามแต่ละช่อง', Icon: UserRoundCheck,
    desc: 'ชื่อและตำแหน่งที่พิมพ์ใต้เส้นลงนาม ใช้ร่วมทุกเอกสาร',
  },
  {
    key: 'esign', step: 2, label: 'ลงนามออนไลน์', Icon: FileSignature,
    desc: 'ลงนามในระบบแทนเซ็นปากกา · ไม่บังคับ · ตอนนี้ใช้กับใบขอใช้รถ แบบ ๓',
  },
]

function signingTabFor(key) {
  return SIGNING_TABS.some((tab) => tab.key === key) ? key : SIGNING_TABS[0].key
}

export default function DocumentSigningSettings({ tenant, initialTab = 'signatories', onOpenUsers = null }) {
  const [tab, setTab] = useState(() => signingTabFor(initialTab))

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm md:p-5">
        <p className="text-sm font-bold text-gray-800">ช่องลงนามท้ายเอกสาร — ใครลงชื่อ และลงบนกระดาษหรือในระบบ</p>
        <p className="mt-1 text-xs leading-5 text-gray-500">
          ย้ายคนเข้ากอง ตั้งตำแหน่ง ติ๊กหัวหน้ากอง หรือให้สิทธิ์เข้าเมนู ทำที่ “จัดการผู้ใช้และการแต่งตั้ง”
          แล้วแท็บที่ 1 จะเสนอชื่อตามการแต่งตั้งให้เอง ไม่ต้องพิมพ์ซ้ำ
        </p>
        {onOpenUsers && (
          <button type="button" onClick={onOpenUsers}
            className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-1 text-xs font-bold text-indigo-700 hover:underline">
            ไปที่จัดการผู้ใช้และการแต่งตั้ง <ArrowRight size={14} />
          </button>
        )}
        <div role="tablist" aria-label="การลงนามเอกสาร" className="mt-3 grid gap-2 sm:grid-cols-2">
          {SIGNING_TABS.map(({ key, step, label, desc, Icon }) => {
            const active = tab === key
            return (
              <button key={key} type="button" role="tab" id={`signing-tab-${key}`}
                aria-selected={active} aria-controls="signing-panel" onClick={() => setTab(key)}
                className={`flex min-h-11 items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-all ${
                  active
                    ? 'border-transparent bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-200'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                  active ? 'bg-white/20 text-white' : 'bg-indigo-50 text-indigo-700'
                }`}>{step}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-bold">
                    <Icon size={15} className="shrink-0" /> {label}
                  </span>
                  <span className={`mt-0.5 block text-[11px] leading-4 ${active ? 'text-white/80' : 'text-slate-500'}`}>{desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <div role="tabpanel" id="signing-panel" aria-labelledby={`signing-tab-${tab}`}>
        {tab === 'signatories'
          ? <SignatorySettings tenant={tenant} />
          : <EsignSettings tenant={tenant} onOpenSignatories={() => setTab('signatories')} />}
      </div>
    </div>
  )
}
