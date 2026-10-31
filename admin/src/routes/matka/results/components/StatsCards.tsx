import { useMemo } from 'react'
import { IconArrowBackUp, IconChevronsRight, IconCircleCheck, IconList } from '@tabler/icons-react'
import { useMatkaResults } from '../../../../modules/matka/results'
import type { MatkaResult } from '../../../../modules/matka/results/types'
import { formatInTimeZone, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import { strokeFor } from '@/ui/components/icons'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Stat, type StatHue } from '@/ui/components/Stat'
import {
  computeMatkaResultStats,
  matkaResultStatCards,
  type MatkaResultStatCard,
} from '../matkaResultsModel'

type IconComponent = typeof IconList

/* The legacy card glyphs (list, check, double chevron, rollback) on the decorative hue ramp; the grey
   legacy card takes the violet step because the ramp has no grey (as Task 144 did). */
const CARD_LOOK: Record<MatkaResultStatCard['key'], { icon: IconComponent; hue: StatHue }> = {
  total: { icon: IconList, hue: 'blu' },
  open: { icon: IconCircleCheck, hue: 'grn' },
  close: { icon: IconChevronsRight, hue: 'vio' },
  rolledBack: { icon: IconArrowBackUp, hue: 'red' },
}

export function StatsCards() {
  // Independent of the page filters: the first 1,000 results feed the figures, as before.
  const { data, loading } = useMatkaResults({ limit: 1000 })
  const results: MatkaResult[] = useMemo(() => data?.matkaResults?.items ?? [], [data?.matkaResults?.items])

  const stats = useMemo(
    () => computeMatkaResultStats(results, formatInTimeZone(new Date(), 'yyyy-MM-dd', DEFAULT_ADMIN_TZ)),
    [results],
  )

  // Until the first answer the cards hold their height with placeholders; a refetch keeps the last figures.
  const pending = loading && !data

  return (
    <Grid cols={{ base: 1, md: 2, xl: 4 }} gap={12} role="group" aria-label="Matka result statistics" aria-busy={pending || undefined}>
      {matkaResultStatCards(stats).map((card) => {
        const { icon: Icon, hue } = CARD_LOOK[card.key]
        return (
          <Stat
            key={card.key}
            label={card.label}
            value={card.value}
            note={card.note}
            icon={<Icon size={18} stroke={strokeFor(18)} />}
            hue={hue}
            loading={pending}
          />
        )
      })}
    </Grid>
  )
}

