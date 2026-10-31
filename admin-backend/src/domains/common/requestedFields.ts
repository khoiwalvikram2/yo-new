import type { GraphQLResolveInfo, SelectionSetNode } from 'graphql'

/** Selected direct child, including aliases, merged fields and fragments. */
export function isRequestedField(info: Pick<GraphQLResolveInfo, 'fieldNodes' | 'fragments'>, name: string): boolean {
  const visited = new Set<string>()
  const visit = (selectionSet?: SelectionSetNode): boolean => {
    for (const node of selectionSet?.selections ?? []) {
      if (node.kind === 'Field' && node.name.value === name) return true
      if (node.kind === 'InlineFragment' && visit(node.selectionSet)) return true
      if (node.kind === 'FragmentSpread' && !visited.has(node.name.value)) {
        visited.add(node.name.value)
        if (visit(info.fragments[node.name.value]?.selectionSet)) return true
      }
    }
    return false
  }
  return info.fieldNodes.some(node => visit(node.selectionSet))
}
