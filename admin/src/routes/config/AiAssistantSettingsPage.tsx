import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { IconAlertCircle } from '@tabler/icons-react'
import { AI_WHITELABEL_SETTINGS, SET_AI_WHITELABEL_SETTINGS, WHITELABELS_FOR_AI } from '@/lib/graphql/aiAssistant'
import { notify } from '@/shared/services/notification'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Meter } from '@/ui/components/Meter'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Select } from '@/ui/components/Select'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { strokeFor } from '@/ui/components/icons'
import {
  LOAD_FAILED_TITLE,
  PERIODS,
  SAVED_TITLE,
  SAVE_FAILED_TITLE,
  boundedAllowanceStep,
  draftValue,
  isDirty,
  loadErrorText,
  saveVariables,
  savedMessage,
  settingsRows,
  stepDirection,
  storedState,
  usage,
  withAllowanceClamped,
  withEdit,
  withTypedAllowance,
  withoutDraft,
  type AiSettingsDrafts,
  type AiSettingsRow,
} from './aiAssistantSettingsModel'
import styles from './AiAssistantSettingsPage.module.css'

const TITLE = 'AI assistant access'
const SUB =
  'Choose which whitelabels may use the portal assistant and how many messages each may send. Every message costs money at the provider, so access is off and the allowance is zero until you grant them.'
const ICON_SIZE = 18

/**
 * Super Admin control over which whitelabels may use the assistant, and how
 * much each may spend.
 *
 * Every message costs money at the provider, so both gates start closed: a
 * whitelabel with no row here, or an allowance of zero, cannot chat at all.
 * Granting access is always a deliberate act.
 */
