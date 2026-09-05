// ตรวจตัวคำนวณรายงานกลิ่นเหม็นรบกวน (src/lib/odorAnalytics.js) — รันเร็ว ไม่ต้องต่อฐานข้อมูล
//
// ทำไมต้องมีเทสต์ตัวนี้: ตัวเลขจากไฟล์นี้ไปโผล่ 3 ที่ที่เรนเดอร์คนละแบบ (แผงผู้รับผิดชอบ,
// แท็ปแอดมิน, ใบพิมพ์เสนอผู้บังคับบัญชา) ถ้าคำนวณเพี้ยนจะกลายเป็นตัวเลขที่เอาไปเสนอผู้บริหาร
// และอ้างในที่ประชุมสภาโดยไม่มีใครตรวจทานได้ เพราะไม่มีตัวเปรียบเทียบ
//
//   node tests/odor-analytics.test.mjs

import assert from 'node:assert/strict'
import { buildOdorSummary } from '../src/lib/odorAnalytics.js'

const mk = ({ at, loc, iv, tr, wind, health }) => ({
  created_at: at,
  village: loc,
  extra_data: {
    odor_intensity: iv,
    odor_time_range: tr,
    wind_direction: wind,
    health_effect: health,
  },
})

// ── ไม่มีข้อมูล: ต้องไม่ระเบิด และต้องไม่แต่งข้อสังเกตขึ้นมาเอง ──────────────────
{
  const s = buildOdorSummary([])
  assert.equal(s.total, 0)
  assert.equal(s.observations.length, 0, 'ไม่มีข้อมูลต้องไม่มีข้อสังเกต')
  assert.deepEqual(s.months, [])
  assert.equal(s.intensity.avg, null)
  // ส่งค่าที่ไม่ใช่ array มาก็ต้องไม่พัง (คำร้องยังโหลดไม่เสร็จ = undefined)
  assert.equal(buildOdorSummary(undefined).total, 0)
  assert.equal(buildOdorSummary(null).total, 0)
}

// ── กลุ่มตัวอย่างเล็ก: ห้ามมีเปอร์เซ็นต์โผล่ที่ไหนเลย ────────────────────────────
// กฎนี้คือหัวใจของความน่าเชื่อถือ 2 ใน 3 เรื่อง = 67% อ่านแล้วเข้าใจว่าเป็นแนวโน้มของพื้นที่
{
  const s = buildOdorSummary([
    mk({ at: '2026-07-10T05:00:00Z', loc: 'หมู่ 1', iv: 5, tr: 'dawn', wind: 'เหนือ', health: 'คลื่นไส้' }),
    mk({ at: '2026-08-11T05:00:00Z', loc: 'หมู่ 1', iv: 2, tr: 'dawn', wind: 'ใต้', health: 'ไม่มีอาการทางกาย' }),
    mk({ at: '2026-09-01T13:00:00Z', loc: 'หมู่ 2', iv: 4, tr: 'evening', wind: 'เหนือ', health: null }),
  ])
  assert.equal(s.total, 3)
  assert.equal(s.smallSample, true)
  assert.ok(s.timeRanges.every((r) => r.pct === null), 'ช่วงเวลาต้องไม่มี pct')
  assert.ok(s.intensity.dist.every((d) => d.pct === null), 'ความรุนแรงต้องไม่มี pct')
  assert.ok(s.locations.every((l) => l.pct === null), 'พื้นที่ต้องไม่มี pct')
  assert.equal(s.health.pct, null)
  assert.equal(s.intensity.severePct, null)

  assert.equal(s.intensity.avg, 3.7, '(5+2+4)/3 ปัดทศนิยม 1 ตำแหน่ง')
  assert.equal(s.intensity.severeCount, 2, 'ระดับ 4 ขึ้นไปมี 2 เรื่อง')
  assert.equal(s.health.count, 1, '"ไม่มีอาการทางกาย" กับ null ต้องไม่ถูกนับว่ามีอาการ')
  assert.equal(s.health.byOption[0].label, 'คลื่นไส้')

  // พื้นที่: เรียงจากมากไปน้อย พร้อมความรุนแรงเฉลี่ยรายพื้นที่
  assert.equal(s.locations[0].name, 'หมู่ 1')
  assert.equal(s.locations[0].count, 2)
  assert.equal(s.locations[0].avgIntensity, 3.5)
  assert.match(s.locations[0].topTimeRangeLabel, /เช้ามืด/)

  // ทิศลมนับเฉพาะกลุ่มรุนแรง (iv>=4) → 'เหนือ' 2 เรื่อง ส่วน 'ใต้' ของเรื่อง iv=2 ต้องไม่ติดมา
  assert.deepEqual(s.wind, [{ label: 'เหนือ', count: 2 }])

  // เดือนต้องต่อเนื่อง ไม่ข้ามเดือนที่ไม่มีเรื่อง
  assert.equal(s.months.length, 3)
  assert.deepEqual(s.months.map((m) => m.count), [1, 1, 1])

  // ข้อสังเกตต้องเตือนเรื่องกลุ่มตัวอย่างเล็ก และเตือนข้อจำกัดของข้อมูลเสมอ
  assert.ok(s.observations.some((o) => o.includes('ต่ำกว่า 20')), 'ต้องเตือนว่าข้อมูลน้อย')
  assert.ok(s.observations.some((o) => o.includes('ไม่ใช่ผลตรวจวัดกลิ่น')), 'ต้องเตือนข้อจำกัดของข้อมูล')
  // พื้นที่ที่มีแค่ 2 เรื่องยังไม่ควรถูกยกเป็น "จุดร้อน"
  assert.ok(!s.observations.some((o) => o.includes('พื้นที่ที่ถูกแจ้งมากที่สุด')), 'ต่ำกว่า 3 เรื่องไม่ยกเป็นจุดร้อน')
}

