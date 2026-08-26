import { useEffect, useRef } from 'react'

export default function DataCenter3DCanvas({ height = '180px', className = '', theme = 'dark' }) {
  const canvasRef = useRef(null)
  const isLight = theme === 'light'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId
    let width = (canvas.width = canvas.parentElement?.clientWidth || 800)
    let h = (canvas.height = canvas.parentElement?.clientHeight || 180)

    // ผู้ใช้ที่ตั้งค่าระบบว่าลดการเคลื่อนไหว (เมาง่าย/ไวต่อภาพเคลื่อนไหว) — วาดเฟรมเดียวจบ ไม่วนลูป
    const prefersReducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const handleResize = () => {
      if (!canvas.parentElement) return
      width = canvas.width = canvas.parentElement.clientWidth
      h = canvas.height = canvas.parentElement.clientHeight
      // โหมดลดการเคลื่อนไหววาดครั้งเดียวแล้วหยุด — การเปลี่ยนขนาดล้าง canvas ทิ้ง จึงต้องสั่งวาดใหม่เอง
      // (โหมดปกติมีลูป rAF วาดต่อเนื่องอยู่แล้ว ไม่ต้องทำอะไร)
      if (prefersReducedMotion) render()
    }
    window.addEventListener('resize', handleResize)

    // Mouse tracking for 3D tilt interaction
    let mouseX = 0
    let mouseY = 0
    let targetMouseX = 0
    let targetMouseY = 0

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect()
      targetMouseX = (e.clientX - rect.left - width / 2) * 0.002
      targetMouseY = (e.clientY - rect.top - h / 2) * 0.002
    }

    const parentElem = canvas.parentElement
    if (parentElem) {
      parentElem.addEventListener('mousemove', handleMouseMove)
    }

    // 3D Particles & Nodes
    const NODE_COUNT = 45
    const nodes = []
    const lightColors = ['#0284c7', '#2563eb', '#059669', '#7c3aed']
    const darkColors = ['#00f0ff', '#3b82f6', '#10b981', '#a855f7']

    for (let i = 0; i < NODE_COUNT; i++) {
      const u = Math.random() * Math.PI * 2
      const v = Math.acos(Math.random() * 2 - 1)
      const radius = 60 + Math.random() * 25
      const palette = isLight ? lightColors : darkColors
      nodes.push({
        x0: radius * Math.sin(v) * Math.cos(u),
        y0: radius * Math.sin(v) * Math.sin(u),
        z0: radius * Math.cos(v),
        size: Math.random() * 2.2 + 1.2,
        pulseSpeed: Math.random() * 0.05 + 0.02,
        phase: Math.random() * Math.PI * 2,
        color: palette[Math.floor(Math.random() * palette.length)]
      })
    }


    // Floating data particles
    const PARTICLE_COUNT = 30
    const particles = []
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: (Math.random() - 0.5) * width,
        y: (Math.random() - 0.5) * h,
        z: Math.random() * 400 - 200,
        speedX: (Math.random() - 0.5) * 0.4,
        speedY: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 1.5 + 0.8,
        alpha: Math.random() * 0.6 + 0.2
      })
    }

    let angleX = 0
    let angleY = 0

    const render = () => {
      // header มือถือกับ PC ถูก mount พร้อมกันทั้งคู่เสมอ (ซ่อนอีกตัวด้วย CSS md:hidden / hidden md:block
      // ไม่ใช่ unmount) ตัวที่ถูกซ่อนจะได้ clientWidth/clientHeight = 0 แต่ลูป rAF ยังวิ่งอยู่ ถ้าไม่ตัดตรงนี้
      // จะเสียแรงคำนวณ 45 โหนด + 30 particle ทุกเฟรมให้กับ canvas ที่ไม่มีใครเห็น (กินแบตมือถือฟรีๆ)
      // ไม่หยุดลูปถาวรเพราะผู้ใช้หมุนจอ/ปรับขนาดหน้าต่างแล้วมันต้องกลับมาวาดต่อได้เอง
      if (!width || !h) {
        // โหมดลดการเคลื่อนไหวไม่ต้อง schedule ต่อ ไม่งั้นจะกลายเป็นลูปเปล่าที่ไม่มีวันจบ —
        // ตอนมันกลับมามีขนาดจริง handleResize จะสั่งวาดเฟรมเดียวให้เอง
        if (!prefersReducedMotion) animationFrameId = requestAnimationFrame(render)
        return
      }

      ctx.clearRect(0, 0, width, h)

      // Smooth mouse lerp
      mouseX += (targetMouseX - mouseX) * 0.05
      mouseY += (targetMouseY - mouseY) * 0.05

      angleY += 0.008 + mouseX * 0.02
      angleX += 0.004 + mouseY * 0.02

      const cx = width / 2
      const cy = h / 2

      // Draw background ambient grid lines
      ctx.save()
      ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.08)' : 'rgba(0, 240, 255, 0.04)'
      ctx.lineWidth = 1
      const gridSize = 40
      const gridOffset = (Date.now() * 0.015) % gridSize
      for (let x = -gridSize; x < width + gridSize; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }
      for (let y = gridOffset; y < h; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }
      ctx.restore()

      // Project 3D nodes
      const projectedNodes = []
      const cosX = Math.cos(angleX)
      const sinX = Math.sin(angleX)
      const cosY = Math.cos(angleY)
      const sinY = Math.sin(angleY)

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        node.phase += node.pulseSpeed

        // 3D rotation
        let x = node.x0
        let y = node.y0 * cosX - node.z0 * sinX
        let z = node.y0 * sinX + node.z0 * cosX

        let xRot = x * cosY + z * sinY
        let zRot = -x * sinY + z * cosY

        // Perspective projection
        const fov = 260
        const scale = fov / (fov + zRot + 150)
        const px = cx + xRot * scale
        const py = cy + y * scale

        projectedNodes.push({
          px,
          py,
          scale,
          zRot,
          node
        })
      }

      // Sort by depth for correct opacity blending
      projectedNodes.sort((a, b) => b.zRot - a.zRot)

      // Draw connecting lines between close 3D nodes
      ctx.save()
      ctx.lineWidth = 0.8
      for (let i = 0; i < projectedNodes.length; i++) {
        for (let j = i + 1; j < projectedNodes.length; j++) {
          const p1 = projectedNodes[i]
          const p2 = projectedNodes[j]
          const dx = p1.px - p2.px
          const dy = p1.py - p2.py
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist < 75) {
            const alpha = (1 - dist / 75) * (isLight ? 0.45 : 0.35) * Math.min(p1.scale, p2.scale)
            ctx.strokeStyle = isLight ? `rgba(2, 132, 199, ${alpha})` : `rgba(0, 240, 255, ${alpha})`
            ctx.beginPath()
            ctx.moveTo(p1.px, p1.py)
            ctx.lineTo(p2.px, p2.py)
            ctx.stroke()
          }
        }
      }
      ctx.restore()


      // Draw 3D nodes with glow
      for (let i = 0; i < projectedNodes.length; i++) {
        const { px, py, scale, node } = projectedNodes[i]
        const pulse = Math.sin(node.phase) * 0.4 + 1.0
        const size = node.size * scale * pulse

        ctx.save()
        ctx.fillStyle = node.color
        ctx.shadowColor = node.color
        ctx.shadowBlur = 8 * scale
        ctx.beginPath()
        ctx.arc(px, py, Math.max(1, size), 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // Draw Orbital 3D Hologram Rings around core
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(angleY * 0.5)

      // Outer cyan ring
      ctx.beginPath()
      ctx.ellipse(0, 0, 95, 30, angleX, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([8, 12])
      ctx.stroke()

      // Inner emerald ring
      ctx.beginPath()
      ctx.ellipse(0, 0, 75, 22, -angleX * 1.5, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.3)'
      ctx.lineWidth = 1.2
      ctx.setLineDash([4, 8])
      ctx.stroke()
      ctx.restore()

      // Draw floating background particles
      ctx.save()
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        p.x += p.speedX
        p.y += p.speedY
        if (p.x > width / 2) p.x = -width / 2
        if (p.x < -width / 2) p.x = width / 2
        if (p.y > h / 2) p.y = -h / 2
        if (p.y < -h / 2) p.y = h / 2

        ctx.fillStyle = `rgba(0, 240, 255, ${p.alpha * 0.4})`
        ctx.beginPath()
        ctx.arc(cx + p.x, cy + p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()

      if (!prefersReducedMotion) animationFrameId = requestAnimationFrame(render)
    }

    render()

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
      if (parentElem) {
        parentElem.removeEventListener('mousemove', handleMouseMove)
      }
    }
    // theme ต้องอยู่ใน deps: พาเลตสี (lightColors/darkColors) ถูกเลือกตอนสร้าง nodes ครั้งเดียว
    // ถ้า deps ว่าง effect จะไม่ re-run ตอนสลับธีม ทำให้ค่า isLight ที่ถูก closure จับไว้ค้างอยู่ที่ธีมแรก
    // — สลับเป็นโหมดมืดแล้วอนิเมชันยังเป็นสีของโหมดสว่างอยู่
  }, [theme, isLight])

  return (
    <div className={`relative overflow-hidden pointer-events-none select-none ${className}`} style={{ height }}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  )
}
