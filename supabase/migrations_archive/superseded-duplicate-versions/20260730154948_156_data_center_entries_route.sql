-- 156_data_center_entries_route.sql
-- เพิ่มการรองรับรายการแบบ "เส้นทาง" (เช่น ถนนสายหลัก) ใน data_center_entries นอกเหนือจากจุดเดี่ยวเดิม
-- route_points: array ของ {lat,lng} ตามลำดับ, ไม่บังคับ (null = รายการจุดเดี่ยวปกติแบบเดิม)
-- latitude/longitude เดิมยังคงเก็บจุดอ้างอิง (จุดกึ่งกลางเส้นทาง) ไว้เหมือนเดิม เพื่อให้ fitBounds/popup
-- positioning เดิมทำงานได้โดยไม่ต้องแก้โค้ดจุดอื่น

ALTER TABLE public.data_center_entries
  ADD COLUMN IF NOT EXISTS route_points jsonb,
  ADD COLUMN IF NOT EXISTS route_color text;
