import { CasinoDashboard } from './CasinoDashboard'
import { CasinoStatsCards } from './components/CasinoStatsCards'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import styles from './ManagementPage.module.css'

export default function ManagementPage() {
  return (
    <RBACGuard required={[{ domain: 'casino.management', actions: ['view'] }]}>
      <ManagementPageContent />
    </RBACGuard>
  )
}

function ManagementPageContent() {
  const eyebrow = usePageEyebrow()
  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={eyebrow}
        title="Casino Management"
        sub="Manage games by provider, category, and vendor"
      />
      <div className={styles.page}>
        <CasinoStatsCards />
        <CasinoDashboard />
      </div>
    </Page>
  )
}

