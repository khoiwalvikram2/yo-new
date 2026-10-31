import { Clock, CheckCircle2, Loader2 } from 'lucide-react'

interface TimelineStep {
  label: string
  status: 'completed' | 'active' | 'pending'
  time?: string
}

interface ProcessingTimelineProps {
  steps?: TimelineStep[]
}

export function ProcessingTimeline({ steps }: ProcessingTimelineProps) {
  const defaultSteps: TimelineStep[] = steps || [
    { label: 'Request Submitted', status: 'completed', time: 'Instant' },
    { label: 'Payment Processing', status: 'active', time: '1-2 min' },
    { label: 'Verification', status: 'pending', time: '1-2 min' },
    { label: 'Funds Credited', status: 'pending', time: '1 min' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[color:var(--text)]">Processing Timeline</h4>
        <span className="text-[10px] text-[color:var(--subtle)] bg-[color:var(--surface-2)] px-2 py-1 rounded-[5px]">
          Est. 3-5 minutes
        </span>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-4 top-5 bottom-5 w-px bg-[color:var(--border)]" />
        
        {/* Steps */}
        <div className="space-y-4">
          {defaultSteps.map((step, index) => {
            const isLast = index === defaultSteps.length - 1
            const Icon = step.status === 'completed' ? CheckCircle2 : step.status === 'active' ? Loader2 : Clock

            return (
              <div key={index} className="relative flex items-start gap-4">
                {/* Step indicator */}
                <div className="relative z-10">
                  <div
                    className={`w-8 h-8 rounded-[5px] border-2 flex items-center justify-center transition-all ${
                      step.status === 'completed'
                        ? 'bg-emerald-500 border-emerald-500'
                        : step.status === 'active'
                        ? 'bg-blue-500 border-blue-500 animate-pulse'
                        : 'bg-[color:var(--surface-2)] border-[color:var(--border)]'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${
                        step.status === 'completed'
                          ? 'text-white'
                          : step.status === 'active'
                          ? 'text-white animate-spin'
                          : 'text-[color:var(--subtle)]'
                      }`}
                    />
                  </div>
                </div>

                {/* Step content */}
                <div className={`flex-1 pb-4 ${isLast ? 'pb-0' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p
                        className={`text-sm font-medium ${
                          step.status === 'pending'
                            ? 'text-[color:var(--subtle)]'
                            : 'text-[color:var(--text)]'
                        }`}
                      >
                        {step.label}
                      </p>
                      {step.status === 'active' && (
                        <p className="text-xs text-blue-400 mt-0.5">In progress...</p>
                      )}
                      {step.status === 'completed' && (
                        <p className="text-xs text-emerald-400 mt-0.5">Completed</p>
                      )}
                    </div>
                    {step.time && (
                      <span
                        className={`text-[10px] font-medium px-2 py-1 rounded ${
                          step.status === 'completed'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : step.status === 'active'
                            ? 'bg-blue-500/10 text-blue-400'
                            : 'bg-[color:var(--surface-2)] text-[color:var(--subtle)]'
                        }`}
                      >
                        {step.time}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Info banner */}
      <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
        <p className="text-xs text-blue-400 leading-relaxed">
          <strong>Note:</strong> Processing times may vary based on your payment method and bank processing schedules.
        </p>
      </div>
    </div>
  )
}

