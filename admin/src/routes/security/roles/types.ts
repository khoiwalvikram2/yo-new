import type { Permission } from '@/state/rbacStore'

export interface GraphQLRole {
  id: string
  name: string
  tenant?: string | null
  permissions: Permission[]
  updatedAt: string
}

