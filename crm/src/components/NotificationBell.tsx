import { useState } from 'react'
import { Badge, Button, Dropdown, Empty, Space, Tag, Typography } from 'antd'
import { BellOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@apollo/client'
import { MY_NOTIFICATIONS, MARK_READ } from '@/lib/gql'

type Notification = {
  id: string
  kind: string
  title: string
  body: string | null
  resourceType: string | null
  resourceId: string | null
  readAt: string | null
  createdAt: string
}

const KIND_COLOUR: Record<string, string> = {
  task_escalated: 'red',
  task_assigned: 'blue',
  rg_flag: 'volcano',
  consent_withdrawn: 'orange',
  system: 'default',
}

const KIND_LABEL: Record<string, string> = {
  task_escalated: 'Escalated',
  task_assigned: 'Assigned',
  rg_flag: 'Safety',
  consent_withdrawn: 'Consent',
  system: 'System',
}

const ago = (v: string) => {
  const mins = Math.floor((Date.now() - new Date(v).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * The desk's inbox.
 *
 * Polled rather than pushed. The escalation sweep runs every five minutes, so a
 * minute of latency changes nothing an operator would notice, and a socket for
 * this would be infrastructure carrying almost no traffic. When the live desk
 * arrives in a later phase it brings a subscription and this becomes its
 * fallback.
 */
export function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const { data, refetch } = useQuery(MY_NOTIFICATIONS, {
    pollInterval: 60_000,
    fetchPolicy: 'cache-and-network',
  })
  const [markRead] = useMutation(MARK_READ)

  const items: Notification[] = data?.crmMyNotifications ?? []
  const unread = items.filter((n) => !n.readAt)

  const openOne = async (n: Notification) => {
    setOpen(false)
    if (!n.readAt) {
      await markRead({ variables: { ids: [n.id] } })
      refetch()
    }
    if (n.resourceType === 'task') navigate('/queue')
    else if (n.resourceType === 'player' && n.resourceId) navigate(`/players/${n.resourceId}`)
  }

  const panel = (
    <div
      style={{
        width: 360,
        maxHeight: 440,
        overflowY: 'auto',
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 6px 24px rgba(15,23,42,0.16)',
        padding: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px 8px 8px',
        }}
      >
        <Typography.Text strong>Notifications</Typography.Text>
        {unread.length > 0 && (
          <Button
            type="link"
            size="small"
            onClick={async () => {
              await markRead({ variables: {} })
              refetch()
            }}
          >
            Mark all read
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing yet" />
      ) : (
        items.map((n) => (
          <div
            key={n.id}
            onClick={() => openOne(n)}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              background: n.readAt ? 'transparent' : '#f0f6ff',
              marginBottom: 2,
            }}
          >
            <Space size={6}>
              <Tag color={KIND_COLOUR[n.kind] ?? 'default'} style={{ marginInlineEnd: 0 }}>
                {KIND_LABEL[n.kind] ?? n.kind}
              </Tag>
              <span style={{ fontWeight: n.readAt ? 400 : 550 }}>{n.title}</span>
            </Space>
            {n.body && (
              <div className="crm-muted" style={{ fontSize: 12, marginTop: 2 }}>
                {n.body}
              </div>
            )}
            <div className="crm-muted" style={{ fontSize: 11, marginTop: 2 }}>
              {ago(n.createdAt)}
            </div>
          </div>
        ))
      )}
    </div>
  )

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={['click']}
      placement="bottomRight"
      popupRender={() => panel}
    >
      <Badge count={unread.length} size="small" offset={[-2, 2]}>
        <Button type="text" icon={<BellOutlined style={{ fontSize: 17 }} />} />
      </Badge>
    </Dropdown>
  )
}
