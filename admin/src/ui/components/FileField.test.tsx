import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { FileField } from './FileField'
import { acceptsFile, formatFileSize } from './fileFieldUtils'
import styles from './FileField.module.css'

const png = (name = 'banner.png', size = 2048) => {
  const file = new File(['x'], name, { type: 'image/png' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
let created: string[]
let revoked: string[]

beforeEach(() => {
  created = []
  revoked = []
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:preview-${created.length + 1}`
    created.push(url)
    return url
  })
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url)
  })
})

afterEach(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
})

function input() {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

describe('FileField', () => {
  test('keeps a real file input named by the legend behind a described drop-zone button', () => {
    render(<FileField label="Logo" accept="image/*" name="logoUrl" help="PNG or JPG" onFiles={() => {}} />)
    const field = screen.getByLabelText('Logo') as HTMLInputElement
    assert.equal(field, input())
    assert.equal(field.type, 'file')
    assert.equal(field.accept, 'image/*')
    assert.equal(field.name, 'logoUrl')
    assert.equal(field.tabIndex, -1)
    assert.ok(screen.getByRole('group', { name: 'Logo' }))

    const zone = screen.getByRole('button', { name: 'Drop an image here or browse' })
    const hint = screen.getByText('PNG or JPG')
    assert.equal(zone.getAttribute('aria-describedby'), hint.id)
    assert.ok(zone.contains(hint))
  })

  test('an input label overrides the input name without renaming the group', () => {
    render(<FileField label="Logo" inputLabel="Upload Logo" onFiles={() => {}} />)
    assert.equal(screen.getByLabelText('Upload Logo'), input())
    assert.ok(screen.getByRole('group', { name: 'Logo' }))
    assert.ok(screen.getByRole('button', { name: 'Drop a file here or browse' }))
  })

  test('the zone opens the picker and a focus request on the input lands on the zone', () => {
    render(<FileField label="Logo" onFiles={() => {}} />)
    const click = vi.spyOn(input(), 'click')
    const zone = screen.getByRole('button', { name: /browse/ })
    fireEvent.click(zone)
    assert.equal(click.mock.calls.length, 1)

    input().focus()
    assert.equal(document.activeElement, zone)
  })

  test('a pick reaches onFiles, clears the input and lists the file with an object-URL thumbnail', () => {
    const onFiles = vi.fn()
    render(<FileField label="Banner" accept="image/*" onFiles={onFiles} />)
    const file = png()
    fireEvent.change(input(), { target: { files: [file] } })
    assert.deepStrictEqual(onFiles.mock.calls[0]?.[0], [file])
    assert.equal(input().value, '')

    const row = screen.getByRole('listitem')
    assert.ok(within(row).getByText('banner.png'))
    assert.ok(within(row).getByText('2 KB'))
    assert.equal(row.querySelector('img')?.getAttribute('src'), 'blob:preview-1')
  })

  test('removing a listed file revokes its URL, reports it and returns focus to the zone', () => {
    const onRemove = vi.fn()
    render(<FileField label="Banner" onFiles={() => {}} onRemove={onRemove} />)
    const file = png()
    fireEvent.change(input(), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove banner.png' }))
    assert.deepStrictEqual(revoked, ['blob:preview-1'])
    assert.equal(onRemove.mock.calls[0]?.[0], file)
    assert.equal(screen.queryByRole('listitem'), null)
    assert.equal(document.activeElement, screen.getByRole('button', { name: /browse/ }))
  })

  test('a single field replaces its file and unmounting revokes what is left', () => {
    const { unmount } = render(<FileField label="Banner" onFiles={() => {}} />)
    fireEvent.change(input(), { target: { files: [png('one.png')] } })
    fireEvent.change(input(), { target: { files: [png('two.png')] } })
    assert.deepStrictEqual(revoked, ['blob:preview-1'])
    assert.equal(screen.getAllByRole('listitem').length, 1)
    unmount()
    assert.deepStrictEqual(revoked, ['blob:preview-1', 'blob:preview-2'])
  })

  test('a drop adds files, highlights while dragging and rejects types outside accept', () => {
    const onFiles = vi.fn()
    render(<FileField label="Imports" accept=".txt,.csv" multiple onFiles={onFiles} />)
    const zone = screen.getByRole('button', { name: 'Drop files here or browse' })
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } })
    assert.ok(zone.classList.contains(styles.over))
    fireEvent.dragLeave(zone)
    assert.equal(zone.classList.contains(styles.over), false)

    const list = new File(['1'], 'numbers.CSV', { type: 'text/csv' })
    const pdf = new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' })
    fireEvent.drop(zone, { dataTransfer: { files: [list, pdf], types: ['Files'] } })
    assert.deepStrictEqual(onFiles.mock.calls[0]?.[0], [list])
    assert.ok(screen.getByText('numbers.CSV'))
    assert.equal(screen.getByRole('alert').textContent, 'This file type is not accepted here.')

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss scan.pdf' }))
    assert.equal(screen.queryByRole('alert'), null)
  })

  test('maxSize keeps a large file back with a row naming its size and the limit', () => {
    const onFiles = vi.fn()
    render(<FileField label="Banner" maxSize={1024 * 1024} onFiles={onFiles} />)
    fireEvent.change(input(), { target: { files: [png('huge.png', 3.4 * 1024 * 1024)] } })
    assert.equal(onFiles.mock.calls.length, 0)
    const row = screen.getByRole('listitem')
    assert.ok(row.classList.contains(styles.fileError))
    assert.ok(within(row).getByText('huge.png'))
    assert.equal(within(row).getByRole('alert').textContent, '3.4 MB is over the 1 MB limit.')
  })

  test('controlled rows show their image, status, progress and remove action', () => {
    const onRemove = vi.fn()
    render(
      <FileField
        label="Logo"
        onFiles={() => {}}
        files={[{ id: 'logo', name: 'Logo', meta: 'Ready to save', src: 'data:image/png;base64,AA', alt: 'Logo preview', progress: 40, onRemove, removeLabel: 'Remove' }]}
      />,
    )
    const row = screen.getByRole('listitem')
    assert.equal((within(row).getByAltText('Logo preview') as HTMLImageElement).getAttribute('src'), 'data:image/png;base64,AA')
    assert.ok(within(row).getByText('Ready to save'))
    assert.equal(within(row).getByRole('progressbar', { name: 'Upload progress' }).getAttribute('aria-valuenow'), '40')
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    assert.equal(onRemove.mock.calls.length, 1)
    assert.equal(created.length, 0, 'controlled rows never create object URLs')
  })

  test('a zoomable row opens the stored image through the shared preview', () => {
    render(
      <FileField
        label="Banner"
        fit="contain"
        onFiles={() => {}}
        files={[{ name: 'Banner', src: '/banner.webp', alt: 'Preview', zoomable: true }]}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Open preview: Preview' })
    assert.ok(trigger.closest(`.${styles.contain}`))
  })

  test('a stored image that will not load fills its tile with a placeholder naming it (SYS-18)', () => {
    render(
      <FileField
        label="Icons"
        onFiles={() => {}}
        files={[
          { id: 'icon', name: 'Category icon', src: 'https://bucket.example/icons/live.png', alt: 'Category icon preview' },
          { id: 'logo', name: 'Logo', src: 'https://bucket.example/logo.png', alt: 'Logo preview', zoomable: true },
        ]}
      />,
    )
    const [icon, logo] = screen.getAllByRole('listitem')
    fireEvent.error(within(icon).getByAltText('Category icon preview'))
    assert.equal(within(icon).queryByAltText('Category icon preview'), null, 'no broken image')
    const placeholder = within(icon).getByRole('img', { name: 'Category icon preview' })
    assert.ok(placeholder.classList.contains(styles.thumbPlaceholder))
    assert.ok(placeholder.closest(`.${styles.thumb}`))

    // A zoomable one has nothing to open once its image fails.
    fireEvent.error(within(logo).getByRole('button', { name: 'Open preview: Logo preview' }).querySelector('img') as HTMLImageElement)
    assert.equal(within(logo).queryByRole('button', { name: /Open preview/ }), null)
    assert.ok(within(logo).getByRole('img', { name: 'Logo preview' }).hasAttribute('data-image-placeholder'))
  })

  test('busy and disabled ignore new files; busy keeps the prompt and announces the work', () => {
    const onFiles = vi.fn()
    const { rerender } = render(
      <FileField label="Banner" prompt="Select banner" busy onFiles={onFiles} files={[{ name: 'Banner', onRemove: () => {} }]} />,
    )
    const zone = screen.getByRole('button', { name: 'Select banner' })
    assert.equal(zone.getAttribute('aria-busy'), 'true')
    assert.equal(zone.getAttribute('aria-disabled'), 'true')
    assert.equal(screen.getByRole('status').textContent, 'Uploading…')
    assert.equal((screen.getByRole('button', { name: 'Remove Banner' }) as HTMLButtonElement).disabled, true)
    const click = vi.spyOn(input(), 'click')
    fireEvent.click(zone)
    fireEvent.drop(zone, { dataTransfer: { files: [png()], types: ['Files'] } })
    assert.equal(click.mock.calls.length, 0)
    assert.equal(onFiles.mock.calls.length, 0)

    rerender(<FileField label="Banner" prompt="Select banner" disabled onFiles={onFiles} />)
    assert.equal((screen.getByRole('button', { name: 'Select banner' }) as HTMLButtonElement).disabled, true)
    assert.equal(input().disabled, true)
    assert.equal(screen.getByRole('status').textContent, '')
  })

  test('a field error is an alert that describes and invalidates the zone', () => {
    render(<FileField label="Image" help="Up to 2 MB" error="Please upload an image" onFiles={() => {}} />)
    const zone = screen.getByRole('button', { name: /browse/ })
    const error = screen.getByRole('alert')
    assert.equal(error.textContent, 'Please upload an image')
    assert.equal(zone.getAttribute('aria-invalid'), 'true')
    assert.ok(zone.getAttribute('aria-describedby')?.split(' ').includes(error.id))
  })
})

describe('FileField helpers', () => {
  test('formatFileSize steps through units with one decimal below ten', () => {
    assert.equal(formatFileSize(512), '512 B')
    assert.equal(formatFileSize(7.5 * 1024), '7.5 KB')
    assert.equal(formatFileSize(2 * 1024 * 1024), '2 MB')
    assert.equal(formatFileSize(12.4 * 1024 * 1024), '12 MB')
  })

  test('acceptsFile matches extensions, wildcards and exact types', () => {
    const csv = new File([''], 'list.CSV', { type: 'text/csv' })
    assert.equal(acceptsFile(csv, '.txt,.csv'), true)
    assert.equal(acceptsFile(csv, 'image/*'), false)
    assert.equal(acceptsFile(png(), 'image/*'), true)
    assert.equal(acceptsFile(png(), 'image/jpeg'), false)
    assert.equal(acceptsFile(csv, undefined), true)
  })
})
