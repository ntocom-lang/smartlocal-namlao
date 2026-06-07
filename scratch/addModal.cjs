const fs = require('fs');
const path = 'src/pages/AdminDashboard.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add state variable
if (!content.includes('const [viewingUser, setViewingUser] = useState(null)')) {
  content = content.replace(
    "const [editingAddressValue, setEditingAddressValue] = useState('')",
    "const [editingAddressValue, setEditingAddressValue] = useState('')\n  const [viewingUser, setViewingUser] = useState(null)"
  );
}

// 2. Add Modal UI at the bottom of the UserManager component, right before the last closing div of the UserManager return.
// The UserManager return ends with:
//         </div>
//       )}
//     </div>
//   )
// }
// We can find that by looking for "// ─── Emergency Contacts Manager" and going backwards.

const modalJSX = `
      {/* View User Details Modal */}
      {viewingUser && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4" onClick={() => setViewingUser(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">รายละเอียดผู้ใช้งาน</h3>
              <button onClick={() => setViewingUser(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white shrink-0"
                     style={{ backgroundColor: (ROLE_LABELS[viewingUser.role] || ROLE_LABELS.citizen).color }}>
                  {(viewingUser.full_name || viewingUser.email || '?')[0].toUpperCase()}
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-gray-900">{viewingUser.full_name || '—'}</h4>
                  <span className="text-sm font-medium px-2.5 py-0.5 rounded-full mt-1 inline-block"
                        style={{ backgroundColor: (ROLE_LABELS[viewingUser.role] || ROLE_LABELS.citizen).bg, color: (ROLE_LABELS[viewingUser.role] || ROLE_LABELS.citizen).color }}>
                    {(ROLE_LABELS[viewingUser.role] || ROLE_LABELS.citizen).label}
                  </span>
                </div>
              </div>
              
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-500 mb-1">ตำแหน่งงาน</p>
                  <p className="text-sm text-gray-800 bg-gray-50 px-3 py-2 rounded-lg">{viewingUser.job_title || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">อีเมล</p>
                  <p className="text-sm text-gray-800 bg-gray-50 px-3 py-2 rounded-lg break-all">{viewingUser.email || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">เบอร์โทรศัพท์</p>
                  <p className="text-sm text-gray-800 bg-gray-50 px-3 py-2 rounded-lg">{viewingUser.phone || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">ที่อยู่</p>
                  <p className="text-sm text-gray-800 bg-gray-50 px-3 py-2 rounded-lg whitespace-pre-wrap">{viewingUser.address || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">วันที่สมัคร</p>
                  <p className="text-sm text-gray-800 bg-gray-50 px-3 py-2 rounded-lg">
                    {viewingUser.created_at ? new Date(viewingUser.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end">
              <button onClick={() => setViewingUser(null)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors text-sm">
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}`;

if (!content.includes('รายละเอียดผู้ใช้งาน')) {
  const targetComponentEnd = "    </div>\n  )\n}\n\n// ─── Emergency Contacts Manager";
  content = content.replace(targetComponentEnd, modalJSX + "\n" + targetComponentEnd);
}

// 3. Desktop Button
content = content.replace(
  '<button className="text-xs text-blue-500 hover:text-blue-700 font-medium px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded transition-colors whitespace-nowrap">\n                          ดูรายละเอียด\n                        </button>',
  '<button onClick={() => setViewingUser(u)} className="text-xs text-blue-500 hover:text-blue-700 font-medium px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded transition-colors whitespace-nowrap">\n                          ดูรายละเอียด\n                        </button>'
);

// 4. Mobile Button
// Find the location to insert in mobile view: right after the role dropdown in mobile layout.
// Specifically around:
// {saving === u.id && <Loader2 size={14} className="animate-spin text-gray-400 shrink-0" />}
//                   </div>
//                 )}
// I'll add a separate div for mobile action buttons.
const mobileDropdownEnd = '{saving === u.id && <Loader2 size={14} className="animate-spin text-gray-400 shrink-0" />}\n                  </div>\n                )}';
const mobileActions = `\n                <div className="flex items-center gap-2 pl-[68px] mt-1">
                  <button onClick={() => setViewingUser(u)} className="text-[11px] text-blue-500 hover:text-blue-700 font-medium px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded transition-colors">
                    ดูรายละเอียด
                  </button>
                </div>`;

if (!content.includes('ดูรายละเอียด') || content.indexOf('ดูรายละเอียด') === content.lastIndexOf('ดูรายละเอียด')) {
  // It only contains the desktop one (or none if previous replace failed). We need to insert the mobile one.
  content = content.replace(mobileDropdownEnd, mobileDropdownEnd + mobileActions);
}

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully updated AdminDashboard.jsx');
