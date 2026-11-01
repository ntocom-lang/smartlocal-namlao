// สร้างแอป Android ของแอปกลาง SmartLocal (Trusted Web Activity ห่อด้วย Bubblewrap) — รันบนเครื่องนักพัฒนา ไม่ใช่ CI
//
//   $env:TWA_KEYSTORE_PASSWORD = '<รหัสในไฟล์ D:\keys\smartlocal-upload-README.txt>'
//   npm run twa:build                # ได้ APK (ลงมือถือทดสอบ) + AAB (ส่งขึ้น Play)
//   npm run twa:build -- --dry-run   # แค่พิมพ์ twa-manifest.json ที่จะใช้ ไม่ build
//
// ต้องมีในเครื่อง (ฟรีทั้งหมด ติดตั้งนอก repo เมื่อ 2569-11-01):
//   - Bubblewrap CLI 1.27.0 (Apache-2.0) ที่ D:\tools\bubblewrap — เปลี่ยนที่ได้ด้วย env BUBBLEWRAP_CLI
//   - JDK 17 (Temurin) + Android SDK (build-tools 36.1.0, android-36) ตาม %USERPROFILE%\.bubblewrap\config.json
//     ⚠️ Bubblewrap รับ JDK 17 เท่านั้น และ cmdline-tools ใช้รุ่น 19.0 — รุ่น 23 ขึ้นไป sdkmanager กลายเป็นตัวเรียก
//        "Android CLI" ที่ไม่ลง build-tools ให้ (ลองแล้ว 2569-11-01)
//     ⚠️ build ล้มด้วย "Failed to find target with hash string 'android-36'" = sdkmanager ลง platform ซ้ำเป็น
//        platforms\android-36-2 (เจอจริง 2569-11-01) ย้ายโฟลเดอร์ที่ซ้ำออก ให้เหลือ android-36 ตัวเดียว
//   - กุญแจเซ็นแอป D:\keys\smartlocal-upload.jks (เปลี่ยนที่ได้ด้วย env TWA_KEYSTORE) ห้ามเข้า git
//
// ระบบทำเองตอน build: ดึงรายชื่อ อปท. ที่เปิดใช้จากฐานข้อมูลมาเป็นโดเมนที่แอปเปิดเต็มจอได้ (additionalTrustedOrigins)
// มี อปท. ใหม่ = เพิ่มเลขเวอร์ชันด้านล่างแล้วรันใหม่ ไม่ต้องแก้รายชื่อเอง · build เสร็จตรวจลายนิ้วมือใบรับรองของ APK
// เทียบกับที่เว็บประกาศ (worker/storeApp.js) ไม่ตรง = แอปจะมีแถบที่อยู่เว็บ จึงหยุดพร้อมบอกวิธีแก้
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  ANDROID_CERT_FINGERPRINTS, ANDROID_PACKAGE_ID, PLATFORM_APP_NAME, PLATFORM_THEME_COLOR,
} from '../worker/storeApp.js'

export const TWA_HOST = 'app.rk-networks.com'
const BASE_DOMAIN = 'rk-networks.com'
// ส่งขึ้น Play ทุกครั้งต้องเพิ่ม code (Play ไม่รับเลขซ้ำหรือน้อยกว่าเดิม) · name คือเลขที่ผู้ใช้เห็น
export const APP_VERSION = Object.freeze({ code: 1, name: '1.0.0' })
// ป้ายโดเมนที่ไม่ใช่ อปท. (ตรงกับ excluded ใน TenantContext.jsx / worker/index.js)
const NEUTRAL_LABELS = new Set(['www', 'app', 'admin'])

/** โดเมนของ อปท. ที่แอปเปิดเต็มจอได้ — ทุกแห่งที่เปิดใช้ รวมสาธิต (ผู้ตรวจของสโตร์ใช้) */
export function trustedOrigins(tenants) {
  const slugs = (tenants ?? [])
    .map((t) => String(t?.slug ?? ''))
    .filter((slug) => /^[a-z0-9-]+$/.test(slug) && !NEUTRAL_LABELS.has(slug))
  return [...new Set(slugs)].sort().map((slug) => `${slug}.${BASE_DOMAIN}`)
}

