/**
 * SYS-18: a stored image never shows a broken image. With no source (nothing stored, or a legacy file the server
 * now answers null for), or when the source will not load, a neutral placeholder with the alt text takes its place.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StoredImage } from './StoredImage'

const AD = 'data:image/webp;base64,UklGRg=='

describe('StoredImage', () => {
  test('renders the image with its alt text and class while it loads', () => {
    render(<StoredImage src={AD} alt="Diwali offer" className="thumb" loading="lazy" />)
    const image = screen.getByAltText('Diwali offer') as HTMLImageElement
    assert.equal(image.tagName, 'IMG')
    assert.equal(image.getAttribute('src'), AD)
    assert.equal(image.className, 'thumb')
    assert.equal(image.getAttribute('loading'), 'lazy')
  })

  test('an image that fails to load becomes a placeholder naming it, in the same box', () => {
    let errors = 0
    render(<StoredImage src="https://bucket.example/ads/1.png" alt="Diwali offer" className="thumb" onError={() => { errors += 1 }} />)
    fireEvent.error(screen.getByAltText('Diwali offer'))
    assert.equal(screen.queryByAltText('Diwali offer'), null, 'no broken image is left')
    const placeholder = screen.getByRole('img', { name: 'Diwali offer' })
    assert.equal(placeholder.tagName, 'SPAN')
    assert.ok(placeholder.classList.contains('thumb'), 'the placeholder keeps the image class')
    assert.equal(placeholder.textContent, 'Diwali offer')
    assert.equal(placeholder.getAttribute('title'), 'Diwali offer')
    assert.equal(errors, 1, "the caller's onError still runs")
  })

  test('no source (null for a legacy file, or empty) shows the same placeholder', () => {
    const { rerender } = render(<StoredImage src={null} alt="Logo" />)
    assert.equal(screen.getByRole('img', { name: 'Logo' }).textContent, 'Logo')
    rerender(<StoredImage src="" alt="Logo" />)
    assert.ok(screen.getByRole('img', { name: 'Logo' }).hasAttribute('data-image-placeholder'))
  })

  test('a new source gets a fresh try after a failure', () => {
    const { rerender } = render(<StoredImage src="https://x.test/old.png" alt="Banner" />)
    fireEvent.error(screen.getByAltText('Banner'))
    assert.equal(screen.queryByAltText('Banner'), null)
    rerender(<StoredImage src={AD} alt="Banner" />)
    assert.equal(screen.getByAltText('Banner').getAttribute('src'), AD)
  })

  test("a tile's own empty state replaces the default placeholder, for a missing or a failed image", () => {
    const { rerender } = render(<StoredImage src={null} alt="" fallback={<b>Brand</b>} />)
    assert.ok(screen.getByText('Brand'))
    rerender(<StoredImage src={AD} alt="" fallback={<b>Brand</b>} />)
    fireEvent.error(document.querySelector('img') as HTMLImageElement)
    assert.ok(screen.getByText('Brand'))
    assert.equal(document.querySelector('img'), null)
  })

  test('a decorative image (empty alt) falls back to a placeholder hidden from assistive tech', () => {
    render(<StoredImage src={null} alt="" className="icon" />)
    const placeholder = document.querySelector('[data-image-placeholder]') as HTMLElement
    assert.equal(placeholder.getAttribute('aria-hidden'), 'true')
    assert.equal(placeholder.getAttribute('role'), null)
    assert.equal(placeholder.textContent, '')
  })
})
