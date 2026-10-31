import { useQuery } from '@apollo/client'
import { IconCategory, IconChartLine, IconShieldHalf, IconUsers } from '@tabler/icons-react'
import { ROLES_QUERY } from '@/lib/graphql/roles'
import { strokeFor } from '@/ui/components/icons'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Stat } from '@/ui/components/Stat'
import { roleStats, type StatsRole } from '../rolesManagementModel'

const ICON_SIZE = 18

/* The four legacy figures over every role the query returns (the search never touches them), on the kit
   Stat. The query is this component's own, as before. The legacy Active Rate bar never rendered
   (DashboardStatCard draws it only when `tight` is false, and it defaults to true), so no Meter replaces it.
   Hues are the decorative ramp, never a status; the legacy grey tile takes the neutral indigo. */
export function StatsCards() {
  const { data, loading } = useQuery(ROLES_QUERY, {
    errorPolicy: 'all',
  })

  const roles: StatsRole[] = data?.roles ?? []
  const { totalRoles, totalPermissions, activeRoles, domains, avgPermissionsPerRole } = roleStats(roles)
  // Until the first answer the cards hold their height with placeholders; a refetch keeps the last figures.
  const pending = loading && !data

  return (
    <Grid cols={{ base: 1, md: 2, xl: 4 }} gap={12} role="group" aria-label="Role statistics" aria-busy={pending || undefined}>
      <Stat
        label="Total Roles"
        value={totalRoles}
        note={`${activeRoles} active`}
        icon={<IconUsers size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
        hue="blu"
        loading={pending}
      />
      <Stat
        label="Total Permissions"
        value={totalPermissions}
        note={`${avgPermissionsPerRole} avg/role`}
        icon={<IconShieldHalf size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
        hue="grn"
        loading={pending}
      />
      <Stat
        label="Domains"
        value={domains}
        note={`${totalRoles} roles`}
        icon={<IconCategory size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
        hue="ind"
        loading={pending}
      />
      <Stat
        label="Active Rate"
        value="100%"
        note={`${activeRoles} of ${totalRoles}`}
        icon={<IconChartLine size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
        hue="blu"
        loading={pending}
      />
    </Grid>
  )
}

