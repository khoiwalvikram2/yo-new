import { Alert, Card, Empty, Space, Table, Tag, Typography, Button, Result } from 'antd'
import { useQuery } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import { DESK_HEALTH } from '@/lib/gql'

const { Title, Text, Paragraph } = Typography

type TaskRow = {
  id: string
  title: string
  bookName: string
  playerId: string | null
  assigneeName: string | null
  minutesOverdue: number
  escalationLevel?: number
  failedAttempts?: number
  firstFailedAt?: string | null
}

/** Minutes as something a person reads at a glance. */
const overdue = (m: number) => {
  if (m < 60) return `${m}m late`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h late`
  return `${Math.floor(h / 24)}d ${h % 24}h late`
}

/**
 * What is falling through, right now.
 *
 * The queue answers "what is on my list". This answers "what is going wrong",
 * which is a different question — so it is a different screen rather than more
 * filters on the agent's tool.
 *
 * Ordered by severity, not by count. The first card is the one nothing else in
 * the product shows: a task the escalation ladder could not deliver to anybody.
 * The system has been detecting that all along and writing it to an event log
 * no screen read.
 */
export function DeskHealthPage() {
  const navigate = useNavigate()
  const { data, loading, refetch } = useQuery(DESK_HEALTH, { fetchPolicy: 'cache-and-network' })
  const h = data?.crmDeskHealth

  const taskColumns = (extra: 'failed' | 'level' | null = null) => [
    {
      title: 'Task',
      dataIndex: 'title',
      render: (v: string, r: TaskRow) => (
        <Space direction="vertical" size={0}>
          <span>{v}</span>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.bookName}
            {r.assigneeName ? ` · ${r.assigneeName}` : ' · unassigned'}
          </Text>
        </Space>
      ),
    },
    ...(extra === 'failed'
      ? [
          {
            title: 'Failed',
            dataIndex: 'failedAttempts',
            width: 130,
            render: (n: number) => (
              // The repeat count is the severity. Failing twelve times over a
              // day is a different problem from failing once.
              <Tag color={n >= 3 ? 'red' : 'orange'}>{n === 1 ? 'once' : `${n} times`}</Tag>
            ),
          },
        ]
      : []),
    ...(extra === 'level'
      ? [{ title: 'Rung', dataIndex: 'escalationLevel', width: 90, render: (n: number) => <Tag>{n}</Tag> }]
      : []),
    {
      title: 'Overdue',
      dataIndex: 'minutesOverdue',
      width: 130,
      render: (m: number) => <Text type={m > 1440 ? 'danger' : 'warning'}>{overdue(m)}</Text>,
    },
    {
      title: '',
      key: 'go',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, r: TaskRow) => (
        <Button size="small" onClick={() => navigate(r.playerId ? `/players/${r.playerId}` : '/queue')}>
          Open
        </Button>
      ),
    },
  ]

  const Bucket = ({
    title,
    why,
    bucket,
    columns,
    rowKey,
    tone = 'default',
  }: {
    title: string
    why: string
    bucket?: { total: number; rows: any[] }
    columns: any[]
    rowKey: string
    tone?: 'danger' | 'warning' | 'default'
  }) => {
    if (!bucket || bucket.total === 0) return null
    const colour = tone === 'danger' ? '#cf1322' : tone === 'warning' ? '#d46b08' : undefined
    return (
      <Card
        size="small"
        title={
          <Space>
            <span style={{ color: colour }}>{title}</span>
            <Tag color={tone === 'danger' ? 'red' : tone === 'warning' ? 'orange' : 'default'}>
              {bucket.total}
            </Tag>
          </Space>
        }
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ padding: '8px 16px 0' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {why}
          </Text>
        </div>
        <Table
          rowKey={rowKey}
          size="small"
          dataSource={bucket.rows}
          columns={columns}
          pagination={false}
        />
        {bucket.total > bucket.rows.length && (
          <div style={{ padding: '8px 16px' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Showing {bucket.rows.length} of {bucket.total}.
            </Text>
          </div>
        )}
      </Card>
    )
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ marginBottom: 4 }}>
            Desk health
          </Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            What is falling through, worst first. Only the books you can see.
          </Paragraph>
        </div>
        <Button onClick={() => refetch()} loading={loading}>
          Refresh
        </Button>
      </div>

      {h?.allClear && (
        // An empty page must read as success, not as one that failed to load.
        <Result
          status="success"
          title="Nothing is falling through"
          subTitle="Every task has somewhere to go, every book has cover, and nobody is being chased without an answer."
        />
      )}

      <Bucket
        title="Reached nobody"
        why="The ladder ran and found no one to tell. These stay breaching until somebody picks them up — nothing else in the CRM shows this."
        bucket={h?.reachedNobody}
        columns={taskColumns('failed')}
        rowKey="id"
        tone="danger"
      />

      {h?.uncoveredBooks?.total > 0 && (
        <Card
          size="small"
          title={
            <Space>
              <span style={{ color: '#cf1322' }}>Books with no cover</span>
              <Tag color="red">{h.uncoveredBooks.total}</Tag>
            </Space>
          }
          styles={{ body: { padding: 0 } }}
        >
          <div style={{ padding: '8px 16px 0' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Nobody the ladder can reach for these books. This is the cause of the list above — fix
              a book here and its future escalations land.
            </Text>
          </div>
          <Table
            rowKey="bookId"
            size="small"
            pagination={false}
            dataSource={h.uncoveredBooks.rows}
            columns={[
              { title: 'Book', dataIndex: 'bookName' },
              {
                title: 'Open work',
                dataIndex: 'openTasks',
                width: 140,
                render: (n: number) => <Tag color={n > 0 ? 'red' : 'default'}>{n} tasks</Tag>,
              },
              {
                title: '',
                key: 'go',
                width: 100,
                align: 'right' as const,
                render: () => (
                  <Button size="small" onClick={() => navigate('/books')}>
                    Books
                  </Button>
                ),
              },
            ]}
          />
          <div style={{ padding: '8px 16px' }}>
            <Alert
              type="info"
              showIcon
              message="Give someone in the book the escalate permission"
              description="A book is only uncovered when nobody in it — and nobody in the whitelabel — holds crm.tasks:escalate."
            />
          </div>
        </Card>
      )}

      <Bucket
        title="Ladder exhausted"
        why="Climbed every rung and still unacknowledged. There is no further escalation coming."
        bucket={h?.ladderExhausted}
        columns={taskColumns('level')}
        rowKey="id"
        tone="danger"
      />

      <Bucket
        title="Breaching"
        why="Past the deadline and nobody has picked them up. Oldest first."
        bucket={h?.breaching}
        columns={taskColumns()}
        rowKey="id"
        tone="warning"
      />

      <Bucket
        title="Unassigned"
        why="Open work with no owner."
        bucket={h?.unassigned}
        columns={taskColumns()}
        rowKey="id"
      />

      {h?.neverReached?.total > 0 && (
        <Card
          size="small"
          title={
            <Space>
              <span>Never reached</span>
              <Tag color="orange">{h.neverReached.total}</Tag>
            </Space>
          }
          styles={{ body: { padding: 0 } }}
        >
          <div style={{ padding: '8px 16px 0' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Tried three or more times in the last 30 days and never got through. Usually a wrong
              number — occasionally someone who does not want to be reached.
            </Text>
          </div>
          <Table
            rowKey="playerId"
            size="small"
            pagination={false}
            dataSource={h.neverReached.rows}
            columns={[
              { title: 'Player', dataIndex: 'playerName', render: (v: string | null) => v ?? '—' },
              {
                title: 'Attempts',
                dataIndex: 'attempts',
                width: 110,
                render: (n: number) => <Tag color="orange">{n}</Tag>,
              },
              {
                title: 'Last outcome',
                dataIndex: 'lastOutcome',
                width: 150,
                render: (v: string | null) => (v ? <Tag>{v.replace(/_/g, ' ')}</Tag> : '—'),
              },
              {
                title: '',
                key: 'go',
                width: 100,
                align: 'right' as const,
                render: (_: unknown, r: { playerId: string }) => (
                  <Button size="small" onClick={() => navigate(`/players/${r.playerId}`)}>
                    Open
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}

      {!loading && !h && <Empty description="Could not read desk health" />}
    </Space>
  )
}
