import { useRef, useState } from 'react'
import { IconCheck, IconInfoCircle, IconRotate } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Drawer } from '@/ui/components/Drawer'
import { strokeFor } from '@/ui/components/icons'
import { ResultEntryForm, type ResultEntryFormRef } from './ResultEntryForm'
import styles from '../ManualResultsPage.module.css'

interface DeclareResultDrawerProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  restoreFocusTo?: { readonly current: HTMLElement | null }
}

export function DeclareResultDrawer({ open, onClose, onSuccess, restoreFocusTo }: DeclareResultDrawerProps) {
  const [loading, setLoading] = useState(false)
  const [canSubmit, setCanSubmit] = useState(false)
  const formRef = useRef<ResultEntryFormRef>(null)

  return (
    <Drawer
      title="Declare Sports Result"
      size="md"
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      themeFrom={restoreFocusTo}
      restoreFocusTo={restoreFocusTo}
      footer={(
        <div className={styles.drawerFooter}>
          <p className={styles.footerHint}>
            <IconInfoCircle size={15} stroke={strokeFor(15)} aria-hidden="true" />
            Declare results for sports markets and events
          </p>
          <div className={styles.footerActions}>
            <Button
              size="sm"
              icon={<IconRotate size={15} stroke={strokeFor(15)} />}
              onClick={() => formRef.current?.reset()}
            >
              Reset
            </Button>
            <Button size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              icon={<IconCheck size={15} stroke={strokeFor(15)} />}
              loading={loading}
              aria-disabled={!canSubmit || undefined}
              onClick={() => formRef.current?.submit()}
            >
              Declare Result
            </Button>
          </div>
        </div>
      )}
    >
      <ResultEntryForm
        ref={formRef}
        onSuccess={() => {
          onSuccess?.()
          onClose()
        }}
        onLoadingChange={setLoading}
        onCanSubmitChange={setCanSubmit}
      />
    </Drawer>
  )
}
