import type { GraphQLResolveInfo, SelectionSetNode } from 'graphql';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@src/db/client.js';
import { referralAttributions, users } from '@shared/db/schema.js';
import { AgentsRepo } from '@src/repos/agents/AgentsRepo.js';
import { AgentConfigsRepo } from '@src/repos/agents/AgentConfigsRepo.js';

interface EnrichmentFields { users: boolean; agents: boolean }
interface SportsAgentInfo { agentId: string; agentName: string; schemeType: string; rate: number }
interface SportsBetUserInfo {
  name: string;
  flags: typeof users.$inferSelect.flags;
  agentInfo: SportsAgentInfo | null;
}

/** Missing info means a direct resolver caller: retain its complete response. */
export function sportsBetEnrichmentFields(info?: Pick<GraphQLResolveInfo, 'fieldNodes' | 'fragments'>): EnrichmentFields {
  if (!info) return { users: true, agents: true };
  const fields = { users: false, agents: false };
  const visited = new Set<string>();
  const visit = (selection?: SelectionSetNode) => {
    for (const node of selection?.selections ?? []) {
      if (node.kind === 'Field') {
        if (node.name.value === 'userName' || node.name.value === 'userFlags') fields.users = true;
        if (node.name.value === 'agentInfo') { fields.users = true; fields.agents = true; }
      } else if (node.kind === 'InlineFragment') visit(node.selectionSet);
      else if (!visited.has(node.name.value)) {
        visited.add(node.name.value);
        visit(info.fragments[node.name.value]?.selectionSet);
      }
    }
  };
  for (const node of info.fieldNodes) visit(node.selectionSet);
  return fields;
}

/** Request-local reads only. Bet visibility is resolved by sportsBets before these IDs are supplied. */
export async function readSportsBetEnrichment(
  userIds: number[], tenant: string | undefined, fields: EnrichmentFields, at: Date,
): Promise<Map<string, SportsBetUserInfo>> {
  const ids = [...new Set(userIds.filter(Number.isInteger))];
  const result = new Map<string, SportsBetUserInfo>();
  if (!ids.length || !fields.users) return result;

  const referrers = new Map<number, number>();
  // Preserve the old tenant-scoped lookup, including pending/rejected attributions.
  // With no tenant, the former equality lookup matched none; it did not grant a global referral lookup.
  if (fields.agents && tenant !== undefined) {
    try {
      const rows = await db.select({ refereeId: referralAttributions.refereeId, referrerId: referralAttributions.referrerId })
        .from(referralAttributions).where(and(inArray(referralAttributions.refereeId, ids), eq(referralAttributions.tenant, tenant)));
      for (const row of rows) referrers.set(row.refereeId, row.referrerId);
    } catch { /* An unavailable attribution leaves the direct-agent path intact. */ }
  }
  const wantedUsers = [...new Set([...ids, ...referrers.values()])];
  const userMap = new Map<number, Pick<typeof users.$inferSelect, 'id' | 'name' | 'username' | 'flags' | 'agentId'>>();
  try {
    const rows = await db.select({ id: users.id, name: users.name, username: users.username, flags: users.flags, agentId: users.agentId })
      .from(users).where(inArray(users.id, wantedUsers));
    for (const user of rows) userMap.set(user.id, user);
  } catch { /* Preserve the existing User <id>/null fallback if user metadata is unavailable. */ }

  const agents = new AgentsRepo();
  const configs = new AgentConfigsRepo();
  const agentReads = new Map<string, Promise<SportsAgentInfo | null>>();
  const rateReads = new Map<string, Promise<number>>();
  const rateFor = (agent: NonNullable<Awaited<ReturnType<AgentsRepo['findById']>>>) => {
    let read = rateReads.get(agent.id);
    if (!read) {
      read = (async () => {
        if (agent.schemeType === 'COMMISSION') {
          const config = await configs.getCommissionConfig(agent.id, 'sports', at);
          return config ? Number(config.commissionRate) * 100 : 0;
        }
        if (agent.schemeType === 'SHARING' || agent.schemeType === 'CREDIT') {
          const config = await configs.getSharingConfig(agent.id, 'sports', at);
          return config ? Number(config.shareRate) * 100 : 0;
        }
        return 0;
      })();
      rateReads.set(agent.id, read);
    }
    return read;
  };
  const agentFor = (key: string, lookup: () => ReturnType<AgentsRepo['findById']>, direct: boolean) => {
    let read = agentReads.get(key);
    if (!read) {
      // Cache the promise before awaiting: simultaneous bets/players share the in-flight read.
      read = (async (): Promise<SportsAgentInfo | null> => {
        try {
          const agent = await lookup();
          if (!agent?.allowedDomains?.includes('sports')) return null;
          return {
            agentId: agent.id,
            agentName: agent.username || (direct ? agent.phone : null) || `Agent ${agent.id}`,
            schemeType: agent.schemeType,
            rate: await rateFor(agent),
          };
        } catch { return null; }
      })();
      agentReads.set(key, read);
    }
    return read;
  };
  await Promise.all(ids.map(async id => {
    const user = userMap.get(id);
    let agentInfo: SportsAgentInfo | null = null;
    if (fields.agents && user?.agentId) agentInfo = await agentFor(`id:${user.agentId}`, () => agents.findById(user.agentId!), true);
    const referrer = referrers.get(id);
    if (fields.agents && !agentInfo && referrer) {
      const username = userMap.get(referrer)?.username;
      if (username) agentInfo = await agentFor(`username:${username.trim().toLowerCase()}`, () => agents.findByUsername(username, undefined, undefined, tenant), false);
    }
    result.set(String(id), { name: user?.name || user?.username || `User ${id}`, flags: user?.flags || null, agentInfo });
  }));
  return result;
}
