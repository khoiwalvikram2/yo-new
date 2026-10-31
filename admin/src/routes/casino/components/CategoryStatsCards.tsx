import { useMemo } from 'react'
import { useQuery } from '@apollo/client'
import {
  IconChartBar,
  IconDeviceGamepad2,
  IconFolders,
  IconStar,
} from '@tabler/icons-react'
import { CASINO_CUSTOM_CATEGORIES } from '@/lib/graphql/casino'
import { Stat } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import {
  categoryStats,
  type CasinoCustomCategoriesData,
  type MainCategory,
  type TypeFilter,
} from '../categoriesManagementModel'
import styles from '../CategoriesManagementPage.module.css'

export interface CategoryStatsCardsProps {
  mainCategory: MainCategory
  typeFilter: TypeFilter
}

export function CategoryStatsCards({ mainCategory, typeFilter }: CategoryStatsCardsProps) {
  const { data, loading } = useQuery<CasinoCustomCategoriesData>(CASINO_CUSTOM_CATEGORIES, {
    variables: { mainCategory },
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const stats = useMemo(
    () => categoryStats(data?.casinoCustomCategories ?? [], typeFilter),
    [data, typeFilter],
  )

  const pending = loading && !data

  return (
    <section className={styles.statsWrap} aria-label="Category statistics">
      <div className={styles.statsGrid} aria-busy={pending || undefined}>
        <Stat
          label="Total Categories"
          value={stats.totalCategories}
          note={`${stats.activeCategories} active, ${stats.inactiveCategories} inactive`}
          hue="blu"
          icon={<IconFolders size={18} stroke={strokeFor(18)} />}
          loading={pending}
        />
        <Stat
          label="Total Games"
          value={stats.totalGames}
          note={`Across ${stats.totalCategories} categories`}
          hue="vio"
          icon={<IconDeviceGamepad2 size={18} stroke={strokeFor(18)} />}
          loading={pending}
        />
        <Stat
          label="Featured"
          value={stats.featuredCount}
          note={`${stats.topCount} top`}
          hue="amb"
          icon={<IconStar size={18} stroke={strokeFor(18)} />}
          loading={pending}
        />
        <Stat
          label="Active Rate"
          value={`${stats.activeRate}%`}
          note={`${stats.activeCategories} of ${stats.totalCategories}`}
          hue="grn"
          icon={<IconChartBar size={18} stroke={strokeFor(18)} />}
          loading={pending}
        />
      </div>
    </section>
  )
}
