import { Dices, Gamepad2, Home, Trophy, type LucideIcon } from 'lucide-react'

type PopularFeatures = { sportsEnabled?: boolean; casinoEnabled?: boolean; matkaEnabled?: boolean }
type PopularItem = {
  key: string
  to: string
  labelKey: string
  defaultLabel?: string
  icon: LucideIcon
  feature?: keyof PopularFeatures
}

const POPULAR_ITEMS: readonly PopularItem[] = [
  { key: 'home', to: '/', labelKey: 'nav.home', icon: Home },
  { key: 'sports', to: '/sports', labelKey: 'nav.sports', icon: Trophy, feature: 'sportsEnabled' },
  { key: 'matka', to: '/matka', labelKey: 'nav.matka', defaultLabel: 'Matka', icon: Dices, feature: 'matkaEnabled' },
  { key: 'casino', to: '/casino', labelKey: 'nav.liveCasino', icon: Dices, feature: 'casinoEnabled' },
  { key: 'slots', to: '/slots', labelKey: 'nav.slots', icon: Gamepad2, feature: 'casinoEnabled' },
]

/** Both Popular menus follow the same product permissions and ordering. */
export function getPopularNavigation(features: PopularFeatures) {
  return POPULAR_ITEMS.filter(item => !item.feature || features[item.feature])
}