export default function AiAssistantSettingsPage() {
  const pageEyebrow = usePageEyebrow()
  const { data, loading, error, refetch } = useQuery(AI_WHITELABEL_SETTINGS, { fetchPolicy: 'cache-and-network' })
  const { data: whitelabelData } = useQuery(WHITELABELS_FOR_AI, { fetchPolicy: 'cache-first' })

  /** Edits held locally until saved, so a half-typed limit is never applied. */
  const [drafts, setDrafts] = useState<AiSettingsDrafts>({})

  const [save, { loading: saving }] = useMutation(SET_AI_WHITELABEL_SETTINGS, {
    onCompleted: (result) => {
      const row = result.setAiWhitelabelSettings
      notify.success(savedMessage(row), SAVED_TITLE)
      setDrafts((prev) => withoutDraft(prev, row.tenant))
      refetch()
    },
    onError: (err) => notify.error(err.message, SAVE_FAILED_TITLE),
  })

  /**
   * Whitelabels that have never been configured still need a row, otherwise
   * there is no way to grant them anything from this screen.
   *
   * No row is shown until the settings have answered: the whitelabel list is
   * often already cached, and before the answer every whitelabel would read as
   * a closed default row (Off, 0) with live controls, so a Save there would
   * overwrite a configured allowance. The first load shows the loading state,
   * as the legacy spinner overlay blocked the table.
   */
  const rows: AiSettingsRow[] = useMemo(
    () => (data ? settingsRows(data.aiWhitelabelSettings, whitelabelData?.whitelabels) : []),
    [data, whitelabelData],
  )

  const update = (tenant: string, patch: Partial<AiSettingsRow>) => setDrafts((prev) => withEdit(prev, tenant, patch))

  const commit = (row: AiSettingsRow) => save({ variables: saveVariables(row, drafts) })

  const header = <PageHeader eyebrow={pageEyebrow} title={TITLE} sub={SUB} />

  if (error) {
    return (
      <Page>
        {header}
        <Notice
          tone="error"
          icon={<IconAlertCircle size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />}
          title={LOAD_FAILED_TITLE}
        >
          {loadErrorText(error.message)}
        </Notice>
      </Page>
    )
  }

  const columns: DataTableColumn<AiSettingsRow>[] = [
    {
      key: 'whitelabel',
      header: 'Whitelabel',
      cell: (row) => (
        <span className={styles.whitelabel}>
          <span className={styles.tenant}>{row.tenant}</span>
          {row.updatedBy ? <span className={styles.changedBy}>last changed by {row.updatedBy}</span> : null}
        </span>
      ),
    },
    {
      key: 'access',
      header: 'Access',
      width: 110,
      cell: (row) => (
        <Switch
          label={`Access for ${row.tenant}`}
          hideLabel
          checked={Boolean(draftValue(row, drafts, 'enabled'))}
          onChange={(enabled) => update(row.tenant, { enabled })}
        />
      ),
    },
    {
      key: 'allowance',
      header: 'Allowance',
      width: 130,
      cell: (row) => (
        <NumberField
          className={styles.fill}
          size="sm"
          label={`Allowance for ${row.tenant}`}
          hideLabel
          precision={0}
          value={Number(draftValue(row, drafts, 'chatLimit'))}
          // antd kept the allowance at 0 or above; the kit field reports what is typed, so each value is raised
          // here and again on blur, and an arrow step that would go below 0 is taken here and stops at 0.
          onChange={(chatLimit) => setDrafts((prev) => withTypedAllowance(prev, row, chatLimit))}
          onBlur={() => setDrafts((prev) => withAllowanceClamped(prev, row.tenant))}
          onKeyDown={(event) => {
            const direction = stepDirection(event.key)
            if (direction === null) return
            const current = Number(draftValue(row, drafts, 'chatLimit'))
            const next = boundedAllowanceStep(event.currentTarget.value, current, direction, event.shiftKey ? 10 : 1)
            if (next === null) return
            event.preventDefault()
            if (next !== current) update(row.tenant, { chatLimit: next })
          }}
        />
      ),
    },
    {
      key: 'renews',
      header: 'Renews',
      width: 150,
      cell: (row) => (
        <Select
          className={styles.fill}
          size="sm"
          label={`Renews for ${row.tenant}`}
          hideLabel
          options={PERIODS}
          value={String(draftValue(row, drafts, 'limitPeriod'))}
          onChange={(limitPeriod) => update(row.tenant, { limitPeriod })}
        />
      ),
    },
    {
      key: 'used',
      header: 'Used',
      width: 160,
      cell: (row) => {
        const used = usage(row)
        if (!used) return <span className={styles.dash}>—</span>
        return (
          <span className={styles.usage}>
            {/* The figure is printed under it, so the bar is decoration (the kit Meter's unlabelled form). */}
            <Meter value={used.percent} tone={used.tone} />
            <span className={styles.usageText}>{used.text}</span>
          </span>
        )
      },
    },
    {
      // The legacy untitled last column's Active/Off tags, now under a Status header so they are not read as
      // row actions; Save and Undo are the row actions.
      key: 'status',
      header: 'Status',
      width: 110,
      cell: (row) =>
        storedState(row) === 'active' ? (
          <StatusPill tone="ok">Active</StatusPill>
        ) : (
          <StatusPill tone="neutral">Off</StatusPill>
        ),
    },
  ]

  return (
    <Page>
      {header}
      <Card title={TITLE} body="table">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.tenant}
          label="Assistant access by whitelabel"
          state={loading ? 'loading' : 'ready'}
          width="wide"
          rowActions={(row) =>
            isDirty(drafts, row.tenant)
              ? {
                  primary: (
                    <span className={styles.rowActions}>
                      <Button
                        size="xs"
                        variant="primary"
                        aria-label={`Save ${row.tenant}`}
                        loading={saving}
                        onClick={() => void commit(row)}
                      >
                        Save
                      </Button>
                      <Button
                        size="xs"
                        aria-label={`Undo ${row.tenant}`}
                        onClick={() => setDrafts((prev) => withoutDraft(prev, row.tenant))}
                      >
                        Undo
                      </Button>
                    </span>
                  ),
                }
              : {}
          }
        />
      </Card>
    </Page>
  )
}
