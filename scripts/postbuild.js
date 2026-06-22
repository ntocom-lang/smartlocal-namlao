import { renameSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
// rename ใน dist เพื่อไม่ให้ Vercel serve เป็น static
renameSync(join(root, 'dist/index.html'), join(root, 'dist/_template.html'))
// copy ไว้ใน api/ — Vercel auto-bundle ไฟล์ใน directory เดียวกับ function
copyFileSync(join(root, 'dist/_template.html'), join(root, 'api/_template.html'))
