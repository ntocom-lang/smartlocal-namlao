// เทสต์ handoff / resume ข้ามเครื่อง ด้วย repo ชั่วคราวล้วนๆ — ไม่แตะ repo จริง ไม่ใช้เน็ต
//
//   npm run test:memory-sync
//
// ทุกข้อจำลองเหตุการณ์ที่เกิดจริงมาแล้ว (ดู docs/ai/DEVSETUP.md หัวข้อกิจวัตรประจำวัน)
//   - handoff บน master หยุดก่อนถึงขั้นเก็บ memory ⇒ memory ค้างบน PC 10 ไฟล์ (2026-09-26 → 28)
//   - อีกเครื่อง push ไปก่อน ⇒ push ถูกปฏิเสธ · MEMORY.md ทั้ง 2 เครื่องต่อบรรทัดท้ายไฟล์
//   - resume ใช้ไม่ได้เพราะภาพหน้าจอ untracked ที่ session อื่นทิ้งไว้ในทรีหลัก
//
// ⚠️ ตาม [SAFETY] agent ห้ามรัน handoff/resume กับ repo จริง — ไฟล์นี้คือทางทดสอบที่ถูกต้อง
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')

// ตัด config ของเครื่องจริงออกทั้งหมด (autocrlf / pull.rebase / credential helper / ชื่อผู้ commit)
// และลบตัวแปรที่ชี้ repo จริง — ถ้าหลุดไป เทสต์จะ commit + push ลง devconfig ของจริง
function isolatedEnv(base, extra = {}) {
  const globalCfg = join(base, 'gitconfig-global')
  if (!existsSync(globalCfg)) writeFileSync(globalCfg, '')
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalCfg,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    GIT_TERMINAL_PROMPT: '0',
    SMARTLOCAL_CODEX_MEMORY: join(base, 'no-codex'), // ค่าปริยาย = เครื่องที่ไม่ได้ลง Codex
    ...extra,
  }
  delete env.SMARTLOCAL_DEVCONFIG // ให้หา devconfig จาก "ข้างทรีหลัก" แบบของจริง
  return env
}