/** twa-manifest.json ของ Bubblewrap (ชื่อฟิลด์ตาม @bubblewrap/core TwaManifest) */
export function buildTwaManifest({ tenants, keystorePath, version = APP_VERSION }) {
  const origin = `https://${TWA_HOST}`
  return {
    packageId: ANDROID_PACKAGE_ID,
    host: TWA_HOST,
    name: PLATFORM_APP_NAME,
    launcherName: PLATFORM_APP_NAME,
    display: 'standalone',
    themeColor: PLATFORM_THEME_COLOR,
    themeColorDark: '#000000',
    navigationColor: '#000000',
    navigationColorDark: '#000000',
    navigationDividerColor: '#00000000',
    navigationDividerColorDark: '#00000000',
    backgroundColor: '#FFFFFF',
    // แจ้งเตือนคำร้อง/คำขอวิ่งผ่าน Web Push เดิม — Android 13+ ขอสิทธิ์แจ้งเตือนในนามแอป
    enableNotifications: true,
    startUrl: '/',
    iconUrl: `${origin}/icons/icon-512x512.png`,
    maskableIconUrl: `${origin}/icons/maskable-512x512.png`,
    splashScreenFadeOutDuration: 300,
    signingKey: { path: keystorePath, alias: 'upload' },
    appVersion: version.name,
    appVersionCode: version.code,
    shortcuts: [],
    generatorApp: 'bubblewrap-cli',
    webManifestUrl: `${origin}/manifest.webmanifest`,
    fallbackType: 'customtabs',
    features: {},
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: true,
    isChromeOSOnly: false,
    isMetaQuest: false,
    fullScopeUrl: `${origin}/`,
    // Android 7.0 ขึ้นไป — androidbrowserhelper 2.7.4 ที่ template ของ Bubblewrap 1.27 ใช้ประกาศ minSdk 24
    // ค่าเริ่มของ Bubblewrap (21) ทำให้ build ล้มที่ processReleaseMainManifest (เจอจริง 2569-11-01)
    minSdkVersion: 24,
    orientation: 'portrait',
    fingerprints: [],
    additionalTrustedOrigins: trustedOrigins(tenants),
    retainedBundles: [],
  }
}

// ── ตัวรัน ────────────────────────────────────────────────────────────────────────
function die(message, hint) {
  console.error(`✗ ${message}`)
  if (hint) console.error(`  ${hint}`)
  process.exit(1)
}

async function fetchActiveTenants(root) {
  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
    const envFile = path.join(root, '.env.local')
    if (existsSync(envFile)) process.loadEnvFile(envFile)
  }
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) die('ไม่มี VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY', 'คัดลอก .env.local มาไว้ที่ราก repo (npm run env:pull)')
  const res = await fetch(`${url}/rest/v1/municipalities?select=slug&is_active=eq.true`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) die(`อ่านรายชื่อหน่วยงานไม่ได้ (HTTP ${res.status})`)
  return res.json()
}

function run(cmd, args, options) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...options })
  if (result.status !== 0) die(`คำสั่งล้ม: ${path.basename(cmd)} ${args[0]} (exit ${result.status})`)
}

