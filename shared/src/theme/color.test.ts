// shared/src/theme/color.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contrast, darken, ensureContrast, ensureContrastOn, isHex, lighten, luminance, mix, normalizeHex } from './color'

test('normalizeHex accepts #abc and #aabbcc, returns upper-case 6 digits, rejects the rest', () => {
  assert.equal(normalizeHex('#abc'), '#AABBCC')
  assert.equal(normalizeHex(' #c51a1b '), '#C51A1B')
  for (const bad of ['', 'C51A1B', '#C51A1', 'rgb(1,2,3)', '#GGGGGG', null, 12]) assert.equal(normalizeHex(bad), null, String(bad))
  assert.equal(isHex('#fff'), true)
  assert.equal(isHex('red'), false)
})

test('mix, lighten and darken work in sRGB like CSS color-mix', () => {
  assert.equal(mix('#000000', '#FFFFFF', 0.5), '#808080')
  assert.equal(mix('#123456', '#ABCDEF', 0), '#123456')
  assert.equal(mix('#123456', '#ABCDEF', 1), '#ABCDEF')
  assert.equal(lighten('#2B2F35', 0.1), '#404449')
  assert.equal(darken('#C51A1B', 0.15), '#A71617')
})

test('luminance and contrast follow WCAG 2', () => {
  assert.equal(luminance('#FFFFFF').toFixed(6), '1.000000')
  assert.equal(luminance('#000000'), 0)
  assert.equal(contrast('#FFFFFF', '#000000').toFixed(2), '21.00')
  const red = contrast('#FFFFFF', '#C51A1B')
  assert.ok(red > 5.9 && red < 6, String(red))
  assert.equal(contrast('#777777', '#FFFFFF'), contrast('#FFFFFF', '#777777'))
})

test('ensureContrast pushes a colour away from the background until it reaches the ratio', () => {
  const onWhite = ensureContrast('#AAAAAA', '#FFFFFF')
  assert.ok(contrast(onWhite, '#FFFFFF') >= 4.5)
  assert.ok(luminance(onWhite) < luminance('#AAAAAA'), 'darker on a light background')
  const onDark = ensureContrast('#444444', '#1E2125')
  assert.ok(contrast(onDark, '#1E2125') >= 4.5)
  assert.ok(luminance(onDark) > luminance('#444444'), 'lighter on a dark background')
  assert.equal(ensureContrast('#333333', '#FFFFFF'), '#333333', 'already readable: unchanged')
  assert.equal(ensureContrast('#333', '#FFFFFF'), '#333333', 'normalised')
})

test('ensureContrast with an explicit target goes that way even near the luminance flip', () => {
  const bg = '#767676'
  assert.ok(Math.abs(luminance(bg) - 0.18) < 0.01)
  const out = ensureContrast('#888888', bg, 4.5, '#FFFFFF')
  assert.ok(contrast(out, bg) >= 4.5, String(contrast(out, bg)))
  assert.ok(luminance(out) > luminance(bg), 'light colour')
})

test('ensureContrastOn reaches the ratio on every background', () => {
  const backgrounds = ['#FFFFFF', '#ECECED']
  const out = ensureContrastOn('#AAAAAA', backgrounds)
  for (const bg of backgrounds) assert.ok(contrast(out, bg) >= 4.5, bg)
  const dark = ['#1E2125', '#3E4145']
  const light = ensureContrastOn('#555555', dark)
  for (const bg of dark) assert.ok(contrast(light, bg) >= 4.5, bg)
  assert.equal(ensureContrastOn('#000000', ['#FFFFFF', '#ECECED']), '#000000')
})
