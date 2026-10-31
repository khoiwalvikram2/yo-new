import { useEffect, useState } from 'react'
import {
  Card,
  Descriptions,
  Tag,
  Typography,
  Space,
  Button,
  Timeline,
  Select,
  Row,
  Col,
  Skeleton,
  Result,
  Empty,
} from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import { PLAYER, PLAYER_TIMELINE } from '@/lib/gql'
import { PlayerNotesPanel } from '@/components/PlayerNotesPanel'
import { PlayerSafetyPanel } from '@/components/PlayerSafetyPanel'
import { PlayerContactPanel } from '@/components/PlayerContactPanel'
import { PlayerDsarPanel } from '@/components/PlayerDsarPanel'

const money = (v: string | null | undefined) =>
  v == null ? '—' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const when = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

const SOURCE_LABEL: Record<string, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  sports_bet: 'Sports',
  casino_bet: 'Casino',
  matka_bet: 'Matka',
}

const SOURCE_COLOR: Record<string, string> = {
  deposit: 'green',
  withdrawal: 'orange',
  sports_bet: 'blue',
  casino_bet: 'purple',
  matka_bet: 'magenta',
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="crm-stat">
      <div className="crm-stat-label">{label}</div>
      <div className="crm-stat-value crm-mono">{value}</div>
    </div>
  )
}

