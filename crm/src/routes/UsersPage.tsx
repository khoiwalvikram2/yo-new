import { useState } from 'react'
import { Card, Table, Button, Modal, Form, Input, Space, Typography, App, Select, Tag, Popconfirm, Alert } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useQuery, useMutation } from '@apollo/client'
import {
  USERS,
  ROLES,
  CREATE_USER,
  UPDATE_USER,
  SET_USER_STATUS,
  RESET_USER_PASSWORD,
  SET_USER_ROLES,
  DELETE_USER,
} from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

type CrmUserRow = {
  id: string
  name: string
  username: string | null
  email: string | null
  phone: string | null
  status: string
  requirePasswordReset: boolean
  lastLoginAt: string | null
  createdAt: string
  roleNames: string[]
  roleIds: string[]
}

const when = (v: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'

const STATUS_COLOR: Record<string, string> = { ACTIVE: 'green', INACTIVE: 'orange', SUSPENDED: 'red' }

export function UsersPage() {
  const me = useAuth((s) => s.me)
  const { message } = App.useApp()
  const canManage = can(me, 'crm.users', 'manage')

  const { data, loading, refetch } = useQuery(USERS)
  const { data: rolesData } = useQuery(ROLES, { skip: !can(me, 'crm.roles', 'view') })
  const [createUser] = useMutation(CREATE_USER)
  const [updateUser] = useMutation(UPDATE_USER)
  const [setStatus] = useMutation(SET_USER_STATUS)
  const [resetPassword] = useMutation(RESET_USER_PASSWORD)
  const [setRoles] = useMutation(SET_USER_ROLES)
  const [deleteUser] = useMutation(DELETE_USER)

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<CrmUserRow | null>(null)
  const [resetFor, setResetFor] = useState<CrmUserRow | null>(null)
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()
  const [resetForm] = Form.useForm()

  const roleOptions = (rolesData?.crmRoles ?? []).map((r: { id: string; name: string }) => ({
    value: r.id,
    label: r.name,
  }))

  const run = async (fn: () => Promise<any>, key: string, okMsg: string) => {
    const res = await fn()
    const payload = res.data?.[key]
    if (payload?.ok) {
      message.success(okMsg)
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
            CRM users
          </Typography.Title>
          <Typography.Text className="crm-muted">
            Your whitelabel issues these accounts. They sign in here, not to the admin panel.
          </Typography.Text>
        </div>
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            New user
          </Button>
        )}
      </div>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<CrmUserRow>
          rowKey="id"
          loading={loading}
          dataSource={data?.crmUsers ?? []}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            {
              title: 'User',
              dataIndex: 'name',
              render: (v: string, r) => (
                <div>
                  <div style={{ fontWeight: 550 }}>{v}</div>
                  <div className="crm-muted" style={{ fontSize: 12 }}>
                    {r.username ?? '—'}
                    {r.email ? ` · ${r.email}` : ''}
                  </div>
                </div>
              ),
            },
            {
              title: 'Roles',
              dataIndex: 'roleNames',
              width: 220,
              render: (v: string[]) =>
                v.length ? (
                  <Space size={4} wrap>
                    {v.map((n) => (
                      <Tag key={n}>{n}</Tag>
                    ))}
                  </Space>
                ) : (
                  <Typography.Text type="warning" style={{ fontSize: 12 }}>
                    No role — sees nothing
                  </Typography.Text>
                ),
            },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 130,
              render: (v: string, r) => (
                <Space direction="vertical" size={2}>
                  <Tag color={STATUS_COLOR[v]}>{v}</Tag>
                  {r.requirePasswordReset && (
                    <Typography.Text className="crm-muted" style={{ fontSize: 11 }}>
                      must set password
                    </Typography.Text>
                  )}
                </Space>
              ),
            },
            { title: 'Last sign-in', dataIndex: 'lastLoginAt', width: 180, render: when },
            ...(canManage
              ? [
                  {
                    title: '',
                    key: 'actions',
                    width: 300,
                    align: 'right' as const,
                    render: (_: unknown, r: CrmUserRow) => (
                      <Space wrap>
                        <Button
                          size="small"
                          onClick={() => {
                            setEditing(r)
                            editForm.setFieldsValue({
                              name: r.name,
                              email: r.email,
                              phone: r.phone,
                              roleIds: r.roleIds,
                            })
                          }}
                        >
                          Edit
                        </Button>
                        <Button size="small" onClick={() => setResetFor(r)}>
                          Reset password
                        </Button>
                        {r.id !== me?.id && (
                          <Select
                            size="small"
                            style={{ width: 116 }}
                            value={r.status}
                            onChange={(v) =>
                              run(
                                () => setStatus({ variables: { id: r.id, status: v } }),
                                'crmSetUserStatus',
                                'Status updated'
                              )
                            }
                            options={[
                              { value: 'ACTIVE', label: 'Active' },
                              { value: 'INACTIVE', label: 'View only' },
                              { value: 'SUSPENDED', label: 'Suspended' },
                            ]}
                          />
                        )}
                        {r.id !== me?.id && (
                          <Popconfirm
                            title="Delete this user?"
                            description="Their sign-in ends immediately. This cannot be undone."
                            onConfirm={() =>
                              run(() => deleteUser({ variables: { id: r.id } }), 'crmDeleteUser', 'User deleted')
                            }
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
        title="New CRM user"
        open={creating}
        onCancel={() => {
          setCreating(false)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        okText="Create"
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="They will be asked to choose their own password on first sign-in."
        />
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={async (v) => {
            const okDone = await run(
              () => createUser({ variables: { input: v } }),
              'crmCreateUser',
              'User created'
            )
            if (okDone) {
              setCreating(false)
              form.resetFields()
            }
          }}
        >
          <Form.Item name="name" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Temporary password"
            rules={[{ required: true }, { min: 10, message: 'At least 10 characters' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="email" label="Email">
            <Input type="email" />
          </Form.Item>
          <Form.Item name="roleIds" label="Roles">
            <Select mode="multiple" options={roleOptions} placeholder="Without a role they see nothing" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Edit ${editing?.name ?? ''}`}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        okText="Save"
        destroyOnHidden
      >
        <Form
          form={editForm}
          layout="vertical"
          requiredMark={false}
          onFinish={async (v) => {
            if (!editing) return
            const detailsOk = await run(
              () =>
                updateUser({
                  variables: { input: { id: editing.id, name: v.name, email: v.email, phone: v.phone } },
                }),
              'crmUpdateUser',
              'User updated'
            )
            if (detailsOk) {
              await run(
                () => setRoles({ variables: { id: editing.id, roleIds: v.roleIds ?? [] } }),
                'crmSetUserRoles',
                'Roles updated'
              )
              setEditing(null)
            }
          }}
        >
          <Form.Item name="name" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email">
            <Input type="email" />
          </Form.Item>
          <Form.Item name="phone" label="Phone">
            <Input />
          </Form.Item>
          <Form.Item
            name="roleIds"
            label="Roles"
            help="A role change takes effect on their next request, not at their next sign-in."
          >
            <Select mode="multiple" options={roleOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Reset password for ${resetFor?.name ?? ''}`}
        open={!!resetFor}
        onCancel={() => {
          setResetFor(null)
          resetForm.resetFields()
        }}
        onOk={() => resetForm.submit()}
        okText="Reset"
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="This ends their current session and requires them to choose a new password."
        />
        <Form
          form={resetForm}
          layout="vertical"
          requiredMark={false}
          onFinish={async (v) => {
            if (!resetFor) return
            const done = await run(
              () => resetPassword({ variables: { id: resetFor.id, newPassword: v.newPassword } }),
              'crmResetUserPassword',
              'Password reset'
            )
            if (done) {
              setResetFor(null)
              resetForm.resetFields()
            }
          }}
        >
          <Form.Item
            name="newPassword"
            label="Temporary password"
            rules={[{ required: true }, { min: 10, message: 'At least 10 characters' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
