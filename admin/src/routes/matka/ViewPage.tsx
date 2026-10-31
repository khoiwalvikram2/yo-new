import { Link, useNavigate, useParams } from 'react-router-dom'
import { IconListSearch } from '@tabler/icons-react'
import { useMatka, useSetMatkaStatus, useCloneMatka } from '../../modules/matka'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { Card } from '@/ui/components/Card'
import { CodeBlock } from '@/ui/components/CodeBlock'
import { DescriptionList, type DescriptionListItem } from '@/ui/components/DescriptionList'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  MATKA_DETAILS_TITLE,
  cloneMatkaVariables,
  matkaFacts,
  matkaJsonBlocks,
  matkaLoadErrorText,
  matkaStatusAction,
  matkaStatusVariables,
  type MatkaDetail,
} from './matkaViewModel'
import styles from './ViewPage.module.css'

export default function MatkaViewPage() {
  return (
    <RBACGuard required={[{ domain: 'matka.management', actions: ['view'] }]}>
      <MatkaViewPageContent />
    </RBACGuard>
  )
}

function MatkaViewPageContent() {
  const { id } = useParams()
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const { data, loading, error, refetch } = useMatka(id || '')
  const [setStatus, { loading: changing }] = useSetMatkaStatus()
  const [cloneMatka, { loading: cloning }] = useCloneMatka()

  const m = data?.matka as MatkaDetail | null | undefined
  if (loading) {
    return (
      <Page>
        <LoadingState label="Loading matka" />
      </Page>
    )
  }

  if (!m) {
    return (
      <Page>
        <PageHeader eyebrow={pageEyebrow} title={MATKA_DETAILS_TITLE} />
        <Card as="div" body="flush">
          {error ? (
            <div className={styles.state}>
              <Notice
                tone="error"
                live="polite"
                action={<Button size="sm" onClick={() => void refetch()}>Retry</Button>}
              >
                {matkaLoadErrorText(error)}
              </Notice>
            </div>
          ) : (
            <EmptyState title="Not found" icon={<IconListSearch size={20} stroke={strokeFor(20)} />} />
          )}
        </Card>
      </Page>
    )
  }

  const statusAction = matkaStatusAction(m.status)

  /* As before: the mutation is awaited, then the list opens (clone) or the matka reloads (status). A
     rejected mutation stops there as an unhandled rejection with nothing shown on the page, exactly as
     the legacy buttons did (the Apollo links raise no toast for a failed mutation). */
  const cloneAndOpenList = async () => {
    await cloneMatka({ variables: cloneMatkaVariables(m) })
    navigate('/matka/list')
  }
  const changeStatus = async () => {
    await setStatus({ variables: matkaStatusVariables(m.id, statusAction.toStatus) })
    refetch()
  }

  const items: DescriptionListItem[] = matkaFacts(m).map((fact) => ({
    key: fact.key,
    term: fact.term,
    value: fact.key === 'status' && fact.value
      ? <StatusPill status={fact.value}>{fact.value}</StatusPill>
      : fact.value,
  }))

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        title={m.name}
        actions={(
          <>
            <Link to={`/matka/edit/${m.id}`} className={buttonClassName({ variant: 'secondary' })}>
              Edit
            </Link>
            <Button onClick={() => void cloneAndOpenList()} loading={cloning}>
              Clone
            </Button>
            <Button variant={statusAction.variant} onClick={() => void changeStatus()} loading={changing}>
              {statusAction.label}
            </Button>
          </>
        )}
      />

      <Card as="div" body="flush">
        <div className={styles.details}>
          <DescriptionList items={items} />
          <div className={styles.blocks}>
            {matkaJsonBlocks(m).map((block) => (
              <CodeBlock key={block.key} className={styles.code} label={block.label} code={block.code} wrap />
            ))}
          </div>
        </div>
      </Card>
    </Page>
  )
}
