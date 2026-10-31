export type Content = { id: string; name: string; locale: string; body: string; status: 'draft'|'published'; updatedAt: string }

const byId = new Map<string, Content>()

function now() { return new Date().toISOString() }

export function listContent(_whitelabelId?: string): Content[] { return Array.from(byId.values()) }

export function createContent(input: { name: string; locale?: string; body?: string }): Content {
  const id = `content-${Math.random().toString(36).slice(2,8)}`
  const c: Content = { id, name: input.name, locale: input.locale ?? 'en', body: input.body ?? '', status: 'draft', updatedAt: now() }
  byId.set(id, c)
  return c
}

export function updateContent(input: { id: string; name?: string; locale?: string; body?: string }): Content {
  const c = byId.get(input.id)
  if (!c) throw new Error('Content not found')
  c.name = input.name ?? c.name
  c.locale = input.locale ?? c.locale
  c.body = input.body ?? c.body
  c.updatedAt = now()
  byId.set(c.id, c)
  return c
}

export function publishContent(id: string): Content {
  const c = byId.get(id)
  if (!c) throw new Error('Content not found')
  c.status = 'published'
  c.updatedAt = now()
  byId.set(c.id, c)
  return c
}