// ── ข้อมูลมากพอ: เปอร์เซ็นต์ต้องโผล่ และผลรวมต้องไม่ตกหล่นแถวไหน ─────────────────
{
  const rows = Array.from({ length: 24 }, (_, i) => mk({
    at: new Date(Date.UTC(2026, 6, 1 + i, 3)).toISOString(),
    loc: i % 4 === 0 ? 'หมู่ 3' : 'หมู่ 1',
    iv: (i % 5) + 1,
    tr: ['dawn', 'morning', 'afternoon', 'evening'][i % 4],
    wind: 'ตะวันตก',
    health: i % 6 === 0 ? 'เวียนศีรษะ' : 'ไม่มีอาการทางกาย',
  }))
  const s = buildOdorSummary(rows)
  assert.equal(s.smallSample, false)
  assert.ok(s.timeRanges.every((r) => typeof r.pct === 'number'), 'ข้อมูลมากพอต้องมี pct')
  assert.equal(s.timeRanges.reduce((a, r) => a + r.count, 0), 24, 'ทุกแถวต้องถูกจัดลงช่วงเวลา')
  assert.equal(s.intensity.dist.reduce((a, d) => a + d.count, 0), 24, 'ทุกแถวต้องถูกจัดลงระดับความรุนแรง')
  assert.equal(s.locations.reduce((a, l) => a + l.count, 0), 24, 'ทุกแถวต้องถูกจัดลงพื้นที่')
  assert.equal(s.health.count, 4)
  assert.ok(!s.observations.some((o) => o.includes('ต่ำกว่า 20')), 'ข้อมูลมากพอต้องไม่เตือนว่าน้อย')
  assert.ok(s.observations.some((o) => o.includes('พื้นที่ที่ถูกแจ้งมากที่สุด')))
  // ทิศลมต้องติดหมายเหตุกำกับเสมอ ห้ามปล่อยให้อ่านว่าชี้แหล่งกำเนิดได้
  const windLine = s.observations.find((o) => o.includes('ทิศทางลม'))
  assert.ok(windLine && windLine.includes('ยังชี้แหล่งกำเนิดไม่ได้'), 'ข้อสังเกตเรื่องลมต้องมีข้อจำกัดกำกับ')
}

// ── ข้อมูลไม่ครบ/เพี้ยน: ต้องข้ามไป ไม่ใช่พังหรือคิดเลขมั่ว ────────────────────────
{
  const s = buildOdorSummary([
    { created_at: null, extra_data: null },
    { created_at: 'ไม่ใช่วันที่', extra_data: {} },
    { created_at: '2026-09-01T00:00:00Z', extra_data: { odor_intensity: 'สาม' }, village: '' },
  ])
  assert.equal(s.total, 3)
  assert.equal(s.intensity.avg, null, 'ความรุนแรงที่ไม่ใช่ตัวเลขต้องไม่ถูกนับ')
  assert.equal(s.intensity.answered, 0)
  assert.equal(s.locations[0].name, 'ไม่ระบุสถานที่')
  assert.equal(s.locations[0].avgIntensity, null)
}

// ── แนวโน้มรายเดือน: เดือนที่ไม่มีเรื่องต้องเป็น 0 ไม่ใช่หายไปจากกราฟ ───────────────
{
  const s = buildOdorSummary([
    mk({ at: '2026-01-05T05:00:00Z', loc: 'ก', iv: 3, tr: 'dawn', wind: 'เหนือ', health: null }),
    mk({ at: '2026-04-05T05:00:00Z', loc: 'ก', iv: 3, tr: 'dawn', wind: 'เหนือ', health: null }),
  ])
  assert.equal(s.months.length, 4, 'ม.ค. ถึง เม.ย. ต้องมีครบ 4 เดือน')
  assert.deepEqual(s.months.map((m) => m.count), [1, 0, 0, 1], 'ก.พ./มี.ค. ต้องเป็น 0 ไม่ใช่ถูกข้าม')
}

console.log('✅ odor-analytics: ผ่านทุกเคส')
