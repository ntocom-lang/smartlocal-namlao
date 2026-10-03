import { useEffect, useState } from 'react'
import { ClipboardCheck, Library, HeartPulse, Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import DataCenterCatalogPanel from './DataCenterCatalogPanel'
import DataCenterHealthPanel from './DataCenterHealthPanel'
import DataCenterOpenDataPanel from './DataCenterOpenDataPanel'
import { panelCls, mutedCls, accentCls, toneBadgeCls } from './dcTheme'

const QUALITY_TABS = [
  { key: 'catalog', label: 'ทะเบียนชุดข้อมูล', Icon: Library },
  { key: 'health', label: 'สุขภาพข้อมูล', Icon: HeartPulse },
  { key: 'open', label: 'ข้อมูลเปิด', Icon: Download },
]

// หน้า "คุณภาพข้อมูล" — ให้ระบบตรวจเองด้วยกฎที่อธิบายได้ เจ้าหน้าที่แก้เฉพาะรายการที่ถูกชี้
// สุขภาพข้อมูลถูกดึงที่ DataCenterDashboard ครั้งเดียว (ใช้ร่วมกับป้ายคะแนนที่หัวหน้า) ส่งลงมาเป็น prop
// ทะเบียนชุดข้อมูลดึงที่นี่เมื่อเปิดแท็บ เพราะมีแต่หน้านี้ที่ใช้
export default function DataCenterQuality({
  tenant, profile, theme, tab, onTabChange, summary,
  health, healthError, healthLoading, staleDays, onChangeStaleDays, onRefreshHealth,
  isManager, canManageEntry, onEditEntryById, onViewOnMap, onDataChanged,
}) {
  const isLight = theme === 'light'
  const tenantId = tenant?.id

  const [catalog, setCatalog] = useState(null)
  const [catalogError, setCatalogError] = useState(null)
  const [catalogVersion, setCatalogVersion] = useState(0)
  const [catalogRefreshing, setCatalogRefreshing] = useState(false)
  const [departments, setDepartments] = useState([])

  useEffect(() => {
    if (!tenantId) return
    let alive = true
    supabase.rpc('data_center_catalog', { _municipality_id: tenantId }).then(({ data, error }) => {
      if (!alive) return
      if (error) { setCatalogError(error.message); setCatalog(null) } else { setCatalogError(null); setCatalog(data ?? []) }
      setCatalogRefreshing(false)
    })
    return () => { alive = false }
  }, [tenantId, catalogVersion])

  // รายชื่อกองทั้งหมดของ อปท. ไว้ให้แอดมินเลือกกองเจ้าของ (RLS ของ departments เปิดอ่านให้ระดับเจ้าหน้าที่แล้ว)
  useEffect(() => {
    if (!tenantId || !isManager) return
    let alive = true
    supabase.from('departments').select('id, name').eq('municipality_id', tenantId).order('name')
      .then(({ data }) => { if (alive) setDepartments(data ?? []) })
    return () => { alive = false }
  }, [tenantId, isManager])

  const t = health?.totals
  const mustFix = t ? (t.stale ?? 0) + (t.duplicate ?? 0) + (t.no_owner ?? 0) + (t.pii_id ?? 0) : 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${toneBadgeCls('info', isLight)}`}>
          <ClipboardCheck size={20} />
        </div>
        <div className="min-w-0">
          <h1 className={`text-lg font-black tracking-wide ${isLight ? 'text-slate-900' : 'text-white'}`}>คุณภาพและทะเบียนข้อมูล</h1>
          <p className={`text-xs ${mutedCls(isLight)}`}>ระบบตรวจให้เองด้วยกฎที่ตรวจย้อนได้ — เจ้าหน้าที่แก้เฉพาะรายการที่ถูกชี้ ไม่มีแบบฟอร์มเพิ่ม</p>
        </div>
      </div>

      <div role="tablist" aria-label="หมวดของหน้าคุณภาพข้อมูล" className={`flex flex-wrap gap-1.5 p-1.5 rounded-2xl border ${panelCls(isLight)}`}>
        {QUALITY_TABS.map(({ key, label, Icon }) => {
          const active = tab === key
          return (
            <button key={key} type="button" role="tab" aria-selected={active} onClick={() => onTabChange(key)}
              className={`flex-1 min-w-32 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-extrabold border transition-all ${
                active
                  ? (isLight ? 'bg-sky-100 text-sky-800 border-sky-300' : 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border-cyan-500/40')
                  : (isLight ? 'text-slate-500 border-transparent hover:bg-slate-100' : 'text-slate-400 border-transparent hover:bg-slate-800/60')
              }`}>
              <Icon size={15} className={active ? accentCls(isLight) : ''} />
              <span>{label}</span>
              {key === 'health' && mustFix > 0 && (
                <span className={`text-[10px] font-black font-mono px-1.5 rounded-full border ${toneBadgeCls('bad', isLight)}`}>{mustFix}</span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'catalog' && (
        <DataCenterCatalogPanel isLight={isLight} catalog={catalog} error={catalogError} refreshing={catalogRefreshing}
          onRefresh={() => { setCatalogRefreshing(true); setCatalogVersion((v) => v + 1) }} />
      )}
      {tab === 'health' && (
        <DataCenterHealthPanel isLight={isLight} profile={profile} health={health} error={healthError} loading={healthLoading}
          staleDays={staleDays} onChangeStaleDays={onChangeStaleDays} onRefresh={onRefreshHealth}
          canManageEntry={canManageEntry} isManager={isManager} departments={departments}
          onEditEntryById={onEditEntryById} onViewOnMap={onViewOnMap} onChanged={onDataChanged} />
      )}
      {tab === 'open' && <DataCenterOpenDataPanel isLight={isLight} tenant={tenant} summary={summary} />}
    </div>
  )
}
