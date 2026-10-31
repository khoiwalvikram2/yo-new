import { useMemo, useState } from 'react'
import { Button, Card, Col, DatePicker, Empty, Result, Row, Space, Statistic, Table, Tooltip, Typography } from 'antd'
import { useQuery } from '@apollo/client'
import dayjs, { type Dayjs } from 'dayjs'
import { DESK_REPORT } from '@/lib/gql'
import { useAuth } from '@/state/auth'

/**
 * How the desk performed over a period.
 *
 * Desk health is triage — what is failing right now. This is review: what a
 * period produced, whether deadlines held, whether calls connected, and who did
 * the work. The numbers are the reader's own scope, so a book-bound supervisor
 * reviews their desk, not the whitelabel.
 *
 * "Breached" here means a deadline passed with nobody having acknowledged the
 * task — the same definition the server enforces — and the label says so,
 * because a supervisor acting on a number they misread is worse than no number.
 */

type DayRow = { date: string; created: number; completed: number }
type ChannelRow = { channel: string; attempts: number; connected: number }
type AgentRow = {
  crmUserId: string
  name: string
  tasksCompleted: number
  tasksBreached: number
  contactAttempts: number
  contactsConnected: number
  notesWritten: number
}

const pct = (part: number, whole: number): string =>
  whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`

/** 132 minutes reads as "2h 12m"; below an hour, plain minutes. */
const mins = (v: number | null): string => {
  if (v == null) return '—'
  if (v < 60) return `${v}m`
  return `${Math.floor(v / 60)}h ${v % 60}m`
}

export function ReportsPage() {
  const me = useAuth((s) => s.me)
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')])

  const variables = useMemo(
    () => ({ from: range[0].toISOString(), to: range[1].toISOString() }),
    [range]
  )
  const { data, loading, error, refetch } = useQuery(DESK_REPORT, { variables })

  const r = data?.crmDeskReport
  const maxDay = Math.max(1, ...(r?.tasks.byDay ?? []).map((d: DayRow) => Math.max(d.created, d.completed)))

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Reports
          </Typography.Title>
          <Typography.Text className="crm-muted">
            {me?.canViewAllPlayers
              ? 'The whole whitelabel, over the period.'
              : 'Your books, over the period.'}
          </Typography.Text>
        </div>
        <DatePicker.RangePicker
          allowClear={false}
          value={range}
          maxDate={dayjs()}
          onChange={(v) => {
            if (v && v[0] && v[1]) setRange([v[0].startOf('day'), v[1].endOf('day')])
          }}
        />
      </div>

      {/*
        Nothing below is rendered when the query failed. Every tile falls back
        to `?? 0`, so a failed report used to paint a complete, plausible page
        of zeros under a one-line error — which reads as a quiet week, not as a
        number that never arrived. A supervisor acting on that is acting on
        nothing.
      */}
      {error ? (
        <Card size="small">
          <Result
            status="warning"
            title="The report could not be loaded"
            subTitle={error.message}
            extra={
              <Button onClick={() => refetch()} loading={loading}>
                Try again
              </Button>
            }
          />
        </Card>
      ) : (
      <>
      <Card size="small" loading={loading} title="Tasks">
        <Row gutter={[16, 16]}>
          <Col xs={12} md={4}>
            <Statistic title="Created" value={r?.tasks.created ?? 0} />
          </Col>
          <Col xs={12} md={4}>
            <Statistic title="Completed" value={r?.tasks.completed ?? 0} />
          </Col>
          <Col xs={12} md={4}>
            <Tooltip title="Went past their deadline with nobody having acknowledged them">
              <Statistic
                title="Breached"
                value={r?.tasks.breached ?? 0}
                valueStyle={(r?.tasks.breached ?? 0) > 0 ? { color: '#cf1322' } : undefined}
              />
            </Tooltip>
          </Col>
          <Col xs={12} md={4}>
            <Statistic title="Open now" value={r?.tasks.openNow ?? 0} />
          </Col>
          <Col xs={12} md={4}>
            <Statistic title="Avg time to close" value={mins(r?.tasks.avgMinutesToClose ?? null)} />
          </Col>
          <Col xs={12} md={4}>
            <Tooltip title="From the deadline passing to someone picking the escalation up">
              <Statistic title="Avg pick-up after breach" value={mins(r?.tasks.avgMinutesToAcknowledge ?? null)} />
            </Tooltip>
          </Col>
        </Row>

        {(r?.tasks.byDay?.length ?? 0) > 0 && (
          <div style={{ marginTop: 16 }}>
            <Typography.Text className="crm-muted" style={{ fontSize: 12 }}>
              Per day — created vs completed
            </Typography.Text>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 72, marginTop: 8 }}>
              {(r?.tasks.byDay ?? []).map((d: DayRow) => (
                <Tooltip key={d.date} title={`${d.date}: ${d.created} created, ${d.completed} completed`}>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', flex: 1, minWidth: 10, height: '100%' }}>
                    <div
                      data-testid="bar-created"
                      style={{ flex: 1, background: '#91caff', height: `${(d.created / maxDay) * 100}%`, minHeight: d.created > 0 ? 3 : 0 }}
                    />
                    <div
                      data-testid="bar-completed"
                      style={{ flex: 1, background: '#95de64', height: `${(d.completed / maxDay) * 100}%`, minHeight: d.completed > 0 ? 3 : 0 }}
                    />
                  </div>
                </Tooltip>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" loading={loading} title="Contact attempts">
            <Row gutter={16} style={{ marginBottom: 8 }}>
              <Col span={8}>
                <Statistic title="Attempts" value={r?.contacts.attempts ?? 0} />
              </Col>
              <Col span={8}>
                <Statistic title="Connected" value={r?.contacts.connected ?? 0} />
              </Col>
              <Col span={8}>
                <Statistic title="Reach rate" value={pct(r?.contacts.connected ?? 0, r?.contacts.attempts ?? 0)} />
              </Col>
            </Row>
            <Table<ChannelRow>
              rowKey="channel"
              size="small"
              pagination={false}
              dataSource={r?.contacts.byChannel ?? []}
              locale={{ emptyText: <Empty description="No contact attempts in this period" /> }}
              columns={[
                { title: 'Channel', dataIndex: 'channel' },
                { title: 'Attempts', dataIndex: 'attempts', align: 'right' },
                { title: 'Connected', dataIndex: 'connected', align: 'right' },
                {
                  title: 'Reach rate',
                  align: 'right',
                  render: (_, row) => pct(row.connected, row.attempts),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" loading={loading} title="Responsible gambling">
            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="Flags raised" value={r?.rg.flagsRaised ?? 0} />
              </Col>
              <Col span={8}>
                <Statistic title="Flags lifted" value={r?.rg.flagsLifted ?? 0} />
              </Col>
              <Col span={8}>
                <Tooltip title="Standing right now, not range-bound">
                  <Statistic title="Active blocks" value={r?.rg.blocksActiveNow ?? 0} />
                </Tooltip>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Card size="small" loading={loading} title="By person">
        <Table<AgentRow>
          rowKey="crmUserId"
          size="small"
          pagination={false}
          dataSource={r?.agents ?? []}
          locale={{ emptyText: <Empty description="No activity in this period" /> }}
          scroll={{ x: 700 }}
          columns={[
            { title: 'Who', dataIndex: 'name' },
            { title: 'Tasks completed', dataIndex: 'tasksCompleted', align: 'right' },
            {
              title: 'Tasks breached',
              dataIndex: 'tasksBreached',
              align: 'right',
              render: (v: number) => (v > 0 ? <span style={{ color: '#cf1322' }}>{v}</span> : v),
            },
            { title: 'Contact attempts', dataIndex: 'contactAttempts', align: 'right' },
            { title: 'Connected', dataIndex: 'contactsConnected', align: 'right' },
            {
              title: 'Reach rate',
              align: 'right',
              render: (_, row) => pct(row.contactsConnected, row.contactAttempts),
            },
            { title: 'Notes', dataIndex: 'notesWritten', align: 'right' },
          ]}
        />
      </Card>
      </>
      )}
    </Space>
  )
}
