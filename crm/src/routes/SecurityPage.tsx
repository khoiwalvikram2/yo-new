import { Card, Table, Space, Typography, Tag, Tabs } from 'antd'
import { useQuery } from '@apollo/client'
import { LOGIN_ATTEMPTS, PII_ACCESS_LOG } from '@/lib/gql'
import { IpAllowlistPanel } from '@/components/IpAllowlistPanel'

const when = (v: string) => new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })

type Attempt = {
  id: string
  username: string
  userName: string | null
  success: boolean
  reason: string | null
  ipAddress: string | null
  createdAt: string
}

type Access = {
  id: string
  userName: string | null
  resourceType: string
  resourceId: string
  action: string
  ipAddress: string | null
  createdAt: string
}

const REASON_LABEL: Record<string, string> = {
  bad_password: 'Wrong password',
  unknown_user: 'No such username',
  suspended: 'Account suspended',
  locked: 'Locked after repeated failures',
  ip_blocked: 'Address not allowed',
  crm_disabled: 'CRM not enabled',
}

function LoginAttempts() {
  const { data, loading } = useQuery(LOGIN_ATTEMPTS, { variables: { limit: 200 } })
  return (
    <Table<Attempt>
      rowKey="id"
      size="small"
      loading={loading}
      dataSource={data?.crmLoginAttempts ?? []}
      pagination={{ pageSize: 25, showSizeChanger: false }}
      scroll={{ x: 800 }}
      columns={[
        { title: 'When', dataIndex: 'createdAt', width: 200, render: when },
        {
          title: 'Username',
          dataIndex: 'username',
          width: 200,
          render: (v: string, r: Attempt) => (
            <div>
              <div>{v}</div>
              {r.userName && (
                <div className="crm-muted" style={{ fontSize: 12 }}>
                  {r.userName}
                </div>
              )}
            </div>
          ),
        },
        {
          title: 'Result',
          dataIndex: 'success',
          width: 220,
          render: (ok: boolean, r: Attempt) =>
            ok ? (
              <Tag color="green">Signed in</Tag>
            ) : (
              <Tag color="red">{r.reason ? (REASON_LABEL[r.reason] ?? r.reason) : 'Refused'}</Tag>
            ),
        },
        { title: 'Address', dataIndex: 'ipAddress', width: 150, render: (v: string | null) => v ?? '—' },
      ]}
    />
  )
}

function PiiAccess() {
  const { data, loading } = useQuery(PII_ACCESS_LOG, { variables: { limit: 200 } })
  return (
    <Table<Access>
      rowKey="id"
      size="small"
      loading={loading}
      dataSource={data?.crmPiiAccessLog ?? []}
      pagination={{ pageSize: 25, showSizeChanger: false }}
      scroll={{ x: 800 }}
      columns={[
        { title: 'When', dataIndex: 'createdAt', width: 200, render: when },
        { title: 'Who', dataIndex: 'userName', width: 180, render: (v: string | null) => v ?? '—' },
        {
          title: 'What',
          dataIndex: 'resourceType',
          width: 160,
          render: (v: string, r: Access) => (
            <Space size={4}>
              <Tag>{v.replace('_', ' ')}</Tag>
              <Tag color="blue">{r.action}</Tag>
            </Space>
          ),
        },
        { title: 'Reference', dataIndex: 'resourceId', render: (v: string) => <span className="crm-mono">{v}</span> },
        { title: 'Address', dataIndex: 'ipAddress', width: 150, render: (v: string | null) => v ?? '—' },
      ]}
    />
  )
}

export function SecurityPage() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Security
        </Typography.Title>
        <Typography.Text className="crm-muted">
          Who signed in, and who looked at whose data.
        </Typography.Text>
      </div>

      <Card size="small" styles={{ body: { paddingTop: 0 } }}>
        <Tabs
          items={[
            { key: 'logins', label: 'Sign-in attempts', children: <LoginAttempts /> },
            { key: 'allowlist', label: 'Address allowlist', children: <IpAllowlistPanel /> },
            {
              key: 'pii',
              label: 'Data access',
              children: (
                <>
                  <Typography.Paragraph className="crm-muted" style={{ fontSize: 12 }}>
                    Opening a player shows their phone number, email and financial history. Every such read
                    is recorded here, not only the changes people make.
                  </Typography.Paragraph>
                  <PiiAccess />
                </>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  )
}
