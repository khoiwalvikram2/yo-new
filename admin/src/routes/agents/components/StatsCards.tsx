import { useQuery, gql } from '@apollo/client'
import { IconUsers, IconHierarchy, IconChartLine, IconAlertTriangle, IconWallet, IconCoins, IconScale } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { AccountListMetric } from '@/modules/account-lists/AccountList'
import { strokeFor } from '@/ui/components/icons'
import styles from '@/modules/account-lists/AccountList.module.css'
import own from './AgentsSearchComponents.module.css'
import { AGENT_OVERVIEW_QUERY, type AgentOverviewItem } from './agentOverview'
import { HIGH_CREDIT_USE, agentLevelNames, topLevelAgents, type AgentListStats } from './agentsSearchModel'

/** Every agent of one scheme with its stats, for the money cards whose figures are not on the agent
 *  record itself (commission and sharing). One request for the scheme, after the list has loaded. */
const AGENT_SCHEME_TOTALS_QUERY = gql`
  query AgentSchemeTotals($schemeType: AgentScheme) {
    agents {
      agentsPage(schemeType: $schemeType, limit: 1000, includeStats: true) {
        itemsWithStats {
          agent {
            id
            parentAgentId
          }
          stats {
            turnover
            commissionEarned
            profitLoss
            pendingSettlement
          }
        }
      }
    }
  }
`;

type AgentTotalsItem = {
  agent: { id: string; parentAgentId?: string | null };
  stats?: AgentListStats | null;
};

type StatsCardsProps = {
  schemeType?: string;
  defer?: boolean;
  /** A logged-in agent sees its own network rather than every agent of the scheme. */
  ownNetwork?: boolean;
};

const SCHEME_LABELS: Record<string, string> = { COMMISSION: 'Commission Agents', CREDIT: 'Credit Agents', SHARING: 'Sharing Agents' };
const LEVELS = [1, 2, 3, 4];
const HIGH_CREDIT_PERCENT = Math.round(HIGH_CREDIT_USE * 100);

const sum = <T,>(rows: readonly T[], value: (row: T) => number | string | null | undefined) =>
  rows.reduce((total, row) => total + Number(value(row) ?? 0), 0);

