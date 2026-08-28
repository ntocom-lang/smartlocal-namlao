# หมายเหตุการ deploy บน Vercel

## ทำไม `vercel.json` ปิด deployment ของทุก branch

repo นี้ผูกกับ Vercel **4 โปรเจกต์** ที่ build จาก branch เดียวกัน

| โปรเจกต์ | ใช้ทำอะไร |
| --- | --- |
| `smartlocal-app` | เข้าผ่าน path (`/{slug}`) |
| `smartlocal-namlao` | เทศบาลตำบลน้ำเลา — ข้อมูลจริง |
| `smartlocal-tamnaktham` | ข้อมูลทดสอบ |
| `smartlocal-thungkaew` | ข้อมูลทดสอบ |

แปลว่า **push 1 ครั้ง = 4 deployment** และเปิด PR ก็ได้ preview อีก 4 วันที่ 28 ส.ค. 2569
พัฒนาระบบเข้าสู่ระบบด้วยรหัสจากมือถือ (PR #29–#33) จึงชนเพดาน deployment ต่อวันของแผน
Hobby จนคอมมิตที่ merge แล้ว (`d6c1c57`) ขึ้น production ไม่ได้ทั้ง 4 โปรเจกต์ —
เช็คทั้งหมดขึ้น `failure` พร้อมลิงก์ `upgradeToPro=build-rate-limit`
ซึ่งอัปเกรดไม่ได้เพราะโครงการนี้ถือนโยบายไม่มีค่าใช้จ่าย

ทางแก้ที่ใช้: ตัด preview ทิ้งทั้งหมด เหลือ build เฉพาะตอนเข้า `master`

```json
"git": {
  "deploymentEnabled": {
    "*": false,
    "**": false,
    "master": true
  }
}
```

ที่ต้องมีทั้ง `*` และ `**` เพราะ Vercel ใช้ minimatch ซึ่ง `*` ไม่ข้าม `/`
แต่ branch ที่นี่ตั้งชื่อแบบ `feat/...` `fix/...` จึงต้องพึ่ง `**`
ส่วน `master` ระบุ `true` ไว้ชัดเจน — เอกสาร Vercel กำหนดว่า branch ที่เข้าเงื่อนไข
หลายข้อ ถ้ามีข้อไหนเป็น `true` ก็ deploy ฉะนั้น **production ถูกบล็อกไม่ได้**
แม้ pattern ข้างบนจะเปลี่ยนความหมายไป

ผลข้างเคียงที่ต้องรับ: **ไม่มี preview URL ให้ทดสอบก่อน merge อีกแล้ว**
ถ้างานไหนต้องการ preview จริงๆ ให้ลบสองบรรทัด `"*"` กับ `"**"` ออกชั่วคราว
แล้วใส่กลับหลัง merge

## ยังต้องไปทำที่ Vercel dashboard (แก้จาก repo ไม่ได้)

`vercel.json` ไฟล์เดียวถูกอ่านโดยทั้ง 4 โปรเจกต์ จึงตั้งค่าแยกรายโปรเจกต์ไม่ได้
สองข้อนี้ต้องเข้า dashboard เอง

1. **ปลุก `d6c1c57` ให้ขึ้น production** — เมื่อโควตารีเซ็ตแล้ว เข้าแต่ละโปรเจกต์
   → Deployments → เลือกคอมมิตล่าสุด → Redeploy (ทำทีละโปรเจกต์ทั้ง 4)
   หรือ push คอมมิตใหม่เข้า `master` ก็ได้ผลเดียวกัน
2. **ลดจาก 4 build เหลือ 1 build ต่อการ push** — ถ้ายังชนโควตาอีก ให้เข้า
   Settings → Git ของโปรเจกต์ที่เป็นข้อมูลทดสอบ (`tamnaktham`, `thungkaew`)
   แล้ว disconnect หรือตั้ง Ignored Build Step ไว้ ค่อยต่อกลับตอนจะสาธิต
   — เหลือเฉพาะ `namlao` (ข้อมูลจริง) กับ `app` ที่ deploy อัตโนมัติ

## ทางเลือกระยะยาว

รวมเหลือ Vercel โปรเจกต์เดียวแล้วผูกหลาย custom domain — `detectTenantSlug()`
ใน [`src/contexts/TenantContext.jsx`](../src/contexts/TenantContext.jsx) แยก tenant
จาก hostname อยู่แล้ว (และ `computeBasename()` ใน
[`src/lib/basename.js`](../src/lib/basename.js) เช็คแพทเทิร์นเดียวกัน ต้องแก้คู่กันเสมอ)
จึงรองรับได้ ตัดโควตาลง 4 เท่า แต่ต้องเลิกพึ่งชื่อ `smartlocal-{slug}.vercel.app`
(subdomain ผูกกับชื่อโปรเจกต์) ทำได้ต่อเมื่อ อปท. มีโดเมนจริงของตัวเองแล้ว
