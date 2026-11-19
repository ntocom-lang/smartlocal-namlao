// ตลาดชาวบ้าน (ขั้น 1A) — ฟังก์ชันเรียก Supabase ทั้งหมดของฟีเจอร์ (ฟังก์ชันล้วนอยู่ที่ localMarket.js)
//
// ทุกฟังก์ชันคืน { data, error } โดย error เป็น "ข้อความไทย" หรือ null อยู่แล้ว (แปลงด้วย friendlyMarketError)
// สิทธิ์จริงคุมที่ RLS/RPC ในฐานข้อมูล — ที่นี่ไม่ตัดสินสิทธิ์เอง
//   ประชาชน (anon)   อ่านสินค้าที่ไม่ถูกซ่อน ต้อง "ระบุคอลัมน์" (PRODUCT_PUBLIC_COLS) ไม่งั้น 42501
//   เจ้าของร้าน      เพิ่ม/แก้/ลบสินค้าของร้านตัวเองตรงผ่าน supabase-js (ฐานข้อมูลตั้ง อปท./is_hidden เองใน trigger)
//   เจ้าหน้าที่       ซ่อน/เลิกซ่อนผ่าน RPC market_set_product_hidden (บังคับเหตุผล ลงสมุดบันทึก) · ผูก/ถอดเจ้าของผ่าน RPC
import { supabase } from './supabase'
import {
  PRODUCT_PUBLIC_COLS, PRODUCT_MANAGE_COLS, SEARCH_RESULT_LIMIT, MARKET_FAVORITE_LIMIT,
  friendlyMarketError, ilikePattern, normalizeHideReason,
} from './localMarket'

const ok = (data) => ({ data, error: null })
const fail = (error, fallback) => ({ data: null, error: friendlyMarketError(error, fallback) })
// supabase-js บางกรณีโยน exception (เครือข่ายล่ม) แทนคืน error — ห่อให้หน้าจอได้ข้อความไทยเสมอ
async function guard(run, fallback) {
  try { return await run() } catch (err) { return fail(err, fallback) }
}

// ── ฝั่งประชาชน ─────────────────────────────────────────────────────────────────

/** สินค้าของร้านที่แสดงสาธารณะ (ไม่ถูกซ่อน · RLS กรองให้อีกชั้น) เรียงตาม display_order */
export function fetchPublicProducts(placeId) {
  return guard(async () => {
    const { data, error } = await supabase.from('market_products').select(PRODUCT_PUBLIC_COLS)
      .eq('place_id', placeId).eq('is_hidden', false)
      .order('display_order').order('name')
    return error ? fail(error, 'โหลดสินค้าของร้านไม่สำเร็จ') : ok(data ?? [])
  }, 'โหลดสินค้าของร้านไม่สำเร็จ')
}

/**
 * ค้นชื่อสินค้าทั้ง อปท. — คืนเฉพาะ id/ร้าน/ชื่อ/ราคา/หน่วย (ไม่โหลดรูปในผลค้นหา · ประหยัด egress)
 * คำค้นสั้นเกินไปคืนรายการว่างโดยไม่ยิงฐานข้อมูล · ชื่อร้านให้หน้าจอจับคู่จาก place_id เอง
 */
export function searchProducts(municipalityId, rawTerm) {
  const pattern = ilikePattern(rawTerm)
  if (!municipalityId || !pattern) return Promise.resolve(ok([]))
  return guard(async () => {
    const { data, error } = await supabase.from('market_products').select('id, place_id, name, price, unit')
      .eq('municipality_id', municipalityId).eq('is_hidden', false)
      .ilike('name', pattern).order('name').limit(SEARCH_RESULT_LIMIT)
    return error ? fail(error, 'ค้นหาสินค้าไม่สำเร็จ') : ok(data ?? [])
  }, 'ค้นหาสินค้าไม่สำเร็จ')
}

/** รหัสร้าน/สถานที่ที่ฉันบันทึกเป็นรายการโปรด (ของ อปท. นี้) — เห็นเฉพาะของตัวเอง (RLS) */
export function fetchMyFavoriteIds(municipalityId) {
  return guard(async () => {
    const { data, error } = await supabase.from('tourism_favorites').select('place_id')
      .eq('municipality_id', municipalityId).limit(MARKET_FAVORITE_LIMIT)
    return error ? fail(error, 'โหลดรายการโปรดไม่สำเร็จ') : ok((data ?? []).map(r => r.place_id))
  }, 'โหลดรายการโปรดไม่สำเร็จ')
}

