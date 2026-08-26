-- 20260828090000_data_center_group_icons.sql
--
-- ไอคอน (emoji) ของ "กลุ่มหลัก" (data_center_entries.group_name) เดิมคำนวณจาก keyword/hash fallback
-- แยกกันคนละชุดระหว่างหน้ารายการ (DataCenterOverview.jsx) กับแผนที่ (DataCenterMapView.jsx) — กลุ่ม
-- เดียวกันเลยขึ้นคนละอิโมจิ (เช่น "สาธารณสุข" เป็น 🏥 ในหน้ารายการ แต่ ⛑️ บนแผนที่) ผู้ใช้ต้องการให้
-- ตั้งเองได้ + ให้ 2 หน้าใช้ค่าเดียวกัน — ตารางนี้เป็น override ต่อเทศบาล ถ้าไม่ได้ตั้งไว้ยัง fallback ไป
-- ใช้ heuristic เดิม (ดู src/lib/dataCenterGroupIcon.js) ไม่บังคับต้องตั้งค่าก่อนถึงจะใช้งานได้
CREATE TABLE IF NOT EXISTS public.data_center_group_icons (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid        NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  group_name      text        NOT NULL,
  emoji           text        NOT NULL,
  updated_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (municipality_id, group_name)
);

CREATE INDEX IF NOT EXISTS idx_dcgi_municipality ON public.data_center_group_icons (municipality_id);

ALTER TABLE public.data_center_group_icons ENABLE ROW LEVEL SECURITY;

-- อ่านได้ทุก role ที่เข้าศูนย์ข้อมูลดิจิทัลได้อยู่แล้ว (ตรงกับ "dce staff read own municipality" ของ
-- data_center_entries) + ให้ anon อ่านได้ด้วยเพราะแผนที่สาธารณะ (/data-center/public) ก็ต้องใช้ไอคอนนี้
CREATE POLICY "dce icons public read" ON public.data_center_group_icons FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "dce icons admin upsert own municipality" ON public.data_center_group_icons FOR INSERT
  TO authenticated
  WITH CHECK (
    get_my_role() = ANY (ARRAY['admin','superadmin'])
    AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())
  );

CREATE POLICY "dce icons admin update own municipality" ON public.data_center_group_icons FOR UPDATE
  TO authenticated
  USING (
    get_my_role() = ANY (ARRAY['admin','superadmin'])
    AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())
  )
  WITH CHECK (
    get_my_role() = ANY (ARRAY['admin','superadmin'])
    AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())
  );

CREATE POLICY "dce icons admin delete own municipality" ON public.data_center_group_icons FOR DELETE
  TO authenticated
  USING (
    get_my_role() = ANY (ARRAY['admin','superadmin'])
    AND (get_my_role() = 'superadmin' OR municipality_id = get_my_municipality_id())
  );
