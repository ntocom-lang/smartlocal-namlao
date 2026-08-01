-- =====================================================
-- Migration: Seed Centralized Google Maps Picker Spec to Dev Journal
-- Module: ข้อมูลระบบ / Topic: ระบบแผนที่ & พิกัดตำแหน่ง (Google Maps JS API)
-- =====================================================

INSERT INTO public.dev_journal (
  module,
  topic,
  category,
  title,
  body,
  status
)
SELECT
  'ข้อมูลระบบ',
  'ระบบแผนที่ & พิกัดตำแหน่ง (Google Maps JS API)',
  'story',
  'มาตรฐานการตั้งค่าระบบปักหมุดตำแหน่งกลาง (Centralized Google Maps Picker)',
  '### 📍 มาตรฐานการตั้งค่าระบบปักหมุดตำแหน่งกลาง (Centralized Google Maps Picker)

---

#### 1. 🏛️ สถาปัตยกรรมแบบรวมศูนย์ (Single Source of Truth)
- **ศูนย์กลางของระบบ**: รวมศูนย์การตั้งค่าระบบปักหมุดตำแหน่งทั้งหมดไว้ที่ `GoogleMapPicker.jsx` (`src/components/common/GoogleMapPicker.jsx`)
- **การใช้ซ้ำทั่วทั้งแอปพลิเคชัน**: หน้าแจ้งเรื่องร้องเรียนของประชาชน (`CitizenForm.jsx`), หน้าเพิ่ม/แก้ไขข้อมูล Data Center ของเจ้าหน้าที่ (`DataCenterEntryForm.jsx`), และฟอร์มปักหมุดตำแหน่งทั้งหมดในระบบ จะดึงคอนฟิกกลางไปใช้งานอัตโนมัติ ไม่ต้องแยกแก้หลายจุด

---

#### 2. ⚙️ มาตรฐานพฤติกรรมแผนที่ (Standard Map Picker Specs)
- **หมุดตรึงกลางหน้าจอ (`fixedCenterPin = true`)**: หมุดสีแดงตรึงอยู่ตรงกลางหน้าจอเป๊ะๆ ให้ผู้ใช้เลื่อน/ลากแผนที่เพื่อเลือกตำแหน่งได้อย่างแม่นยำและเป็นธรรมชาติ
- **ซ่อนเส้นขอบเขตปกครอง (`showBoundary = false`)**: ซ่อนเส้นประสีแดงขอบเขตตำบลบนแผนที่ปักหมุด เพื่อให้หน้าจอแผนที่ภาพถ่ายดาวเทียมสะอาด เคลียร์ 100%
- **แถบสลับประเภทแผนที่ 1 คลิก**: แถบปุ่ม `[ 🗺️ แผนที่ | 🛰️ ดาวเทียม ]` บริเวณมุมขวาบน ใช้งานง่าย เข้าถึงได้เร็ว
- **ระบบซูมธรรมชาติ (`+` / `-`)**: ปรับปรุงการทำงานของระดับการซูม (Zoom Level) และลูกกลิ้งเมาส์/สัมผัส ไม่ให้เด้งกลับที่เดิม
- **ซ่อน Street View**: ปิดการแสดงผลการ์ตูน Pegman (Street View) เพื่อไม่ให้บดบังพื้นที่ปักหมุด

---

#### 3. 🛡️ ความมั่นคงปลอดภัยและการจัดการ API Key
- **Environment Key Isolation**: ดึง `VITE_GOOGLE_MAPS_API_KEY` จากไฟล์ `.env.local` หรือคอนฟิกของเทศบาล (`tenant.google_maps_api_key`)
- **Fallback Engine**: หากยังไม่ใส่ API Key หรือ Key มีปัญหา ระบบจะสลับไปใช้ OpenStreetMap / Esri World Imagery (Leaflet Fallback) อัตโนมัติ ป้องกันหน้าจอสีดำหรือแอปพลิเคชันล่ม',
  'done'
WHERE NOT EXISTS (
  SELECT 1 FROM public.dev_journal
  WHERE module = 'ข้อมูลระบบ' AND title = 'มาตรฐานการตั้งค่าระบบปักหมุดตำแหน่งกลาง (Centralized Google Maps Picker)'
);
