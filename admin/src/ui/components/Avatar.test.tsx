/**
 * Avatar sits inside the ProfileMenu trigger (T48), and the trigger carries the accessible name.
 * Avatar must therefore always be hidden from assistive tech, or a screen reader hears the initials
 * after the name. It must show the same decision-14 initials as the rail, and a user glyph rather
 * than an empty circle when there is no name. It forwards its ref so it can anchor a floating layer.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { createRef } from 'react'
import { render } from '@testing-library/react'
import { Avatar } from './Avatar'
import styles from './Avatar.module.css'

describe('Avatar', () => {
  test('shows the initials of the name and is hidden from assistive tech', () => {
    const { container } = render(<Avatar name="Rahul S." />)
    const avatar = container.firstElementChild
    assert.ok(avatar)
    assert.equal(avatar.tagName, 'SPAN')
    assert.equal(avatar.textContent, 'RS')
    assert.equal(avatar.getAttribute('aria-hidden'), 'true')
    assert.equal(avatar.getAttribute('role'), null)
    assert.equal(avatar.getAttribute('aria-label'), null)
    assert.equal(avatar.querySelector('svg'), null)
    assert.ok(avatar.classList.contains(styles.size34))
    assert.ok(avatar.classList.contains(styles.hue1))
  })

  test('supports both approved sizes and scales the blank-name glyph with them', () => {
    const { container, rerender } = render(<Avatar name="Asha" size={22} />)
    assert.ok(container.firstElementChild?.classList.contains(styles.size22))
    assert.equal(container.firstElementChild?.classList.contains(styles.size34), false)

    rerender(<Avatar name="" size={22} />)
    assert.equal(container.querySelector('svg')?.getAttribute('width'), '14')

    rerender(<Avatar name="" size={34} />)
    assert.ok(container.firstElementChild?.classList.contains(styles.size34))
    assert.equal(container.querySelector('svg')?.getAttribute('width'), '17')
  })

  test('offers all five decorative hues', () => {
    const { container, rerender } = render(<Avatar name="Asha" hue={1} />)
    for (const hue of [1, 2, 3, 4, 5] as const) {
      rerender(<Avatar name="Asha" hue={hue} />)
      assert.ok(container.firstElementChild?.classList.contains(styles[`hue${hue}`]))
    }
  })

  test('auto hue is deterministic from the name and remains decorative', () => {
    const first = render(<Avatar name="Alpha" hue="auto" />)
    const repeated = render(<Avatar name="Alpha" hue="auto" />)
    const other = render(<Avatar name="Charlie" hue="auto" />)

    assert.ok(first.container.firstElementChild?.classList.contains(styles.hue2))
    assert.equal(first.container.firstElementChild?.className, repeated.container.firstElementChild?.className)
    assert.ok(other.container.firstElementChild?.classList.contains(styles.hue3))
    assert.equal(first.container.firstElementChild?.getAttribute('aria-hidden'), 'true')
  })

  test('uses the same decision-14 rule as the rail for names ending in digits', () => {
    const { container } = render(<Avatar name="agent77" />)
    assert.equal(container.firstElementChild?.textContent, 'A7')
  })

  test('shows the user glyph instead of initials for a missing or blank name', () => {
    const names: Array<string | null | undefined> = [undefined, null, '', '   ', '--']
    for (const name of names) {
      const { container, unmount } = render(<Avatar name={name} />)
      const avatar = container.firstElementChild
      assert.ok(avatar, `no avatar for ${String(name)}`)
      assert.equal(avatar.textContent, '', `text for ${String(name)}`)
      const glyph = avatar.querySelector('svg.tabler-icon-user')
      assert.ok(glyph, `no user glyph for ${String(name)}`)
      assert.equal(glyph.getAttribute('aria-hidden'), 'true')
      assert.equal(avatar.getAttribute('aria-hidden'), 'true')
      unmount()
    }
  })

  test('forwards its ref to the span', () => {
    const ref = createRef<HTMLSpanElement>()
    const { container } = render(<Avatar ref={ref} name="Winzo" />)
    assert.ok(ref.current)
    assert.equal(ref.current, container.firstElementChild)
    assert.equal(ref.current.textContent, 'WI')
  })

  test('passes className and other span attributes through', () => {
    const { container } = render(<Avatar name="Royal Casino" className="extra" id="profile-avatar" title="Royal Casino" />)
    const avatar = container.firstElementChild
    assert.ok(avatar)
    assert.ok(avatar.classList.contains('extra'))
    assert.equal(avatar.id, 'profile-avatar')
    assert.equal(avatar.getAttribute('title'), 'Royal Casino')
    assert.equal(avatar.textContent, 'RC')
  })
})
