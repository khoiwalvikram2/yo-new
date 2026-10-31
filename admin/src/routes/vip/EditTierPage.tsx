import { RBACGuard } from '@/shared/core/RBACGuard'
import { VIPTierEditContent } from './VIPTierEditor'

export default function VIPEditTierPage() {
  return <RBACGuard required={[{ domain: 'vip.tiers', actions: ['update'] }]}><VIPTierEditContent /></RBACGuard>
}
