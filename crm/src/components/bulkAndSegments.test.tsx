import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { testCache } from '@/test-utils'
import { PlayerBulkActions } from '@/components/PlayerBulkActions'
import { SegmentBar } from '@/components/SegmentBar'
import { useAuth, type CrmMe, type CrmPermissionPair } from '@/state/auth'
import {
  TAGS,
  BOOKS,
  APPLY_TAGS,
  SEGMENTS,
  CREATE_SEGMENT,
  UPDATE_SEGMENT,
  CREATE_TASKS_FOR_PLAYERS,
} from '@/lib/gql'

/**
 * Bulk actions and saved segments.
 *
 * `crmApplyTags` and `crmRemoveTags` were built, gated and tested on the server
 * and reachable from nothing — the whole tag feature was inert because no
 * screen ever called them. These tests exist so that cannot silently happen
 * again: each asserts the mutation is actually sent, not merely that a button
 * renders.
 *
 * The other two properties are ones a typecheck cannot see:
 *
 *   - a bulk create reports its *partial* outcome. "Created 1, 1 already open"
 *     is the answer that makes the number trustworthy, and a screen that says
 *     "done" instead is how people stop reading it;
 *   - sharing a segment is offered only to someone who may share, because
 *     offering it produces a refusal the user cannot explain.
 */

function me(permissions: CrmPermissionPair[]): CrmMe {
  return {
    id: 'u1',
    name: 'Asha',
    email: null,
    status: 'ACTIVE',
    requirePasswordReset: false,
    tenant: 'acme',
    whitelabelName: 'Acme Casino',
    permissions,
    bookIds: [],
    canViewAllPlayers: permissions.some(
      (p) => p.domain === 'crm.players' && p.actions.includes('view_all')
    ),
    sessionIdleMinutes: 60,
    outOfOfficeUntil: null,
    delegateTo: null,
  }
}

const TAG = { __typename: 'CrmTag', id: 't1', name: 'VIP', colour: '#f00', description: null, isArchived: false, playerCount: 3 }
const ARCHIVED = { ...TAG, id: 't2', name: 'Retired promo', isArchived: true }
const BOOK = { __typename: 'CrmBook', id: 'b1', name: 'Book A', description: null, memberCount: 1, playerCount: 4, createdAt: new Date().toISOString() }

const tagsMock = (tags = [TAG, ARCHIVED]) => ({
  request: { query: TAGS },
  result: { data: { crmTags: tags } },
  maxUsageCount: 10,
})
const booksMock = {
  request: { query: BOOKS },
  result: { data: { crmBooks: [BOOK] } },
  maxUsageCount: 10,
}

function mount(node: React.ReactNode, permissions: CrmPermissionPair[], mocks: unknown[]) {
  useAuth.setState({ token: 'tok', me: me(permissions), lastActivityAt: Date.now() })
  return render(
    <MockedProvider mocks={mocks as never} cache={testCache()}>
      <MemoryRouter>
        <AntApp>{node}</AntApp>
      </MemoryRouter>
    </MockedProvider>
  )
}

/** antd reuses the opening control's label on the dialog, so scope the click. */
async function inDialog(label: RegExp) {
  const dialog = await waitFor(() => {
    const el = document.querySelector('.ant-modal-content')
    assert.ok(el, 'no dialog opened')
    return el as HTMLElement
  })
  const button = within(dialog)
    .getAllByRole('button')
    .find((b) => label.test((b.textContent ?? '').trim()))
  assert.ok(button, `the dialog offered no ${label}`)
  return button
}

beforeEach(() => {
  useAuth.setState({ token: null, me: null, lastActivityAt: Date.now() })
})

describe('bulk actions follow the permission', () => {
  test('offers nothing at all when nothing is selected', () => {
    mount(<PlayerBulkActions selected={[]} onDone={() => {}} />, [
      { domain: 'crm.tags', actions: ['apply'] },
    ], [tagsMock()])
    assert.equal(screen.queryByText(/^Tag /), null, 'an action bar appeared with no selection')
  })

  test('offers tagging with crm.tags:apply and not without it', async () => {
    const { unmount } = mount(<PlayerBulkActions selected={['1', '2']} onDone={() => {}} />, [
      { domain: 'crm.tags', actions: ['apply'] },
    ], [tagsMock()])
    await waitFor(() => assert.ok(screen.getByText('Tag 2')))
    unmount()

    mount(<PlayerBulkActions selected={['1', '2']} onDone={() => {}} />, [
      { domain: 'crm.players', actions: ['view'] },
    ], [tagsMock()])
    assert.equal(screen.queryByText('Tag 2'), null, 'tagging was offered without crm.tags:apply')
  })

  test('offers bulk tasks only with crm.tasks:manage', async () => {
    const { unmount } = mount(<PlayerBulkActions selected={['1']} onDone={() => {}} />, [
      { domain: 'crm.tasks', actions: ['manage'] },
      { domain: 'crm.books', actions: ['view'] },
    ], [booksMock])
    await waitFor(() => assert.ok(screen.getByText('Create tasks for 1')))
    unmount()

    mount(<PlayerBulkActions selected={['1']} onDone={() => {}} />, [
      { domain: 'crm.tasks', actions: ['view'] },
    ], [])
    assert.equal(screen.queryByText('Create tasks for 1'), null)
  })
})

