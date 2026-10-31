import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useLogo } from '../hooks/useAppSettings'

interface LogoProps {
  className?: string
  showText?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export default function Logo({ 
  className = "", 
  showText = true, 
  size = 'md' 
}: LogoProps) {
  const { logoSrc, siteTitle } = useLogo()
  const [imageError, setImageError] = useState(false)
  
  
  const sizeClasses = {
    sm: 'h-15',
    md: 'h-12', 
    lg: 'h-12'
  }
  
  // Check if we have a valid logo source (supports data URLs, HTTP/HTTPS URLs, and base64)
  const hasValidLogo = logoSrc && 
    logoSrc !== 'data:image/png;base64,' && 
    logoSrc !== 'data:image/png;base64,undefined' &&
    (logoSrc.startsWith('data:image/') || 
     logoSrc.startsWith('http://') || 
     logoSrc.startsWith('https://') ||
     logoSrc.startsWith('/')) &&
    !imageError
  
  // Reset error state when logoSrc changes
  useEffect(() => {
    setImageError(false)
  }, [logoSrc])
  
  return (
    <Link to="/" className={`flex items-center gap-2 hover:opacity-80 transition-opacity ${className}`}>
      {hasValidLogo ? (
        <img 
          src={logoSrc} 
          alt={showText ? '' : (siteTitle || 'Home')}
          className={`nova-logo-image ${sizeClasses[size]} w-auto object-contain`}
          onLoad={() => setImageError(false)}
          onError={() => setImageError(true)}
        />
      ) : (
        <span className="nova-wordmark" aria-label={siteTitle || 'NOVA'}>
          <span className="nova-brand-symbol" aria-hidden="true">N</span>
          <span>{siteTitle || 'NOVA'}<small>YOUR HOME GROUND</small></span>
        </span>
      )}
      {showText && hasValidLogo && (
        <span className="sr-only">{siteTitle || 'Home'}</span>
      )}
    </Link>
  )
}
