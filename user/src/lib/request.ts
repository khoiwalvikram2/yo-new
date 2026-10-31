import { notify } from '@/lib/notify'
import { extractApiMessage } from '@/lib/errors'

type RequestWithToastOptions = {
  loading?: string
  success?: string
  error?: string
  silent?: boolean
}

export async function requestWithToast<T>(fn: () => Promise<T>, opts?: RequestWithToastOptions): Promise<T> {
  if (opts?.silent) {
    return fn()
  }

  const promise = fn()
  notify.promise(
    promise,
    {
      loading: opts?.loading || 'Please wait...'
      ,success: opts?.success || 'Done'
      ,error: opts?.error || 'Request failed'
    }
  )
  return promise
}

export async function requestSilently<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    notify.error(extractApiMessage(err))
    throw err
  }
}


