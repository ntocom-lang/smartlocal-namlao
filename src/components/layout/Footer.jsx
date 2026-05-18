import { useTenant } from '../../contexts/TenantContext'

export default function Footer() {
  const { tenant } = useTenant()

  return (
    <footer className="mt-12 text-white" style={{ backgroundColor: 'var(--color-primary-dark, var(--color-primary))' }}>
      <div className="max-w-6xl mx-auto px-4 py-4 text-center text-xs text-white/70 flex flex-col items-center gap-1.5 leading-relaxed">
        <a href="/manual-citizen.html" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-white/90 hover:text-white font-medium transition-colors bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg">
          📋 คู่มือการใช้งานสำหรับประชาชน
        </a>
        <span>Copyright © 2026 : {tenant?.name}</span>
        {tenant?.developer_name && <span>พัฒนาโดย {tenant.developer_name}</span>}
      </div>
    </footer>
  )
}
