-- เพิ่มตัวเลือกโหมดการแสดงผล "ภาพพื้นหลัง Header" — บางธีม (เช่น thungkaew-Theme/ServiceHub) ต้องการโชว์
-- ภาพเต็มสีสันไม่มีเงาคลุม แทนที่จะใช้เป็นพื้นหลังจางๆ ไว้ทับด้วยตัวหนังสือแบบเดิม
-- 'background' (ค่าเริ่มต้น) = พฤติกรรมเดิม มีเงาไล่สีคลุมให้อ่านตัวหนังสือด้านบนได้
-- 'full'                    = โชว์ภาพเต็มสีสันจริง ไม่มีเงาคลุม
alter table municipalities
  add column if not exists header_image_mode text not null default 'background'
    check (header_image_mode in ('background', 'full'));
