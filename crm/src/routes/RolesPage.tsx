import { useState } from 'react'
import { Card, Table, Button, Modal, Form, Input, Space, Typography, App, Tag, Popconfirm, Checkbox, Alert } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useQuery, useMutation } from '@apollo/client'
import { ROLES, PERMISSION_CATALOG, CREATE_ROLE, UPDATE_ROLE, DELETE_ROLE } from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

type Perm = { domain: string; action: string; label: string; description: string }
type Role = {
  id: string
  name: string
  description: string | null
  isSystem: boolean
  userCount: number
  permissions: Perm[]
}
type Group = { domain: string; label: string; description: string; actions: Perm[] }

const key = (p: { domain: string; action: string }) => `${p.domain}:${p.action}`

export function RolesPage() {
  const me = useAuth((s) => s.me)
  const { message } = App.useApp()
  const canManage = can(me, 'crm.roles', 'manage')

  const { data, loading, refetch } = useQuery(ROLES)
  const { data: catalog } = useQuery(PERMISSION_CATALOG)
  const [createRole] = useMutation(CREATE_ROLE)
  const [updateRole] = useMutation(UPDATE_ROLE)
  const [deleteRole] = useMutation(DELETE_ROLE)

  const [editing, setEditing] = useState<Role | null>(null)
  const [creating, setCreating] = useState(false)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [form] = Form.useForm()

  const groups: Group[] = catalog?.crmPermissionCatalog ?? []

  const openNew = () => {
    setChosen(new Set())
    form.resetFields()
    setCreating(true)
  }

  const openEdit = (r: Role) => {
    setChosen(new Set(r.permissions.map(key)))
    form.setFieldsValue({ name: r.name, description: r.description })
    setEditing(r)
  }

  const toggle = (k: string, on: boolean) => {
    setChosen((prev) => {
      const next = new Set(prev)
      if (on) next.add(k)
      else next.delete(k)
      return next
    })
  }

  const save = async (values: { name: string; description?: string }) => {
    const permissions = [...chosen].map((k) => {
      const [domain, action] = k.split(':')
      return { domain, action }
    })
    const res = editing
      ? await updateRole({ variables: { id: editing.id, ...values, permissions } })
      : await createRole({ variables: { ...values, permissions } })
    const payload = editing ? res.data?.crmUpdateRole : res.data?.crmCreateRole
    if (payload?.ok) {
      message.success(editing ? 'Role updated' : 'Role created')
      setEditing(null)
      setCreating(false)
      refetch()
    } else {
      message.error(payload?.error ?? 'Could not save the role')
    }
  }

  const remove = async (r: Role) => {
    const res = await deleteRole({ variables: { id: r.id } })
    if (res.data?.crmDeleteRole?.ok) {
      message.success('Role deleted')
      refetch()
    } else {
      message.error(res.data?.crmDeleteRole?.error ?? 'Could not delete the role')
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Roles
          </Typography.Title>
          <Typography.Text className="crm-muted">
            Your whitelabel decides what each role grants. Nothing here is set by anyone else.
          </Typography.Text>
        </div>
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
            New role
          </Button>
        )}
      </div>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<Role>
          rowKey="id"
          loading={loading}
          dataSource={data?.crmRoles ?? []}
          pagination={false}
          columns={[
            {
              title: 'Role',
              dataIndex: 'name',
              width: 240,
              render: (v: string, r) => (
                <div>
                  <Space size={6}>
                    <span style={{ fontWeight: 550 }}>{v}</span>
                    {r.isSystem && <Tag color="blue">Built in</Tag>}
                  </Space>
                  {r.description && (
                    <div className="crm-muted" style={{ fontSize: 12 }}>
                      {r.description}
                    </div>
                  )}
                </div>
              ),
            },
            {
              title: 'Grants',
              dataIndex: 'permissions',
              render: (v: Perm[]) => (
                <Space size={4} wrap>
                  {v.length === 0 && <Typography.Text type="warning">Nothing</Typography.Text>}
                  {v.map((p) => (
                    <Tag key={key(p)}>{p.label}</Tag>
                  ))}
                </Space>
              ),
            },
            { title: 'Users', dataIndex: 'userCount', width: 90, render: (v: number) => <Tag>{v}</Tag> },
            ...(canManage
              ? [
                  {
                    title: '',
                    key: 'actions',
                    width: 170,
                    align: 'right' as const,
                    render: (_: unknown, r: Role) => (
                      <Space>
                        <Button size="small" onClick={() => openEdit(r)}>
                          Edit
                        </Button>
                        {!r.isSystem && (
                          <Popconfirm
                            title="Delete this role?"
                            description={
                              r.userCount > 0
                                ? `${r.userCount} user(s) hold it — remove it from them first.`
                                : 'This cannot be undone.'
                            }
                            onConfirm={() => remove(r)}
                          >
                            <Button size="small" danger>
                              Delete
                            </Button>
                          </Popconfirm>
                        )}
                      </Space>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <Modal
        title={editing ? `Edit ${editing.name}` : 'New role'}
        open={creating || !!editing}
        onCancel={() => {
          setCreating(false)
          setEditing(null)
        }}
        onOk={() => form.submit()}
        okText="Save"
        width={720}
        destroyOnHidden
      >
        {editing?.isSystem && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="This is the built-in administrator role."
            description="It can be edited but not deleted, and cannot be left with no permissions — otherwise your whitelabel could lock itself out of its own CRM."
          />
        )}
        <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Give the role a name' }]}>
            <Input placeholder="e.g. Retention agent" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input placeholder="What this role is for" />
          </Form.Item>
        </Form>

        <Typography.Title level={5}>Permissions</Typography.Title>
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          {groups.map((g) => (
            <Card key={g.domain} size="small" title={g.label} styles={{ body: { paddingBlock: 10 } }}>
              <Typography.Paragraph className="crm-muted" style={{ fontSize: 12, marginBottom: 8 }}>
                {g.description}
              </Typography.Paragraph>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {g.actions.map((a) => (
                  <Checkbox
                    key={key(a)}
                    checked={chosen.has(key(a))}
                    onChange={(e) => toggle(key(a), e.target.checked)}
                  >
                    <span style={{ fontWeight: 500 }}>{a.label}</span>
                    <div className="crm-muted" style={{ fontSize: 12 }}>
                      {a.description}
                    </div>
                  </Checkbox>
                ))}
              </Space>
            </Card>
          ))}
        </Space>
      </Modal>
    </Space>
  )
}
