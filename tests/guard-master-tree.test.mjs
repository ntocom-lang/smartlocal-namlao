// เทสต์ตัวแยก "ไฟล์ปลายทางที่จะถูกเขียน" ของ scripts/guard-master-tree.mjs
//
// ทำไมต้องมี: ด่านนี้ขวางทุกคำสั่ง Bash ที่ agent ยิง ถ้าจับผิดเป็น false positive
// จะบล็อกคำสั่งที่แค่อ่านอย่างเดียว แล้วงานเดินต่อไม่ได้ทั้ง session
// (เกิดจริงชั่วโมงแรกที่เปิดใช้: `=>` ในโค้ด JS โดนอ่านเป็น redirect `>`)
//
// เทสต์เฉพาะส่วน parse — ส่วนที่เรียก git (ทรีหลักหรือ worktree, สาขาอะไร)
// ต้องมี repo จริงถึงจะทดสอบได้ ไม่เอามาปนในเทสต์ที่ต้องรันได้ทุกเครื่อง
//
// รัน: npm run test:guard

import assert from 'assert'
import { bashWriteTargets, toolTargets } from '../scripts/guard-master-tree.mjs'

let failed = 0
function check(name, actual, expected) {
  const a = JSON.stringify([...actual].sort())
  const e = JSON.stringify([...expected].sort())
  if (a === e) {
    console.log(`  ok    ${name}`)
  } else {
    failed += 1
    console.error(`  FAIL  ${name}\n        ได้: ${a}\n        ควรได้: ${e}`)
  }
}

console.log('คำสั่งที่เขียนไฟล์ — ต้องจับได้')
check('redirect สร้างไฟล์', bashWriteTargets('cat > src/pages/New.jsx <<EOF'), ['src/pages/New.jsx'])
check('redirect ต่อท้าย', bashWriteTargets('echo x >> notes.md'), ['notes.md'])
check('redirect ไม่เว้นวรรค', bashWriteTargets('echo x >notes.md'), ['notes.md'])
check('sed แก้ในที่', bashWriteTargets("sed -i 's/a/b/' src/lib/documentTypes.js"), ['src/lib/documentTypes.js'])
check('tee', bashWriteTargets('echo x | tee src/config.js'), ['src/config.js'])
check('cp ปลายทาง', bashWriteTargets('cp a.txt src/b.txt'), ['src/b.txt'])
check('mv ปลายทาง', bashWriteTargets('mv a.txt src/b.txt'), ['src/b.txt'])
check('rm', bashWriteTargets('rm tests/water-supply-print.test.mjs'), ['tests/water-supply-print.test.mjs'])
check('ปลายทางมีเครื่องหมายคำพูด', bashWriteTargets('cat > "src/a b.js"'), ['src/a b.js'])

console.log('\nคำสั่งที่ไม่ได้เขียนอะไร — ห้ามจับ')
check('stderr เข้า stdout', bashWriteTargets('npm run build 2>&1 | tail -5'), [])
check('stderr ทิ้ง (2> ไม่ใช่ redirect ที่หวง)', bashWriteTargets('git status 2>/dev/null'), [])
check('เทียบมากกว่าในโค้ด', bashWriteTargets('node -e "if (a > b) {}"'), [])
check('ตัวแปรสั้นไม่มีนามสกุล', bashWriteTargets('node -e "x > y"'), [])
check('arrow function', bashWriteTargets("node -e \"p.on('end',()=>{const j=1})\""), [])
check('arrow ต่อกับตัวแปร', bashWriteTargets("node -e \"s.on('data',d=>s+=d)\""), [])
check('ลูกศร ->', bashWriteTargets('echo "a -> b"'), [])
check('มากกว่าเท่ากับ', bashWriteTargets('node -e "x >= 1"'), [])
check('git ธรรมดา', bashWriteTargets('git status --short'), [])

console.log('\nการอ่าน payload ของ hook')
check('Write อ่าน file_path', toolTargets({ tool_name: 'Write', tool_input: { file_path: 'src/App.jsx' } }), ['src/App.jsx'])
check('Edit อ่าน file_path', toolTargets({ tool_name: 'Edit', tool_input: { file_path: 'src/App.jsx' } }), ['src/App.jsx'])
check('NotebookEdit อ่าน notebook_path', toolTargets({ tool_name: 'NotebookEdit', tool_input: { notebook_path: 'a.ipynb' } }), ['a.ipynb'])
check('Read ไม่ใช่ tool ที่เขียน', toolTargets({ tool_name: 'Read', tool_input: { file_path: 'src/App.jsx' } }), [])
check('tool_input ว่าง', toolTargets({ tool_name: 'Write' }), [])

if (failed) {
  console.error(`\n${failed} เคสไม่ผ่าน`)
  process.exit(1)
}
console.log('\nผ่านทุกเคส')
