import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { ROLE_LABELS } from '../../lib/staffRoster'

const TONE = {
  onDark: {
    nameColor: 'text-white',
    roleColor: 'text-white/75',
    avatarBorder: 'border-white/40',
    avatarFallbackBg: 'bg-white/20',
    avatarFallbackText: 'text-white',
    hoverBg: 'hover:bg-white/10',
    border: 'border-white/20 hover:border-white/40',
    bg: 'bg-white/5',
  },
  onLight: {
    nameColor: 'text-slate-800',
    roleColor: 'text-slate-500',
    avatarBorder: 'border-slate-300',
    avatarFallbackBg: 'bg-slate-200',
    avatarFallbackText: 'text-slate-700',
    hoverBg: 'hover:bg-slate-100',
    border: 'border-slate-200 hover:border-slate-300',
    bg: 'bg-slate-50',
  },
}

export default function UserProfileBadge({ tone = 'onDark', className = '', showRole = true }) {
  const { session, role, displayName, avatarUrl } = useAuth()

  if (!session) return null

  const palette = TONE[tone] ?? TONE.onDark
  const roleLabel = ROLE_LABELS[role]?.label ?? (role === 'superadmin' ? 'Super Admin' : 'ผู้ใช้งาน')
  const initialChar = (displayName || '?')[0].toUpperCase()

  return (
    <Link
      to="/profile"
      title={`โปรไฟล์ของคุณ: ${displayName || 'ผู้ใช้งาน'} (คลิกเพื่อดูและแก้ไข)`}
      className={`group flex items-center gap-2.5 px-3 py-1 rounded-full border transition-all cursor-pointer select-none shrink-0 ${palette.bg} ${palette.hoverBg} ${palette.border} ${className}`}
    >
      <div className="text-right min-w-0">
        <p className={`text-xs font-bold truncate max-w-[10rem] sm:max-w-[13rem] transition-colors leading-tight ${palette.nameColor}`}>
          {displayName || 'ไม่ทราบชื่อ'}
        </p>
        {showRole && (
          <p className={`text-[10px] leading-tight truncate max-w-[10rem] sm:max-w-[13rem] mt-0.5 ${palette.roleColor}`}>
            {roleLabel}
          </p>
        )}
      </div>

      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={displayName || 'โปรไฟล์'}
          className={`w-8 h-8 rounded-full object-cover border shrink-0 transition-transform group-hover:scale-105 ${palette.avatarBorder}`}
        />
      ) : (
        <div
          className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold shrink-0 transition-transform group-hover:scale-105 ${palette.avatarFallbackBg} ${palette.avatarFallbackText} ${palette.avatarBorder}`}
        >
          {initialChar}
        </div>
      )}
    </Link>
  )
}
