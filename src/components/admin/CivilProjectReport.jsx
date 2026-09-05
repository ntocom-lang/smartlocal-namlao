import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { govDocFontCss, govPageCss } from '../../lib/govDocStyle.js'
import { ChevronRight, ArrowLeft, Printer, BarChart2 } from 'lucide-react'

const PROJECT_TYPE_LABEL = {
  road_concrete: 'ถนน ค.ส.ล.',
  road_asphalt:  'ลาดยางแอสฟัลท์',
  road_slurry:   'ฉาบผิวสเลอรี่ซิล',
  road_gravel:   'หินคลุก',
  drain:         'รางระบายน้ำ',
  dredge:        'ขุดลอก',
  canal:         'รางน้ำ/ลำเหมือง',
  pipe_water:    'ท่อน้ำประปา',
  building:      'อาคาร/สิ่งก่อสร้าง',
  light:         'ไฟฟ้าสาธารณะ',
  park:          'สวนสาธารณะ/ภูมิทัศน์',
  other:         'อื่นๆ',
}

const STATUS_TH = {
  planned:     'วางแผน',
  approved:    'อนุมัติ',
  in_progress: 'กำลังดำเนินการ',
  completed:   'แล้วเสร็จ',
  cancelled:   'ยกเลิก',
  suspended:   'ระงับ',
}

const STATUS_COLOR = {
  planned:     '#9ca3af',
  approved:    '#3b82f6',
  in_progress: '#f97316',
  completed:   '#10b981',
  cancelled:   '#ef4444',
  suspended:   '#f59e0b',
}

const fmt = (n) => n ? `฿${Number(n).toLocaleString('th-TH')}` : '-'

