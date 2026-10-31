export default function LoadingSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`skeleton-stake rounded ${className}`} />
  )
}

