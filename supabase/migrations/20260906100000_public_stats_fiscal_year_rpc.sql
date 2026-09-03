-- 20260906100000_public_stats_fiscal_year_rpc.sql
--
-- เกณฑ์ ITA แบบวัด OIT ข้อ e-Service กำหนดให้เผยแพร่ "รายงานสถิติข้อมูลการขอรับบริการผ่าน
-- ช่องทางออนไลน์ (e-Service) ปีงบประมาณ พ.ศ. ...." คือผูกกับ *ปีงบประมาณ* ไม่ใช่ยอดสะสม
-- แต่ RPC สาธารณะที่มีอยู่ (complaint_stats / doc_request_stats) นับทั้งตารางเสมอ และ
-- doc_requests_public() ดึงมาแค่ 30 แถวล่าสุด กรองปีงบฝั่ง client ไม่ได้เลย
--
-- จึงเพิ่มฟังก์ชันคู่ขนานที่รับช่วงวันที่ ไม่แตะของเดิม:
--   * ตั้งชื่อใหม่ (_fy) แทนการเติม parameter ที่มี DEFAULT ให้ฟังก์ชันเดิม เพราะ overload
--     ที่มี default จะทำให้การเรียกแบบ (uuid, int) กำกวม (42725 function is not unique)
--     แล้วหน้าเดิมทั้งหมดพังพร้อมกัน
--   * ของเดิมยังอยู่ครบ ใช้กับตัวเลือก "ทุกปีงบประมาณ" และ widget หน้าแรก
--
-- ขอบเขตวันที่: _from/_to เป็น date ตามปฏิทินไทย (Asia/Bangkok) แปลงเป็น timestamptz
-- ก่อนเทียบ เพื่อให้ยังใช้ index บน created_at ได้ (ไม่ห่อ created_at ด้วย AT TIME ZONE
-- ซึ่งจะทำให้ index ใช้ไม่ได้และ seq scan ทั้งตารางเมื่อข้อมูลโต)
-- _to เป็นวันสุดท้ายที่นับรวม จึงเทียบด้วย < (_to + 1 วัน) ไม่ใช่ <=
--
-- PII: คงกฎเดิมทุกข้อ — complaints_public_fy ไม่มีคอลัมน์ phone/detail/reporter_name/
-- village/พิกัด และ doc_requests_public_fy คืน purpose เฉพาะเจ้าหน้าที่ของ อปท. นั้น
-- (ยกมาจาก 20260830160000 ทั้งดุ้น ห้ามลดเงื่อนไข)

-- ── คำร้อง: สถิติรวมตามช่วงวันที่ ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complaint_stats_fy(
  _municipality_id uuid,
  _from            date,
  _to              date
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := (_from::timestamp) AT TIME ZONE 'Asia/Bangkok';
  v_to   timestamptz := ((_to + 1)::timestamp) AT TIME ZONE 'Asia/Bangkok';
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
      -- this_month = เดือนปฏิทินปัจจุบัน และต้องอยู่ในช่วงที่เลือกด้วย ถ้าดูปีงบเก่าจะได้ 0
      -- ซึ่งถูกแล้ว (เดือนนี้ไม่ได้อยู่ในปีงบนั้น) หน้า UI จึงซ่อนบรรทัดนี้เมื่อไม่ใช่ปีงบปัจจุบัน
      'this_month',  count(*) FILTER (
                       WHERE date_trunc('month', created_at AT TIME ZONE 'Asia/Bangkok')
                           = date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok')
                     )
    )
    FROM complaints
    WHERE municipality_id = _municipality_id
      AND created_at >= v_from
      AND created_at <  v_to
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complaint_stats_fy(uuid, date, date) TO anon, authenticated;

COMMENT ON FUNCTION public.complaint_stats_fy(uuid, date, date) IS
  'สถิติคำร้องสาธารณะตามช่วงวันที่ (ใช้กับตัวกรองปีงบประมาณของหน้า /reports/complaints ตามเกณฑ์ ITA OIT e-Service)';