function apkFingerprints(apk) {
  const config = JSON.parse(readFileSync(path.join(homedir(), '.bubblewrap', 'config.json'), 'utf8'))
  const apksigner = path.join(config.androidSdkPath, 'build-tools', '36.1.0', 'apksigner.bat')
  const result = spawnSync(apksigner, ['verify', '--print-certs', apk], {
    encoding: 'utf8', shell: true, env: { ...process.env, JAVA_HOME: config.jdkPath },
  })
  if (result.status !== 0) die('ตรวจลายเซ็น APK ไม่ผ่าน', result.stderr || result.stdout)
  // apksigner พิมพ์ hex ตัวเล็กไม่มี : — แปลงเป็นรูปแบบเดียวกับ assetlinks.json
  return [...result.stdout.matchAll(/SHA-256 digest: ([0-9a-f]{64})/g)]
    .map((m) => m[1].toUpperCase().match(/.{2}/g).join(':'))
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const dryRun = process.argv.includes('--dry-run')
  const outDir = process.env.TWA_OUT_DIR || 'D:\\tmp\\twa-build'
  const keystore = process.env.TWA_KEYSTORE || 'D:\\keys\\smartlocal-upload.jks'
  const cli = process.env.BUBBLEWRAP_CLI || 'D:\\tools\\bubblewrap\\node_modules\\.bin\\bubblewrap.cmd'

  const manifest = buildTwaManifest({ tenants: await fetchActiveTenants(root), keystorePath: keystore })
  if (dryRun) {
    console.log(JSON.stringify(manifest, null, 2))
    return
  }

  const password = process.env.TWA_KEYSTORE_PASSWORD
  if (!password) die('ไม่ได้ตั้ง TWA_KEYSTORE_PASSWORD', 'ดูรหัสในไฟล์ README ที่อยู่ข้างไฟล์กุญแจ แล้วตั้งเป็นตัวแปรใน PowerShell ก่อนรัน')
  if (!existsSync(keystore)) die(`ไม่พบกุญแจเซ็นแอป ${keystore}`, 'ตั้ง TWA_KEYSTORE ชี้ไฟล์ .jks ที่สำรองไว้')
  if (!existsSync(cli)) die(`ไม่พบ Bubblewrap CLI ที่ ${cli}`, 'ติดตั้ง: npm install --prefix D:\\tools\\bubblewrap @bubblewrap/cli@1.27.0')

  mkdirSync(outDir, { recursive: true })
  const manifestFile = path.join(outDir, 'twa-manifest.json')
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`twa-manifest.json → ${manifestFile}`)
  console.log(`โดเมน อปท. ที่เปิดเต็มจอ: ${manifest.additionalTrustedOrigins.join(', ')}`)

  const env = { ...process.env, BUBBLEWRAP_KEYSTORE_PASSWORD: password, BUBBLEWRAP_KEY_PASSWORD: password }
  // Bubblewrap สั่ง "gradlew.bat" ด้วยชื่อเปล่าในโฟลเดอร์ build — เครื่องที่ตั้ง NoDefaultCurrentDirectoryInExePath=1
  // (ห้าม cmd รันไฟล์จากโฟลเดอร์ปัจจุบัน) จะหาไม่เจอ ไม่ปิดค่าความปลอดภัยนั้น แต่เพิ่มเฉพาะโฟลเดอร์ build ที่
  // Bubblewrap เพิ่งสร้างเข้า PATH ของคำสั่งนี้ (Windows ชื่อตัวแปรอาจเป็น Path — ใช้ชื่อเดิมไม่สร้างซ้ำ)
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
  env[pathKey] = `${outDir}${path.delimiter}${env[pathKey] ?? ''}`
  // update = สร้างโปรเจกต์ Android ใหม่จาก twa-manifest.json ทุกครั้ง (โฟลเดอร์ build ไม่ต้องเก็บ ไม่เข้า git)
  run(cli, ['update', '--skipVersionUpgrade', `--manifest=${manifestFile}`, `--directory=${outDir}`], { cwd: outDir, env })
  run(cli, ['build', '--skipPwaValidation', `--manifest=${manifestFile}`, `--directory=${outDir}`], { cwd: outDir, env })

  const apk = path.join(outDir, 'app-release-signed.apk')
  const aab = path.join(outDir, 'app-release-bundle.aab')
  if (!existsSync(apk) || !existsSync(aab)) die('build จบแต่ไม่พบไฟล์ APK/AAB', outDir)

  const actual = apkFingerprints(apk)
  if (!actual.some((fp) => ANDROID_CERT_FINGERPRINTS.includes(fp))) {
    die(`ลายนิ้วมือของ APK (${actual.join(', ')}) ไม่อยู่ใน assetlinks.json ที่เว็บประกาศ`,
      'แอปจะเปิดพร้อมแถบที่อยู่เว็บ — เพิ่มค่านี้ใน ANDROID_CERT_FINGERPRINTS (worker/storeApp.js) แล้ว deploy ก่อน')
  }
  console.log(`✓ APK (ลงมือถือทดสอบ): ${apk}`)
  console.log(`✓ AAB (ส่งขึ้น Play): ${aab}`)
  console.log(`✓ ลายนิ้วมือใบรับรองตรงกับที่เว็บประกาศ: ${actual[0]}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
