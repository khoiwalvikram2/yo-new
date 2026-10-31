import { Navigate } from 'react-router-dom'
import { useAppSettings } from '../hooks/useAppSettings'

type RequireFeatureProps = {
  children: React.ReactNode
  feature: 'sportsEnabled' | 'casinoEnabled' | 'matkaEnabled' | 'agentsEnabled' | 'referralsEnabled' | 'bonusesEnabled'
  fallback?: React.ReactNode
}

export default function RequireFeature({ children, feature, fallback }: RequireFeatureProps) {
  const { parsedSettings, isLoading } = useAppSettings()

  // Wait for settings to load before checking feature flag
  if (isLoading) {
    // Return null or a loading state while settings are loading
    // This prevents premature redirects
    return null
  }

  const isEnabled = parsedSettings.features[feature] ?? false

  if (!isEnabled) {
    if (fallback) {
      return <>{fallback}</>
    }
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

