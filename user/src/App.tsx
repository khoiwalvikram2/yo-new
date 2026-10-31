import './App.css'
import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { AppSettingsProvider, useAppSettings } from './lib/app-settings'
import { initializeTheme, initializeThemeMode, getThemeMode } from './lib/theme'
import LoginModal from './components/modals/LoginModal'
import RegisterModal from './components/modals/RegisterModal'
import ChangePasswordModal from './components/modals/ChangePasswordModal'
import MaintenanceMode from './components/MaintenanceMode'
import AppLoadingSkeleton from './components/AppLoadingSkeleton'
import SettingsDebugger from './components/dev/SettingsDebugger'
import { SyncLocaleFromSettings } from './components/SyncLocaleFromSettings'
import { Toaster } from 'sonner'

const MAX_LOADING_MS = 15_000

function AppContent() {
  const { openAuthModal, isAuthenticated, user } = useAuth()
  const { parsedSettings, isLoading } = useAppSettings()
  const [forceReady, setForceReady] = useState(false)
  const [themeMode, setThemeModeState] = useState(getThemeMode)

  useEffect(() => {
    const syncTheme = () => setThemeModeState(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    window.addEventListener('theme-mode-change', syncTheme)
    syncTheme()
    return () => window.removeEventListener('theme-mode-change', syncTheme)
  }, [])

  // Initialize theme: use whitelabel theme from admin when present, else localStorage/default
  useEffect(() => {
    initializeThemeMode()
  }, [])
  useEffect(() => {
    if (parsedSettings.whitelabelTheme?.primary) {
      // Whitelabel primary from admin is applied by AppSettingsProvider; don't overwrite with localStorage
      return
    }
    initializeTheme()
  }, [parsedSettings.whitelabelTheme?.primary])

  // Safety valve: if isLoading stays true longer than MAX_LOADING_MS, force-render the app
  useEffect(() => {
    if (!isLoading) return
    const timer = setTimeout(() => {
      console.warn('[App] Loading exceeded', MAX_LOADING_MS, 'ms — force-rendering app')
      setForceReady(true)
    }, MAX_LOADING_MS)
    return () => clearTimeout(timer)
  }, [isLoading])

  // Reset forceReady when loading finishes normally
  useEffect(() => {
    if (!isLoading) setForceReady(false)
  }, [isLoading])

  // Auto-open register modal if there's a referral code in URL and user is not authenticated.
  // Respect the whitelabel registerEnabled flag — never auto-open register when disabled.
  const registerEnabled = parsedSettings.features.registerEnabled ?? true
  useEffect(() => {
    if ((isLoading && !forceReady) || isAuthenticated || !registerEnabled) return

    try {
      const params = new URLSearchParams(window.location.search)
      const refCode = params.get('ref') || params.get('affiliateCode')
      if (refCode) {
        setTimeout(() => {
          openAuthModal('register')
        }, 300)
      }
    } catch (_) {
      // Ignore errors
    }
  }, [isLoading, forceReady, isAuthenticated, openAuthModal, registerEnabled])

  // Show loading skeleton while settings are loading (with safety valve)
  if (isLoading && !forceReady) {
    return (
      <>
        <AppLoadingSkeleton />
        <Toaster 
          position="top-right" 
          richColors={false} 
          closeButton 
          theme={themeMode}
          expand={true}
          visibleToasts={4}
          duration={4000}
          gap={12}
          offset={16}
          toastOptions={{
            style: {
              borderRadius: '5px',
            },
          }}
        />
      </>
    )
  }

  // Block rendering if maintenance mode is enabled (but wait for settings to load)
  if (parsedSettings.maintenance) {
    return (
      <>
        <MaintenanceMode />
        <LoginModal />
        <RegisterModal />
        {isAuthenticated && user?.requirePasswordReset && (
          <ChangePasswordModal isOpen={true} forced onClose={() => {}} />
        )}
        <Toaster 
          position="top-right" 
          richColors={false} 
          closeButton 
          theme={themeMode}
          expand={true}
          visibleToasts={4}
          duration={4000}
          gap={12}
          offset={16}
          toastOptions={{
            style: {
              borderRadius: '5px',
            },
          }}
        />
      </>
    )
  }

  return (
    <>
      <SyncLocaleFromSettings />
      <MaintenanceMode />
      <Outlet />
      <LoginModal />
      <RegisterModal />
      {isAuthenticated && user?.requirePasswordReset && (
        <ChangePasswordModal isOpen={true} forced onClose={() => {}} />
      )}
      <SettingsDebugger />
      <Toaster 
        position="top-right" 
        richColors={false} 
        closeButton 
        theme={themeMode}
        expand={true}
        visibleToasts={4}
        duration={4000}
        gap={12}
        offset={16}
        toastOptions={{
          style: {
            borderRadius: '5px',
          },
        }}
      />
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppSettingsProvider>
        <AppContent />
      </AppSettingsProvider>
    </AuthProvider>
  )
}
