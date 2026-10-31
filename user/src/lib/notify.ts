import { toast } from 'sonner'

type PromiseMessages = {
  loading?: string
  success?: string
  error?: string
}

export const notify = {
  message: (msg: string) => toast(msg),
  success: (msg: string) => toast.success(msg),
  error: (msg: string) => toast.error(msg),
  info: (msg: string) => toast.info(msg),
  warning: (msg: string) => toast.warning ? toast.warning(msg) : toast(msg),
  loading: (msg: string) => toast.loading(msg),
  dismiss: (id?: string | number) => toast.dismiss(id as any),
  promise<T>(promise: Promise<T>, messages: PromiseMessages) {
    return toast.promise(promise, {
      loading: messages.loading || 'Loading...'
      ,success: messages.success || 'Success'
      ,error: messages.error || 'Something went wrong'
    })
  },
}

export default notify


