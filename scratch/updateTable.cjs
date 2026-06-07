const fs = require('fs');

const path = 'src/pages/AdminDashboard.jsx';
let content = fs.readFileSync(path, 'utf8');

const targetStart = `<div className="divide-y divide-gray-50">\n          {filtered.map((u, i) => {`;
const targetEnd = `              </div>\n            )\n          })}\n        </div>`;

const startIndex = content.indexOf(targetStart);
if (startIndex === -1) {
  console.log("Could not find target start");
  process.exit(1);
}
const endIndex = content.indexOf(targetEnd, startIndex);
if (endIndex === -1) {
  console.log("Could not find target end");
  process.exit(1);
}

const originalList = content.substring(startIndex, endIndex + targetEnd.length);

const mobileView = originalList.replace('<div className="divide-y divide-gray-50">', '<div className="md:hidden divide-y divide-gray-50">');

const desktopTable = `
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-600">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50/80 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 font-medium">ลำดับ</th>
                <th className="px-4 py-3 font-medium">ชื่อ-นามสกุล</th>
                <th className="px-4 py-3 font-medium min-w-[150px]">ที่อยู่</th>
                <th className="px-4 py-3 font-medium">ตำแหน่ง</th>
                <th className="px-4 py-3 font-medium">วันที่สมัคร</th>
                <th className="px-4 py-3 font-medium min-w-[200px]">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((u, i) => {
                const rs = ROLE_LABELS[u.role] ?? ROLE_LABELS.citizen
                return (
                  <tr key={u.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">{i + 1}</td>
                    <td className="px-4 py-3 min-w-[200px]">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                             style={{ backgroundColor: rs.color }}>
                          {(u.full_name || u.email || '?')[0].toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          {editingNameId === u.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                autoFocus
                                value={editingNameValue}
                                onChange={(e) => setEditingNameValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') updateName(u.id); if (e.key === 'Escape') setEditingNameId(null) }}
                                placeholder="ชื่อ-นามสกุล"
                                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                              />
                              <button onClick={() => updateName(u.id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium">บันทึก</button>
                              <button onClick={() => setEditingNameId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-medium text-gray-800">{u.full_name || '—'}</span>
                              {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && u.role !== 'superadmin' && (
                                <button onClick={() => { setEditingNameId(u.id); setEditingNameValue(u.full_name || '') }} className="text-gray-300 hover:text-gray-500">
                                  <Pencil size={12} />
                                </button>
                              )}
                            </div>
                          )}
                          <span className="text-xs text-gray-400 truncate">{u.email || u.phone || '—'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {editingAddressId === u.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={editingAddressValue}
                            onChange={(e) => setEditingAddressValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') updateAddress(u.id); if (e.key === 'Escape') setEditingAddressId(null) }}
                            placeholder="ที่อยู่"
                            className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                          />
                          <button onClick={() => updateAddress(u.id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium">บันทึก</button>
                          <button onClick={() => setEditingAddressId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs">{u.address || <span className="italic text-gray-300">ยังไม่ระบุ</span>}</span>
                          {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && u.role !== 'superadmin' && (
                            <button onClick={() => { setEditingAddressId(u.id); setEditingAddressValue(u.address || '') }} className="text-gray-300 hover:text-gray-500">
                              <Pencil size={11} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 min-w-[180px]">
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: rs.bg, color: rs.color }}>
                          {rs.label}
                        </span>
                        {editingPositionId === u.id ? (
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              autoFocus
                              value={editingPositionValue}
                              onChange={(e) => setEditingPositionValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') updatePosition(u.id); if (e.key === 'Escape') setEditingPositionId(null) }}
                              placeholder="ตำแหน่งงาน"
                              className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                            />
                            <button onClick={() => updatePosition(u.id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium">บันทึก</button>
                            <button onClick={() => setEditingPositionId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <span>{u.job_title || <span className="italic text-gray-300">ไม่มีตำแหน่ง</span>}</span>
                            {(currentUserRole === 'admin' || currentUserRole === 'superadmin') && u.role !== 'superadmin' && (
                              <button onClick={() => { setEditingPositionId(u.id); setEditingPositionValue(u.job_title || '') }} className="text-gray-300 hover:text-gray-500">
                                <Pencil size={11} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-400">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button className="text-xs text-blue-500 hover:text-blue-700 font-medium px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded transition-colors whitespace-nowrap">
                          ดูรายละเอียด
                        </button>
                        {u.role !== 'superadmin' && (currentUserRole === 'superadmin' || currentUserRole === 'admin') && (
                          <div className="flex items-center gap-2">
                            <select
                              value={u.role}
                              disabled={saving === u.id}
                              onChange={(e) => updateRole(u.id, e.target.value, u.municipality_id)}
                              className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700 focus:outline-none bg-white cursor-pointer"
                            >
                              <option value="citizen">สมาชิก</option>
                              <option value="viewer">ผู้บริหาร</option>
                              <option value="council">สภาเทศบาล</option>
                              <option value="officer">เจ้าหน้าที่</option>
                              <option value="technician">ช่าง</option>
                              <option value="admin">แอดมิน</option>
                              {currentUserRole === 'superadmin' && <option value="superadmin">Super Admin</option>}
                            </select>
                            {saving === u.id && <Loader2 size={12} className="animate-spin text-gray-400" />}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>`;

const newCode = `<>
        ${mobileView}
        ${desktopTable}
      </>`;

content = content.substring(0, startIndex) + newCode + content.substring(endIndex + targetEnd.length);

fs.writeFileSync(path, content, 'utf8');
console.log("Successfully updated AdminDashboard.jsx");
