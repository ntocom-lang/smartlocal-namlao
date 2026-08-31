-- ═══ ส่วนที่ 3/3: เติมข้อมูล + ย้าย FK + RLS + ฟังก์ชัน ══════════
-- ⚠️ ต้องรัน 2 ไฟล์นี้ให้จบก่อนตามลำดับ:
--     20260831140000_positions_add_municipality_column.sql  (สแนปช็อต + คอลัมน์)
--     20260831141000_positions_helper_tables.sql            (ตารางเปล่า)
--
-- ไฟล์นี้ไม่สร้าง object ใหม่ที่ตัวเองต้องอ้างถึงเลย ทุกอย่างที่อ้างถูกสร้างในไฟล์ก่อนหน้าแล้ว
--
-- FK ที่ชี้มาที่ positions มี 2 จุดเท่านั้น (ตรวจแล้ว) ต้อง repoint ทั้งคู่ก่อนลบแถวกลาง:
--   - profiles.position_id         ON DELETE SET NULL
--   - position_holders.position_id ON DELETE CASCADE

DO $$
BEGIN
  IF to_regclass('public.position_templates') IS NULL OR to_regclass('public._position_clone_map') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตารางที่ต้องมีก่อน — ต้องรัน 20260831141000_positions_helper_tables.sql ก่อน';
  END IF;

  IF to_regclass('public.positions_backup_20260831') IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตารางสแนปช็อต positions_backup_20260831 — ห้ามรันต่อโดยไม่มี backup';
  END IF;
END $$;

COMMENT ON TABLE public.position_templates IS
  'ชุดตำแหน่งมาตรฐาน อบต./เทศบาล ใช้เป็นแม่แบบให้ อปท. ใหม่กดนำเข้า ไม่ใช่ข้อมูลที่ใช้งานจริง';

-- ── 2. เก็บชุดมาตรฐานไว้เป็นแม่แบบก่อน (ก่อนที่แถวกลางจะถูกลบ) ──
-- ชื่อซ้ำในชุดกลางเดิม (ถ้ามี) ยุบเหลือแถวเดียวด้วย DISTINCT ON — sort_order ต่ำสุดชนะ
INSERT INTO public.position_templates (name, category, role, department_hint, sort_order)
SELECT DISTINCT ON (p.name) p.name, p.category, p.role, p.department_hint, p.sort_order
FROM public.positions p
WHERE p.municipality_id IS NULL
ORDER BY p.name, p.sort_order, p.id
ON CONFLICT (name) DO NOTHING;

-- ── 3. โคลนชุดกลางให้ทุก อปท. พร้อมบันทึกลงตารางแมป ────────────
-- ใช้ลูป PL/pgSQL แทน CTE เพราะต้องแมปทีละแถวให้ครบแม้ชุดกลางจะมีชื่อซ้ำ (แถวซ้ำทุกแถวชี้ไป
-- โคลนตัวเดียวกัน)
DO $$
DECLARE
  v_m      record;
  v_p      record;
  v_new_id uuid;
BEGIN
  FOR v_m IN SELECT id FROM public.municipalities LOOP
    FOR v_p IN
      SELECT DISTINCT ON (name) name, category, role, department_hint, sort_order
      FROM public.positions
      WHERE municipality_id IS NULL
      ORDER BY name, sort_order, id
    LOOP
      INSERT INTO public.positions (name, category, role, department_hint, sort_order, municipality_id)
      VALUES (v_p.name, v_p.category, v_p.role, v_p.department_hint, v_p.sort_order, v_m.id)
      RETURNING id INTO v_new_id;

      INSERT INTO public._position_clone_map (old_id, new_id, municipality_id)
      SELECT g.id, v_new_id, v_m.id
      FROM public.positions g
      WHERE g.municipality_id IS NULL AND g.name = v_p.name;
    END LOOP;
  END LOOP;
END $$;

-- ── 4. ย้าย FK ทั้ง 2 จุดมาชี้โคลนของ อปท. ตัวเอง ──────────────
UPDATE public.profiles pr
SET position_id = map.new_id
FROM public._position_clone_map map
WHERE pr.position_id = map.old_id
  AND pr.municipality_id = map.municipality_id;

UPDATE public.position_holders ph
SET position_id = map.new_id
FROM public._position_clone_map map
WHERE ph.position_id = map.old_id
  AND ph.municipality_id = map.municipality_id;

-- ── 5. ประตูกันข้อมูลหาย: ห้ามลบแถวกลางถ้ายังมีคนของ อปท. ใดชี้อยู่ ──
DO $$
DECLARE
  v_left    integer;
  v_orphans integer;