-- ── คำร้อง: รายการตามช่วงวันที่ (ไม่มี PII) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complaints_public_fy(
  _municipality_id uuid,
  _limit           int,
  _from            date,
  _to              date
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
DECLARE
  v_from timestamptz := (_from::timestamp) AT TIME ZONE 'Asia/Bangkok';
  v_to   timestamptz := ((_to + 1)::timestamp) AT TIME ZONE 'Asia/Bangkok';
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
      AND c.created_at >= v_from
      AND c.created_at <  v_to
    ORDER BY c.created_at DESC
    LIMIT _limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complaints_public_fy(uuid, int, date, date) TO anon, authenticated;

-- ── คำขอเอกสาร: สถิติรวมตามช่วงวันที่ ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.doc_request_stats_fy(
  _municipality_id uuid,
  _from            date,
  _to              date
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from timestamptz := (_from::timestamp) AT TIME ZONE 'Asia/Bangkok';
  v_to   timestamptz := ((_to + 1)::timestamp) AT TIME ZONE 'Asia/Bangkok';
BEGIN
  RETURN (
    SELECT json_build_object(
      'total',      count(*),
      'pending',    count(*) FILTER (WHERE status = 'pending'),
      'processing', count(*) FILTER (WHERE status = 'processing'),
      'completed',  count(*) FILTER (WHERE status = 'completed'),
      'rejected',   count(*) FILTER (WHERE status = 'rejected'),
      'avg_days',   round(
                      avg(
                        extract(epoch FROM (issued_at - created_at)) / 86400.0
                      ) FILTER (WHERE status = 'completed' AND issued_at IS NOT NULL),
                      1
                    ),
      'this_month', count(*) FILTER (
                      WHERE date_trunc('month', created_at AT TIME ZONE 'Asia/Bangkok')
                          = date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok')
                    )
    )
    FROM document_requests
    WHERE municipality_id = _municipality_id
      AND created_at >= v_from
      AND created_at <  v_to
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.doc_request_stats_fy(uuid, date, date) TO anon, authenticated;

COMMENT ON FUNCTION public.doc_request_stats_fy(uuid, date, date) IS
  'สถิติคำขอเอกสารสาธารณะตามช่วงวันที่ (ใช้กับตัวกรองปีงบประมาณของหน้า /doc-stats ตามเกณฑ์ ITA OIT e-Service)';

-- ── คำขอเอกสาร: รายการตามช่วงวันที่ (purpose คืนเฉพาะเจ้าหน้าที่ของ อปท. นั้น) ──────
CREATE OR REPLACE FUNCTION public.doc_requests_public_fy(
  _municipality_id uuid,
  _limit           int,
  _from            date,
  _to              date
)
RETURNS TABLE (
  ref_id     text,
  doc_type   text,
  purpose    text,
  status     text,
  created_at timestamptz,
  issued_at  timestamptz,
  days_taken numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_privileged boolean;
  v_from timestamptz := (_from::timestamp) AT TIME ZONE 'Asia/Bangkok';
  v_to   timestamptz := ((_to + 1)::timestamp) AT TIME ZONE 'Asia/Bangkok';
BEGIN
  v_privileged := auth.uid() IS NOT NULL AND (
    get_my_role() = 'superadmin'
    OR (
      get_my_role() IN ('admin', 'officer', 'staff', 'technician', 'viewer', 'council')
      AND get_my_municipality_id() = _municipality_id
    )
  );

  RETURN QUERY
    SELECT
      left(dr.id::text, 8)               AS ref_id,
      dr.document_type                   AS doc_type,
      CASE
        WHEN v_privileged THEN left(coalesce(dr.purpose, ''), 30)
        ELSE NULL
      END                                AS purpose,
      dr.status                          AS status,
      dr.created_at                      AS created_at,
      dr.issued_at                       AS issued_at,
      CASE
        WHEN dr.status = 'completed' AND dr.issued_at IS NOT NULL
        THEN round(
               extract(epoch FROM (dr.issued_at - dr.created_at)) / 86400.0,
               1
             )
        ELSE NULL
      END                                AS days_taken
    FROM document_requests dr
    WHERE dr.municipality_id = _municipality_id
      AND dr.created_at >= v_from
      AND dr.created_at <  v_to
    ORDER BY dr.created_at DESC
    LIMIT _limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.doc_requests_public_fy(uuid, int, date, date) TO anon, authenticated;

COMMENT ON FUNCTION public.doc_requests_public_fy(uuid, int, date, date) IS
  'รายการคำขอเอกสารสาธารณะตามช่วงวันที่ — purpose เป็นข้อความที่ประชาชนพิมพ์เอง คืนเฉพาะเจ้าหน้าที่ของ อปท. นั้น';

NOTIFY pgrst, 'reload schema';
