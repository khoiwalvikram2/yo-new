import { useState } from 'react'
import { App, Button, Form, Input, InputNumber, Modal, Select, Space } from 'antd'
import { useMutation, useQuery } from '@apollo/client'
import { APPLY_TAGS, REMOVE_TAGS, TAGS, BOOKS, CREATE_TASKS_FOR_PLAYERS } from '@/lib/gql'
import { useAuth, can } from '@/state/auth'

/**
 * What a desk can do to the players it has selected.
 *
 * Two of these had a complete, tested, permission-gated backend and no way to
 * reach it: `crmApplyTags` and `crmRemoveTags` shipped with the tag vocabulary,
 * so a whitelabel could create tags, filter by them and see them on a row — and
 * never put one on a player. `crm.tags:apply` gated a screen that could not
 * apply anything.
 *
 * The bulk task path is new. It reports counts rather than success, because the
 * interesting outcome is the partial one: some of the selected players already
 * had the task open, and saying "created 38, 2 already open" is the difference
 * between a number people trust and one they learn to ignore.
 */

type Props = {
  selected: string[]
  onDone: () => void
}

type TagOption = { id: string; name: string; colour: string; isArchived: boolean }
type Book = { id: string; name: string }

export function PlayerBulkActions({ selected, onDone }: Props) {
  const me = useAuth((s) => s.me)
  const { message } = App.useApp()

  const mayTag = can(me, 'crm.tags', 'apply')
  const mayTask = can(me, 'crm.tasks', 'manage')
  const mayBooks = can(me, 'crm.books', 'view')

  const [tagOpen, setTagOpen] = useState(false)
  const [taskOpen, setTaskOpen] = useState(false)
  const [chosenTags, setChosenTags] = useState<string[]>([])

  // Only fetched for people who can act on them, so a read-only agent does not
  // pull the tag vocabulary or the book list on every player page.
  const { data: tagData } = useQuery(TAGS, { skip: !mayTag })
  const { data: bookData } = useQuery(BOOKS, { skip: !mayTask || !mayBooks })

  const [applyTags, { loading: applying }] = useMutation(APPLY_TAGS)
  const [removeTags, { loading: removing }] = useMutation(REMOVE_TAGS)
  const [createTasks, { loading: creatingTasks }] = useMutation(CREATE_TASKS_FOR_PLAYERS)

  // Archived tags stay on the players carrying them but are no longer offered.
  const tags: TagOption[] = (tagData?.crmTags ?? []).filter((t: TagOption) => !t.isArchived)
  const books: Book[] = bookData?.crmBooks ?? []

  if (selected.length === 0) return null

  const runTags = async (mode: 'apply' | 'remove') => {
    if (chosenTags.length === 0) {
      message.warning('Choose at least one tag')
      return
    }
    const mutate = mode === 'apply' ? applyTags : removeTags
    const key = mode === 'apply' ? 'crmApplyTags' : 'crmRemoveTags'
    const res = await mutate({ variables: { playerIds: selected, tagIds: chosenTags } })
    const out = res.data?.[key]
    if (!out?.ok) {
      message.error(out?.error ?? 'Could not update tags')
      return
    }
    message.success(
      mode === 'apply'
        ? `Tagged ${selected.length} player(s)`
        : `Removed the tag from ${selected.length} player(s)`
    )
    setChosenTags([])
    setTagOpen(false)
    onDone()
  }

  const runTasks = async (values: {
    bookId: string
    title: string
    slaMinutes: number
    priority?: string
    body?: string
  }) => {
    const res = await createTasks({
      variables: {
        playerIds: selected,
        bookId: values.bookId,
        title: values.title,
        slaMinutes: values.slaMinutes,
        priority: values.priority ?? 'NORMAL',
        body: values.body ?? null,
      },
    })
    const out = res.data?.crmCreateTasksForPlayers
    if (!out?.ok) {
      message.error(out?.error ?? 'Could not create the tasks')
      return
    }
    // Every non-zero count is reported. A batch that silently did less than it
    // was asked is the outcome this whole shape exists to prevent.
    const parts = [`Created ${out.created} task(s)`]
    if (out.skippedDuplicate > 0) parts.push(`${out.skippedDuplicate} already open`)
    if (out.skippedUnreachable > 0) parts.push(`${out.skippedUnreachable} not in your books`)
    message.success(parts.join(' · '))
    setTaskOpen(false)
    onDone()
  }

  return (
    <>
      <Space wrap>
        {mayTag && <Button onClick={() => setTagOpen(true)}>Tag {selected.length}</Button>}
        {mayTask && (
          <Button onClick={() => setTaskOpen(true)}>Create tasks for {selected.length}</Button>
        )}
      </Space>

      <Modal
        open={tagOpen}
        title={`Tags for ${selected.length} player(s)`}
        onCancel={() => setTagOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setTagOpen(false)}>
            Cancel
          </Button>,
          <Button key="remove" danger loading={removing} onClick={() => runTags('remove')}>
            Remove these tags
          </Button>,
          <Button key="apply" type="primary" loading={applying} onClick={() => runTags('apply')}>
            Apply these tags
          </Button>,
        ]}
      >
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="Choose tags"
          value={chosenTags}
          onChange={setChosenTags}
          options={tags.map((t) => ({ value: t.id, label: t.name }))}
          filterOption={(input, option) =>
            String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
        />
      </Modal>

      <Modal
        open={taskOpen}
        title={`Create a task for ${selected.length} player(s)`}
        onCancel={() => setTaskOpen(false)}
        footer={null}
      >
        <Form
          layout="vertical"
          onFinish={runTasks}
          requiredMark={false}
          initialValues={{ slaMinutes: 120, priority: 'NORMAL' }}
          disabled={creatingTasks}
        >
          <Form.Item name="title" label="What needs doing" rules={[{ required: true }]}>
            <Input placeholder="e.g. Welcome call" />
          </Form.Item>
          <Form.Item
            name="bookId"
            label="Book"
            rules={[{ required: true, message: 'Choose the book this work belongs to' }]}
          >
            <Select options={books.map((b) => ({ value: b.id, label: b.name }))} />
          </Form.Item>
          <Space size={16} align="start" wrap>
            <Form.Item
              name="slaMinutes"
              label="SLA (working minutes)"
              rules={[{ required: true }]}
              extra="Counted against the desk calendar."
            >
              <InputNumber min={5} step={15} />
            </Form.Item>
            <Form.Item name="priority" label="Priority">
              <Select
                style={{ width: 140 }}
                options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: p }))}
              />
            </Form.Item>
          </Space>
          <Form.Item name="body" label="Notes">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={creatingTasks}>
            Create {selected.length} task(s)
          </Button>
        </Form>
      </Modal>
    </>
  )
}
