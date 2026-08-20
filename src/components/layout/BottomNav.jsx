import { useTenant } from '../../contexts/TenantContext'
import EcoFriendlyBottomNav from '../citizen/templates/EcoFriendly/BottomNav'
import CleanMinimalBottomNav from '../citizen/templates/CleanMinimal/BottomNav'
import WaveFluidBottomNav from '../citizen/templates/WaveFluid/BottomNav'
import CivicFriendlyBottomNav from '../citizen/templates/CivicFriendly/BottomNav'
import SmartModernBottomNav from '../citizen/templates/SmartModern/BottomNav'
import KledkaewBottomNav from '../citizen/templates/Kledkaew/BottomNav'
import ServiceHubBottomNav from '../citizen/templates/ServiceHub/BottomNav'

export default function BottomNav() {
  const { tenant } = useTenant()
  const uiStyle = tenant?.ui_style || 'default'

  switch (uiStyle) {
    case 'clean_minimal':
      return <CleanMinimalBottomNav />
    case 'wave_fluid':
      return <WaveFluidBottomNav />
    case 'civic_friendly':
      return <CivicFriendlyBottomNav />
    case 'smart_modern':
      return <SmartModernBottomNav />
    case 'kledkaew':
      return <KledkaewBottomNav />
    case 'service_hub':
      return <ServiceHubBottomNav />
    case 'eco_friendly':
    default:
      return <EcoFriendlyBottomNav />
  }
}
