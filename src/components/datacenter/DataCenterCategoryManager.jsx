import { useEffect, useState } from 'react'
import { Loader2, Pencil, Check, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  resolveGroupEmoji, resolveEntryEmoji, fetchGroupIconOverrides,
  saveGroupIconOverride, renameIconTarget, iconKey,
} from '../../lib/dataCenterGroupIcon'
import GroupIconPicker from './GroupIconPicker'

// รวมกลุ่มหลัก/ประเภทย่อยที่ "มีอยู่จริง" ในฐานข้อมูล (ไม่ใช่ตัวอย่างเริ่มต้นใน SEED_GROUPS ของฟอร์ม)
// เพื่อให้ admin/superadmin เจอชื่อที่พนักงานพิมพ์เพี้ยน/สะกดต่างกัน แล้วรวมเข้าด้วยกันได้
function buildGroups(rows) {
  const groupNames = Array.from(new Set(rows.map(r => r.group_name))).sort((a, b) => a.localeCompare(b, 'th'))
  return groupNames.map(group => {
    const inGroup = rows.filter(r => r.group_name === group)
    const catNames = Array.from(new Set(inGroup.map(r => r.category))).sort((a, b) => a.localeCompare(b, 'th'))
    return {
      group,
      total: inGroup.length,
      categories: catNames.map(category => ({ category, count: inGroup.filter(r => r.category === category).length })),
    }
  })
}

