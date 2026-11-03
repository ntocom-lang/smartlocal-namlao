// หน้ากลางบนโดเมนกลาง (app.rk-networks.com) ที่ต้องกรอก URL ในสโตร์ — เนื้อหาอยู่ที่นี่ หน้า PlatformInfoPage.jsx แค่วาด
// (นโยบายฉบับรวมอยู่ที่ buildPlatformPrivacyPolicy ใน privacyPolicy.js คู่กับฉบับของ อปท. — สาระต้องเป็นชุดเดียวกัน)
//
// - /account/delete: Play บังคับลิงก์เว็บที่ผู้ใช้ "ขอลบบัญชีได้โดยไม่ต้องกลับไปติดตั้งแอป" หน้าต้องอ้างชื่อแอป/ผู้พัฒนา
//   และวางทางลบบัญชีให้เห็นชัด (Play Help answer/13327111) · Apple 5.1.1(v)
//   ตัวลบจริงอยู่บนเว็บของแต่ละ อปท. (/account/delete ของโดเมนนั้น) เพราะบัญชีผูกกับเว็บของหน่วยงาน
// - /support: App Store Connect ต้องมี Support URL ที่มีช่องทางติดต่อจริง
//
// - /download: ให้ อปท./ผู้บริหาร/ผู้ทดลองติดตั้งแอปได้ก่อนขึ้นสโตร์ (เจ้าของระบบสั่ง 2569-11-03 "ถ้าไม่มีให้โหลดจะทดลองยังไง")
//   Android โหลด APK ตรง · iPhone เพิ่มลงหน้าจอหลัก (ไม่มี APK บน iOS) ไม่ใช้ข้อมูลหน่วยงานจากฐานข้อมูล
//
// รายการ อปท. มาจากฐานข้อมูล (fetchActiveTenants) มีแห่งใหม่ก็ขึ้นเอง ไม่ต้องแก้หน้า · สนามซ้อมถูกตัดออกที่นี่
import {
  ACCOUNT_DELETE_CONFIRM_WORD, ACCOUNT_DELETION_KEPT, ACCOUNT_DELETION_REMOVED, ACCOUNT_DELETION_STAFF_NOTE,
} from './accountDeletion.js'
import { APK_DOWNLOAD } from './appDownload.js'
import { PLATFORM_APP_NAME, PLATFORM_DEVELOPER, platformHref, tenantArea, tenantContacts, tenantHref } from './platform.js'

function orgsOf(tenants, path, hrefLabel, hostname) {
  return tenants.filter((t) => !t.isDemo).map((t) => ({
    key: t.slug, name: t.name, area: tenantArea(t), contacts: tenantContacts(t),
    href: tenantHref(t.slug, path, hostname), hrefLabel,
  }))
}

/**
 * @param {Array<object>} tenants จาก fetchActiveTenants (src/lib/platform.js)
 * @param {string} [hostname] ไว้ให้เทสต์ส่งเอง (ค่าเริ่มคือโดเมนที่เปิดอยู่)
 */
export function buildPlatformAccountDeletion(tenants = [], hostname) {
  return {
    title: 'ลบบัญชีผู้ใช้',
    intro: `ผู้ใช้แอป ${PLATFORM_APP_NAME} และเว็บไซต์ของหน่วยงานในรายการด้านล่าง ลบบัญชีของตัวเองได้ทุกเมื่อ ระบบลบทันทีโดยไม่ต้องรอเจ้าหน้าที่ และไม่ต้องติดตั้งแอปใหม่`,
    sections: [
      {
        id: 'steps',
        title: 'วิธีลบบัญชี',
        steps: [
          'เลือกหน่วยงานที่ท่านสมัครไว้จากรายการด้านล่าง แล้วกด "ลบบัญชีที่หน่วยงานนี้"',
          'เข้าสู่ระบบด้วยช่องทางเดิมที่สมัครไว้ (เบอร์โทรศัพท์และรหัสผ่าน, LINE หรือ Google)',
          `พิมพ์คำว่า "${ACCOUNT_DELETE_CONFIRM_WORD}" แล้วกดยืนยัน ระบบลบบัญชีทันที`,
        ],
        note: 'ในแอป: เปิดหน้าโปรไฟล์ แล้วกด "ลบบัญชี" ได้เช่นกัน',
        orgs: orgsOf(tenants, '/account/delete', 'ลบบัญชีที่หน่วยงานนี้', hostname),
      },
      { id: 'removed', title: 'สิ่งที่ถูกลบ', items: ACCOUNT_DELETION_REMOVED },
      {
        id: 'kept',
        title: 'สิ่งที่หน่วยงานยังเก็บไว้',
        items: ACCOUNT_DELETION_KEPT,
        links: [{ to: '/privacy#retention', label: 'ระยะเวลาเก็บรักษาในนโยบายความเป็นส่วนตัว' }],
      },
      {
        id: 'help',
        title: 'เข้าสู่ระบบไม่ได้ หรือเป็นบัญชีเจ้าหน้าที่',
        paragraphs: [
          'ติดต่อหน่วยงานที่ท่านสมัครไว้ตามช่องทางในรายการข้างบน เจ้าหน้าที่จะยืนยันตัวตนแล้วลบบัญชีให้',
          ACCOUNT_DELETION_STAFF_NOTE,
        ],
      },
    ],
  }
}

