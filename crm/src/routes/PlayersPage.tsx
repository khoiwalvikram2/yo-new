import { useMemo, useState } from 'react'
import { Card, Table, Input, Select, Space, Tag, Typography, Button, Modal, App, Empty } from 'antd'
import { SearchOutlined, DownloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useLazyQuery } from '@apollo/client'
import { PLAYERS, BOOKS, TAGS, ASSIGN_PLAYERS, UNASSIGN_PLAYERS, EXPORT_PLAYERS } from '@/lib/gql'
import { useAuth, can } from '@/state/auth'
import { PlayerBulkActions } from '@/components/PlayerBulkActions'
import { SegmentBar, type PlayerFilter } from '@/components/SegmentBar'

type Player = {
  id: string
  name: string
  username: string | null
  phone: string | null
  status: string
  playerType: string
  createdAt: string
  lastLoginAt: string | null
  cash: string
  bonus: string
  exposure: string
  bookId: string | null
  bookName: string | null
  ownerName: string | null
  tags: Array<{ id: string; name: string; colour: string }>
  noteCount: number
}

const money = (v: string | null) =>
  v == null ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const when = (v: string | null) =>
  v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

const STATUS_COLOR: Record<string, string> = { active: 'green', inactive: 'default', suspended: 'red' }

