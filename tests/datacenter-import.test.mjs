// ตรวจตัวอ่านไฟล์ GIS ของหน้านำเข้าศูนย์รวมข้อมูลดิจิทัล (src/lib/gisImport.js) — รันใน node ไม่ต่อฐานข้อมูล
//
// ทำไมต้องมีเทสต์ตัวนี้: ตัวนี้ตัดสินว่าข้อมูลอะไร "ขึ้นแผนที่สาธารณะ" และ "ลงหมวดไหน" ทันทีที่กดนำเข้า
//  - สี KML เป็น aabbggrr ถ้าสลับ เส้นสีแดงจะกลายเป็นน้ำเงิน
//  - หมวดที่ตรงของเดิมต้องคืน "ค่าดิบจากฐาน" ไม่ใช่ชื่อโฟลเดอร์ ไม่งั้นเกิดหมวดซ้ำที่ต่างกันแค่ช่องว่าง
//  - ข้อมูลส่วนบุคคล (PDPA) ต้องไม่ถูกเก็บโดยค่าเริ่มต้น
//  - จุดนอกประเทศไทย/พิกัด UTM ต้องถูกกันไว้ ไม่หลุดขึ้นแผนที่
// fixtures ใช้ชื่อสถานที่สมมติล้วน ไม่มีข้อมูลคนจริง
//
//   node tests/datacenter-import.test.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import {
  parseKml, parseKmz, parseGeoJson, parseGpx, parseCsv, parseGisFile, parseZipArchive,
  shapefileGeoJsonToResult, simplifyLine, polygonCentroid, kmlColorToHex, htmlToText,
  suggestMapping, groupByFolder, markDuplicates, looksPersonalColumn, buildDescription,
  haversineMeters, NO_FOLDER_KEY, MAX_DESCRIPTION_CHARS,
  resolveZipImagePath, extractImgSrcs, buildZipImageIndex, MAX_PHOTOS_PER_ENTRY, MAX_PHOTOS_PER_IMPORT,
  MAX_IMPORT_ITEMS, MAX_FILE_BYTES,
} from '../src/lib/gisImport.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fx = name => readFileSync(path.join(here, 'fixtures', 'datacenter-import', name), 'utf8')
const opts = { DOMParserImpl: DOMParser }
const byName = (items, name) => items.find(i => i.name === name)

function pointInRing(pt, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const yi = ring[i].lat, yj = ring[j].lat
    if ((yi > pt.lat) !== (yj > pt.lat) &&
      pt.lng < ring[i].lng + (pt.lat - yi) * (ring[j].lng - ring[i].lng) / (yj - yi)) inside = !inside
  }
  return inside
}

// ── สี KML aabbggrr → #rrggbb ───────────────────────────────────────────────
assert.equal(kmlColorToHex('ff0000ff'), '#ff0000', 'KML แดง = ff0000ff')
assert.equal(kmlColorToHex('ffff0000'), '#0000ff', 'KML น้ำเงิน = ffff0000')
assert.equal(kmlColorToHex('7f00ff00'), '#00ff00', 'alpha ไม่ติดมา')
assert.equal(kmlColorToHex('FF1080C0'), '#c08010', 'ตัวพิมพ์ใหญ่ใช้ได้')
assert.equal(kmlColorToHex('xyz'), null)
assert.equal(kmlColorToHex(''), null)

// ── HTML → ข้อความ ─────────────────────────────────────────────────────────
assert.equal(htmlToText('<b>ก</b><br/>ข<p>ค</p>ง'), 'ก\nข\nค\nง')
assert.equal(htmlToText('<table><tr><td>ชื่อ</td><td>ค่า</td></tr><tr><td>a</td><td>b</td></tr></table>'), 'ชื่อ ค่า\na b')
assert.equal(htmlToText('<script>alert(1)</script>ปลอดภัย'), 'ปลอดภัย', 'ตัด script ทิ้ง')
assert.equal(htmlToText('a &amp; b &lt;i&gt; &#3585;'), 'a & b <i> ก', 'ถอด entity เป็นข้อความล้วน ไม่กลับเป็นแท็กจริง')
assert.equal(htmlToText(''), '')

// ── KML: โฟลเดอร์ ชนิดรูปทรง สี ชื่อ ──────────────────────────────────────
const kml = parseKml(fx('sample.kml'), opts)
assert.equal(kml.items.length, 11, 'จุด 6 + เส้น 3 + พื้นที่ 2')
const shapes = s => kml.items.filter(i => i.shape === s).length
assert.equal(shapes('point'), 6)
assert.equal(shapes('line'), 3)
assert.equal(shapes('polygon'), 2)
assert.deepEqual(kml.skipped, { overlay: 1, model: 1, networkLink: 1, invalidCoord: 1, outsideThailand: 1, empty: 1 })

const h = byName(kml.items, 'รพ.สต.บ้านตัวอย่าง')
assert.deepEqual(h.folderPath, ['สาธารณสุข', 'รพ.สต.'], 'folderPath ไล่ทุกชั้น ชั้นบนสุดก่อน ไม่นับ Document')
assert.equal(h.latitude, 18.1)
assert.equal(h.longitude, 100.5)
assert.equal(h.route_points, null)
assert.equal(h.description, 'สถานที่\nเปิด 08.00-16.00\nโทรสาร: -\nชื่อ ค่า\n& ครบ', 'description แปลง HTML เป็นข้อความหลายบรรทัด')
assert.deepEqual(h.attributes, { เจ้าของ: 'นายสมมติ ใจดี', จำนวนเตียง: '10' }, 'ExtendedData → attributes')
assert.deepEqual(kml.columns, ['เจ้าของ', 'จำนวนเตียง'])

