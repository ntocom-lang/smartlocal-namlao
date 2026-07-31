import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2 } from 'lucide-react'
import GoogleMapPicker from './common/GoogleMapPicker'

export default function InlineMapPicker({ value, onChange, defaultCenter }) {
  const [fullscreen, setFullscreen] = useState(false)

  const content = (
    <div className={fullscreen ? 'flex h-full min-h-0 flex-col bg-white' : 'relative'}>
      {fullscreen && (
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
          <p className="font-bold text-gray-800">เลือกตำแหน่งบน Google Maps</p>
          <button type="button" onClick={() => setFullscreen(false)} className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-600">
            <Minimize2 size={15} /> ย่อแผนที่
          </button>
        </div>
      )}
      <div className={fullscreen ? 'min-h-0 flex-1 overflow-auto p-4' : ''}>
        <GoogleMapPicker
          initialPos={value}
          fallbackPos={defaultCenter}
          onLocationSelect={onChange}
          modal={false}
          skipGeolocation
          mapClassName={fullscreen ? 'w-full h-[calc(100vh-180px)] min-h-[420px]' : 'w-full h-80 min-h-[320px]'}
        />
      </div>
      {!fullscreen && (
        <button type="button" onClick={() => setFullscreen(true)}
          className="absolute right-3 top-[58px] z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow"
          title="ขยายเต็มจอ">
          <Maximize2 size={16} />
        </button>
      )}
    </div>
  )

  if (!fullscreen) return content
  return createPortal(<div className="fixed inset-0 z-9999 bg-white">{content}</div>, document.body)
}
