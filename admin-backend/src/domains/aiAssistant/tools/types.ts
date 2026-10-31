import type { ToolDefinition } from '../openaiClient.js'

/** The caller's own GraphQL context. Every tool runs with this and nothing more. */
export type AiContext = any

export interface ReadToolResult {
  /** Rows or aggregates. Treated as untrusted data downstream, never instructions. */
  data: unknown
  /** Optional note for the model, e.g. that results were truncated. */
  note?: string
}

/**
 * A write tool never mutates. It validates and returns the description of a
 * change for an operator to confirm; execution happens later, in
 * `executeProposal`, under the confirming operator's context.
 */
export interface WriteProposal {
  /** One sentence an operator can approve or reject without reading JSON. */
  summary: string
  /** Arguments exactly as they will be executed on confirmation. */
  args: Record<string, unknown>
}

export interface ReadTool {
  kind: 'read'
  name: string
  description: string
  parameters: Record<string, unknown>
  handler: (args: any, ctx: AiContext) => Promise<ReadToolResult>
}

export interface WriteTool {
  kind: 'write'
  name: string
  description: string
  parameters: Record<string, unknown>
  /** Builds the proposal. Must not perform the change. */
  propose: (args: any, ctx: AiContext) => Promise<WriteProposal>
  /** Performs the change. Only ever called from a confirmed proposal. */
  execute: (args: any, ctx: AiContext) => Promise<unknown>
  /** The mutation this tool runs, so its shape can be checked against the schema. */
  mutation: string
  /**
   * Permission the caller must hold to propose this change.
   *
   * Most of the underlying mutations perform no permission check of their own —
   * a platform-wide gap that predates the assistant. The assistant makes those
   * changes easy to reach by simply asking for them, so it applies its own gate
   * rather than inheriting the absence of one. Stated as domain and action so it
   * reads against the same taxonomy as everything else.
   */
  requiredPermission: { domain: string; action: string }
  /**
   * Reshapes the model's flat arguments into the mutation's own signature.
   * Most mutations here take a single `input` object; the model is given a flat
   * schema because nesting confuses tool-call generation, so the two shapes are
   * reconciled in one place rather than in each summary function.
   */
  buildArgs: (args: any) => Record<string, unknown>
}

export type AiTool = ReadTool | WriteTool

export function toOpenAiTool(tool: AiTool): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

/** Convenience for the common "object with these properties" schema. */
export function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = []
): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: false }
}
