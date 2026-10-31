import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CodeBlock } from './CodeBlock'
import styles from './CodeBlock.module.css'

const writeText = vi.fn<(value: string) => Promise<void>>()

beforeEach(() => {
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CodeBlock', () => {
  test('renders untrusted-looking code as inert text in a labelled focusable pre', () => {
    const code = '<script>window.compromised = true</script>\n{"ok":true}'
    const { container } = render(<CodeBlock label="Webhook payload" code={code} />)
    const pre = container.querySelector('pre') as HTMLPreElement

    assert.equal(pre.textContent, code)
    assert.equal(pre.tabIndex, 0)
    assert.equal(pre.getAttribute('aria-labelledby'), screen.getByText('Webhook payload').id)
    assert.equal(container.querySelector('script'), null)
  })

  test('copies the source without trimming or reformatting it', async () => {
    const code = '  line one\nline two\n'
    render(<CodeBlock label="Raw event" code={code} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy Raw event' }))

    await waitFor(() => assert.equal(writeText.mock.calls.length, 1))
    assert.equal(writeText.mock.calls[0]?.[0], code)
  })

  test('supports opt-in wrapping and forwards root attributes', () => {
    const { container } = render(
      <CodeBlock
        label="Metadata"
        code="a very long value"
        wrap
        className="audit-code"
        data-testid="metadata"
      />,
    )
    assert.ok(screen.getByTestId('metadata').classList.contains('audit-code'))
    assert.ok((container.querySelector('pre') as HTMLElement).classList.contains(styles.wrap))
  })
})