export default function DataCenterCategoryManager({ tenant }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // { type: 'group'|'category', group, category?, value }
  const [saving, setSaving] = useState(false)
  // ไอคอน: ตั้งได้ทั้งระดับกลุ่มหลักและระดับประเภทย่อย มีผลกับหน้ารายการ+แผนที่ทันที
  // เพราะทั้งสองหน้าอ่านจากตาราง data_center_group_icons ตัวเดียวกัน (ดู src/lib/dataCenterGroupIcon.js)
  const [iconOverrides, setIconOverrides] = useState({})
  const [iconEditing, setIconEditing] = useState(null) // { group, category }  category='' = ระดับกลุ่มหลัก
  const [iconDraft, setIconDraft] = useState('')
  const [savingIcon, setSavingIcon] = useState(false)

  function load() {
    if (!tenant?.id) return
    setLoading(true)
    supabase.from('data_center_entries').select('group_name, category').eq('municipality_id', tenant.id)
      .then(({ data }) => { setRows(data ?? []); setLoading(false) })
  }
  useEffect(load, [tenant?.id])

  useEffect(() => {
    let cancelled = false
    const pending = tenant?.id ? fetchGroupIconOverrides(supabase, tenant.id) : Promise.resolve({})
    pending.then(map => { if (!cancelled) setIconOverrides(map) })
    return () => { cancelled = true }
  }, [tenant?.id])

  const groups = buildGroups(rows)

  function startEditGroup(group) { setEditing({ type: 'group', group, value: group }); setIconEditing(null) }
  function startEditCategory(group, category) { setEditing({ type: 'category', group, category, value: category }); setIconEditing(null) }
  function cancelEdit() { setEditing(null) }

  async function confirmEdit() {
    if (!editing || saving) return
    const newValue = editing.value.trim()
    if (!newValue) return
    const oldValue = editing.type === 'group' ? editing.group : editing.category
    if (newValue === oldValue) { setEditing(null); return }

    const willMerge = editing.type === 'group'
      ? groups.some(g => g.group === newValue)
      : groups.find(g => g.group === editing.group)?.categories.some(c => c.category === newValue)
    if (willMerge && !window.confirm(`มีชื่อ "${newValue}" อยู่แล้ว — รายการเดิมทั้งหมดจะถูกรวมเข้าเป็นชื่อนี้ ยืนยันไหม?`)) return

    setSaving(true)
    let query = supabase.from('data_center_entries')
      .update(editing.type === 'group' ? { group_name: newValue } : { category: newValue })
      .eq('municipality_id', tenant.id)
    query = editing.type === 'group'
      ? query.eq('group_name', editing.group)
      : query.eq('group_name', editing.group).eq('category', editing.category)
    const { error } = await query
    if (error) { setSaving(false); alert('บันทึกไม่สำเร็จ: ' + error.message); return }

    // ไอคอนผูกกับ "ชื่อ" ไม่ใช่ id — ถ้าไม่ย้ายตาม ไอคอนที่ตั้งไว้จะกลายเป็นแถวกำพร้าและหายไปเฉยๆ
    await renameIconTarget(supabase, {
      municipalityId: tenant.id,
      groupName: editing.group,
      newGroupName: editing.type === 'group' ? newValue : null,
      category: editing.type === 'category' ? editing.category : null,
      newCategory: editing.type === 'category' ? newValue : null,
    })
    setIconOverrides(await fetchGroupIconOverrides(supabase, tenant.id))

    setSaving(false)
    setEditing(null)
    load()
  }

  // ไอคอนที่ระบบจะเลือกให้ถ้า "ไม่ตั้งเอง" — ตัด override ของเป้าหมายนี้ทิ้งก่อนคำนวณ
  // (ระดับประเภทย่อยยังตกไปใช้ไอคอนของกลุ่มหลักได้ตามปกติ เพราะลบเฉพาะคีย์ของตัวเอง)
  function autoEmojiFor(group, category) {
    const withoutSelf = { ...iconOverrides }
    delete withoutSelf[iconKey(group, category)]
    return category ? resolveEntryEmoji(group, category, withoutSelf) : resolveGroupEmoji(group, withoutSelf)
  }

  function startEditIcon(group, category) {
    setEditing(null)
    // เริ่มจากค่าที่ "ตั้งเองไว้" เท่านั้น — ยังไม่เคยตั้ง = ว่าง = โหมดอัตโนมัติ
    // (ถ้าเติมค่าที่ resolve ได้ลงไป การกดบันทึกเฉยๆ จะสร้าง override ซ้ำกับค่าอัตโนมัติโดยไม่จำเป็น)
    setIconDraft(iconOverrides[iconKey(group, category)] ?? '')
    setIconEditing({ group, category })
  }

  async function confirmIcon() {
    if (!iconEditing || savingIcon) return
    setSavingIcon(true)
    const { data: auth } = await supabase.auth.getUser()
    const { error } = await saveGroupIconOverride(supabase, {
      municipalityId: tenant.id,
      groupName: iconEditing.group,
      category: iconEditing.category,
      emoji: iconDraft,
      userId: auth?.user?.id ?? null,
    })
    setSavingIcon(false)
    if (error) { alert('บันทึกไอคอนไม่สำเร็จ: ' + error.message); return }
    setIconOverrides(await fetchGroupIconOverrides(supabase, tenant.id))
    setIconEditing(null)
  }

  const isEditingIcon = (group, category) =>
    iconEditing?.group === group && iconEditing?.category === category

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold text-gray-800">จัดการหมวดหมู่</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          แก้ชื่อกลุ่มหลัก/ประเภทย่อยที่พนักงานพิมพ์ไม่ตรงกัน — เปลี่ยนชื่อให้ตรงกับของเดิมจะรวมรายการเข้าด้วยกันอัตโนมัติ
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          กดที่ไอคอนหน้าชื่อเพื่อตั้งไอคอนเอง — ไอคอนของประเภทย่อยจะทับไอคอนของกลุ่มหลัก
          และมีผลทั้งหน้ารายการและหมุดบนแผนที่
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
      ) : groups.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-16">ยังไม่มีข้อมูลในศูนย์ข้อมูลดิจิทัล</p>
      ) : (
        <div className="space-y-3">
          {groups.map(({ group, total, categories }) => (
            <div key={group} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center justify-between gap-2">
                  {editing?.type === 'group' && editing.group === group ? (
                    <EditRow value={editing.value} saving={saving}
                      onChange={v => setEditing(e => ({ ...e, value: v }))} onConfirm={confirmEdit} onCancel={cancelEdit} />
                  ) : (
                    <>
                      <span className="flex items-center gap-2 min-w-0">
                        <IconButton emoji={resolveGroupEmoji(group, iconOverrides)}
                          label={`ตั้งไอคอนกลุ่ม ${group}`} onClick={() => startEditIcon(group, '')} />
                        <span className="text-sm font-bold text-gray-800 truncate">
                          {group} <span className="text-gray-400 font-normal">({total} แห่ง)</span>
                        </span>
                      </span>
                      <button onClick={() => startEditGroup(group)} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400 shrink-0" aria-label={`แก้ชื่อกลุ่ม ${group}`}>
                        <Pencil size={13} />
                      </button>
                    </>
                  )}
                </div>
                {isEditingIcon(group, '') && (
                  <GroupIconPicker value={iconDraft} saving={savingIcon} onChange={setIconDraft}
                    autoEmoji={autoEmojiFor(group, '')}
                    onConfirm={confirmIcon} onCancel={() => setIconEditing(null)} />
                )}
              </div>
              <div className="divide-y divide-gray-50">
                {categories.map(({ category, count }) => (
                  <div key={category} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      {editing?.type === 'category' && editing.group === group && editing.category === category ? (
                        <EditRow value={editing.value} saving={saving}
                          onChange={v => setEditing(e => ({ ...e, value: v }))} onConfirm={confirmEdit} onCancel={cancelEdit} />
                      ) : (
                        <>
                          <span className="flex items-center gap-2 min-w-0">
                            <IconButton emoji={resolveEntryEmoji(group, category, iconOverrides)}
                              label={`ตั้งไอคอนประเภท ${category}`} onClick={() => startEditIcon(group, category)} />
                            <span className="text-sm text-gray-600 truncate">
                              {category} <span className="text-gray-400">({count} แห่ง)</span>
                            </span>
                          </span>
                          <button onClick={() => startEditCategory(group, category)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0" aria-label={`แก้ชื่อประเภท ${category}`}>
                            <Pencil size={13} />
                          </button>
                        </>
                      )}
                    </div>
                    {isEditingIcon(group, category) && (
                      <GroupIconPicker value={iconDraft} saving={savingIcon} onChange={setIconDraft}
                        autoEmoji={autoEmojiFor(group, category)}
                        onConfirm={confirmIcon} onCancel={() => setIconEditing(null)} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function IconButton({ emoji, label, onClick }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="w-8 h-8 shrink-0 rounded-lg border border-gray-200 bg-white text-base leading-none flex items-center justify-center hover:border-blue-300 hover:bg-blue-50">
      {emoji}
    </button>
  )
}

function EditRow({ value, saving, onChange, onConfirm, onCancel }) {
  return (
    <div className="flex items-center gap-1.5 flex-1">
      <input autoFocus value={value} onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel() }}
        className="flex-1 border border-blue-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
      <button onClick={onConfirm} disabled={saving} className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50" aria-label="ยืนยัน">
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
      </button>
      <button onClick={onCancel} disabled={saving} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400" aria-label="ยกเลิก">
        <X size={13} />
      </button>
    </div>
  )
}
