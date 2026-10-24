-- 20261025100200_complaint_stats_parked.sql
--
-- สถิติสาธารณะ (complaint_stats / complaint_stats_fy) นับเรื่อง "ขึ้นทะเบียนรอดำเนินการ" (parked)
-- ไม่งั้นเรื่องที่พักไว้หลุดจากทุกช่อง open / in_progress / resolved / rejected แต่ยังอยู่ใน total
-- ตัวเลขในหน้าสถิติและสรุปรายเดือนจึงบวกกันไม่เท่ายอดรวม
--
-- ⚠️ ใส่คีย์ 'parked' เฉพาะเมื่อ > 0 โดยเจตนา: complaint_monthly_snapshots เทียบ stats ทั้งก้อน
--    (v_prev.stats = v_stats) ถ้าเพิ่มคีย์ 'parked': 0 ให้ทุกเดือน ชุดสรุปรายเดือนที่ล็อกไว้แล้วทุกเดือน
--    จะถูกมองว่า "ต่างจากชุดที่ล็อก" ทั้งที่ข้อมูลไม่เปลี่ยน
--
-- ⚠️ CREATE OR REPLACE เขียนทับทั้งฟังก์ชัน (NOTES ข้อ 5) — คัดจาก production (pg_get_functiondef 2026-10-24)
--    ทุกบรรทัด เปลี่ยนแค่ห่อ json_build_object ให้ต่อคีย์ 'parked' ได้ · สิทธิ์ EXECUTE เดิมคงไว้ (ไม่แตะ GRANT)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'complaints_status_check' AND pg_get_constraintdef(oid) LIKE '%parked%'
  ) THEN
    RAISE EXCEPTION 'ต้องรัน 20261025100000_complaint_parked_columns.sql ก่อน';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.complaint_stats(_municipality_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT (
      json_build_object(
        'total',       count(*),
        'open',        count(*) FILTER (WHERE status IN ('new', 'pending', 'received')),
        'in_progress', count(*) FILTER (WHERE status = 'in_progress'),
        'resolved',    count(*) FILTER (WHERE status IN ('done', 'closed', 'completed')),
        'rejected',    count(*) FILTER (WHERE status = 'rejected'),
        'avg_days',    round(
                         avg(
                           extract(epoch FROM (closed_at - created_at)) / 86400.0
                         ) FILTER (
                           WHERE status IN ('done', 'closed', 'completed')
                             AND closed_at IS NOT NULL
                         ),
                         1
                       ),
        'this_month',  count(*) FILTER (
                         WHERE date_trunc('month', created_at AT TIME ZONE 'Asia/Bangkok')
                             = date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok')
                       )
      )::jsonb
      || CASE WHEN count(*) FILTER (WHERE status = 'parked') > 0
              THEN jsonb_build_object('parked', count(*) FILTER (WHERE status = 'parked'))
              ELSE '{}'::jsonb END
    )::json
    FROM complaints
    WHERE municipality_id = _municipality_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.complaint_stats_fy(_municipality_id uuid, _from date, _to date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz := (_from::timestamp) AT TIME ZONE 'Asia/Bangkok';
  v_to   timestamptz := ((_to + 1)::timestamp) AT TIME ZONE 'Asia/Bangkok';
BEGIN
  RETURN (
    SELECT (
      json_build_object(
        'total',       count(*),
        'open',        count(*) FILTER (WHERE status IN ('new', 'pending', 'received')),
        'in_progress', count(*) FILTER (WHERE status = 'in_progress'),
        'resolved',    count(*) FILTER (WHERE status IN ('done', 'closed', 'completed')),
        'rejected',    count(*) FILTER (WHERE status = 'rejected'),
        'avg_days',    round(
                         avg(
                           extract(epoch FROM (closed_at - created_at)) / 86400.0
                         ) FILTER (
                           WHERE status IN ('done', 'closed', 'completed')
                             AND closed_at IS NOT NULL
                         ),
                         1
                       ),
        'this_month',  count(*) FILTER (
                         WHERE date_trunc('month', created_at AT TIME ZONE 'Asia/Bangkok')
                             = date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok')
                       )
      )::jsonb
      || CASE WHEN count(*) FILTER (WHERE status = 'parked') > 0
              THEN jsonb_build_object('parked', count(*) FILTER (WHERE status = 'parked'))
              ELSE '{}'::jsonb END
    )::json
    FROM complaints
    WHERE municipality_id = _municipality_id
      AND created_at >= v_from
      AND created_at <  v_to
  );
END;
$function$;

-- ตรวจหลัง apply:
--   select public.complaint_stats('<uuid ของ อปท.>');                 → คีย์เดิมครบ ไม่มี 'parked' ตราบที่ยังไม่มีเรื่อง parked
--   select pg_get_functiondef('public.complaint_stats_fy(uuid,date,date)'::regprocedure) like '%parked%';
--   เทียบ privilege: select proacl from pg_proc where proname in ('complaint_stats','complaint_stats_fy'); ต้องเหมือนก่อน apply
