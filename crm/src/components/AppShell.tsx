import { useEffect, useState } from 'react'
import { Layout, Menu, Dropdown, Avatar, Typography, Tag } from 'antd'
import {
  TeamOutlined,
  CheckSquareOutlined,
  TagsOutlined,
  BookOutlined,
  UserOutlined,
  SafetyOutlined,
  IdcardOutlined,
  LogoutOutlined,
  KeyOutlined,
  CoffeeOutlined,
  HeartOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import { useAuth } from '@/state/auth'
import { visibleNav } from '@/app/navigation'
import { ME } from '@/lib/gql'
import { NotificationBell } from '@/components/NotificationBell'
import { AvailabilityModal } from '@/components/AvailabilityModal'

const { Sider, Header, Content } = Layout

/** Keyed by path so the shared nav list stays free of JSX. */
const NAV_ICONS: Record<string, React.ReactNode> = {
  '/players': <TeamOutlined />,
  '/queue': <CheckSquareOutlined />,
  '/live-chat': <MessageOutlined />,
  '/desk-health': <HeartOutlined />,
  '/tags': <TagsOutlined />,
  '/books': <BookOutlined />,
  '/users': <UserOutlined />,
  '/roles': <IdcardOutlined />,
  '/security': <SafetyOutlined />,
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const me = useAuth((s) => s.me)
  const setMe = useAuth((s) => s.setMe)
  const signOut = useAuth((s) => s.signOut)
  const [availabilityOpen, setAvailabilityOpen] = useState(false)

  // Re-read the caller on load. What the token said at sign-in may already be
  // out of date: roles change, books change, and the server is the authority.
  const { data } = useQuery(ME, { fetchPolicy: 'network-only' })
  useEffect(() => {
    if (data?.crmMe) setMe(data.crmMe)
    else if (data && data.crmMe === null) signOut()
  }, [data, setMe, signOut])

  // Order, labels and permissions come from the shared list the router also
  // reads; only the icons live here.
  const items = visibleNav(me).map((n) => ({
    key: n.path,
    icon: NAV_ICONS[n.path],
    label: n.label,
  }))

  const selected =
    items.find((i) => location.pathname.startsWith(i.key))?.key ?? items[0]?.key ?? '/players'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={228} breakpoint="lg" collapsedWidth={0} theme="light" style={{ borderRight: '1px solid var(--crm-border)' }}>
        <div style={{ padding: '20px 18px 14px' }}>
          <div className="crm-brand">CRM</div>
          <div className="crm-muted" style={{ fontSize: 12, marginTop: 2 }}>
            {me?.whitelabelName ?? me?.tenant ?? ''}
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          onClick={(e) => navigate(e.key)}
          items={items.map(({ key, icon, label }) => ({ key, icon, label }))}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>
      <Layout style={{minWidth:0}}>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid var(--crm-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            paddingInline: 20,
          }}
        >
          {me?.status === 'INACTIVE' && <Tag color="orange">View only</Tag>}
          <NotificationBell />
          {me?.canViewAllPlayers && <Tag color="blue">All players</Tag>}
          <Dropdown
            menu={{
              items: [
                { key: 'availability', icon: <CoffeeOutlined />, label: 'Set availability' },
                { key: 'password', icon: <KeyOutlined />, label: 'Change password' },
                { type: 'divider' },
                { key: 'signout', icon: <LogoutOutlined />, label: 'Sign out', danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'signout') signOut()
                else if (key === 'availability') setAvailabilityOpen(true)
                else navigate('/password')
              },
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Avatar size={30} style={{ background: 'var(--crm-accent)' }}>
                {me?.name?.[0]?.toUpperCase() ?? '?'}
              </Avatar>
              <Typography.Text>{me?.name}</Typography.Text>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ padding: 20, minWidth:0 }}>{children}</Content>
        <AvailabilityModal open={availabilityOpen} onClose={() => setAvailabilityOpen(false)} />
      </Layout>
    </Layout>
  )
}
