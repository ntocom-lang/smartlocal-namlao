-- =====================================================
-- Migration: Seed Google Cloud & Geospatial Roadmap to Dev Journal
-- Module: ข้อมูลระบบ / Topic: ข้อเสนอแนะ Google Cloud & Geospatial
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
  'ข้อเสนอแนะ Google Cloud & Geospatial',
  'plan',
  'แผนพัฒนาสถาปัตยกรรม Google Cloud, Geospatial & AI สำหรับ Smart City อปท.',
  '### 🚀 แผนพัฒนาสถาปัตยกรรม Google Cloud & Geospatial สำหรับ Smart City อปท.

---

#### 1. 🗺️ Google Maps Platform & Multi-Tenant Billing ($200 Credit/Month)
- **แยก 1 GCP Billing Account ต่อ 1 อปท.**: เพื่อรับสิทธิ์เครดิตฟรี $200 USD/เดือน (~7,000 บาท/เดือน) แยกต่อ อปท. ช่วยให้ อปท. ขนาดเล็ก-กลาง ได้ใช้ Google Maps API ฟรี 100%
- **Places Autocomplete & Geocoding API**: เปลี่ยนการค้นหาจาก Nominatim เป็น Google Places เพื่อให้ค้นหาบ้านเลขที่ ตรอก ซอย และสถานที่ในท้องถิ่นภาษาไทยได้แม่นยำ 100%
- **Snap to Roads & Routes API**: ยึดแนวเส้นทางถนนที่วาด (Polyline) ให้แนบสนิทตามเลนถนนจริงบนแผนที่อัตโนมัติ และใช้คำนวณระยะทางเวลาจริงของรถดับเพลิง/รถขยะในระบบ Fleet

---

#### 2. 📊 BigQuery GIS (Spatial Analytics & Heatmap)
- **Spatial Heatmap (`ST_CLUSTERDBSCAN`)**: วิเคราะห์การกระจุกตัวของเหตุร้องเรียน (เช่น ขยะสะสม/ท่ออุดตัน/ถนนชำรุดซ้ำซาก) เพื่อให้นายกเทศมนตรีใช้ประกอบการจัดตั้งงบประมาณรายปี
- **Isochrone Analysis (Spatial Coverage)**: คำนวณรัศมีและระยะเวลาในการเข้าถึงบริการสาธารณะของประชาชน (เช่น ระยะ 5-10 นาทีถึงศูนย์หลบภัย/โรงพยาบาลส่งเสริมสุขภาพตำบล)

---

#### 3. 🤖 AI & Automation (Gemini & Document AI)
- **Gemini Multimodal Complaint Triage**: วิเคราะห์รูปถ่ายคำร้องอัตโนมัติ เช่น ภาพถนนพัง ขยะกอง ไฟดับ แล้วระบุประเภทคำร้อง + ประเมินความรุนแรง (Priority) + ส่งต่อฝ่ายที่รับผิดชอบโดยอัตโนมัติ
- **Document AI**: สแกนอ่านข้อมูลจากสำเนาบัตรประชาชน/ทะเบียนบ้าน/แบบขออนุญาตปลูกสร้าง เข้าสู่ระบบ E-Service อัตโนมัติ ลดงานคีย์ข้อมูลของเจ้าหน้าที่

---

#### 4. 🔔 IoT & Executive Dashboard (Firebase & Looker Studio)
- **Firebase Realtime & Cloud Pub/Sub**: รับค่า Real-time จากเซ็นเซอร์ระดับน้ำในอ่างเก็บน้ำ (แม่คำปอง) และเซ็นเซอร์ฝุ่น PM2.5 ขึ้น Dashboard เมือง
- **Firebase Cloud Messaging (FCM)**: ส่งข้อความแจ้งเตือนภัยพิบัติด่วน/น้ำท่วม เด้งเข้าโทรศัพท์มือถือประชาชนในพื้นที่แบบ Broadcast ทันที
- **Looker Studio (Free Enterprise BI)**: เชื่อมต่อโดยตรงกับ BigQuery/Supabase เพื่อทำ **Executive Dashboard สรุปผลงานนายกเทศมนตรี** และรายงานประเมิน LPA ฟรี 100%

---

#### ⚖️ ข้อควรระวังและการปฏิบัติตามกฎหมาย (Compliance & Security)
- **Billing Account Management**: ต้องกำหนดโครงสร้างบัญชีอีเมลองค์กรผู้ดูแลกลางเพื่อถือสิทธิ์ Master Admin
- **PDPA & Consent Management**: การประมวลผลรูปถ่าย สแกนเอกสาร และเสียงพูดของประชาชนผ่าน AI Cloud ต้องจัดทำข้อตกลง DPA และ Consent Management สอดคล้องตามกฎหมาย PDPA และมาตรฐานความมั่นคงปลอดภัยสารสนเทศภาครัฐ',
  'open'
WHERE NOT EXISTS (
  SELECT 1 FROM public.dev_journal
  WHERE module = 'ข้อมูลระบบ' AND title = 'แผนพัฒนาสถาปัตยกรรม Google Cloud, Geospatial & AI สำหรับ Smart City อปท.'
);
