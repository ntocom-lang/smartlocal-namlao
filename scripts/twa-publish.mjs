// เอา APK ที่ build แล้วขึ้นหน้า /download ของโดเมนกลาง — รันหลัง npm run twa:build:  npm run twa:publish
//
// ทำอะไร: ตรวจ APK (ลายเซ็นตรงกับที่เว็บประกาศ · package/เวอร์ชันตรงกับ APP_VERSION) → คัดลอกไป public/downloads/
// → เขียน src/lib/appDownload.js (ขนาด + SHA-256 + เวอร์ชันที่หน้าเว็บแสดง) แล้ว commit ทั้งสองไฟล์พร้อมกันเป็น PR
// ทำไมเขียนไฟล์ค่าให้เอง: ค่าแสดงบนหน้า (SHA-256/ขนาด) ที่ไม่ตรงกับไฟล์จริงทำให้คนตรวจไฟล์แล้วคิดว่าถูกเปลี่ยน
// เทสต์ (tests/app-download.test.mjs) ตรวจซ้ำทุกครั้งว่าตรงกัน
//
// ใช้ APK ตัวที่เซ็นด้วย upload key เท่านั้น — assetlinks.json ของเว็บประกาศลายนิ้วมือชุดนี้ ไม่ตรง = แอปมีแถบที่อยู่เว็บ
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ANDROID_CERT_FINGERPRINTS, ANDROID_PACKAGE_ID } from '../worker/storeApp.js'
import { APP_VERSION, apkFingerprints } from './twa-build.mjs'

// ชื่อไฟล์คงที่เสมอ — QR/ลิงก์ที่แจกไปแล้วต้องใช้ได้ต่อ (เวอร์ชันอยู่ในหน้าเว็บ ไม่อยู่ในชื่อไฟล์)
export const APK_PUBLIC_PATH = '/downloads/thongthin-khong-rao.apk'

function die(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

/** เนื้อไฟล์ src/lib/appDownload.js — แยกเป็นฟังก์ชันให้เทสต์เรียกได้ */
export function appDownloadModule({ versionName, versionCode, sizeBytes, sha256 }) {
  return `// สร้างโดย npm run twa:publish (scripts/twa-publish.mjs) — ห้ามแก้มือ
// ค่าของไฟล์ APK ที่หน้า /download ให้โหลด · tests/app-download.test.mjs ตรวจว่าตรงกับไฟล์ใน public/downloads/ ทุกตัว
export const APK_DOWNLOAD = Object.freeze({
  path: '${APK_PUBLIC_PATH}',
  versionName: '${versionName}',
  versionCode: ${versionCode},
  sizeBytes: ${sizeBytes},
  sha256: '${sha256}',
})
`
}

function aapt2Badging(apk) {
  const config = JSON.parse(readFileSync(path.join(homedir(), '.bubblewrap', 'config.json'), 'utf8'))
  const aapt2 = path.join(config.androidSdkPath, 'build-tools', '36.1.0', 'aapt2.exe')
  const result = spawnSync(aapt2, ['dump', 'badging', apk], { encoding: 'utf8', shell: true })
  if (result.status !== 0) die(`อ่านข้อมูลแพ็กเกจจาก APK ไม่ได้: ${result.stderr || result.stdout}`)
  return result.stdout
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const src = process.env.TWA_APK || path.join(process.env.TWA_OUT_DIR || 'D:\\tmp\\twa-build', 'app-release-signed.apk')
  if (!existsSync(src)) die(`ไม่พบ APK ที่ ${src} — รัน npm run twa:build ก่อน`)

  const bytes = readFileSync(src)
  if (bytes.subarray(0, 2).toString('latin1') !== 'PK') die('ไฟล์นี้ไม่ใช่ APK (ไม่ใช่ไฟล์ zip)')

  const actual = apkFingerprints(src)
  if (!actual.some((fp) => ANDROID_CERT_FINGERPRINTS.includes(fp))) {
    die(`ลายนิ้วมือของ APK (${actual.join(', ')}) ไม่อยู่ใน assetlinks.json ที่เว็บประกาศ — แอปจะมีแถบที่อยู่เว็บ ไม่เผยแพร่`)
  }

  const badging = aapt2Badging(src)
  const pkg = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m)
  if (!pkg) die('อ่าน package/เวอร์ชันจาก APK ไม่ได้')
  const [, name, code, versionName] = pkg
  if (name !== ANDROID_PACKAGE_ID) die(`package ใน APK คือ ${name} ไม่ใช่ ${ANDROID_PACKAGE_ID}`)
  if (Number(code) !== APP_VERSION.code || versionName !== APP_VERSION.name) {
    die(`เวอร์ชันใน APK (${versionName} / ${code}) ไม่ตรงกับ APP_VERSION ใน scripts/twa-build.mjs (${APP_VERSION.name} / ${APP_VERSION.code})`)
  }

  const dest = path.join(root, 'public', APK_PUBLIC_PATH.slice(1))
  mkdirSync(path.dirname(dest), { recursive: true })
  copyFileSync(src, dest)

  const sha256 = createHash('sha256').update(readFileSync(dest)).digest('hex')
  const sizeBytes = statSync(dest).size
  writeFileSync(path.join(root, 'src', 'lib', 'appDownload.js'),
    appDownloadModule({ versionName, versionCode: Number(code), sizeBytes, sha256 }))

  console.log(`✓ คัดลอก APK → ${path.relative(root, dest)} (${sizeBytes} ไบต์)`)
  console.log(`✓ SHA-256 ${sha256}`)
  console.log(`✓ เขียน src/lib/appDownload.js · เวอร์ชัน ${versionName} (${code}) · ลายนิ้วมือตรง ${actual[0]}`)
  console.log('ต่อไป: commit public/downloads/ + src/lib/appDownload.js แล้วเปิด PR (ห้าม push เข้า master ตรง)')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
