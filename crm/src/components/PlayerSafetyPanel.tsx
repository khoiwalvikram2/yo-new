import { useState } from 'react'
import {
  Card,
  Button,
  Modal,
  Form,
  Select,
  Input,
  DatePicker,
  Space,
  Tag,
  Typography,
  Empty,
  App,
  Alert,
  InputNumber,
} from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import { useQuery, useMutation } from '@apollo/client'
import { RG_FLAGS, RAISE_RG_FLAG, LIFT_RG_FLAG, CONSENTS, RECORD_CONSENT, CONSENT_HISTORY } from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

const when = (v: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

type RgFlag = {
  id: string
  flagType: string
  status: string
  initiatedBy: string
  blocksPlay: boolean
  startsAt: string
  minTermEndsAt: string | null
  endsAt: string | null
  balanceAtBlock: string | null
  reason: string | null
  raisedBy: string
  liftedBy: string | null
  liftedAt: string | null
  liftReason: string | null
}

type Consent = {
  channel: string
  purpose: string
  state: string
  stateSince: string
  source: string
  evidenceRef: string | null
}

const FLAG_LABEL: Record<string, string> = {
  SELF_EXCLUSION: 'Self-exclusion',
  COOLING_OFF: 'Cooling-off',
  DEPOSIT_ESCALATION: 'Deposit escalation',
  LOSS_CHASING: 'Loss chasing',
  SESSION_LENGTH: 'Long sessions',
  AFFORDABILITY_CONCERN: 'Affordability concern',
}

const BLOCKING = ['SELF_EXCLUSION', 'COOLING_OFF']

const STATE_COLOUR: Record<string, string> = {
  GRANTED: 'green',
  WITHDRAWN: 'red',
  REFUSED: 'orange',
}

/**
 * Responsible gambling and contact permission, on one panel because an operator
 * looking at one almost always needs the other.
 *
 * The screen is explicit that a blocking flag takes effect immediately and that
 * it does not stop the player signing in or withdrawing — that combination is
 * the part people get wrong, and an operator who believes otherwise will make a
 * promise the system does not keep.
 */
export function PlayerSafetyPanel({ playerId }: { playerId: string }) {
  const me = useAuth((s) => s.me)
  const { message } = App.useApp()
  const [flagOpen, setFlagOpen] = useState(false)
  const [liftFor, setLiftFor] = useState<RgFlag | null>(null)
  const [consentOpen, setConsentOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [flagForm] = Form.useForm()
  const [liftForm] = Form.useForm()
  const [consentForm] = Form.useForm()
  const [flagType, setFlagType] = useState<string>('COOLING_OFF')

  const { data: rgData, loading: rgLoading, refetch: refetchRg } = useQuery(RG_FLAGS, {
    variables: { playerId },
    skip: !can(me, 'crm.rg', 'view'),
  })
  const { data: consentData, refetch: refetchConsent } = useQuery(CONSENTS, {
    variables: { playerId },
    skip: !can(me, 'crm.consent', 'view'),
  })
  const [raiseFlag, { loading: raising }] = useMutation(RAISE_RG_FLAG)
  const [liftFlag, { loading: lifting }] = useMutation(LIFT_RG_FLAG)
  const [recordConsent, { loading: recording }] = useMutation(RECORD_CONSENT)
  const { data: historyData } = useQuery(CONSENT_HISTORY, {
    variables: { playerId, limit: 100 },
    skip: !historyOpen,
  })

  const flags: RgFlag[] = rgData?.crmPlayerRgFlags ?? []
  const consents: Consent[] = consentData?.crmPlayerConsents ?? []
  const activeBlock = flags.find((f) => f.status === 'ACTIVE' && f.blocksPlay)

  const submitFlag = async (v: Record<string, any>) => {
    const res = await raiseFlag({
      variables: {
        playerId,
        flagType: v.flagType,
        initiatedBy: v.initiatedBy,
        reason: v.reason ?? null,
        endsAt: v.endsAt ? v.endsAt.toISOString() : null,
        minTermMonths: v.minTermMonths ?? null,
      },
    })
    if (res.data?.crmRaiseRgFlag?.ok) {
      message.success('Recorded')
      setFlagOpen(false)
      flagForm.resetFields()
      refetchRg()
      refetchConsent()
    } else {
      message.error(res.data?.crmRaiseRgFlag?.error ?? 'Could not record it')
    }
  }

  return (
    <Card
      title="Safety"
      size="small"
      loading={rgLoading}
      extra={
        can(me, 'crm.rg', 'flag') && (
          <Button size="small" danger icon={<WarningOutlined />} onClick={() => setFlagOpen(true)}>
            Raise a flag
          </Button>
        )
      }
    >
      {activeBlock && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${FLAG_LABEL[activeBlock.flagType]} is in force`}
          description={
            <>
              This player cannot stake or add funds. They can still sign in and withdraw — an
              excluded player still owns their balance.
              {activeBlock.balanceAtBlock && (
                <>
                  {' '}
                  They held ₹{Number(activeBlock.balanceAtBlock).toLocaleString('en-IN')} when it was
                  applied.
                </>
              )}
            </>
          }
        />
      )}

      <Typography.Text strong style={{ fontSize: 12 }}>
        FLAGS
      </Typography.Text>
      {flags.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No flags" />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 6 }}>
          {flags.map((f) => (
            <div key={f.id} style={{ borderTop: '1px solid var(--crm-border)', paddingTop: 6 }}>
              <Space size={6} wrap>
                <Tag color={f.status === 'ACTIVE' ? (f.blocksPlay ? 'red' : 'orange') : 'default'}>
                  {FLAG_LABEL[f.flagType] ?? f.flagType}
                </Tag>
                <Tag>{f.status}</Tag>
                <Tag color={f.initiatedBy === 'player' ? 'blue' : 'default'}>
                  {f.initiatedBy === 'player' ? 'Player asked' : 'Operator decided'}
                </Tag>
                {f.status === 'ACTIVE' && f.blocksPlay && can(me, 'crm.rg', 'lift') && (
                  <Button size="small" onClick={() => setLiftFor(f)}>
                    Lift
                  </Button>
                )}
              </Space>
              {f.reason && <div style={{ marginTop: 2 }}>{f.reason}</div>}
              <div className="crm-muted" style={{ fontSize: 12 }}>
                {when(f.startsAt)} · raised by {f.raisedBy}
                {f.minTermEndsAt && ` · earliest lift ${when(f.minTermEndsAt)}`}
                {f.endsAt && ` · ends ${when(f.endsAt)}`}
                {f.liftedAt && ` · lifted by ${f.liftedBy} — ${f.liftReason}`}
              </div>
            </div>
          ))}
        </Space>
      )}

      {can(me, 'crm.consent', 'view') && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <Typography.Text strong style={{ fontSize: 12 }}>
              CONTACT PERMISSION
            </Typography.Text>
            <Space size={0}>
              <Button size="small" type="link" onClick={() => setHistoryOpen(true)}>
                History
              </Button>
              {/* Recording is a write. `view` alone opens the history, not the form. */}
              {(can(me, 'crm.consent', 'record') || can(me, 'crm.consent', 'restore')) && (
                <Button size="small" type="link" onClick={() => setConsentOpen(true)}>
                  Record
                </Button>
              )}
            </Space>
          </div>
          {consents.length === 0 ? (
            <Typography.Text className="crm-muted" style={{ fontSize: 12 }}>
              Never asked. An absent record is not permission.
            </Typography.Text>
          ) : (
            <Space size={4} wrap style={{ marginTop: 6 }}>
              {consents.map((c) => (
                <Tag key={`${c.channel}:${c.purpose}`} color={STATE_COLOUR[c.state]}>
                  {c.channel} {c.purpose === 'MARKETING' ? 'marketing' : 'service'}: {c.state.toLowerCase()}
                </Tag>
              ))}
            </Space>
          )}
        </>
      )}

      <Modal
        title="Raise a responsible gambling flag"
        open={flagOpen}
        onCancel={() => setFlagOpen(false)}
        onOk={() => flagForm.submit()}
        confirmLoading={raising}
        okText="Record"
        okButtonProps={{ danger: BLOCKING.includes(flagType) }}
        destroyOnHidden
      >
        {BLOCKING.includes(flagType) && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="This takes effect immediately"
            description="The player will be unable to stake or add funds from the moment you save. They will still be able to sign in and withdraw. Their marketing consent is withdrawn on every channel."
          />
        )}
        <Form
          form={flagForm}
          layout="vertical"
          onFinish={submitFlag}
          requiredMark={false}
          initialValues={{ flagType: 'COOLING_OFF', initiatedBy: 'player' }}
          onValuesChange={(c) => c.flagType && setFlagType(c.flagType)}
        >
          <Form.Item name="flagType" label="Type" rules={[{ required: true }]}>
            <Select
              options={Object.entries(FLAG_LABEL).map(([value, label]) => ({
                value,
                label: BLOCKING.includes(value) ? `${label} — stops play` : label,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="initiatedBy"
            label="Who asked"
            rules={[{ required: true }]}
            help="Legally these are different acts, so it is recorded rather than assumed."
          >
            <Select
              options={[
                { value: 'player', label: 'The player asked' },
                { value: 'operator', label: 'We decided' },
              ]}
            />
          </Form.Item>
          {flagType === 'COOLING_OFF' && (
            <Form.Item name="endsAt" label="Ends" rules={[{ required: true }]} help="It lifts itself.">
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          )}
          {flagType === 'SELF_EXCLUSION' && (
            <Form.Item
              name="minTermMonths"
              label="Minimum term (months)"
              initialValue={6}
              help="The earliest it may be lifted. Reaching it does not lift it by itself."
            >
              <InputNumber min={1} max={60} style={{ width: '100%' }} />
            </Form.Item>
          )}
          <Form.Item name="reason" label="Reason">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Lift this flag"
        open={!!liftFor}
        onCancel={() => setLiftFor(null)}
        onOk={() => liftForm.submit()}
        confirmLoading={lifting}
        okText="Lift"
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Someone other than the person who raised it must lift it"
          description="A single account being able to exclude and un-exclude is not a control. A minimum term, where one is set, also has to have passed."
        />
        <Form
          form={liftForm}
          layout="vertical"
          requiredMark={false}
          onFinish={async (v) => {
            if (!liftFor) return
            const res = await liftFlag({ variables: { flagId: liftFor.id, reason: v.reason } })
            if (res.data?.crmLiftRgFlag?.ok) {
              message.success('Lifted')
              setLiftFor(null)
              liftForm.resetFields()
              refetchRg()
            } else {
              message.error(res.data?.crmLiftRgFlag?.error ?? 'Could not lift it')
            }
          }}
        >
          <Form.Item name="reason" label="Why" rules={[{ required: true, message: 'A reason is required' }]}>
            <Input.TextArea rows={3} placeholder="What changed" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Record contact permission"
        open={consentOpen}
        onCancel={() => setConsentOpen(false)}
        onOk={() => consentForm.submit()}
        confirmLoading={recording}
        okText="Record"
        destroyOnHidden
      >
        <Form
          form={consentForm}
          layout="vertical"
          requiredMark={false}
          initialValues={{ channel: 'SMS', purpose: 'MARKETING', state: 'WITHDRAWN', source: 'AGENT_VERBAL' }}
          onFinish={async (v) => {
            const res = await recordConsent({ variables: { playerId, ...v } })
            if (res.data?.crmRecordConsent?.ok) {
              message.success('Recorded')
              setConsentOpen(false)
              consentForm.resetFields()
              refetchConsent()
            } else {
              message.error(res.data?.crmRecordConsent?.error ?? 'Could not record it')
            }
          }}
        >
          <Form.Item name="channel" label="Channel" rules={[{ required: true }]}>
            <Select options={['SMS', 'WHATSAPP', 'EMAIL', 'PUSH', 'CALL'].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item
            name="purpose"
            label="Purpose"
            rules={[{ required: true }]}
            help="Withdrawing marketing does not stop service messages or login codes."
          >
            <Select
              options={[
                { value: 'MARKETING', label: 'Marketing' },
                { value: 'SERVICE', label: 'Service' },
              ]}
            />
          </Form.Item>
          <Form.Item name="state" label="State" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'WITHDRAWN', label: 'Withdrawn — they asked to stop' },
                { value: 'REFUSED', label: 'Refused — they declined when asked' },
                // Granting is the direction that lets a player be contacted
                // again, and the server gates it on `crm.consent:restore`
                // separately from `record`. Offering it to someone who only
                // holds `record` produced a refusal they could not act on, at
                // the end of a form they had already filled in.
                ...(can(me, 'crm.consent', 'restore')
                  ? [{ value: 'GRANTED', label: 'Granted — they agreed' }]
                  : []),
              ]}
            />
          </Form.Item>
          <Form.Item name="source" label="How you know" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'AGENT_VERBAL', label: 'They told an agent' },
                { value: 'PLAYER_PORTAL', label: 'They changed it themselves' },
                { value: 'ADMIN', label: 'Recorded by an administrator' },
                { value: 'IMPORT', label: 'Imported' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="evidenceRef"
            label="Evidence"
            help="Required for a verbal or imported record — a reference to the call recording or the file."
          >
            <Input placeholder="call-recording-2026-08-27-114233" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="Consent history"
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        width={640}
      >
        <Typography.Paragraph className="crm-muted">
          Every change, oldest last. Nothing here is ever deleted — a withdrawal that vanished
          would be indistinguishable from one that never happened.
        </Typography.Paragraph>
        {(historyData?.crmPlayerConsentHistory ?? []).length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing recorded" />
        ) : (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {(historyData?.crmPlayerConsentHistory ?? []).map((e: any) => (
              <div key={e.id} style={{ borderTop: '1px solid var(--crm-border)', paddingTop: 6 }}>
                <Space size={6} wrap>
                  <Tag>{e.channel}</Tag>
                  <Tag>{e.purpose === 'MARKETING' ? 'marketing' : 'service'}</Tag>
                  <span>
                    {e.fromState ? `${e.fromState.toLowerCase()} → ` : ''}
                    <strong>{e.toState.toLowerCase()}</strong>
                  </span>
                  <Tag color="default">{e.source}</Tag>
                </Space>
                {e.evidenceRef && (
                  <div className="crm-mono" style={{ fontSize: 12, marginTop: 2 }}>
                    {e.evidenceRef}
                  </div>
                )}
                {e.reason && <div style={{ marginTop: 2 }}>{e.reason}</div>}
                <div className="crm-muted" style={{ fontSize: 12 }}>
                  {e.actorKind}
                  {e.actorId ? ` · ${e.actorId}` : ''} · {when(e.createdAt)}
                </div>
              </div>
            ))}
          </Space>
        )}
      </Modal>
    </Card>
  )
}
