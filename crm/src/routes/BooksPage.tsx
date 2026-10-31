import { useState } from 'react'
import { Card, Table, Button, Modal, Form, Input, Space, Typography, App, Select, Popconfirm, Tag } from 'antd'
import { PlusOutlined, TeamOutlined } from '@ant-design/icons'
import { useQuery, useMutation } from '@apollo/client'
import { BOOKS, USERS, BOOK_MEMBERS, CREATE_BOOK, UPDATE_BOOK, DELETE_BOOK, SET_BOOK_MEMBERS } from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

type Book = { id: string; name: string; description: string | null; memberCount: number; playerCount: number }

export function BooksPage() {
  const me = useAuth((s) => s.me)
  const { message } = App.useApp()
  const canManage = can(me, 'crm.books', 'manage')

  const { data, loading, refetch } = useQuery(BOOKS)
  const { data: usersData } = useQuery(USERS, { skip: !canManage })
  const [createBook] = useMutation(CREATE_BOOK)
  const [updateBook] = useMutation(UPDATE_BOOK)
  const [deleteBook] = useMutation(DELETE_BOOK)
  const [setMembers] = useMutation(SET_BOOK_MEMBERS)

  const [editing, setEditing] = useState<Book | null>(null)
  const [creating, setCreating] = useState(false)
  const [membersFor, setMembersFor] = useState<Book | null>(null)
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [form] = Form.useForm()

  const { refetch: loadMembers } = useQuery(BOOK_MEMBERS, {
    variables: { bookId: membersFor?.id },
    skip: true,
  })

  const openMembers = async (book: Book) => {
    setMembersFor(book)
    const res = await loadMembers({ bookId: book.id })
    setMemberIds((res.data?.crmBookMembers ?? []).map((m: { id: string }) => m.id))
  }

  const save = async (values: { name: string; description?: string }) => {
    const res = editing
      ? await updateBook({ variables: { id: editing.id, ...values } })
      : await createBook({ variables: values })
    const payload = editing ? res.data?.crmUpdateBook : res.data?.crmCreateBook
    if (payload?.ok) {
      message.success(editing ? 'Book updated' : 'Book created')
      setEditing(null)
      setCreating(false)
      form.resetFields()
      refetch()
    } else {
      message.error(payload?.error ?? 'Could not save')
    }
  }

  const remove = async (book: Book) => {
    const res = await deleteBook({ variables: { id: book.id } })
    if (res.data?.crmDeleteBook?.ok) {
      message.success('Book deleted')
      refetch()
    } else {
      message.error(res.data?.crmDeleteBook?.error ?? 'Could not delete')
    }
  }

  const saveMembers = async () => {
    if (!membersFor) return
    const res = await setMembers({ variables: { bookId: membersFor.id, crmUserIds: memberIds } })
    if (res.data?.crmSetBookMembers?.ok) {
      message.success('Members updated')
      setMembersFor(null)
      refetch()
    } else {
      message.error(res.data?.crmSetBookMembers?.error ?? 'Could not update members')
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Books
          </Typography.Title>
          <Typography.Text className="crm-muted">
            A book decides which players a CRM user can reach. A player belongs to one.
          </Typography.Text>
        </div>
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            New book
          </Button>
        )}
      </div>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<Book>
          rowKey="id"
          loading={loading}
          dataSource={data?.crmBooks ?? []}
          pagination={false}
          columns={[
            {
              title: 'Book',
              dataIndex: 'name',
              render: (v: string, r) => (
                <div>
                  <div style={{ fontWeight: 550 }}>{v}</div>
                  {r.description && (
                    <div className="crm-muted" style={{ fontSize: 12 }}>
                      {r.description}
                    </div>
                  )}
                </div>
              ),
            },
            {
              title: 'Members',
              dataIndex: 'memberCount',
              width: 120,
              render: (v: number) => <Tag>{v}</Tag>,
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
                    width: 260,
                    align: 'right' as const,
                    render: (_: unknown, r: Book) => (
                      <Space>
                        <Button size="small" icon={<TeamOutlined />} onClick={() => openMembers(r)}>
                          Members
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            setEditing(r)
                            form.setFieldsValue({ name: r.name, description: r.description })
                          }}
                        >
                          Edit
                        </Button>
                        <Popconfirm
                          title="Delete this book?"
                          description={
                            r.playerCount > 0
                              ? `It still holds ${r.playerCount} player(s) — move them first.`
                              : 'This cannot be undone.'
                          }
                          onConfirm={() => remove(r)}
                        >
                          <Button size="small" danger>
                            Delete
                          </Button>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <Modal
        title={editing ? 'Edit book' : 'New book'}
        open={creating || !!editing}
        onCancel={() => {
          setCreating(false)
          setEditing(null)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        okText="Save"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Give the book a name' }]}>
            <Input placeholder="e.g. High value — North" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="What this book is for" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Members of ${membersFor?.name ?? ''}`}
        open={!!membersFor}
        onCancel={() => setMembersFor(null)}
        onOk={saveMembers}
        okText="Save members"
      >
        <Typography.Paragraph className="crm-muted">
          These users see this book's players. A user with "View all players" sees everyone regardless.
        </Typography.Paragraph>
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="Choose CRM users"
          value={memberIds}
          onChange={setMemberIds}
          optionFilterProp="label"
          options={(usersData?.crmUsers ?? []).map((u: { id: string; name: string; status: string }) => ({
            value: u.id,
            label: u.status === 'ACTIVE' ? u.name : `${u.name} (${u.status.toLowerCase()})`,
          }))}
        />
      </Modal>
    </Space>
  )
}
