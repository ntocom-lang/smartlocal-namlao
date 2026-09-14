-- ตารางรอบเก็บขยะ เฟส 3/3 — เติมคีย์โมดูล 'waste' ให้ทุก อปท.
--
-- ⚠️ ต้อง apply "ก่อน" deploy โค้ดที่เพิ่ม 'waste' เข้า MANAGED_MODULE_KEYS (src/lib/staffModules.js)
-- แถวที่ไม่มีคีย์ = ปิดโมดูล เมนูกับหน้า /waste จะหายจากทุก อปท. ทันทีที่โค้ดขึ้น
-- (กติกา: หลังบ้านทุก อปท. เหมือนกัน ยึด namlao เป็นต้นแบบ — จึงเติมให้ครบทุกแถว
--  ใครไม่ซื้อโมดูลนี้ แอดมินค่อยติ๊กปิดเองในหน้าจัดการโมดูล)
--
-- apply ก่อนโค้ดได้ปลอดภัย: โค้ดเก่าไม่รู้จักคีย์นี้ ค่าที่เกินมาไม่มีผลกับอะไร

UPDATE public.municipalities
SET enabled_modules = array_append(enabled_modules, 'waste')
WHERE enabled_modules IS NOT NULL
  AND NOT ('waste' = ANY (enabled_modules));