export function PlayerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [sources, setSources] = useState<string[]>([])
  // Only the pages "load more" has fetched. The first page is read straight
  // from the query, so a refetch replaces it rather than leaving stale rows
  // behind — which is what a copy held in state used to do until the query
  // finished and overwrote it.
  const [appended, setAppended] = useState<any[]>([])

  const { data, loading } = useQuery(PLAYER, { variables: { id }, skip: !id })
  const {
    data: tl,
    loading: tlLoading,
    fetchMore,
  } = useQuery(PLAYER_TIMELINE, {
    variables: { playerId: id, limit: 25, sources: sources.length ? sources : null },
    skip: !id,
  })

  // A different filter is a different list; anything paged onto the old one is
  // no longer part of it.
  useEffect(() => {
    setAppended([])
  }, [sources, id])

  const p = data?.crmPlayer

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />

  // The server returns null both for a player who does not exist and for one
  // outside this caller's books, and says the same thing about each.
  if (!p) {
    return (
      <Result
        status="404"
        title="Player not available"
        subTitle="This player is not in your books, or does not exist."
        extra={
          <Button type="primary" onClick={() => navigate('/players')}>
            Back to players
          </Button>
        }
      />
    )
  }

  const shown = [...(tl?.crmPlayerTimeline?.entries ?? []), ...appended]
  const cursor = tl?.crmPlayerTimeline?.nextCursor ?? null

  const loadMore = async () => {
    if (!cursor) return
    const more = await fetchMore({ variables: { cursor } })
    const next = more.data?.crmPlayerTimeline
    setAppended((a) => [...a, ...(next?.entries ?? [])])
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/players')}>
          Players
        </Button>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {p.name}
        </Typography.Title>
        <Tag color={p.status === 'active' ? 'green' : p.status === 'suspended' ? 'red' : 'default'}>
          {p.status}
        </Tag>
        {p.bookName ? <Tag color="blue">{p.bookName}</Tag> : <Tag>Unassigned</Tag>}
        {p.withdrawalLock && <Tag color="red">Withdrawals locked</Tag>}
        {p.riskType && <Tag color="volcano">Risk: {p.riskType}</Tag>}
      </Space>

      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Stat label="Cash" value={money(p.cash)} /></Col>
        <Col xs={12} md={6}><Stat label="Bonus" value={money(p.bonus)} /></Col>
        <Col xs={12} md={6}><Stat label="Exposure" value={money(p.exposure)} /></Col>
        <Col xs={12} md={6}><Stat label="Referral" value={money(p.referralBalance)} /></Col>
        <Col xs={12} md={6}>
          <Stat label={`Deposits (${p.depositCount})`} value={money(p.totalDeposits)} />
        </Col>
        <Col xs={12} md={6}>
          <Stat label={`Withdrawals (${p.withdrawalCount})`} value={money(p.totalWithdrawals)} />
        </Col>
        <Col xs={12} md={6}>
          <Stat label={`Staked (${p.betCount.toLocaleString('en-IN')} bets)`} value={money(p.totalStake)} />
        </Col>
        <Col xs={12} md={6}>
          <Stat
            label="Net in / out"
            value={money(String(Number(p.totalDeposits) - Number(p.totalWithdrawals)))}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={9}>
          <Card title="Profile" size="small">
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Player ID">#{p.id}</Descriptions.Item>
              <Descriptions.Item label="Username">{p.username ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Phone">{p.phone ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Email">{p.email ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Type">{p.playerType}</Descriptions.Item>
              <Descriptions.Item label="Owner">{p.ownerName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Registered">{when(p.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="Last login">{when(p.lastLoginAt)}</Descriptions.Item>
              <Descriptions.Item label="First bet">{when(p.firstBetAt)}</Descriptions.Item>
              <Descriptions.Item label="Last bet">{when(p.lastBetAt)}</Descriptions.Item>
              <Descriptions.Item label="Betting">
                <Space size={4} wrap>
                  <Tag color={p.sportsBetAllowed ? 'green' : 'default'}>Sports</Tag>
                  <Tag color={p.casinoBetAllowed ? 'green' : 'default'}>Casino</Tag>
                  <Tag color={p.matkaBetAllowed ? 'green' : 'default'}>Matka</Tag>
                </Space>
              </Descriptions.Item>
              {Number(p.creditLimit) > 0 && (
                <Descriptions.Item label="Credit">
                  {money(p.creditUsed)} of {money(p.creditLimit)}
                </Descriptions.Item>
              )}
              {p.remark && <Descriptions.Item label="Remark">{p.remark}</Descriptions.Item>}
            </Descriptions>
            <Typography.Paragraph className="crm-muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              The CRM reads this. Balances, withdrawals and credit are changed in the admin panel.
            </Typography.Paragraph>
          </Card>

          <div style={{ marginTop: 16 }}>
            <PlayerSafetyPanel playerId={String(p.id)} />
          </div>
          <div style={{ marginTop: 16 }}>
            <PlayerContactPanel playerId={String(p.id)} />
          </div>
          <div style={{ marginTop: 16 }}>
            <PlayerNotesPanel playerId={String(p.id)} />
          </div>
          <div style={{ marginTop: 16 }}>
            <PlayerDsarPanel playerId={String(p.id)} />
          </div>
        </Col>

        <Col xs={24} lg={15}>
          <Card
            title="Timeline"
            size="small"
            extra={
              <Select
                mode="multiple"
                allowClear
                placeholder="All activity"
                style={{ minWidth: 240 }}
                value={sources}
                // Clearing the paged-in rows is handled by the effect that
                // watches `sources`, so changing the filter is just this.
                onChange={setSources}
                options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))}
              />
            }
          >
            {tlLoading && shown.length === 0 ? (
              <Skeleton active paragraph={{ rows: 6 }} />
            ) : shown.length === 0 ? (
              <Empty description="No activity recorded" />
            ) : (
              <>
                <Timeline
                  items={shown.map((e: any) => ({
                    color: SOURCE_COLOR[e.source] ?? 'gray',
                    children: (
                      <div>
                        <Space size={8} wrap>
                          <Tag color={SOURCE_COLOR[e.source]}>{SOURCE_LABEL[e.source] ?? e.source}</Tag>
                          {e.amount && <span className="crm-mono">{money(e.amount)}</span>}
                          {e.status && <Tag>{e.status}</Tag>}
                        </Space>
                        {e.detail && <div style={{ marginTop: 2 }}>{e.detail}</div>}
                        <div className="crm-muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {when(e.occurredAt)}
                        </div>
                      </div>
                    ),
                  }))}
                />
                {cursor ? (
                  <Button block loading={tlLoading} onClick={loadMore}>
                    Load more
                  </Button>
                ) : (
                  <Typography.Text className="crm-muted" style={{ fontSize: 12 }}>
                    End of activity
                  </Typography.Text>
                )}
              </>
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
