import assert from 'node:assert/strict'
import { HYDRO_TENANTS, hydroTimestamp, normalizeHydro, hydroSummary, hydroSegments } from '../src/lib/hydroHourly.js'
import { hydroHourlyResponse } from '../worker/hydroHourly.js'
import { waterShareSlides } from '../src/lib/waterShareImages.js'
const now = Date.parse('2026-09-23T13:30:00Z')
const row = { date:'วันที่ 23 กันยายน 2569',time:'20.00 น.',level:'0',dischg:'0',station_name:'บ้านห้วยสัก',water_name:'แม่น้ำยม',address1:'เตาปูน',address2:'สอง',address3:'แพร่' }
assert.equal(hydroTimestamp(row.date,row.time),Date.parse('2026-09-23T13:00:00Z'))
assert.equal(hydroTimestamp(row.date,'24.00 น.'),Date.parse('2026-09-23T17:00:00Z'))
assert.equal(hydroTimestamp('วันที่ 31 กุมภาพันธ์ 2569',row.time),null)
assert.equal(hydroTimestamp(row.date,'25.00 น.'),null)
const rows = [{...row,time:'19.00 น.',level:'.1'},row,{...row,time:'22.00 น.'},{...row,time:'18.00 น.',level:''}]
const points = normalizeHydro(rows,'Y.20',now)
assert.equal(points.length,3);assert.equal(points.at(-1).level,0);assert.equal(points[0].level,null)
assert.throws(()=>normalizeHydro([{...row,address1:'ตำหนักธรรม'}],'Y.20',now))
const report={station:'Y.20',points:[{at:now-3.5*3600000,level:1},{at:now-1.5*3600000,level:.5},{at:now-.5*3600000,level:0}],fetchedAt:new Date(now).toISOString()}
assert.equal(hydroSummary(report,now).one,-50);assert.equal(hydroSummary(report,now).three,-100)
assert.equal(hydroSummary({...report,refreshFailed:true},now).one,null)
assert.equal(hydroSummary(report,now+4*3600000).stale,true)
assert.equal(hydroSegments(report.points).length,2)
assert.equal(hydroSegments([{at:0,level:0},{at:3600000,level:null},{at:7200000,level:1}]).length,2)
const map=new Map(),cache={match:async k=>map.get(k)?.clone(),put:async(k,v)=>map.set(k,v.clone())}
let calls=0
const fetcher=async u=>{calls++;const url=new URL(u);assert.equal(url.searchParams.get('station01'),'Y.20');assert.equal(url.searchParams.get('callback'),'hydroReport');return new Response('hydroReport('+JSON.stringify([row])+');')}
const req=new Request('https://thungkaew.rk-networks.com/api/hydro-hourly?station=Y.20')
assert.equal((await hydroHourlyResponse(req,{fetcher,cache,now})).status,200)
await hydroHourlyResponse(req,{fetcher,cache,now:now+1000});assert.equal(calls,1)
const fail=async()=>{throw Error('Offline')}
const fallback=await (await hydroHourlyResponse(req,{fetcher:fail,cache,now:now+2*3600000})).json();assert.equal(fallback.refreshFailed,true);assert.equal(fallback.points[0].level,0)
assert.equal((await hydroHourlyResponse(req,{fetcher:fail,cache,now:now+25*3600000})).status,503)
assert.equal((await hydroHourlyResponse(new Request(req.url,{method:'POST'}),{fetcher,now})).status,405)
assert.equal((await hydroHourlyResponse(new Request('https://test/api/hydro-hourly?station=https://evil.test'),{fetcher,now})).status,400)
assert.equal((await hydroHourlyResponse(req,{fetcher:async()=>new Response('hydroReport([]);evil()'),now})).status,503)
assert.equal((await hydroHourlyResponse(req,{fetcher:async()=>new Response('hydroReport([])'),now})).status,503)
const data={stations:[],hydroReports:[{...report,profile:HYDRO_TENANTS.thungkaew}]}
assert.equal(waterShareSlides(data,{slug:'thungkaew'}).at(-1).kind,'hydro')
assert.equal(waterShareSlides(data,{slug:'tamnaktham'}).length,1)
assert.equal(HYDRO_TENANTS.tamnaktham.station,'Y.38')
console.log('PASS Hydro hourly: timestamp, zero/missing, identity, gaps, stale trends, cache/fallback, method/allowlist, JSONP safety, tenant share scope')
