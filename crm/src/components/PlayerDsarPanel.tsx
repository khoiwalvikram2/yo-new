import { useState } from 'react'
import { Alert, App, Button, Card, Input, Modal, Space, Typography } from 'antd'
import { DownloadOutlined, DeleteOutlined } from '@ant-design/icons'
import { useLazyQuery, useMutation } from '@apollo/client'
import { DSAR_EXPORT, DSAR_ERASE } from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

/**
 * Data subject requests, on the player they concern.
 *
 * Rendered only for someone holding a `crm.dsar` permission — in the seed that
 * is the CRM Administrator alone — so for almost every user this card simply
 * does not exist.
 *
 * The erase dialog demands the request reference before the button arms.
 * An erasure with no paper trail is indistinguishable from someone cleaning up
 * after themselves, and the server refuses it anyway; asking first means the
 * refusal is never what teaches someone the rule.
 */

export function PlayerDsarPanel({ playerId }: { playerId: string }) {
  const me = useAuth((s) => s.me)
  const { message } = App.useApp()
  const [eraseOpen, setEraseOpen] = useState(false)
  const [reason, setReason] = useState('')

  const mayExport = can(me, 'crm.dsar', 'export')
  const mayErase = can(me, 'crm.dsar', 'erase')

  const [runExport, { loading: exporting }] = useLazyQuery(DSAR_EXPORT, { fetchPolicy: 'network-only' })
  // Everything the erasure rewrites is on screen behind this dialog: the note
  // list, the contact history, the notification bell. Without refetching them
  // the success toast appeared over the very text it had just removed, which
  // reads as the erasure having silently failed.
  const [runErase, { loading: erasing }] = useMutation(DSAR_ERASE, {
    refetchQueries: ['CrmPlayerNotes', 'CrmContactAttempts', 'CrmMyNotifications', 'CrmPlayer'],
    awaitRefetchQueries: true,
  })

  if (!mayExport && !mayErase) return null

  const download = async () => {
    const res = await runExport({ variables: { playerId } })
    const out = res.data?.crmDsarExport
    if (!out) {
      message.error('Could not build the export')
      return
    }
    const blob = new Blob([out.json], { type: 'application/json;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = out.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    message.success('Export downloaded. The export itself has been recorded.')
  }

  const erase = async () => {
    const res = await runErase({ variables: { playerId, reason: reason.trim() } })
    const out = res.data?.crmDsarErase
    if (!out?.ok) {
      message.error(out?.error ?? 'Could not erase')
      return
    }
    message.success(
      `Redacted ${out.notesRedacted} note(s), ${out.contactNotesCleared} contact note(s), ${out.tasksRedacted} task(s)`
    )
    setEraseOpen(false)
    setReason('')
  }

  return (
    <Card size="small" title="Data requests">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text className="crm-muted" style={{ fontSize: 12 }}>
          A player’s right to a copy of their data, and to the removal of what was written about
          them. Both actions are recorded.
        </Typography.Text>
        <Space wrap>
          {mayExport && (
            <Button icon={<DownloadOutlined />} loading={exporting} onClick={download}>
              Export their data
            </Button>
          )}
          {mayErase && (
            <Button danger icon={<DeleteOutlined />} onClick={() => setEraseOpen(true)}>
              Erase free text
            </Button>
          )}
        </Space>
      </Space>

      <Modal
        open={eraseOpen}
        title="Erase free text about this player"
        onCancel={() => setEraseOpen(false)}
        okText="Erase"
        okButtonProps={{ danger: true, disabled: reason.trim().length < 5, loading: erasing }}
        onOk={erase}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="What this removes — and what it keeps"
            description="Note bodies, contact notes and task text are redacted; the rows stay. Responsible-gambling history, consent records and the exclusion register are kept — the law requires them, and the exclusion register is what keeps a self-excluded player excluded."
          />
          <div>
            <Typography.Text strong>Request reference</Typography.Text>
            <Input
              placeholder="e.g. DSAR-2026-014, or the ticket this answers"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ marginTop: 4 }}
            />
          </div>
        </Space>
      </Modal>
    </Card>
  )
}
