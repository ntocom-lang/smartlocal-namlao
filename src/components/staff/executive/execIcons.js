import {
  Ambulance, Award, BarChart3, CalendarDays, CalendarOff, Car, CircleHelp, ClipboardList, CloudRain, Database, Droplets,
  Eye, HardHat, Inbox, MapPin, MessageSquareWarning, Newspaper, Package, PenLine, Smile, Star, Trash2, Waves, Wind, Wrench,
} from 'lucide-react'

// ชื่อไอคอนในทะเบียน (executiveRegistry.js เก็บเป็น string เพราะไฟล์นั้นต้องรันด้วย node ล้วน) → คอมโพเนนต์ lucide
// import แบบระบุชื่อ (ไม่ใช้ import * — ไม่งั้น tree-shaking หลุดและบันเดิลโตทั้งไลบรารี)
// ชื่อที่ไม่อยู่ในตารางนี้ (ทะเบียนเพิ่มไอคอนใหม่แล้วลืมมาเพิ่มที่นี่) ได้ไอคอนกลาง ไม่ crash
const ICONS = {
  Ambulance, Award, BarChart3, CalendarDays, CalendarOff, Car, ClipboardList, CloudRain, Database, Droplets,
  Eye, HardHat, Inbox, MapPin, MessageSquareWarning, Newspaper, Package, PenLine, Smile, Star, Trash2, Waves, Wind, Wrench,
}

export function execIcon(name) {
  return ICONS[name] ?? CircleHelp
}
