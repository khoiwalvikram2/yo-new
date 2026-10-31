import LoadingSkeleton from './LoadingSkeleton'

export default function AppLoadingSkeleton() {
  return (
    <div className="app-loading-skeleton min-h-screen bg-[color:var(--ds-color-slate-950)]">
      {/* Topbar skeleton – stake slate */}
      <div className="border-b border-[color:var(--ds-color-slate-700)] bg-[color:var(--ds-color-slate-900)]">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <LoadingSkeleton className="h-8 w-24 max-w-full shrink-0 sm:w-32" />
            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <LoadingSkeleton className="h-8 w-12 sm:w-20" />
              <LoadingSkeleton className="h-8 w-12 sm:w-20" />
              <LoadingSkeleton className="h-8 w-8 rounded-[5px]" />
            </div>
          </div>
        </div>
      </div>

      {/* Main content skeleton */}
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-8">
        <div className="space-y-6">
          {/* Hero section */}
          <div className="space-y-4">
            <LoadingSkeleton className="h-12 w-64 max-w-full" />
            <LoadingSkeleton className="h-6 w-96 max-w-full" />
            <div className="flex flex-wrap gap-4">
              <LoadingSkeleton className="h-10 w-32" />
              <LoadingSkeleton className="h-10 w-32" />
            </div>
          </div>

          {/* Cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="rounded-lg border border-[color:var(--ds-color-slate-700)] p-6 space-y-4 bg-[color:var(--ds-color-slate-900)]/50">
                <LoadingSkeleton className="h-6 w-3/4" />
                <LoadingSkeleton className="h-4 w-full" />
                <LoadingSkeleton className="h-4 w-5/6" />
                <LoadingSkeleton className="h-10 w-full" />
              </div>
            ))}
          </div>

          {/* Feature sections */}
          <div className="space-y-4">
            <LoadingSkeleton className="h-8 w-48" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <LoadingSkeleton key={i} className="h-24 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer skeleton */}
      <div className="border-t border-[color:var(--ds-color-slate-700)] bg-[color:var(--ds-color-slate-900)] mt-16">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-4">
                <LoadingSkeleton className="h-5 w-32" />
                <LoadingSkeleton className="h-4 w-full" />
                <LoadingSkeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

