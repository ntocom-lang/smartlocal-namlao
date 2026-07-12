import { useTenant } from '../contexts/TenantContext'
import EcoFriendlyHome from '../components/citizen/templates/EcoFriendly/Home'
import CleanMinimalHome from '../components/citizen/templates/CleanMinimal/Home'
import WaveFluidHome from '../components/citizen/templates/WaveFluid/Home'
import CivicFriendlyHome from '../components/citizen/templates/CivicFriendly/Home'
import SmartModernHome from '../components/citizen/templates/SmartModern/Home'
import KledkaewHome from '../components/citizen/templates/Kledkaew/Home'

export default function HomePage() {
  const { tenant } = useTenant()
  const uiStyle = tenant?.ui_style || 'default'

  switch (uiStyle) {
    case 'clean_minimal':
      return <CleanMinimalHome />
    case 'wave_fluid':
      return <WaveFluidHome />
    case 'civic_friendly':
      return <CivicFriendlyHome />
    case 'smart_modern':
      return <SmartModernHome />
    case 'kledkaew':
      return <KledkaewHome />
    case 'eco_friendly':
    default:
      return <EcoFriendlyHome />
  }
}