export default function CivilProjectReport({ tenant }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedYear, setSelectedYear] = useState(null)

  useEffect(() => {
    if (!tenant?.id) return
    supabase
      .from('civil_projects')
      .select('id, project_no, title, project_type, status, village, budget_amount, contract_amount, paid_amount, contractor_name, fiscal_year')
      .eq('municipality_id', tenant.id)
      .order('project_no')
      .then(({ data }) => { setProjects(data ?? []); setLoading(false) })
  }, [tenant?.id])

  const byYear = projects.reduce((acc, p) => {
    const y = p.fiscal_year ?? 'ไม่ระบุ'
    ;(acc[y] ??= []).push(p)
    return acc
  }, {})
  const years = Object.keys(byYear).sort((a, b) => b - a)

  if (loading) return <div className="py-20 text-center text-gray-400 text-sm">กำลังโหลดข้อมูล...</div>

  /* ── Detail view ── */
  if (selectedYear) {
    const items = byYear[selectedYear] ?? []
    const byType = items.reduce((acc, p) => {
      ;(acc[p.project_type ?? 'other'] ??= []).push(p)
      return acc
    }, {})

    const totalBudget   = items.reduce((s, p) => s + (Number(p.budget_amount)   || 0), 0)
    const totalContract = items.reduce((s, p) => s + (Number(p.contract_amount) || 0), 0)
    const totalPaid     = items.reduce((s, p) => s + (Number(p.paid_amount)     || 0), 0)
    const completedCount = items.filter(p => p.status === 'completed').length

    function handlePrint() {
      const thDate = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })

      const typeRows = Object.entries(byType).map(([type, rows]) => {
        const typeTotalBudget = rows.reduce((s, p) => s + (Number(p.budget_amount) || 0), 0)
        const trs = rows.map((p, i) => `
          <tr>
            <td class="center">${i + 1}</td>
            <td>${p.project_no ?? '-'}</td>
            <td>${p.title}</td>
            <td>${p.village ?? '-'}</td>
            <td class="right">${p.budget_amount ? Number(p.budget_amount).toLocaleString('th-TH') : '-'}</td>
            <td class="right">${p.contract_amount ? Number(p.contract_amount).toLocaleString('th-TH') : '-'}</td>
            <td>${p.contractor_name ?? '-'}</td>
            <td class="center">${STATUS_TH[p.status] ?? p.status}</td>
          </tr>`).join('')
        return `
          <h3 style="margin:20px 0 6px;font-size:14px;font-weight:600">${PROJECT_TYPE_LABEL[type] ?? type} (${rows.length} โครงการ)</h3>
          <table>
            <thead><tr>
              <th style="width:36px">ที่</th>
              <th style="width:90px">เลขที่</th>
              <th>ชื่อโครงการ</th>
              <th style="width:110px">พื้นที่</th>
              <th style="width:100px">วงเงิน (บาท)</th>
              <th style="width:100px">สัญญา (บาท)</th>
              <th style="width:110px">ผู้รับจ้าง</th>
              <th style="width:90px">สถานะ</th>
            </tr></thead>
            <tbody>
              ${trs}
              <tr class="subtotal">
                <td colspan="4" class="right bold">รวม</td>
                <td class="right bold">${typeTotalBudget.toLocaleString('th-TH')}</td>
                <td colspan="3"></td>
              </tr>
            </tbody>
          </table>`
      }).join('')

      const html = `<!DOCTYPE html><html lang="th"><head>
        <meta charset="UTF-8">
        <title>รายงานโครงการ ปี ${selectedYear}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
          ${govPageCss()}
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { ${govDocFontCss()} color: #111; padding: 20px 28px; }
          .center { text-align: center; }
          .right  { text-align: right; }
          .bold   { font-weight: 700; }
          h1 { font-size: 16px; font-weight: 700; text-align: center; margin-bottom: 4px; }
          h2 { font-size: 14px; font-weight: 600; text-align: center; color: #333; margin-bottom: 20px; }
          .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0 20px; }
          .stat  { border: 1px solid #ddd; border-radius: 4px; padding: 10px; text-align: center; }
          .stat-label { font-size: 11px; color: #666; margin-bottom: 4px; }
          .stat-value { font-size: 15px; font-weight: 700; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 8px; }
          th { background: #f3f4f6; padding: 7px 8px; text-align: left; border: 1px solid #d1d5db; font-weight: 600; font-size: 12px; }
          td { padding: 6px 8px; border: 1px solid #e5e7eb; vertical-align: top; }
          tr:nth-child(even) td { background: #fafafa; }
          .subtotal td { background: #f3f4f6 !important; font-weight: 600; }
          .totals { margin-top: 20px; display: flex; justify-content: flex-end; }
          .totals table { width: 300px; border: none; }
          .totals td { border: none; padding: 4px 8px; font-size: 13px; }
          .totals .green { color: #059669; font-weight: 700; font-size: 14px; }
          .totals .border-top td { border-top: 1px solid #ccc; }
          .footer { margin-top: 40px; text-align: right; font-size: 12px; color: #666; }
          @media print { @page { size: A4 landscape; margin: 15mm 12mm; } }
        </style>
      </head><body>
        <h1>${tenant?.name}</h1>
        <h2>รายงานสรุปโครงการประจำปีงบประมาณ พ.ศ. ${selectedYear}</h2>
        <div class="stats">
          <div class="stat"><div class="stat-label">โครงการทั้งหมด</div><div class="stat-value">${items.length} โครงการ</div></div>
          <div class="stat"><div class="stat-label">แล้วเสร็จ</div><div class="stat-value">${completedCount} โครงการ</div></div>
          <div class="stat"><div class="stat-label">วงเงินงบประมาณรวม</div><div class="stat-value">${totalBudget.toLocaleString('th-TH')} บาท</div></div>
          <div class="stat"><div class="stat-label">เบิกจ่ายรวม</div><div class="stat-value">${totalPaid ? totalPaid.toLocaleString('th-TH') + ' บาท' : '-'}</div></div>
        </div>
        ${typeRows}
        <div class="totals">
          <table>
            <tr><td>วงเงินงบประมาณรวมทั้งสิ้น</td><td class="right bold">${totalBudget.toLocaleString('th-TH')} บาท</td></tr>
            <tr><td>ราคาสัญญารวม</td><td class="right">${totalContract ? totalContract.toLocaleString('th-TH') + ' บาท' : '-'}</td></tr>
            <tr class="border-top"><td>เงินเหลือจ่ายรวม</td><td class="right green">${(totalBudget - totalContract).toLocaleString('th-TH')} บาท</td></tr>
          </table>
        </div>
        <div class="footer">พิมพ์วันที่ ${thDate}</div>
      </body></html>`

      const w = window.open('', '_blank', 'width=1100,height=750')
      w.document.write(html)
      w.document.close()
      setTimeout(() => w.print(), 600)
    }

    return (
      <div className="space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1.5 text-sm">
            <button onClick={() => setSelectedYear(null)}
              className="flex items-center gap-1 text-gray-400 hover:text-gray-600 transition-colors">
              <ArrowLeft size={14} /> รายงาน
            </button>
            <ChevronRight size={13} className="text-gray-300" />
            <span className="font-semibold text-gray-700">ปีงบประมาณ {selectedYear}</span>
          </div>
          <button onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors print:hidden"
            style={{ backgroundColor: 'var(--color-primary)' }}>
            <Printer size={15} /> พิมพ์รายงาน
          </button>
        </div>

        {/* Report card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
          {/* Header */}
          <div className="text-center mb-6 pb-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-800">{tenant?.name}</h2>
            <p className="text-sm font-semibold text-gray-600 mt-1">
              รายงานสรุปโครงการประจำปีงบประมาณ พ.ศ. {selectedYear}
            </p>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'โครงการทั้งหมด',    value: `${items.length} โครงการ` },
              { label: 'แล้วเสร็จ',         value: `${completedCount} โครงการ` },
              { label: 'วงเงินงบประมาณรวม', value: fmt(totalBudget) },
              { label: 'เบิกจ่ายรวม',       value: fmt(totalPaid) },
            ].map(({ label, value }) => (
              <div key={label} className="text-center p-4 border border-gray-100 rounded-xl bg-gray-50/50">
                <p className="text-[11px] text-gray-400 mb-1.5">{label}</p>
                <p className="text-base font-bold text-gray-800">{value}</p>
              </div>
            ))}
          </div>

          {/* Tables by type */}
          <div className="space-y-6">
            {Object.entries(byType).map(([type, rows]) => {
              const typeTotal = rows.reduce((s, p) => s + (Number(p.budget_amount) || 0), 0)
              return (
                <div key={type}>
                  <h3 className="text-sm font-bold text-gray-700 mb-2">
                    {PROJECT_TYPE_LABEL[type] ?? type}
                    <span className="text-gray-400 font-normal ml-1">({rows.length} โครงการ)</span>
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse min-w-[640px]">
                      <thead>
                        <tr className="bg-gray-50 text-left">
                          {['ที่','เลขที่','ชื่อโครงการ','พื้นที่','วงเงิน','สัญญา','ผู้รับจ้าง','สถานะ'].map(h => (
                            <th key={h} className="py-2 px-3 text-[11px] font-semibold text-gray-500 border border-gray-200">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((p, i) => (
                          <tr key={p.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
                            <td className="py-2 px-3 border border-gray-100 text-center text-gray-500 text-xs">{i + 1}</td>
                            <td className="py-2 px-3 border border-gray-100 text-gray-600 font-mono text-xs">{p.project_no ?? '-'}</td>
                            <td className="py-2 px-3 border border-gray-100 font-medium text-gray-800">{p.title}</td>
                            <td className="py-2 px-3 border border-gray-100 text-gray-500 text-xs">{p.village ?? '-'}</td>
                            <td className="py-2 px-3 border border-gray-100 text-right font-semibold text-gray-700">{fmt(p.budget_amount)}</td>
                            <td className="py-2 px-3 border border-gray-100 text-right text-gray-600">{fmt(p.contract_amount)}</td>
                            <td className="py-2 px-3 border border-gray-100 text-gray-500 text-xs">{p.contractor_name ?? '-'}</td>
                            <td className="py-2 px-3 border border-gray-100 text-center">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                                style={{ backgroundColor: STATUS_COLOR[p.status] ?? '#9ca3af' }}>
                                {STATUS_TH[p.status] ?? p.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-gray-100 font-bold">
                          <td colSpan={4} className="py-2 px-3 border border-gray-200 text-right text-gray-600 text-xs">รวม</td>
                          <td className="py-2 px-3 border border-gray-200 text-right text-gray-800">{fmt(typeTotal)}</td>
                          <td colSpan={3} className="border border-gray-200" />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Grand total */}
          <div className="flex justify-end mt-6 pt-4 border-t border-gray-100">
            <div className="w-72 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">วงเงินงบประมาณรวมทั้งสิ้น</span>
                <span className="font-bold text-gray-800">{fmt(totalBudget)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">ราคาสัญญารวม</span>
                <span className="font-semibold text-gray-700">{fmt(totalContract)}</span>
              </div>
              <div className="flex justify-between text-sm pt-1.5 border-t border-gray-200">
                <span className="text-gray-500">เงินเหลือจ่ายรวม</span>
                <span className="font-bold text-green-600">{fmt(totalBudget - totalContract)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* ── Year list view ── */
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-800">รายงาน</h2>
        <p className="text-sm text-gray-400">รายงานสรุปโครงการแยกตามปีงบประมาณ</p>
      </div>

      {years.length === 0 ? (
        <p className="text-center py-20 text-gray-400 text-sm">ยังไม่มีข้อมูลโครงการ</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {years.map(year => {
            const rows = byYear[year]
            const total = rows.reduce((s, p) => s + (Number(p.budget_amount) || 0), 0)
            return (
              <div key={year} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3 hover:shadow-md transition-shadow">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <BarChart2 size={20} className="text-blue-400" />
                  </div>
                  <h3 className="font-bold text-gray-800">ปีงบประมาณ {year}</h3>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">จำนวนโครงการ</span>
                    <span className="font-semibold text-gray-800">{rows.length} โครงการ</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">วงเงินรวม</span>
                    <span className="font-semibold text-gray-800">{fmt(total)}</span>
                  </div>
                </div>
                <button onClick={() => setSelectedYear(year)}
                  className="text-sm font-semibold hover:underline transition-colors"
                  style={{ color: 'var(--color-primary)' }}>
                  ดูรายงาน →
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
