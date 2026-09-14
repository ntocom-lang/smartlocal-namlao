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

import path from 'path'
import {
  bashWriteTargets,
  destructiveGitCommands,
  isInside,
  normalizeShellPath,
  toolGitCommands,
  toolTargets,
} from '../scripts/guard-master-tree.mjs'

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
check('PowerShell อ่านอย่างเดียว', bashWriteTargets('Get-Content src/a.js | Select-Object -First 5'), [])
check('ชื่อ cmdlet เป็นแค่คำค้นของ grep', bashWriteTargets('grep -rn Remove-Item src/lib/a.js'), [])
check('; ในโค้ด node -e ไม่ใช่ตัวแบ่งคำสั่ง', bashWriteTargets('node -e "a(); cd(1)" && echo ok'), [])
check(
  'เนื้อ heredoc ของข้อความ commit ไม่ใช่คำสั่ง',
  bashWriteTargets("git commit -F - <<'EOF'\nแก้ a > b.js\ncd x && rm src/a.js\nEOF"),
  [],
)

console.log('\ncd ก่อนเขียน — ต้องต่อโฟลเดอร์ให้ถูก')
// เคสจริง 2026-09-14: เขียนดัชนีความจำใน ~/.claude โดน hook อ่านเป็น MEMORY.md ที่รากทรีหลัก
check(
  'cd ไปโฟลเดอร์ความจำ',
  bashWriteTargets('cd "/c/Users/me/.claude/projects/x/memory" && printf a >> MEMORY.md'),
  ['/c/Users/me/.claude/projects/x/memory/MEMORY.md'],
)
check('cd ไป worktree', bashWriteTargets('cd /d/tmp/wt-x && echo a > src/a.js'), ['/d/tmp/wt-x/src/a.js'])
check('cd โฟลเดอร์ย่อยต่อกัน 2 ครั้ง', bashWriteTargets('cd src; cd lib && echo a > a.js'), ['src/lib/a.js'])
check('ปลายทาง absolute ไม่ต่อกับ cd', bashWriteTargets('cd src && echo a > /d/tmp/a.js'), ['/d/tmp/a.js'])
check('cd - ถอยไปใช้ cwd ของ session', bashWriteTargets('cd /d/tmp && cd - && echo a > src/a.js'), ['src/a.js'])
check('Set-Location ของ PowerShell', bashWriteTargets("Set-Location 'D:\\tmp\\wt-x'; 'a' > src\\a.js"), ['D:\\tmp\\wt-x/src\\a.js'])
check('cd ในเครื่องหมายคำพูดไม่ใช่ cd จริง', bashWriteTargets('echo "cd /d/tmp" && echo a > src/a.js'), ['src/a.js'])

console.log('\ncmdlet PowerShell ที่เขียน/ลบไฟล์ — ต้องจับได้')
check('Set-Content -Path', bashWriteTargets('Set-Content -Path src/a.js -Value 1'), ['src/a.js'])
check('Set-Content ตามตำแหน่ง', bashWriteTargets("Set-Content src/a.js 'x'"), ['src/a.js'])
check('Out-File หลัง pipe', bashWriteTargets('"x" | Out-File -Encoding utf8 src\\a.js'), ['src\\a.js'])
check('Remove-Item พร้อมสวิตช์', bashWriteTargets('Remove-Item -Recurse -Force src/old'), ['src/old'])
check('New-Item -ItemType', bashWriteTargets('New-Item -ItemType File -Path src/a.js'), ['src/a.js'])
check('Copy-Item เอาปลายทาง', bashWriteTargets('Copy-Item a.txt src/b.txt'), ['src/b.txt'])
check('Move-Item -Destination', bashWriteTargets('Move-Item -Path a.txt -Destination src/b.txt'), ['src/b.txt'])
check('here-string แล้ว pipe เข้า Out-File', bashWriteTargets("@'\ncd x\n'@ | Out-File src/a.js"), ['src/a.js'])

// ผลเป็น "โฟลเดอร์|คำสั่ง" — โฟลเดอร์ว่าง = cwd ของ session
const gitHits = (command) => destructiveGitCommands(command).map((g) => `${g.dir}|${g.command}`)

