import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Permission {
  domain: string
  actions: string[]
}

export interface Role {
  id: string
  name: string
  tenant: string | null
  permissions: Permission[]
  updatedAt: string
}

interface RBACState {
  roles: Role[]
  permissions: Permission[]
  lastFetched: string | null
  setRoles: (roles: Role[]) => void
  setPermissions: (permissions: Permission[]) => void
  getRole: (id: string) => Role | undefined
  clearCache: () => void
}

export const useRBACStore = create<RBACState>()(
  persist(
    (set, get) => ({
      roles: [],
      permissions: [],
      lastFetched: null,
      setRoles: (roles: Role[]) => set({ roles, lastFetched: new Date().toISOString() }),
      setPermissions: (permissions: Permission[]) => set({ permissions }),
      getRole: (id: string) => get().roles.find(r => r.id === id),
      clearCache: () => set({ roles: [], permissions: [], lastFetched: null }),
    }),
    {
      name: 'rbac-store',
      version: 1,
    }
  )
)

