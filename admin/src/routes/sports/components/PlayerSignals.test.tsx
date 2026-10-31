import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PatternBadge } from './PatternBadge';
import { PlayerFlagIndicator } from './PlayerFlagIndicator';
afterEach(cleanup);
test('pattern action preserves type, severity, exact click callback and accessible name', () => {
  const clicked = vi.fn();
  render(<PatternBadge patternType="RAPID_BETTING" severity="CRITICAL" metrics={{ count: 1200 }} onClick={clicked} />);
  fireEvent.click(screen.getByRole('button', { name: 'RAPID BETTING (CRITICAL)' }));
  assert.equal(clicked.mock.calls.length, 1);
  assert.ok(screen.getByText('CRITICAL'));
});
test('non-action pattern remains keyboard-focusable and shows the original metric formatting', async () => {
  render(<PatternBadge patternType="COORDINATED" severity="HIGH" metrics={{ count: 1200, note: 'Shared timing' }} />);
  const marker = screen.getByLabelText('COORDINATED (HIGH)');
  assert.equal(marker.tabIndex, 0);
  fireEvent.focus(marker);
  assert.ok(await screen.findByRole('tooltip'));
  assert.ok(screen.getByText('count: 1,200'));
  assert.ok(screen.getByText('note: Shared timing'));
});
test('player flags stay absent when empty and expose every active flag on keyboard focus', async () => {
  const view = render(<PlayerFlagIndicator flags={[]} userId="player1" />);
  assert.equal(view.container.childElementCount, 0);
  view.rerender(<PlayerFlagIndicator flags={['Multiple accounts', 'Unusual stake']} userId="player1" />);
  const marker = screen.getByLabelText('Active Flags: Multiple accounts, Unusual stake');
  assert.equal(marker.tabIndex, 0);
  fireEvent.focus(marker);
  assert.ok(await screen.findByRole('tooltip'));
  assert.ok(screen.getByText('• Multiple accounts'));
  assert.ok(screen.getByText('• Unusual stake'));
});
