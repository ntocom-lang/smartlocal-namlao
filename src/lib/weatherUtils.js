export const WMO = {
  0:  { label: 'ท้องฟ้าแจ่มใส',      icon: '☀️' },
  1:  { label: 'แจ่มใสเป็นส่วนมาก',  icon: '🌤️' },
  2:  { label: 'มีเมฆบางส่วน',        icon: '⛅' },
  3:  { label: 'เมฆเต็มท้องฟ้า',      icon: '☁️' },
  45: { label: 'หมอกลง',              icon: '🌫️' },
  48: { label: 'หมอกน้ำแข็ง',          icon: '🌫️' },
  51: { label: 'ฝนปรอยๆ',            icon: '🌦️' },
  53: { label: 'ฝนปรอยๆ',            icon: '🌦️' },
  55: { label: 'ฝนปรอยๆ',            icon: '🌦️' },
  61: { label: 'ฝนเบาบาง',            icon: '🌧️' },
  63: { label: 'ฝนปานกลาง',           icon: '🌧️' },
  65: { label: 'ฝนตกหนัก',            icon: '🌧️' },
  71: { label: 'หิมะตก',              icon: '❄️' },
  73: { label: 'หิมะตก',              icon: '❄️' },
  75: { label: 'หิมะตกหนัก',          icon: '❄️' },
  77: { label: 'เกล็ดหิมะ',           icon: '❄️' },
  80: { label: 'ฝนตกหนัก',            icon: '🌧️' },
  81: { label: 'ฝนตกหนัก',            icon: '🌧️' },
  82: { label: 'ฝนตกหนักมาก',         icon: '🌧️' },
  85: { label: 'หิมะตก',              icon: '❄️' },
  86: { label: 'หิมะตกหนัก',          icon: '❄️' },
  95: { label: 'พายุฝนฟ้าคะนอง',      icon: '⛈️' },
  96: { label: 'พายุลูกเห็บ',         icon: '⛈️' },
  99: { label: 'พายุรุนแรง',          icon: '⛈️' },
}

export function getWeatherInfo(code) {
  if (WMO[code]) return WMO[code]
  const keys = Object.keys(WMO).map(Number).sort((a, b) => a - b)
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i] <= code) return WMO[keys[i]]
  }
  return { label: 'ไม่ทราบ', icon: '🌡️' }
}

// ตำบลน้ำเลา อ.ร้องกวาง จ.แพร่
export const WEATHER_LAT = 18.33
export const WEATHER_LON = 100.32

const PM25_LEVELS = [
  { max: 15,   label: 'ดีมาก',               color: '#3b82f6' }, // blue
  { max: 25,   label: 'ดี',                  color: '#22c55e' }, // green
  { max: 37.5, label: 'ปานกลาง',             color: '#eab308' }, // yellow
  { max: 75,   label: 'เริ่มมีผลต่อสุขภาพ', color: '#f97316' }, // orange
  { max: Infinity, label: 'มีผลต่อสุขภาพ',  color: '#ef4444' }, // red
]

export function getPm25Info(value) {
  return PM25_LEVELS.find(l => value <= l.max) ?? PM25_LEVELS.at(-1)
}
