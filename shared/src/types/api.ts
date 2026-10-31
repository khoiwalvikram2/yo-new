export type ApiMeta = {
  code?: number
  message?: string
  token?: string
}

export type ApiResponse<T = unknown> = {
  meta?: ApiMeta
  data: T
}

