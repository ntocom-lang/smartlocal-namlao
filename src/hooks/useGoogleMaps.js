import { useEffect, useState } from 'react'
import { loadGoogleMaps } from '../lib/googleMaps'

/**
 * Custom React Hook สำหรับใช้งาน Google Maps SDK ใน React Components
 * @returns {{ isLoaded: boolean, loadError: Error | null, google: typeof google | null }}
 */
export function useGoogleMaps() {
  const [isLoaded, setIsLoaded] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [google, setGoogle] = useState(null)

  useEffect(() => {
    let isMounted = true

    loadGoogleMaps()
      .then((googleInstance) => {
        if (isMounted) {
          setGoogle(googleInstance)
          setIsLoaded(true)
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('[useGoogleMaps] Error loading Google Maps JS API:', err)
          setLoadError(err)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  return { isLoaded, loadError, google }
}
