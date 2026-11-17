/**
 * The operations that hang under the agents namespace: Query.agents → AgentsQuery and Mutation.agents →
 * AgentsMutation (src/types/domains/agents/agents.graphql).
 *
 * probe:admin-authz, audit:admin and audit:unprobed enumerate operations from src/types/operations/*.graphql,
 * which declares only root fields. The agents domain declares about seventy operations, the chips API among them
 * (spec docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md §7), under one namespace field per root, so
 * none of them was visible to any of the three. This reads the two namespace types with the same line regex the
 * probe uses for root fields, so a wrapped docstring hides a field here exactly as it would there (memory
 * gw-probe-regex-docstring-trap); src/domains/agents/resolvers/__tests__/chipApiWiring.test.ts checks that every
 * field the schema declares is seen.
 *
 * Pure: reads one file, no database.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type NamespaceField = { name: string; args: Array<{ name: string; type: string }> }

export interface AgentNamespace {
  /** The root type the namespace field is on. */
  root: 'Query' | 'Mutation'
  /** The namespace field on that root. */
  field: 'agents'
  /** The type the namespace field returns, whose fields are the operations. */
  type: 'AgentsQuery' | 'AgentsMutation'
  /** What gates every field of the type, for the reports. */
  gate: string
}

export const AGENT_NAMESPACES: readonly AgentNamespace[] = [
  {
    root: 'Query',
    field: 'agents',
    type: 'AgentsQuery',
    gate: 'Query.agents refuses a caller holding neither agents.list:view nor credit.management:view; every field but chipPool and chipDownline (CHIPS_PAGE_READS in resolvers/index.ts) then demands agents.list:view itself',
  },
  {
    root: 'Mutation',
    field: 'agents',
    type: 'AgentsMutation',
    gate: 'guardAgentMutations wraps every field with its AGENT_MUTATION_PERMISSIONS entry and refuses an unmapped one',
  },
]

/**
 * Fields of the agents namespace map that are deliberately open: the guard lets them through with no session.
 * Mirrors OPEN in src/domains/agents/resolvers/guardAgentMutations.ts.
 */
export const OPEN_AGENT_MUTATIONS: Record<string, string> = {
  agentLogin: 'agent sign-in: there is no session yet',
}

const FIELD = /^ {2}([a-zA-Z][A-Za-z0-9_]*)\s*(\(([\s\S]*?)\))?\s*:\s*[A-Za-z[]/gm

/** The fields of one namespace type, with their argument types, in declaration order. */
export function namespaceFields(type: AgentNamespace['type'], srcDir: string = join(process.cwd(), 'src')): NamespaceField[] {
  const src = readFileSync(join(srcDir, 'types', 'domains', 'agents', 'agents.graphql'), 'utf8')
  const start = src.search(new RegExp(`^type ${type}\\s*\\{`, 'm'))
  if (start < 0) return []
  const open = src.indexOf('{', start)
  const close = src.indexOf('\n}', open)
  const block = src.slice(open + 1, close < 0 ? src.length : close + 1)
  const out: NamespaceField[] = []
  FIELD.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FIELD.exec(block))) {
    const args: Array<{ name: string; type: string }> = []
    if (m[3]) {
      for (const a of m[3].matchAll(/([a-zA-Z][A-Za-z0-9_]*)\s*:\s*([A-Za-z[\]!]+)/g)) {
        args.push({ name: a[1], type: a[2] })
      }
    }
    out.push({ name: m[1], args })
  }
  return out
}
