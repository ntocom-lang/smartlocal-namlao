// หน้ากลางบนโดเมนกลาง (app.rk-networks.com) ที่ต้องกรอก URL ในสโตร์ — เนื้อหาอยู่ที่นี่ หน้า PlatformInfoPage.jsx แค่วาด
// (นโยบายฉบับรวมอยู่ที่ buildPlatformPrivacyPolicy ใน privacyPolicy.js คู่กับฉบับของ อปท. — สาระต้องเป็นชุดเดียวกัน)
//
// - /account/delete: Play บังคับลิงก์เว็บที่ผู้ใช้ "ขอลบบัญชีได้โดยไม่ต้องกลับไปติดตั้งแอป" หน้าต้องอ้างชื่อแอป/ผู้พัฒนา
//   และวางทางลบบัญชีให้เห็นชัด (Play Help answer/13327111) · Apple 5.1.1(v)
//   ตัวลบจริงอยู่บนเว็บของแต่ละ อปท. (/account/delete ของโดเมนนั้น) เพราะบัญชีผูกกับเว็บของหน่วยงาน
// - /support: App Store Connect ต้องมี Support URL ที่มีช่องทางติดต่อจริง
//
// รายการ อปท. มาจากฐานข้อมูล (fetchActiveTenants) มีแห่งใหม่ก็ขึ้นเอง ไม่ต้องแก้หน้า · สนามซ้อมถูกตัดออกที่นี่
import {
  ACCOUNT_DELETE_CONFIRM_WORD, ACCOUNT_DELETION_KEPT, ACCOUNT_DELETION_REMOVED, ACCOUNT_DELETION_STAFF_NOTE,
} from './accountDeletion.js'
import { PLATFORM_APP_NAME, PLATFORM_DEVELOPER, tenantArea, tenantContacts, tenantHref } from './platform.js'

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
