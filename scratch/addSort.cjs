const fs = require('fs');
const path = 'src/pages/AdminDashboard.jsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add sortConfig state
if (!content.includes('const [sortConfig, setSortConfig]')) {
  content = content.replace(
    "const [viewingUser, setViewingUser] = useState(null)",
    "const [viewingUser, setViewingUser] = useState(null)\n  const [sortConfig, setSortConfig] = useState({ key: 'created_at', direction: 'desc' })"
  );
}

// 2. Add handleSort function and update filtered
const oldFiltered = `  const filtered = users.filter((u) => {
    const q = search.toLowerCase()
    const matchSearch = !q || (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.phone || '').includes(q)
    const matchRole = !filterRole || u.role === filterRole
    return matchSearch && matchRole
  })`;

const newFiltered = `  const handleSort = (key) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }))
  }

  const filtered = users.filter((u) => {
    const q = search.toLowerCase()
    const matchSearch = !q || (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.phone || '').includes(q)
    const matchRole = !filterRole || u.role === filterRole
    return matchSearch && matchRole
  }).sort((a, b) => {
    const { key, direction } = sortConfig;
    let aVal = a[key] || '';
    let bVal = b[key] || '';
    
    // Sort logically for text, case insensitive
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();

    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  })`;

if (content.includes(oldFiltered)) {
  content = content.replace(oldFiltered, newFiltered);
}

// 3. Update table headers
const oldThead = `<thead className="text-xs text-gray-500 uppercase bg-gray-50/80 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 font-medium">ลำดับ</th>
                <th className="px-4 py-3 font-medium">ชื่อ-นามสกุล</th>
                <th className="px-4 py-3 font-medium min-w-[150px]">ที่อยู่</th>
                <th className="px-4 py-3 font-medium">ตำแหน่ง</th>
                <th className="px-4 py-3 font-medium">วันที่สมัคร</th>
                <th className="px-4 py-3 font-medium min-w-[200px]">จัดการ</th>
              </tr>
            </thead>`;

const newThead = `<thead className="text-xs text-gray-500 uppercase bg-gray-50/80 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 font-medium">ลำดับ</th>
                <th className="px-4 py-3 font-medium cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('full_name')}>
                  <div className="flex items-center gap-1">ชื่อ-นามสกุล {sortConfig.key === 'full_name' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}</div>
                </th>
                <th className="px-4 py-3 font-medium min-w-[150px] cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('address')}>
                  <div className="flex items-center gap-1">ที่อยู่ {sortConfig.key === 'address' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}</div>
                </th>
                <th className="px-4 py-3 font-medium cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('job_title')}>
                  <div className="flex items-center gap-1">ตำแหน่ง {sortConfig.key === 'job_title' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}</div>
                </th>
                <th className="px-4 py-3 font-medium cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => handleSort('created_at')}>
                  <div className="flex items-center gap-1">วันที่สมัคร {sortConfig.key === 'created_at' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}</div>
                </th>
                <th className="px-4 py-3 font-medium min-w-[200px]">จัดการ</th>
              </tr>
            </thead>`;

if (content.includes(oldThead)) {
  content = content.replace(oldThead, newThead);
}

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully added sorting to AdminDashboard.jsx');
