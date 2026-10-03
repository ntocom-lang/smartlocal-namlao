import {
  Library, RefreshCw, Loader2, AlertTriangle, Lock, ShieldCheck, Globe, Database, Info,
} from 'lucide-react'
import { RELEASE, SOURCES, buildCatalogRows, catalogSummary, groupBySensitivity } from '../../lib/dataCatalog'
import { formatAgo, formatThaiDate } from '../../lib/dataCenterHealth'
import { panelCls, insetCls, mutedCls, accentCls, ghostBtnCls, toneBadgeCls, toneTextCls } from './dcTheme'

const nf = new Intl.NumberFormat('th-TH')

function Stat({ Icon, label, value, sub, isLight, tone = 'info' }) {
  return (
    <div className={`rounded-xl border p-3 ${panelCls(isLight)}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-black uppercase tracking-widest ${mutedCls(isLight)}`}>{label}</span>
        <span className={`p-1.5 rounded-lg border ${toneBadgeCls(tone, isLight)}`}><Icon size={13} /></span>
      </div>
      <p className="text-xl font-black font-mono mt-1 tracking-tight">{value}</p>
      {sub && <p className={`text-[10px] mt-0.5 ${mutedCls(isLight)}`}>{sub}</p>}
    </div>
  )
}

function DatasetRow({ row, isLight }) {
  const rel = RELEASE[row.release]
  return (
    <li className="px-4 py-3 grid gap-x-4 gap-y-1.5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.1fr)] items-center">
      <div className="min-w-0">
        <p className="text-xs font-bold">{row.label}</p>
        <p className={`text-[11px] mt-0.5 ${mutedCls(isLight)}`}>
          {row.module} · {SOURCES[row.source]}
        </p>
        {row.note && <p className={`text-[11px] mt-0.5 leading-snug ${mutedCls(isLight)}`}>{row.note}</p>}
      </div>

      <div>
        {row.hasCount ? (
          <>
            <p className="text-sm font-black font-mono">{nf.format(row.total)} <span className={`text-[10px] font-normal ${mutedCls(isLight)}`}>แถว</span></p>
            <p className={`text-[11px] ${row.recent30d > 0 ? toneTextCls('good', isLight) : mutedCls(isLight)}`}>
              {row.recent30d > 0 ? `+${nf.format(row.recent30d)} ใน 30 วัน` : 'ไม่มีใหม่ใน 30 วัน'}
            </p>
          </>
        ) : row.restricted ? (
          <p className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${toneTextCls('warn', isLight)}`}
            title="ตารางนี้ไม่เปิดสิทธิ์อ่านตรงให้ผู้ใช้ทั่วไป ต้องผ่านฟังก์ชันเฉพาะที่ตรวจสิทธิ์ — ทะเบียนจึงไม่แสดงจำนวน">
            <Lock size={12} /> จำกัดสิทธิ์ระดับตาราง
          </p>
        ) : (
          <p className={`text-xs ${mutedCls(isLight)}`}>—</p>
        )}
      </div>

      <div>
        <p className={`text-[10px] font-bold uppercase tracking-wide ${mutedCls(isLight)}`}>อัปเดตล่าสุด</p>
        <p className="text-xs font-semibold">{row.hasCount && row.lastActivity ? formatAgo(row.lastActivity) : '—'}</p>
        {row.hasCount && row.lastActivity && <p className={`text-[10px] ${mutedCls(isLight)}`}>{formatThaiDate(row.lastActivity)}</p>}
      </div>

      <div>
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${toneBadgeCls(rel.tone, isLight)}`}>
          {row.release === 'none' ? <Lock size={10} /> : <Globe size={10} />} {rel.label}
        </span>
      </div>
    </li>
  )
}

export default function DataCenterCatalogPanel({ isLight, catalog, error, refreshing, onRefresh }) {
  if (!catalog && !error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 size={28} className={`animate-spin ${isLight ? 'text-sky-500' : 'text-cyan-400'}`} />
        <p className={`text-xs font-mono ${mutedCls(isLight)}`}>กำลังรวบรวมทะเบียนชุดข้อมูล...</p>
      </div>
    )
  }
  if (!catalog) {
    return (
      <div className={`flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border ${isLight ? 'bg-red-50 border-red-200 text-red-800' : 'bg-red-950/40 border-red-500/40 text-red-200'}`}>
        <div className="flex items-center gap-2 text-xs font-bold">
          <AlertTriangle size={16} className="shrink-0" />
          <span>โหลดทะเบียนชุดข้อมูลไม่สำเร็จ: {error}</span>
        </div>
        <button onClick={onRefresh}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border shrink-0 ${isLight ? 'bg-white border-red-300 text-red-700 hover:bg-red-100' : 'bg-red-900/40 border-red-500/40 text-red-200 hover:bg-red-900/60'}`}>
          <RefreshCw size={13} /> ลองใหม่
        </button>
      </div>
    )
  }

  const rows = buildCatalogRows(catalog)
  const s = catalogSummary(rows)
  const groups = groupBySensitivity(rows)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Stat Icon={Library} label="ชุดข้อมูลในทะเบียน" value={s.datasets} sub="ทุกโมดูลของระบบ" isLight={isLight} />
        <Stat Icon={Database} label="จำนวนแถวรวม" value={nf.format(s.totalRows)} sub="เฉพาะชุดที่นับได้" isLight={isLight} />
        <Stat Icon={Globe} label="เผยแพร่ต่อประชาชน" value={s.released} sub="ชุดข้อมูล (ไฟล์หรือหน้าเว็บ)" isLight={isLight} tone="good" />
        <Stat Icon={ShieldCheck} label="ข้อมูลบุคคลที่ไม่เผยแพร่" value={s.protectedCount} sub="ส่วนบุคคล/อ่อนไหว" isLight={isLight} tone="warn" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs ${mutedCls(isLight)}`}>จัดกลุ่มตามระดับความอ่อนไหวของข้อมูล</p>
        <button onClick={onRefresh} disabled={refreshing}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold border disabled:opacity-50 ${ghostBtnCls(isLight)}`}>
          {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} รีเฟรช
        </button>
      </div>

      {groups.map((g) => (
        <section key={g.key} className={`rounded-2xl border backdrop-blur-xl shadow-xl overflow-hidden ${panelCls(isLight)}`}>
          <div className={`flex flex-wrap items-center gap-2 px-4 py-2.5 border-b ${isLight ? 'bg-slate-50/90 border-slate-200' : 'bg-slate-950/70 border-cyan-500/20'}`}>
            <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-full border ${toneBadgeCls(g.tone, isLight)}`}>{g.label}</span>
            <span className={`text-[11px] ${mutedCls(isLight)}`}>{g.hint}</span>
            <span className={`ml-auto text-[11px] font-mono ${mutedCls(isLight)}`}>{g.rows.length} ชุด</span>
          </div>
          <ul className={`divide-y ${isLight ? 'divide-slate-200/70' : 'divide-slate-800/60'}`}>
            {g.rows.map((r) => <DatasetRow key={r.key} row={r} isLight={isLight} />)}
          </ul>
        </section>
      ))}

      <div className={`rounded-2xl border p-4 text-[11px] leading-relaxed space-y-1 ${insetCls(isLight)} ${mutedCls(isLight)}`}>
        <p className="flex items-start gap-2"><Info size={13} className={`shrink-0 mt-0.5 ${accentCls(isLight)}`} />
          <span>จำนวนที่แสดงคือ <b>เท่าที่บัญชีนี้มีสิทธิ์เห็น</b> ตามกติกาของระบบ (ผู้ดูแลระบบเห็นทั้งหน่วยงาน เจ้าหน้าที่ทั่วไปอาจเห็นน้อยกว่า) — ทะเบียนนี้ไม่เปิดสิทธิ์เพิ่มและไม่แสดงเนื้อหาของแถวใดเลย</span>
        </p>
        <p className="pl-5">
          ระดับความอ่อนไหวและการเผยแพร่เป็น <b>ร่างที่ระบบจัดให้จากโครงสร้างข้อมูล</b> ผู้ควบคุมข้อมูลส่วนบุคคลของหน่วยงานต้องยืนยันตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล ฉบับปัจจุบันก่อนใช้อ้างอิงเป็นทางการ
        </p>
      </div>
    </div>
  )
}
