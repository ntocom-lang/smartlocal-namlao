-- เมนู "แผนที่" ถูกรวมเข้ากับ "ศูนย์ข้อมูลดิจิทัล" แล้ว (ใช้ DataCenterMapView เดียวกันทั้งคู่)
-- ย้าย toggle ใน ModuleManager จาก key 'map' มาเป็น 'data-center' — เทศบาลที่เคยเปิด 'map' ไว้
-- ต้องได้ 'data-center' ไปด้วย ไม่งั้น toggle ใหม่จะ default ปิดทันทีหลัง deploy (regression)
update municipalities
set enabled_modules = array_append(enabled_modules, 'data-center')
where 'map' = any(enabled_modules)
  and not ('data-center' = any(enabled_modules));
