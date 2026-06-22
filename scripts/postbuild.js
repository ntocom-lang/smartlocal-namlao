import { renameSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
renameSync(
  join(__dirname, '../dist/index.html'),
  join(__dirname, '../dist/_template.html')
)