assert.deepEqual(byName(kml.items, 'ถนนสายทดสอบ').folderPath, ['เส้นทาง'], '1 ชั้น')
assert.deepEqual(byName(kml.items, 'จุดนอกโฟลเดอร์').folderPath, [], 'ไม่มีโฟลเดอร์')

// ชื่อว่าง/Untitled → "<ประเภทจากโฟลเดอร์> ลำดับที่ n"
assert.ok(byName(kml.items, 'รพ.สต. ลำดับที่ 1'), 'Untitled Placemark')
assert.ok(byName(kml.items, 'รพ.สต. ลำดับที่ 2'), 'ชื่อว่าง')
assert.ok(byName(kml.items, 'พื้นที่ ลำดับที่ 1'), 'Untitled Polygon')

// สี: StyleMap(normal) / Style inline / PolyStyle ของพื้นที่ / ไม่มีสไตล์
assert.equal(byName(kml.items, 'ถนนสายทดสอบ').route_color, '#0000ff', 'StyleMap → pair normal → LineStyle')
assert.equal(byName(kml.items, 'ลำเหมืองทดสอบ').route_color, '#ff0000', 'Style inline')
assert.equal(byName(kml.items, 'แปลงทดสอบ').route_color, '#00ff00', 'พื้นที่ใช้ PolyStyle')
assert.equal(byName(kml.items, 'เส้นทางจาก GPS').route_color, null)
assert.equal(h.route_color, null, 'จุดไม่มีสีเส้น')

// gx:Track = เส้น (ต้องไม่ติดปัญหา namespace prefix)
const track = byName(kml.items, 'เส้นทางจาก GPS')
assert.equal(track.shape, 'line')
assert.deepEqual(track.route_points, [{ lat: 18.3, lng: 100.6 }, { lat: 18.31, lng: 100.61 }])

// Polygon: ปิดวง + centroid อยู่ในพื้นที่
const poly = byName(kml.items, 'แปลงทดสอบ')
assert.equal(poly.route_points.length, 5, 'ปิดวงให้จุดแรก = จุดสุดท้าย')
assert.deepEqual(poly.route_points[0], poly.route_points[4])
assert.equal(poly.latitude, 18.01)
assert.equal(poly.longitude, 100.01)
assert.ok(pointInRing({ lat: poly.latitude, lng: poly.longitude }, poly.route_points))

// MultiGeometry แตกเป็นหลายรายการ "ชื่อ (ส่วนที่ n)"
assert.ok(byName(kml.items, 'จุดรวมหลายส่วน (ส่วนที่ 1)'))
assert.ok(byName(kml.items, 'จุดรวมหลายส่วน (ส่วนที่ 2)'))

// groupByFolder: 1 แถวต่อโฟลเดอร์ นับตามชนิด
const folders = groupByFolder(kml.items)
const fk = k => folders.find(f => f.key === k)
assert.equal(fk('สาธารณสุข › รพ.สต.').counts.point, 3)
assert.equal(fk('เส้นทาง').counts.line, 3)
assert.equal(fk('พื้นที่').counts.polygon, 2)
assert.equal(fk('พื้นที่').counts.point, 2)
assert.equal(fk(NO_FOLDER_KEY).itemKeys.length, 1)

// ── KMZ ────────────────────────────────────────────────────────────────────
{
  const kmlText = fx('sample.kml')
  const zip = new JSZip()
  zip.file('doc.kml', kmlText)
  zip.file('files/other.kml', '<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>ไม่ใช่ตัวนี้</name><Point><coordinates>100,18</coordinates></Point></Placemark></kml>')
  const kmz = await parseKmz(await zip.generateAsync({ type: 'nodebuffer' }), opts)
  assert.equal(kmz.items.length, 11, 'KMZ เลือก doc.kml')

  const zip2 = new JSZip()
  zip2.file('sub/deep.kml', kmlText)
  zip2.file('ตัวอย่าง.kml', '<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>ตัวบนสุด</name><Point><coordinates>100,18</coordinates></Point></Placemark></kml>')
  const kmz2 = await parseKmz(await zip2.generateAsync({ type: 'nodebuffer' }), opts)
  assert.equal(kmz2.items[0].name, 'ตัวบนสุด', 'ไม่มี doc.kml → .kml ตัวแรกที่ระดับบนสุด')

  const zip3 = new JSZip()
  zip3.file('a/b.kml', kmlText)
  await assert.rejects(parseKmz(await zip3.generateAsync({ type: 'nodebuffer' }), opts), /ไม่พบไฟล์ \.kml/)
}

// ── รูปที่แนบใน KMZ ────────────────────────────────────────────────────────
assert.equal(MAX_PHOTOS_PER_ENTRY, 5, 'เท่ากับฟอร์มเพิ่มข้อมูลเดิม')
assert.equal(MAX_PHOTOS_PER_IMPORT, 300)
assert.equal(MAX_IMPORT_ITEMS, 5000, 'เพดานที่ session หลักเพิ่มไว้ต้องไม่หาย')
assert.equal(MAX_FILE_BYTES, 50 * 1024 * 1024)

