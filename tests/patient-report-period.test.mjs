// Actual PostgreSQL permissions/ranges + actual print HTML; no production connection.
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { reportPeriod, validReportDate } from '../src/lib/patientReportPeriod.js'
import { monthReportSummary } from '../src/lib/patientBooking.js'
import { buildTripMonthReportHtml } from '../src/lib/patientTransportPrint.js'
import { assertSignBlockStandard, assertSignLinesAligned } from './lib/signBlockChecks.mjs'

const period = options => reportPeriod(options)
assert.equal(validReportDate('2026-02-29'), false)
assert.equal(validReportDate('2024-02-29'), true)
assert.equal(period({ month: '2024-02' }).to, '2024-02-29')
assert.equal(period({ month: '2026-12' }).to, '2026-12-31')
assert.deepEqual(['from', 'to'].map(k => period({ mode: 'year', year: 2570 })[k]), ['2026-10-01', '2027-09-30'])
assert.deepEqual(['from', 'to'].map(k => period({ mode: 'year', year: 2569, basis: 'calendar' })[k]), ['2026-01-01', '2026-12-31'])
for (const [basis, expected] of Object.entries({ fiscal: [['2025-10-01','2025-12-31'],['2026-01-01','2026-03-31'],['2026-04-01','2026-06-30'],['2026-07-01','2026-09-30']], calendar: [['2026-01-01','2026-03-31'],['2026-04-01','2026-06-30'],['2026-07-01','2026-09-30'],['2026-10-01','2026-12-31']] })) {
  for (let q = 1; q <= 4; q++) assert.deepEqual(['from','to'].map(k => period({ mode: 'quarter', year: 2569, basis, quarter: q })[k]), expected[q-1])
}
assert.equal(period({ mode:'custom', from:'2026-10-02', to:'2026-10-02' }).from, '2026-10-02')
for (const args of [{ month:'2026-13' }, { mode:'year',year:'2569x' }, { mode:'quarter',year:2569,quarter:0 }, { mode:'year',year:2569,basis:'unknown' }, { mode:'custom',from:'2026-10-02',to:'2026-10-01' }, { mode:'custom',from:'2026-01-01',to:'2037-01-01' }, { mode:'custom',from:'',to:'' }]) assert.throws(() => period(args))