/** บันทึกร้านโปรด — ส่งแค่ place_id (ฐานข้อมูลตั้งผู้บันทึกและ อปท. เองใน trigger · เพดาน 200) */
export function addFavorite(placeId) {
  return guard(async () => {
    const { error } = await supabase.from('tourism_favorites').insert({ place_id: placeId })
    // 23505 = บันทึกไว้แล้ว (กดซ้ำจากสองแท็บ) ถือว่าสำเร็จ — ผลลัพธ์ที่ผู้ใช้ต้องการเกิดขึ้นแล้ว
    if (error && error.code !== '23505') return fail(error, 'บันทึกรายการโปรดไม่สำเร็จ')
    return ok(true)
  }, 'บันทึกรายการโปรดไม่สำเร็จ')
}

export function removeFavorite(placeId) {
  return guard(async () => {
    const { error } = await supabase.from('tourism_favorites').delete().eq('place_id', placeId)
    return error ? fail(error, 'เอาออกจากรายการโปรดไม่สำเร็จ') : ok(true)
  }, 'เอาออกจากรายการโปรดไม่สำเร็จ')
}

// ── ฝั่งเจ้าของร้าน ─────────────────────────────────────────────────────────────

/** ร้านที่ฉันเป็นเจ้าของ (market_shop_owners ของฉัน + ชื่อร้านจาก tourism_places) */
export function fetchMyShops(userId) {
  return guard(async () => {
    const owned = await supabase.from('market_shop_owners').select('place_id, linked_at').eq('user_id', userId)
    if (owned.error) return fail(owned.error, 'โหลดร้านของคุณไม่สำเร็จ')
    const ids = (owned.data ?? []).map(r => r.place_id)
    if (ids.length === 0) return ok([])
    const places = await supabase.from('tourism_places').select('id, name, category').in('id', ids)
    // ร้านที่ปิดใช้งานอ่านชื่อไม่ได้ (RLS) — ยังแสดงเป็นรายการให้เห็นว่ามีร้านอยู่ ไม่ให้หายเงียบ
    const nameById = Object.fromEntries((places.data ?? []).map(p => [p.id, p]))
    return ok(ids.map(id => ({ place_id: id, name: nameById[id]?.name ?? null, category: nameById[id]?.category ?? null })))
  }, 'โหลดร้านของคุณไม่สำเร็จ')
}

/** สินค้าทุกแถวของร้าน (รวมที่ถูกซ่อน + เหตุผล) — เจ้าของร้านและเจ้าหน้าที่ที่ดูแลร้านเห็น (RLS) */
export function fetchManageProducts(placeId) {
  return guard(async () => {
    const { data, error } = await supabase.from('market_products').select(PRODUCT_MANAGE_COLS)
      .eq('place_id', placeId).order('display_order').order('name')
    return error ? fail(error, 'โหลดสินค้าของร้านไม่สำเร็จ') : ok(data ?? [])
  }, 'โหลดสินค้าของร้านไม่สำเร็จ')
}

/** เพิ่มสินค้า — payload จาก buildProductPayload(form, { placeId, displayOrder }) · เพดาน 30 รายการ/ร้านโยนข้อความไทยจากฐานข้อมูล */
export function createProduct(payload) {
  return guard(async () => {
    const { data, error } = await supabase.from('market_products').insert(payload).select(PRODUCT_MANAGE_COLS).single()
    return error ? fail(error, 'เพิ่มสินค้าไม่สำเร็จ') : ok(data)
  }, 'เพิ่มสินค้าไม่สำเร็จ')
}

/** แก้สินค้า — payload ห้ามมี place_id (ไม่มีสิทธิ์ UPDATE คอลัมน์นั้น) */
export function updateProduct(productId, payload) {
  return guard(async () => {
    const fields = { ...payload }
    delete fields.place_id
    const { data, error } = await supabase.from('market_products').update(fields).eq('id', productId)
      .select(PRODUCT_MANAGE_COLS).single()
    return error ? fail(error, 'บันทึกสินค้าไม่สำเร็จ') : ok(data)
  }, 'บันทึกสินค้าไม่สำเร็จ')
}

/** สลับมีของ/หมด — แก้เฉพาะ is_available (คอลัมน์เดียว ไม่แตะคำรับรองเดิม) */
export function setProductAvailable(productId, isAvailable) {
  return updateProduct(productId, { is_available: Boolean(isAvailable) })
}

