import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // เดิม ignore แค่ 'dist' ทำให้ `npm run lint` ไปไล่ bundle ที่ build แล้วด้วย —
  // android/app/**/assets เก็บ bundle ที่ Capacitor คัดลอกไปฝัง (ทั้ง minified ทั้ง workbox)
  // ตัวเดียวก็ยิง error หลักร้อยจากโค้ดที่ไม่มีใครแก้ด้วยมือ รวมทั้งหมด 944 problems
  // จนอ่านไม่ออกว่าอันไหนของจริง (ของจริงในโค้ดต้นทางมี 82 errors / 18 warnings)
  // ด่านที่ส่งเสียงดังจนไม่มีใครฟังคือด่านที่ไม่มีอยู่จริง
  globalIgnores([
    'dist',
    'dev-dist',
    'android',            // build artifact ของ Capacitor ไม่ใช่ source
    '.claude/worktrees',  // worktree ของ agent เป็นสำเนาของ repo ตัวเอง ลินต์ซ้ำเปล่าๆ
    'scratch',            // สคริปต์ทดลองใช้ครั้งเดียว ไม่ได้ขึ้น production
    'supabase/functions', // Deno runtime คนละชุด global กับที่ config นี้ตั้งไว้
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // withModule() ห่อคอมโพเนนต์ให้ซ่อนตัวเองเมื่อ อปท. ไม่ได้เปิดโมดูลนั้น (src/lib/withModule.jsx)
      // ไฟล์ที่ export default withModule(...) ยังเป็น "ไฟล์ที่ export คอมโพเนนต์ล้วน" อยู่
      // Fast Refresh ทำงานได้ตามปกติ แค่ปลั๊กอินไม่รู้จัก HOC ตัวนี้จึงต้องบอกมันตรงๆ
      'react-refresh/only-export-components': ['error', { allowExportNames: [], extraHOCs: ['withModule'] }],
    },
  },
  {
    // worker/ รันบน Cloudflare Workers ไม่ใช่เบราว์เซอร์ จึงมี global ที่ globals.browser
    // ไม่รู้จัก (HTMLRewriter เป็นของ Cloudflare เอง) ส่วน fetch/Request/Response/URL
    // มากับ globals.browser อยู่แล้วเพราะเป็น Web API มาตรฐาน
    files: ['worker/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, HTMLRewriter: 'readonly' },
    },
  },
  {
    // api/ กับ scripts/ รันบน Node ไม่ใช่เบราว์เซอร์ — require/module/__dirname/process
    // เป็นของ Node ทั้งหมด ก่อนหน้านี้ขึ้น no-undef 11 จุดทั้งที่โค้ดถูกต้อง
    files: ['api/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // service worker มี global ของตัวเอง (clients, self, skipWaiting) ที่ globals.browser ไม่มี
    files: ['src/sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
])
