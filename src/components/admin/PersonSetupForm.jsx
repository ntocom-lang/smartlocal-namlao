import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Copy, KeyRound, Loader2, Plus, RefreshCw, Repeat, Search, Trash2, Users, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { appUrl } from '../../lib/basename'
import { loginIdentifier, normalizeThaiPhone, phoneToLoginEmail } from '../../lib/authProviders'
import { QUIET_MODULES, qrLayout } from '../../lib/qrSvg'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../lib/staffRoster'
import { tenantDefaultSubdistrict } from '../../lib/tenantSubdistrict'
import { joinThaiFullName, NAME_TITLES, splitThaiFullName } from '../../lib/thaiName'
import {
  canClearDepartmentHead, createDepartment, createPosition, defaultDepartmentHead, departmentFromPositionName, groupPositionsByDepartment,
  isDepartmentHeadPosition, isExecutivePosition, isUnitHeadPositionName, makePositionShared, positionSearchKey, positionTraitsFromName,
  prettyPositionName, proposedDepartmentName, proposedRoleForAppointment, suggestedDepartmentId,
} from '../../lib/personnelStructure'
import {
  buildSignatorySlots, isSignatoryActiveToday, personSigningRows, signatoryChangeFor, signatoryName, signatorySlotKey,
} from '../../lib/documentSignatories'
import { esignAnyOnline, esignModesFromStatus } from '../../lib/esign'
import { getEsignGateStatus } from '../../lib/esignApi'
import { fetchOtherDepartmentHeads, finishAppointment } from '../../lib/signatoryApi'
import PersonSigningChoices, { OtherHeadsChoices } from './PersonSigningChoices'
import SigningDialogShell from './SigningDialogShell'

// ฟอร์มเจ้าหน้าที่หน้าเดียว (เจ้าของระบบอนุมัติ 2569-10-31): 1 คน ตั้งที่เดียว บันทึกครั้งเดียว ทั้งเพิ่มคนใหม่และแก้คนเดิม
// เดิมต้องไปแท็บแบบตำแหน่ง → แท็บเจ้าหน้าที่ → หน้ารายละเอียด 4 แท็บ → เมนูการลงนาม รวม 22 ขั้น
// ตาราง positions / departments / document_signatories ยังอยู่ครบ แต่กลายเป็นผลของการบันทึกครั้งนี้ ไม่ใช่สิ่งที่ต้องไปตั้งก่อน
// "ระบบเติมให้" ทุกข้อขึ้นบนฟอร์มและแก้ได้ก่อนบันทึก: อำนาจลงนามกับสิทธิ์เป็นการตัดสินของแอดมิน ระบบไม่บันทึกเอง

// กองที่พิมพ์ในฟอร์มยังไม่ถูกสร้างจนกว่าจะกดบันทึก จึงใช้รหัสชั่วคราว
const NEW_DEPARTMENT = '__new_department'

const ASSET_ROLE_OPTIONS = [
  { value: '', label: 'ไม่มีสิทธิ์ — ไม่เห็นเมนูพัสดุ/ครุภัณฑ์' },
  { value: 'asset_staff', label: 'เจ้าหน้าที่พัสดุของกอง — เพิ่ม/แก้ของและดำเนินการคำขอ เฉพาะกองที่สังกัด' },
  { value: 'asset_admin', label: 'ผู้ดูแลพัสดุของ อปท. — ทุกกอง รวมของที่ยังไม่ผูกกอง' },
  { value: 'asset_viewer', label: 'ผู้ดูรายงาน — อ่านอย่างเดียว' },
]

const fieldClass = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500'
const labelClass = 'mb-1 block text-xs font-bold text-slate-600'
const sectionTitleClass = 'text-sm font-extrabold text-slate-800'

function AutoTag({ children }) {
  return <span className="ml-1.5 inline-block rounded-full bg-blue-50 px-2 text-xs font-bold text-blue-700" data-auto-tag>{children}</span>
}

function nameIsIncomplete(fullName) {
  const parts = splitThaiFullName(fullName)
  return !parts.title || !parts.last
}

const toggleIn = (list, value) => (list.includes(value) ? list.filter(item => item !== value) : [...list, value])

function initialAccountDraft(user, tenant) {
  return {
    // ซ่อน @phone.smartlocal.app ซึ่งเป็น implementation detail — เจ้าหน้าที่แก้เฉพาะชื่อผู้ใช้จริงที่ประชาชนต้องพิมพ์
    email: loginIdentifier(user?.email).value,
    phone: user?.phone || '',
    id_card: user?.id_card || '',
    address_province: user?.address_province || tenant?.province || '',
    address_district: user?.address_district || tenant?.district || '',
    address_subdistrict: user?.address_subdistrict || tenantDefaultSubdistrict(tenant),
    address_moo: user?.address_moo || '',
    address_detail: user?.address_detail || '',
  }
}

// ยังไม่มีบัญชี: ให้เจ้าตัวสมัครเอง แอดมินจึงไม่รู้รหัสผ่านของคนที่อาจเป็นผู้ลงนาม และเจ้าตัวเป็นคนกรอกข้อมูลของตัวเอง
function NoAccountPanel({ query, onRetry, onOpenSigning }) {
  const link = appUrl('/auth?mode=register')
  const qr = useMemo(() => qrLayout(link, 1000), [link])
  const [copied, setCopied] = useState(false)
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  const box = qr ? qr.size + QUIET_MODULES * 2 : 0
  return (
    <div className="mt-2 grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900 sm:grid-cols-[112px_minmax(0,1fr)]" data-person-no-account>
      {qr && (
        <svg viewBox={`0 0 ${box} ${box}`} role="img" aria-label="QR สมัครใช้งาน" className="h-28 w-28 rounded-lg bg-white">
          <path d={qr.d} transform={`translate(${QUIET_MODULES} ${QUIET_MODULES})`} fill="#000" shapeRendering="crispEdges" />
        </svg>
      )}
      <div className="min-w-0">
        <p className="font-bold">ยังไม่มีบัญชีชื่อ “{query}”</p>
        <p className="mt-1 text-xs leading-5">ให้เจ้าตัวสแกน QR สมัครด้วย LINE หรือเบอร์โทร ใช้เวลาราว 1 นาที แล้วค้นหาอีกครั้ง ถ้าไม่ได้อยู่ด้วยกัน ส่งลิงก์นี้ให้ได้</p>
        <p className="mt-1 break-all text-xs font-semibold" data-person-signup-link>{link}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={onRetry} className="flex min-h-11 items-center gap-1.5 rounded-xl border border-amber-400 bg-white px-3 text-xs font-bold text-amber-900 hover:bg-amber-100">
            <RefreshCw size={14} /> ค้นหาอีกครั้ง
          </button>
          <button type="button" onClick={copyLink} className="flex min-h-11 items-center gap-1.5 rounded-xl border border-amber-400 bg-white px-3 text-xs font-bold text-amber-900 hover:bg-amber-100">
            <Copy size={14} /> {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
          </button>
        </div>
        {onOpenSigning && (
          <p className="mt-2 text-xs leading-5">
            แค่ต้องการให้ชื่อพิมพ์บนเอกสาร ไม่ต้องเข้าระบบ{' '}
            <button type="button" onClick={onOpenSigning} className="min-h-11 font-bold underline">ตั้งที่เมนูการลงนามเอกสาร</button>
          </p>
        )}
      </div>
    </div>
  )
}

// ส่วนพับชื่อเดิมของแท็บในหน้ารายละเอียด — ไม่ค่อยได้ใช้ตอนตั้งคน ฟอร์มจึงไม่ยาว บัญชีประชาชนเปิดไว้เพราะเป็นข้อมูลหลักของเขา
function FoldSection({ title, defaultOpen = false, testId, children }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-slate-200 px-3.5" data-person-fold={testId}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-bold text-slate-700 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="pb-3.5 pt-1">{children}</div>
    </details>
  )
}