describe('applying a tag — the path that had no caller', () => {
  test('sends the tag and the players that were selected', async () => {
    let sent: { playerIds: string[]; tagIds: string[] } | null = null
    const apply = {
      request: { query: APPLY_TAGS, variables: { playerIds: ['1', '2'], tagIds: ['t1'] } },
      result: () => {
        sent = { playerIds: ['1', '2'], tagIds: ['t1'] }
        return { data: { crmApplyTags: { __typename: 'CrmMutationResult', ok: true, error: null } } }
      },
    }

    mount(<PlayerBulkActions selected={['1', '2']} onDone={() => {}} />, [
      { domain: 'crm.tags', actions: ['apply'] },
    ], [tagsMock(), apply])

    fireEvent.click(await waitFor(() => screen.getByText('Tag 2')))

    // Choose the tag from the picker inside the dialog.
    const combo = await waitFor(() => {
      const el = document.querySelector('.ant-modal-content .ant-select-selector')
      assert.ok(el, 'the dialog offered no tag picker')
      return el as HTMLElement
    })
    fireEvent.mouseDown(combo)
    fireEvent.click(await waitFor(() => screen.getByTitle('VIP')))

    fireEvent.click(await inDialog(/apply these tags/i))
    await waitFor(() => assert.ok(sent, 'the tag mutation was never sent'))
  })

  test('does not offer an archived tag, which is no longer part of the vocabulary', async () => {
    mount(<PlayerBulkActions selected={['1']} onDone={() => {}} />, [
      { domain: 'crm.tags', actions: ['apply'] },
    ], [tagsMock()])

    fireEvent.click(await waitFor(() => screen.getByText('Tag 1')))
    const combo = await waitFor(() => {
      const el = document.querySelector('.ant-modal-content .ant-select-selector')
      assert.ok(el)
      return el as HTMLElement
    })
    fireEvent.mouseDown(combo)
    await waitFor(() => assert.ok(screen.getByTitle('VIP')))
    assert.equal(screen.queryByTitle('Retired promo'), null, 'an archived tag was offered')
  })
})

describe('creating tasks in bulk', () => {
  test('reports the partial outcome rather than plain success', async () => {
    const create = {
      request: {
        query: CREATE_TASKS_FOR_PLAYERS,
        variables: {
          playerIds: ['1', '2'],
          bookId: 'b1',
          title: 'Welcome call',
          slaMinutes: 120,
          priority: 'NORMAL',
          body: null,
        },
      },
      result: {
        data: {
          crmCreateTasksForPlayers: {
            __typename: 'CrmBulkTaskResult',
            ok: true,
            error: null,
            created: 1,
            skippedDuplicate: 1,
            skippedUnreachable: 0,
          },
        },
      },
    }

    mount(<PlayerBulkActions selected={['1', '2']} onDone={() => {}} />, [
      { domain: 'crm.tasks', actions: ['manage'] },
      { domain: 'crm.books', actions: ['view'] },
    ], [booksMock, create])

    fireEvent.click(await waitFor(() => screen.getByText('Create tasks for 2')))

    const dialog = await waitFor(() => {
      const el = document.querySelector('.ant-modal-content')
      assert.ok(el)
      return el as HTMLElement
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /what needs doing/i }), {
      target: { value: 'Welcome call' },
    })

    const bookPicker = dialog.querySelectorAll('.ant-select-selector')[0] as HTMLElement
    fireEvent.mouseDown(bookPicker)
    fireEvent.click(await waitFor(() => screen.getByTitle('Book A')))

    fireEvent.click(await inDialog(/create 2 task/i))

    await waitFor(() => {
      assert.ok(
        screen.getByText(/1 already open/i),
        'the batch reported success without saying what it skipped'
      )
    })
  })
})

