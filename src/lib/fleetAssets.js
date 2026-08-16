export const ASSET_KIND_OPTIONS = [
  { value: 'vehicle', label: 'ยานพาหนะ' },
  { value: 'engine', label: 'เครื่องยนต์' },
  { value: 'equipment', label: 'ครุภัณฑ์' },
]

export const METER_UNIT_OPTIONS = [
  { value: 'km', label: 'กิโลเมตร (กม.)', shortLabel: 'กม.' },
  { value: 'hour', label: 'ชั่วโมงทำงาน', shortLabel: 'ชม.' },
]

export const FUEL_OPTIONS = [
  { value: 'diesel', label: 'ดีเซล' },
  { value: 'gasoline', label: 'เบนซิน' },
  { value: 'gas_lpg', label: 'แก๊ส LPG' },
  { value: 'electric', label: 'ไฟฟ้า' },
  { value: 'lubricant', label: 'น้ำมันหล่อลื่น/ของเหลว' },
  { value: 'other', label: 'อื่น ๆ' },
]

export const FUEL_LABEL = Object.fromEntries(FUEL_OPTIONS.map(item => [item.value, item.label]))
export const ASSET_KIND_LABEL = Object.fromEntries(ASSET_KIND_OPTIONS.map(item => [item.value, item.label]))

export function isVehicleAsset(asset) {
  return (asset?.asset_kind ?? 'vehicle') === 'vehicle'
}

export function assetIdentifier(asset) {
  if (!asset) return '—'
  if (isVehicleAsset(asset)) return asset.license_plate?.trim() || 'ไม่ระบุทะเบียน'
  return asset.asset_code?.trim() || 'ไม่ระบุรหัสครุภัณฑ์'
}

export function assetOptionLabel(asset) {
  const identifier = assetIdentifier(asset)
  return `${asset?.name ?? 'ไม่ระบุชื่อ'} (${identifier})`
}

export function meterUnitShort(assetOrUnit) {
  const unit = typeof assetOrUnit === 'string' ? assetOrUnit : assetOrUnit?.meter_unit
  return unit === 'hour' ? 'ชม.' : 'กม.'
}

export function meterLabel(asset, prefix = 'ค่ามิเตอร์') {
  if (isVehicleAsset(asset)) return `${prefix === 'ค่ามิเตอร์' ? 'เลขไมล์' : prefix} (${meterUnitShort(asset)})`
  return `${prefix === 'ค่ามิเตอร์' ? 'มิเตอร์สะสม' : prefix} (${meterUnitShort(asset)})`
}

export function normalizeAssetIdentifier(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toLocaleLowerCase('th-TH')
}

export function assetEmoji(asset) {
  if ((asset?.asset_kind ?? 'vehicle') === 'engine') return '⚙️'
  if (asset?.asset_kind === 'equipment') return '🧰'
  if (asset?.vehicle_type === 'pickup') return '🛻'
  if (asset?.vehicle_type === 'truck') return '🚚'
  if (asset?.vehicle_type === 'excavator' || asset?.vehicle_type === 'backhoe') return '🚜'
  if (asset?.vehicle_type === 'motorcycle') return '🏍️'
  if (asset?.vehicle_type === 'van') return '🚐'
  return '🚗'
}
