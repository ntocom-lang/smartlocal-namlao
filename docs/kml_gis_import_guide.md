# 🗺️ คู่มือและสถาปัตยกรรมการนำเข้าไฟล์ KML / GIS / Google Earth (GIS & KML Batch Import Spec)

---

## 1. 🏛️ วัตถุประสงค์และสถาปัตยกรรมระบบ (Architecture Overview)
- **โมดูลรองรับ**: ศูนย์รวมข้อมูลดิจิทัล (Digital Data Center - `/data-center`)
- **ไฟล์ส่วนประกอบหลัก**:
  - `src/components/datacenter/DataCenterImportModal.jsx` (Modal อ่านและแปลงไฟล์พิกัด GIS)
  - `src/components/datacenter/DataCenterOverview.jsx` (ปุ่มเรียกใช้นำเข้าไฟล์)
  - `src/pages/DataCenterDashboard.jsx` (Dashboard ผู้ดูแลระบบ)
- **รูปแบบไฟล์ที่รองรับ**:
  - **Google Earth (`.kml` และ `.kmz`)**: ถอดรหัส XML & ZIP อัตโนมัติด้วย `JSZip`
  - **GeoJSON (`.geojson` และ `.json`)**: รองรับ FeatureCollection แบบ Point, LineString และ Polygon
  - **CSV (`.csv`)**: อ่านไฟล์ตารางพิกัด ละติจูด/ลองจิจูด

---

## 2. ⚙️ ขอบเขตการถอดรหัสพิกัด (Parsing Pipeline Specs)
- **KML/KMZ Parsing**:
  - อ่าน XML ด้วย `DOMParser` ในเว็บเบราว์เซอร์
  - ดึงข้อมูลพิกัดสถานที่ `<Placemark>`: `<name>`, `<description>` (ตัด HTML tag สะอาด), `<Point><coordinates>` (จุด), `<LineString><coordinates>` และ `<Polygon><coordinates>` (เส้นทาง)
  - อ่านลำดับขั้นโฟลเดอร์ `<Folder><name>` เพื่อจัดกลุ่มหลัก (Group Hint) ให้อัตโนมัติ
- **GeoJSON Parsing**:
  - อ่าน `FeatureCollection` ถอดพิกัด `Point` (`[lng, lat]`) และ `LineString` (`[[lng, lat], ...]`)
- **CSV Parsing**:
  - ตรวจจับคอลัมน์ `lat`/`ละติจูด` และ `lng`/`ลองจิจูด` โดยอัตโนมัติ

---

## 3. 📋 คู่มือขั้นตอนการใช้งานสำหรับผู้ใช้และเจ้าหน้าที่ (Step-by-Step User Guide)
1. **เตรียมไฟล์พิกัด**:
   - **จาก Google Earth**: คลิกขวาโฟลเดอร์/สถานที่ -> *Save Place As...* เซฟเป็นไฟล์ `.kml` หรือ `.kmz`
   - **จาก QGIS/ArcGIS**: Export เป็นไฟล์ `.geojson` หรือ `.kml`
   - **จาก Excel**: เซฟเป็นไฟล์ `.csv` โดยมีหัวตารางระบุ `name`, `lat`, `lng`
2. **กดนำเข้าในระบบ**:
   - เข้าสู่ระบบบัญชี Admin/Staff -> ไปที่ **ศูนย์ข้อมูลดิจิทัล** (`/data-center`)
   - คลิกปุ่มสีฟ้า **`นำเข้าไฟล์ KML / GIS`** บริเวณมุมขวาบน
   - เลือกไฟล์พิกัดจากคอมพิวเตอร์
3. **ตรวจสอบพรีวิวและกำหนดหมวดหมู่**:
   - เลือก **กลุ่มหลัก** (เช่น โครงสร้างพื้นฐาน, สาธารณสุข) และ **ประเภทย่อย** (เช่น เสาไฟส่องสว่าง, จุดทิ้งขยะ)
   - ติ๊กเลือกรายการสถานที่ที่ต้องการนำเข้า -> กดปุ่ม **`นำเข้า X รายการที่เลือก`**
4. **ตรวจสอบการแสดงผลบนแผนที่**:
   - สลับไปที่แท็บ **"แผนที่" (Map)** ข้อมูลหมุดปักและเส้นทางจะปรากฏบน Google Maps ทันที!
