import { useState, useEffect } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

const MOBILE_MAX = 639
const TABLET_MAX = 1023
const WIDE_MIN = 1280

export interface UseBreakpointResult {
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  /** True when viewport < 1024px (sidebar collapse breakpoint used by Layout) */
  isSmallScreen: boolean
  /** True when viewport >= 1280px (panel collapse persists only here) */
  isWide: boolean
  breakpoint: Breakpoint
}

function getBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop'
  const w = window.innerWidth
  if (w <= MOBILE_MAX) return 'mobile'
  if (w <= TABLET_MAX) return 'tablet'
  return 'desktop'
}

function getResult(bp: Breakpoint): Omit<UseBreakpointResult, 'isWide'> {
  return {
    isMobile: bp === 'mobile',
    isTablet: bp === 'tablet',
    isDesktop: bp === 'desktop',
    isSmallScreen: bp !== 'desktop',
    breakpoint: bp,
  }
}

/**
 * Responsive breakpoint hook. Uses matchMedia for SSR-safe, efficient updates.
 * - mobile: < 640px
 * - tablet: 640px - 1023px
 * - desktop: >= 1024px
 * - isWide: >= 1280px (own state; does not change the breakpoint above)
 */
export function useBreakpoint(): UseBreakpointResult {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(() => getBreakpoint())
  const [isWide, setIsWide] = useState(() => window.innerWidth >= WIDE_MIN)

  useEffect(() => {
    const mqMobile = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`)
    const mqTablet = window.matchMedia(`(min-width: ${MOBILE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`)
    const mqDesktop = window.matchMedia(`(min-width: ${TABLET_MAX + 1}px)`)
    const mqWide = window.matchMedia(`(min-width: ${WIDE_MIN}px)`)

    const updateWide = () => setIsWide(window.innerWidth >= WIDE_MIN)
    const update = () => {
      setBreakpoint(getBreakpoint())
      updateWide()
    }

    mqMobile.addEventListener('change', update)
    mqTablet.addEventListener('change', update)
    mqDesktop.addEventListener('change', update)
    mqWide.addEventListener('change', updateWide)
    update()

    return () => {
      mqMobile.removeEventListener('change', update)
      mqTablet.removeEventListener('change', update)
      mqDesktop.removeEventListener('change', update)
      mqWide.removeEventListener('change', updateWide)
    }
  }, [])

  return { ...getResult(breakpoint), isWide }
}
