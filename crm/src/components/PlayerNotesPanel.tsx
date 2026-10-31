import { useState } from 'react'
import {
  Card,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Space,
  Tag,
  Typography,
  Empty,
  App,
  Popconfirm,
  Tooltip,
} from 'antd'
import { PlusOutlined, PushpinFilled, PushpinOutlined, DeleteOutlined } from '@ant-design/icons'
import { useQuery, useMutation } from '@apollo/client'
import { PLAYER_NOTES, ADD_NOTE, DELETE_NOTE, SET_NOTE_PINNED } from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

type Note = {
  id: string
  content: string
  category: string | null
  labels: string[]
  isPinned: boolean
  visibility: string
  authorKind: string
  createdBy: string
  createdAt: string
}

const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

const CATEGORIES = ['contact', 'complaint', 'kyc', 'payment', 'risk', 'other']

/**
 * Notes are the desk's memory of a player.
 *
 * Two things the UI has to be honest about: a note cannot be edited once
 * written, and `crm_only` notes are invisible to the admin panel. Both are
 * stated rather than implied, because an operator who assumes otherwise will
 * write something they would not have.
 */
export function PlayerNotesPanel({ playerId }: { playerId: string }) {
  const me = useAuth((s) => s.me)
  const { message } = App.useApp()
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()

  const { data, loading, refetch } = useQuery(PLAYER_NOTES, { variables: { playerId } })
  const [addNote, { loading: saving }] = useMutation(ADD_NOTE)
  const [deleteNote] = useMutation(DELETE_NOTE)
  const [setPinned] = useMutation(SET_NOTE_PINNED)

  const canWrite = can(me, 'crm.notes', 'create')
  const canDelete = can(me, 'crm.notes', 'delete')
  const notes: Note[] = data?.crmPlayerNotes ?? []

  const submit = async (values: {
    content: string
    category?: string
    labels?: string[]
    visibility?: string
    isPinned?: boolean
  }) => {
    const res = await addNote({
      variables: { input: { playerId, ...values } },
    })
    if (res.data?.crmAddPlayerNote?.ok) {
      message.success('Note added')
      setOpen(false)
      form.resetFields()
      refetch()
    } else {
      message.error(res.data?.crmAddPlayerNote?.error ?? 'Could not add the note')
    }
  }

  return (
    <Card
      title="Notes"
      size="small"
      loading={loading}
      extra={
        canWrite && (
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Add
          </Button>
        )
      }
    >
      {notes.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing recorded yet" />
      ) : (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {notes.map((n) => (
            <div
              key={n.id}
              style={{
                borderLeft: `3px solid ${n.isPinned ? 'var(--crm-accent)' : 'var(--crm-border)'}`,
                paddingLeft: 10,
              }}
            >
              <div style={{ whiteSpace: 'pre-wrap' }}>{n.content}</div>
              <Space size={6} wrap style={{ marginTop: 4 }}>
                {n.category && <Tag>{n.category}</Tag>}
                {n.labels.map((l) => (
                  <Tag key={l} color="blue">
                    {l}
                  </Tag>
                ))}
                {n.visibility === 'crm_only' && (
                  <Tooltip title="Not visible in the admin panel">
                    <Tag color="orange">CRM only</Tag>
                  </Tooltip>
                )}
                {n.authorKind === 'admin' && <Tag color="purple">Admin panel</Tag>}
              </Space>
              <div
                className="crm-muted"
                style={{ fontSize: 12, marginTop: 2, display: 'flex', gap: 8, alignItems: 'center' }}
              >
                <span>
                  {n.createdBy} · {when(n.createdAt)}
                </span>
                {canWrite && (
                  <Button
                    type="text"
                    size="small"
                    icon={n.isPinned ? <PushpinFilled /> : <PushpinOutlined />}
                    onClick={async () => {
                      await setPinned({ variables: { id: n.id, isPinned: !n.isPinned } })
                      refetch()
                    }}
                  />
                )}
                {canDelete && (
                  <Popconfirm
                    title="Remove this note?"
                    description="It stays in the record, so who wrote what is never lost."
                    onConfirm={async () => {
                      const res = await deleteNote({ variables: { id: n.id } })
                      if (res.data?.crmDeletePlayerNote?.ok) refetch()
                      else message.error(res.data?.crmDeletePlayerNote?.error ?? 'Could not remove')
                    }}
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </div>
            </div>
          ))}
        </Space>
      )}

      <Modal
        title="Add a note"
        open={open}
        onCancel={() => {
          setOpen(false)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="Add"
        destroyOnHidden
      >
        <Typography.Paragraph className="crm-muted" style={{ fontSize: 12 }}>
          A note cannot be edited once written — only pinned or removed — so that a record cannot
          later be made to say something else.
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item name="content" label="Note" rules={[{ required: true, message: 'Write something' }]}>
            <Input.TextArea rows={4} autoFocus placeholder="What happened, in your own words" />
          </Form.Item>
          <Form.Item name="category" label="Category">
            <Select allowClear options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </Form.Item>
          <Form.Item name="labels" label="Labels" help="Free text on this note — not player tags.">
            <Select mode="tags" tokenSeparators={[',']} placeholder="callback, chased" />
          </Form.Item>
          <Form.Item
            name="visibility"
            label="Who can see it"
            initialValue="all"
            help="CRM only keeps it off the admin panel — for things that should not be disclosed."
          >
            <Select
              options={[
                { value: 'all', label: 'Everyone' },
                { value: 'crm_only', label: 'CRM only' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
