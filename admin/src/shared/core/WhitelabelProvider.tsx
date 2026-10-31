import { useEffect } from 'react'
import { useQuery } from '@apollo/client'
import { gql } from '@apollo/client'
import { useAuthStore } from './authStore'
import type { ReactNode } from 'react'

const WL_QUERY = gql`
  query WhitelabelCurrent {
    whitelabelCurrent {
      id
      name
      logoUrl
      faviconUrl
      theme {
        primary
        success
        warning
        danger
        dark {
          bgPage
          textPrimary
          textSecondary
          border
        }
        light {
          bgPage
          textPrimary
          textSecondary
          border
        }
        bgPage
        textPrimary
        textSecondary
        border
      }
    }
  }
`

function setCssVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function _applyWhitelabelTheme(theme: {
  primary: string
  success: string
  warning: string
  danger: string
  dark?: {
    bgPage: string
    textPrimary: string
    textSecondary: string
    border: string
  }
  light?: {
  bgPage: string
  textPrimary: string
  textSecondary: string
  border: string
  }
  bgPage?: string
  textPrimary?: string
  textSecondary?: string
  border?: string
}) {
  // Action colors (shared for both themes)
  setCssVar('--color-primary', theme.primary)
  setCssVar('--color-success', theme.success)
  setCssVar('--color-warning', theme.warning)
  setCssVar('--color-danger', theme.danger)
  
  // Detect current theme mode (default to dark)
  const isDark = document.documentElement.classList.contains('dark') || 
                 !document.documentElement.classList.contains('light')
  
  // Apply theme-specific colors based on current mode
  if (isDark && theme.dark) {
    setCssVar('--bg-page', theme.dark.bgPage)
    setCssVar('--text-primary', theme.dark.textPrimary)
    setCssVar('--text-secondary', theme.dark.textSecondary)
    setCssVar('--color-border', theme.dark.border)
  } else if (!isDark && theme.light) {
    setCssVar('--bg-page', theme.light.bgPage)
    setCssVar('--text-primary', theme.light.textPrimary)
    setCssVar('--text-secondary', theme.light.textSecondary)
    setCssVar('--color-border', theme.light.border)
  } else {
    // Fallback to legacy fields for backward compatibility
    setCssVar('--bg-page', theme.bgPage || '#0A0E27')
    setCssVar('--text-primary', theme.textPrimary || '#F8FAFC')
    setCssVar('--text-secondary', theme.textSecondary || '#94A3B8')
    setCssVar('--color-border', theme.border || '#1E293B')
  }
}

function applyFavicon(href?: string | null) {
  if (!href) return
  let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = href
}

export function WhitelabelProvider({ children }: { children: ReactNode }) {
  const token = useAuthStore(s => s.token)
  const { data } = useQuery(WL_QUERY, {
    skip: !token,
    errorPolicy: 'all',
  })

  useEffect(() => {
    if (!data?.whitelabelCurrent) return
    applyFavicon(data.whitelabelCurrent.faviconUrl)
    if (data.whitelabelCurrent.name) {
      document.documentElement.setAttribute('data-whitelabel', data.whitelabelCurrent.id)
    }
  }, [data])

  return <>{children}</>
}

