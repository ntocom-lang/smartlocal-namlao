-- SmartLocal 121: เปลี่ยน fleet_departments ให้เป็นตารางกองกลางของทั้งระบบ
-- (ใช้ร่วมกับ "จัดการเจ้าหน้าที่" ไม่ใช่แค่ fleet อีกต่อไป)

ALTER TABLE public.fleet_departments RENAME TO departments;
ALTER TABLE public.profiles RENAME COLUMN fleet_department_id TO department_id;

CREATE OR REPLACE FUNCTION public.my_fleet()
RETURNS TABLE(mun_id uuid, frole text, fdept_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT municipality_id, fleet_role, department_id
  FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.fleet_seed_departments(p_municipality_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.departments(municipality_id, code, name, short_name, sort_order)
  VALUES
    (p_municipality_id, 'exec',        'ผู้บริหาร',           'ผบ.',   0),
    (p_municipality_id, 'general',     'สำนักปลัด',           'สป.',   1),
    (p_municipality_id, 'finance',     'กองคลัง',             'กค.',   2),
    (p_municipality_id, 'engineering', 'กองช่าง',             'กช.',   3),
    (p_municipality_id, 'education',   'กองการศึกษา',          'กศ.',   4)
  ON CONFLICT (municipality_id, code) DO NOTHING;
END;
$$;
-- History version aligned with linked Supabase project.
