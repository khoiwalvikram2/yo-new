import { GraphQLIncludeDirective, GraphQLSkipDirective, getDirectiveValues, type GraphQLResolveInfo, type SelectionSetNode } from 'graphql';

/** Real field names across merged selections, aliases and fragments. No info means
 * a non-GraphQL caller, which must retain the complete dashboard calculation. */
export function selectedDashboardFields(info?: GraphQLResolveInfo): Set<string> | undefined {
  if (!info) return undefined;
  const fields = new Set<string>();
  const seen = new Set<string>();
  const included = (node: Parameters<typeof getDirectiveValues>[1]) =>
    getDirectiveValues(GraphQLSkipDirective, node, info.variableValues)?.if !== true &&
    getDirectiveValues(GraphQLIncludeDirective, node, info.variableValues)?.if !== false;
  const visit = (selection?: SelectionSetNode) => {
    for (const node of selection?.selections ?? []) {
      if (!included(node)) continue;
      if (node.kind === 'Field') {
        if (node.name.value !== '__typename') fields.add(node.name.value);
      } else if (node.kind === 'InlineFragment') visit(node.selectionSet);
      else if (!seen.has(node.name.value)) {
        seen.add(node.name.value);
        visit(info.fragments[node.name.value]?.selectionSet);
      }
    }
  };
  for (const node of info.fieldNodes) visit(node.selectionSet);
  return fields;
}
