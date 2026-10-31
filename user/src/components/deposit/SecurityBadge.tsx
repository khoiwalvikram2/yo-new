import { Shield, Lock, CheckCircle2, FileCheck } from 'lucide-react'

interface SecurityFeature {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}

const securityFeatures: SecurityFeature[] = [
  {
    icon: Shield,
    title: 'Bank-Grade Encryption',
    description: '256-bit SSL encryption for all transactions',
  },
  {
    icon: Lock,
    title: 'Secure Payment Gateway',
    description: 'PCI DSS Level 1 certified processors',
  },
  {
    icon: CheckCircle2,
    title: 'Verified Security',
    description: 'Regular security audits & compliance checks',
  },
  {
    icon: FileCheck,
    title: 'Transaction Verification',
    description: 'Multi-layer verification for safety',
  },
]

export function SecurityBadge() {
  return (
    <div className="rounded-2xl border border-[color:var(--ds-color-slate-600)] bg-[color:var(--ds-color-slate-800)] p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-[color:var(--ds-color-slate-750)] border border-[color:var(--ds-color-slate-600)] flex items-center justify-center">
          <Shield className="h-6 w-6 text-[color:var(--ds-color-slate-300)]" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-[color:var(--ds-color-slate-100)]">
            Enterprise Security
          </h3>
          <p className="text-xs text-[color:var(--ds-color-slate-400)]">
            Your transactions are protected
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {securityFeatures.map((feature, index) => {
          const Icon = feature.icon
          return (
            <div
              key={index}
              className="flex items-start gap-3 p-3 rounded-lg bg-[color:var(--ds-color-slate-750)] border border-[color:var(--ds-color-slate-600)] hover:border-[color:var(--ds-color-slate-500)] transition-colors"
            >
              <div className="mt-0.5 w-8 h-8 rounded-lg bg-[color:var(--ds-color-slate-650)] flex items-center justify-center flex-shrink-0">
                <Icon className="h-4 w-4 text-[color:var(--ds-color-slate-300)]" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[color:var(--ds-color-slate-100)] mb-0.5">
                  {feature.title}
                </p>
                <p className="text-[10px] text-[color:var(--ds-color-slate-400)] leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