function makeGit(env) {
  return (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} @ ${cwd}\n${r.stderr}`)
    return r.stdout.trim()
  }
}

/**
 * โลกจำลอง: remote 2 ตัว (repo หลัก + devconfig แบบ bare = GitHub) กับเครื่อง A และ B
 * แต่ละเครื่องมีทรีหลักชื่อ smartlocal และ devconfig อยู่ข้างๆ — เหมือนโครงบน PC/โน้ตบุคจริง
 */
function makeWorld(t, { autocrlf = 'false', attributes = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'memsync-'))
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 3 }))
  const env = isolatedEnv(base)
  const g = makeGit(env)

  const mainRemote = join(base, 'main.git')
  const cfgRemote = join(base, 'devconfig.git')
  g(base, 'init', '-q', '--bare', '-b', 'master', mainRemote)
  g(base, 'init', '-q', '--bare', '-b', 'master', cfgRemote)

  const cfgSeed = join(base, 'cfg-seed')
  g(base, 'clone', '-q', cfgRemote, cfgSeed)
  mkdirSync(join(cfgSeed, 'claude-memory'))
  mkdirSync(join(cfgSeed, 'env'))
  writeFileSync(join(cfgSeed, 'claude-memory', 'MEMORY.md'), '- [หนึ่ง](one.md) — เดิม\n- [สอง](two.md) — เดิม\n')
  writeFileSync(join(cfgSeed, 'claude-memory', 'topic.md'), 'บรรทัดเดิม\n')
  writeFileSync(join(cfgSeed, 'env', '.env.local'), 'VITE_X=1\n')
  if (attributes) writeFileSync(join(cfgSeed, '.gitattributes'), 'claude-memory/MEMORY.md merge=union\n')
  g(cfgSeed, 'add', '-A')
  g(cfgSeed, 'commit', '-q', '-m', 'seed')
  g(cfgSeed, 'push', '-q', 'origin', 'master')

  const mainSeed = join(base, 'main-seed')
  g(base, 'clone', '-q', mainRemote, mainSeed)
  writeFileSync(join(mainSeed, 'README.md'), 'hello\n')
  g(mainSeed, 'add', '-A')
  g(mainSeed, 'commit', '-q', '-m', 'init')
  g(mainSeed, 'push', '-q', 'origin', 'master')

  const machine = (name) => {
    const root = join(base, name)
    mkdirSync(root)
    const main = join(root, 'smartlocal')
    const cfg = join(root, 'smartlocal-devconfig')
    g(root, 'clone', '-q', '-c', `core.autocrlf=${autocrlf}`, mainRemote, main)
    g(root, 'clone', '-q', '-c', `core.autocrlf=${autocrlf}`, cfgRemote, cfg)
    return { main, cfg }
  }

  return { base, env, g, mainRemote, cfgRemote, A: machine('A'), B: machine('B') }
}

const runScript = (w, name, cwd, extraEnv = {}) =>
  spawnSync(process.execPath, [join(SCRIPTS, name)], { cwd, env: { ...w.env, ...extraEnv }, encoding: 'utf8' })

const out = (r) => `${r.stdout}\n${r.stderr}`
const remoteFiles = (w) => w.g(w.cfgRemote, 'ls-tree', '-r', '--name-only', 'master')
const remoteShow = (w, path) => w.g(w.cfgRemote, 'show', `master:${path}`)
const pushFromB = (w, files) => {
  for (const [path, text, append] of files) {
    const full = join(w.B.cfg, path)
    if (append) appendFileSync(full, text)
    else writeFileSync(full, text)
  }
  w.g(w.B.cfg, 'add', '-A')
  w.g(w.B.cfg, 'commit', '-q', '-m', 'from B')
  w.g(w.B.cfg, 'push', '-q')
}

/* ── handoff ──────────────────────────────────────────────────────── */

test('handoff บน master: เก็บ memory ขึ้น origin โดยไม่แตะโค้ด และไฟล์ untracked แค่เตือน', (t) => {
  const w = makeWorld(t)
  const { main, cfg } = w.A
  const headBefore = w.g(main, 'rev-parse', 'HEAD')
  writeFileSync(join(main, 'stray.png'), 'x')
  writeFileSync(join(cfg, 'claude-memory', 'new.md'), 'ความรู้ใหม่\n')
  appendFileSync(join(cfg, 'claude-memory', 'MEMORY.md'), '- [ใหม่](new.md) — จากเครื่อง A\n')

  const r = runScript(w, 'handoff.mjs', main)
  assert.equal(r.status, 0, out(r))
  assert.equal(w.g(main, 'rev-parse', 'HEAD'), headBefore, 'ห้ามมี commit ใหม่บน master')
  assert.equal(w.g(main, 'status', '--porcelain'), '?? stray.png', 'ไฟล์ untracked ต้องอยู่ที่เดิม ไม่ถูก commit')
  assert.match(remoteFiles(w), /claude-memory\/new\.md/)
  assert.equal(w.g(cfg, 'status', '--porcelain'), '')
})

test('handoff บน master ที่มีไฟล์แก้ค้าง: exit 1 แต่ memory ต้องขึ้นแล้ว', (t) => {
  const w = makeWorld(t)
  const { main, cfg } = w.A
  const headBefore = w.g(main, 'rev-parse', 'HEAD')
  writeFileSync(join(main, 'README.md'), 'แก้บน master\n')
  writeFileSync(join(cfg, 'claude-memory', 'new.md'), 'ความรู้ใหม่\n')

  const r = runScript(w, 'handoff.mjs', main)
  assert.equal(r.status, 1, out(r))
  assert.match(remoteFiles(w), /claude-memory\/new\.md/, 'memory ต้องขึ้นแม้ส่วนโค้ดไม่ผ่าน')
  assert.equal(w.g(main, 'rev-parse', 'HEAD'), headBefore)
  assert.match(w.g(main, 'status', '--porcelain'), /^M README\.md$/m, 'งานบน master ต้องยังค้างอยู่ ไม่ถูก commit')
})

for (const autocrlf of ['false', 'true']) {
  test(`อีกเครื่อง push ไปก่อน: รวม MEMORY.md ได้ครบทั้ง 2 ฝั่ง (core.autocrlf=${autocrlf})`, (t) => {
    const w = makeWorld(t, { autocrlf })
    pushFromB(w, [
      ['claude-memory/MEMORY.md', '- [บี](b.md) — จากเครื่อง B\n', true],
      ['claude-memory/b.md', 'บี\n'],
    ])
    appendFileSync(join(w.A.cfg, 'claude-memory', 'MEMORY.md'), '- [เอ](a.md) — จากเครื่อง A\n')
    writeFileSync(join(w.A.cfg, 'claude-memory', 'a.md'), 'เอ\n')

    const r = runScript(w, 'handoff.mjs', w.A.main)
    assert.equal(r.status, 0, out(r))
    const merged = remoteShow(w, 'claude-memory/MEMORY.md')
    assert.match(merged, /จากเครื่อง A/)
    assert.match(merged, /จากเครื่อง B/)
    assert.match(merged, /\(one\.md\)/, 'บรรทัดเดิมต้องไม่หาย')
    assert.doesNotMatch(merged, /<<<<<<<|>>>>>>>|=======/)
    assert.match(remoteFiles(w), /claude-memory\/a\.md/)
    assert.match(remoteFiles(w), /claude-memory\/b\.md/)
    assert.equal(w.g(w.A.cfg, 'rev-list', '--left-right', '--count', 'HEAD...@{u}'), '0\t0')
  })
}

test('ไม่มี merge=union: MEMORY.md ชนแล้วต้องยกเลิกเรียบร้อย (พิสูจน์ว่า .gitattributes คือตัวที่ทำให้ข้อก่อนหน้าผ่าน)', (t) => {
  const w = makeWorld(t, { attributes: false })
  pushFromB(w, [['claude-memory/MEMORY.md', '- [บี](b.md) — จากเครื่อง B\n', true]])
  appendFileSync(join(w.A.cfg, 'claude-memory', 'MEMORY.md'), '- [เอ](a.md) — จากเครื่อง A\n')

  const r = runScript(w, 'handoff.mjs', w.A.main)
  assert.equal(r.status, 1, out(r))
  assert.match(r.stdout, /MEMORY\.md/)
})

test('2 เครื่องแก้ไฟล์ memory เดียวกันคนละแบบ: ยกเลิกการรวม ไม่ค้างกลาง rebase ของในเครื่องไม่หาย', (t) => {
  const w = makeWorld(t)
  pushFromB(w, [['claude-memory/topic.md', 'ฉบับเครื่อง B\n']])
  writeFileSync(join(w.A.cfg, 'claude-memory', 'topic.md'), 'ฉบับเครื่อง A\n')

  const r = runScript(w, 'handoff.mjs', w.A.main)
  assert.equal(r.status, 1, out(r))
  assert.match(r.stdout, /topic\.md/)
  const gitDir = join(w.A.cfg, '.git')
  assert.ok(!existsSync(join(gitDir, 'rebase-merge')) && !existsSync(join(gitDir, 'rebase-apply')), 'ห้ามทิ้ง repo ค้างกลาง rebase')
  assert.equal(readFileSync(join(w.A.cfg, 'claude-memory', 'topic.md'), 'utf8').replace(/\r/g, ''), 'ฉบับเครื่อง A\n')
  assert.equal(w.g(w.A.cfg, 'status', '--porcelain'), '', 'ของเครื่อง A ต้อง commit ไว้ในเครื่องแล้ว')
  assert.match(remoteShow(w, 'claude-memory/topic.md'), /ฉบับเครื่อง B/, 'ห้าม push ทับของอีกเครื่อง')
})

test('ติดต่อ origin ไม่ได้: เตือนดังและ exit 1 ไม่จบแบบสำเร็จเงียบๆ', (t) => {
  const w = makeWorld(t)
  w.g(w.A.cfg, 'remote', 'set-url', 'origin', join(w.base, 'missing.git'))
  writeFileSync(join(w.A.cfg, 'claude-memory', 'new.md'), 'ความรู้ใหม่\n')

  const r = runScript(w, 'handoff.mjs', w.A.main)
  assert.equal(r.status, 1, out(r))
  assert.match(r.stdout, /ติดต่อ origin ของ memory ของ Claude ไม่ได้/)
  assert.doesNotMatch(r.stdout, /✅ เรียบร้อย/)
})

test('เจอรูปแบบคีย์จริง: หยุดก่อน commit (ด่านเดิมต้องไม่พัง)', (t) => {
  const w = makeWorld(t)
  // ประกอบตอนรัน ไม่เขียนเป็นก้อนเดียวในไฟล์ — repo นี้เป็น public ตัวสแกนคีย์ของ GitHub จะเข้าใจผิด
  const fakeJwt = ['eyJ', 'a'.repeat(12), '.', 'b'.repeat(12), '.', 'c'.repeat(12)].join('')
  writeFileSync(join(w.A.cfg, 'claude-memory', 'leak.md'), `token ${fakeJwt}\n`)
  const before = w.g(w.A.cfg, 'rev-parse', 'HEAD')

  const r = runScript(w, 'handoff.mjs', w.A.main)
  assert.equal(r.status, 1, out(r))
  assert.match(r.stderr, /leak\.md/)
  assert.equal(w.g(w.A.cfg, 'rev-parse', 'HEAD'), before, 'ห้าม commit')
  assert.doesNotMatch(remoteFiles(w), /leak\.md/)
})

test('handoff บน branch งาน: ส่งทั้งโค้ดและ memory เหมือนเดิม', (t) => {
  const w = makeWorld(t)
  w.g(w.A.main, 'switch', '-q', '-c', 'feat/x')
  writeFileSync(join(w.A.main, 'README.md'), 'งานบน branch\n')
  writeFileSync(join(w.A.cfg, 'claude-memory', 'new.md'), 'ความรู้ใหม่\n')

  const r = runScript(w, 'handoff.mjs', w.A.main)
  assert.equal(r.status, 0, out(r))
  assert.match(w.g(w.mainRemote, 'log', '-1', '--format=%s', 'feat/x'), /^wip\(handoff\):/)
  assert.match(remoteFiles(w), /claude-memory\/new\.md/)
})

test('Codex ไม่มี upstream: เตือนแต่ไม่ทำให้ handoff ล้ม และไม่ commit ลง repo ของ Codex', (t) => {
  const w = makeWorld(t)
  const codex = join(w.base, 'codex-memories')
  mkdirSync(codex)
  w.g(codex, 'init', '-q', '-b', 'master')
  writeFileSync(join(codex, 'MEMORY.md'), 'baseline\n')
  w.g(codex, 'add', '-A')
  w.g(codex, 'commit', '-q', '-m', 'Initialize Codex git baseline')
  writeFileSync(join(codex, 'new.md'), 'ของใหม่ของ Codex\n')
  const before = w.g(codex, 'rev-parse', 'HEAD')

  const r = runScript(w, 'handoff.mjs', w.A.main, { SMARTLOCAL_CODEX_MEMORY: codex })
  assert.equal(r.status, 0, out(r))
  assert.match(r.stdout, /memory ของ Codex ไม่มี upstream/)
  assert.equal(w.g(codex, 'rev-parse', 'HEAD'), before, 'ห้าม commit ลง .git ที่ Codex เป็นเจ้าของ')
})

/* ── resume ───────────────────────────────────────────────────────── */
// resume เรียก doctor ท้ายคำสั่ง ซึ่งไม่มีในโลกจำลอง ⇒ ตรวจผลที่เกิดขึ้นจริง ไม่ตรวจ exit code

test('resume: ไฟล์ untracked ในทรีหลักไม่ขวาง และรับ memory จากอีกเครื่องมา', (t) => {
  const w = makeWorld(t)
  pushFromB(w, [['claude-memory/b.md', 'บี\n']])
  writeFileSync(join(w.A.main, 'stray.png'), 'x')

  const r = runScript(w, 'resume.mjs', w.A.main)
  assert.doesNotMatch(r.stderr, /เครื่องนี้มีงานที่ยังไม่ได้เก็บ/, out(r))
  assert.ok(existsSync(join(w.A.cfg, 'claude-memory', 'b.md')), out(r))
  assert.ok(existsSync(join(w.A.main, 'stray.png')))
})

test('resume: memory ค้างจากรอบก่อน ⇒ ไม่ดึงทับ และบอกให้ handoff ก่อน', (t) => {
  const w = makeWorld(t)
  pushFromB(w, [['claude-memory/b.md', 'บี\n']])
  writeFileSync(join(w.A.cfg, 'claude-memory', 'local.md'), 'ของเครื่อง A ที่ยังไม่ได้ส่ง\n')
  const before = w.g(w.A.cfg, 'rev-parse', 'HEAD')

  const r = runScript(w, 'resume.mjs', w.A.main)
  assert.match(r.stdout, /npm run handoff/, out(r))
  assert.equal(w.g(w.A.cfg, 'rev-parse', 'HEAD'), before)
  assert.ok(!existsSync(join(w.A.cfg, 'claude-memory', 'b.md')))
  assert.ok(existsSync(join(w.A.cfg, 'claude-memory', 'local.md')))
})

test('resume: ไฟล์ที่ track แล้วแก้ค้างในทรีหลัก ยังต้องหยุดเหมือนเดิม', (t) => {
  const w = makeWorld(t)
  writeFileSync(join(w.A.main, 'README.md'), 'แก้ค้าง\n')

  const r = runScript(w, 'resume.mjs', w.A.main)
  assert.equal(r.status, 1, out(r))
  assert.match(r.stderr, /เครื่องนี้มีงานที่ยังไม่ได้เก็บ/)
})
