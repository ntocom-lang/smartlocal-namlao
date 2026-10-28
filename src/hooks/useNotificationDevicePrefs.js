import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  parseNotificationPrefs,
  readNotificationPrefsRaw,
  subscribeNotificationPrefs,
  writeNotificationPrefs,
} from '../lib/notificationPrefs'

// ค่าป๊อปอัป/เสียง/สั่นของบัญชีนี้บนเครื่องนี้ — หน้าตั้งค่ากับกระดิ่งอ่านจากที่เดียวกัน เปลี่ยนแล้วมีผลทันทีทุกแท็บ
export function useNotificationDevicePrefs(uid) {
  const raw = useSyncExternalStore(subscribeNotificationPrefs, () => readNotificationPrefsRaw(uid), () => null)
  const prefs = useMemo(() => parseNotificationPrefs(raw), [raw])
  const update = useCallback(
    (patch) => writeNotificationPrefs(uid, { ...parseNotificationPrefs(readNotificationPrefsRaw(uid)), ...patch }),
    [uid],
  )
  return [prefs, update]
}
