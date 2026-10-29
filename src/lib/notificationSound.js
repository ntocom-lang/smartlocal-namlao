// เสียงแจ้งเตือนสั้นๆ สังเคราะห์ด้วย Web Audio — ไม่มีไฟล์เสียง ไม่โหลดอะไรเพิ่ม
// เบราว์เซอร์เล่นเสียงได้หลังผู้ใช้แตะหน้าเว็บอย่างน้อยหนึ่งครั้ง (นโยบาย autoplay) ก่อนหน้านั้นเงียบเอง ไม่ error

let sharedContext = null

const defaultAudioContext = () => globalThis.AudioContext || globalThis.webkitAudioContext

/** เล่นเสียง 2 โน้ตเบาๆ (~0.3 วินาที) · คืน false ถ้าเครื่องเล่นไม่ได้ */
export function playNotificationSound(AudioCtor = defaultAudioContext()) {
  if (!AudioCtor) return false
  try {
    if (!sharedContext || !(sharedContext instanceof AudioCtor)) sharedContext = new AudioCtor()
    const ctx = sharedContext
    if (ctx.state === 'suspended') Promise.resolve(ctx.resume?.()).catch(() => {})
    const start = ctx.currentTime + 0.01
    ;[880, 1318.5].forEach((frequency, index) => {
      const at = start + index * 0.16
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.15)
    })
    return true
  } catch {
    return false
  }
}
