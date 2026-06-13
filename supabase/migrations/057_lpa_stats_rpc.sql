-- 057_lpa_stats_rpc.sql
-- RPC สาธารณะสำหรับสถิติคำขอเอกสาร (LPA ๑.๗ Transparency Dashboard)
-- ใช้ SECURITY DEFINER เพื่อให้ anon เรียกได้โดยไม่ต้อง login

-- ── สถิติรวม ──────────────────────────────────────────────────────────────────
create or replace function public.doc_request_stats(_municipality_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  return (
    select json_build_object(
      'total',      count(*),
      'pending',    count(*) filter (where status = 'pending'),
      'processing', count(*) filter (where status = 'processing'),
      'completed',  count(*) filter (where status = 'completed'),
      'rejected',   count(*) filter (where status = 'rejected'),
      'avg_days',   round(
                      avg(
                        extract(epoch from (issued_at - created_at)) / 86400.0
                      ) filter (where status = 'completed' and issued_at is not null),
                      1
                    ),
      'this_month', count(*) filter (
                      where date_trunc('month', created_at at time zone 'Asia/Bangkok')
                          = date_trunc('month', now() at time zone 'Asia/Bangkok')
                    )
    )
    from document_requests
    where municipality_id = _municipality_id
  );
end;
$$;

grant execute on function public.doc_request_stats(uuid) to anon, authenticated;

-- ── รายการคำขอ (ไม่มี PII) ───────────────────────────────────────────────────
create or replace function public.doc_requests_public(
  _municipality_id uuid,
  _limit           int default 30
)
returns table (
  ref_id     text,
  doc_type   text,
  purpose    text,
  status     text,
  created_at timestamptz,
  issued_at  timestamptz,
  days_taken numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select
      left(dr.id::text, 8)                    as ref_id,
      dr.document_type                         as doc_type,
      left(coalesce(dr.purpose, ''), 30)       as purpose,
      dr.status                                as status,
      dr.created_at                            as created_at,
      dr.issued_at                             as issued_at,
      case
        when dr.status = 'completed' and dr.issued_at is not null
        then round(
               extract(epoch from (dr.issued_at - dr.created_at)) / 86400.0,
               1
             )
        else null
      end                                      as days_taken
    from document_requests dr
    where dr.municipality_id = _municipality_id
    order by dr.created_at desc
    limit _limit;
end;
$$;

grant execute on function public.doc_requests_public(uuid, int) to anon, authenticated;