/**
 * @param {Array<object>} tenants จาก fetchActiveTenants (src/lib/platform.js)
 * @param {string} [hostname] ไว้ให้เทสต์ส่งเอง (ค่าเริ่มคือโดเมนที่เปิดอยู่)
 */
export function buildPlatformSupport(tenants = [], hostname) {
  return {
    title: 'ช่วยเหลือและติดต่อ',
    intro: `แอป ${PLATFORM_APP_NAME} พาท่านไปยังบริการออนไลน์ขององค์กรปกครองส่วนท้องถิ่นที่ท่านเลือก เรื่องคำร้อง คำขอบริการ หรือบัญชีผู้ใช้ ติดต่อหน่วยงานของท่านได้โดยตรงตามรายการด้านล่าง`,
    sections: [
      {
        id: 'contacts',
        title: 'ช่องทางติดต่อหน่วยงาน',
        orgs: orgsOf(tenants, '/contact', 'ช่องทางติดต่ออื่นของหน่วยงาน', hostname),
      },
      {
        id: 'faq',
        title: 'คำถามที่พบบ่อย',
        items: [
          'เปลี่ยนหน่วยงาน: ในแอปเปิดเมนูเพิ่มเติม แล้วกด "เปลี่ยนหน่วยงาน" จากนั้นเข้าสู่ระบบที่หน่วยงานใหม่ เพราะบัญชีผูกกับเว็บของแต่ละหน่วยงาน',
          'ลืมรหัสผ่าน: กด "ลืมรหัสผ่าน?" ในหน้าเข้าสู่ระบบ แล้วทำตามขั้นตอน หรือติดต่อหน่วยงานของท่านเพื่อยืนยันตัวตน',
          'ลบบัญชี: ทำเองได้ทุกเมื่อ ดูขั้นตอนที่หน้าลบบัญชีผู้ใช้',
        ],
        links: [{ to: '/account/delete', label: 'ลบบัญชีผู้ใช้' }, { to: '/privacy', label: 'นโยบายความเป็นส่วนตัว' }],
      },
      PLATFORM_DEVELOPER.email && {
        id: 'developer',
        title: 'ปัญหาการใช้งานแอป',
        paragraphs: [`ติดต่อ${PLATFORM_DEVELOPER.name || 'ผู้พัฒนาแอป'}`],
        contacts: [{ kind: 'email', label: 'อีเมล', value: PLATFORM_DEVELOPER.email }],
      },
    ].filter(Boolean),
  }
}

/** ขนาดไฟล์ที่คนอ่านรู้เรื่อง (1,067,050 → "1.0 MB") */
export function formatFileSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * หน้า "ติดตั้งแอป" — ถ้อยคำทุกข้อต้องจริงตามที่ระบบเป็นอยู่ (อย่าสัญญาเกินที่ทดสอบแล้ว):
 * บัญชีอยู่ที่ฐานข้อมูลกลาง จึงใช้ชื่อผู้ใช้เดิมได้ แต่ "การจำล็อกอิน" อยู่ในเครื่องแยกตามช่องทาง จึงเขียนว่า "อาจต้อง" ล็อกอินอีกครั้ง
 * @param {Array<object>} [tenants] ไม่ใช้ (หน้านี้ไม่ลิสต์หน่วยงาน) — รับไว้ให้ลายเซ็นเหมือนหน้ากลางอื่น PlatformInfoPage เรียกเหมือนกันหมด
 * @param {string} [hostname] ไว้ให้เทสต์ส่งเอง (ค่าเริ่มคือโดเมนที่เปิดอยู่)
 */
