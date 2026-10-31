import { useState } from 'react'
import { IconSettings } from '@tabler/icons-react'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Button } from '@/ui/components/Button'
import { SportsStatsCards } from './configuration-components/SportsStatsCards'
import { SportsDashboard } from './configuration-components/SportsDashboard'
import { DefaultStakeLimitsDrawer } from './configuration-components/DefaultStakeLimitsDrawer'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import styles from './configuration-components/SportsConfiguration.module.css'
export default function SportsConfigurationPage() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const permissions = useAuthStore(s => s.permissions) || []
  const roles = useAuthStore(s => s.roles) || []

  const isSuperAdmin = roles.some(role => {
    const roleLower = role.toLowerCase()
    return (
      role === 'Super Admin' ||
      roleLower === 'super_admin' ||
      (roleLower.includes('super') && roleLower.includes('admin'))
    )
  })

  const isWhitelabelAdmin = roles.some(role => {
    const roleLower = role.toLowerCase()
    return (
      role === 'Whitelabel Admin' ||
      roleLower === 'whitelabel_admin' ||
      roleLower.includes('whitelabel')
    )
  })

  const canUpdateSportsConfig = hasPermissionWithNested(permissions, 'sports.configuration', 'update')
  const canOpenDefaultSettings = canUpdateSportsConfig && isWhitelabelAdmin && !isSuperAdmin

  return (
    <RBACGuard required={[{ domain: 'sports.configuration', actions: ['view'] }]}>
    <Page maxWidth="none" className={styles.stack}>
      <PageHeader title="Sports Configuration" sub="Manage sports configuration and settings" actions={canOpenDefaultSettings && <Button icon={<IconSettings size={16} />} onClick={() => setDrawerOpen(true)}>Default Settings</Button>} />

      <SportsStatsCards />

      <SportsDashboard />

      {canOpenDefaultSettings ? (
        <DefaultStakeLimitsDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
    </Page>
    </RBACGuard>
  )
}

