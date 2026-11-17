import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import CategoryFormDrawer from './CategoryFormDrawer'

const image = vi.hoisted(() => ({ compress: vi.fn() }))
const feedback = vi.hoisted(() => ({ toast: vi.fn() }))

vi.mock('@/shared/utils/imageCompression', () => ({
  compressImageToDataUrl: (...args: unknown[]) => image.compress(...args),
}))

vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))

function renderDrawer(overrides: Partial<ComponentProps<typeof CategoryFormDrawer>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  const result = render(
    <CategoryFormDrawer
      open
      mode="create"
      initial={{ mainCategory: 'SLOTS' }}
      onClose={onClose}
      onSubmit={onSubmit}
      {...overrides}
    />,
  )
  return { ...result, onSubmit, onClose }
}

function completeRequiredFields(name = 'VIP Games') {
  fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: name } })
  fireEvent.change(screen.getByPlaceholderText('unique-slug'), { target: { value: 'vip-games' } })
}

describe('CategoryFormDrawer', () => {
  beforeEach(() => {
    image.compress.mockReset()
    feedback.toast.mockReset()
  })

  test('opens with the selected main category and legacy default values', () => {
    renderDrawer()
    assert.ok(screen.getByRole('heading', { name: 'New Slots Category' }))
    assert.equal(screen.getByRole('button', { name: 'Slots' }).getAttribute('aria-pressed'), 'true')
    assert.equal((screen.getByRole('combobox') as HTMLSelectElement).value, 'GENERAL')
    assert.equal(screen.getByRole('switch', { name: 'Active' }).getAttribute('aria-checked'), 'true')
  })

  test('auto-generates a slug for a new category but preserves an edit slug', () => {
    const first = renderDrawer()
    fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: ' Teen Patti & More! ' } })
    assert.equal((screen.getByPlaceholderText('unique-slug') as HTMLInputElement).value, 'teen-patti-more')
    first.unmount()

    renderDrawer({
      mode: 'edit',
      initial: { mainCategory: 'CASINO', name: 'Old', slug: 'custom-slug' },
    })
    fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: 'New name' } })
    assert.equal((screen.getByPlaceholderText('unique-slug') as HTMLInputElement).value, 'custom-slug')
  })

  test('announces field errors and does not submit invalid values', async () => {
    const { onSubmit } = renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Create Category' }))
    assert.ok(await screen.findByText('Enter category name'))
    assert.ok(screen.getByText('Enter category slug'))
    assert.equal(onSubmit.mock.calls.length, 0)
  })

  test('submits the exact create payload and boolean status', async () => {
    const { onSubmit } = renderDrawer()
    completeRequiredFields()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'FEATURED' } })
    fireEvent.change(screen.getByPlaceholderText('Optional subtitle (max 200 chars)'), { target: { value: 'Lobby picks' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Active' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create Category' }))

    await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1))
    assert.deepEqual(onSubmit.mock.calls[0]?.[0], {
      mainCategory: 'SLOTS',
      type: 'FEATURED',
      subtitle: 'Lobby picks',
      name: 'VIP Games',
      slug: 'vip-games',
      iconData: undefined,
      isActive: false,
    })
  })

  test('rejects a non-image and keeps the form open', () => {
    const { container } = renderDrawer()
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['text'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })
    assert.deepEqual(feedback.toast.mock.calls[0]?.[0], {
      message: 'Please upload an image file',
      tone: 'error',
      duration: 3000,
    })
    assert.equal(image.compress.mock.calls.length, 0)
    assert.ok(screen.getByRole('dialog'))
  })

  test('offers Casino lounge and preserves its type when creating or editing', async () => {
    const first = renderDrawer({ initial: { mainCategory: 'CASINO' } })
    completeRequiredFields('Casino lounge')
    assert.ok(screen.getByRole('option', { name: 'Casino lounge' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'LOUNGE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Category' }))
    await waitFor(() => assert.equal(first.onSubmit.mock.calls.length, 1))
    assert.equal(first.onSubmit.mock.calls[0]?.[0].type, 'LOUNGE')
    first.unmount()

    const edit = renderDrawer({ mode: 'edit', initial: {
      mainCategory: 'CASINO', type: 'LOUNGE', name: 'Casino lounge', slug: 'casino-lounge',
    } })
    assert.equal((screen.getByRole('combobox') as HTMLSelectElement).value, 'LOUNGE')
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.equal(edit.onSubmit.mock.calls.length, 1))
    assert.equal(edit.onSubmit.mock.calls[0]?.[0].type, 'LOUNGE')
  })

  test('compresses an image, previews it and prefers it in the save payload', async () => {
    image.compress.mockResolvedValue('data:image/png;base64,new')
    const { container, onSubmit } = renderDrawer({
      initial: { mainCategory: 'SLOTS', iconData: 'old/storage-key.png' },
    })
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['png'], 'icon.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    assert.ok(await screen.findByAltText('Category icon preview'))
    assert.ok(screen.getByText('Ready to save'))
    completeRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: 'Create Category' }))
    await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1))
    assert.equal(onSubmit.mock.calls[0]?.[0].iconData, 'data:image/png;base64,new')
    assert.equal(image.compress.mock.calls[0]?.[1], 'casinoIcon')
    assert.equal(feedback.toast.mock.calls.at(-1)?.[0].message, 'Icon ready to save')
  })

  test('an unchanged stored icon is not sent back; a removed one is sent as null with the emptied subtitle', async () => {
    const stored = 'data:image/png;base64,c3RvcmVk'
    const kept = renderDrawer({
      mode: 'edit',
      initial: { mainCategory: 'LIVE_CASINO', name: 'Live', slug: 'live', subtitle: 'Old sub', iconData: stored },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.equal(kept.onSubmit.mock.calls.length, 1))
    // The stored data URI is only the preview: an unchanged icon is left as stored, not sent back.
    assert.equal(kept.onSubmit.mock.calls[0]?.[0].iconData, undefined)
    assert.equal(kept.onSubmit.mock.calls[0]?.[0].subtitle, 'Old sub')
    kept.unmount()

    const removed = renderDrawer({
      mode: 'edit',
      initial: { mainCategory: 'LIVE_CASINO', name: 'Live', slug: 'live', subtitle: 'Old sub', iconData: stored },
    })
    fireEvent.change(screen.getByPlaceholderText('Optional subtitle (max 200 chars)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove category icon' }))
    assert.equal(screen.queryByAltText('Category icon preview'), null)
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => assert.equal(removed.onSubmit.mock.calls.length, 1))
    assert.equal(removed.onSubmit.mock.calls[0]?.[0].iconData, null)
    assert.equal(removed.onSubmit.mock.calls[0]?.[0].subtitle, undefined, 'the update patch turns it into null')
  })

  test('Reset restores opening values and Cancel requests a close', () => {
    const { onClose } = renderDrawer({
      mode: 'edit',
      initial: { mainCategory: 'CASINO', name: 'Original', slug: 'original', isActive: false },
    })
    fireEvent.change(screen.getByPlaceholderText('Category name'), { target: { value: 'Changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    assert.equal((screen.getByPlaceholderText('Category name') as HTMLInputElement).value, 'Original')
    assert.equal(screen.getByRole('switch', { name: 'Inactive' }).getAttribute('aria-checked'), 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.equal(onClose.mock.calls.length, 1)
  })
})