describe('saved segments', () => {
  const segment = {
    __typename: 'CrmSegment',
    id: 's1',
    name: 'VIPs with no note',
    description: null,
    isShared: true,
    ownerName: 'Supervisor',
    isMine: false,
    filter: {
      __typename: 'CrmPlayerFilter',
      search: null,
      status: 'active',
      bookId: null,
      assignment: null,
      tagIds: ['t1'],
      tagMatch: 'all',
      hasNotes: false,
    },
  }
  const segmentsMock = {
    request: { query: SEGMENTS },
    result: { data: { crmSegments: [segment] } },
    maxUsageCount: 10,
  }

  test('hands the saved filter back to the screen when one is chosen', async () => {
    let applied: unknown = null
    mount(<SegmentBar current={{}} onApply={(f) => (applied = f)} />, [
      { domain: 'crm.players', actions: ['view'] },
    ], [segmentsMock])

    const picker = await waitFor(() => {
      const el = document.querySelector('.ant-select-selector')
      assert.ok(el, 'no segment picker rendered')
      return el as HTMLElement
    })
    fireEvent.mouseDown(picker)
    fireEvent.click(await waitFor(() => screen.getByText('VIPs with no note')))

    await waitFor(() => {
      assert.ok(applied, 'choosing a segment applied nothing')
      assert.equal((applied as { status: string }).status, 'active')
      assert.deepEqual((applied as { tagIds: string[] }).tagIds, ['t1'])
      assert.equal((applied as { hasNotes: boolean }).hasNotes, false)
    })
  })

  test('will not save with nothing filtered — an empty segment matches everyone', async () => {
    mount(<SegmentBar current={{}} onApply={() => {}} />, [
      { domain: 'crm.players', actions: ['view'] },
    ], [segmentsMock])
    const save = await waitFor(() => screen.getByRole('button', { name: /save segment/i }))
    assert.equal((save as HTMLButtonElement).disabled, true, 'an empty filter could be saved')
  })

  test('sends the current filter, stripped of the keys that were never set', async () => {
    let sent: Record<string, unknown> | null = null
    const create = {
      request: {
        query: CREATE_SEGMENT,
        variables: {
          name: 'My chases',
          description: null,
          filter: { status: 'active' },
          isShared: false,
        },
      },
      result: () => {
        sent = { filter: { status: 'active' } }
        return { data: { crmCreateSegment: { __typename: 'CrmMutationResult', ok: true, error: null } } }
      },
    }

    mount(
      // Nulls and blanks must not survive into the saved filter.
      <SegmentBar current={{ status: 'active', search: '   ', bookId: null, tagIds: [] }} onApply={() => {}} />,
      [{ domain: 'crm.players', actions: ['view'] }],
      [segmentsMock, create]
    )

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /save segment/i })))
    const dialog = await waitFor(() => {
      const el = document.querySelector('.ant-modal-content')
      assert.ok(el)
      return el as HTMLElement
    })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /name/i }), {
      target: { value: 'My chases' },
    })
    fireEvent.click(await inDialog(/save segment/i))

    await waitFor(() => assert.ok(sent, 'the segment was never saved'))
  })

  test('offers sharing only to someone who may share', async () => {
    const { unmount } = mount(
      <SegmentBar current={{ status: 'active' }} onApply={() => {}} />,
      [{ domain: 'crm.players', actions: ['view'] }],
      [segmentsMock]
    )
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /save segment/i })))
    await waitFor(() => assert.ok(document.querySelector('.ant-modal-content')))
    assert.equal(
      screen.queryByText(/share with the whole desk/i),
      null,
      'an agent was offered a share they would be refused'
    )
    unmount()

    mount(
      <SegmentBar current={{ status: 'active' }} onApply={() => {}} />,
      [{ domain: 'crm.players', actions: ['view', 'view_all'] }],
      [segmentsMock]
    )
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /save segment/i })))
    await waitFor(() =>
      assert.ok(screen.getByText(/share with the whole desk/i), 'a supervisor was not offered sharing')
    )
  })

  test('lets its author point an existing segment at the current filter', async () => {
    // Without an update path a segment is write-once: correcting a shared one
    // would mean deleting it, which breaks it for everyone who picked it.
    const mine = { ...segment, id: 's2', name: 'My chases', isShared: false, isMine: true }
    const listMine = {
      request: { query: SEGMENTS },
      result: { data: { crmSegments: [mine] } },
      maxUsageCount: 10,
    }
    let sent: Record<string, unknown> | null = null
    const patch = {
      request: { query: UPDATE_SEGMENT, variables: { id: 's2', filter: { status: 'suspended' } } },
      result: () => {
        sent = { id: 's2', filter: { status: 'suspended' } }
        return { data: { crmUpdateSegment: { __typename: 'CrmMutationResult', ok: true, error: null } } }
      },
    }

    mount(
      <SegmentBar current={{ status: 'suspended' }} onApply={() => {}} />,
      [{ domain: 'crm.players', actions: ['view'] }],
      [listMine, patch]
    )

    const picker = await waitFor(() => {
      const el = document.querySelector('.ant-select-selector')
      assert.ok(el)
      return el as HTMLElement
    })
    fireEvent.mouseDown(picker)
    fireEvent.click(await waitFor(() => screen.getByText('My chases')))

    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /update/i })))
    await waitFor(() => assert.ok(sent, 'the segment update was never sent'))
  })

  test('offers no delete on a segment someone else owns', async () => {
    mount(<SegmentBar current={{}} onApply={() => {}} />, [
      { domain: 'crm.players', actions: ['view'] },
    ], [segmentsMock])

    const picker = await waitFor(() => {
      const el = document.querySelector('.ant-select-selector')
      assert.ok(el)
      return el as HTMLElement
    })
    fireEvent.mouseDown(picker)
    fireEvent.click(await waitFor(() => screen.getByText('VIPs with no note')))

    // `isMine` is false on this one, so the control must not appear at all —
    // the server would refuse it, and a button that refuses is worse than none.
    await waitFor(() => assert.ok(screen.getByRole('button', { name: /save segment/i })))
    assert.equal(
      document.querySelector('.anticon-delete'),
      null,
      "a delete control was offered for someone else's segment"
    )
  })
})
