import { useEffect } from 'react'
import { useAppSettings } from './useAppSettings'

type PageSEOOptions = {
  title: string
  description?: string
}

/**
 * Hook to set page-specific SEO metadata with whitelabel name prefix
 * 
 * Format: {whitelabelName} - {pageTitle}
 * 
 * @example
 * usePageSEO({ title: 'Casino', description: 'Play live casino games' })
 * // Results in: "whiteman - Casino"
 */
export function usePageSEO(options: PageSEOOptions) {
  const { parsedSettings } = useAppSettings()
  
  useEffect(() => {
    if (typeof document === 'undefined') return
    
    // App name comes from backend only; blank stays blank (no 'App' fallback).
    const whitelabelName = parsedSettings?.appName || parsedSettings?.seoTitle || ''
    const pageTitle = options.title
    const pageDescription = options.description || parsedSettings?.seoDescription || (whitelabelName ? `Welcome to ${whitelabelName}` : 'Welcome')

    // Format: {whitelabelName} - {pageTitle} (omit the name part when blank)
    const fullTitle = whitelabelName ? `${whitelabelName} - ${pageTitle}` : pageTitle
    
    // Update document title
    document.title = fullTitle
    
    // Helper to update or create meta tag
    const updateMetaTag = (selector: string, attribute: string, attrValue: string, content: string) => {
      let tag = document.querySelector(selector)
      if (!tag) {
        tag = document.createElement('meta')
        tag.setAttribute(attribute, attrValue)
        document.head.appendChild(tag)
      }
      tag.setAttribute('content', content)
    }
    
    // Update SEO meta tags
    updateMetaTag('meta[name="description"]', 'name', 'description', pageDescription)
    updateMetaTag('meta[property="og:title"]', 'property', 'og:title', fullTitle)
    updateMetaTag('meta[property="og:description"]', 'property', 'og:description', pageDescription)
    updateMetaTag('meta[name="twitter:title"]', 'name', 'twitter:title', fullTitle)
    updateMetaTag('meta[name="twitter:description"]', 'name', 'twitter:description', pageDescription)
    
    // Cleanup: restore default title when component unmounts
    return () => {
      const defaultTitle = parsedSettings?.seoTitle || parsedSettings?.appName || ''
      document.title = defaultTitle
    }
  }, [options.title, options.description, parsedSettings?.appName, parsedSettings?.seoTitle, parsedSettings?.seoDescription])
}

