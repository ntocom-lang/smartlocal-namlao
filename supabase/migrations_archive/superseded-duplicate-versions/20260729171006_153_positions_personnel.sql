-- ============================================================
-- 153_positions_personnel.sql
-- ระบบอ้างอิงตำแหน่ง/บุคลากร — ตาราง positions กลาง (ใช้ร่วมทุกเทศบาล ไม่ผูก
-- municipality_id) สำหรับให้เจ้าหน้าที่ browse ตำแหน่งทั้งหมด + แอดมินผูก
-- position_id ให้ profiles แต่ละคน
--
-- หมายเหตุ: backfill จาก schema จริงบน Supabase ย้อนหลัง (apply ตรงผ่าน
-- Supabase MCP ตอนพัฒนาฟีเจอร์ ไม่ได้มีไฟล์ migration ในโปรเจกต์ตั้งแต่แรก)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.positions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  category        text        NOT NULL
    CHECK (category IN ('political_exec','council','top_admin','dept_head','operating_staff','field_technician')),
  role            text        NOT NULL
    CHECK (role IN ('superadmin','admin','officer','technician','staff','viewer','council','citizen')),
  department_hint text,
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS position_id uuid REFERENCES public.positions(id) ON DELETE SET NULL;

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff and up can view positions" ON public.positions FOR SELECT
  TO authenticated
  USING (get_my_role() = ANY (ARRAY['staff','officer','technician','admin','superadmin','viewer','council']));

CREATE POLICY "superadmin manage positions" ON public.positions FOR ALL
  TO authenticated
  USING (get_my_role() = 'superadmin')
  WITH CHECK (get_my_role() = 'superadmin');

-- ── ข้อมูลตั้งต้น: โครงสร้างตำแหน่ง อบต./เทศบาล ────────────────
INSERT INTO public.positions (name, category, role, department_hint, sort_order) VALUES
  ('นายกเทศมนตรี / นายกองค์การบริหารส่วนตำบล',            'political_exec',   'viewer',     null,                          10),
  ('รองนายกเทศมนตรี / รองนายกองค์การบริหารส่วนตำบล',       'political_exec',   'viewer',     null,                          20),
  ('ที่ปรึกษานายกเทศมนตรี',                                'political_exec',   'viewer',     null,                          30),
  ('เลขานุการนายกเทศมนตรี',                                'political_exec',   'viewer',     null,                          40),
  ('ประธานสภา',                                            'council',          'council',    null,                         110),
  ('รองประธานสภา',                                         'council',          'council',    null,                         120),
  ('เลขานุการสภา',                                         'council',          'council',    null,                         130),
  ('สมาชิกสภา',                                            'council',          'council',    null,                         140),
  ('ปลัดเทศบาล / ปลัดองค์การบริหารส่วนตำบล',                'top_admin',        'admin',      null,                         210),
  ('รองปลัดเทศบาล / รองปลัดองค์การบริหารส่วนตำบล',          'top_admin',        'admin',      null,                         220),
  ('หัวหน้าสำนักปลัด',                                      'dept_head',        'officer',    'สำนักปลัด',                   310),
  ('ผู้อำนวยการกองคลัง',                                    'dept_head',        'officer',    'กองคลัง',                     320),
  ('ผู้อำนวยการกองช่าง',                                    'dept_head',        'officer',    'กองช่าง',                     330),
  ('ผู้อำนวยการกองการศึกษา ศาสนาและวัฒนธรรม',                'dept_head',        'officer',    'กองการศึกษา',                 340),
  ('ผู้อำนวยการกองสาธารณสุขและสิ่งแวดล้อม',                  'dept_head',        'officer',    'กองสาธารณสุขและสิ่งแวดล้อม',    350),
  ('ผู้อำนวยการกองสวัสดิการสังคม',                           'dept_head',        'officer',    'กองสวัสดิการสังคม',            360),
  ('ผู้อำนวยการกองยุทธศาสตร์และงบประมาณ',                    'dept_head',        'officer',    'กองยุทธศาสตร์และงบประมาณ',      370),
  ('หัวหน้าหน่วยตรวจสอบภายใน',                              'dept_head',        'officer',    'ตรวจสอบภายใน',                380),
  ('นักวิชาการ',                                            'operating_staff',  'staff',      null,                         410),
  ('เจ้าพนักงาน',                                          'operating_staff',  'staff',      null,                         420),
  ('ครู/ผู้ดูแลเด็ก',                                      'operating_staff',  'staff',      'กองการศึกษา',                 430),
  ('พนักงานจ้างทั่วไป/ผู้ช่วยเจ้าหน้าที่',                    'operating_staff',  'staff',      null,                         440),
  ('นักวิชาการตรวจสอบภายใน',                                'operating_staff',  'staff',      'ตรวจสอบภายใน',                450),
  ('นายช่างโยธา',                                          'field_technician', 'technician', 'กองช่าง',                     510),
  ('ช่างไฟฟ้า',                                            'field_technician', 'technician', 'กองช่าง',                     520),
  ('ช่างประปา',                                            'field_technician', 'technician', 'กองช่าง',                     530),
  ('พนักงานขับเครื่องจักรกล',                                'field_technician', 'technician', 'กองช่าง',                     540)
ON CONFLICT DO NOTHING;
