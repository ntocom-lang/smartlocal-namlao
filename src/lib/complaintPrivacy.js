import { supabase } from './supabase'

function normalizeComplaintRows(data) {
  return (data ?? [])
    .map((row) => row?.data ?? row)
    .filter((row) => row && typeof row === 'object')
}

export async function fetchRoleScopedComplaints(municipalityId) {
  if (!municipalityId) return { data: [], error: null }

  const { data, error } = await supabase.rpc('list_complaints_for_staff', {
    p_municipality_id: municipalityId,
  })

  return { data: normalizeComplaintRows(data), error }
}

export async function fetchComplaintPrivateDetail(complaintId, reason) {
  if (!complaintId) return { data: null, error: null }

  const { data, error } = await supabase.rpc('get_complaint_private_detail', {
    p_complaint_id: complaintId,
    p_reason: reason || null,
  })

  return { data: data?.data ?? data ?? null, error }
}
