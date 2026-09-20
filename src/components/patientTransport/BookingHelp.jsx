import { useRef, useState } from 'react'
import { buttonClass, primaryClass, inputClass } from '../../lib/patientBooking'

const citizen = [
  ['calendar', 'ดูวันว่างและเที่ยวร่วม', 'เปิด “ดูตารางรถ” เพื่อดูเส้นทาง วันเวลา จำนวนผู้เดินทางรวมผู้ติดตาม และที่นั่งเหลือ สลับตารางกับปฏิทินได้ ช่วงรถว่างเป็นเวลาตามแผน เจ้าหน้าที่ต้องตรวจคิวก่อนยืนยัน'],
  ['home', 'ส่งคำขอจองรถ', 'ที่ “หน้าบริการ” กด “ขอจองรถรับส่ง” หรือเข้าสู่ระบบก่อน ระบุวันนัด โรงพยาบาล จุดรับ และปักหมุดบนแผนที่โดยกดยืนยันตำแหน่ง เพิ่มเบอร์ติดต่อ ผู้ติดตาม และการใช้รถเข็นหรือเปล เลือกรอรับกลับ กลับมารับภายหลัง หรือขาไปอย่างเดียว ตรวจข้อมูลและข้อความการใช้ข้อมูลก่อนส่ง'],
  ['calendar', 'ขอร่วมเที่ยวที่มีอยู่', 'เลือก “ขอร่วมเที่ยวนี้” จากเที่ยวที่เปิดรับ แล้วกรอกข้อมูลตามจริง คำขอนี้ยังไม่กันที่นั่ง ต้องรอเจ้าหน้าที่ยืนยันก่อนเดินทาง'],
  ['mine', 'ติดตามผลและเวลารับ', 'เปิด “การจองของฉัน” หลังเข้าสู่ระบบ ตรวจว่าขึ้นยืนยันรถแล้ว ดูเวลาเริ่มรับและประกาศล่าช้าล่าสุด เวลาที่แสดงเป็นประมาณการ เจ้าหน้าที่จะประสานจุดรับ'],
  ['mine', 'พร้อมกลับหรือขอยกเลิก', 'เมื่อถึงโรงพยาบาลและพร้อมกลับ กด “พร้อมให้มารับกลับ” ไม่ได้หมายความว่ารถจะถึงทันที หากไปไม่ได้ให้ขอยกเลิก รายการที่ยืนยันแล้วต้องให้เจ้าหน้าที่ประสานก่อนเปลี่ยนเที่ยว'],
]
const coordinator = [
  ['schedule', 'เริ่มจากตารางออกรถ', 'เลือกวันที่เพื่อดูช่วงใช้รถขาไปและขากลับ กดดูผู้เดินทางและจุดรับ คำขอรอยืนยันแยกจากเที่ยวที่ยืนยันแล้ว และยังไม่กันรถหรือที่นั่ง'],
  ['queue', 'รับจองและตรวจคำขอ', 'เปิด “คิวรอจัดแผน” รับจองแทนทางโทรศัพท์หรือหน้าเคาน์เตอร์ได้จากปุ่มบนแถบเครื่องมือ ค้นหาชื่อผู้เดินทางได้ กดที่แถวเพื่อเปิดคำขอ ตรวจวันนัด จุดรับ ผู้ติดตาม รถเข็นหรือเปล และประสานข้อมูลที่ไม่ครบก่อนจัดเที่ยว'],
  ['queue', 'ตรวจแผนก่อนยืนยัน', 'กด “ตรวจแผนและเวลาว่าง” ระบบช่วยตรวจเวลาและความจุ ผลตรวจขึ้นเป็นแผ่นลอยทับให้เจ้าหน้าที่ตรวจแล้วกดยืนยันเที่ยว หากข้อมูลเปลี่ยนให้ตรวจแผนใหม่ ผู้จองและคนขับจะเห็นผลในระบบ'],
  ['schedule', 'แจ้งล่าช้าหรือเวลารับใหม่', 'เปิดรายละเอียดเที่ยว กด “แจ้งล่าช้า / ปรับเวลาประมาณการ” แล้วเลือกประกาศและเวลา ข้อมูลนี้ไม่ย้ายช่วงจองรถ หากชนเที่ยวอื่นต้องประสานจัดคิว เที่ยวส่วนตัวไม่แสดงรายละเอียดในตารางสาธารณะ'],
  ['trips', 'ตามงานค้างของแต่ละเที่ยว', 'เปิด “เที่ยวเดินรถ” คอลัมน์ “งานค้าง” บอกเองว่าเที่ยวไหนเหลืออะไร เช่น ยังไม่บันทึกเลขหนังสือ รอเลขไมล์กลับ มีผู้ขอยกเลิก หรือมีเหตุขัดข้อง กดที่แถวเพื่อเปิดจัดการ ประสานคนขับและแก้ข้อมูลตามข้อเท็จจริงพร้อมเหตุผล หากระบบแจ้งว่าข้อมูลเปลี่ยนแล้ว ให้ตรวจค่าล่าสุดก่อนบันทึกใหม่'],
  ['trips', 'เอกสารส่งกองทุนและเลขไมล์', 'ในแผ่นจัดการเที่ยว บันทึกเลขหนังสือและตรวจเลขไมล์ก่อนพิมพ์ หนังสือนำส่งเป็นร่างให้สารบรรณตรวจ เลขไมล์ผิดปกติจะไม่ใช้คำนวณระยะทางจนตรวจแก้'],
  ['report', 'สรุปรายเดือน', 'แท็บ “รายงาน” พิมพ์สรุปการใช้รถรายเดือนไว้แนบเบิกกับกองทุน แบบสรุปนี้เป็นแบบกลาง หากกองทุนมีแบบของตนให้ใช้แบบนั้น หน้านี้ยังเก็บประวัติการทำรายการย้อนหลังไว้ตรวจสอบ'],
]
const driver = [
  ['driver', 'ตรวจงานก่อนออกเดินทาง', 'เปิด “งานคนขับ” ตรวจวันเวลา โรงพยาบาล รายชื่อ จุดรับ เบอร์ติดต่อและผู้ติดตาม ใช้จุดรับหรือหมุดที่ผู้จองระบุเพื่อประสานเส้นทาง'],
  ['driver', 'เริ่มเที่ยวและรับผู้เดินทาง', 'เมื่อพร้อมจึงกด “ออกไปรับ” บันทึกรับและส่งถึงโรงพยาบาลให้ครบทีละคนตามเหตุการณ์จริง ก่อนเปลี่ยนไปขั้นถัดไป'],
  ['driver', 'รอรับกลับหรือกลับมารับภายหลัง', 'ดูแผนรับกลับของเที่ยวและสถานะพร้อมกลับ ประสานผู้เดินทางก่อนออกรับ บันทึกรับกลับและส่งถึงจุดหมายของแต่ละคนให้ครบ'],
  ['driver', 'จบเที่ยวและบันทึกเลขไมล์', 'เมื่อส่งครบและกลับถึงพื้นที่ให้จบเที่ยว บันทึกเลขไมล์ออกและกลับ แก้ค่าที่กรอกผิดได้พร้อมเหตุผล หากมาตรวัดเสียหรือเปลี่ยนมาตรวัด ให้เลือกมาตรวัดมีปัญหาและแจ้งเหตุผล ไม่ต้องเดาระยะทาง'],
  ['driver', 'เมื่อมีเหตุขัดข้อง', 'แจ้งเหตุในเที่ยวและประสานเจ้าหน้าที่ บันทึกเฉพาะข้อมูลที่จำเป็น หากบันทึกไม่สำเร็จให้ตรวจสถานะล่าสุดก่อนลองซ้ำ ห้ามกดจบเที่ยวแทนการแจ้งปัญหา'],
]
const setup = [
  ['settings', 'ตั้งค่าก่อนเปิดบริการ', 'ผู้ดูแลเลือกกองทุน คนขับ ผู้ยืนยันคิว ความจุรถ เส้นทาง และเบอร์ติดต่อ แล้วเปิดรับจองได้ เวลาให้บริการมีค่าเริ่มต้นให้ ระบบเตรียมข้อความแจ้งใช้ข้อมูลให้ประชาชนอ่าน เจ้าหน้าที่ตรวจวันเดินทางและความพร้อมก่อนยืนยันแต่ละเที่ยว'],
  ...coordinator,
]

