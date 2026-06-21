-- 080: trigger auto_assign ไม่เปลี่ยน status อัตโนมัติ
-- แอดมินต้องกด "รับเรื่อง" เองทุกครั้ง
CREATE OR REPLACE FUNCTION auto_assign_complaint()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  tech_id  uuid;
  v_sla    int;
BEGIN
  SELECT technician_id, COALESCE(sla_days, 3)
  INTO tech_id, v_sla
  FROM category_assignments
  WHERE municipality_id = NEW.municipality_id
    AND category        = NEW.category;

  IF tech_id IS NOT NULL THEN
    NEW.assigned_to := tech_id;
    -- ไม่เปลี่ยน status — ให้แอดมินรับเรื่องเอง
  END IF;

  IF NEW.due_date IS NULL THEN
    NEW.due_date := (NOW() AT TIME ZONE 'Asia/Bangkok')::date + v_sla;
  END IF;

  RETURN NEW;
END;
$$;