export function PlayersPage() {
  const navigate = useNavigate()
  const me = useAuth((s) => s.me)
  const { message } = App.useApp()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<string | undefined>()
  const [bookId, setBookId] = useState<string | undefined>()
  const [assignment, setAssignment] = useState<string | undefined>()
  // The tag and note filters the server has supported since the tag vocabulary
  // shipped. Nothing sent them, so `crmPlayers` had three filter fields no
  // caller could reach — and a segment saved on them would have been unusable.
  const [tagIds, setTagIds] = useState<string[]>([])
  const [tagMatch, setTagMatch] = useState<string | undefined>()
  const [hasNotes, setHasNotes] = useState<boolean | undefined>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState<React.Key[]>([])
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignTo, setAssignTo] = useState<string | undefined>()

  const filter = useMemo(
    () => ({
      search: search.trim() || null,
      status: status ?? null,
      bookId: bookId ?? null,
      assignment: assignment ?? null,
      tagIds: tagIds.length > 0 ? tagIds : null,
      // Only meaningful alongside tags, and 'all' is the server's default.
      tagMatch: tagIds.length > 0 ? (tagMatch ?? 'all') : null,
      hasNotes: hasNotes ?? null,
    }),
    [search, status, bookId, assignment, tagIds, tagMatch, hasNotes]
  )

  /** Loads a saved segment into the controls, so the screen matches the filter. */
  const applySegment = (f: PlayerFilter) => {
    setSearch(f.search ?? '')
    setStatus(f.status ?? undefined)
    setBookId(f.bookId ?? undefined)
    setAssignment(f.assignment ?? undefined)
    setTagIds(f.tagIds ?? [])
    setTagMatch(f.tagMatch ?? undefined)
    setHasNotes(f.hasNotes ?? undefined)
    setPage(1)
  }

  const { data, loading, refetch } = useQuery(PLAYERS, {
    variables: { filter, limit: pageSize, offset: (page - 1) * pageSize },
  })
  const { data: booksData } = useQuery(BOOKS, { skip: !can(me, 'crm.books', 'view') })
  const { data: tagData } = useQuery(TAGS)
  const [runExport, { loading: exporting }] = useLazyQuery(EXPORT_PLAYERS, { fetchPolicy: 'network-only' })

  /**
   * Downloads exactly what the current filter shows.
   *
   * Exporting the filtered view rather than everything is the point: the server
   * caps the rows and says when the cap bit, so a partial file is never mistaken
   * for the whole book.
   */
  const exportCsv = async () => {
    const res = await runExport({ variables: { filter } })
    const out = res.data?.crmExportPlayers
    if (!out) {
      message.error('Could not build the export')
      return
    }
    const blob = new Blob([out.csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = out.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    message.success(
      out.truncated
        ? `Exported the first ${out.rowCount} of ${out.total}. Narrow the filter for the rest.`
        : `Exported ${out.rowCount} players`
    )
  }
  const [assign] = useMutation(ASSIGN_PLAYERS)
  const [unassign] = useMutation(UNASSIGN_PLAYERS)

  const canManageBooks = can(me, 'crm.books', 'manage')
  // Selection drives every bulk action, not just moving between books. Gating
  // it on books:manage alone hid tagging and bulk tasks from the people whose
  // permissions allow exactly those.
  const canSelect = canManageBooks || can(me, 'crm.tags', 'apply') || can(me, 'crm.tasks', 'manage')
  const books = booksData?.crmBooks ?? []
  const tags: Array<{ id: string; name: string; isArchived: boolean }> = tagData?.crmTags ?? []
  const items: Player[] = data?.crmPlayers?.items ?? []
  const total: number = data?.crmPlayers?.total ?? 0

  const runAssign = async () => {
    if (!assignTo) return
    const res = await assign({ variables: { playerIds: selected, bookId: assignTo } })
    if (res.data?.crmAssignPlayers?.ok) {
      message.success(`Moved ${selected.length} player(s)`)
      setSelected([])
      setAssignOpen(false)
      refetch()
    } else {
      message.error(res.data?.crmAssignPlayers?.error ?? 'Could not move players')
    }
  }

  const runUnassign = async () => {
    const res = await unassign({ variables: { playerIds: selected } })
    if (res.data?.crmUnassignPlayers?.ok) {
      message.success(`Removed ${selected.length} player(s) from their book`)
      setSelected([])
      refetch()
    } else {
      message.error(res.data?.crmUnassignPlayers?.error ?? 'Could not update')
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Players
        </Typography.Title>
        <Typography.Text className="crm-muted">
          {me?.canViewAllPlayers
            ? 'Every player in this whitelabel'
            : 'The players in your books'}
        </Typography.Text>
        {can(me, 'crm.players', 'export') && (
          <Button
            style={{ marginLeft: 'auto' }}
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={exportCsv}
          >
            Export CSV
          </Button>
        )}
      </div>

      <Card size="small">
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Name, username, phone or email"
            style={{ width: 280 }}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
          <Select
            allowClear
            placeholder="Status"
            style={{ width: 140 }}
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'suspended', label: 'Suspended' },
            ]}
          />
          {books.length > 0 && (
            <Select
              allowClear
              placeholder="Book"
              style={{ width: 180 }}
              value={bookId}
              onChange={(v) => {
                setBookId(v)
                setPage(1)
              }}
              options={books.map((b: { id: string; name: string }) => ({ value: b.id, label: b.name }))}
            />
          )}
          <Select
            allowClear
            placeholder="Assignment"
            style={{ width: 160 }}
            value={assignment}
            onChange={(v) => {
              setAssignment(v)
              setPage(1)
            }}
            options={[
              { value: 'assigned', label: 'In a book' },
              { value: 'unassigned', label: 'Not in a book' },
            ]}
          />
          <Select
            allowClear
            mode="multiple"
            placeholder="Tags"
            style={{ minWidth: 180 }}
            value={tagIds}
            onChange={(v) => {
              setTagIds(v)
              setPage(1)
            }}
            optionFilterProp="label"
            options={tags
              .filter((t) => !t.isArchived)
              .map((t) => ({ value: t.id, label: t.name }))}
          />
          {tagIds.length > 1 && (
            <Select
              style={{ width: 150 }}
              value={tagMatch ?? 'all'}
              onChange={(v) => {
                setTagMatch(v)
                setPage(1)
              }}
              options={[
                { value: 'all', label: 'All these tags' },
                { value: 'any', label: 'Any of them' },
              ]}
            />
          )}
          <Select
            allowClear
            placeholder="Notes"
            style={{ width: 150 }}
            value={hasNotes}
            onChange={(v) => {
              setHasNotes(v)
              setPage(1)
            }}
            options={[
              { value: true, label: 'Has notes' },
              { value: false, label: 'No notes' },
            ]}
          />
          <SegmentBar current={filter} onApply={applySegment} />
          {canManageBooks && selected.length > 0 && (
            <>
              <Button type="primary" onClick={() => setAssignOpen(true)}>
                Move {selected.length} to a book
              </Button>
              <Button onClick={runUnassign}>Remove from book</Button>
            </>
          )}
          <PlayerBulkActions
            selected={selected.map(String)}
            onDone={() => {
              setSelected([])
              refetch()
            }}
          />
        </Space>
      </Card>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table<Player>
          rowKey="id"
          loading={loading}
          dataSource={items}
          size="middle"
          scroll={{ x: 1000 }}
          locale={{
            emptyText: (
              <Empty
                description={
                  me?.canViewAllPlayers
                    ? 'No players match these filters'
                    : 'No players in your books yet. A supervisor assigns them.'
                }
              />
            ),
          }}
          rowSelection={
            canSelect
              ? { selectedRowKeys: selected, onChange: setSelected, preserveSelectedRowKeys: true }
              : undefined
          }
          onRow={(r) => ({ onClick: () => navigate(`/players/${r.id}`), style: { cursor: 'pointer' } })}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100],
            showTotal: (t) => `${t.toLocaleString('en-IN')} players`,
            onChange: (p, s) => {
              setPage(p)
              setPageSize(s)
            },
          }}
          columns={[
            {
              title: 'Player',
              dataIndex: 'name',
              fixed: 'left',
              width: 220,
              render: (_, r) => (
                <div>
                  <div style={{ fontWeight: 550 }}>{r.name}</div>
                  <div className="crm-muted" style={{ fontSize: 12 }}>
                    {r.username ?? r.phone ?? `#${r.id}`}
                  </div>
                </div>
              ),
            },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 110,
              render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{v}</Tag>,
            },
            { title: 'Type', dataIndex: 'playerType', width: 170, render: (v: string) => <Tag>{v}</Tag> },
            {
              title: 'Cash',
              dataIndex: 'cash',
              align: 'right',
              width: 120,
              render: (v: string) => <span className="crm-mono">{money(v)}</span>,
            },
            {
              title: 'Exposure',
              dataIndex: 'exposure',
              align: 'right',
              width: 120,
              render: (v: string) => <span className="crm-mono">{money(v)}</span>,
            },
            {
              title: 'Book',
              dataIndex: 'bookName',
              width: 160,
              render: (v: string | null, r) =>
                v ? (
                  <div>
                    <div>{v}</div>
                    {r.ownerName && (
                      <div className="crm-muted" style={{ fontSize: 12 }}>
                        {r.ownerName}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="crm-muted">Unassigned</span>
                ),
            },
            { title: 'Last seen', dataIndex: 'lastLoginAt', width: 180, render: when },
          ]}
        />
      </Card>

      <Modal
        title="Move players to a book"
        open={assignOpen}
        onCancel={() => setAssignOpen(false)}
        onOk={runAssign}
        okButtonProps={{ disabled: !assignTo }}
        okText="Move"
      >
        <Typography.Paragraph className="crm-muted">
          A player belongs to one book at a time, so this moves them out of any book they are in now.
        </Typography.Paragraph>
        <Select
          style={{ width: '100%' }}
          placeholder="Choose a book"
          value={assignTo}
          onChange={setAssignTo}
          options={books.map((b: { id: string; name: string }) => ({ value: b.id, label: b.name }))}
        />
      </Modal>
    </Space>
  )
}
