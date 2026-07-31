import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

let loadedApiKey = null
let loadPromise = null

/**
 * โหลด Google Maps SDK ตาม API Key ของ อปท. ( Functional API per Key )
 * @param {string} [customApiKey] - API Key ประจำ อปท. (หากไม่มีจะใช้ VITE_GOOGLE_MAPS_API_KEY)
 * @returns {Promise<typeof google>}
 */
export function loadGoogleMaps(customApiKey) {
  const apiKey = (customApiKey && customApiKey.trim())
    || import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    || ''

  if (!apiKey) {
    console.warn('[SmartLocal GIS] ⚠️ No Google Maps API Key found in Tenant settings or VITE_GOOGLE_MAPS_API_KEY env.')
  }

  if (window.google?.maps?.Map) {
    return Promise.resolve({
      google: window.google,
      Map: window.google.maps.Map,
      mapsLib: window.google.maps,
      placesLib: window.google.maps.places,
      geometryLib: window.google.maps.geometry,
      markerLib: window.google.maps.marker,
    })
  }

  if (!loadPromise || loadedApiKey !== apiKey) {
    loadedApiKey = apiKey
    setOptions({
      key: apiKey,
      v: 'weekly',
    })
    loadPromise = (async () => {
      const mapsLib = await importLibrary('maps')
      const placesLib = await importLibrary('places')
      const geometryLib = await importLibrary('geometry')
      const markerLib = await importLibrary('marker')

      const googleObj = window.google || {}
      if (googleObj.maps) {
        Object.assign(googleObj.maps, mapsLib)
        googleObj.maps.places = placesLib
        googleObj.maps.geometry = geometryLib
        googleObj.maps.marker = markerLib
      }

      return {
        google: googleObj,
        mapsLib,
        placesLib,
        geometryLib,
        markerLib,
        Map: mapsLib.Map || googleObj.maps?.Map,
      }
    })()
  }

  return loadPromise
}

