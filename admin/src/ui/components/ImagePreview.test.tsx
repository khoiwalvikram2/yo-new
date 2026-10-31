import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImagePreview } from './ImagePreview'
import styles from './ImagePreview.module.css'

afterEach(() => {
  document.body.removeAttribute('inert')
})

describe('ImagePreview', () => {
  test('uses a labelled button for the decorative thumbnail', () => {
    render(<ImagePreview src="/proof.webp" alt="UPI payment proof" />)
    const trigger = screen.getByRole('button', { name: 'Open preview: UPI payment proof' })
    const thumbnail = trigger.querySelector('img') as HTMLImageElement

    assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog')
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
    assert.equal(thumbnail.alt, '')
    assert.equal(thumbnail.getAttribute('aria-hidden'), 'true')
    assert.ok(thumbnail.classList.contains(styles.cover))
  })

  test('opens the shared dialog and preserves required alt on the full image', async () => {
    render(
      <ImagePreview
        src="/proof.webp"
        alt="UPI payment proof"
        dialogTitle="Deposit proof"
        fit="contain"
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Open preview: UPI payment proof' })
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'Deposit proof' })
    const fullImage = screen.getByRole('img', { name: 'UPI payment proof' }) as HTMLImageElement
    assert.ok(dialog.contains(fullImage))
    assert.equal(fullImage.src.endsWith('/proof.webp'), true)
    assert.equal(trigger.getAttribute('aria-expanded'), 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => assert.ok(!screen.queryByRole('dialog')))
    await waitFor(() => assert.ok(document.activeElement === trigger))
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  })

  test('forwards root attributes and a caller class', () => {
    render(
      <ImagePreview
        src="/receipt.png"
        alt="Receipt"
        className="payment-receipt"
        data-testid="receipt-preview"
      />,
    )
    const root = screen.getByTestId('receipt-preview')
    assert.ok(root.classList.contains(styles.preview))
    assert.ok(root.classList.contains('payment-receipt'))
  })
})
