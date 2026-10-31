import { useId, useRef, useState } from 'react'
import { IconCheck, IconInfoCircle, IconRotate } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Drawer } from '@/ui/components/Drawer'
import { strokeFor } from '@/ui/components/icons'
import { ResultsForm, type ResultsFormRef, type MatkaResultSelection } from './ResultsForm'
import styles from '../MatkaResultsPage.module.css'

interface DeclareResultDrawerProps {
  initialSelection?: MatkaResultSelection
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  /** The page control that opened the drawer; it takes focus back and lends its theme. */
  restoreFocusTo?: { readonly current: HTMLElement | null }
}

export function DeclareResultDrawer({ open, onClose, onSuccess, restoreFocusTo, initialSelection }: DeclareResultDrawerProps) {
  const [loading, setLoading] = useState(false)
  const [canSubmit, setCanSubmit] = useState(true)
  const formRef = useRef<ResultsFormRef>(null)
  const closeNoticeId = useId()

  const handleSubmit = () => {
    formRef.current?.submit()
  }

  const handleReset = () => {
    formRef.current?.reset()
  }

  // The kit Drawer renders nothing while closed, so the form starts afresh on every open (antd destroyOnClose).
  return (
    <Drawer
      title="Declare Matka Result"
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
            Declare open or close result for a Matka market
          </p>
          <div className={styles.footerActions}>
            <Button
              size="sm"
              onClick={handleReset}
              icon={<IconRotate size={15} stroke={strokeFor(15)} />}
            >
              Reset
            </Button>
            <Button
              size="sm"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={loading}
              aria-disabled={!canSubmit || undefined}
              aria-describedby={canSubmit ? undefined : closeNoticeId}
              onClick={handleSubmit}
              icon={<IconCheck size={15} stroke={strokeFor(15)} />}
            >
              Declare Result
            </Button>
          </div>
        </div>
      )}
    >
      <ResultsForm
        initialSelection={initialSelection}
        ref={formRef}
        closeNoticeId={closeNoticeId}
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

