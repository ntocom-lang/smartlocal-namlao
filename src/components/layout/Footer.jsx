import { useTenant } from '../../contexts/TenantContext'

export default function Footer() {
  const { tenant } = useTenant()

  return (
    <footer className="mt-12 text-white" style={{ backgroundColor: 'var(--color-primary-dark, var(--color-primary))' }}>
      <div className="max-w-6xl mx-auto px-4 py-3 text-center text-xs text-white/70 flex flex-col items-center gap-0.5 leading-relaxed">
        <span>Copyright © 2026 : {tenant?.name}</span>
        {tenant?.developer_name && <span>พัฒนาโดย {tenant.developer_name}</span>}
      </div>
    </footer>
  )
}
