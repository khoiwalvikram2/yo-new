import { useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Space,
  Typography,
  Button,
  Segmented,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  App,
  Empty,
  Badge,
} from 'antd'
import { PlusOutlined, CheckOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useLazyQuery } from '@apollo/client'
import {
  TASKS,
  CREATE_TASK,
  SET_TASK_STATUS,
  ACKNOWLEDGE_TASK,
  ASSIGN_TASK,
  BOOKS,
  USERS,
  TASK_EVENTS,
} from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

type Task = {
  id: string
  playerId: string | null
  bookName: string | null
  assigneeId: string | null
  assigneeName: string | null
  title: string
  body: string | null
  priority: string
  status: string
  source: string
  dueAt: string
  breachAt: string
  isBreaching: boolean
  escalationLevel: number
  acknowledgedAt: string | null
}

const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

const PRIORITY_COLOUR: Record<string, string> = {
  URGENT: 'red',
  HIGH: 'orange',
  NORMAL: 'default',
  LOW: 'default',
}

const OUTCOMES = [
  { value: 'contacted', label: 'Contacted' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'refused', label: 'Refused' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'not_required', label: 'Not required' },
]

/**
 * The queue.
 *
 * Ordered breaching first, then urgent, then by deadline — the order someone
 * actually works in, rather than by creation date. Acknowledging is offered
 * prominently on a breaching task because that is what stops the escalation
 * ladder climbing to someone else.
 */
