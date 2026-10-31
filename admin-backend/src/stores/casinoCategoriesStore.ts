export type CategoryNode = { id: string; name: string; parentId?: string; order: number }

const byId = new Map<string, CategoryNode>()

function seed() {
  if (byId.size) return
  const rootSlots: CategoryNode = { id: 'cat-slots', name: 'Slots', order: 0 }
  const rootTable: CategoryNode = { id: 'cat-table', name: 'Table', order: 1 }
  const rootLive: CategoryNode = { id: 'cat-live', name: 'Live', order: 2 }
  const featuredSlots: CategoryNode = { id: 'cat-featured', name: 'Featured', parentId: 'cat-slots', order: 0 }
  ;[rootSlots, rootTable, rootLive, featuredSlots].forEach(n => byId.set(n.id, n))
}

seed()

export function listCategoriesFlat(): CategoryNode[] {
  return Array.from(byId.values()).sort((a, b) => (a.parentId === b.parentId ? a.order - b.order : (a.parentId||'').localeCompare(b.parentId||'')))
}

export function createCategory(name: string, parentId?: string): CategoryNode {
  const siblings = Array.from(byId.values()).filter(n => n.parentId === parentId)
  const order = siblings.length
  const id = `cat-${Math.random().toString(36).slice(2, 8)}`
  const node: CategoryNode = { id, name, parentId, order }
  byId.set(id, node)
  return node
}

export function renameCategory(id: string, name: string): CategoryNode {
  const node = byId.get(id)
  if (!node) throw new Error('Category not found')
  node.name = name
  byId.set(id, node)
  return node
}

export function reorderCategory(id: string, parentId?: string, order?: number): CategoryNode {
  const node = byId.get(id)
  if (!node) throw new Error('Category not found')
  node.parentId = parentId
  const siblings = Array.from(byId.values()).filter(n => n.parentId === parentId && n.id !== id)
  const newOrder = order == null ? siblings.length : Math.max(0, Math.min(order, siblings.length))
  // shift siblings after insertion point
  siblings.sort((a, b) => a.order - b.order).forEach((s, idx) => {
    s.order = idx >= newOrder ? idx + 1 : idx
    byId.set(s.id, s)
  })
  node.order = newOrder
  byId.set(id, node)
  return node
}

export function deleteCategory(id: string): boolean {
  // delete subtree recursively
  const children = Array.from(byId.values()).filter(n => n.parentId === id)
  children.forEach(ch => deleteCategory(ch.id))
  const ok = byId.delete(id)
  return ok
}

export type CategoryTree = CategoryNode & { children: CategoryTree[] }
export function categoriesTree(): CategoryTree[] {
  const nodes = listCategoriesFlat()
  const map = new Map<string, CategoryTree>()
  nodes.forEach(n => map.set(n.id, { ...n, children: [] }))
  const roots: CategoryTree[] = []
  map.forEach((n) => {
    if (n.parentId) {
      const p = map.get(n.parentId)
      if (p) p.children.push(n)
    } else {
      roots.push(n)
    }
  })
  const sortRec = (arr: CategoryTree[]) => {
    arr.sort((a, b) => a.order - b.order)
    arr.forEach(n => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}