console.log('\nคำสั่ง git ที่ทำงานค้างหาย — ต้องจับได้')
check('reset --hard', gitHits('git reset --hard origin/master'), ['|git reset --hard origin/master'])
check('checkout -- ไฟล์', gitHits('git checkout -- src/App.jsx'), ['|git checkout -- src/App.jsx'])
check('checkout . ทั้งทรี', gitHits('git checkout .'), ['|git checkout .'])
check('checkout สลับสาขา', gitHits('git checkout feat/x'), ['|git checkout feat/x'])
check('switch -c', gitHits('git switch -c feat/x'), ['|git switch -c feat/x'])
check('restore ไฟล์', gitHits('git restore src/App.jsx'), ['|git restore src/App.jsx'])
check('restore --staged --worktree', gitHits('git restore --staged --worktree a.js'), ['|git restore --staged --worktree a.js'])
check('clean -fd', gitHits('git clean -fd'), ['|git clean -fd'])
check('stash เปล่า', gitHits('git stash'), ['|git stash'])
check('stash -u', gitHits('git stash -u'), ['|git stash -u'])
check('stash pop', gitHits('git stash pop'), ['|git stash pop'])
check('หลัง && และ git -c', gitHits('git fetch && git -c core.x=1 reset --hard'), ['|git reset --hard'])
check('ต่อโฟลเดอร์จาก cd', gitHits('cd /d/tmp/wt-x && git stash'), ['/d/tmp/wt-x|git stash'])
check('ต่อโฟลเดอร์จาก git -C', gitHits('git -C "/d/VS Code/main" reset --hard'), ['/d/VS Code/main|git reset --hard'])
check('PowerShell เรียก git.exe', gitHits('git.exe checkout -- a.js; Get-ChildItem'), ['|git checkout -- a.js'])

console.log('\nคำสั่ง git ที่ไม่ทำงานหาย — ห้ามจับ')
check('pull --ff-only', gitHits('git pull --ff-only'), [])
check('reset ธรรมดา (ถอนจาก index)', gitHits('git reset HEAD a.js'), [])
check('checkout เปล่า', gitHits('git checkout'), [])
check('restore --staged อย่างเดียว', gitHits('git restore --staged a.js'), [])
check('clean -n (ลองดู)', gitHits('git clean -nfd'), [])
check('stash list', gitHits('git stash list'), [])
check('stash show -p', gitHits('git stash show -p'), [])
check('worktree add', gitHits('git worktree add /d/tmp/wt-x -b feat/x origin/master'), [])
check('คำสั่งอันตรายอยู่ในข้อความ commit', gitHits('git commit -m "อย่ารัน git reset --hard; git stash"'), [])
check(
  'คำสั่งอันตรายอยู่ใน heredoc ของ commit',
  gitHits("git commit -F - <<'EOF'\ngit reset --hard\ngit checkout -- a.js\nEOF"),
  [],
)
check('echo ข้อความ', gitHits('echo git stash'), [])
check('Write ไม่ใช่คำสั่ง shell', toolGitCommands({ tool_name: 'Write', tool_input: { command: 'git stash' } }), [])
check(
  'PowerShell payload',
  toolGitCommands({ tool_name: 'PowerShell', tool_input: { command: 'git stash' } }).map((g) => g.command),
  ['git stash'],
)

console.log('\nแปลง path แบบ shell')
const win = { home: 'C:\\Users\\me', platform: 'win32' }
check('~ เป็น home', [normalizeShellPath('~/.claude/a.md', win)], ['C:\\Users\\me/.claude/a.md'])
check('$HOME เป็น home', [normalizeShellPath('$HOME/.claude/a.md', win)], ['C:\\Users\\me/.claude/a.md'])
check('Git Bash /d/... เป็น D:/...', [normalizeShellPath('/d/VS Code/x/src/a.js', win)], ['D:/VS Code/x/src/a.js'])
check('~ กลางชื่อไม่แปลง', [normalizeShellPath('src/~backup.js', win)], ['src/~backup.js'])
check('/d/... บน Linux ไม่แปลง', [normalizeShellPath('/d/tmp/a.js', { home: '/home/me', platform: 'linux' })], ['/d/tmp/a.js'])

console.log('\nอยู่ในทรีหลักหรือไม่')
const root = path.resolve('/repo/main')
check('ไฟล์ในทรีหลัก', [isInside(root, path.resolve(root, 'src/a.js'))], [true])
check('worktree ข้างนอก', [isInside(root, path.resolve('/tmp/wt-x/src/a.js'))], [false])
check('โฟลเดอร์ชื่อขึ้นต้นเหมือนกัน', [isInside(root, path.resolve('/repo/main-old/a.js'))], [false])
check('รากทรีหลักเอง', [isInside(root, root)], [false])

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
