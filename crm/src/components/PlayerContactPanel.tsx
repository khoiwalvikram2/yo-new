import { useState } from 'react'
import {
  Card,
  Button,
  Modal,
  Form,
  Select,
  Input,
  Space,
  Tag,
  Empty,
  App,
  Alert,
} from 'antd'
import { PhoneOutlined } from '@ant-design/icons'
import { useQuery, useMutation } from '@apollo/client'
import { CONTACT_ATTEMPTS, RECORD_CONTACT, CONSENTS } from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

type Attempt = {
  id: string
  channel: string
  direction: string
  outcome: string
  notes: string | null
  byName: string
  occurredAt: string
}

const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

const OUTCOME_COLOUR: Record<string, string> = {
  connected: 'green',
  no_answer: 'default',
  voicemail: 'default',
  busy: 'default',
  wrong_number: 'orange',
  refused: 'red',
}

const OUTCOME_LABEL: Record<string, string> = {
  connected: 'Connected',
  no_answer: 'No answer',
  voicemail: 'Voicemail',
  busy: 'Busy',
  wrong_number: 'Wrong number',
  refused: 'Refused',
}

/**
 * What was tried, and what came of it.
 *
 * Attempts rather than sends: nothing in this process can message a player, so
 * what actually happens on a desk is somebody picking up the phone. Recording
 * it turns "we called twice, nobody answered" from hearsay into something the
 * next agent can read before calling a third time.
 */
export function PlayerContactPanel({ playerId }: { playerId: string }) {
  const me = useAuth((s) => s.me)
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()

  // Contact work is task work — the same permission the queue's own mutations
  // take, so a read-only role never sees a button whose write the API would
  // refuse anyway.
  const canLog = can(me, 'crm.tasks', 'manage')

  const { data, loading, refetch } = useQuery(CONTACT_ATTEMPTS, { variables: { playerId } })
  const { data: consentData } = useQuery(CONSENTS, {
    variables: { playerId },
    skip: !can(me, 'crm.consent', 'view'),
  })
  const [record, { loading: saving }] = useMutation(RECORD_CONTACT)

  const attempts: Attempt[] = data?.crmContactAttempts ?? []
  const unanswered = attempts.filter((a) => a.outcome !== 'connected').length

  // A player who withdrew consent on a channel should not be quietly called on
  // it. Surfaced here rather than blocked, because a service call about their
  // own withdrawal is legitimate — the operator needs to know, not be stopped.
  const withdrawn = new Set(
    (consentData?.crmPlayerConsents ?? [])
      .filter((c: { state: string; purpose: string }) => c.state !== 'GRANTED' && c.purpose === 'MARKETING')
      .map((c: { channel: string }) => c.channel)
  )

  return (
    <Card
      title="Contact"
      size="small"
      loading={loading}
      extra={
        canLog && (
          <Button size="small" icon={<PhoneOutlined />} onClick={() => setOpen(true)}>
            Log
          </Button>
        )
      }
    >
      {unanswered >= 3 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 10 }}
          message={`${unanswered} attempts without getting through`}
          description="Worth trying another channel, or asking whether the number is right."
        />
      )}

      {attempts.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nobody has tried yet" />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {attempts.map((a) => (
            <div key={a.id} style={{ borderTop: '1px solid var(--crm-border)', paddingTop: 6 }}>
              <Space size={6} wrap>
                <Tag>{a.channel}</Tag>
                <Tag color={OUTCOME_COLOUR[a.outcome] ?? 'default'}>
                  {OUTCOME_LABEL[a.outcome] ?? a.outcome}
                </Tag>
                {a.direction === 'in' && <Tag color="blue">They called us</Tag>}
              </Space>
              {a.notes && <div style={{ marginTop: 2 }}>{a.notes}</div>}
              <div className="crm-muted" style={{ fontSize: 12 }}>
                {a.byName} · {when(a.occurredAt)}
              </div>
            </div>
          ))}
        </Space>
      )}

      <Modal
        title="Log a contact attempt"
        open={open}
        onCancel={() => {
          setOpen(false)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="Save"
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ channel: 'CALL', direction: 'out', outcome: 'no_answer' }}
          onFinish={async (v) => {
            const res = await record({ variables: { playerId, ...v } })
            if (res.data?.crmRecordContactAttempt?.ok) {
              message.success('Logged')
              setOpen(false)
              form.resetFields()
              refetch()
            } else {
              message.error(res.data?.crmRecordContactAttempt?.error ?? 'Could not log it')
            }
          }}
        >
          <Form.Item
            noStyle
            shouldUpdate={(a, b) => a.channel !== b.channel}
          >
            {({ getFieldValue }) =>
              withdrawn.has(getFieldValue('channel')) ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="They withdrew marketing consent on this channel"
                  description="A service call about their own account is still fine. An offer is not."
                />
              ) : null
            }
          </Form.Item>
          <Form.Item name="channel" label="Channel" rules={[{ required: true }]}>
            <Select
              options={['CALL', 'SMS', 'WHATSAPP', 'EMAIL', 'IN_PERSON'].map((v) => ({
                value: v,
                label: v.replace('_', ' '),
              }))}
            />
          </Form.Item>
          <Form.Item name="direction" label="Direction">
            <Select
              options={[
                { value: 'out', label: 'We contacted them' },
                { value: 'in', label: 'They contacted us' },
              ]}
            />
          </Form.Item>
          <Form.Item name="outcome" label="What happened" rules={[{ required: true }]}>
            <Select
              options={Object.entries(OUTCOME_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} placeholder="What was said" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
