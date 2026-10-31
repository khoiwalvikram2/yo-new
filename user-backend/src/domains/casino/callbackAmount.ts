import { z } from 'zod'

/** Accept the complete decimal value, never a prefix such as "100junk". */
export const casinoCallbackAmount = z.union([
  z.number(),
  z.string().trim().regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/).transform(Number),
]).pipe(z.number().finite())
