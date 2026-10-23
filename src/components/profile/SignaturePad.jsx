import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import { SIGNATURE_PAD_H, SIGNATURE_PAD_W } from '../../lib/signatureImage'
import { drawStrokes, strokesToSignature } from '../../lib/signatureCanvas'

// แผ่นเซ็นสดด้วยนิ้ว/ปากกา/เมาส์ — เก็บเป็นเส้นพิกัดสัดส่วน วาดซ้ำได้เมื่อหมุนจอ/ย่อขยาย
// ออกมาเป็น PNG ผ่าน toSignature() (ตัดขอบ + ย่อให้พอดีเพดานของฐานข้อมูล)
// เส้นประ/กากบาทเป็น DOM ซ้อนทับ ไม่อยู่ในภาพที่ส่งออก
const SignaturePad = forwardRef(function SignaturePad({ color, pen, onInkChange, disabled = false }, ref) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const strokesRef = useRef([])
  const activeRef = useRef(null)
  const colorRef = useRef(color)
  const penRef = useRef(pen)
  const inkCallbackRef = useRef(onInkChange)

  useEffect(() => {
    colorRef.current = color
    penRef.current = pen
    inkCallbackRef.current = onInkChange
  }, [color, pen, onInkChange])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    drawStrokes(canvas.getContext('2d'), strokesRef.current, canvas.width, canvas.height)
  }, [])

  const notify = useCallback(() => inkCallbackRef.current?.(strokesRef.current.length > 0), [])

  // ขนาดพื้นหลังของ canvas ตามความกว้างจริง × ความละเอียดจอ (จอ retina ได้เส้นคมเท่าที่จอแสดงได้)
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return undefined
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const width = Math.max(1, Math.round(wrap.clientWidth * dpr))
      const height = Math.max(1, Math.round((wrap.clientWidth * SIGNATURE_PAD_H / SIGNATURE_PAD_W) * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        redraw()
      }
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [redraw])

  useImperativeHandle(ref, () => ({
    clear() {
      strokesRef.current = []
      activeRef.current = null
      redraw()
      notify()
    },
    undo() {
      strokesRef.current = strokesRef.current.slice(0, -1)
      redraw()
      notify()
    },
    hasInk: () => strokesRef.current.length > 0,
    toSignature: () => strokesToSignature(strokesRef.current),
  }), [redraw, notify])

  const pointFrom = event => {
    const rect = canvasRef.current.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  const onPointerDown = event => {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const stroke = { color: colorRef.current, pen: penRef.current, points: [pointFrom(event)] }
    strokesRef.current = [...strokesRef.current, stroke]
    activeRef.current = { id: event.pointerId, stroke }
    redraw()
    notify()
  }

  const onPointerMove = event => {
    const active = activeRef.current
    if (!active || active.id !== event.pointerId) return
    event.preventDefault()
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? []
    const points = samples.length ? samples : [event.nativeEvent]
    const rect = canvasRef.current.getBoundingClientRect()
    for (const sample of points) {
      const next = {
        x: Math.min(1, Math.max(0, (sample.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (sample.clientY - rect.top) / rect.height)),
      }
      const last = active.stroke.points[active.stroke.points.length - 1]
      // จุดที่ห่างน้อยกว่า ~1px ข้ามไป — เส้นไม่สั่นและข้อมูลไม่บวมโดยไม่จำเป็น
      if (Math.abs(next.x - last.x) * rect.width + Math.abs(next.y - last.y) * rect.height < 1) continue
      active.stroke.points.push(next)
    }
    redraw()
  }

  const endStroke = event => {
    const active = activeRef.current
    if (!active || active.id !== event.pointerId) return
    activeRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    redraw()
  }

  return (
    <div ref={wrapRef} className="relative w-full select-none overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-white"
      style={{ aspectRatio: `${SIGNATURE_PAD_W} / ${SIGNATURE_PAD_H}` }}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-5 bottom-[22%] border-b border-gray-300" />
      <span aria-hidden="true" className="pointer-events-none absolute bottom-[24%] left-5 text-lg leading-none text-gray-300">✕</span>
      <canvas ref={canvasRef} data-signature-pad role="img"
        aria-label="พื้นที่เซ็นชื่อ ใช้นิ้ว ปากกา หรือเมาส์เซ็นในกรอบ ถ้าเซ็นไม่ถนัดให้ใช้แท็บอัปโหลดรูปลายเซ็น"
        className="absolute inset-0 h-full w-full cursor-crosshair"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endStroke} onPointerCancel={endStroke} />
    </div>
  )
})

export default SignaturePad
