import { useTenant } from '../../contexts/TenantContext'
import EcoFriendlyHeader from '../citizen/templates/EcoFriendly/Header'
import CleanMinimalHeader from '../citizen/templates/CleanMinimal/Header'
import WaveFluidHeader from '../citizen/templates/WaveFluid/Header'
import CivicFriendlyHeader from '../citizen/templates/CivicFriendly/Header'
import SmartModernHeader from '../citizen/templates/SmartModern/Header'
import KledkaewHeader from '../citizen/templates/Kledkaew/Header'

export default function Header() {
  const { tenant } = useTenant()
  const uiStyle = tenant?.ui_style || 'default'

  switch (uiStyle) {
    case 'clean_minimal':
      return <CleanMinimalHeader />
    case 'wave_fluid':
      return <WaveFluidHeader />
    case 'civic_friendly':
      return <CivicFriendlyHeader />
    case 'smart_modern':
      return <SmartModernHeader />
    case 'kledkaew':
      return <KledkaewHeader />
    case 'eco_friendly':
    default:
      return <EcoFriendlyHeader />
  }
}
