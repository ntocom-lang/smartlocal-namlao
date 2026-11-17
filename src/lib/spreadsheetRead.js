// ตัวอ่านไฟล์ตาราง (CSV / .xlsx แผ่นแรก) ที่ใช้ร่วมกันของหน้านำเข้าข้อมูล — ย้ายมาจาก FleetImportModal.jsx ทั้งก้อน ไม่แก้พฤติกรรม
// ไม่มีไลบรารี Excel ใน package.json: .xlsx อ่านด้วย jszip + DOMParser ของเบราว์เซอร์ (โหลด jszip เมื่อมีคนเลือกไฟล์ .xlsx เท่านั้น)
// ใช้โดย FleetImportModal.jsx (ยานพาหนะ) และ components/staff/licence/LicenceImportSheet.jsx (ทะเบียนใบอนุญาต)
// ⚠️ parseXlsx คืนค่าเซลล์เป็นสตริงดิบ: วันที่ใน Excel จะเป็นเลขลำดับวัน (เช่น 45000) — ผู้เรียกแปลงเอง
//    (ทะเบียนใบอนุญาตแปลงที่ parseImportDate ใน licenceRegistry.js)

export function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('th-TH')
    .replace(/[\s_\-/().]+/g, '')
}

export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      if (row.some(value => String(value).trim())) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  row.push(cell)
  if (row.some(value => String(value).trim())) rows.push(row)
  return rows
}

function excelColumnIndex(reference = '') {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? ''
  let result = 0
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64
  return Math.max(0, result - 1)
}

export async function parseXlsx(file) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const workbookEntry = zip.file('xl/workbook.xml')
  const relsEntry = zip.file('xl/_rels/workbook.xml.rels')
  if (!workbookEntry || !relsEntry) throw new Error('ไฟล์ XLSX ไม่มีโครงสร้าง Workbook ที่รองรับ')

  const parser = new DOMParser()
  const workbook = parser.parseFromString(await workbookEntry.async('string'), 'application/xml')
  const rels = parser.parseFromString(await relsEntry.async('string'), 'application/xml')
  const firstSheet = workbook.querySelector('sheet')
  const relationshipId = firstSheet?.getAttribute('r:id')
    || firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
  const relationship = [...rels.querySelectorAll('Relationship')]
    .find(item => item.getAttribute('Id') === relationshipId)
  const target = relationship?.getAttribute('Target')
  if (!target) throw new Error('ไม่พบ Worksheet แรกในไฟล์ XLSX')

  const worksheetPath = target.startsWith('/')
    ? target.slice(1)
    : `xl/${target.replace(/^\.\//, '')}`
  const worksheetEntry = zip.file(worksheetPath)
  if (!worksheetEntry) throw new Error('ไม่สามารถอ่าน Worksheet แรกได้')

  const sharedEntry = zip.file('xl/sharedStrings.xml')
  const sharedStrings = sharedEntry
    ? [...parser.parseFromString(await sharedEntry.async('string'), 'application/xml').querySelectorAll('si')]
        .map(item => item.textContent ?? '')
    : []

  const worksheet = parser.parseFromString(await worksheetEntry.async('string'), 'application/xml')
  return [...worksheet.querySelectorAll('sheetData > row')].map(rowNode => {
    const row = []
    for (const cellNode of rowNode.querySelectorAll('c')) {
      const index = excelColumnIndex(cellNode.getAttribute('r'))
      const type = cellNode.getAttribute('t')
      const raw = cellNode.querySelector('v')?.textContent ?? ''
      const value = type === 's'
        ? sharedStrings[Number(raw)] ?? ''
        : type === 'inlineStr'
          ? cellNode.querySelector('is')?.textContent ?? ''
          : raw
      row[index] = value
    }
    return row
  }).filter(row => row.some(value => String(value ?? '').trim()))
}
