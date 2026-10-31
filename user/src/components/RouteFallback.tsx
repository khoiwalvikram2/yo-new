import LoadingSkeleton from './LoadingSkeleton'

/**
 * Shown while a lazily-loaded route chunk is being fetched.
 * Kept deliberately light so it renders instantly and does not shift layout.
 */
export default function RouteFallback() {
  return (
    <div className="space-y-4 py-6" role="status" aria-label="Loading page">
      <LoadingSkeleton className="h-8 w-48" />
      <LoadingSkeleton className="h-40 w-full" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <LoadingSkeleton className="h-28 w-full" />
        <LoadingSkeleton className="h-28 w-full" />
        <LoadingSkeleton className="h-28 w-full" />
      </div>
    </div>
  )
}
