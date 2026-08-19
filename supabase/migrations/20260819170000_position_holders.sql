-- เก็บชื่อคน "ถือตำแหน่ง" แบบไม่ต้องมีบัญชีระบบ (auth.users) — ใช้ตอนบางคำร้อง/เอกสารต้องระบุ
-- ชื่อผู้ลงนามตามตำแหน่งจริง แต่คนคนนั้นยังไม่เคยสมัครเข้าระบบเลย (เช่น ผู้บริหาร/สมาชิกสภาบางคน)
-- แยกจาก profiles.position_id (ต้องมีบัญชีเสมอ) โดยเจตนา — คนละ concern กัน: profiles.position_id
-- คือ "ใครถือตำแหน่งนี้และมีสิทธิ์ใช้งานระบบ", position_holders คือ "ใครถือตำแหน่งนี้ตามความจริง"
-- ไม่มี auto-link ผ่าน FK/trigger เจตนา — เช็คซ้ำด้วยชื่อ (case-insensitive) ตอน query แทน กันเคส
-- match ผิดพลาดจาก trigger ที่ซับซ้อนเกินจำเป็นสำหรับ use case ที่แค่ต้องการ "ชื่อไปใส่เอกสาร"

CREATE TABLE IF NOT EXISTS public.position_holders (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipality_id uuid        NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  position_id     uuid        NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE,
  department_id   uuid        REFERENCES public.departments(id) ON DELETE SET NULL,
  full_name       text        NOT NULL CHECK (length(btrim(full_name)) > 0),
  phone           text,
  created_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_position_holders_position ON public.position_holders (position_id);
CREATE INDEX IF NOT EXISTS idx_position_holders_municipality ON public.position_holders (municipality_id);

ALTER TABLE public.position_holders ENABLE ROW LEVEL SECURITY;

-- อ่านได้เฉพาะบุคลากรภายในเทศบาลเดียวกัน (ไม่ใช่ citizen, ไม่ใช่ข้าม อปท.)
DROP POLICY IF EXISTS "position_holders staff read own municipality" ON public.position_holders;
CREATE POLICY "position_holders staff read own municipality"
  ON public.position_holders FOR SELECT
  TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (
      public.get_my_role() IN ('admin','officer','technician','staff','viewer','council')
      AND municipality_id = public.get_my_municipality_id()
    )
  );

-- แก้ไขได้เฉพาะ admin/superadmin (admin จำกัดแค่ อปท.ตัวเอง)
DROP POLICY IF EXISTS "position_holders admin write own municipality" ON public.position_holders;
CREATE POLICY "position_holders admin write own municipality"
  ON public.position_holders FOR ALL
  TO authenticated
  USING (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  )
  WITH CHECK (
    public.get_my_role() = 'superadmin'
    OR (public.get_my_role() = 'admin' AND municipality_id = public.get_my_municipality_id())
  );

REVOKE ALL ON TABLE public.position_holders FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.position_holders TO authenticated;
