import type { AxiosError } from 'axios'

export type NormalizedError = {
  message: string
  code?: string | number
  status?: number
  details?: unknown
}

export function isAxiosError(error: unknown): error is AxiosError {
  return !!error && typeof error === 'object' && (error as any).isAxiosError === true
}

export function normalizeError(error: unknown): NormalizedError {
  if (isAxiosError(error)) {
    const status = error.response?.status
    const data: any = error.response?.data
    const code = (data?.meta?.code as number | undefined) ?? status
    const message =
      (data?.meta?.message as string | undefined) ||
      (data?.message as string | undefined) ||
      error.message ||
      'Something went wrong'
    return { message, code, status, details: data }
  }

  if (error instanceof Error) {
    return { message: error.message }
  }

  try {
    return { message: JSON.stringify(error) }
  } catch (_) {
    return { message: 'Unknown error' }
  }
}

export function extractApiMessage(error: unknown, fallback = 'Request failed'): string {
  return normalizeError(error).message || fallback
}