BEGIN
  SELECT count(*) INTO v_left
  FROM public.profiles pr
  JOIN public.positions p ON p.id = pr.position_id
  WHERE p.municipality_id IS NULL AND pr.municipality_id IS NOT NULL;

  IF v_left > 0 THEN
    RAISE EXCEPTION 'ยังมี profiles % แถวที่ผูกตำแหน่งกลางแต่ repoint ไม่สำเร็จ — หยุดก่อนลบ ตรวจ public._position_clone_map', v_left;
  END IF;

  SELECT count(*) INTO v_orphans
  FROM public.position_holders ph
  JOIN public.positions p ON p.id = ph.position_id
  WHERE p.municipality_id IS NULL;

  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'ยังมี position_holders % แถวที่ผูกตำแหน่งกลาง — ลบแถวกลางตอนนี้จะโดน CASCADE หายไปด้วย', v_orphans;
  END IF;

  -- บัญชีที่ไม่สังกัด อปท. ใดเลย (superadmin, municipality_id IS NULL) จะโดน SET NULL ตอนลบแถวกลาง
  -- ไม่กระทบการใช้งาน เพราะ RPC บุคลากรสาธารณะกรองด้วย municipality_id อยู่แล้ว แต่แจ้งให้เห็น
  SELECT count(*) INTO v_left
  FROM public.profiles pr
  JOIN public.positions p ON p.id = pr.position_id
  WHERE p.municipality_id IS NULL AND pr.municipality_id IS NULL;

  IF v_left > 0 THEN
    RAISE NOTICE 'บัญชีที่ไม่สังกัด อปท. % แถว จะถูกล้าง position_id (ปกติคือ superadmin)', v_left;
  END IF;
END $$;

DELETE FROM public.positions WHERE municipality_id IS NULL;
DROP TABLE IF EXISTS public._position_clone_map;

-- ── 6. บังคับความเป็นเจ้าของถาวร ───────────────────────────────
ALTER TABLE public.positions ALTER COLUMN municipality_id SET NOT NULL;

-- ชื่อตำแหน่งห้ามซ้ำภายในหน่วยงานเดียวกัน (ข้ามหน่วยงานซ้ำได้ตามปกติ)
CREATE UNIQUE INDEX IF NOT EXISTS positions_municipality_name_key
  ON public.positions (municipality_id, name);
CREATE INDEX IF NOT EXISTS positions_municipality_sort_idx
  ON public.positions (municipality_id, sort_order);

COMMENT ON COLUMN public.positions.municipality_id IS
  'เจ้าของตำแหน่ง — แต่ละ อปท. มีชุดของตัวเอง แอดมินของหน่วยงานนั้นแก้ได้เฉพาะของตัวเอง';

-- ── 7. RLS ใหม่ ────────────────────────────────────────────────
-- policy เดิมเปิดให้ทุก role อ่านได้ทุกแถวข้าม อปท. และให้เขียนได้เฉพาะ superadmin
DROP POLICY IF EXISTS "staff and up can view positions" ON public.positions;
DROP POLICY IF EXISTS "superadmin manage positions" ON public.positions;
DROP POLICY IF EXISTS "positions read own municipality" ON public.positions;
DROP POLICY IF EXISTS "positions admin manage own municipality" ON public.positions;

CREATE POLICY "positions read own municipality"
  ON public.positions FOR SELECT
  TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (
      public.get_my_role() IN ('admin','officer','technician','staff','viewer','council')
      AND municipality_id = public.get_my_municipality_id()
    )
  );

CREATE POLICY "positions admin manage own municipality"
  ON public.positions FOR ALL
  TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  )
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  );

-- ── 8. RLS ของแม่แบบ: ทุกคนในระบบอ่านได้ แก้ได้เฉพาะ superadmin ──
ALTER TABLE public.position_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "position_templates read" ON public.position_templates;
CREATE POLICY "position_templates read"
  ON public.position_templates FOR SELECT
  TO authenticated
  USING (public.get_my_role() IN ('superadmin','admin','officer','technician','staff','viewer','council'));

DROP POLICY IF EXISTS "position_templates superadmin write" ON public.position_templates;
CREATE POLICY "position_templates superadmin write"
  ON public.position_templates FOR ALL
  TO authenticated
  USING (public.get_my_role() = 'superadmin')
  WITH CHECK (public.get_my_role() = 'superadmin');

REVOKE ALL ON TABLE public.position_templates FROM anon, public;
GRANT SELECT ON TABLE public.position_templates TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.position_templates TO authenticated;

-- ── 9. ปุ่ม "นำเข้าชุดตำแหน่งมาตรฐาน" ──────────────────────────
-- เติมเฉพาะชื่อที่ยังไม่มีในหน่วยงานนั้น กดซ้ำได้ไม่สร้างของซ้ำ (idempotent)
CREATE OR REPLACE FUNCTION public.import_default_positions(p_municipality_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุหน่วยงาน';
  END IF;

  -- SECURITY DEFINER ข้าม RLS ได้ จึงต้องตรวจสิทธิ์เองให้ครบ ไม่งั้นแอดมิน อปท. หนึ่ง
  -- ยิง RPC ใส่ municipality_id ของอีกหน่วยงานได้ตรงๆ
  IF NOT (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND p_municipality_id = public.get_my_municipality_id())
  ) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์นำเข้าชุดตำแหน่งของหน่วยงานนี้';
  END IF;

  INSERT INTO public.positions (name, category, role, department_hint, sort_order, municipality_id)
  SELECT t.name, t.category, t.role, t.department_hint, t.sort_order, p_municipality_id
  FROM public.position_templates t
  WHERE NOT EXISTS (
    SELECT 1 FROM public.positions p
    WHERE p.municipality_id = p_municipality_id AND p.name = t.name
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.import_default_positions(uuid) IS
  'คัดลอกชุดตำแหน่งมาตรฐานจาก position_templates เข้าให้หน่วยงานที่ระบุ (ข้ามชื่อที่มีอยู่แล้ว)';

REVOKE ALL ON FUNCTION public.import_default_positions(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.import_default_positions(uuid) TO authenticated;