/** ลบสินค้า — เจ้าของร้านลบของตัวเอง · เจ้าหน้าที่ลบได้ (ฐานข้อมูลลงสมุดบันทึกให้เมื่อผู้ลบไม่ใช่เจ้าของ) */
export function deleteProduct(productId) {
  return guard(async () => {
    const { error } = await supabase.from('market_products').delete().eq('id', productId)
    return error ? fail(error, 'ลบสินค้าไม่สำเร็จ') : ok(true)
  }, 'ลบสินค้าไม่สำเร็จ')
}

// ── ฝั่งเจ้าหน้าที่ ─────────────────────────────────────────────────────────────

/** ซ่อน/เลิกซ่อนสินค้า — ซ่อนต้องมีเหตุผล (เจ้าของร้านเห็นเหตุผลนี้) · ฐานข้อมูลบันทึกผู้ซ่อน/เวลา/เหตุผลลงสมุดบันทึก */
export function setProductHidden(productId, hidden, reason) {
  return guard(async () => {
    const { error } = await supabase.rpc('market_set_product_hidden', {
      p_product_id: productId, p_hidden: Boolean(hidden), p_reason: hidden ? normalizeHideReason(reason) : null,
    })
    return error ? fail(error, hidden ? 'ซ่อนสินค้าไม่สำเร็จ' : 'เลิกซ่อนสินค้าไม่สำเร็จ') : ok(true)
  }, hidden ? 'ซ่อนสินค้าไม่สำเร็จ' : 'เลิกซ่อนสินค้าไม่สำเร็จ')
}

/**
 * เจ้าของร้านปัจจุบันของร้านนี้ — คืนเฉพาะ "มี/ไม่มี" + วันที่ผูก + คำขอที่ใช้ผูก (ไม่คืน user id เจ้าของให้หน้าจอ)
 * data = null เมื่อยังไม่มีเจ้าของ
 */
export function fetchShopOwnerStatus(placeId) {
  return guard(async () => {
    const { data, error } = await supabase.from('market_shop_owners').select('registration_id, linked_at')
      .eq('place_id', placeId).maybeSingle()
    return error ? fail(error, 'โหลดสถานะเจ้าของร้านไม่สำเร็จ') : ok(data ?? null)
  }, 'โหลดสถานะเจ้าของร้านไม่สำเร็จ')
}

/**
 * คำขอลงทะเบียนที่อนุมัติแล้วของ อปท. นี้ ให้เลือกผูกเป็นเจ้าของร้าน — คืนเฉพาะ id/ชื่อร้าน/วันที่ยื่น + hasAccount
 * (ไม่ดึงเบอร์/ที่อยู่/รหัสผู้ยื่นมาเก็บในหน้าจอ · hasAccount=false = ผู้ยื่นไม่มีบัญชีแล้ว ผูกไม่ได้)
 */
export function fetchApprovedRegistrations(municipalityId) {
  return guard(async () => {
    const { data, error } = await supabase.from('business_registrations')
      .select('id, business_name, created_at, user_id')
      .eq('municipality_id', municipalityId).eq('status', 'approved')
      .order('created_at', { ascending: false }).limit(200)
    if (error) return fail(error, 'โหลดรายการคำขอที่อนุมัติแล้วไม่สำเร็จ')
    return ok((data ?? []).map(r => ({
      id: r.id, business_name: r.business_name, created_at: r.created_at, hasAccount: Boolean(r.user_id),
    })))
  }, 'โหลดรายการคำขอที่อนุมัติแล้วไม่สำเร็จ')
}

/** ผูกบัญชีผู้ยื่นของคำขอที่อนุมัติแล้วเป็นเจ้าของร้าน (RPC ตรวจ: อปท. เดียวกัน · อนุมัติแล้ว · มีบัญชี) */
export function linkShopOwner(placeId, registrationId) {
  return guard(async () => {
    const { error } = await supabase.rpc('market_link_owner_from_registration', {
      p_place_id: placeId, p_registration_id: registrationId,
    })
    return error ? fail(error, 'ผูกเจ้าของร้านไม่สำเร็จ') : ok(true)
  }, 'ผูกเจ้าของร้านไม่สำเร็จ')
}

/** ถอดเจ้าของร้าน — สินค้าคงอยู่ เจ้าหน้าที่ซ่อน/ลบเองได้ */
export function unlinkShopOwner(placeId) {
  return guard(async () => {
    const { error } = await supabase.rpc('market_unlink_owner', { p_place_id: placeId })
    return error ? fail(error, 'ถอดเจ้าของร้านไม่สำเร็จ') : ok(true)
  }, 'ถอดเจ้าของร้านไม่สำเร็จ')
}
