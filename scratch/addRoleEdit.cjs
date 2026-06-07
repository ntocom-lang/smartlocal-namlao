const fs = require('fs');
const path = 'src/pages/AdminDashboard.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add state variable
if (!content.includes('const [editingRoleId, setEditingRoleId]')) {
  content = content.replace(
    "const [editingAddressValue, setEditingAddressValue] = useState('')",
    "const [editingAddressValue, setEditingAddressValue] = useState('')\n  const [editingRoleId, setEditingRoleId] = useState(null)\n  const [editingRoleValue, setEditingRoleValue] = useState('')"
  );
}

// 2. Update updateRole function
const oldUpdateRole = `  async function updateRole(userId, newRole, municipalityId) {
    setSaving(userId)
    const needsMuni = ['admin', 'technician', 'officer', 'viewer', 'council'].includes(newRole)
    const muni = needsMuni ? (municipalityId || tenant?.id) : null
    const { error } = await supabase.from('profiles').update({ role: newRole, municipality_id: muni }).eq('id', userId)
    if (error) {
      console.error('updateRole failed:', error.message)
      alert(\`บันทึกผิดพลาด: \${error.message}\`)
    } else {
      setUsers((prev) => prev.map((u) =>
        u.id === userId ? { ...u, role: newRole, municipality_id: muni } : u
      ))
    }
    setSaving(null)
  }`;

const newUpdateRole = `  async function updateRole(userId, newRole, municipalityId) {
    setSaving(userId)
    const needsMuni = ['admin', 'technician', 'officer', 'viewer', 'council'].includes(newRole)
    const muni = needsMuni ? (municipalityId || tenant?.id) : null
    const { error } = await supabase.from('profiles').update({ role: newRole, municipality_id: muni }).eq('id', userId)
    if (error) {
      console.error('updateRole failed:', error.message)
      alert(\`บันทึกผิดพลาด: \${error.message}\`)
    } else {
      setUsers((prev) => prev.map((u) =>
        u.id === userId ? { ...u, role: newRole, municipality_id: muni } : u
      ))
      setEditingRoleId(null)
    }
    setSaving(null)
  }`;

if (content.includes(oldUpdateRole)) {
  content = content.replace(oldUpdateRole, newUpdateRole);
}

// 3. Update the Desktop Select (search around line 1285)
const oldDesktopSelect = `                          <div className="flex items-center gap-2">
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
                          </div>`;

const newDesktopSelect = `                          <div className="flex items-center gap-2">
                            {editingRoleId === u.id ? (
                              <>
                                <select
                                  value={editingRoleValue}
                                  disabled={saving === u.id}
                                  onChange={(e) => setEditingRoleValue(e.target.value)}
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
                                <button onClick={() => updateRole(u.id, editingRoleValue, u.municipality_id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium">ยืนยัน</button>
                                <button onClick={() => setEditingRoleId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                                {saving === u.id && <Loader2 size={12} className="animate-spin text-gray-400" />}
                              </>
                            ) : (
                              <button onClick={() => { setEditingRoleId(u.id); setEditingRoleValue(u.role) }} className="text-xs text-gray-500 hover:text-gray-700 font-medium px-2 py-1 bg-gray-50 hover:bg-gray-100 rounded transition-colors whitespace-nowrap">
                                เปลี่ยนบทบาท
                              </button>
                            )}
                          </div>`;

if (content.includes(oldDesktopSelect)) {
  content = content.replace(oldDesktopSelect, newDesktopSelect);
}

// 4. Update the Mobile Select (search around line 1058)
const oldMobileSelect = `                  <div className="flex items-center gap-2 pl-[68px] mt-1 justify-start">
                    <select
                      value={u.role}
                      disabled={saving === u.id}
                      onChange={(e) => updateRole(u.id, e.target.value, u.municipality_id)}
                      className="text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-gray-700 focus:outline-none bg-gray-50"
                    >
                      <option value="citizen">สมาชิก</option>
                      <option value="viewer">ผู้บริหาร</option>
                      <option value="council">สภาเทศบาล</option>
                      <option value="officer">เจ้าหน้าที่</option>
                      <option value="technician">ช่าง</option>
                      <option value="admin">แอดมิน</option>
                      {currentUserRole === 'superadmin' && <option value="superadmin">Super Admin</option>}
                    </select>
                    {saving === u.id && <Loader2 size={14} className="animate-spin text-gray-400 shrink-0" />}
                  </div>`;

const newMobileSelect = `                  <div className="flex items-center gap-2 pl-[68px] mt-1 justify-start">
                    {editingRoleId === u.id ? (
                      <>
                        <select
                          value={editingRoleValue}
                          disabled={saving === u.id}
                          onChange={(e) => setEditingRoleValue(e.target.value)}
                          className="text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-gray-700 focus:outline-none bg-gray-50"
                        >
                          <option value="citizen">สมาชิก</option>
                          <option value="viewer">ผู้บริหาร</option>
                          <option value="council">สภาเทศบาล</option>
                          <option value="officer">เจ้าหน้าที่</option>
                          <option value="technician">ช่าง</option>
                          <option value="admin">แอดมิน</option>
                          {currentUserRole === 'superadmin' && <option value="superadmin">Super Admin</option>}
                        </select>
                        <button onClick={() => updateRole(u.id, editingRoleValue, u.municipality_id)} disabled={saving === u.id} className="text-xs text-blue-600 font-medium px-2">ยืนยัน</button>
                        <button onClick={() => setEditingRoleId(null)} className="text-xs text-gray-400">ยกเลิก</button>
                        {saving === u.id && <Loader2 size={14} className="animate-spin text-gray-400 shrink-0" />}
                      </>
                    ) : (
                      <button onClick={() => { setEditingRoleId(u.id); setEditingRoleValue(u.role) }} className="text-xs text-gray-500 hover:text-gray-700 font-medium px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors whitespace-nowrap">
                        เปลี่ยนบทบาท
                      </button>
                    )}
                  </div>`;

if (content.includes(oldMobileSelect)) {
  content = content.replace(oldMobileSelect, newMobileSelect);
}

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully added Role Edit Button to AdminDashboard.jsx');
