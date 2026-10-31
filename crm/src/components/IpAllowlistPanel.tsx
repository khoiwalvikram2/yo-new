import { useState } from 'react'
import { Card, Table, Button, Modal, Form, Input, Select, Space, Typography, App, Popconfirm, Alert } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useQuery, useMutation } from '@apollo/client'
import { IP_ALLOWLIST, ADD_IP_ALLOWLIST, REMOVE_IP_ALLOWLIST, USERS } from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

type Entry = { id: string; cidr: string; label: string | null; createdAt: string }

const when = (v: string) => new Date(v).toLocaleDateString('en-IN', { dateStyle: 'medium' })

/**
 * Which addresses a CRM user may sign in from.
 *
 * Two things this panel has to say out loud, because both are easy to get
 * wrong: the allowlist only bites when the whitelabel has enforcement switched
 * on, and a user with no entries is allowed from anywhere. Adding your first
 * entry is therefore the moment you could lock yourself out.
 */
export function IpAllowlistPanel() {
  const me = useAuth((s) => s.me)
  const { message } = App.useApp()
  const [forUser, setForUser] = useState<string | undefined>(me?.id)
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()

  const canManage = can(me, 'crm.security', 'manage')
  const { data: usersData } = useQuery(USERS, { skip: !can(me, 'crm.users', 'view') })
  const { data, loading, refetch } = useQuery(IP_ALLOWLIST, {
    variables: { crmUserId: forUser },
    skip: !forUser,
  })
  const [addEntry, { loading: saving }] = useMutation(ADD_IP_ALLOWLIST)
  const [removeEntry] = useMutation(REMOVE_IP_ALLOWLIST)

  const entries: Entry[] = data?.crmIpAllowlist ?? []
  const users = usersData?.crmUsers ?? []
  const isSelf = forUser === me?.id

  return (
    <Card
      size="small"
      title="Address allowlist"
      extra={
        canManage && (
          <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)} disabled={!forUser}>
            Add
          </Button>
        )
      }
    >
      <Typography.Paragraph className="crm-muted" style={{ fontSize: 12 }}>
        A user with no entries can sign in from anywhere. Entries only take effect while your
        whitelabel has address enforcement switched on.
      </Typography.Paragraph>

      {users.length > 0 && (
        <Select
          style={{ width: 260, marginBottom: 12 }}
          value={forUser}
          onChange={setForUser}
          placeholder="Whose allowlist"
          options={users.map((u: { id: string; name: string }) => ({
            value: u.id,
            label: u.id === me?.id ? `${u.name} (you)` : u.name,
          }))}
        />
      )}

      {isSelf && entries.length === 0 && canManage && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="This is your own allowlist"
          description="Adding your first entry means you can only sign in from that address. Make sure it is the one you are on."
        />
      )}

      <Table<Entry>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={entries}
        pagination={false}
        locale={{ emptyText: 'No restriction — this user may sign in from anywhere' }}
        columns={[
          {
            title: 'Address or range',
            dataIndex: 'cidr',
            render: (v: string, r) => (
              <Space direction="vertical" size={0}>
                <span className="crm-mono">{v}</span>
                {r.label && (
                  <span className="crm-muted" style={{ fontSize: 12 }}>
                    {r.label}
                  </span>
                )}
              </Space>
            ),
          },
          { title: 'Added', dataIndex: 'createdAt', width: 140, render: when },
          ...(canManage
            ? [
                {
                  title: '',
                  key: 'actions',
                  width: 100,
                  align: 'right' as const,
                  render: (_: unknown, r: Entry) => (
                    <Popconfirm
                      title="Remove this address?"
                      description={
                        entries.length === 1
                          ? 'This is the last entry, so the user will be able to sign in from anywhere again.'
                          : undefined
                      }
                      onConfirm={async () => {
                        const res = await removeEntry({ variables: { id: r.id } })
                        if (res.data?.crmRemoveIpAllowlistEntry?.ok) refetch()
                        else message.error(res.data?.crmRemoveIpAllowlistEntry?.error ?? 'Could not remove')
                      }}
                    >
                      <Button size="small" danger>
                        Remove
                      </Button>
                    </Popconfirm>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal
        title="Allow an address"
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
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={async (v) => {
            const res = await addEntry({ variables: { crmUserId: forUser, ...v } })
            if (res.data?.crmAddIpAllowlistEntry?.ok) {
              message.success('Added')
              setOpen(false)
              form.resetFields()
              refetch()
            } else {
              message.error(res.data?.crmAddIpAllowlistEntry?.error ?? 'Could not add it')
            }
          }}
        >
          <Form.Item
            name="cidr"
            label="Address or range"
            rules={[{ required: true }]}
            help="A single address, or a range in CIDR form."
          >
            <Input placeholder="203.0.113.7  or  203.0.113.0/24" />
          </Form.Item>
          <Form.Item name="label" label="What is it">
            <Input placeholder="Head office" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
