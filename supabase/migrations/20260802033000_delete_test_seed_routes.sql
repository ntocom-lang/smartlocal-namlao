-- =====================================================
-- Migration: Delete Test Seed Routes from data_center_entries
-- =====================================================

DO $$
BEGIN
  DELETE FROM public.data_center_entries
  WHERE name IN (
    'ทางหลวงชนบท พร.5093 (ถนนสายหลัก 5093)',
    'ถนนสายรอง ทางไปอ่างเก็บน้ำแม่คำปอง',
    'สายน้ำแม่คำปอง (น้ำแม่คำมี - อ่างเก็บน้ำแม่คำปอง)'
  )
  OR name LIKE '%พร.5093%'
  OR route_color = '#dc2626';
END;
$$;