export default function PersonSetupForm({
  tenant,
  user = null,
  initial = null,
  depts,
  positions,
  currentUserRole,
  currentUserId,
  canEdit = true,
  registry,
  saveUserEdits,
  updateUserEmail,
  nestedOpen = false,
  actions = {},
  renderAccount = null,
  renderPersonal = null,
  onClose,
  onSaved,
  onStructureChanged,
  onHeadsCleared,
  onOpenSigning = null,
}) {
  const isAdd = !user
  const [person, setPerson] = useState(user)
  const [accountQuery, setAccountQuery] = useState('')
  const [candidates, setCandidates] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchedQuery, setSearchedQuery] = useState('')
  const [searchNonce, setSearchNonce] = useState(0)
  const searchSequence = useRef(0)
  const [extras, setExtras] = useState(null)

  const [fullName, setFullName] = useState(user?.full_name || '')
  // ชื่อไม่ครบกางช่องให้แก้ตั้งแต่เปิด และกางค้างไว้ ถ้าซ่อนทันทีที่ครบ ช่องจะหายตอนพิมพ์นามสกุลตัวแรก
  const [nameOpen, setNameOpen] = useState(() => Boolean(user) && nameIsIncomplete(user.full_name))
  const [account, setAccount] = useState(() => initialAccountDraft(user, tenant))

  // รายชื่อจากแม่โหลดมาทีหลังได้ (เปิดฟอร์มก่อนโหลดเสร็จ) ต้องรวมกับของที่เพิ่งเพิ่มในฟอร์มนี้ ไม่ทับกัน
  const [createdPositions, setCreatedPositions] = useState([])
  const [sharedPositionIds, setSharedPositionIds] = useState([])
  const [createdDepts, setCreatedDepts] = useState([])
  const localPositions = useMemo(() => [
    ...positions,
    ...createdPositions.filter(item => !positions.some(next => next.id === item.id)),
  ].map(item => (sharedPositionIds.includes(item.id) ? { ...item, department_id: null } : item)), [positions, createdPositions, sharedPositionIds])
  const localDepts = useMemo(() => [
    ...depts,
    ...createdDepts.filter(item => !depts.some(next => next.id === item.id)),
  ], [depts, createdDepts])
  const [positionId, setPositionId] = useState(user?.position_id || initial?.positionId || '')
  const [newPositionName, setNewPositionName] = useState(initial?.positionName ? prettyPositionName(initial.positionName) : '')
  const [positionQuery, setPositionQuery] = useState(() => {
    if (user?.position_name) return user.position_name
    if (initial?.positionId) return positions.find(item => item.id === initial.positionId)?.name ?? ''
    return initial?.positionName ? prettyPositionName(initial.positionName) : ''
  })
  const [positionOpen, setPositionOpen] = useState(false)
  const positionBox = useRef(null)

  const [departmentId, setDepartmentId] = useState(user?.department_id || initial?.departmentId || '')
  const [departmentAuto, setDepartmentAuto] = useState(Boolean(!user && initial?.departmentId))
  const [addingDepartment, setAddingDepartment] = useState(false)
  const [newDepartmentName, setNewDepartmentName] = useState('')
  const [newDepartmentAuto, setNewDepartmentAuto] = useState(false)

  const [headOverride, setHeadOverride] = useState(null)
  const [keptHeads, setKeptHeads] = useState([])
  const [loadedHeads, setLoadedHeads] = useState({ department: null, rows: [] })
  const [roleOverride, setRoleOverride] = useState(null)
  const [roleOpen, setRoleOpen] = useState(false)
  const [assetRole, setAssetRole] = useState(null)
  const [clearJobTitle, setClearJobTitle] = useState(false)

  const [signChoices, setSignChoices] = useState({})
  const [extraKeys, setExtraKeys] = useState([])
  const [customLabels, setCustomLabels] = useState([])
  const [titles, setTitles] = useState({})
  const [signMode, setSignMode] = useState(null)

  const [saving, setSaving] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState('')
  const [savedWithProblems, setSavedWithProblems] = useState(false)

  useEffect(() => {
    const query = accountQuery.trim()
    if (person || query.length < 2) return undefined
    const requestId = ++searchSequence.current
    const timer = setTimeout(async () => {
      setSearching(true)
      // RPC นี้คืนเฉพาะข้อมูลที่ฟอร์มใช้ ไม่ดึงเลขบัตร/ที่อยู่มาที่ browser โดยไม่จำเป็น
      const { data, error: searchError } = await supabase.rpc('search_users_for_staff_assignment', {
        p_municipality_id: tenant.id,
        p_search: query,
        p_limit: 10,
      })
      if (requestId !== searchSequence.current) return
      setSearching(false)
      setSearchedQuery(query)
      if (searchError) {
        setCandidates([])
        setError('ค้นหาบัญชีไม่สำเร็จ: ' + searchError.message)
        return
      }
      setError('')
      setCandidates((data ?? []).filter(item => item.id !== currentUserId && item.role !== 'superadmin'))
    }, 350)
    return () => {
      clearTimeout(timer)
      searchSequence.current += 1
    }
  }, [accountQuery, currentUserId, person, tenant.id, searchNonce])

  // ตำแหน่งเดิม สิทธิ์พัสดุ และชื่อตำแหน่งเก่า (job_title) ไม่อยู่ในแถวรายชื่อ อ่านแยกตอนเลือกคน
  useEffect(() => {
    if (!person?.id) return undefined
    let active = true
    supabase.from('profiles').select('position_id,asset_role,job_title,position:positions(name,category)').eq('id', person.id).maybeSingle()
      .then(({ data }) => { if (active) setExtras({ id: person.id, ...(data ?? {}) }) })
    return () => { active = false }
  }, [person?.id])
  const loaded = extras?.id === person?.id ? extras : null

  useEffect(() => {
    let active = true
    getEsignGateStatus(tenant.id).then(status => {
      if (!active) return
      setSignMode(status?.ok === false ? null : (esignAnyOnline(esignModesFromStatus(status)) ? 'online' : 'wet'))
    })
    return () => { active = false }
  }, [tenant.id])

  useEffect(() => {
    function closeLists(event) {
      if (positionBox.current && !positionBox.current.contains(event.target)) setPositionOpen(false)
    }
    document.addEventListener('mousedown', closeLists)
    return () => document.removeEventListener('mousedown', closeLists)
  }, [])

  const previousPositionId = person?.position_id ?? loaded?.position_id ?? null
  const previousPosition = useMemo(() => {
    if (!previousPositionId) return null
    const known = localPositions.find(item => item.id === previousPositionId)
    if (known) return known
    const name = loaded?.position?.name ?? person?.position_name
    return name ? { id: previousPositionId, name, category: loaded?.position?.category } : { id: previousPositionId, name: '' }
  }, [previousPositionId, localPositions, loaded, person])

  const position = useMemo(() => {
    if (!positionId) return null
    return localPositions.find(item => item.id === positionId)
      ?? (positionId === previousPosition?.id ? previousPosition : null)
  }, [positionId, localPositions, previousPosition])
  const activePosition = useMemo(() => {
    if (position) return position
    return newPositionName ? { name: newPositionName, ...positionTraitsFromName(newPositionName) } : null
  }, [position, newPositionName])
  const positionName = activePosition?.name ?? ''
  const executive = activePosition ? isExecutivePosition(activePosition) : false

  const lockedDepartmentId = position?.department_id
    || (newPositionName && isUnitHeadPositionName(newPositionName) ? departmentFromPositionName(newPositionName, localDepts) : null)
    || null
  const typedDepartment = newDepartmentName.trim().replace(/\s+/g, ' ')
  const showDepartmentInput = addingDepartment && !lockedDepartmentId
  const effectiveDepartmentId = lockedDepartmentId
    || (showDepartmentInput ? (typedDepartment ? NEW_DEPARTMENT : '') : departmentId)
    || ''
  const duplicateDepartment = showDepartmentInput && typedDepartment
    ? localDepts.find(item => positionSearchKey(item.name) === positionSearchKey(typedDepartment))
    : null
  const departmentName = effectiveDepartmentId === NEW_DEPARTMENT
    ? typedDepartment
    : (localDepts.find(item => item.id === effectiveDepartmentId)?.name ?? (effectiveDepartmentId === person?.department_id ? person?.department_name : '') ?? '')

  const headDefault = defaultDepartmentHead({ person, previousPosition, position: activePosition, departmentId: effectiveDepartmentId })
  const isHead = Boolean(effectiveDepartmentId) && (headOverride ?? headDefault)
  const appointmentChanged = Boolean(person) && (
    (position?.id ?? null) !== previousPositionId
    || Boolean(newPositionName)
    || effectiveDepartmentId !== (person.department_id ?? '')
    || isHead !== Boolean(person.is_dept_head)
  )
  const fromRole = person?.role ?? 'citizen'
  const proposedRole = proposedRoleForAppointment({ currentRole: fromRole, position: activePosition, asHead: isHead, appointmentChanged })
  const role = roleOverride ?? proposedRole
  const clearsAssignment = ['citizen', 'superadmin'].includes(role)

  const activeRows = useMemo(() => (registry?.rows ?? []).filter(row => isSignatoryActiveToday(row)), [registry?.rows])
  const slotDepartments = useMemo(() => {
    if (effectiveDepartmentId === NEW_DEPARTMENT) return [...localDepts, { id: NEW_DEPARTMENT, name: typedDepartment }]
    return localDepts
  }, [effectiveDepartmentId, localDepts, typedDepartment])
  const slots = useMemo(() => buildSignatorySlots(slotDepartments, activeRows, customLabels), [slotDepartments, activeRows, customLabels])
  const trimmedName = fullName.trim()
  const appointed = useMemo(() => ({
    id: person?.id,
    full_name: trimmedName,
    job_title: clearJobTitle ? null : (loaded?.job_title ?? null),
    position: activePosition ? { name: activePosition.name, category: activePosition.category } : null,
    department_id: effectiveDepartmentId || null,
  }), [person?.id, trimmedName, clearJobTitle, loaded?.job_title, activePosition, effectiveDepartmentId])
  const signingRows = useMemo(() => {
    if (!person) return []
    const before = {
      ...person,
      position: previousPosition ? { name: previousPosition.name, category: previousPosition.category } : null,
    }
    return personSigningRows({
      personId: person.id, before, after: appointed, rows: activeRows, slots, extraKeys, choices: signChoices,
    })
  }, [person, previousPosition, appointed, activeRows, slots, extraKeys, signChoices])
  const showSigning = Boolean(person) && !clearsAssignment && !registry?.loading && !registry?.error
  const pickableSlots = useMemo(() => slots
    .filter(slot => !signingRows.some(row => row.key === slot.key))
    .map(slot => {
      const assignment = activeRows.find(row => signatorySlotKey({ role: row.signatory_role, departmentId: row.department_id, customLabel: row.custom_label }) === slot.key)
      return { key: slot.key, label: slot.label, holder: assignment ? signatoryName(assignment) : '' }
    }), [slots, signingRows, activeRows])
  const signingTicked = showSigning ? signingRows.filter(row => row.checked) : []
  const signingToSet = signingTicked.filter(row => !row.held)
  const signingToClear = showSigning ? signingRows.filter(row => row.held && !row.checked) : []

  // คนอื่นในกองที่ติ๊กเป็นหัวหน้าอยู่ — เก็บคู่กับกองที่โหลดแล้วค่อยเทียบตอนอ่าน กันเห็นชื่อของกองก่อนหน้าค้างอยู่
  const headCheckDepartment = isHead && person && effectiveDepartmentId !== NEW_DEPARTMENT ? effectiveDepartmentId : null
  useEffect(() => {
    let active = true
    fetchOtherDepartmentHeads(headCheckDepartment, person?.id ?? null).then(rows => {
      if (active) setLoadedHeads({ department: headCheckDepartment, rows })
    })
    return () => { active = false }
  }, [headCheckDepartment, person?.id])
  const otherHeads = (headCheckDepartment && loadedHeads.department === headCheckDepartment ? loadedHeads.rows : [])
    .map(head => ({ ...head, canClear: canClearDepartmentHead(head, currentUserId, currentUserRole) }))

  const matchingPositions = useMemo(() => {
    const key = positionSearchKey(positionQuery)
    return key ? localPositions.filter(item => positionSearchKey(item.name).includes(key)) : []
  }, [localPositions, positionQuery])
  const positionGroups = useMemo(() => groupPositionsByDepartment(localPositions, localDepts).filter(group => group.items.length > 0), [localPositions, localDepts])
  const queryKey = positionSearchKey(positionQuery)
  const canAddPosition = queryKey.length >= 2 && !localPositions.some(item => positionSearchKey(item.name) === queryKey)
  const departmentNameOf = id => localDepts.find(item => item.id === id)?.name ?? 'กองอื่น'
  const hasPosition = Boolean(activePosition)

  const nameParts = splitThaiFullName(fullName)
  function setNamePart(key, value) {
    const next = { ...nameParts, [key]: value }
    setFullName(joinThaiFullName(next.title, next.first, next.last))
  }
  const showNameFields = nameOpen

  const jobTitle = loaded?.job_title?.trim() || ''
  const jobTitleDiffers = !clearJobTitle && hasPosition && Boolean(jobTitle) && jobTitle !== positionName

  // เหตุที่ยังบันทึกไม่ได้ — ขึ้นบนจอเสมอ มือถือไม่มี tooltip
  const reason = !person ? 'เลือกคนก่อน'
    : (isAdd && !hasPosition) ? 'ใส่ตำแหน่งก่อน'
      : duplicateDepartment ? 'กองนี้มีอยู่แล้ว เลือกจากรายการก่อน'
        : (hasPosition && (isAdd || appointmentChanged) && !clearsAssignment && !effectiveDepartmentId && !executive) ? 'เลือกกองก่อน'
          : (role === 'officer' && !effectiveDepartmentId) ? 'สิทธิ์หัวหน้ากองต้องมีกอง เลือกกองก่อน'
            : (signingToSet.length > 0 && !trimmedName) ? 'ใส่ชื่อก่อน จึงเป็นผู้ลงนามได้'
              : ''

  const snapshot = JSON.stringify({
    person: isAdd ? person?.id : null, fullName, account, positionId, newPositionName, departmentId, addingDepartment, typedDepartment,
    headOverride, keptHeads, roleOverride, assetRole, clearJobTitle, signChoices, extraKeys, titles,
  })
  const [initialSnapshot] = useState(snapshot)
  const dirty = snapshot !== initialSnapshot

  function requestClose() {
    if (saving) return
    if (dirty && !savedWithProblems && !window.confirm('ยังไม่ได้บันทึก ต้องการออกจากหน้านี้ไหม')) return
    onClose()
  }

  function chooseAccount(next) {
    setPerson(next)
    setFullName(next.full_name || '')
    setNameOpen(nameIsIncomplete(next.full_name))
    setAccountQuery('')
    setCandidates([])
    setRoleOverride(null)
    setError('')
    // คนที่มีกองอยู่แล้ว คงกองเดิมไว้ก่อนถ้าแอดมินยังไม่ได้เลือกเอง ไม่ย้ายกองโดยไม่ตั้งใจ (ตำแหน่งที่ล็อกกองบังคับเอง และฟอร์มเตือนว่าย้าย)
    if ((!departmentId || departmentAuto) && next.department_id) {
      setDepartmentId(next.department_id)
      setDepartmentAuto(false)
    }
  }

  function changePerson() {
    setPerson(null)
    setExtras(null)
    setFullName('')
    setNameOpen(false)
    setRoleOverride(null)
    setRoleOpen(false)
    setAssetRole(null)
    setClearJobTitle(false)
    setSignChoices({})
    setExtraKeys([])
    setCustomLabels([])
    setTitles({})
    setKeptHeads([])
    setError('')
  }

  function stopAddingDepartment() {
    setAddingDepartment(false)
    setNewDepartmentName('')
    setNewDepartmentAuto(false)
  }

  function resetAfterPositionChange() {
    setHeadOverride(null)
    setRoleOverride(null)
    setClearJobTitle(false)
    setError('')
  }

  function choosePosition(next) {
    setPositionId(next.id)
    setNewPositionName('')
    setPositionQuery(next.name)
    setPositionOpen(false)
    resetAfterPositionChange()
    const typingDepartment = addingDepartment && !newDepartmentAuto
    if (newDepartmentAuto) stopAddingDepartment()
    if (next.department_id) {
      setDepartmentId(next.department_id)
      setDepartmentAuto(true)
      stopAddingDepartment()
    } else if (!typingDepartment && (!departmentId || departmentAuto)) {
      const home = person?.department_id || suggestedDepartmentId(next, localDepts) || initial?.departmentId || ''
      setDepartmentId(home)
      setDepartmentAuto(Boolean(home) && !person?.department_id)
    }
  }

  function addNewPosition() {
    const name = prettyPositionName(positionQuery)
    if (name.length < 2) return
    setPositionId('')
    setNewPositionName(name)
    setPositionQuery(name)
    setPositionOpen(false)
    resetAfterPositionChange()
    const typingDepartment = addingDepartment && !newDepartmentAuto
    if (newDepartmentAuto) stopAddingDepartment()
    if (departmentId && !departmentAuto) return
    const guess = departmentFromPositionName(name, localDepts)
    if (guess) {
      setDepartmentId(guess)
      setDepartmentAuto(true)
      return
    }
    const proposal = proposedDepartmentName(name)
    if (proposal && !typingDepartment) {
      setDepartmentId('')
      setDepartmentAuto(false)
      setAddingDepartment(true)
      setNewDepartmentName(proposal)
      setNewDepartmentAuto(true)
    }
  }

  function typePosition(value) {
    setPositionQuery(value)
    setPositionId('')
    setNewPositionName('')
    setPositionOpen(true)
    resetAfterPositionChange()
    if (departmentAuto) {
      setDepartmentId('')
      setDepartmentAuto(false)
    }
    if (newDepartmentAuto) stopAddingDepartment()
  }

  function clearPosition() {
    typePosition('')
  }

  function changeDepartment(value) {
    setError('')
    setHeadOverride(null)
    if (value === '__new') {
      setDepartmentId('')
      setDepartmentAuto(false)
      setAddingDepartment(true)
      setNewDepartmentAuto(false)
      return
    }
    stopAddingDepartment()
    setDepartmentId(value)
    setDepartmentAuto(false)
  }

  async function makeShared() {
    if (!position?.department_id || sharing) return
    const ok = window.confirm(
      `เปลี่ยน "${position.name}" เป็นตำแหน่งที่ใช้ได้ทุกกอง?\n\n`
      + `ผู้ถือตำแหน่งนี้ทุกคนยังอยู่กองเดิม ไม่มีใครถูกย้าย\n"${position.department_hint || 'กองเดิม'}" จะเป็นกองที่ระบบเติมให้ แต่เปลี่ยนได้`,
    )
    if (!ok) return
    setSharing(true)
    setError('')
    const { error: shareError } = await makePositionShared(supabase, tenant.id, position)
    setSharing(false)
    if (shareError) {
      setError(/changed|reload|concurrent/i.test(shareError.message)
        ? 'ข้อมูลตำแหน่งเปลี่ยนระหว่างทำรายการ กรุณาลองใหม่อีกครั้ง'
        : 'เปลี่ยนไม่สำเร็จ: ' + shareError.message)
      onStructureChanged?.()
      return
    }
    setSharedPositionIds(current => [...current, position.id])
    setDepartmentId(position.department_id)
    setDepartmentAuto(false)
    onStructureChanged?.()
  }

  function pickSlot(key) {
    setExtraKeys(current => (current.includes(key) ? current : [...current, key]))
    setSignChoices(current => ({ ...current, [key]: true }))
  }

  function addCustomSlot(label) {
    setCustomLabels(current => (current.includes(label) ? current : [...current, label]))
    pickSlot(signatorySlotKey({ role: 'custom', customLabel: label }))
  }

  // ชื่อผู้ใช้เปลี่ยนผ่าน edge function คนละทางกับการบันทึกอื่น · บัญชีที่กรอกเบอร์แปลงเป็นอีเมลภายใน ไม่เปิดเผยรูปแบบนี้บนหน้าจอ
  async function saveLoginIfChanged() {
    const loginInput = account.email.trim()
    const isEmailLogin = loginInput.includes('@')
    const normalizedLoginPhone = isEmailLogin ? '' : normalizeThaiPhone(loginInput)
    if (loginInput && isEmailLogin && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginInput) || loginInput.length > 254)) {
      return 'กรุณากรอกอีเมลสำหรับเข้าสู่ระบบให้ถูกต้อง'
    }
    if (loginInput && !isEmailLogin && !/^0\d{8,9}$/.test(normalizedLoginPhone)) {
      return 'ชื่อผู้ใช้ต้องเป็นเบอร์มือถือ 9–10 หลัก หรืออีเมลที่ถูกต้อง'
    }
    const newEmail = isEmailLogin ? loginInput.toLowerCase() : (loginInput ? phoneToLoginEmail(normalizedLoginPhone) : '')
    const newLoginLabel = isEmailLogin ? newEmail : normalizedLoginPhone
    if (!newEmail || newEmail === (user.email || '').toLowerCase()) return ''
    // บัญชีที่ยังไม่เคยมีอีเมล (สมัครด้วย LINE) ไม่มี "อีเมลเดิม" ให้เสีย — เป็นการเพิ่มทางเข้า
    // ไม่ใช่การเปลี่ยน ถ้าใช้ข้อความเตือนอันเดียวกันเจ้าหน้าที่จะลังเลไม่กล้ากดทั้งที่ไม่มีอะไรเสีย
    const label = user.full_name || user.email || 'บัญชีนี้'
    const message = user.email
      ? `ยืนยันเปลี่ยนชื่อผู้ใช้สำหรับเข้าสู่ระบบของ "${label}" เป็น "${newLoginLabel}"?\n\nชื่อผู้ใช้เดิมจะใช้เข้าสู่ระบบไม่ได้อีกทันที`
      : `ยืนยันตั้งชื่อผู้ใช้ของ "${label}" เป็น "${newLoginLabel}"?\n\nช่องทางเดิม (LINE/Google) ยังใช้เข้าได้ตามปกติ\nขั้นถัดไปให้กด "ตั้งรหัสผ่านใหม่" แล้วพิมพ์บัตรให้เจ้าตัว`
    if (!window.confirm(message)) return 'ยกเลิก'
    const result = await updateUserEmail(user, newEmail)
    if (result.ok) return ''
    // ข้อความจาก GoTrue เป็นภาษาอังกฤษ เคสที่เจ้าหน้าที่เจอบ่อยสุดคือเบอร์ซ้ำกับบัญชีอื่น
    // (คนเดียวกันมีทั้งบัญชี LINE และบัญชีเบอร์โทร) ซึ่งต้องไปยุบบัญชีรวมกันแทน ไม่ใช่ตั้งซ้ำ
    return /already been registered|already exists|duplicate/i.test(result.error || '')
      ? 'ชื่อผู้ใช้นี้มีบัญชีอื่นใช้อยู่แล้ว — น่าจะเป็นคนเดียวกันที่มีสองบัญชี ให้ใช้ "รวมบัญชีซ้ำ" แทน'
      : 'เปลี่ยนชื่อผู้ใช้ไม่สำเร็จ: ' + result.error
  }

  async function save(next = false) {
    if (reason || saving || !canEdit) return
    if (!isAdd && account.id_card && !/^\d{13}$/.test(account.id_card)) {
      setError('เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก')
      return
    }
    setSaving(true)
    setError('')
    const items = []
    // ทำตามลำดับ และจำสิ่งที่สร้างแล้วลงฟอร์มทันที กดบันทึกซ้ำหลังล้มกลางทางจึงไม่สร้างกองหรือตำแหน่งซ้ำ
    let targetDepartmentId = effectiveDepartmentId
    if (effectiveDepartmentId === NEW_DEPARTMENT) {
      const { data, error: departmentError } = await createDepartment(supabase, tenant.id, { name: typedDepartment, sortOrder: localDepts.length })
      if (departmentError) {
        setSaving(false)
        setError('เพิ่มกองไม่สำเร็จ: ' + departmentError.message)
        return
      }
      targetDepartmentId = data.id
      setCreatedDepts(current => [...current, data])
      setDepartmentId(data.id)
      stopAddingDepartment()
      onStructureChanged?.()
      items.push(`เพิ่มกอง “${data.name}” เข้ารายชื่อให้แล้ว`)
    }
    const targetDepartmentName = localDepts.find(item => item.id === targetDepartmentId)?.name ?? typedDepartment ?? null
    let targetPosition = position
    if (!position && newPositionName) {
      const { data, error: positionError } = await createPosition(supabase, tenant.id, {
        name: newPositionName, departmentId: targetDepartmentId || null, departmentName: targetDepartmentName || null,
      })
      if (positionError) {
        setSaving(false)
        setError(positionError.code === '23505'
          ? `มีตำแหน่งชื่อ “${newPositionName}” อยู่แล้ว กรุณาเลือกจากรายการ`
          : 'เพิ่มตำแหน่งไม่สำเร็จ: ' + positionError.message)
        return
      }
      targetPosition = data
      setCreatedPositions(current => [...current, data])
      setPositionId(data.id)
      setNewPositionName('')
      onStructureChanged?.()
      items.push(`เพิ่มตำแหน่ง “${data.name}” เข้ารายชื่อให้แล้ว`)
    }

    if (!isAdd) {
      const loginProblem = await saveLoginIfChanged()
      if (loginProblem) {
        setSaving(false)
        if (loginProblem !== 'ยกเลิก') setError(loginProblem)
        return
      }
    }

    const changes = {
      role,
      position_id: targetPosition?.id ?? null,
      department_id: targetDepartmentId || null,
      is_dept_head: targetDepartmentId ? isHead : false,
    }
    if (trimmedName !== (person.full_name || '')) changes.full_name = trimmedName || null
    if (clearJobTitle) changes.job_title = null
    if (!isAdd) {
      const before = initialAccountDraft(user, tenant)
      if (account.phone !== before.phone) changes.phone = account.phone.trim() || null
      if (account.id_card !== before.id_card) changes.id_card = account.id_card.trim() || null
      // ที่อยู่เติมจังหวัด/อำเภอของ อปท. ให้เป็นค่าเริ่มต้น ถ้าแก้ส่วนใดต้องส่งครบ ไม่งั้นค่าที่เห็นบนจอไม่ถูกบันทึก
      const addressKeys = ['address_province', 'address_district', 'address_subdistrict', 'address_moo', 'address_detail']
      if (addressKeys.some(key => account[key] !== before[key])) {
        for (const key of addressKeys) changes[key] = account[key].trim() || null
      }
    }
    // ส่งสิทธิ์พัสดุเฉพาะตอนแอดมินเปลี่ยน · asset_staff ต้องมีสังกัด ไม่งั้นถือสิทธิ์แต่มองไม่เห็นของสักชิ้น — ฐานข้อมูลปฏิเสธอยู่แล้ว
    if (assetRole !== null) changes.asset_role = (assetRole === 'asset_staff' && !targetDepartmentId) ? null : (assetRole || null)

    const result = await saveUserEdits(person, changes)
    if (!result.ok) {
      setSaving(false)
      setError(result.error)
      return
    }

    const realSlot = slot => (slot.departmentId === NEW_DEPARTMENT ? { ...slot, departmentId: targetDepartmentId } : slot)
    const offers = signingToSet.map(row => {
      const slot = realSlot(row.slot)
      const typedTitle = titles[row.key]?.trim()
      return {
        ...signatoryChangeFor(slot, row.assignment, appointed),
        titleOverride: !row.proposed && typedTitle && typedTitle !== positionName ? typedTitle : null,
      }
    })
    const clearHeads = otherHeads.filter(head => head.canClear && !keptHeads.includes(head.id))
    const clearSlots = signingToClear.map(row => ({
      role: row.slot.role, departmentId: row.slot.departmentId, customLabel: row.slot.customLabel ?? null, label: row.slot.label,
    }))
    const { problems, clearedHeadIds } = await finishAppointment({ municipalityId: tenant.id, offers, clearHeads, clearSlots })
    if (clearedHeadIds.length) onHeadsCleared?.(clearedHeadIds)
    if (offers.length || clearSlots.length) registry?.reload?.()
    setSaving(false)

    if (problems.length) {
      setSavedWithProblems(true)
      setError(`แต่งตั้งแล้ว แต่ ${problems.join(' · ')} — ทำต่อได้ที่เมนูการลงนามเอกสาร`)
      return
    }
    items.push(`${targetPosition?.name ?? 'ไม่ระบุตำแหน่ง'} · ${targetDepartmentName || 'ไม่สังกัดกอง'}${changes.is_dept_head ? ' · หัวหน้ากอง' : ''}`)
    items.push(`สิทธิ์: ${ROLE_LABELS[role]?.label ?? role}`)
    for (const head of clearHeads) items.push(`เอาสถานะหัวหน้ากองของ ${head.full_name || 'คนเดิม'} ออกแล้ว`)
    for (const offer of offers) items.push(`ผู้ลงนามช่อง ${offer.label}${offer.titleOverride ? ` · พิมพ์ใต้ชื่อว่า ${offer.titleOverride}` : ''}`)
    for (const slot of clearSlots) items.push(`เอาชื่อออกจากช่อง ${slot.label}`)
    onSaved?.({
      userId: person.id,
      next,
      flash: {
        name: trimmedName || person.email || 'บัญชีนี้',
        items,
        after: signMode === 'online' && offers.length > 0 ? 'ลงนามออนไลน์: เจ้าตัวต้องตั้งรหัสลงนามและเพิ่มลายเซ็นเองที่เมนูลายเซ็นของฉัน' : '',
      },
    })
  }

  const roleOptions = [
    { value: 'citizen', label: 'ประชาชน — ใช้บริการประชาชนเท่านั้น' },
    { value: 'staff', label: 'เจ้าหน้าที่ — ใช้เมนูงานที่ได้รับมอบหมาย' },
    { value: 'viewer', label: 'ผู้บริหาร — ดูภาพรวมและข้อมูลประกอบการตัดสินใจ' },
    { value: 'council', label: `${ROLE_LABELS.council.label} — ดูงานที่เกี่ยวข้องกับสภา` },
    { value: 'officer', label: 'หัวหน้ากอง — จัดการงานของกองที่สังกัด' },
    { value: 'technician', label: 'ปฏิบัติงาน — บันทึกงานที่รับผิดชอบ' },
    ...(currentUserRole === 'superadmin' ? [
      { value: 'admin', label: 'แอดมินระบบ — ดูแลทั้งเทศบาล' },
      { value: 'superadmin', label: 'Super Admin — ดูแลทุกเทศบาล' },
    ] : []),
    ...(['admin', 'superadmin'].includes(fromRole) && currentUserRole !== 'superadmin'
      ? [{ value: fromRole, label: ROLE_LABELS[fromRole]?.label ?? fromRole }] : []),
  ]
  const assetRoleValue = assetRole ?? loaded?.asset_role ?? ''
  const readOnlyReason = !canEdit && user
    ? (user.id === currentUserId
        ? 'นี่คือบัญชีของคุณ ระบบไม่ให้แอดมินแก้ตำแหน่งหรือสิทธิ์ของตัวเอง ถ้าต้องเปลี่ยนให้ Super Admin ทำให้ ส่วนรหัสผ่านและลายเซ็นแก้ได้ที่หน้าโปรไฟล์'
        : 'บัญชีนี้แก้ได้เฉพาะ Super Admin หน้านี้จึงดูได้อย่างเดียว')
    : ''

  const signingLabels = signingTicked.map(row => row.slot.label)
  const footer = (
    <div className="space-y-2">
      {canEdit && (reason
        ? <p className="text-xs font-bold leading-5 text-amber-800" data-person-reason>{reason}จึงบันทึกได้</p>
        : (
          <p className="text-xs leading-5 text-slate-700" data-person-summary>
            <span className="font-bold">จะบันทึก:</span> {trimmedName || person?.email || 'บัญชีนี้'}
            {positionName ? ` · ${positionName}` : ''} · {departmentName || 'ไม่สังกัดกอง'}{isHead ? ' · หัวหน้ากอง' : ''} · สิทธิ์{ROLE_LABELS[role]?.label ?? role}
            {signingLabels.length ? ` · ผู้ลงนาม ${signingLabels.join(', ')}` : ''}
          </p>
        ))}
      {savedWithProblems || !canEdit ? (
        <button type="button" onClick={() => (savedWithProblems ? onSaved?.({ userId: person?.id, next: false, flash: null }) : onClose())}
          className="min-h-11 w-full rounded-xl bg-slate-800 px-4 text-sm font-bold text-white" data-person-close>
          ปิด
        </button>
      ) : (
        <div className={`grid gap-1.5 ${isAdd ? 'grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-[auto_minmax(0,1fr)]'}`}>
          <button type="button" onClick={requestClose} disabled={saving}
            className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-50">
            ยกเลิก
          </button>
          {isAdd && (
            <button type="button" onClick={() => save(true)} disabled={Boolean(reason) || saving} data-person-save-next
              className="min-h-11 rounded-xl border border-blue-500 bg-white px-3 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40">
              บันทึก แล้วเพิ่มคนต่อ
            </button>
          )}
          <button type="button" onClick={() => save(false)} disabled={Boolean(reason) || saving} data-person-save
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40 ${isAdd ? 'col-span-2 sm:col-span-1' : ''}`}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      )}
    </div>
  )

  const headerActions = !isAdd && (
    <div className="grid grid-cols-2 gap-1.5 border-b border-slate-100 px-4 py-2.5 md:px-5" data-person-actions>
      {canEdit && user.role !== 'citizen' && (
        <button type="button" onClick={() => actions.onHandover?.(user)}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-orange-100 bg-orange-50/70 px-2 text-xs font-bold text-orange-700 hover:bg-orange-100">
          <Repeat size={14} className="shrink-0" /> โอนงานให้ผู้อื่น
        </button>
      )}
      {['admin', 'superadmin'].includes(currentUserRole) && (
        <button type="button" onClick={() => actions.onMerge?.(user)}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-violet-100 bg-violet-50/70 px-2 text-xs font-bold text-violet-700 hover:bg-violet-100">
          <Users size={14} className="shrink-0" /> รวมบัญชีซ้ำ
        </button>
      )}
      {canEdit && (
        <button type="button" onClick={() => actions.onResetPassword?.(user)}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-amber-100 bg-amber-50/70 px-2 text-xs font-bold text-amber-800 hover:bg-amber-100">
          <KeyRound size={14} className="shrink-0" /> ตั้งรหัสผ่านใหม่
        </button>
      )}
      {canEdit && (
        <button type="button" onClick={() => actions.onDelete?.(user)}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-red-100 bg-red-50/70 px-2 text-xs font-bold text-red-700 hover:bg-red-100">
          <Trash2 size={14} className="shrink-0" /> ลบผู้ใช้งาน
        </button>
      )}
    </div>
  )

  const showNoAccount = isAdd && !person && !searching && searchedQuery.length >= 2
    && searchedQuery === accountQuery.trim() && candidates.length === 0 && !error

  return (
    <SigningDialogShell
      variant="drawer"
      testId="person-setup-form"
      title={isAdd ? 'เพิ่มเจ้าหน้าที่' : 'รายละเอียดผู้ใช้งาน'}
      subtitle={isAdd ? 'ใส่คนกับตำแหน่ง ระบบเติมที่เหลือให้ตรวจก่อนบันทึก' : null}
      backLabel={isAdd ? null : 'ย้อนกลับ'}
      closeDisabled={saving || nestedOpen}
      onClose={requestClose}
      headerExtra={headerActions}
      footer={footer}
    >
      <div className="space-y-5" data-person-form={isAdd ? 'add' : 'edit'}>
        {readOnlyReason && (
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-700" data-person-read-only>{readOnlyReason}</p>
        )}
        <fieldset disabled={!canEdit || saving} className="m-0 min-w-0 space-y-5 border-0 p-0">
          {/* ใคร */}
          <section>
            <h3 className={`${sectionTitleClass} mb-2`}>ใคร</h3>
            {!person ? (
              <>
                <label htmlFor="person-account-search" className={labelClass}>ค้นหาบัญชี</label>
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input id="person-account-search" value={accountQuery} autoFocus
                    onChange={event => {
                      setAccountQuery(event.target.value)
                      setCandidates([])
                      setSearching(false)
                      setSearchedQuery('')
                      setError('')
                    }}
                    placeholder="พิมพ์ชื่อ เบอร์โทร หรืออีเมล อย่างน้อย 2 ตัวอักษร"
                    className={`${fieldClass} pl-9 pr-10`} />
                  {searching && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-blue-500" />}
                </div>
                {candidates.length > 0 && (
                  <div className="mt-2 max-h-52 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg">
                    {candidates.map(item => (
                      <button key={item.id} type="button" onClick={() => chooseAccount(item)}
                        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-blue-50">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-black text-slate-500">
                          {(item.full_name || '?')[0]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-slate-700">{item.full_name || 'ยังไม่ระบุชื่อ'}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {item.phone || loginIdentifier(item.email).value || 'ไม่มีเบอร์ติดต่อ'} · {ROLE_LABELS[item.role]?.label ?? item.role}{item.department_name ? ` · ${item.department_name}` : ''}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {showNoAccount && (
                  <NoAccountPanel query={searchedQuery} onOpenSigning={onOpenSigning}
                    onRetry={() => { setSearchedQuery(''); setSearchNonce(value => value + 1) }} />
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2" data-person-chosen>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-bold text-emerald-800">{trimmedName || person.email || 'บัญชีที่เลือก'}</p>
                    <p className="break-words text-xs text-emerald-700">
                      {ROLE_LABELS[person.role]?.label ?? person.role}
                      {person.department_name ? ` · ${person.department_name}` : ''}
                      {person.phone ? ` · ${person.phone}` : ''}
                    </p>
                  </div>
                  {canEdit && !showNameFields && (
                    <button type="button" onClick={() => setNameOpen(true)} className="min-h-11 shrink-0 rounded-lg px-1.5 text-xs font-bold text-blue-700 underline">แก้ชื่อ</button>
                  )}
                  {isAdd && canEdit && (
                    <button type="button" onClick={changePerson} className="min-h-11 shrink-0 rounded-lg px-1.5 text-xs font-bold text-blue-700 underline" data-person-change>เปลี่ยนคน</button>
                  )}
                </div>
                {showNameFields && (
                  <div className="mt-2">
                    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-1.5 sm:grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)]">
                      <div>
                        <label htmlFor="person-name-title" className={labelClass}>คำนำหน้า</label>
                        <select id="person-name-title" value={nameParts.title} onChange={event => setNamePart('title', event.target.value)} className={fieldClass}>
                          <option value="">เลือก</option>
                          {NAME_TITLES.map(title => <option key={title} value={title}>{title}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="person-name-first" className={labelClass}>ชื่อ</label>
                        <input id="person-name-first" value={nameParts.first} onChange={event => setNamePart('first', event.target.value)} className={fieldClass} />
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <label htmlFor="person-name-last" className={labelClass}>นามสกุล</label>
                        <input id="person-name-last" value={nameParts.last} onChange={event => setNamePart('last', event.target.value)} className={fieldClass} />
                      </div>
                    </div>
                    <p className={`mt-1 text-xs leading-5 ${nameParts.title && nameParts.last ? 'text-slate-500' : 'font-semibold text-amber-800'}`} data-person-name-note>
                      {nameParts.title && nameParts.last ? 'ชื่อนี้พิมพ์บนเอกสาร' : 'ชื่อยังไม่ครบ ชื่อจาก LINE หรือ Google มักไม่มีคำนำหน้า เอกสารจะพิมพ์ชื่อไม่ครบ'}
                    </p>
                  </div>
                )}
              </>
            )}
          </section>

          {/* การแต่งตั้ง */}
          <section>
            <h3 className={`${sectionTitleClass} mb-2`}>การแต่งตั้ง</h3>
            <div className="space-y-3">
              <div ref={positionBox}>
                <label htmlFor="person-position" className={labelClass}>ตำแหน่ง</label>
                <div className="relative">
                  <input id="person-position" value={positionQuery} autoComplete="off"
                    onChange={event => typePosition(event.target.value)}
                    onFocus={() => { if (!hasPosition) setPositionOpen(true) }}
                    onKeyDown={event => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      if (hasPosition) return
                      const exact = localPositions.find(item => positionSearchKey(item.name) === queryKey)
                      if (exact) choosePosition(exact)
                      else if (canAddPosition) addNewPosition()
                    }}
                    placeholder="พิมพ์ชื่อตำแหน่ง เช่น ธุรการ หรือ ผอ.กองคลัง"
                    className={`${fieldClass} pr-11`} />
                  {hasPosition && canEdit && (
                    <button type="button" onClick={clearPosition} aria-label="ล้างตำแหน่ง" data-person-position-clear
                      className="absolute right-0 top-0 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-400 hover:text-slate-700">
                      <X size={16} />
                    </button>
                  )}
                </div>
                {!hasPosition && !positionOpen && (
                  <p className="mt-1 text-xs leading-5 text-slate-500">ไม่มีในรายการ พิมพ์ชื่อแล้วกดเพิ่มได้เลย</p>
                )}
                {newPositionName && (
                  <p className="mt-1 text-xs leading-5 text-slate-600" data-person-new-position>
                    <AutoTag>ตำแหน่งใหม่</AutoTag> ระบบเพิ่มเข้ารายชื่อให้ตอนบันทึก
                  </p>
                )}
                {!hasPosition && positionOpen && (
                  <div className="mt-2 max-h-72 space-y-0.5 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg" data-person-position-list>
                    {queryKey
                      ? matchingPositions.map(item => (
                        <button key={item.id} type="button" onClick={() => choosePosition(item)} data-person-position-option={item.id}
                          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-blue-50">
                          <span className="min-w-0 text-sm font-semibold text-slate-700">{item.name}</span>
                          <span className="shrink-0 text-xs text-slate-500">{item.department_id ? departmentNameOf(item.department_id) : (item.department_hint || 'ใช้ได้ทุกกอง')}</span>
                        </button>
                      ))
                      : positionGroups.map(group => (
                        <div key={group.key}>
                          <p className="px-3 pb-0.5 pt-1.5 text-xs font-bold text-slate-500">{group.label}</p>
                          {group.items.map(item => (
                            <button key={item.id} type="button" onClick={() => choosePosition(item)} data-person-position-option={item.id}
                              className="flex min-h-11 w-full items-center rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-blue-50">
                              {item.name}
                            </button>
                          ))}
                        </div>
                      ))}
                    {canAddPosition && (
                      <button type="button" onClick={addNewPosition} data-person-position-new
                        className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-left text-sm font-bold text-blue-700 hover:bg-blue-100">
                        <Plus size={16} className="shrink-0" /> เพิ่มตำแหน่งใหม่ “{prettyPositionName(positionQuery)}”
                      </button>
                    )}
                    {!queryKey && <p className="px-3 py-1.5 text-xs font-semibold text-slate-500">ไม่มีในรายการ พิมพ์ชื่อแล้วกดเพิ่มได้เลย</p>}
                  </div>
                )}
                {jobTitleDiffers && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs leading-5 text-amber-800" data-person-job-title>
                    <span>เอกสารของคนนี้พิมพ์ตำแหน่งว่า “{jobTitle}” (ข้อมูลเก่า)</span>
                    {canEdit && (
                      <button type="button" onClick={() => setClearJobTitle(true)} className="min-h-11 font-bold underline">ใช้ “{positionName}” แทน</button>
                    )}
                  </div>
                )}
                {clearJobTitle && (
                  <p className="mt-1.5 text-xs leading-5 text-slate-600" data-person-job-title-cleared>เอกสารจะพิมพ์ตำแหน่งว่า “{positionName}” หลังบันทึก</p>
                )}
              </div>

              {hasPosition && !clearsAssignment && (
                <div>
                  <label htmlFor="person-department" className={labelClass}>
                    กอง
                    {lockedDepartmentId ? <AutoTag>ระบบเติมให้</AutoTag> : (departmentAuto && departmentId ? <AutoTag>ระบบเติมให้</AutoTag> : null)}
                  </label>
                  <select id="person-department" disabled={Boolean(lockedDepartmentId)}
                    value={lockedDepartmentId || (showDepartmentInput ? '__new' : departmentId)}
                    onChange={event => changeDepartment(event.target.value)} className={fieldClass}>
                    <option value="">{executive ? '— ไม่สังกัดกอง —' : '— เลือกกอง —'}</option>
                    {localDepts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    {person?.department_id && !localDepts.some(item => item.id === person.department_id) && (
                      <option value={person.department_id}>{person.department_name || 'กองเดิม'} (ปิดใช้งาน)</option>
                    )}
                    <option value="__new">+ เพิ่มกองใหม่</option>
                  </select>
                  {lockedDepartmentId && (
                    <div className="mt-1 text-xs leading-5 text-slate-600">
                      ตำแหน่งนี้มีได้กองเดียว
                      {position?.department_id && canEdit && (
                        <button type="button" onClick={makeShared} disabled={sharing} data-person-make-shared
                          className="ml-1 inline-flex min-h-11 items-center gap-1 font-bold text-blue-700 underline disabled:opacity-50">
                          {sharing && <Loader2 size={13} className="animate-spin" />} ตำแหน่งนี้มีหลายกอง — เปลี่ยนเป็นใช้ได้ทุกกอง
                        </button>
                      )}
                    </div>
                  )}
                  {showDepartmentInput && (
                    <div className="mt-2" data-person-new-department>
                      <label htmlFor="person-new-department" className={labelClass}>
                        ชื่อกองใหม่{newDepartmentAuto && <AutoTag>ระบบเสนอจากชื่อตำแหน่ง</AutoTag>}
                      </label>
                      <input id="person-new-department" value={newDepartmentName} autoComplete="off"
                        onChange={event => { setNewDepartmentName(event.target.value); setNewDepartmentAuto(false) }}
                        placeholder="เช่น กองสาธารณสุข" className={fieldClass} />
                      <p className={`mt-1 text-xs leading-5 ${duplicateDepartment ? 'font-semibold text-amber-800' : 'text-slate-600'}`}>
                        {duplicateDepartment
                          ? 'มีกองชื่อนี้อยู่แล้ว เลือกจากรายการด้านบน'
                          : 'ระบบเพิ่มกองให้ตอนบันทึก กองนี้จะขึ้นในทุกเมนูของระบบ และมีช่องผู้ลงนามเพิ่ม 1 ช่อง'}
                      </p>
                    </div>
                  )}
                  {person?.department_id && effectiveDepartmentId && effectiveDepartmentId !== person.department_id && (
                    <p className="mt-1 text-xs font-semibold leading-5 text-amber-800" data-person-moving>
                      คนนี้สังกัด {person.department_name || 'กองอื่น'} อยู่ การบันทึกครั้งนี้จะย้ายมา{departmentName || 'กองที่เลือก'} และยกเลิกสถานะหัวหน้ากองเดิม (ถ้ามี)
                    </p>
                  )}
                </div>
              )}

              {hasPosition && !clearsAssignment && effectiveDepartmentId && (
                <div>
                  <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm leading-5 text-slate-800" data-person-head>
                    <input type="checkbox" checked={isHead} onChange={event => setHeadOverride(event.target.checked)}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-blue-600" />
                    <span className="min-w-0">
                      <span className="font-semibold">เป็นหัวหน้ากองนี้</span>
                      {headOverride === null && isHead && isDepartmentHeadPosition(activePosition) && appointmentChanged && <AutoTag>ระบบติ๊กให้</AutoTag>}
                      <span className="mt-0.5 block text-xs leading-5 text-slate-600">
                        อนุมัติกิจกรรมของกอง และขึ้นชื่อก่อนในรายการมอบหมายงาน ไม่เกี่ยวกับการลงนามเอกสาร
                      </span>
                    </span>
                  </label>
                  <OtherHeadsChoices otherHeads={otherHeads} keptHeads={keptHeads} onToggleHead={id => setKeptHeads(current => toggleIn(current, id))} />
                </div>
              )}

              {user?.staff_name && (
                <div className="text-xs leading-5 text-slate-600" data-person-public-staff>
                  ผูกกับข้อมูลสาธารณะ (หน้าเว็บ): <span className="font-semibold">{user.staff_name}{user.staff_title ? ` (${user.staff_title})` : ''}</span>
                </div>
              )}
            </div>
          </section>

          {/* สิทธิ์การใช้งาน */}
          {person && (hasPosition || !isAdd) && (
            <section data-person-role>
              <h3 className={`${sectionTitleClass} mb-1`}>สิทธิ์การใช้งาน</h3>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {ROLE_LABELS[role]?.label ?? role}
                    {roleOverride === null && role !== fromRole && <AutoTag>ตามตำแหน่ง</AutoTag>}
                  </p>
                  <p className="text-xs leading-5 text-slate-600">{ROLE_DESCRIPTIONS[role] ?? ''}</p>
                  {role !== fromRole && (
                    <p className="text-xs font-semibold leading-5 text-amber-800" data-person-role-change>
                      จากเดิม “{ROLE_LABELS[fromRole]?.label ?? fromRole}” จะเปลี่ยนเมื่อกดบันทึก
                    </p>
                  )}
                  {role === 'officer' && !isHead && (
                    <p className="text-xs font-semibold leading-5 text-amber-800" data-person-role-kept>
                      คนนี้ไม่ได้เป็นหัวหน้ากอง แต่สิทธิ์ยังเห็นงานของทั้งกอง กด “เปลี่ยน” ถ้าต้องลดสิทธิ์
                    </p>
                  )}
                  {role === 'citizen' && fromRole !== 'citizen' && (
                    <p className="text-xs font-semibold leading-5 text-amber-800">บันทึกแล้วจะล้างตำแหน่งและกองของคนนี้</p>
                  )}
                </div>
                {canEdit && (
                  <button type="button" onClick={() => setRoleOpen(value => !value)} aria-expanded={roleOpen} data-person-role-open
                    className="min-h-11 shrink-0 rounded-lg px-1.5 text-xs font-bold text-blue-700 underline">
                    {roleOpen ? 'ปิด' : 'เปลี่ยน'}
                  </button>
                )}
              </div>
              {(roleOpen || !canEdit) && (
                <div className="mt-2 space-y-3">
                  <div>
                    <label htmlFor="person-role" className={labelClass}>บทบาทและสิทธิ์ระบบ</label>
                    <select id="person-role" value={role} onChange={event => setRoleOverride(event.target.value)} className={fieldClass}>
                      {roleOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    {currentUserRole !== 'superadmin' && <p className="mt-1 text-xs leading-5 text-slate-500">แอดมินระบบตั้งได้เฉพาะ Super Admin</p>}
                  </div>
                  {!['citizen', 'superadmin'].includes(role) && (
                    <div>
                      <label htmlFor="person-asset-role" className={labelClass}>สิทธิ์โมดูลยืมพัสดุ/ครุภัณฑ์</label>
                      <select id="person-asset-role" value={assetRoleValue} onChange={event => setAssetRole(event.target.value)} className={fieldClass}>
                        {ASSET_ROLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                      {assetRoleValue === 'asset_staff' && !effectiveDepartmentId && (
                        <p className="mt-1 text-xs font-semibold leading-5 text-amber-800">ต้องเลือกกองก่อน เพราะสิทธิ์นี้จำกัดอยู่ที่กองที่สังกัด</p>
                      )}
                      <p className="mt-1 text-xs leading-5 text-slate-500">สิทธิ์ยานพาหนะและพนักงานขับรถ ตั้งที่เมนูยานพาหนะ</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* การลงนามเอกสาร */}
          {person && (hasPosition || !isAdd) && !clearsAssignment && registry?.error && (
            <p className="text-xs font-semibold leading-5 text-rose-700" role="alert">ตรวจผู้ลงนามไม่สำเร็จ แก้ที่เมนูการลงนามเอกสารแทน</p>
          )}
          {showSigning && (hasPosition || !isAdd) && (
            <PersonSigningChoices rows={signingRows} pickable={pickableSlots} positionName={positionName} titles={titles} signMode={signMode}
              onToggle={(key, value) => setSignChoices(current => ({ ...current, [key]: value }))}
              onTitleChange={(key, value) => setTitles(current => ({ ...current, [key]: value }))}
              onPick={pickSlot} onAddCustom={addCustomSlot} onOpenSigning={onOpenSigning} />
          )}

          {!isAdd && renderAccount && (
            <FoldSection title="ข้อมูลบัญชี" testId="account" defaultOpen={user.role === 'citizen'}>
              {renderAccount({ draft: account, setDraft: setAccount, isEditing: canEdit, clearSaveError: () => setError('') })}
            </FoldSection>
          )}
          {!isAdd && renderPersonal && (
            <FoldSection title="ข้อมูลส่วนตัว" testId="personal" defaultOpen={user.role === 'citizen'}>
              {renderPersonal({ draft: account, setDraft: setAccount, isEditing: canEdit })}
            </FoldSection>
          )}
        </fieldset>

        {error && (
          <div className="flex gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700" role="alert">
            <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
      </div>
    </SigningDialogShell>
  )
}