export function buildPlatformDownload(tenants, hostname) {
  const { path, versionName, sizeBytes, sha256 } = APK_DOWNLOAD
  const fileName = path.split('/').pop()
  return {
    title: `ติดตั้งแอป ${PLATFORM_APP_NAME}`,
    intro: `ทดลองใช้แอป ${PLATFORM_APP_NAME} ได้ทันที ไม่ต้องรอแอปบน Google Play หรือ App Store ใช้ชื่อผู้ใช้และรหัสผ่านเดิมของท่านได้ ไม่ต้องสมัครใหม่`,
    sections: [
      {
        id: 'android',
        title: 'Android — ติดตั้งไฟล์แอป (APK)',
        steps: [
          'กดปุ่ม "ดาวน์โหลดแอป" ด้านล่าง',
          `เมื่อโหลดเสร็จ แตะไฟล์ ${fileName} ที่โหลดมา (ดูได้ที่แถบแจ้งเตือน หรือแอป "ไฟล์" โฟลเดอร์ Downloads)`,
          'ถ้าเครื่องถามเรื่องการติดตั้งจากแหล่งที่ไม่รู้จัก ให้เปิดอนุญาตให้เบราว์เซอร์ที่ใช้โหลดไฟล์ แล้วกลับมากด "ติดตั้ง"',
          'ถ้า Google Play Protect ขึ้นข้อความเตือน ให้เลือก "ติดตั้งต่อ" เพราะแอปนี้ยังไม่ได้อยู่บน Google Play',
          `เปิดแอป "${PLATFORM_APP_NAME}" แล้วเลือกหน่วยงานของท่าน`,
        ],
        download: {
          href: path,
          label: 'ดาวน์โหลดแอป (Android)',
          meta: `เวอร์ชัน ${versionName} · ${formatFileSize(sizeBytes)}`,
          // แสดงหลังกดปุ่ม — Android ติดตั้งให้เองไม่ได้ ต้องให้ผู้ใช้แตะไฟล์แล้วกดยืนยันเอง (ห้ามเขียนว่า "ติดตั้งอัตโนมัติ")
          after: {
            title: 'กำลังโหลดแอป — ขั้นต่อไปที่ต้องทำเอง',
            steps: [
              'รอให้โหลดเสร็จ (ถ้า Chrome ถามว่าไฟล์ประเภทนี้อาจเป็นอันตราย ให้เลือก "เก็บไว้")',
              'แตะ "เปิด" ที่แถบด้านล่างของหน้าจอ หรือที่การแจ้งเตือน "ดาวน์โหลดเสร็จแล้ว"',
              'ถ้าเครื่องไม่อนุญาตให้ติดตั้งจากแหล่งนี้ กด "การตั้งค่า" เปิด "อนุญาตจากแหล่งนี้" แล้วกดย้อนกลับ',
              'กด "ติดตั้ง" แล้วกด "เปิด"',
            ],
          },
        },
        details: {
          summary: 'ตรวจความถูกต้องของไฟล์ (สำหรับผู้ดูแลระบบ)',
          text: `SHA-256: ${sha256}`,
        },
      },
      {
        id: 'iphone',
        title: 'iPhone / iPad — เพิ่มลงหน้าจอหลัก',
        steps: [
          'เปิดหน้าเลือกหน่วยงานด้วย Safari แล้วเลือกหน่วยงานของท่าน',
          'กดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น) แล้วเลือก "เพิ่มไปยังหน้าจอโฮม" (Add to Home Screen)',
          'เปิดแอปจากไอคอนบนหน้าจอ',
        ],
        note: 'iPhone ยังไม่มีไฟล์ติดตั้งแบบ Android วิธีนี้ใช้งานได้เหมือนแอป ส่วนการแจ้งเตือนบน iPhone อยู่ระหว่างทดสอบ อาจใช้ไม่ได้ในช่วงนี้',
        links: [{ to: '/', label: 'เปิดหน้าเลือกหน่วยงาน' }],
      },
      {
        id: 'account',
        title: 'บัญชีและข้อมูลเดิมของท่าน',
        items: [
          'ใช้ชื่อผู้ใช้และรหัสผ่านเดิม (หรือ LINE / Google ที่เคยใช้) ได้เลย ไม่ต้องสมัครใหม่ บัญชีและข้อมูลคำร้อง คำขอของท่านอยู่ที่ระบบกลาง ไม่ได้อยู่ในเครื่อง',
          'ในแอปอาจต้องเลือกหน่วยงานและเข้าสู่ระบบอีกหนึ่งครั้ง เพราะเครื่องจำการเข้าสู่ระบบแยกกันตามช่องทาง',
          'ถ้าเคยติดตั้งจากเว็บของหน่วยงานไว้แล้ว จะมีไอคอนสองอัน ใช้อันไหนก็ได้ จะลบอันเดิมหรือไม่ก็ได้',
        ],
      },
      {
        id: 'try',
        title: 'ทดลองโดยไม่กระทบหน่วยงานจริง',
        paragraphs: [
          'ในหน้าเลือกหน่วยงาน เลือก "เทศบาลตำบลสาธิต" ท้ายรายการ ใช้ลองเมนูต่างๆ ได้ เรื่องที่แจ้งที่นั่นไม่ถึงหน่วยงานจริง',
        ],
      },
      {
        id: 'share',
        title: 'ส่งต่อให้คนอื่น',
        paragraphs: ['สแกน QR นี้ด้วยมือถือเพื่อเปิดหน้าติดตั้งนี้ แอปอยู่ระหว่างเตรียมขึ้น Google Play และ App Store'],
        qr: { text: platformHref('/download', hostname), label: 'QR เปิดหน้าติดตั้งแอป' },
        links: [{ to: '/privacy', label: 'นโยบายความเป็นส่วนตัว' }, { to: '/support', label: 'ช่วยเหลือและติดต่อ' }],
      },
    ],
  }
}
