import { useState } from 'react'
import { App, Button, Checkbox, Form, Input, Modal, Select, Space, Tag, Tooltip } from 'antd'
import { DeleteOutlined, SaveOutlined, ReloadOutlined } from '@ant-design/icons'
import { useMutation, useQuery } from '@apollo/client'
import { SEGMENTS, CREATE_SEGMENT, UPDATE_SEGMENT, DELETE_SEGMENT } from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

/**
 * Saved player filters.
 *
 * A segment is a filter, not a list of players — the rows it yields are still
 * resolved against the reader's own books — which is why a shared one can be
 * offered to the whole desk without disclosing anything. The chip on a shared
 * segment names its author so it is obvious whose definition of the work it is.
 */

export type PlayerFilter = {
  search?: string | null
  status?: string | null
  bookId?: string | null
  assignment?: string | null
  tagIds?: string[] | null
  tagMatch?: string | null
  hasNotes?: boolean | null
}

type Segment = {
  id: string
  name: string
  description: string | null
  isShared: boolean
  ownerName: string | null
  isMine: boolean
  filter: PlayerFilter
}

type Props = {
  /** The filter as the screen currently has it, for saving. */
  current: PlayerFilter
  /** Applies a saved filter to the screen. */
  onApply: (filter: PlayerFilter) => void
}

/** Drops nulls so a saved filter carries only what was actually set. */
function tidy(filter: PlayerFilter): PlayerFilter {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(filter)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'string' && !v.trim()) continue
    out[k] = v
  }
  return out as PlayerFilter
}

export function SegmentBar({ current, onApply }: Props) {
  const me = useAuth((s) => s.me)
  const { message, modal } = App.useApp()
  const [saveOpen, setSaveOpen] = useState(false)
  const [chosen, setChosen] = useState<string | undefined>()

  // Sharing is an authorship control, not a scope one: a shared segment still
  // shows each reader only their own players.
  const mayShare = can(me, 'crm.players', 'view_all')

  const { data, refetch } = useQuery(SEGMENTS)
  const [create, { loading: saving }] = useMutation(CREATE_SEGMENT)
  const [update, { loading: updating }] = useMutation(UPDATE_SEGMENT)
  const [remove] = useMutation(DELETE_SEGMENT)

  const segments: Segment[] = data?.crmSegments ?? []
  const tidied = tidy(current)
  const hasFilter = Object.keys(tidied).length > 0

  const onSave = async (values: { name: string; description?: string; isShared?: boolean }) => {
    const res = await create({
      variables: {
        name: values.name,
        description: values.description ?? null,
        filter: tidied,
        isShared: values.isShared ?? false,
      },
    })
    const out = res.data?.crmCreateSegment
    if (!out?.ok) {
      message.error(out?.error ?? 'Could not save the segment')
      return
    }
    message.success('Segment saved')
    setSaveOpen(false)
    await refetch()
  }

  /**
   * Points an existing segment at the filter now on screen.
   *
   * Without this a segment is write-once: the only way to correct one is to
   * delete it and make a new one, which breaks it for everyone who had picked
   * the shared version.
   */
  const onUpdate = async (segment: Segment) => {
    const res = await update({ variables: { id: segment.id, filter: tidied } })
    const out = res.data?.crmUpdateSegment
    if (!out?.ok) {
      message.error(out?.error ?? 'Could not update the segment')
      return
    }
    message.success(`“${segment.name}” now uses these filters`)
    await refetch()
  }

  const onDelete = (segment: Segment) => {
    modal.confirm({
      title: `Delete “${segment.name}”?`,
      content: segment.isShared
        ? 'It will disappear for everyone on the desk.'
        : 'This only removes the saved filter, never any players.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await remove({ variables: { id: segment.id } })
        if (!res.data?.crmDeleteSegment?.ok) {
          message.error(res.data?.crmDeleteSegment?.error ?? 'Could not delete the segment')
          return
        }
        if (chosen === segment.id) setChosen(undefined)
        message.success('Segment deleted')
        await refetch()
      },
    })
  }

  const active = segments.find((s) => s.id === chosen)

  return (
    <Space wrap>
      <Select
        allowClear
        showSearch
        style={{ width: 240 }}
        placeholder="Saved segments"
        value={chosen}
        onChange={(id) => {
          setChosen(id)
          const seg = segments.find((s) => s.id === id)
          // Clearing the picker clears the filter too, so the control and the
          // list never disagree about what is being shown.
          onApply(seg ? seg.filter : {})
        }}
        optionFilterProp="label"
        options={segments.map((s) => ({
          value: s.id,
          label: s.name,
          title: s.description ?? undefined,
        }))}
        optionRender={(opt) => {
          const seg = segments.find((s) => s.id === opt.value)
          return (
            <Space size={4}>
              <span>{seg?.name}</span>
              {seg?.isShared && (
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                  {seg.ownerName ? `shared · ${seg.ownerName}` : 'shared'}
                </Tag>
              )}
            </Space>
          )
        }}
      />

      {active?.isMine && (
        <>
          <Tooltip
            title={
              hasFilter
                ? `Update “${active.name}” to the filters now on screen`
                : 'Set a filter first'
            }
          >
            <Button
              icon={<ReloadOutlined />}
              disabled={!hasFilter}
              loading={updating}
              onClick={() => onUpdate(active)}
            >
              Update
            </Button>
          </Tooltip>
          <Tooltip title="Delete this segment">
            <Button icon={<DeleteOutlined />} onClick={() => onDelete(active)} />
          </Tooltip>
        </>
      )}

      <Tooltip title={hasFilter ? 'Save these filters as a segment' : 'Set a filter first'}>
        <Button icon={<SaveOutlined />} disabled={!hasFilter} onClick={() => setSaveOpen(true)}>
          Save segment
        </Button>
      </Tooltip>

      <Modal
        open={saveOpen}
        title="Save this filter as a segment"
        onCancel={() => setSaveOpen(false)}
        footer={null}
      >
        <Form layout="vertical" onFinish={onSave} requiredMark={false} disabled={saving}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Give it a name' }]}>
            <Input placeholder="e.g. VIPs with no note" />
          </Form.Item>
          <Form.Item name="description" label="What it is for">
            <Input.TextArea rows={2} />
          </Form.Item>
          {mayShare && (
            <Form.Item name="isShared" valuePropName="checked">
              <Checkbox>
                Share with the whole desk
                <div className="crm-muted" style={{ fontSize: 12 }}>
                  Everyone sees the segment; each person still sees only the players in their own
                  books.
                </div>
              </Checkbox>
            </Form.Item>
          )}
          <Button type="primary" htmlType="submit" loading={saving}>
            Save segment
          </Button>
        </Form>
      </Modal>
    </Space>
  )
}
