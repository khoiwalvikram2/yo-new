import { useState } from 'react'
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  Space,
  Typography,
  Tag,
  App,
  Select,
  Switch,
  Progress,
  Alert,
} from 'antd'
import { PlusOutlined, MergeCellsOutlined } from '@ant-design/icons'
import { useQuery, useMutation } from '@apollo/client'
import { TAGS, TAG_LIMIT, CREATE_TAG, ARCHIVE_TAG, MERGE_TAGS, UPDATE_TAG } from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

type CrmTag = {
  id: string
  name: string
  colour: string
  description: string | null
  isArchived: boolean
  playerCount: number
}

/**
 * The tag vocabulary.
 *
 * Tags are archived and merged rather than deleted, because a tag that
 * disappears takes with it the answer to "why was this player flagged in
 * March". The cap is shown as a bar so the pressure to tidy is visible before
 * the limit is hit rather than at the moment someone is blocked.
 */
export function TagsPage() {
  const me = useAuth((s) => s.me)
  const { message } = App.useApp()
  const [showArchived, setShowArchived] = useState(false)
  const [open, setOpen] = useState(false)
  const [mergeFrom, setMergeFrom] = useState<CrmTag | null>(null)
  const [editing, setEditing] = useState<CrmTag | null>(null)
  const [editForm] = Form.useForm()
  const [form] = Form.useForm()
  const [mergeForm] = Form.useForm()

  const { data, loading, refetch } = useQuery(TAGS, {
    variables: { includeArchived: showArchived },
  })
  const { data: limitData, refetch: refetchLimit } = useQuery(TAG_LIMIT)
  const [createTag, { loading: creating }] = useMutation(CREATE_TAG)
  const [archiveTag] = useMutation(ARCHIVE_TAG)
  const [mergeTags] = useMutation(MERGE_TAGS)
  const [updateTag] = useMutation(UPDATE_TAG)

  const canManage = can(me, 'crm.tags', 'manage')
  const tags: CrmTag[] = data?.crmTags ?? []
  const live = tags.filter((t) => !t.isArchived)
  const used = limitData?.crmTagLimit?.used ?? live.length
  const limit = limitData?.crmTagLimit?.limit ?? 100

  const run = async (fn: () => Promise<any>, key: string, ok: string) => {
    const res = await fn()
    const payload = res.data?.[key]
    if (payload?.ok) {
      message.success(ok)
      refetch()
      refetchLimit()
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
            Tags
          </Typography.Title>
          <Typography.Text className="crm-muted">
            Your whitelabel's own vocabulary. The point of a tag is that two agents pick the same one.
          </Typography.Text>
        </div>
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            New tag
          </Button>
        )}
      </div>

      <Card size="small">
        <Space size={24} wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 220 }}>
            <Typography.Text className="crm-muted" style={{ fontSize: 12 }}>
              {used} of {limit} live tags
            </Typography.Text>
            <Progress
              percent={Math.round((used / limit) * 100)}
              size="small"
              showInfo={false}
              status={used >= limit ? 'exception' : 'normal'}
            />
          </div>
          <Space>
            <Typography.Text className="crm-muted">Show archived</Typography.Text>
            <Switch checked={showArchived} onChange={setShowArchived} />
          </Space>
        </Space>
      </Card>

      {used >= limit && (
        <Alert
          type="warning"
          showIcon
          message="The tag list is full"
          description="Archive or merge some before adding more. A vocabulary nobody can read stops being a vocabulary."
        />
      )}

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<CrmTag>
          rowKey="id"
          loading={loading}
          dataSource={tags}
          pagination={false}
          columns={[
            {
              title: 'Tag',
              dataIndex: 'name',
              render: (v: string, r) => (
                <div>
                  <Tag color={r.colour} style={{ color: '#fff' }}>
                    {v}
                  </Tag>
                  {r.isArchived && <Tag>Archived</Tag>}
                  {r.description && (
                    <div className="crm-muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {r.description}
                    </div>
                  )}
                </div>
              ),
            },
            {
              title: 'Players',
              dataIndex: 'playerCount',
              width: 120,
              render: (v: number) => <Tag color={v > 0 ? 'blue' : 'default'}>{v.toLocaleString('en-IN')}</Tag>,
            },
            ...(canManage
              ? [
                  {
                    title: '',
                    key: 'actions',
                    width: 240,
                    align: 'right' as const,
                    render: (_: unknown, r: CrmTag) => (
                      <Space>
                        {!r.isArchived && (
                          <Button
                            size="small"
                            onClick={() => {
                              setEditing(r)
                              editForm.setFieldsValue({
                                name: r.name,
                                colour: r.colour,
                                description: r.description,
                              })
                            }}
                          >
                            Edit
                          </Button>
                        )}
                        {!r.isArchived && (
                          <Button
                            size="small"
                            icon={<MergeCellsOutlined />}
                            onClick={() => setMergeFrom(r)}
                          >
                            Merge
                          </Button>
                        )}
                        <Button
                          size="small"
                          onClick={() =>
                            run(
                              () => archiveTag({ variables: { id: r.id, archived: !r.isArchived } }),
                              'crmArchiveTag',
                              r.isArchived ? 'Restored' : 'Archived'
                            )
                          }
                        >
                          {r.isArchived ? 'Restore' : 'Archive'}
                        </Button>
                      </Space>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <Modal
        title="New tag"
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
          initialValues={{ colour: '#2563eb' }}
          onFinish={async (v) => {
            const done = await run(() => createTag({ variables: v }), 'crmCreateTag', 'Tag created')
            if (done) {
              setOpen(false)
              form.resetFields()
            }
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="High value" />
          </Form.Item>
          <Form.Item name="colour" label="Colour" help="A hex value, so a desk can read a player at a glance.">
            <Input type="color" style={{ width: 80, padding: 2 }} />
          </Form.Item>
          <Form.Item name="description" label="What it means">
            <Input placeholder="Top decile by stake over 90 days" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Edit "${editing?.name ?? ''}"`}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        okText="Save"
        destroyOnHidden
      >
        <Typography.Paragraph className="crm-muted">
          Renaming changes the label everywhere it appears, including on players who already
          carry it. Nobody loses the tag.
        </Typography.Paragraph>
        <Form
          form={editForm}
          layout="vertical"
          requiredMark={false}
          onFinish={async (v) => {
            if (!editing) return
            const done = await run(
              () => updateTag({ variables: { id: editing.id, ...v } }),
              'crmUpdateTag',
              'Saved'
            )
            if (done) setEditing(null)
          }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="colour" label="Colour">
            <Input type="color" style={{ width: 80, padding: 2 }} />
          </Form.Item>
          <Form.Item name="description" label="What it means">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Merge "${mergeFrom?.name ?? ''}" into another tag`}
        open={!!mergeFrom}
        onCancel={() => setMergeFrom(null)}
        onOk={() => mergeForm.submit()}
        okText="Merge"
        destroyOnHidden
      >
        <Typography.Paragraph className="crm-muted">
          Every player carrying this tag moves across, and this one is archived pointing at its
          destination — so a reference to it still resolves to something meaningful.
        </Typography.Paragraph>
        <Form
          form={mergeForm}
          layout="vertical"
          requiredMark={false}
          onFinish={async (v) => {
            if (!mergeFrom) return
            const done = await run(
              () => mergeTags({ variables: { fromId: mergeFrom.id, intoId: v.intoId } }),
              'crmMergeTags',
              'Merged'
            )
            if (done) {
              setMergeFrom(null)
              mergeForm.resetFields()
            }
          }}
        >
          <Form.Item name="intoId" label="Keep this tag" rules={[{ required: true }]}>
            <Select
              placeholder="Choose the one to keep"
              options={live
                .filter((t) => t.id !== mergeFrom?.id)
                .map((t) => ({ value: t.id, label: `${t.name} (${t.playerCount})` }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
