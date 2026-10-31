import DataLoader from 'dataloader'
import { getUsersByIdsDb } from '@/repos/users/usersRepo.js'
import { getRoleNamesByUserIds } from '@/repos/rbac/rbacRepo.js'

export type Loaders = {
  userById: DataLoader<number, { id: number; name: string } | null>
  rolesByUserId: DataLoader<number, string[]>
}

export function createLoaders(tenant = 'default'): Loaders {
  const userById = new DataLoader<number, { id: number; name: string } | null>(async (ids) => {
    const rows = await getUsersByIdsDb(ids as number[], tenant)
    const byId = new Map(rows.map(r => [r.id, r]))
    return ids.map(id => byId.get(id) ?? null)
  })

  const rolesByUserId = new DataLoader<number, string[]>(async (ids) => {
    const rolesMap = await getRoleNamesByUserIds(ids as number[], tenant)
    return ids.map(id => rolesMap.get(id) ?? [])
  })

  return { userById, rolesByUserId }
}
