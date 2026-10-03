import { useState } from 'react'
import {
  HeartPulse, RefreshCw, Loader2, AlertTriangle, CheckCircle2, BadgeCheck, Pencil, MapPin, Building2, Info, ChevronDown,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  ISSUES, ISSUE_ORDER, STALE_OPTIONS, scoreTone, percent, formatAgo, formatThaiDate, staleLabel,
} from '../../lib/dataCenterHealth'
import {
  panelCls, insetCls, mutedCls, accentCls, ghostBtnCls, inputCls, toneBadgeCls, toneTextCls, toneStroke, toneBarCls,
} from './dcTheme'

const PAGE = 40

function ScoreRing({ score, isLight }) {
  const tone = scoreTone(score)
  const r = 42
  const c = 2 * Math.PI * r
  const dash = score == null ? 0 : (c * score) / 100
  return (
    <div className="relative w-28 h-28 shrink-0" role="img" aria-label={score == null ? 'ยังไม่มีคะแนน' : `คะแนนความพร้อมของข้อมูล ${score} เปอร์เซ็นต์`}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" stroke={isLight ? '#e2e8f0' : '#1e293b'} />
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" strokeLinecap="round"
          stroke={toneStroke(tone, isLight)} strokeDasharray={`${dash} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-black font-mono leading-none ${toneTextCls(tone, isLight)}`}>{score == null ? '—' : `${score}%`}</span>
        <span className={`text-[10px] mt-1 ${mutedCls(isLight)}`}>พร้อมใช้</span>
      </div>
    </div>
  )
}

