import { useEffect, useMemo, useState } from 'react'

type ConfettiBurstProps = {
  className?: string
  particleCount?: number
  durationMs?: number
  spread?: number // how far particles travel (px)
}

type Particle = {
  id: number
  dx: number
  dy: number
  size: number
  rotation: number
  color: string
}

export default function ConfettiBurst({ className = '', particleCount = 6, durationMs = 500, spread = 16 }: ConfettiBurstProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), durationMs)
    return () => clearTimeout(t)
  }, [durationMs])

  const particles = useMemo<Particle[]>(() => {
    const palette = [
      'var(--brand-primary)',
      'var(--brand-secondary)',
      'var(--brand-accent)',
      '#22c55e',
      '#f59e0b',
    ]
    const items: Particle[] = []
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.6
      const distance = (spread * 0.9) + Math.random() * (spread * 0.6)
      const dx = Math.cos(angle) * distance
      const dy = Math.sin(angle) * distance
      const size = 2 + Math.random() * 2.5
      const rotation = Math.floor(Math.random() * 360)
      const color = palette[Math.floor(Math.random() * palette.length)]
      items.push({ id: i, dx, dy, size, rotation, color })
    }
    return items
  }, [particleCount])

  if (!visible) return null

  return (
    <div className={`pointer-events-none ${className}`}>
      <div className="confetti-burst">
        {particles.map((p) => (
          <span
            key={p.id}
            className="confetti-piece"
            style={{
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              transform: 'translate(-50%, -50%)',
              // custom properties for animation target
              ['--dx' as any]: `${p.dx}px`,
              ['--dy' as any]: `${p.dy}px`,
              ['--rot' as any]: `${p.rotation}deg`,
              // stagger a little
              animationDelay: `${Math.random() * 60}ms`,
            }}
          />
        ))}
      </div>
    </div>
  )
}


