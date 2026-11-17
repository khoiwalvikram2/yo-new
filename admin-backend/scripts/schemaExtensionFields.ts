/**
 * The root Query and Mutation fields declared outside src/types/operations: every `extend type Query { ... }` and
 * `extend type Mutation { ... }` block of a domain schema file.
 *
 * probe:admin-authz enumerated root fields from src/types/operations/{queries,mutations}.graphql alone. Sixteen domain
 * files add more by extension (on 2026-11-03: 49 Query and 45 Mutation fields, the namespace roots aside): the
 * notification reads, the settlement and payout operations, worli, currencies, the betting-pattern tools. Neither of
 * the probe's passes ever called them, so its anonymous pass could not see myNotifications, notificationStats or
 * myNotification although it reported on "every Query field".
 *
 * Each block is read with the line regex the probe uses for the operations files, so a field is seen here exactly as
 * it would be there (memory gw-probe-regex-docstring-trap); a block written on one line is read the same way. The
 * namespace roots (Query.agents and Mutation.agents) are left to agentNamespaceFields.ts, which probes their fields.
 *
 * Pure: reads the schema files, no database.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

export type ExtensionField = {
  name: string
  kind: 'Query' | 'Mutation'
  args: Array<{ name: string; type: string }>
  /** The declaring file, relative to src/types, with forward slashes. */
  file: string
}

/** The fields the agents namespace hangs on the roots; their own fields are enumerated by agentNamespaceFields.ts. */
const NAMESPACE_ROOTS = new Set(['agents'])

// The probe's own field regex (probeAdminAuthz.ts parseFields): a two-space-indented name, optional (args), ": Type".
const FIELD = /^ {2}([a-zA-Z][A-Za-z0-9_]*)\s*(\(([\s\S]*?)\))?\s*:\s*[A-Za-z[]/gm
const ARG = /([a-zA-Z][A-Za-z0-9_]*)\s*:\s*([A-Za-z[\]!]+)/g

function graphqlFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) graphqlFiles(p, out)
    else if (e.name.endsWith('.graphql')) out.push(p)
  }
  return out.sort()
}

/** The body of each `extend type <kind> { ... }` block in one SDL source, in order. */
export function extensionBlocks(src: string, kind: 'Query' | 'Mutation'): string[] {
  const blocks: string[] = []
  const opener = new RegExp(`^extend type ${kind}\\s*\\{`, 'gm')
  let m: RegExpExecArray | null
  while ((m = opener.exec(src))) {
    const open = m.index + m[0].length - 1
    const newline = src.indexOf('\n', open)
    const sameLineClose = src.indexOf('}', open)
    if (sameLineClose >= 0 && (newline < 0 || sameLineClose < newline)) {
      // `extend type Query { myNotification(id: ID!, category: String): Notification }`: one field on the line.
      blocks.push(`\n  ${src.slice(open + 1, sameLineClose).trim()}\n`)
      continue
    }
    const close = src.indexOf('\n}', open)
    blocks.push(src.slice(open + 1, close < 0 ? src.length : close + 1))
  }
  return blocks
}

/** The fields of one block, with their argument types, as the probe's regex reads them. */
export function blockFields(block: string): Array<{ name: string; args: Array<{ name: string; type: string }> }> {
  const out: Array<{ name: string; args: Array<{ name: string; type: string }> }> = []
  FIELD.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FIELD.exec(block))) {
    const args: Array<{ name: string; type: string }> = []
    if (m[3]) for (const a of m[3].matchAll(ARG)) args.push({ name: a[1], type: a[2] })
    out.push({ name: m[1], args })
  }
  return out
}

/** Every root field of `kind` declared by extension under src/types/domains, namespace roots aside. */
export function extensionFields(kind: 'Query' | 'Mutation', srcDir: string = join(process.cwd(), 'src')): ExtensionField[] {
  const typesDir = join(srcDir, 'types')
  const out: ExtensionField[] = []
  for (const path of graphqlFiles(join(typesDir, 'domains'))) {
    const src = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
    const file = relative(typesDir, path).split('\\').join('/')
    for (const block of extensionBlocks(src, kind)) {
      for (const f of blockFields(block)) {
        if (NAMESPACE_ROOTS.has(f.name)) continue
        out.push({ ...f, kind, file })
      }
    }
  }
  return out
}
