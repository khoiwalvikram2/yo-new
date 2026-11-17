import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMatka } from '@/modules/matka'
import { MatkaWhitelabelGate } from '@/modules/matka/MatkaWhitelabelGate'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { SettingsEditor } from './components/SettingsDrawer'
import { useSaveMatkaSettings } from './useSaveMatkaSettings'
import type { DrawerStatus, MatkaRecord, SettingsValues } from './matkaManagementModel'
import styles from './SettingsPage.module.css'

const ACCESS_REQUIREMENT = [{ domain: 'matka.management', actions: ['view', 'update'] }]
const LIST_PATH = '/matka/management'
const PAGE_TITLE = 'Edit Matka Settings'

// A Super Admin in core mode is asked for a whitelabel: the page read the platform's own tenant ('default'), which
// called a real market not found, and a save there would land where no whitelabel sees it.
export default function MatkaSettingsPage() {
  return <RBACGuard required={ACCESS_REQUIREMENT}><MatkaWhitelabelGate title={PAGE_TITLE}><MatkaSettingsPageContent /></MatkaWhitelabelGate></RBACGuard>
}

function MatkaSettingsPageContent() {
  const { id = '' } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const eyebrow = usePageEyebrow()
  const { data, loading, error, refetch } = useMatka(id)
  const matka = data?.matka as MatkaRecord | null | undefined
  const { save } = useSaveMatkaSettings()
  const [saving, setSaving] = useState(false)
  const [active, setActive] = useState<DrawerStatus>(true)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)

  const persist = async (values: SettingsValues) => {
    if (!matka) return
    setSaving(true)
    setSaveError(''); setSaved(false)
    try {
      await save([matka], active, values)
      await refetch()
      setSaved(true)
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'Could not save settings. Please try again.')
      throw failure
    } finally {
      setSaving(false)
    }
  }

  return <Page maxWidth="wide" className={styles.page}>
    <PageHeader eyebrow={eyebrow} title={PAGE_TITLE}
      meta={matka ? `${matka.name} (${matka.code})` : undefined}
      back={{ label: 'Back to Matka Management', onClick: () => navigate(LIST_PATH), disabled: saving }} />
    <div className={styles.content}>
      {loading && !matka ? <Notice live="polite">Loading matka settings...</Notice>
        : error ? <Notice tone="error" title="Could not load matka settings" action={<Button onClick={() => void refetch()}>Try again</Button>}>{error.message}</Notice>
          : !matka ? <Notice title="Matka not found">Return to Matka Management and choose an available market.</Notice>
            : <>
              {saveError && <Notice tone="error" live="assertive" title="Settings could not be saved">{saveError}</Notice>}
              {saved && <Notice tone="ok" live="polite">Settings saved successfully.</Notice>}
              <SettingsEditor key={matka.id} presentation="page" open mode="single" matka={matka} selectedMatkas={[]}
                drawerActive={active} setDrawerActive={setActive} saving={saving} initialTab={params.get('tab') || 'stake'}
                onTabChange={tab => setParams(current => { const next = new URLSearchParams(current); next.set('tab', tab); return next.toString() }, { replace: true })}
                onClose={() => navigate(LIST_PATH)} onSave={persist} />
            </>}
    </div>
  </Page>
}
