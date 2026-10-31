function encodeCursorPayload(payload: Record<string, string>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursorPayload<T extends Record<string, string>>(cursor: string): T {
  const o = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  return o;
}

export function encodeSnapshotRunCursor(row: { startedAt: Date | string; id: string }): string {
  const s =
    row.startedAt instanceof Date
      ? row.startedAt.toISOString()
      : new Date(row.startedAt).toISOString();
  return encodeCursorPayload({ s, i: row.id });
}

export function decodeSnapshotRunCursor(cursor: string): { s: string; i: string } {
  const o = decodeCursorPayload<{ s: string; i: string }>(cursor);
  if (!o?.s || !o?.i) throw new Error('Invalid snapshot run cursor');
  return o;
}

export function encodeSnapshotEventCursor(row: { occurredAt: Date | string; id: string }): string {
  const s =
    row.occurredAt instanceof Date
      ? row.occurredAt.toISOString()
      : new Date(row.occurredAt).toISOString();
  return encodeCursorPayload({ s, i: row.id });
}

export function decodeSnapshotEventCursor(cursor: string): { s: string; i: string } {
  const o = decodeCursorPayload<{ s: string; i: string }>(cursor);
  if (!o?.s || !o?.i) throw new Error('Invalid snapshot event cursor');
  return o;
}
