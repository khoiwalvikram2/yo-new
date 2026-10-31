import assert from 'node:assert/strict'
import { createRef, useState, type ComponentProps } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, test, vi } from 'vitest'
import { Textarea } from './Textarea'

const OriginalResizeObserver = globalThis.ResizeObserver

class ResizeObserverHarness implements ResizeObserver {
  static latest: ResizeObserverHarness | undefined
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverHarness.latest = this
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): ResizeObserverEntry[] { return [] }

  notify(width: number) {
    this.callback([{ contentRect: { width } } as ResizeObserverEntry], this)
  }
}

afterEach(() => {
  globalThis.ResizeObserver = OriginalResizeObserver
  ResizeObserverHarness.latest = undefined
})

function ControlledTextarea(props: Partial<ComponentProps<typeof Textarea>>) {
  const [value, setValue] = useState(props.value ?? '')
  return <Textarea label="Approval remark" {...props} value={value} onChange={setValue} />
}

describe('Textarea', () => {
  test('is controlled, forwards its native ref and retains textarea attributes', () => {
    const ref = createRef<HTMLTextAreaElement>()
    const changed = vi.fn()
    render(
      <Textarea
        ref={ref}
        label="Approval remark"
        value="Initial"
        onChange={changed}
        rows={6}
        maxLength={120}
        required
        name="remark"
      />,
    )

    const textarea = screen.getByRole('textbox', { name: 'Approval remark' }) as HTMLTextAreaElement
    assert.equal(ref.current, textarea)
    assert.equal(textarea.rows, 6)
    assert.equal(textarea.maxLength, 120)
    assert.equal(textarea.required, true)
    assert.equal(textarea.name, 'remark')

    fireEvent.change(textarea, { target: { value: 'Reviewed' } })
    assert.deepEqual(changed.mock.calls, [['Reviewed']])
  })

  test('wires help, error and count to the native control', () => {
    render(
      <ControlledTextarea
        value="Needs review"
        help="State why this queue item can proceed"
        error="Add a supporting reference"
        maxLength={40}
        showCount
      />,
    )

    const textarea = screen.getByRole('textbox', { name: 'Approval remark' })
    const ids = textarea.getAttribute('aria-describedby')?.split(' ') ?? []
    assert.equal(textarea.getAttribute('aria-invalid'), 'true')
    assert.equal(ids.length, 3)
    assert.equal(document.getElementById(ids[0])?.textContent, 'State why this queue item can proceed')
    assert.equal(document.getElementById(ids[1])?.textContent, 'Add a supporting reference')
    assert.equal(document.getElementById(ids[2])?.textContent, '12 / 40')
  })

  test('announces its counter only near maxLength', () => {
    const { rerender } = render(
      <Textarea label="Note" value="1234" onChange={() => undefined} maxLength={20} showCount />,
    )
    assert.equal(screen.getByRole('status').textContent, '')

    rerender(
      <Textarea label="Note" value="123456789012345" onChange={() => undefined} maxLength={20} showCount />,
    )
    assert.equal(screen.getByRole('status').textContent, '15 / 20')
  })

  test('flags its counter when a page-set value is longer than maxLength', () => {
    const { rerender } = render(
      <Textarea label="Note" value="12345" onChange={() => undefined} maxLength={5} showCount />,
    )
    const count = () => document.getElementById(
      screen.getByRole('textbox', { name: 'Note' }).getAttribute('aria-describedby') ?? '',
    ) as HTMLElement
    // at the limit is not over it
    assert.equal(count().textContent, '5 / 5')
    assert.equal(count().className.includes('over'), false)

    // maxLength only stops typing; a controlled value can still arrive longer
    rerender(<Textarea label="Note" value="1234567" onChange={() => undefined} maxLength={5} showCount />)
    assert.equal(count().textContent, '7 / 5')
    assert.ok(count().className.includes('over'))
    assert.equal(screen.getByRole('status').textContent, '7 / 5')
  })

  test('counts characters without a limit without making a live region', () => {
    render(<Textarea label="Note" value="A" onChange={() => undefined} showCount />)
    assert.equal(screen.getByRole('status').textContent, '')
  })

  test('autoGrow follows the controlled value scroll height', () => {
    const { rerender } = render(
      <Textarea label="Note" value="One line" onChange={() => undefined} autoGrow />,
    )
    const textarea = screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 144 })

    rerender(<Textarea label="Note" value={'One line\nTwo lines'} onChange={() => undefined} autoGrow />)
    const computed = window.getComputedStyle(textarea)
    const borders =
      (Number.parseFloat(computed.borderTopWidth) || 0) +
      (Number.parseFloat(computed.borderBottomWidth) || 0)
    assert.equal(textarea.style.height, `${144 + borders}px`)

    rerender(<Textarea label="Note" value={'One line\nTwo lines'} onChange={() => undefined} />)
    assert.equal(textarea.style.height, '')
  })

  test('autoGrow remeasures when its rendered width changes', () => {
    globalThis.ResizeObserver = ResizeObserverHarness
    render(<Textarea label="Note" value="A wrapping line" onChange={() => undefined} autoGrow />)
    const textarea = screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 180 })

    act(() => ResizeObserverHarness.latest?.notify(240))

    const computed = window.getComputedStyle(textarea)
    const borders =
      (Number.parseFloat(computed.borderTopWidth) || 0) +
      (Number.parseFloat(computed.borderBottomWidth) || 0)
    assert.equal(textarea.style.height, `${180 + borders}px`)
  })

  test('preserves an explicit aria-invalid value', () => {
    render(
      <Textarea
        label="Optional note"
        value=""
        onChange={() => undefined}
        status="error"
        aria-invalid="grammar"
      />,
    )
    assert.equal(screen.getByRole('textbox', { name: 'Optional note' }).getAttribute('aria-invalid'), 'grammar')
  })
})