// extractImgSrcs: อ่านจาก HTML ดิบ ได้ทั้งเครื่องหมายคำพูดคู่/เดี่ยว/ไม่มี และถอด &amp;
assert.deepEqual(
  extractImgSrcs('<p><img src="files/a.jpg" width=200/><IMG alt=x SRC=\'b.png\'><img src=c.gif></p><img>'),
  ['files/a.jpg', 'b.png', 'c.gif'],
)
assert.deepEqual(extractImgSrcs('<img src="http://example.invalid/x.jpg?a=1&amp;b=2">'), ['http://example.invalid/x.jpg?a=1&b=2'])
assert.deepEqual(extractImgSrcs('ไม่มีรูป'), [])

// resolveZipImagePath
{
  const idx = buildZipImageIndex(['doc.kml', 'files/a.jpg', 'files/รูป บ้าน.png', 'FILES/B.JPG', 'files/note.txt', 'files/', '__MACOSX/files/a.jpg', 'sub/dir/c.webp'])
  assert.equal(idx.size, 4, 'ดัชนีเฉพาะไฟล์รูป ไม่นับ txt/โฟลเดอร์/__MACOSX')
  assert.equal(resolveZipImagePath('files/a.jpg', '', idx), 'files/a.jpg')
  assert.equal(resolveZipImagePath('./files/a.jpg', '', idx), 'files/a.jpg', 'ตัด ./ นำหน้า')
  assert.equal(resolveZipImagePath('files/%E0%B8%A3%E0%B8%B9%E0%B8%9B%20%E0%B8%9A%E0%B9%89%E0%B8%B2%E0%B8%99.png', '', idx), 'files/รูป บ้าน.png', 'ถอด %XX ไทย + %20')
  assert.equal(resolveZipImagePath('files/b.jpg', '', idx), 'FILES/B.JPG', 'ไม่สนตัวพิมพ์ คืนชื่อจริงใน zip')
  assert.equal(resolveZipImagePath('files/a.jpg?v=2#x', '', idx), 'files/a.jpg', 'ตัด query/hash')
  assert.equal(resolveZipImagePath('files\\a.jpg', '', idx), 'files/a.jpg', 'backslash แบบ Windows')
  assert.equal(resolveZipImagePath('c.webp', 'sub/dir', idx), 'sub/dir/c.webp', 'เทียบโฟลเดอร์ของ .kml')
  assert.equal(resolveZipImagePath('../../files/a.jpg', 'sub/dir', idx), 'files/a.jpg', '.. ที่ยังอยู่ใน zip ใช้ได้')
  assert.equal(resolveZipImagePath('files/../files/a.jpg', '', idx), 'files/a.jpg')
  assert.equal(resolveZipImagePath('../files/a.jpg', '', idx), null, '.. หลุดออกนอก zip ต้องปฏิเสธ')
  assert.equal(resolveZipImagePath('../../../etc/passwd.jpg', 'sub', idx), null)
  assert.equal(resolveZipImagePath('files/ไม่มี.jpg', '', idx), null, 'หาไม่เจอ')
  assert.equal(resolveZipImagePath('files/a.jpg%', '', idx), null, '% เดี่ยวไม่ทำให้พัง')
  assert.equal(resolveZipImagePath('http://example.invalid/a.jpg', '', idx), null, 'รูปภายนอกไม่ใช่ path ใน zip')
  assert.equal(resolveZipImagePath('file:///C:/a.jpg', '', idx), null)
  assert.equal(resolveZipImagePath('', '', idx), null)
}

