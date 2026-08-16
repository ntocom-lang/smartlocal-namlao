-- 20260816150000_complaint_public_stats_rpc.sql
-- RPC สาธารณะสำหรับสถิติคำร้องเรียน (หน้า "รายงาน" ความโปร่งใสสำหรับประชาชน)
-- Pattern เดียวกับ 057_lpa_stats_rpc.sql (doc_request_stats / doc_requests_public)
-- SECURITY DEFINER ให้ anon เรียกได้โดยไม่ต้อง login
--
-- ระวัง PII: ห้าม select phone / detail / reporter_name / village / latitude / longitude
-- exact ออกมาเด็ดขาด — 132_fix_complaint_ref_pii_leak.sql เคยมีบั๊กข้อมูลรั่วจากจุดนี้มาก่อน
-- ฟังก์ชันนี้จึง "ปลอดภัยโดยโครงสร้าง" คือไม่มีคอลัมน์พวกนั้นใน RETURNS เลย ไม่ใช่แค่ mask เป็น null
--
-- หมายเหตุ status: constraint จริงบน production (ตรวจสอบผ่าน pg_constraint ก่อนเขียนไฟล์นี้ —
-- ไฟล์ 002_create_complaints.sql ในโปรเจกต์เก่ากว่าที่ใช้งานจริง ตรงตามรูปแบบ schema drift ที่เคย
-- เจอมาก่อนหน้านี้) อนุญาต 8 ค่า: new/pending/received/in_progress/done/closed/completed/rejected
-- (new/done/closed เป็นของเดิมที่ยังมีข้อมูลจริงค้างอยู่ ไม่ใช่แค่ legacy ที่เลิกใช้แล้ว)
-- รวมเป็น 4 กลุ่มแสดงผลสาธารณะ: open(new,pending,received) / in_progress / resolved(done,closed,completed) / rejected

-- ── สถิติรวม ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complaint_stats(_municipality_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT json_build_object(
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
    )
    FROM complaints
    WHERE municipality_id = _municipality_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complaint_stats(uuid) TO anon, authenticated;

-- ── รายการคำร้อง (ไม่มี PII — ไม่มี phone/detail/reporter_name/village/พิกัดจริง) ──────
CREATE OR REPLACE FUNCTION public.complaints_public(
  _municipality_id uuid,
  _limit           int DEFAULT 30
)
RETURNS TABLE (
  ref_id     text,
  category   text,
  status     text,
  created_at timestamptz,
  closed_at  timestamptz,
  days_taken numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT
      coalesce(c.ref_no, left(c.id::text, 8)) AS ref_id,
      c.category                              AS category,
      c.status                                AS status,
      c.created_at                            AS created_at,
      c.closed_at                             AS closed_at,
      CASE
        WHEN c.status IN ('done', 'closed', 'completed') AND c.closed_at IS NOT NULL
        THEN round(
               extract(epoch FROM (c.closed_at - c.created_at)) / 86400.0,
               1
             )
        ELSE NULL
      END                                      AS days_taken
    FROM complaints c
    WHERE c.municipality_id = _municipality_id
    ORDER BY c.created_at DESC
    LIMIT _limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complaints_public(uuid, int) TO anon, authenticated;
;
