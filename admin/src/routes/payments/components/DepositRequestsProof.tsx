import { useRef, useState } from 'react'
import { useQuery } from '@apollo/client'
import { IconPhoto, IconRefresh } from '@tabler/icons-react'
import clsx from 'clsx'
import { DEPOSIT_REQUEST_PROOF } from '@/lib/graphql/deposits'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { ImagePreview } from '@/ui/components/ImagePreview'
import { LoadingState } from '@/ui/components/LoadingState'
import { StoredImage } from '@/ui/components/StoredImage'
import { strokeFor } from '@/ui/components/icons'
import { depositProofImageSource } from '../depositRequestsModel'
import styles from './DepositRequestsProof.module.css'

const PROOF_ALT = 'Payment proof'
const LOADING_LABEL = 'Loading payment proof'

/**
 * One request's payment proof, read on demand. Screenshots live in the database since 2026-11-04 (up to 2 MB each), so
 * the list carries only hasProof and depositRequestProof answers one request's screenshot when a reviewer opens it:
 * when the review drawer shows the request, or when a row's proof is opened. 'no-cache' keeps the screenshots out of
 * the Apollo cache, so a day of reviewing does not pile them up in memory; each one goes with the view that read it.
 */
function useDepositRequestProof(requestId: string) {
  const { data, loading, error, refetch } = useQuery<{ depositRequestProof: string | null }>(DEPOSIT_REQUEST_PROOF, {
    variables: { id: requestId },
    fetchPolicy: 'no-cache',
    notifyOnNetworkStatusChange: true,
  })
  return {
    src: depositProofImageSource(data?.depositRequestProof),
    loading,
    failed: Boolean(error) && !loading,
    retry: () => {
      refetch().catch(() => {})
    },
  }
}

function ProofProblem({ className, onRetry }: { className: string; onRetry: () => void }) {
  return (
    <div className={clsx(className, styles.problem)} role="alert">
      <p>The payment proof could not be loaded.</p>
      <Button size="sm" icon={<IconRefresh size={15} stroke={strokeFor(15)} />} onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

/**
 * The review drawer's proof: the screenshot as a thumbnail that opens full size. It is read when the drawer shows it,
 * and the loading and failed states keep the thumbnail's box, so the drawer does not move when it lands.
 */
export function DepositRequestsProofPreview({ requestId }: { requestId: string }) {
  const { src, loading, failed, retry } = useDepositRequestProof(requestId)
  if (loading) return <LoadingState className={styles.thumbBox} label={LOADING_LABEL} height={112} />
  if (failed) return <ProofProblem className={styles.thumbBox} onRetry={retry} />
  // No image after all (the server answered none): the kit's placeholder, in the same box.
  return (
    <ImagePreview
      src={src ?? ''}
      alt={PROOF_ALT}
      dialogTitle={PROOF_ALT}
      openLabel="View payment proof"
      className={styles.preview}
    />
  )
}

/** The full view a row opens: read when it opens, in a frame that keeps one height while it loads. */
function DepositRequestsProofFull({ requestId }: { requestId: string }) {
  const { src, loading, failed, retry } = useDepositRequestProof(requestId)
  return (
    <div className={styles.fullFrame}>
      {loading ? (
        <LoadingState label={LOADING_LABEL} />
      ) : failed ? (
        <ProofProblem className={styles.thumbBox} onRetry={retry} />
      ) : (
        <StoredImage
          src={src}
          alt={PROOF_ALT}
          className={styles.fullImage}
          placeholderClassName={styles.missing}
          decoding="async"
        />
      )}
    </div>
  )
}

/**
 * A list row's proof: a button, not a thumbnail, so a page of requests reads no screenshot. Pressing it opens the
 * proof full size and reads that one request's screenshot.
 */
export function DepositRequestsProofButton({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={triggerRef}
        size="sm"
        icon={<IconPhoto size={15} stroke={strokeFor(15)} />}
        aria-label={`View payment proof for deposit ${requestId}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        View
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Payment proof - #${requestId}`}
        size="lg"
        themeFrom={triggerRef}
        restoreFocusTo={triggerRef}
      >
        {open ? <DepositRequestsProofFull requestId={requestId} /> : null}
      </Dialog>
    </>
  )
}
