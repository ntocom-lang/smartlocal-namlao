# คู่มือ Git Tag — บันทึก Save Point ก่อนงานใหญ่

> เวอร์ชัน 1.0 | SmartLocal v1.1 Project

---

## Save Point คืออะไร?

Git Tag คือ **หมุดถาวรที่ปักลงบน commit** — ไม่ว่าจะทำงานต่อไปอีกเท่าไหร่ หมุดนั้นก็ยังอยู่ที่เดิม สามารถกลับมาได้เสมอ

```
timeline ของโปรเจกต์

  อดีต ────────────────────────────────────────────→ อนาคต

    ●──────●──────●──────●──────●──────●──────●
    │      │      │      │      │      │      │
   commit commit commit commit commit commit  (ปัจจุบัน)
                         │
                    [before-line-oa]
                    ← หมุด Tag อยู่ตรงนี้
                      ไม่หายไปไหน
```

---

## ต่างจาก Branch ยังไง?

```
Branch = สาขาแยก (มีชีวิตของตัวเอง)
Tag    = หมุดปัก (snapshot ณ จุดหนึ่ง)

BRANCH:                         TAG:
                                
  main ──●──●──●──●             main ──●──●──●──●
              │                              │
         feature ──●──●                 [v1.0] ← แค่ชี้ไปที่ commit นั้น
                    │                          ไม่มีสาขาแยก
                  (ต้อง merge กลับ)
```

---

## Workflow มาตรฐาน

```
┌─────────────────────────────────────────────────────────┐
│                  ก่อนเริ่มงานใหญ่ทุกครั้ง               │
└─────────────────────────────────────────────────────────┘

  Step 1          Step 2              Step 3
  ────────        ──────────────      ──────────────────
  commit งาน      สร้าง Tag           Push ขึ้น GitHub
  ค้างให้หมด      (ปักหมุด)           (สำรองบน cloud)
  
  git add -A      git tag -a          git push origin
  git commit      "ชื่อ-tag"          master
                  -m "คำอธิบาย"       git push origin
                                      ชื่อ-tag
```

---

## คำสั่งทั้งหมด

### สร้าง Save Point

```bash
# สร้าง tag พร้อมคำอธิบาย (-a = annotated, -m = message)
git tag -a "before-line-oa" -m "Save point ก่อนเชื่อม LINE OA"

# push tag ขึ้น GitHub
git push origin before-line-oa
```

### ดู Tag ที่มีอยู่

```bash
# ดูทุก tag
git tag -l

# output ตัวอย่าง:
# before-line-oa
# before-payment-gateway
# v1.1-stable

# ดูรายละเอียด
git show before-line-oa
```

### เปรียบเทียบโค้ดปัจจุบัน vs Save Point

```bash
# ดูทุกอย่างที่เปลี่ยนไป
git diff before-line-oa

# ดูเฉพาะชื่อไฟล์ที่เปลี่ยน
git diff --name-only before-line-oa
```

---

## วิธี Rollback เมื่อพัง

### สถานการณ์ที่ 1 — พังบางส่วน (แนะนำ)

```
ต้องการ: ดูโค้ดเก่า หรือ เอาบางไฟล์กลับมา
ไม่ต้องการ: ทำลาย master

  master: ──●──●──[tag]──●──●──●──(HEAD)
                                    │
                               พังตรงนี้

  Solution: สร้าง branch ใหม่จาก tag
            แล้วเอาไฟล์ที่ต้องการกลับมา
```

```bash
# สร้าง branch ใหม่จาก tag
git checkout -b fix-from-save before-line-oa

# เอาไฟล์เฉพาะตัวกลับมาใน master
git checkout master
git checkout before-line-oa -- src/components/SomeFile.vue
```

### สถานการณ์ที่ 2 — พังหมดทุกอย่าง (nuclear option)

```
ต้องการ: ลบทิ้งทุกอย่างหลัง tag กลับมาจุดเดิมเลย
⚠️  commit หลัง tag จะหายถาวร

  ก่อน:  ──●──●──[tag]──●──●──●──(HEAD)
  หลัง:  ──●──●──[tag]
                   │
                 (HEAD ใหม่)
```

```bash
# ⚠️ ระวัง: ทำสิ่งนี้แล้วย้อนกลับไม่ได้
git checkout master
git reset --hard before-line-oa
git push origin master --force
```

---

## ตัวอย่าง Tag ที่ควรสร้างในโปรเจกต์นี้

```
before-line-oa           ← ปัจจุบัน (สร้างแล้ว ✓)
before-payment-gateway   ← ถ้าจะเพิ่มระบบชำระเงิน
before-push-notification ← ก่อนเพิ่ม push notification
v1.0-launch              ← ก่อน go-live
v1.1-stable              ← หลัง stable แล้ว
```

---

## ภาพรวม Tag บน GitHub

```
GitHub Repository
├── Branches
│   └── master ──────────────────────→ (HEAD)
│
└── Tags (Releases)
    ├── before-line-oa  ← commit d4af3ee
    └── (tag ใหม่ในอนาคต)
```

ดูบน GitHub ได้ที่:
`https://github.com/ntocom-lang/smartlocal-namlao/tags`

---

## สรุปคำสั่งฉบับย่อ

| ต้องการทำอะไร | คำสั่ง |
|---|---|
| สร้าง save point | `git tag -a "ชื่อ" -m "คำอธิบาย"` |
| push tag ขึ้น GitHub | `git push origin ชื่อ-tag` |
| ดู tag ทั้งหมด | `git tag -l` |
| ดูว่าเปลี่ยนอะไรบ้าง | `git diff --name-only ชื่อ-tag` |
| rollback แบบปลอดภัย | `git checkout -b branch-ใหม่ ชื่อ-tag` |
| rollback แบบ nuclear | `git reset --hard ชื่อ-tag` แล้ว force push |
| ดู tag บน GitHub | ไปที่ Releases หรือ Tags tab |

---

*สร้างเมื่อ: 2026-05-31 | ก่อนเริ่มงาน LINE OA Integration*