const { PGlite } = await import(pathToFileURL(process.env.PATIENT_PGLITE_MODULE).href)
const db = new PGlite()
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const tenant=id(1), other=id(2), admin=id(10), coordinator=id(11), driver=id(12), citizen=id(13), outsider=id(14), partner=id(20)
const sql = async file => readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8')
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;
   CREATE TABLE public.municipalities(id uuid PRIMARY KEY);
   CREATE TABLE public.profiles(id uuid PRIMARY KEY, municipality_id uuid,role text,full_name text);
   CREATE TABLE public.referral_partners(id uuid PRIMARY KEY);
   INSERT INTO public.municipalities VALUES('${tenant}'),('${other}');
   INSERT INTO public.profiles VALUES('${admin}','${tenant}','admin','TEST Admin'),('${coordinator}','${tenant}','staff','TEST Coordinator'),('${driver}','${tenant}','staff','TEST Driver'),('${citizen}','${tenant}','citizen','TEST Citizen'),('${outsider}','${other}','admin','TEST Other');
   INSERT INTO public.referral_partners VALUES('${partner}');`)
  for (const file of ['20260918110000_patient_booking_tables.sql','20260919130000_patient_booking_trip_documents_columns.sql','20260919150000_patient_booking_flexible_odometer.sql']) await db.exec(await sql(file))
  // Load complete real definitions. No role stub: dual-duty and tenant checks use production source.
  const roleSql=(await sql('20260929130000_patient_booking_driver_cover.sql')).match(/CREATE OR REPLACE FUNCTION public\.ptb_role\([\s\S]*?END \$\$;/)?.[0]
  const monthSql=(await sql('20260919150100_patient_booking_flexible_odometer_rpc.sql')).match(/CREATE OR REPLACE FUNCTION public\.patient_booking_month_report\([\s\S]*?END \$\$;/)?.[0]
  assert(roleSql && monthSql)
  await db.exec(roleSql); await db.exec(monthSql)
  await db.exec(await sql('20261002090000_patient_booking_period_report.sql'))
  await db.query('INSERT INTO public.patient_booking_settings(municipality_id,partner_id,driver_id,coordinator_ids) VALUES($1,$2,$3,$4)',[tenant,partner,driver,[coordinator]])
  const dates=['2025-12-31','2026-01-01','2026-03-31','2026-04-01','2026-09-30','2026-10-01','2026-12-31','2027-01-01']
  for (let i=0;i<dates.length;i++) {
    await db.query(`INSERT INTO public.patient_booking_trips(id,municipality_id,driver_id,booking_ids,plan,state,confirmed_by,odometer_start,odometer_end) VALUES($1,$2,$3,'{}',$4,'completed',$5,100,110)`,[id(100+i),tenant,driver,{date:dates[i],pickup_at:dates[i]+'T00:00:00+07:00',route_label:'TEST Hospital'},admin])
  }
  for (const [n,muni,state] of [[200,tenant,'cancelled'],[201,other,'completed'],[202,tenant,'confirmed']]) await db.query(`INSERT INTO public.patient_booking_trips(id,municipality_id,driver_id,booking_ids,plan,state,confirmed_by) VALUES($1,$2,$3,'{}',$4,$5,$6)`,[id(n),muni,driver,{date:'2026-03-31',route_label:'TEST Hospital'},state,admin])
  for (const [n,status,companions] of [[300,'confirmed',1],[301,'completed',2],[302,'cancelled',4],[303,'submitted',5]]) await db.query(`INSERT INTO public.patient_bookings(id,municipality_id,created_by,requester_name,phone,patient_name,relation,pickup,in_area,route_id,route_label,appointment_at,mobility,companions,return_mode,status,consent_text,trip_id) VALUES($1,$2,$3,'TEST Requester','0800000000','PRIVATE_TEST_PATIENT','self','PRIVATE_TEST_PICKUP',true,'test','TEST Hospital','2026-03-31T08:00:00+07:00','walk',$4,'one_way',$5,'TEST Consent',$6)`,[id(n),tenant,citizen,companions,status,id(102)])
  const actor=async user=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec(`SET ROLE ${user?'authenticated':'anon'}`)}
  const report=async(from,to,muni=tenant)=>(await db.query('SELECT public.patient_booking_period_report($1,$2,$3) AS data',[muni,from,to])).rows[0].data
  await actor(coordinator)
  const quarter=await report('2026-01-01','2026-03-31')
  assert.deepEqual(quarter.trips.map(t=>t.date),['2026-01-01','2026-03-31','2026-03-31'])
  assert.equal(quarter.trips.find(t=>t.trip_id===id(102)).passengers,2)
  assert.equal(quarter.trips.find(t=>t.trip_id===id(102)).companions,3)
  assert.deepEqual(monthReportSummary(quarter.trips),{completed:2,pending:1,passengers:2,companions:3,distance:20,missingDistance:0})
  assert.equal((await report('2026-03-31','2026-03-31')).trips.length,2,'both inclusive boundary days')
  assert.equal((await report('2024-02-29','2024-02-29')).trips.length,0)
  const calendar=await report('2026-01-01','2026-12-31')
  assert.equal(calendar.trips.length,7)
  assert.equal((await report('2025-10-01','2026-09-30')).trips.length,6)
  assert(!JSON.stringify(calendar).includes('PRIVATE_TEST'))
  assert(!Object.keys(calendar.trips[0]).some(k=>['phone','pickup','pickup_lat','pickup_lng','patient_name'].includes(k)))
  const old=(await db.query("SELECT public.patient_booking_month_report($1,'2026-03-01') AS data",[tenant])).rows[0].data
  assert.deepEqual(old.trips,(await report('2026-03-01','2026-03-31')).trips,'legacy monthly RPC remains compatible')
  for(const [from,to] of [[null,'2026-01-01'],['2026-03-01','2026-01-01'],['-infinity','2026-01-01'],['2026-01-01','2037-01-01']]) await assert.rejects(()=>report(from,to))
  await actor(admin);assert.equal((await report('2026-01-01','2026-03-31')).trips.length,3)
  await assert.rejects(()=>report('2026-01-01','2026-03-31',other),/เฉพาะเจ้าหน้าที่/)
  for(const user of [driver,citizen,outsider]) {await actor(user);await assert.rejects(()=>report('2026-01-01','2026-03-31'),/เฉพาะเจ้าหน้าที่/)}
  await actor(null);await assert.rejects(()=>report('2026-01-01','2026-03-31'),/permission denied/)
  console.log('PASS real PostgreSQL: inclusive ranges, fiscal/calendar boundary, old monthly compatibility, cancelled/other tenant exclusion, passenger counts, aggregate projection, admin/coordinator only, invalid ranges')
} finally { await db.close() }

const artifacts='D:/tmp/patient-report-period-shots'
await mkdir(artifacts,{recursive:true})
const cases=[{month:'2026-10'},{mode:'quarter',basis:'fiscal',year:2570,quarter:1},{mode:'year',basis:'calendar',year:2569},{mode:'custom',from:'2026-10-02',to:'2026-10-02'}]
const browser=await chromium.launch({channel:'msedge',headless:true})
try {
  for(const args of cases){
    const range=period(args)
    const trips=Array.from({length:args.mode==='year'?65:6},(_,i)=>({trip_id:`test-${i}`,date:range.from,state:i%6===5?'confirmed':'completed',route_label:'โรงพยาบาลตัวอย่างเพื่อทดสอบรายงานการใช้รถ',passengers:2,companions:1,odometer_start:100+i*10,odometer_end:110+i*10,distance:10,driver_name:'ผู้ขับทดสอบ',letter_no:'TEST/100'}))
    const html=buildTripMonthReportHtml({tenant:{name:'องค์การบริหารส่วนตำบลตัวอย่าง'},partner:{name:'กองทุนตัวอย่าง'},period:range,report:{from:range.from,to:range.to,trips}})
    assert.throws(()=>buildTripMonthReportHtml({period:range,report:{from:'2020-01-01',to:range.to,trips}}),/ไม่ตรง/)
    const page=await browser.newPage({viewport:{width:1123,height:794}})
    await page.route('**/*',r=>r.abort())
    await page.setContent(html);await page.evaluate(()=>document.fonts.ready);await page.emulateMedia({media:'print'})
    assert((await page.innerText('body')).includes(range.label))
    assert((await page.innerText('body')).includes(range.dates))
    const summary=monthReportSummary(trips)
    assert.match(await page.innerText('tfoot'),new RegExp(`รวมเที่ยวที่จบแล้ว ${summary.completed} เที่ยว`))
    assert.equal(await page.locator('table').first().locator('tbody tr').count(),summary.completed)
    const layout=await page.evaluate(()=>{const style=getComputedStyle(document.body);return {overflow:document.documentElement.scrollWidth>innerWidth,family:style.fontFamily,size:parseFloat(style.fontSize),adjust:style.fontSizeAdjust}})
    assert(!layout.overflow,`${range.mode} print width overflow`);assert.match(layout.family,/THSarabunPSK/);assert(layout.size>18.5&&layout.size<19);assert.equal(layout.adjust,'0.45')
    await assertSignBlockStandard(page,{minRows:2,minBelow:4});await assertSignLinesAligned(page,'.report-sign .sign-row')
    await page.screenshot({path:`${artifacts}/print-${range.mode}.png`,fullPage:true})
    await page.pdf({path:`${artifacts}/print-${range.mode}.pdf`,preferCSSPageSize:true,printBackground:true})
    await page.close()
  }
  console.log('PASS period print: all 4 modes, titles/dates/totals, multi-page year, A4 landscape font standards, rendered signature text alignment; artifacts '+artifacts)
}finally{await browser.close()}
