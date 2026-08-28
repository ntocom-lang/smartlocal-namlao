import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
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
])
