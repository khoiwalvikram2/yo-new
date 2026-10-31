import { toast, type ToastTone } from '@/ui/components/toast'

interface CampaignMessage { message: string; description?: string }
function report(tone: ToastTone, options: CampaignMessage) {
  toast({ tone, title: options.description ? options.message : undefined, message: options.description || options.message })
}
/** Retains existing campaign feedback copy while routing it through the shared kit host. */
export const bonusNotification = {
  success: (options: CampaignMessage) => report('ok', options),
  error: (options: CampaignMessage) => report('error', options),
  warning: (options: CampaignMessage) => report('warn', options),
  info: (options: CampaignMessage) => report('info', options),
}

export interface BonusGameRow {
  id: string
  name?: string
  thumbnailUrl?: string
  vendorName?: string
  vendorId?: string
  slug?: string
  mainCategory?: string
}
export interface BonusMatkaRow {
  id: string
  name?: string
  code?: string
  status?: string
  timezone?: string
}
export interface BonusBundle {
  id: string
  name?: string
  domain?: string
  description?: string
  gameIds?: string[]
  gameWeights?: Record<string, number>
  gameCount?: number
  createdAt?: string
  updatedAt?: string
}