export function StatsCards({ schemeType, defer = false, ownNetwork = false }: StatsCardsProps) {
  const { formatAmount } = useCurrency();
  const { data, loading } = useQuery(AGENT_OVERVIEW_QUERY, {
    fetchPolicy: "cache-and-network",
    nextFetchPolicy: "cache-first",
    skip: defer,
  });
  const moneyFromStats = schemeType === 'COMMISSION' || schemeType === 'SHARING';
  const totals = useQuery(AGENT_SCHEME_TOTALS_QUERY, {
    variables: { schemeType },
    fetchPolicy: "cache-and-network",
    nextFetchPolicy: "cache-first",
    skip: defer || !moneyFromStats,
  });

  const allAgents: AgentOverviewItem[] = data?.agents?.agentsPage?.items ?? [];
  const agents = schemeType
    ? allAgents.filter((a) => a.schemeType === schemeType)
    : allAgents;

  const withStatus = (status: string) => agents.filter((a) => a.status === status).length;
  const blocked = withStatus('BLOCKED');
  const statusNote = [
    `${withStatus('ACTIVE')} active`,
    `${withStatus('INACTIVE')} inactive`,
    `${withStatus('SUSPENDED')} suspended`,
    ...(blocked ? [`${blocked} blocked`] : []),
  ].join(' · ');

  const levels = LEVELS.map((level) => ({ name: agentLevelNames[level], count: agents.filter((a) => a.levelIndex === level).length }));
  const deeper = agents.filter((a) => (a.levelIndex ?? 0) > LEVELS.length).length;
  if (deeper) levels.push({ name: `Level ${LEVELS.length + 1}+`, count: deeper });

  // Credit: a parent's limit and use already hold what it allocated below it, so add up top-level agents.
  const creditRoots = topLevelAgents(agents);
  const creditLimit = sum(creditRoots, (a) => a.creditLimit);
  const creditUsed = sum(creditRoots, (a) => a.creditUsed);
  const creditPercent = creditLimit > 0 ? Math.round((creditUsed / creditLimit) * 100) : 0;
  const creditToSettle = creditRoots.filter((a) => Number(a.settlementBalance ?? 0) !== 0);
  const creditPending = sum(creditToSettle, (a) => Math.abs(Number(a.settlementBalance)));
  const nearLimit = agents.filter((a) => {
    const limit = Number(a.creditLimit ?? 0);
    return limit > 0 && Number(a.creditUsed ?? 0) / limit > HIGH_CREDIT_USE;
  }).length;

  // Commission and sharing: turnover, P/L and pending cover each agent's downline, so they are added up over
  // top-level agents; commission earned is each agent's own share after its sub-agents, so over all of them.
  const totalsRows: AgentTotalsItem[] = totals.data?.agents?.agentsPage?.itemsWithStats ?? [];
  const moneyRoots = topLevelAgents(totalsRows.map((row) => ({ ...row.agent, stats: row.stats })));
  const turnover = sum(moneyRoots, (row) => row.stats?.turnover);
  const commissionEarned = sum(totalsRows, (row) => row.stats?.commissionEarned);
  const profitLoss = sum(moneyRoots, (row) => row.stats?.profitLoss);
  const sharingToSettle = moneyRoots.filter((row) => Number(row.stats?.pendingSettlement ?? 0) !== 0);
  const sharingPending = sum(sharingToSettle, (row) => Math.abs(Number(row.stats?.pendingSettlement)));

  // Until the first answer the cards hold their own height with placeholders, so the page does not jump.
  const pending = (defer || loading) && !data
  const moneyPending = (defer || totals.loading) && !totals.data
  const moneyFailed = !moneyPending && !totals.data && !!totals.error
  const money = (value: number) => moneyFailed ? '—' : formatAmount(value)
  const moneyNote = (note: string) => moneyFailed ? 'Not available right now' : note
  const network = (scheme: string) => ownNetwork ? 'Your network' : `All ${scheme} agents`
  const toSettle = (count: number) => count === 0 ? 'Nothing to settle'
    : ownNetwork ? 'To settle' : `${count} ${count === 1 ? 'agent' : 'agents'} to settle`
  const icon = (Glyph: typeof IconUsers) => <Glyph size={18} stroke={strokeFor(18)} />

  const levelsCard = <AccountListMetric label="Network Levels"
    value={<span className={own.levels}><span aria-hidden="true">{levels.map((level) => level.count).join(' · ')}</span><span className={own.srOnly}>{levels.map((level) => `${level.name} ${level.count}`).join(', ')}</span></span>}
    note={<span aria-hidden="true">{`${levels[0].name} to ${levels[levels.length - 1].name}`}</span>}
    tooltip={levels.map((level) => `${level.name} ${level.count}`).join(' · ')}
    icon={icon(IconHierarchy)} hue="vio" loading={pending} />

  return <div className={styles.metrics} role="group" aria-label="Agent statistics" aria-busy={pending || (moneyFromStats && moneyPending) || undefined}>
    <AccountListMetric label={SCHEME_LABELS[schemeType ?? ''] ?? 'Total Agents'} value={agents.length} note={statusNote} icon={icon(IconUsers)} hue="blu" loading={pending} />
    {schemeType === 'CREDIT' ? <>
      <AccountListMetric label="Credit Used" value={formatAmount(creditUsed)} note={creditLimit > 0 ? `${creditPercent}% of ${formatAmount(creditLimit)} limit` : 'No credit given yet'} icon={icon(IconWallet)} hue="ind" loading={pending} />
      <AccountListMetric label="Pending Settlement" value={formatAmount(creditPending)} note={toSettle(creditToSettle.length)} icon={icon(IconScale)} hue="vio" loading={pending} />
      <AccountListMetric label="Near Credit Limit" value={nearLimit} note={nearLimit > 0 ? `Agents above ${HIGH_CREDIT_PERCENT}% used` : `None above ${HIGH_CREDIT_PERCENT}% used`} icon={icon(IconAlertTriangle)} hue="amb" loading={pending} />
    </> : schemeType === 'SHARING' ? <>
      {levelsCard}
      <AccountListMetric label="P/L" value={moneyFailed ? '—' : <span className={profitLoss > 0 ? own.positive : profitLoss < 0 ? own.negative : undefined}>{formatAmount(profitLoss)}</span>} note={moneyNote(network('sharing'))} icon={icon(IconChartLine)} hue="grn" loading={moneyPending} />
      <AccountListMetric label="Pending Settlement" value={money(sharingPending)} note={moneyNote(toSettle(sharingToSettle.length))} icon={icon(IconScale)} hue="amb" loading={moneyPending} />
    </> : <>
      {levelsCard}
      <AccountListMetric label="Turnover" value={money(turnover)} note={moneyNote(network('commission'))} icon={icon(IconChartLine)} hue="grn" loading={moneyPending} />
      <AccountListMetric label="Commission Earned" value={money(commissionEarned)} note={moneyNote(ownNetwork ? 'Your share' : network('commission'))} icon={icon(IconCoins)} hue="amb" loading={moneyPending} />
    </>}
  </div>
}