// KMZ ที่มีรูปแนบ — ไบต์เล็กๆ สมมติแทนรูปจริง (ไม่ได้ถอดรหัสเป็นภาพ แค่ต้องได้ blob)
{
  const imgTag = s => `<img src="${s}" width="300"/>`
  const photoKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>
<Folder><name>สถานที่ทดสอบ</name>
  <Placemark><name>จุดมีรูป</name>
    <description><![CDATA[<div>ศาลาทดสอบ</div>${imgTag('files/a.jpg')}<br/>${imgTag('files/%E0%B8%A3%E0%B8%B9%E0%B8%9B%20%E0%B8%9A%E0%B9%89%E0%B8%B2%E0%B8%99.png')}<br/>${imgTag('files/b.jpg')}<br/>${imgTag('files/a.jpg')}<p>files/a.jpg</p>]]></description>
    <ExtendedData><Data name="gx_media_links"><value>http://example.invalid/m1.jpg http://example.invalid/m2.jpg</value></Data><Data name="เกรด"><value>ดี</value></Data></ExtendedData>
    <Point><coordinates>100.5,18.1,0</coordinates></Point></Placemark>
  <Placemark><name>จุดรูปภายนอกและหาไม่เจอ</name>
    <description><![CDATA[${imgTag('http://example.invalid/m1.jpg')}${imgTag('files/ไม่มี.jpg')}${imgTag('../outside.jpg')}]]></description>
    <ExtendedData><Data name="gx_media_links"><value>http://example.invalid/m1.jpg</value></Data></ExtendedData>
    <Point><coordinates>100.51,18.11,0</coordinates></Point></Placemark>
  <Placemark><name>จุดรูปเยอะ</name>
    <description><![CDATA[${['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map(n => imgTag(`files/${n}.jpg`)).join('')}]]></description>
    <Point><coordinates>100.52,18.12,0</coordinates></Point></Placemark>
  <Placemark><name>หลายส่วนมีรูป</name>
    <description><![CDATA[${imgTag('files/a.jpg')}]]></description>
    <MultiGeometry><Point><coordinates>100.53,18.13</coordinates></Point><Point><coordinates>100.54,18.14</coordinates></Point></MultiGeometry></Placemark>
  <Placemark><name>จุดรูปแต่อยู่นอกประเทศ</name>
    <description><![CDATA[${imgTag('files/a.jpg')}${imgTag('http://example.invalid/z.jpg')}]]></description>
    <Point><coordinates>139.69,35.68</coordinates></Point></Placemark>
  <Placemark><name>จุดไม่มีรูป</name><description>แค่ข้อความ</description><Point><coordinates>100.55,18.15</coordinates></Point></Placemark>
</Folder></Document></kml>`

  const bytes = n => Uint8Array.from({ length: n }, (_, i) => (i * 7 + n) % 256)
  const zip = new JSZip()
  zip.file('doc.kml', photoKml)
  zip.file('files/a.jpg', bytes(40))
  zip.file('files/รูป บ้าน.png', bytes(30))
  zip.file('FILES/B.JPG', bytes(20))
  for (const n of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']) zip.file(`files/${n}.jpg`, bytes(10))
  const r = await parseKmz(await zip.generateAsync({ type: 'nodebuffer' }), opts)

  assert.equal(r.items.length, 6, 'จุดนอกประเทศไม่เข้า')
  const withPhoto = byName(r.items, 'จุดมีรูป')
  assert.deepEqual(withPhoto.photoRefs, ['files/a.jpg', 'files/รูป บ้าน.png', 'FILES/B.JPG'], 'ไม่ซ้ำ เรียงตามที่พบ ชื่อจริงใน zip')
  assert.equal(withPhoto.description, 'ศาลาทดสอบ', 'คำอธิบายไม่มีชื่อไฟล์รูปค้าง (รวมบรรทัดที่เป็นชื่อไฟล์เปล่าๆ)')
  assert.deepEqual(withPhoto.attributes, { เกรด: 'ดี' }, 'gx_media_links ไม่ลง attributes')
  assert.deepEqual(r.columns, ['เกรด'])

  const rem = byName(r.items, 'จุดรูปภายนอกและหาไม่เจอ')
  assert.deepEqual(rem.photoRefs, [])

  const many = byName(r.items, 'จุดรูปเยอะ')
  assert.equal(many.photoRefs.length, MAX_PHOTOS_PER_ENTRY, 'ได้ 5')
  assert.deepEqual(many.photoRefs, ['files/p1.jpg', 'files/p2.jpg', 'files/p3.jpg', 'files/p4.jpg', 'files/p5.jpg'])

  const parts = r.items.filter(i => i.name.startsWith('หลายส่วนมีรูป'))
  assert.equal(parts.length, 2)
  assert.deepEqual(parts[0].photoRefs, ['files/a.jpg'], 'รูปติดแค่ส่วนที่ 1')
  assert.deepEqual(parts[1].photoRefs, [], 'ส่วนที่ 2 ไม่ซ้ำรูป')
  assert.deepEqual(byName(r.items, 'จุดไม่มีรูป').photoRefs, [])

  // รวม: total = 3 + 5 + 1 ; overLimit = 2 ; remote = (m1+m2) + (m1 ซ้ำกับ gx_media_links นับครั้งเดียว) = 3 ;
  // missing = ไม่มี.jpg + ../outside.jpg = 2 ; จุดนอกประเทศไม่ถูกนับ (ทั้ง a.jpg และ z.jpg)
  assert.deepEqual(r.photos, { total: 9, overLimit: 2, remote: 3, missing: 2 })
  assert.equal(r.skipped.outsideThailand, 1)

  // readPhoto: สร้าง File จากไบต์ใน zip พร้อม type ตามนามสกุล
  assert.equal(typeof r.readPhoto, 'function')
  const f1 = await r.readPhoto('files/a.jpg')
  assert.ok(f1 instanceof File)
  assert.equal(f1.size, 40)
  assert.equal(f1.type, 'image/jpeg')
  assert.equal(f1.name, 'a.jpg')
  const f2 = await r.readPhoto('files/รูป บ้าน.png')
  assert.equal(f2.type, 'image/png')
  assert.equal(f2.size, 30)
  assert.equal((await r.readPhoto('FILES/B.JPG')).type, 'image/jpeg')
  await assert.rejects(r.readPhoto('files/ไม่มี.jpg'), /ไม่พบรูป/)
  await assert.rejects(r.readPhoto('doc.kml'), /ไม่พบรูป/, 'อ่านได้เฉพาะไฟล์รูป ไม่ใช่ไฟล์อื่นใน zip')

  // parser อื่นไม่มีรูป: photos เป็นศูนย์ readPhoto = null และ KML เดี่ยว (ไม่ใช่ KMZ) ไม่มีไฟล์ให้ดึงรูป
  assert.equal(parseGeoJson(fx('multi.geojson')).readPhoto, null)
  assert.equal(parseCsv(fx('quoted.csv')).readPhoto, null)
  assert.deepEqual(parseCsv(fx('quoted.csv')).photos, { total: 0, overLimit: 0, remote: 0, missing: 0 })
  const plain = parseKml(photoKml, opts)
  assert.equal(plain.readPhoto, null)
  assert.equal(plain.photos.total, 0, 'KML เดี่ยวไม่มีไฟล์รูปให้อ่าน')
  assert.ok(plain.photos.missing >= 1)
  assert.equal(kml.photos.total, 0, 'KML ที่ไม่มีรูป = 0')
}

// ── GeoJSON Multi* ─────────────────────────────────────────────────────────
const gj = parseGeoJson(fx('multi.geojson'))
assert.equal(gj.items.length, 8, 'MultiPoint 2 + MultiLine 2 + MultiPolygon 2 + Collection 2')
assert.equal(gj.skipped.empty, 1, 'geometry เปล่า')
assert.equal(gj.skipped.invalidCoord, 1, 'พิกัด UTM')
assert.ok(gj.warnings.some(w => /UTM/.test(w)), 'ต้องบอกว่าอาจเป็น UTM')
const mp = gj.items.filter(i => i.name.startsWith('จุดหลายจุด'))
assert.deepEqual(mp.map(i => i.name), ['จุดหลายจุด (ส่วนที่ 1)', 'จุดหลายจุด (ส่วนที่ 2)'])
assert.equal(mp[0].groupHint, 'สถานที่สำคัญ')
assert.equal(mp[0].categoryHint, 'วัด')
assert.deepEqual(mp[0].attributes, { เบอร์โทร: '000', รหัส: 'A1' }, 'คอลัมน์ที่ใช้เป็นชื่อ/กลุ่ม/ประเภทแล้วไม่ซ้ำใน attributes')
assert.equal(gj.items.filter(i => i.shape === 'line').length, 3)
assert.equal(gj.items.filter(i => i.name.startsWith('เส้นหลายท่อน'))[0].route_color, '#ff8800')
assert.equal(gj.items.filter(i => i.shape === 'polygon').length, 2)
assert.deepEqual([...gj.columns].sort(), ['รหัส', 'เบอร์โทร'].sort())
assert.throws(() => parseGeoJson('{ไม่ใช่ json'), /GeoJSON/)

// Feature เดี่ยว + geometry เปล่าๆ
assert.equal(parseGeoJson({ type: 'Feature', properties: { name: 'ก' }, geometry: { type: 'Point', coordinates: [100.5, 18.1] } }).items.length, 1)
assert.equal(parseGeoJson({ type: 'Point', coordinates: [100.5, 18.1] }).items[0].name, 'สถานที่ ลำดับที่ 1')

// ── GPX ────────────────────────────────────────────────────────────────────
const gpx = parseGpx(fx('sample.gpx'), opts)
assert.equal(gpx.items.length, 4, 'wpt 1 + trkseg 2 + rte 1')
assert.equal(gpx.skipped.outsideThailand, 1)
const wpt = byName(gpx.items, 'จุดแวะพัก')
assert.equal(wpt.categoryHint, 'ศาลา', 'type → categoryHint')
assert.equal(wpt.description, 'ศาลาทดสอบ\nหมายเหตุสมมติ')
assert.ok(byName(gpx.items, 'เส้นวิ่งทดสอบ (ส่วนที่ 2)'), 'แต่ละ trkseg เป็นส่วน')
assert.equal(byName(gpx.items, 'เส้นทางวางแผน').shape, 'line')

// ── CSV ────────────────────────────────────────────────────────────────────
const csv = parseCsv(fx('quoted.csv'))
assert.equal(csv.items.length, 2)
assert.equal(csv.skipped.outsideThailand, 1)
assert.equal(csv.skipped.invalidCoord, 1)
assert.equal(csv.items[0].name, 'ร้าน "ตัวอย่าง", สาขา 1', 'quote "" แบบ RFC4180 + BOM ไม่ติดหัวคอลัมน์')
assert.ok(csv.items[0].description.includes('บรรทัด 1') && csv.items[0].description.includes('บรรทัด 2'), 'ขึ้นบรรทัดใหม่ในเครื่องหมายคำพูด')
assert.equal(csv.items[0].groupHint, 'สถานประกอบการ')
assert.equal(csv.items[0].categoryHint, 'ร้านค้า')
assert.deepEqual(csv.columns, ['เจ้าของ'])
const semi = parseCsv(fx('semicolon.csv'))
assert.equal(semi.items.length, 2, 'ตัวคั่น ;')
assert.equal(semi.items[0].latitude, 18.15, 'ทศนิยมเป็นจุลภาคในไฟล์ ;')
assert.equal(semi.items[0].longitude, 100.55)
assert.equal(semi.items[0].description, 'มีไฟ')
assert.equal(parseCsv('name\tlat\tlng\nก\t18.1\t100.5\n').items.length, 1, 'ตัวคั่น tab')
assert.throws(() => parseCsv('name,x\nก,1\n'), /ละติจูด/)

// ── เส้นยาว: Douglas–Peucker ───────────────────────────────────────────────
{
  const line = Array.from({ length: 1200 }, (_, i) => ({ lat: 18 + i * 1e-5 + (i % 2) * 1e-7, lng: 100 + i * 1e-5 }))
  const r = parseGeoJson({ type: 'Feature', properties: { name: 'เส้นยาว' }, geometry: { type: 'LineString', coordinates: line.map(p => [p.lng, p.lat]) } })
  const rp = r.items[0].route_points
  assert.ok(rp.length < 500 && rp.length >= 2, `ลดจุดแล้วยัง ≥ 2 (ได้ ${rp.length})`)
  assert.deepEqual(rp[0], { lat: 18, lng: 100 }, 'ปลายเส้นไม่ขยับ')

  const keep = Array.from({ length: 600 }, (_, i) => ({ lat: 18 + 0.01 * Math.sin(i / 600 * Math.PI * 2), lng: 100 + 0.01 * Math.cos(i / 600 * Math.PI * 2) }))
  const ringIn = [...keep, keep[0]]
  const rr = parseGeoJson({ type: 'Feature', properties: { name: 'วงกลม' }, geometry: { type: 'Polygon', coordinates: [ringIn.map(p => [p.lng, p.lat])] } }).items[0]
  assert.ok(rr.route_points.length < ringIn.length && rr.route_points.length >= 4, 'พื้นที่ลดจุดแล้ว ≥ 4')
  assert.deepEqual(rr.route_points[0], rr.route_points[rr.route_points.length - 1], 'ยังปิดวง')

  const three = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.0005 }, { lat: 0, lng: 0.001 }]
  assert.equal(simplifyLine(three, 2, 2).length, 2, 'เส้นตรงเหลือปลายสองจุด')
  const sq = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.000001 }, { lat: 0.000001, lng: 0.000001 }, { lat: 0, lng: 0 }]
  assert.equal(simplifyLine(sq, 2, 4).length, 4, 'ห้ามลดจนต่ำกว่า 4 จุดของพื้นที่')
}

// ── centroid ───────────────────────────────────────────────────────────────
{
  // รูปตัว U: centroid ทางคณิตศาสตร์ตกช่องว่างระหว่างแขน ต้องย้ายเข้าในรูป
  const k = 0.001
  const u = [[0, 0], [10, 0], [10, 10], [9, 10], [9, 1], [1, 1], [1, 10], [0, 10], [0, 0]]
    .map(([x, y]) => ({ lng: 100 + x * k, lat: 18 + y * k }))
  const c = polygonCentroid(u)
  assert.ok(pointInRing(c, u), 'รูปเว้า: หมุดต้องอยู่ในพื้นที่')
  const sq = [{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }, { lat: 2, lng: 2 }, { lat: 2, lng: 0 }, { lat: 0, lng: 0 }]
  assert.deepEqual(polygonCentroid(sq), { lat: 1, lng: 1 })
  // พื้นที่ ~0 (จุดเรียงเป็นเส้นตรง) → ค่าเฉลี่ยของจุด ไม่นับจุดปิดวงซ้ำ: (1+2+3)/3 = 2
  const flat = [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }, { lat: 1, lng: 3 }, { lat: 1, lng: 1 }]
  assert.deepEqual(polygonCentroid(flat), { lat: 1, lng: 2 })
}

// ── Shapefile (mock ผลจาก shpjs) ───────────────────────────────────────────
{
  const layer = (fileName, coords) => ({
    type: 'FeatureCollection', fileName,
    features: [{ type: 'Feature', properties: { name: 'สถานีทดสอบ', TYPE: 'x', ชั้น: 'ก' }, geometry: { type: 'Point', coordinates: coords } }],
  })
  const one = shapefileGeoJsonToResult(layer('data/schools', [100.5, 18.1]))
  assert.equal(one.items.length, 1)
  assert.deepEqual(one.items[0].folderPath, [], 'ชั้นเดียวไม่ใส่โฟลเดอร์')
  assert.equal(one.items[0].categoryHint, 'x', 'hint จากคอลัมน์ในตาราง')
  assert.deepEqual(one.columns, ['ชั้น'])

  const multi = shapefileGeoJsonToResult([layer('data/schools', [100.5, 18.1]), layer('roads', [100.6, 18.2])])
  assert.deepEqual(multi.items.map(i => i.folderPath), [['schools'], ['roads']], 'หลายชั้น → ชื่อชั้นเป็นโฟลเดอร์ (ตัด path)')

  assert.throws(() => shapefileGeoJsonToResult(layer('x', [650000, 1990000]), { hasPrj: false }), /\.prj/,
    'ไม่มี .prj + พิกัดเกิน ±180 ต้องบอกให้ใส่ .prj')
  const withPrj = shapefileGeoJsonToResult(layer('x', [650000, 1990000]), { hasPrj: true })
  assert.equal(withPrj.items.length, 0, 'มี .prj แต่ยังแปลงไม่ได้ → นับเป็นพิกัดผิด ไม่ปล่อยเข้า')
  assert.equal(withPrj.skipped.invalidCoord, 1)

  // zip ที่มี .shp → เรียก parseZip (mock) ไม่โหลด shpjs จริง
  const zip = new JSZip()
  zip.file('a.shp', 'x'); zip.file('a.dbf', 'x'); zip.file('a.prj', 'x')
  let called = 0
  const res = await parseZipArchive(await zip.generateAsync({ type: 'nodebuffer' }), { parseZip: async () => { called += 1; return layer('a', [100.5, 18.1]) } })
  assert.equal(called, 1)
  assert.equal(res.items.length, 1)
  const noPrj = new JSZip()
  noPrj.file('a.shp', 'x'); noPrj.file('a.dbf', 'x')
  const noPrjBuf = await noPrj.generateAsync({ type: 'nodebuffer' })
  await assert.rejects(parseZipArchive(noPrjBuf, { parseZip: async () => layer('a', [650000, 1990000]) }), /\.prj/)
  await assert.rejects(parseZipArchive(noPrjBuf, { parseZip: async () => { throw new Error('no layers founds') } }), /อ่านไฟล์ Shapefile ไม่สำเร็จ/)

  // zip ที่ข้างในเป็น .kml → ส่งไปตัว KML
  const kz = new JSZip()
  kz.file('doc.kml', fx('sample.kml'))
  assert.equal((await parseZipArchive(await kz.generateAsync({ type: 'nodebuffer' }), opts)).items.length, 11)
  await assert.rejects(parseZipArchive(await new JSZip().generateAsync({ type: 'nodebuffer' })), /ไม่พบไฟล์ที่รองรับ/)
}

// ── ทางเข้าจากหน้าจอ (ชนิดไฟล์/การถอดรหัส) ─────────────────────────────────
{
  const mk = (name, buf) => ({ name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) })
  assert.equal((await parseGisFile(mk('ตัวอย่าง.KML', Buffer.from(fx('sample.kml'))), opts)).items.length, 11)
  await assert.rejects(parseGisFile(mk('a.shp', Buffer.from('x'))), /\.zip/, '.shp เดี่ยวต้องบอกให้บีบ zip')
  await assert.rejects(parseGisFile(mk('a.docx', Buffer.from('x'))), /ไม่รองรับ/)
  // CSV จาก Excel ไทยเป็น Windows-874: 0xA1 = ก
  const tis = Buffer.concat([Buffer.from('name,lat,lng\n'), Buffer.from([0xa1]), Buffer.from(',18.1,100.5\n')])
  assert.equal((await parseGisFile(mk('a.csv', tis))).items[0].name, 'ก', 'ถอดรหัส Windows-874')
}

// ── จัดหมวด ────────────────────────────────────────────────────────────────
{
  const summary = {
    groups: [
      { group_name: 'สาธารณสุข ', total: 10, categories: [{ category: 'รพ.สต.', total: 6 }, { category: 'อสม.', total: 4 }] },
      { group_name: 'สถานประกอบการ', total: 8, categories: [{ category: 'ร้านค้า', total: 5 }, { category: 'ตลาด', total: 3 }] },
      { group_name: 'การจัดการขยะ', total: 2, categories: [{ category: 'ตลาด', total: 2 }] },
    ],
  }
  const seed = ['สถานที่สำคัญ', 'สาธารณสุข']
  const run = (entry, defaults) => suggestMapping([{ key: 'k', folderPath: [], groupHint: '', categoryHint: '', ...entry }], summary, seed, defaults).k

  // ≥ 2 ชั้น: ตรงของเดิมต้องได้ "ค่าดิบ" (สาธารณสุข มีช่องว่างท้ายในฐาน)
  const a = run({ folderPath: ['สาธารณสุข', 'รพ.สต.'] })
  assert.deepEqual(a, { group: 'สาธารณสุข ', category: 'รพ.สต.', groupIsNew: false, categoryIsNew: false, isNew: false })
  assert.equal(run({ folderPath: [' สาธารณสุข  ', ' รพ.สต. '] }).group, 'สาธารณสุข ', 'ชื่อโฟลเดอร์มีช่องว่างเกิน ก็คืนค่าดิบจากฐาน')
  const b = run({ folderPath: ['สาธารณสุข', 'ชั้น 2', 'สถานีอนามัย'] })
  assert.equal(b.group, 'สาธารณสุข ')
  assert.equal(b.category, 'สถานีอนามัย', 'บนสุด = กลุ่ม ในสุด = ประเภท')
  assert.equal(b.isNew, true)
  assert.equal(b.groupIsNew, false)
  assert.equal(b.categoryIsNew, true)
  const c = run({ folderPath: ['กลุ่มใหม่', 'ประเภทใหม่'] })
  assert.deepEqual([c.group, c.category, c.groupIsNew, c.categoryIsNew], ['กลุ่มใหม่', 'ประเภทใหม่', true, true])
  assert.equal(run({ folderPath: ['สถานที่สำคัญ  ', 'x'] }).group, 'สถานที่สำคัญ', 'ตรงชื่อตั้งต้น → ใช้ตัวสะกดของชื่อตั้งต้น')

  // 1 ชั้น
  const d = run({ folderPath: ['ร้านค้า'] })
  assert.deepEqual([d.group, d.category, d.isNew], ['สถานประกอบการ', 'ร้านค้า', false], 'ประเภทอยู่ใต้กลุ่มเดียว → เติมกลุ่มให้')
  const e = run({ folderPath: ['สาธารณสุข'] }, { group: 'ก', category: 'พิกัดนำเข้า' })
  assert.deepEqual([e.group, e.category], ['สาธารณสุข ', 'พิกัดนำเข้า'], 'ชื่อตรงกลุ่มหลัก → เป็นกลุ่ม ประเภทใช้ค่าเริ่มต้น')
  assert.equal(run({ folderPath: ['สาธารณสุข'] }).category, '', 'ไม่มีค่าเริ่มต้น → ประเภทว่างรอกรอก')
  assert.equal(run({ folderPath: ['ตลาด'] }).group, '', 'ประเภทอยู่หลายกลุ่ม ไม่เดา')
  assert.equal(run({ folderPath: ['ตลาด'] }, { group: 'การจัดการขยะ' }).group, 'การจัดการขยะ', 'เลือกกลุ่มที่ตรงค่าเริ่มต้น')
  const f = run({ folderPath: ['ของใหม่'] }, { group: 'สถานที่สำคัญ' })
  assert.deepEqual([f.group, f.category, f.groupIsNew, f.categoryIsNew], ['สถานที่สำคัญ', 'ของใหม่', true, true])

  // ไม่มีโฟลเดอร์: hint จากไฟล์ → ค่าเริ่มต้น
  const g = run({ groupHint: 'สถานประกอบการ', categoryHint: 'ร้านค้า' }, { group: 'อื่น', category: 'อื่น' })
  assert.deepEqual([g.group, g.category, g.isNew], ['สถานประกอบการ', 'ร้านค้า', false], 'hint มาก่อนค่าเริ่มต้น')
  const i = run({}, { group: 'สถานประกอบการ', category: 'ร้านค้า' })
  assert.deepEqual([i.group, i.category, i.isNew], ['สถานประกอบการ', 'ร้านค้า', false])
  const j = run({ categoryHint: 'ร้านค้า' })
  assert.equal(j.group, 'สถานประกอบการ', 'มีแต่ประเภทใน hint → เติมกลุ่มจากของเดิม')

  // ไม่มี summary ก็ไม่พัง
  const none = suggestMapping([{ key: 'k', folderPath: ['ก', 'ข'] }], null, [])
  assert.equal(none.k.isNew, true)
}

// ── กันซ้ำ ─────────────────────────────────────────────────────────────────
{
  const items = [
    { key: 'a', name: 'รพ.สต.บ้านตัวอย่าง', latitude: 18.1, longitude: 100.5 },
    { key: 'b', name: 'รพ.สต.บ้านตัวอย่าง', latitude: 18.1, longitude: 100.5005 },
    { key: 'c', name: 'ศาลา', latitude: 18.1, longitude: 100.5 },
    { key: 'd', name: '  รพ.สต.บ้านตัวอย่าง ', latitude: 18.1, longitude: 100.5 },
  ]
  const existing = [{ name: 'รพ.สต.บ้านตัวอย่าง', latitude: 18.1, longitude: 100.50005 }]
  const r = markDuplicates(items, existing, 10)
  assert.deepEqual(r.map(x => x.duplicate), [true, false, false, true], 'ชื่อเท่ากัน + ≤ 10 ม. เท่านั้น')
  assert.equal(items[0].duplicate, undefined, 'ไม่แก้ของเดิม')
  assert.deepEqual(markDuplicates(items, [], 10).map(x => x.duplicate), [false, false, false, false])

  // เทียบกับวิธีเทียบทุกคู่: ผลต้องเหมือนกันทุกรายการ (รวมกรณีคร่อมขอบเซลล์กริด)
  let seed = 12345
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
  const names = ['ก', 'ข', 'ค']
  const mk = n => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, name: names[Math.floor(rnd() * 3)], latitude: 18 + rnd() * 0.002, longitude: 100 + rnd() * 0.002 }))
  const its = mk(400)
  const ex = mk(400)
  const got = markDuplicates(its, ex, 10)
  its.forEach((it, i) => {
    const expect = ex.some(e => e.name === it.name && haversineMeters({ lat: it.latitude, lng: it.longitude }, { lat: e.latitude, lng: e.longitude }) <= 10)
    assert.equal(got[i].duplicate, expect, `bucket ต้องตรงกับเทียบทุกคู่ (รายการ ${i})`)
  })
}

// ── PDPA: ชื่อคอลัมน์ที่น่าจะเป็นข้อมูลส่วนบุคคล ───────────────────────────
for (const n of ['ชื่อ-สกุล', 'ชื่อ - สกุล', 'ชื่อเจ้าของ', 'เจ้าของ', 'ผู้ครอบครอง', 'owner', 'Owner_Name', 'เลขบัตรประชาชน', 'เลขบัตร',
  'id_card', 'ID Card', 'citizen', 'เบอร์โทร', 'โทรศัพท์', 'tel', 'Phone', 'mobile', 'email', 'อีเมล', 'ที่อยู่', 'address', 'Home Address']) {
  assert.equal(looksPersonalColumn(n), true, `ต้องนับเป็นข้อมูลส่วนบุคคล: ${n}`)
}
for (const n of ['name', 'Name', 'NAME', 'ชื่อ', 'ชื่อสถานที่', 'hotel', 'จำนวนเตียง', 'รหัส', 'category', 'ประเภท', '']) {
  assert.equal(looksPersonalColumn(n), false, `ไม่ควรนับ: "${n}"`)
}

// ── buildDescription ───────────────────────────────────────────────────────
assert.equal(buildDescription('คำอธิบาย', { ก: '1', ข: '2', ค: '3' }, ['ก', 'ค']), 'คำอธิบาย\nก: 1\nค: 3', 'เก็บเฉพาะคอลัมน์ที่เลือก')
assert.equal(buildDescription('', { ก: '1' }, ['ก']), 'ก: 1')
assert.equal(buildDescription('x', { ก: '' }, ['ก', 'ไม่มี']), 'x', 'ค่าว่าง/คอลัมน์ที่ไม่มีไม่ขึ้นบรรทัด')
assert.equal(buildDescription('', {}, []), '')
{
  const long = buildDescription('ก'.repeat(3990), { หัวข้อ: 'ข'.repeat(100) }, ['หัวข้อ'])
  assert.equal(long.length, MAX_DESCRIPTION_CHARS, 'ตัดที่ 4000 ตัวอักษร')
  const emoji = buildDescription('ก'.repeat(3999) + '😀', {}, [])
  assert.ok(emoji.length <= MAX_DESCRIPTION_CHARS && !/[\ud800-\udbff]$/.test(emoji), 'ไม่ตัดกลาง surrogate pair')
}

console.log('datacenter-import: ทุกเคสผ่าน')
