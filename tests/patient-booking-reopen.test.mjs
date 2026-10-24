// In-memory PostgreSQL only. No .env, network client or real citizen records.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describeHistory, reportEvent } from '../src/lib/patientBooking.js'
process.env.MANUAL_UI_QA = '1'
const { db, actor, rpc, tenant, admin, coordinator, driver, citizen, owner, row, trip, booking, submit, confirm } = await import('./patient-booking-manual-schedule.test.mjs')
const files = ['20261024190000_patient_booking_reopen_rpc.sql','20261024190100_patient_booking_reopen_history.sql']
const awaitHistoryMigration=await readFile(new URL(`../supabase/migrations/${files[1]}`,import.meta.url),'utf8')
const exec = sql => owner(() => db.exec(sql))
const query = (sql,args=[]) => owner(() => db.query(sql,args))
const snapshot = () => row("SELECT jsonb_build_object('bookings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.patient_bookings b),'trips',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.patient_booking_trips t),'events',(SELECT count(*) FROM public.patient_booking_events),'notices',(SELECT count(*) FROM public.patient_booking_notices),'operations',(SELECT count(*) FROM public.patient_booking_operations)) AS v")
const counters = async bid => ({ b: await booking(bid), ...(await row('SELECT (SELECT count(*)::int FROM public.patient_booking_events WHERE entity_id=$1) e,(SELECT count(*)::int FROM public.patient_booking_notices WHERE entity_id=$1) n,(SELECT count(*)::int FROM public.patient_booking_operations) o',[bid])) })
const act = async (bid,action='cancel',note='TEST ยกเลิกแล้ว') => {
  const b = await booking(bid); await actor(coordinator)
  await rpc('patient_booking_action',[tenant,randomUUID(),bid,b.revision,action,note])
}
const makeCancelled = async name => { const bid=await submit(`คืน ${name} ${randomUUID()}`); await act(bid); return bid }
const reopen = async (bid,reason='TEST ประสานแล้ว คืนคำขอ',op=randomUUID(),revision=null,who=coordinator,muni=tenant) => {
  const b=await booking(bid); await actor(who)
  return rpc('patient_booking_reopen',[muni,op,bid,revision??b.revision,reason])
}
const history = async bid => { await actor(coordinator); return (await rpc('patient_booking_history',[tenant,bid])).events }
const tick = () => new Promise(resolve=>setTimeout(resolve,5))
const noteTrip = async (tid,note,action='issue') => {
  await tick(); const eid=randomUUID()
  await query('INSERT INTO public.patient_booking_events(id,municipality_id,actor_id,entity_id,action,detail) VALUES($1,$2,$3,$4,$5,$6)',[eid,tenant,coordinator,tid,action,{note}])
  await tick(); return eid
}
let success = false
try {
  const before = await snapshot()
  for (const [index,file] of files.entries()) {
    await exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'))
    if(index===0){await actor(coordinator);await assert.rejects(()=>rpc('patient_booking_reopen',[tenant,randomUUID(),randomUUID(),1,'TEST rollout']),/permission denied/)}
  }
  assert.deepEqual(await snapshot(),before,'migrations change definitions only')
  const pending=await makeCancelled('ก่อนยืนยัน'), pendingBefore=await booking(pending), op=randomUUID()
  const answer=await reopen(pending,'TEST กดยกเลิกผิด',op)
  assert.equal(answer,pending)
  const restored=await booking(pending)
  assert.equal(restored.status,'submitted'); assert.equal(restored.trip_id,null); assert.equal(restored.requested_trip_id,null)
  assert.equal(restored.cancel_requested,false); assert.equal(restored.return_ready,false); assert.equal(restored.revision,pendingBefore.revision+1)
  const allowed=new Set(['status','trip_id','requested_trip_id','cancel_requested','return_ready','revision','updated_at'])
  for (const key of Object.keys(pendingBefore)) if(!allowed.has(key)) assert.deepEqual(restored[key],pendingBefore[key],key)
  const after=await counters(pending); await reopen(pending,'TEST กดยกเลิกผิด',op,pendingBefore.revision)
  assert.deepEqual(await counters(pending),after,'lost response retry is exactly once')
  assert.equal((await history(pending)).filter(e=>e.action==='reopened').length,1)
  await actor(citizen)
  const mine=await rpc('patient_booking_mine_v2',[tenant]), mineRestored=mine.bookings.find(b=>b.id===pending)
  assert.equal(mineRestored.status,'submitted'); assert.equal(mineRestored.trip_id,null); assert.ok(!mineRestored.cancel_note)
  await assert.rejects(()=>rpc('patient_booking_history',[tenant,pending]),/เฉพาะเจ้าหน้าที่/)
  assert.ok(describeHistory(await history(pending)).some(e=>e.label==='เปิดคำขอกลับมาใช้'))
  assert.equal(reportEvent({action:'reopened',entity_id:pending,detail:{note:'TEST'}}).label,'เปิดคำขอกลับมาใช้')
  const newTrip=await confirm(pending); assert.equal((await booking(pending)).trip_id,newTrip)
  assert.equal((await trip(newTrip)).state,'confirmed')
  await assert.rejects(()=>reopen(pending,'TEST เปลี่ยนเหตุผล',op,pendingBefore.revision),/รหัสรายการซ้ำ/)
  await assert.rejects(()=>reopen(pending,'TEST กดยกเลิกผิด',op,pendingBefore.revision,admin),/รหัสรายการซ้ำ/)
  console.log('PASS reopen pending: original id/data, audit/report/notice, retry once, manual confirmation required')

  const solo=await submit(`คืนยืนยันคนเดียว ${randomUUID()}`), oldSolo=await confirm(solo)
  await actor(coordinator)
  await rpc('patient_booking_record_booking_letter',[tenant,solo,0,'TEST 2569/คืนคำขอ',new Date().toISOString().slice(0,10)])
  await act(solo,'cancel_passenger')
  const s=await trip(oldSolo); await rpc('patient_booking_action',[tenant,randomUUID(),oldSolo,s.revision,'release','TEST ปิดเที่ยวที่ว่าง'])
  const savedSolo=await booking(solo), soloTripBefore=await trip(oldSolo)
  await reopen(solo)
  assert.deepEqual(await trip(oldSolo),soloTripBefore,'old trip is never revived or rewritten')
  assert.equal((await booking(solo)).forward_letter_no,savedSolo.forward_letter_no)
  assert.equal((await booking(solo)).letter_revision,savedSolo.letter_revision)
  console.log('PASS confirmed cancellation: keep letter metadata, leave released trip unchanged')

  const requested=await submit(`ผู้จองขอยกเลิก ${randomUUID()}`), requestedTrip=await confirm(requested)
  const requestedBefore=await booking(requested); await actor(citizen)
  await rpc('patient_booking_action',[tenant,randomUUID(),requested,requestedBefore.revision,'cancel',''])
  await actor(coordinator); const released=await trip(requestedTrip)
  await rpc('patient_booking_action',[tenant,randomUUID(),requestedTrip,released.revision,'release','TEST ประสานแล้ว ปิดเที่ยว'])
  assert.equal((await booking(requested)).trip_id,null)
  await reopen(requested); assert.equal((await booking(requested)).status,'submitted')
  const waitingJoin=await makeCancelled('ขอร่วมแต่ยังไม่ยืนยัน')
  await query('UPDATE public.patient_bookings SET requested_trip_id=$2 WHERE id=$1',[waitingJoin,newTrip])
  const unchangedTarget=await trip(newTrip); await reopen(waitingJoin)
  assert.equal((await booking(waitingJoin)).requested_trip_id,null); assert.deepEqual(await trip(newTrip),unchangedTarget)
  console.log('PASS requester cancellation followed by release, and pending join restoration without reserving the old target')

  const first=await submit(`คืนเที่ยวร่วม ${randomUUID()}`), mate=await submit(`ผู้ร่วมที่ไม่เปลี่ยน ${randomUUID()}`)
  await actor(coordinator); const plan=await rpc('patient_booking_preview',[tenant,[first,mate],'']), shared=randomUUID()
  assert.deepEqual(plan.errors,[]); await rpc('patient_booking_confirm',[tenant,shared,[first,mate],plan,''])
  const earliest=await noteTrip(shared,'TEST ระหว่างเป็นสมาชิก')
  await act(first,'cancel_passenger'); const excluded=await noteTrip(shared,'TEST หลังออกจากเที่ยว ไม่ใช่ของรายนี้')
  const sharedBefore=await trip(shared), mateBefore=await booking(mate)
  assert.ok((await history(first)).some(e=>e.id===earliest)); assert.ok(!(await history(first)).some(e=>e.id===excluded))
  await reopen(first)
  assert.deepEqual(await trip(shared),sharedBefore); assert.deepEqual(await booking(mate),mateBefore)
  assert.ok(!(await history(first)).some(e=>e.id===excluded),'reopening must not unmask old trip activity')
  await tick(); await actor(coordinator)
  const join=await rpc('patient_booking_preview_into_trip',[tenant,first,shared])
  assert.deepEqual(join.errors,[])
  await rpc('patient_booking_confirm_into_trip',[tenant,randomUUID(),first,shared,join])
  const rejoined=await noteTrip(shared,'TEST หลังร่วมเที่ยวรอบใหม่')
  let rows=await history(first)
  assert.ok(rows.some(e=>e.id===earliest)&&rows.some(e=>e.id===rejoined)); assert.ok(!rows.some(e=>e.id===excluded))
  assert.equal(new Set(rows.map(e=>e.id)).size,rows.length)
  await act(first,'cancel_passenger'); const excludedAgain=await noteTrip(shared,'TEST หลังออกครั้งที่สอง')
  await reopen(first)
  rows=await history(first); assert.ok(!rows.some(e=>e.id===excluded||e.id===excludedAgain))
  assert.ok(rows.some(e=>e.id===earliest)&&rows.some(e=>e.id===rejoined))
  const laterDriving=await noteTrip(shared,'TEST เที่ยวเริ่มวิ่งหลังนำรายนี้ออก','trip_next')
  await act(first); await reopen(first)
  assert.ok(!(await history(first)).some(e=>e.id===laterDriving),'later runs never become evidence that this rider travelled')
  console.log('PASS shared trip membership: others unchanged, multiple leave/rejoin windows, no later-event leakage')

  const duplicate=await makeCancelled('คิวซ้ำ'), duplicateOld=await booking(duplicate)
  const duplicateNew=await submit(duplicateOld.patient_name.replace(/^TEST /,''),'12:00',{phone:duplicateOld.phone,appointment_at:duplicateOld.appointment_at,route_id:duplicateOld.route_id})
  const dupeBefore=await counters(duplicate)
  await assert.rejects(()=>reopen(duplicate),/มีคำขอที่ยังใช้งาน/)
  assert.deepEqual(await counters(duplicate),dupeBefore)
  await act(duplicateNew)
  const results=await Promise.allSettled([reopen(duplicate),reopen(duplicateNew)])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'mutex admits only one identical active request')
  console.log('PASS duplicate protection and atomic refusal')

  const guarded=await makeCancelled('guard'), savedGuard=await booking(guarded)
  for (const who of [driver,citizen,'00000000-0000-4000-8000-000000000015',null]) {
    await assert.rejects(()=>reopen(guarded,'TEST สิทธิ์',randomUUID(),null,who),/เฉพาะ|permission denied/)
  }
  await assert.rejects(()=>reopen(guarded,'TEST ต่างหน่วยงาน',randomUUID(),null,coordinator,'00000000-0000-4000-8000-000000000002'),/เฉพาะ/)
  await assert.rejects(()=>reopen(guarded,'   '),/เหตุผล/)
  await assert.rejects(()=>reopen(guarded,'x'.repeat(501)),/เหตุผล/)
  await assert.rejects(()=>reopen(guarded,'TEST เก่า',randomUUID(),savedGuard.revision-1),/เปลี่ยนแล้ว/)
  await actor(coordinator); await assert.rejects(()=>rpc('ptb_booking_trip_windows',[tenant,guarded]),/permission denied/)
  assert.deepEqual(await booking(guarded),savedGuard)
  await reopen(guarded,'TEST แอดมินคืนได้',randomUUID(),null,admin)
  await assert.rejects(()=>reopen(guarded),/เฉพาะคำขอที่ยกเลิก/)
  console.log('PASS roles, tenant isolation, mandatory bounded reason, stale revision and internal helper ACL')

  for (const field of ['passenger_step','return_ready','contact_purged_at']) {
    const bid=await makeCancelled(field)
    await query(`UPDATE public.patient_bookings SET ${field}=$2 WHERE id=$1`,[bid,field==='passenger_step'?2:field==='return_ready'?true:new Date().toISOString()])
    const snap=await counters(bid); await assert.rejects(()=>reopen(bid),/รับ–ส่ง|ล้างตามอายุ/); assert.deepEqual(await counters(bid),snap)
  }
  const physical=await submit(`เริ่มรับแล้ว ${randomUUID()}`), physicalTrip=await confirm(physical)
  await noteTrip(physicalTrip,'TEST มีหลักฐานออกรถ','trip_next'); await act(physical,'cancel_passenger')
  await assert.rejects(()=>reopen(physical),/เริ่มรับ–ส่ง/)
  const uncertain=await submit(`ไม่มีบันทึกนำออก ${randomUUID()}`); await confirm(uncertain)
  await query("UPDATE public.patient_bookings SET status='cancelled' WHERE id=$1",[uncertain])
  await assert.rejects(()=>reopen(uncertain),/ไม่พบหลักฐาน/)
  const community=await row("SELECT id,revision FROM public.patient_bookings WHERE service_type='community' LIMIT 1")
  await query("UPDATE public.patient_bookings SET status='cancelled' WHERE id=$1",[community.id])
  await assert.rejects(()=>reopen(community.id),/เฉพาะคำขอรถผู้ป่วย/)
  const deleted=await makeCancelled('ลบแล้ว'); await query('DELETE FROM public.patient_bookings WHERE id=$1',[deleted])
  await actor(coordinator); await assert.rejects(()=>rpc('patient_booking_reopen',[tenant,randomUUID(),deleted,1,'TEST']),/ไม่พบคำขอ/)
  console.log('PASS served/purged/unknown journey, community and deleted records remain protected')

  const failing=await makeCancelled('rollback'), failingBefore=await counters(failing)
  await exec(`CREATE FUNCTION public.test_reopen_notice_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entity_id='${failing}'::uuid THEN RAISE EXCEPTION 'TEST notice failed'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_reopen_notice_failure BEFORE INSERT ON public.patient_booking_notices FOR EACH ROW EXECUTE FUNCTION public.test_reopen_notice_failure();`)
  await assert.rejects(()=>reopen(failing),/TEST notice failed/)
  assert.deepEqual(await counters(failing),failingBefore,'state, audit, notices and operation roll back together')
  await exec('DROP TRIGGER test_reopen_notice_failure ON public.patient_booking_notices; DROP FUNCTION public.test_reopen_notice_failure();')
  const retryId=randomUUID(), retryRev=(await booking(failing)).revision
  await actor(coordinator)
  const same=await Promise.all([rpc('patient_booking_reopen',[tenant,retryId,failing,retryRev,'TEST retry']),rpc('patient_booking_reopen',[tenant,retryId,failing,retryRev,'TEST retry'])])
  assert.deepEqual(same,[failing,failing]); assert.equal((await history(failing)).filter(e=>e.action==='reopened').length,1)
  await owner(async()=>{
    await db.exec('BEGIN')
    await db.exec("CREATE OR REPLACE FUNCTION public.patient_booking_history(p_muni uuid,p_booking uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;")
    await assert.rejects(()=>db.exec(awaitHistoryMigration),/Function drift/)
    await db.exec('ROLLBACK')
  })
  console.log('PASS full rollback, concurrent retry exactly once and history drift guard')
  success=true
} finally { if (!success || !process.env.REOPEN_UI_QA) await db.close() }
export {db,actor,rpc,tenant,admin,coordinator,driver,citizen,owner,row,trip,booking,submit,confirm,act,makeCancelled,reopen,history}
