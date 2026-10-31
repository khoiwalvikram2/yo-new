import { RBACGuard } from '@/shared/core/RBACGuard'
import { VIPTierCreateContent } from './VIPTierEditor'

export default function VIPCreateTierPage() {
  return <RBACGuard required={[{ domain: 'vip.tiers', actions: ['create'] }]}><VIPTierCreateContent /></RBACGuard>
}
