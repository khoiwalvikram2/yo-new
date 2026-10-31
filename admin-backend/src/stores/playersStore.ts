import {
  listUsers as listUsersMem,
  getUser as getUserMem,
  getWallet as getWalletMem,
  setKyc as setKycMem,
  setSanctions as setSanctionsMem,
  setBetAllowed as setBetAllowedMem,
  adjustWallet as adjustWalletMem,
} from "./usersStore.js";
import { getWalletDb, adjustWalletDb, getWalletsForUserIdsDb } from "../repos/players/walletsRepo.js";
import { listUsersDb, getUserDb } from "../repos/users/usersRepo.js";

export const players = {
  listUsers: async (
    filter: {
      query?: string;
      status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
      balanceMin?: number;
      balanceMax?: number;
      registeredFrom?: string;
      registeredTo?: string;
      agentId?: string;
      parentType?: string; // ALL, DIRECT, SHARING, CREDIT, COMMISSION
      playerType?: string; // 'WHITELABEL_CREDIT' | 'REGULAR' for ALL/DIRECT tab filter
    },
    tenant: string,
    options?: { excludeUserIds?: number[]; onlyUserIds?: number[]; offset?: number; limit?: number }
  ): Promise<any[]> => {
    const rows = await listUsersDb(
      {
        query: filter.query,
        status: filter.status,
        registeredFrom: filter.registeredFrom,
        registeredTo: filter.registeredTo,
        agentId: filter.agentId,
        parentType: filter.parentType,
        playerType: filter.playerType,
        balanceMin: filter.balanceMin,
        balanceMax: filter.balanceMax,
      },
      tenant,
      options
    )

    const mapped = rows.map((r: any) => {
      const flagNames: string[] = [];
      if (r.flags && Array.isArray(r.flags)) {
        flagNames.push(...r.flags.map((f: any) => (typeof f === 'string' ? f : f.flag)).filter(Boolean));
      }
      
      return {
      id: String(r.id),
      name: r.name,
      email: r.email,
      username: r.username,
      phone: r.phone,
      status: r.status?.toUpperCase() || 'ACTIVE',
      bonusAllowed: r.bonusAllowed,
      requirePasswordReset: r.requirePasswordReset,
      sportsVisible: r.sportsVisible,
      sportsBetAllowed: r.sportsBetAllowed,
      casinoVisible: r.casinoVisible,
      casinoBetAllowed: r.casinoBetAllowed,
      matkaVisible: r.matkaVisible,
      matkaBetAllowed: r.matkaBetAllowed,
      withdrawalLock: (r as any).withdrawalLock ?? false,
      riskType: r.riskType?.toUpperCase(),
      vipTierId: r.vipTierId || undefined,
        flags: flagNames,
      createdAt: r.createdAt as any,
      agentId: (r as any).agentId || null,
      playerType: (r as any).playerType || 'REGULAR',
      creditLimit: Number((r as any).creditLimit || 0),
      creditUsed: Number((r as any).creditUsed || 0),
      creditAvailable: Number((r as any).creditAvailable || 0),
      settlementBalance: Number((r as any).settlementBalance || 0),
      remark: (r as any).remark ?? null,
      };
    })

    return mapped
  },
  listUsersPage: async (
    filter: {
      query?: string;
      status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
      registeredFrom?: string;
      registeredTo?: string;
      agentId?: string;
      agentIds?: string[];
      parentType?: string;
      playerType?: string;
      balanceMin?: number;
      balanceMax?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
    tenant: string,
    options: { excludeUserIds?: number[]; onlyUserIds?: number[]; offset: number; limit: number }
  ): Promise<{ list: any[]; total: number }> => {
    const result = await listUsersDb(
      {
        query: filter.query,
        status: filter.status,
        registeredFrom: filter.registeredFrom,
        registeredTo: filter.registeredTo,
        agentId: filter.agentId,
        agentIds: filter.agentIds,
        parentType: filter.parentType,
        playerType: filter.playerType,
        balanceMin: filter.balanceMin,
        balanceMax: filter.balanceMax,
      },
      tenant,
      { ...options, returnWithTotal: true, sortBy: filter.sortBy, sortOrder: filter.sortOrder }
    )
    const rows = result.rows ?? []
    const total = result.total ?? 0
    const list = rows.map((r: any) => {
      const flagNames: string[] = []
      if (r.flags && Array.isArray(r.flags)) {
        flagNames.push(...r.flags.map((f: any) => (typeof f === 'string' ? f : f.flag)).filter(Boolean))
      }
      return {
        id: String(r.id),
        name: r.name,
        email: r.email,
        username: r.username,
        phone: r.phone,
        status: r.status?.toUpperCase() || 'ACTIVE',
        bonusAllowed: r.bonusAllowed,
        requirePasswordReset: r.requirePasswordReset,
        sportsVisible: r.sportsVisible,
        sportsBetAllowed: r.sportsBetAllowed,
        casinoVisible: r.casinoVisible,
        casinoBetAllowed: r.casinoBetAllowed,
        matkaVisible: r.matkaVisible,
        matkaBetAllowed: r.matkaBetAllowed,
        withdrawalLock: (r as any).withdrawalLock ?? false,
        riskType: r.riskType?.toUpperCase(),
        vipTierId: r.vipTierId || undefined,
        flags: flagNames,
        createdAt: r.createdAt,
        agentId: (r as any).agentId || null,
        playerType: (r as any).playerType || 'REGULAR',
        creditLimit: Number((r as any).creditLimit || 0),
        creditUsed: Number((r as any).creditUsed || 0),
        creditAvailable: Number((r as any).creditAvailable || 0),
        settlementBalance: Number((r as any).settlementBalance || 0),
        remark: (r as any).remark ?? null,
      }
    })
    return { list, total }
  },
  getUser: async (id: string, tenant = "default") => {
    const numId = Number(id)
    if (Number.isFinite(numId)) {
      const r = await getUserDb(numId, tenant)
      if (r) {
      // Extract flag names from flags array
      const flagNames: string[] = [];
      if (r.flags && Array.isArray(r.flags)) {
        flagNames.push(...r.flags.map((f: any) => (typeof f === 'string' ? f : f.flag)).filter(Boolean));
      }
      
        return {
          id: String(r.id),
          name: r.name,
          email: r.email,
          username: r.username,
          phone: r.phone,
          status: r.status?.toUpperCase() || 'ACTIVE', // Transform to GraphQL enum format
          bonusAllowed: r.bonusAllowed,
          requirePasswordReset: r.requirePasswordReset,
          sportsVisible: r.sportsVisible,
          sportsBetAllowed: r.sportsBetAllowed,
          casinoVisible: r.casinoVisible,
          casinoBetAllowed: r.casinoBetAllowed,
          matkaVisible: r.matkaVisible,
          matkaBetAllowed: r.matkaBetAllowed,
          withdrawalLock: (r as any)?.withdrawalLock ?? false,
          riskType: r.riskType?.toUpperCase(),
          vipTierId: r.vipTierId || undefined,
          // The VIP field resolvers need the player's tenant, not 'default'.
          tenant,
          vipTierMode: r.vipTierMode ?? null,
          flags: flagNames,
          createdAt: r.createdAt,
          // Agent and credit fields
          agentId: r.agentId ? String(r.agentId) : null,
          playerType: r.playerType || null,
          creditLimit: r.creditLimit ? Number(r.creditLimit) : null,
          creditUsed: r.creditUsed ? Number(r.creditUsed) : null,
          creditAvailable: r.creditAvailable ? Number(r.creditAvailable) : null,
          settlementBalance: (r as any).settlementBalance ? Number((r as any).settlementBalance) : null,
        }
      }
    }
    return getUserMem(id) ?? null
  },
  getWallet: async (userId: string, tenant = "default") => {
    const numericId = Number(userId);
    if (!Number.isNaN(numericId)) {
      const row = await getWalletDb(numericId, tenant);
      if (row) {
        // Ensure bonus is properly extracted - numeric fields from DB are strings
        const bonusValue = row.bonus ? (typeof row.bonus === 'string' ? Number(row.bonus) : Number(row.bonus)) : 0;
        return {
          userId: String(row.userId),
          currency: row.currency,
          balance: Number(row.cash),
          bonus: bonusValue,
          exposure: Number(row.exposure),
          referralBalance: row.referralBalance != null ? Number(row.referralBalance) : 0,
          referralBonusBalance: row.referralBonus != null ? Number(row.referralBonus) : 0,
          updatedAt: new Date().toISOString(),
        };
      }
    }
    return getWalletMem(userId) ?? null;
  },
  // legacy setters removed
  setSportsBetAllowed: (id: string, val: boolean) => (require('./usersStore.js') as any).setSportsBetAllowed(id, val),
  setCasinoBetAllowed: (id: string, val: boolean) => (require('./usersStore.js') as any).setCasinoBetAllowed(id, val),
  setMatkaBetAllowed: (id: string, val: boolean) => (require('./usersStore.js') as any).setMatkaBetAllowed(id, val),
  setBonusAllowed: (id: string, val: boolean) => (require('./usersStore.js') as any).setBonusAllowed(id, val),
  adjustWallet: async (userId: string, amount: number, tenant = "default") => {
    const numericId = Number(userId);
    if (!Number.isNaN(numericId)) {
      const row = await adjustWalletDb(numericId, amount, undefined, tenant);
      if (row) {
        return {
          userId: String(row.userId),
          currency: row.currency,
          balance: Number(row.cash),
          exposure: Number(row.exposure),
          updatedAt: new Date().toISOString(),
        };
      }
    }
    return adjustWalletMem(userId, amount);
  },
};
