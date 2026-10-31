import { useMaintenanceMode } from '../hooks/useAppSettings'

export default function MaintenanceMode() {
  const { isMaintenance, message } = useMaintenanceMode()

  if (!isMaintenance) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[color:var(--surface)]/95 backdrop-blur-sm">
      <div className="max-w-md mx-4 p-8 rounded-2xl bg-[color:var(--surface)] border border-[color:var(--border)] shadow-2xl text-center">
        <div className="mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-[5px] bg-[color:var(--brand-primary)]/10 mb-4">
            <svg
              className="w-8 h-8 text-[color:var(--brand-primary)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[color:var(--text)] mb-2">
            Under Maintenance
          </h1>
          <p className="text-[color:var(--subtle)]">
            {message || 'We are currently performing scheduled maintenance. Please check back soon.'}
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 text-sm text-[color:var(--subtle)]">
          <svg
            className="w-4 h-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>We'll be back shortly</span>
        </div>
      </div>
    </div>
  )
}