function Bar({ label, value, whole, tone, isLight, hint }) {
  const pct = percent(value, whole)
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-semibold truncate">{label}</span>
        <span className={`text-[11px] font-mono font-bold shrink-0 ${mutedCls(isLight)}`}>
          {pct == null ? '—' : `${pct}%`} <span className="font-normal opacity-70">({value}/{whole})</span>
        </span>
      </div>
      <div className={`h-1.5 rounded-full overflow-hidden ${isLight ? 'bg-slate-200' : 'bg-slate-800'}`} title={hint}>
        <div className={`h-full rounded-full ${toneBarCls(tone, isLight)}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  )
}

export default function DataCenterHealthPanel({
  isLight, profile, health, error, loading, staleDays, onChangeStaleDays, onRefresh,
  canManageEntry, isManager, departments = [], onEditEntryById, onViewOnMap, onChanged,
}) {
  const [filter, setFilter] = useState(null)
  const [visible, setVisible] = useState(PAGE)
  const [busyId, setBusyId] = useState(null)
  const [verifiedIds, setVerifiedIds] = useState(() => new Set())
  const [bulkDept, setBulkDept] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [showRules, setShowRules] = useState(false)

  if (!health && !error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 size={28} className={`animate-spin ${isLight ? 'text-sky-500' : 'text-cyan-400'}`} />
        <p className={`text-xs font-mono ${mutedCls(isLight)}`}>กำลังตรวจสุขภาพข้อมูล...</p>
      </div>
    )
  }

  if (!health) {
    return (
      <div className={`flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border ${isLight ? 'bg-red-50 border-red-200 text-red-800' : 'bg-red-950/40 border-red-500/40 text-red-200'}`}>
        <div className="flex items-center gap-2 text-xs font-bold">
          <AlertTriangle size={16} className="shrink-0" />
          <span>ตรวจสุขภาพข้อมูลไม่สำเร็จ: {error}</span>
        </div>
        <button onClick={onRefresh}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border shrink-0 ${isLight ? 'bg-white border-red-300 text-red-700 hover:bg-red-100' : 'bg-red-900/40 border-red-500/40 text-red-200 hover:bg-red-900/60'}`}>
          <RefreshCw size={13} /> ลองใหม่
        </button>
      </div>
    )
  }

  const t = health.totals ?? {}
  const items = health.items ?? []
  const deptNames = new Map((health.departments ?? []).map((d) => [d.department_id, d.name]))
  const allDepartments = departments.length ? departments : (health.departments ?? []).filter((d) => d.department_id).map((d) => ({ id: d.department_id, name: d.name }))
  const shown = filter ? items.filter((i) => i.issues.includes(filter)) : items
  const noOwnerItems = items.filter((i) => i.issues.includes('no_owner') && canManageEntry(i))
  const mustTotal = (t.stale ?? 0) + (t.duplicate ?? 0) + (t.no_owner ?? 0) + (t.pii_id ?? 0)

  function pickFilter(code) {
    setFilter((cur) => (cur === code ? null : code))
    setVisible(PAGE)
  }

  async function verify(item) {
    setBusyId(item.id)
    const { data, error: err } = await supabase.from('data_center_entries')
      .update({ verified_at: new Date().toISOString(), verified_by: profile?.id ?? null })
      .eq('id', item.id).select('id')
    setBusyId(null)
    if (err) { alert('บันทึกไม่สำเร็จ: ' + err.message); return }
    if (!data?.length) { alert('บัญชีนี้ไม่มีสิทธิ์ยืนยันรายการนี้ (รายการของกองอื่นหรือผู้สร้างรายอื่น)'); return }
    setVerifiedIds((prev) => new Set(prev).add(item.id))
    onChanged?.()
  }

  async function assignOwner(ids, departmentId) {
    if (!departmentId || ids.length === 0) return false
    const { data, error: err } = await supabase.from('data_center_entries')
      .update({ department_id: departmentId }).in('id', ids).select('id')
    if (err) { alert('บันทึกไม่สำเร็จ: ' + err.message); return false }
    if ((data?.length ?? 0) !== ids.length) alert(`กำหนดสำเร็จ ${data?.length ?? 0} จาก ${ids.length} รายการ — ที่เหลือบัญชีนี้ไม่มีสิทธิ์แก้ไข`)
    onChanged?.()
    return true
  }

  async function assignBulk() {
    const name = allDepartments.find((d) => d.id === bulkDept)?.name ?? 'กองที่เลือก'
    if (!bulkDept || noOwnerItems.length === 0) return
    if (!window.confirm(`กำหนด "${name}" เป็นกองเจ้าของของ ${noOwnerItems.length} รายการที่ยังไม่มีเจ้าของ?\n(เปลี่ยนภายหลังได้ที่รายการแต่ละแถว)`)) return
    setBulkBusy(true)
    const ok = await assignOwner(noOwnerItems.map((i) => i.id), bulkDept)
    setBulkBusy(false)
    if (ok) setBulkDept('')
  }

  const tileMeta = {
    stale: t.stale, duplicate: t.duplicate, no_owner: t.no_owner, pii_id: t.pii_id, no_description: t.no_description, no_photo: t.no_photo,
  }

  return (
    <div className="space-y-5">
      {/* คะแนนรวม */}
      <section className={`rounded-2xl border p-5 backdrop-blur-xl shadow-xl ${panelCls(isLight)}`}>
        <div className="flex flex-wrap items-center gap-5">
          <ScoreRing score={t.score} isLight={isLight} />
          <div className="flex-1 min-w-60 space-y-1.5">
            <h2 className="text-base font-black tracking-wide flex items-center gap-2">
              <HeartPulse size={17} className={accentCls(isLight)} /> สุขภาพข้อมูล
            </h2>
            {(t.active ?? 0) === 0 ? (
              <p className={`text-sm ${mutedCls(isLight)}`}>ยังไม่มีรายการที่เปิดใช้งานให้ตรวจ</p>
            ) : (
              <p className="text-sm">
                พร้อมใช้ <b className="font-mono">{t.ok}</b> จาก <b className="font-mono">{t.active}</b> รายการ
                {mustTotal > 0 && <span className={mutedCls(isLight)}> · ต้องแก้ {mustTotal} จุด</span>}
              </p>
            )}
            <p className={`text-[11px] ${mutedCls(isLight)}`}>
              ตรวจเมื่อ {formatThaiDate(health.checked_at)} · แก้ไขหรือตรวจทานล่าสุด {formatAgo(t.latest_update)}
            </p>
            <p className={`text-[11px] ${mutedCls(isLight)}`}>
              "พร้อมใช้" = ไม่ติดข้อ <b>ต้องแก้</b> ทั้ง 4 ข้อด้านล่าง (ข้อ <b>ควรเติม</b> ไม่กระทบคะแนน)
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className={`text-[11px] font-semibold ${mutedCls(isLight)}`} htmlFor="dc-stale-days">นับว่า "ไม่ได้ตรวจทาน" เมื่อเกิน</label>
              <select id="dc-stale-days" value={staleDays} onChange={(e) => { onChangeStaleDays(Number(e.target.value)); setVisible(PAGE) }}
                className={`text-xs px-2.5 py-1 rounded-lg border focus:outline-none ${inputCls(isLight)}`}>
                {STALE_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
              </select>
              <button onClick={onRefresh} disabled={loading}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border disabled:opacity-50 ${ghostBtnCls(isLight)}`}>
                {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} ตรวจใหม่
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 5 ข้อที่ตรวจ = ตัวกรองรายการด้านล่างด้วย */}
      <section className="space-y-2">
        {[
          { title: 'ต้องแก้ (กระทบคะแนน)', codes: ISSUE_ORDER.filter((c) => ISSUES[c].severity === 'must') },
          { title: 'ควรเติม (ความครบถ้วน)', codes: ISSUE_ORDER.filter((c) => ISSUES[c].severity === 'nice') },
        ].map((row) => (
          <div key={row.title}>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1.5 ${mutedCls(isLight)}`}>{row.title}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {row.codes.map((code) => {
                const n = tileMeta[code] ?? 0
                const active = filter === code
                const tileTone = n === 0 ? 'good' : ISSUES[code].severity === 'must' ? 'bad' : 'warn'
                return (
                  <button key={code} type="button" onClick={() => pickFilter(code)} aria-pressed={active}
                    title={ISSUES[code].rule(staleDays)}
                    className={`text-left rounded-xl border p-3 transition-all ${panelCls(isLight)} ${active ? (isLight ? 'ring-2 ring-sky-400' : 'ring-2 ring-cyan-400') : 'hover:scale-[1.01]'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold">{ISSUES[code].label}</span>
                      <span className={`text-[11px] font-black font-mono px-2 py-0.5 rounded-full border ${toneBadgeCls(tileTone, isLight)}`}>{n}</span>
                    </div>
                    <p className={`text-[10px] mt-1 leading-snug ${mutedCls(isLight)}`}>
                      {code === 'stale' ? `ไม่แก้ไข/ไม่ยืนยันเกิน ${staleLabel(staleDays)}` : ISSUES[code].rule(staleDays).split(' — ')[0]}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      {/* ความครบถ้วน + รายกอง */}
      {(t.active ?? 0) > 0 && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`rounded-2xl border p-5 space-y-3 ${panelCls(isLight)}`}>
            <h3 className="text-sm font-extrabold tracking-wide">ความครบถ้วนของข้อมูล</h3>
            <Bar label="มีรายละเอียด" value={(t.active ?? 0) - (t.no_description ?? 0)} whole={t.active ?? 0} tone="info" isLight={isLight} />
            <Bar label="จุดพิกัดที่มีรูป" value={t.points_with_photo ?? 0} whole={t.points ?? 0} tone="info" isLight={isLight} hint="เส้นทางถนนไม่ต้องมีรูป จึงไม่นับ" />
            <Bar label="มีกองเจ้าของ" value={(t.active ?? 0) - (t.no_owner ?? 0)} whole={t.active ?? 0} tone="info" isLight={isLight} />
          </div>
          <div className={`rounded-2xl border p-5 space-y-3 ${panelCls(isLight)}`}>
            <h3 className="text-sm font-extrabold tracking-wide flex items-center gap-2">
              <Building2 size={15} className={accentCls(isLight)} /> พร้อมใช้ แยกตามกองเจ้าของ
            </h3>
            {(health.departments ?? []).map((d) => {
              const pct = percent(d.ok, d.active)
              return (
                <Bar key={d.department_id ?? 'none'} label={d.department_id ? (d.name || 'ไม่ทราบชื่อกอง') : 'ไม่ระบุกอง'}
                  value={d.ok} whole={d.active} tone={scoreTone(pct)} isLight={isLight} />
              )
            })}
          </div>
        </section>
      )}

      {/* รายการที่ต้องดูแล */}
      <section className={`rounded-2xl border backdrop-blur-xl shadow-xl overflow-hidden ${panelCls(isLight)}`}>
        <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b ${isLight ? 'bg-slate-50/90 border-slate-200' : 'bg-slate-950/70 border-cyan-500/20'}`}>
          <h3 className="text-sm font-extrabold tracking-wide">
            รายการที่ควรดูแล <span className={`font-mono text-xs ${mutedCls(isLight)}`}>({shown.length}{filter ? ` จาก ${items.length}` : ''})</span>
          </h3>
          {filter && (
            <button type="button" onClick={() => pickFilter(filter)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border ${toneBadgeCls('info', isLight)}`}>
              กรอง: {ISSUES[filter].label} ✕
            </button>
          )}
        </div>

        {isManager && noOwnerItems.length > 0 && (
          <div className={`flex flex-wrap items-center gap-2 px-4 py-3 border-b text-xs ${isLight ? 'bg-amber-50/70 border-amber-200' : 'bg-amber-500/5 border-amber-500/20'}`}>
            <span className="font-semibold">กำหนดกองเจ้าของให้ <b className="font-mono">{noOwnerItems.length}</b> รายการที่ยังไม่มีเจ้าของพร้อมกัน:</span>
            <select value={bulkDept} onChange={(e) => setBulkDept(e.target.value)} aria-label="เลือกกองเจ้าของสำหรับทุกรายการที่ไม่มีเจ้าของ"
              className={`text-xs px-2.5 py-1 rounded-lg border focus:outline-none ${inputCls(isLight)}`}>
              <option value="">เลือกกอง/สำนัก...</option>
              {allDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button type="button" onClick={assignBulk} disabled={!bulkDept || bulkBusy}
              className="px-3 py-1 rounded-lg text-xs font-bold text-slate-950 bg-gradient-to-r from-cyan-400 to-emerald-400 disabled:opacity-40">
              {bulkBusy ? 'กำลังบันทึก...' : 'กำหนดทั้งหมด'}
            </button>
          </div>
        )}

        {shown.length === 0 ? (
          <div className="text-center py-14">
            <CheckCircle2 size={30} className={`mx-auto mb-2 ${toneTextCls('good', isLight)}`} />
            <p className="text-sm font-bold">{filter ? 'ไม่พบรายการติดข้อนี้' : 'ไม่พบรายการที่ต้องดูแล'}</p>
            <p className={`text-xs mt-1 ${mutedCls(isLight)}`}>ระบบตรวจซ้ำทุกครั้งที่เปิดหน้านี้ ไม่ต้องกดยืนยันรายวัน</p>
          </div>
        ) : (
          <ul className={`divide-y ${isLight ? 'divide-slate-200/70' : 'divide-slate-800/60'}`}>
            {shown.slice(0, visible).map((item) => {
              const manage = canManageEntry(item)
              const justVerified = verifiedIds.has(item.id)
              const ownerAssignable = isManager && item.issues.includes('no_owner')
              // ปุ่มยืนยันล้างได้เฉพาะป้ายที่ verified_at มีผลใน SQL (stale, pii_id) — แสดงทุกแถวจะชวนให้เข้าใจว่ากดแล้วแก้ได้ทุกข้อ
              const verifiable = item.issues.includes('stale') || item.issues.includes('pii_id')
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-56">
                    <p className="text-xs font-bold truncate">{item.name || '(ไม่มีชื่อ)'}</p>
                    <p className={`text-[11px] mt-0.5 truncate ${mutedCls(isLight)}`}>
                      {item.group_name} › {item.category} · {item.department_id ? (deptNames.get(item.department_id) || 'ไม่ทราบชื่อกอง') : 'ไม่ระบุกอง'}
                      {' · '}{item.verified_at ? 'ตรวจทานล่าสุด' : 'แก้ไขล่าสุด'} {formatAgo(item.last_touch)}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {item.issues.map((code) => (
                        <span key={code} title={`${ISSUES[code].rule(staleDays)} — ${ISSUES[code].fix}`}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${toneBadgeCls(ISSUES[code].severity === 'must' ? 'bad' : 'warn', isLight)}`}>
                          {ISSUES[code].short}
                        </span>
                      ))}
                      {justVerified && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${toneBadgeCls('good', isLight)}`}>ยืนยันแล้ว</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {ownerAssignable && (
                      <select defaultValue="" aria-label={`กำหนดกองเจ้าของ ${item.name}`}
                        onChange={async (e) => { const v = e.target.value; if (v) { setBusyId(item.id); await assignOwner([item.id], v); setBusyId(null) } }}
                        className={`text-[11px] px-2 py-1 rounded-lg border focus:outline-none max-w-36 ${inputCls(isLight)}`}>
                        <option value="">กำหนดกอง...</option>
                        {allDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    )}
                    {manage && verifiable && !justVerified && (
                      <button type="button" onClick={() => verify(item)} disabled={busyId === item.id}
                        title="ข้อมูลยังตรงกับของจริง ไม่ต้องแก้ — บันทึกวันที่ตรวจทานและชื่อผู้ยืนยัน"
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border disabled:opacity-50 ${toneBadgeCls('good', isLight)}`}>
                        {busyId === item.id ? <Loader2 size={12} className="animate-spin" /> : <BadgeCheck size={12} />} ยืนยันว่ายังถูกต้อง
                      </button>
                    )}
                    {onViewOnMap && (
                      <button type="button" onClick={() => onViewOnMap(item)} aria-label={`ดูบนแผนที่ ${item.name}`} title="ดูบนแผนที่"
                        className={`p-1.5 rounded-lg border ${ghostBtnCls(isLight)}`}><MapPin size={13} /></button>
                    )}
                    <button type="button" onClick={() => onEditEntryById(item.id)} aria-label={`แก้ไข ${item.name}`} title={manage ? 'แก้ไข' : 'แก้ไข (บัญชีนี้ไม่มีสิทธิ์)'}
                      className={`p-1.5 rounded-lg border ${ghostBtnCls(isLight)}`}><Pencil size={13} /></button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {shown.length > visible && (
          <div className={`px-4 py-3 border-t text-center ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
            <button type="button" onClick={() => setVisible((v) => v + PAGE)}
              className={`inline-flex items-center gap-1 px-4 py-1.5 rounded-xl text-xs font-bold border ${ghostBtnCls(isLight)}`}>
              <ChevronDown size={13} /> แสดงเพิ่ม ({shown.length - visible} รายการ)
            </button>
          </div>
        )}
        {(health.items_total ?? 0) > items.length && (
          <p className={`px-4 py-2.5 border-t text-[11px] ${mutedCls(isLight)} ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
            แสดง {items.length} จาก {health.items_total} รายการ (เรียงตามความเร่งด่วน) — แก้แล้วกด "ตรวจใหม่" รายการถัดไปจะขึ้นมาแทน
          </p>
        )}
      </section>

      {/* ระบบตรวจอย่างไร — กฎทุกข้อต้องอธิบายได้ */}
      <section className={`rounded-2xl border p-4 ${insetCls(isLight)}`}>
        <button type="button" onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}
          className="w-full flex items-center justify-between gap-2 text-left">
          <span className="flex items-center gap-2 text-xs font-extrabold"><Info size={14} className={accentCls(isLight)} /> ระบบตรวจอย่างไร (กฎ 6 ข้อ ไม่ใช้ AI)</span>
          <ChevronDown size={14} className={`transition-transform ${showRules ? 'rotate-180' : ''}`} />
        </button>
        {showRules && (
          <ol className="mt-3 space-y-2.5 text-xs">
            {ISSUE_ORDER.map((code, i) => (
              <li key={code} className="flex gap-2">
                <span className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-black ${toneBadgeCls(ISSUES[code].severity === 'must' ? 'bad' : 'warn', isLight)}`}>{i + 1}</span>
                <div>
                  <p className="font-bold">{ISSUES[code].label} <span className={`font-normal ${mutedCls(isLight)}`}>({ISSUES[code].severity === 'must' ? 'ต้องแก้' : 'ควรเติม'})</span></p>
                  <p className={mutedCls(isLight)}>{ISSUES[code].rule(staleDays)}</p>
                  <p className={mutedCls(isLight)}>วิธีแก้: {ISSUES[code].fix}</p>
                </div>
              </li>
            ))}
            <li className={`pt-2 border-t ${isLight ? 'border-slate-200' : 'border-slate-800'} ${mutedCls(isLight)}`}>
              ตรวจเฉพาะรายการที่เปิดใช้งาน · คะแนน = รายการที่ไม่ติด 4 ข้อแรก ÷ รายการที่เปิดใช้งานทั้งหมด · ระบบแค่ชี้ ไม่แก้หรือลบอะไรเอง
            </li>
          </ol>
        )}
      </section>
    </div>
  )
}
