process.env.PATIENT_UI_QA='1';
const {db,actor,rpc,tenant,driver,coordinator}=await import('./patient-booking-db.test.mjs');
await actor(coordinator);let ws=await rpc('patient_booking_workspace',[tenant]);const trip=ws.trips.find(t=>t.state!=='cancelled');
await db.exec('RESET ROLE');await db.query("update public.profiles set role='citizen' where id=$1",[driver]);await actor(driver);
try{await rpc('patient_booking_record_odometer',[tenant,trip.id,13000,13050]);console.log('REPRO: downgraded citizen can overwrite assigned trip odometer')}catch(e){console.log('DENIED',e.message)}
await actor(coordinator);const report=await rpc('patient_booking_month_report',[tenant,trip.plan.date]);console.log('REPORT STATES',report.trips.map(t=>({state:t.state,passengers:t.passengers,distance:t.distance})));
await rpc('patient_booking_record_odometer',[tenant,trip.id,14000,14040]);await rpc('patient_booking_record_odometer',[tenant,trip.id,13000,13050]);ws=await rpc('patient_booking_workspace',[tenant]);console.log('REPRO: stale retry overwrites newer reading',ws.trips.find(t=>t.id===trip.id).odometer_start);
await db.close();