export default function BookingHelp({ enabled, coordinator: canCoordinate, driver: canDrive, admin, signedIn, busy, onHighlight }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('manual')
  const [chosen, setChosen] = useState(null)
  const [step, setStep] = useState(0)
  const trigger = useRef(null)
  const roles = [{ id: 'citizen', label: 'ประชาชน / ผู้จองแทน', steps: citizen }, ...(canCoordinate ? [{ id: 'coordinator', label: 'เจ้าหน้าที่จัดคิว', steps: coordinator }] : []), ...(canDrive ? [{ id: 'driver', label: 'คนขับ', steps: driver }] : []), ...(admin ? [{ id: 'admin', label: 'ผู้ดูแลระบบ', steps: setup }] : [])]
  const role = roles.find(r => r.id === chosen) || roles.find(r => r.id === (admin ? 'admin' : canCoordinate ? 'coordinator' : canDrive ? 'driver' : 'citizen'))
  const steps = !enabled && role.id === 'citizen' ? [['home', 'บริการยังไม่เปิดจองคิวออนไลน์', 'ติดต่อเจ้าหน้าที่เพื่อสอบถามบริการ ผู้ดูแลต้องตั้งค่ารถ คนขับ และเส้นทางก่อนเปิดรับจอง เมื่อเปิดบริการแล้วจะจองและติดตามคิวได้ในหน้านี้ คำขอที่เคยยื่นไว้ยังติดตามได้จากลิงก์ด้านล่าง']] : role.steps
  const current = steps[Math.min(step, steps.length - 1)]
  const highlight = item => onHighlight(item[0] === 'mine' && !signedIn ? null : item[0])
  const close = () => { setOpen(false); onHighlight(null); trigger.current?.focus() }
  function start() { setMode('guide'); setStep(0); highlight(steps[0]) }
  function move(next) { setStep(next); highlight(steps[next]) }
  return <div className="mb-5">
    <button ref={trigger} type="button" className={buttonClass} aria-expanded={open} aria-controls="patient-booking-help" onClick={() => { if (open) close(); else { setOpen(true); setMode('manual'); setStep(0) } }}>คู่มือและแนะนำการใช้งาน</button>
    {open && <section id="patient-booking-help" aria-label="คู่มือรถรับส่งผู้ป่วย" className="mt-3 space-y-4 rounded-2xl border-2 border-sky-200 bg-sky-50 p-4" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">ใช้งานรถรับส่งผู้ป่วยอย่างไร</h2><button type="button" className={buttonClass} onClick={close}>ปิดคำแนะนำ</button></div>
      <label className="block">คู่มือสำหรับ<select aria-label="คู่มือสำหรับ" className={inputClass} value={role.id} onChange={e => { setChosen(e.target.value); setStep(0); setMode('manual'); onHighlight(null) }}>{roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
      <div className="flex flex-wrap gap-2"><button type="button" className={mode === 'manual' ? primaryClass : buttonClass} aria-pressed={mode === 'manual'} onClick={() => { setMode('manual'); onHighlight(null) }}>อ่านคู่มือ</button><button type="button" className={mode === 'guide' ? primaryClass : buttonClass} aria-pressed={mode === 'guide'} onClick={start}>แนะนำทีละขั้น</button></div>
      {mode === 'manual' ? <div className="space-y-2">{steps.map(([view, title, body], index) => <details key={`${view}-${index}`} className="rounded-xl border border-slate-200 bg-white px-3"><summary className="flex min-h-11 cursor-pointer items-center py-2 font-semibold">{index + 1}. {title}</summary><p className="pb-4 leading-relaxed">{body}</p></details>)}</div> : <>
        <div aria-live="polite" aria-atomic="true" className="space-y-2 rounded-xl bg-white p-4"><p className="text-sm text-sky-800">ขั้นที่ {Math.min(step + 1, steps.length)} จาก {steps.length} · {role.label}</p><h3 className="font-bold">{current[1]}</h3><p className="leading-relaxed">{current[2]}</p></div>
        <p className="text-sm">เมนูที่เกี่ยวข้องมีกรอบเน้นด้านล่าง อ่านตามขั้นตอนได้โดยไม่ต้องเปลี่ยนหน้า หากกำลังกรอกข้อมูลให้บันทึกหรือทำรายการให้เสร็จก่อนเปลี่ยนเมนู</p>
        {!signedIn && role.id === 'citizen' && <p className="text-sm">ยังไม่ได้เข้าสู่ระบบ อ่านคู่มือและดูตารางสาธารณะได้ การส่งคำขอและติดตามการจองต้องเข้าสู่ระบบก่อน</p>}
        <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={step === 0} onClick={() => move(step - 1)}>ขั้นก่อนหน้า</button>{step < steps.length - 1 ? <button type="button" className={primaryClass} onClick={() => move(step + 1)}>ขั้นถัดไป</button> : <button type="button" className={primaryClass} onClick={close}>จบคำแนะนำ</button>}<button type="button" className={buttonClass} onClick={start}>เริ่มใหม่</button></div>
      </>}
      {busy && <p className="text-sm">ระบบกำลังบันทึก กรุณารอผลก่อนทำรายการถัดไป</p>}
      <p className="text-sm">คำแนะนำไม่ส่งคำขอหรือยืนยันเที่ยวให้โดยอัตโนมัติ เปิดอ่านซ้ำได้ทุกเมื่อ</p>
      <p className="rounded-xl bg-amber-50 p-3">กรณีเจ็บป่วยฉุกเฉิน <a href="tel:1669" className="inline-flex min-h-11 items-center font-bold underline">โทร 1669</a> อย่ารอคิวจองรถ</p>
    </section>}
  </div>
}