export function QueuePage() {
  const me = useAuth((s) => s.me)
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [view, setView] = useState<'mine' | 'unclaimed' | 'breaching' | 'all'>('mine')
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState<Task | null>(null)
  const [historyFor, setHistoryFor] = useState<Task | null>(null)
  const [loadEvents, { data: eventsData }] = useLazyQuery(TASK_EVENTS)
  const [form] = Form.useForm()
  const [closeForm] = Form.useForm()

  const filter =
    view === 'mine'
      ? { assignedToMe: true }
      : view === 'unclaimed'
        ? { unassigned: true }
        : view === 'breaching'
          ? { breachingOnly: true }
          : {}

  const { data, loading, refetch } = useQuery(TASKS, { variables: { filter } })
  const { data: booksData } = useQuery(BOOKS, { skip: !can(me, 'crm.books', 'view') })
  const { data: usersData } = useQuery(USERS, { skip: !can(me, 'crm.users', 'view') })
  const [createTask, { loading: creating }] = useMutation(CREATE_TASK)
  const [setStatus] = useMutation(SET_TASK_STATUS)
  const [acknowledge] = useMutation(ACKNOWLEDGE_TASK)
  const [assign] = useMutation(ASSIGN_TASK)

  const tasks: Task[] = data?.crmTasks ?? []
  const canManage = can(me, 'crm.tasks', 'manage')
  const canAck = can(me, 'crm.tasks', 'escalate')
  const breaching = tasks.filter((t) => t.isBreaching).length

  const run = async (fn: () => Promise<any>, key: string, ok: string) => {
    const res = await fn()
    const payload = res.data?.[key]
    if (payload?.ok) {
      message.success(ok)
      refetch()
      return true
    }
    message.error(payload?.error ?? 'Something went wrong')
    return false
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Queue
          </Typography.Title>
          <Typography.Text className="crm-muted">
            Overdue work first. Acknowledging a breaching task stops it escalating further.
          </Typography.Text>
        </div>
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            New task
          </Button>
        )}
      </div>

      <Card size="small">
        <Segmented
          value={view}
          onChange={(v) => setView(v as typeof view)}
          options={[
            { value: 'mine', label: 'Mine' },
            { value: 'unclaimed', label: 'Unclaimed' },
            {
              value: 'breaching',
              label: breaching > 0 ? <Badge count={breaching} offset={[8, 0]}>Breaching</Badge> : 'Breaching',
            },
            { value: 'all', label: 'All' },
          ]}
        />
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<Task>
          rowKey="id"
          loading={loading}
          dataSource={tasks}
          pagination={false}
          scroll={{ x: 950 }}
          locale={{ emptyText: <Empty description="Nothing in this view" /> }}
          rowClassName={(r) => (r.isBreaching ? 'crm-row-breaching' : '')}
          columns={[
            {
              title: 'Task',
              dataIndex: 'title',
              render: (v: string, r) => (
                <div>
                  <Space size={6}>
                    <span style={{ fontWeight: 550 }}>{v}</span>
                    {r.isBreaching && <Tag color="red">Overdue</Tag>}
                    {r.escalationLevel > 0 && <Tag color="volcano">Escalated ×{r.escalationLevel}</Tag>}
                    {r.acknowledgedAt && <Tag color="green">Acknowledged</Tag>}
                  </Space>
                  <div className="crm-muted" style={{ fontSize: 12 }}>
                    {r.bookName}
                    {r.source !== 'manual' && ` · raised by ${r.source}`}
                  </div>
                </div>
              ),
            },
            {
              title: 'Priority',
              dataIndex: 'priority',
              width: 110,
              render: (v: string) => <Tag color={PRIORITY_COLOUR[v]}>{v}</Tag>,
            },
            {
              title: 'Assignee',
              dataIndex: 'assigneeName',
              width: 160,
              render: (v: string | null) => v ?? <span className="crm-muted">Unclaimed</span>,
            },
            { title: 'Due', dataIndex: 'dueAt', width: 180, render: when },
            {
              title: '',
              key: 'actions',
              width: 260,
              align: 'right',
              render: (_: unknown, r) => (
                <Space wrap>
                  {r.playerId && (
                    <Button size="small" onClick={() => navigate(`/players/${r.playerId}`)}>
                      Player
                    </Button>
                  )}
                  <Button
                    size="small"
                    onClick={() => {
                      setHistoryFor(r)
                      loadEvents({ variables: { taskId: r.id } })
                    }}
                  >
                    History
                  </Button>
                  {canAck && r.isBreaching && !r.acknowledgedAt && (
                    <Button
                      size="small"
                      icon={<CheckOutlined />}
                      onClick={() =>
                        run(
                          () => acknowledge({ variables: { taskId: r.id } }),
                          'crmAcknowledgeTask',
                          'Acknowledged — it will stop escalating'
                        )
                      }
                    >
                      Acknowledge
                    </Button>
                  )}
                  {canManage && !r.assigneeId && (
                    <Button
                      size="small"
                      onClick={() =>
                        run(
                          () => assign({ variables: { taskId: r.id, assigneeId: me?.id } }),
                          'crmAssignTask',
                          'Assigned to you'
                        )
                      }
                    >
                      Claim
                    </Button>
                  )}
                  {canManage && r.status !== 'DONE' && (
                    <Button size="small" type="primary" onClick={() => setClosing(r)}>
                      Close
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="New task"
        open={open}
        onCancel={() => {
          setOpen(false)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        confirmLoading={creating}
        okText="Create"
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ priority: 'NORMAL', slaMinutes: 120 }}
          onFinish={async (v) => {
            const done = await run(
              () => createTask({ variables: v }),
              'crmCreateTask',
              'Task created'
            )
            if (done) {
              setOpen(false)
              form.resetFields()
            }
          }}
        >
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input placeholder="Call about the failed deposit" />
          </Form.Item>
          <Form.Item name="bookId" label="Book" rules={[{ required: true }]}>
            <Select
              options={(booksData?.crmBooks ?? []).map((b: { id: string; name: string }) => ({
                value: b.id,
                label: b.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="playerId" label="Player ID">
            <Input placeholder="Optional — leave blank for desk work" />
          </Form.Item>
          <Form.Item name="assigneeId" label="Assign to">
            <Select
              allowClear
              placeholder="Leave unclaimed"
              options={(usersData?.crmUsers ?? []).map((u: { id: string; name: string }) => ({
                value: u.id,
                label: u.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="priority" label="Priority">
            <Select options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item
            name="slaMinutes"
            label="SLA (working minutes)"
            rules={[{ required: true }]}
            help="Counted against your desk hours, so a deadline never falls when nobody is in."
          >
            <InputNumber min={5} max={10080} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="body" label="Detail">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Close this task"
        open={!!closing}
        onCancel={() => setClosing(null)}
        onOk={() => closeForm.submit()}
        okText="Close"
        destroyOnHidden
      >
        <Typography.Paragraph className="crm-muted">
          Say what happened. A task closed with no outcome tells the next person nothing.
        </Typography.Paragraph>
        <Form
          form={closeForm}
          layout="vertical"
          requiredMark={false}
          onFinish={async (v) => {
            if (!closing) return
            const done = await run(
              () =>
                setStatus({
                  variables: { taskId: closing.id, status: 'DONE', outcome: v.outcome },
                }),
              'crmSetTaskStatus',
              'Closed'
            )
            if (done) {
              setClosing(null)
              closeForm.resetFields()
            }
          }}
        >
          <Form.Item name="outcome" label="Outcome" rules={[{ required: true }]}>
            <Select options={OUTCOMES} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={historyFor?.title}
        open={!!historyFor}
        onCancel={() => setHistoryFor(null)}
        footer={null}
        width={600}
      >
        <Typography.Paragraph className="crm-muted">
          Everything that happened to this task, including any escalation that failed to reach
          anybody.
        </Typography.Paragraph>
        {(eventsData?.crmTaskEvents ?? []).length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing yet" />
        ) : (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {(eventsData?.crmTaskEvents ?? []).map((e: any) => (
              <div key={e.id} style={{ borderTop: '1px solid var(--crm-border)', paddingTop: 6 }}>
                <Space size={6} wrap>
                  <Tag color={e.kind === 'escalation_failed' ? 'red' : 'default'}>
                    {e.kind.replace(/_/g, ' ')}
                  </Tag>
                  {e.fromValue && e.toValue && (
                    <span className="crm-muted" style={{ fontSize: 12 }}>
                      {e.fromValue} → {e.toValue}
                    </span>
                  )}
                </Space>
                {e.note && <div style={{ marginTop: 2 }}>{e.note}</div>}
                <div className="crm-muted" style={{ fontSize: 12 }}>
                  {e.actor ?? 'system'} · {when(e.createdAt)}
                </div>
              </div>
            ))}
          </Space>
        )}
      </Modal>
    </Space>
  )
}
