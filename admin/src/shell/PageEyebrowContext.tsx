import { createContext, useContext, type ReactNode } from 'react'

const PageEyebrowContext = createContext<string | null>(null)

export interface PageEyebrowProviderProps {
  children: ReactNode
  value: string | null
}

/**
 * Bridges the shell's currently shown section label to route content without
 * making the UI kit depend on shell navigation.
 */
export function PageEyebrowProvider({ children, value }: PageEyebrowProviderProps) {
  return <PageEyebrowContext.Provider value={value}>{children}</PageEyebrowContext.Provider>
}

/** The label of the section currently shown by the shell, or null outside the shell. */
// The plan intentionally keeps this hook beside its tiny provider so the shell contract has one owner.
// eslint-disable-next-line react-refresh/only-export-components
export function usePageEyebrow(): string | null {
  return useContext(PageEyebrowContext)
}
