import { useState } from 'react'
import clsx from 'clsx'
import { useQuery, useMutation } from '@apollo/client'
import { IconArrowDownLeft, IconArrowUpRight, IconChecks, IconHourglass } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { AGENT_SETTLEMENTS_PAGE_QUERY, SETTLE_AGENT_MUTATION, PENDING_SETTLEMENTS_QUERY } from '@/lib/graphql/settlements'
import { SettlementModal } from '@/routes/settlements/components/SettlementModal'
import { notify } from '@/shared/services/notification'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import { AccountListMetric } from '@/modules/account-lists/AccountList'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Notice } from '@/ui/components/Notice'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { agentDirectionLabel, hasPendingAmount, settlementDirectionOf, settlerDirectionLabel, sharingSettlePeriod, type PendingSettlement } from '@/routes/settlement/settlementModel'
import styles from './AgentProfileComponents.module.css'

interface SettlementTabProps {
  agentId: string;
  agent: { id: string; username?: string; schemeType?: string; parentAgentId?: string | null } | null;
}

export function SettlementTab({ agentId, agent }: SettlementTabProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency();
  const { formatDateTime } = useFormatDate();
  // On a phone the history keeps the date, the direction and the amount.
  const { isMobile } = useBreakpoint();
  // An agent settles its direct children only (never itself or a grandchild); admins settle any agent.
  const loggedInAgent = useAuthStore((state) => state.agent);
  const canSettle = !loggedInAgent || (!!agent?.parentAgentId && agent.parentAgentId === loggedInAgent.id);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [settlementModalVisible, setSettlementModalVisible] = useState(false);
  const [selectedAgentForSettlement, setSelectedAgentForSettlement] = useState<{ agentId: string; agent: { id: string; username?: string; schemeType?: string }; schemeType?: string; pendingAmount: number; settlementType: string; settlementDirection?: string | null; periodTo?: string | null; settlementBreakdownByDomain?: PendingSettlement['settlementBreakdownByDomain'] } | null>(null);

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '—';
    return formatAmount(convertFromWhitelabelCurrency(value));
  };

  const { data: settlementsData, loading: settlementsLoading, error: settlementsError, refetch: refetchSettlements } = useQuery(
    AGENT_SETTLEMENTS_PAGE_QUERY,
    {
      variables: { agentId, limit: pageSize, offset: (page - 1) * pageSize },
      fetchPolicy: 'cache-and-network',
      errorPolicy: 'all',
      skip: !agentId,
    }
  );

  const { data: pendingData, loading: pendingLoading, refetch: refetchPending } = useQuery(
    PENDING_SETTLEMENTS_QUERY,
    {
      variables: { schemeType: agent?.schemeType },
      fetchPolicy: 'cache-and-network',
      errorPolicy: 'all',
      skip: !agent?.schemeType || !agentId,
    }
  );

  const [settleAgent] = useMutation(SETTLE_AGENT_MUTATION, {
    onCompleted: (data) => {
      if (data.settleAgent.success) {
        notify.success(data.settleAgent.message, 'Settlement Successful');
        setSettlementModalVisible(false);
        setSelectedAgentForSettlement(null);
        refetchSettlements();
        refetchPending();
      } else {
        notify.error(data.settleAgent.message, 'Settlement Failed');
      }
    },
    onError: (err: { message?: string }) => {
      notify.error(err.message ?? 'Error', 'Settlement Error');
    },
  });

  const pendingSettlement: PendingSettlement | undefined = (pendingData?.pendingSettlements || []).find(
    (s: { agentId?: string }) => s.agentId === agentId
  );

  const summary = settlementsData?.agentSettlementTransactionsPage;
  const settlements = summary?.items || [];

  if (!agent || !agentId) return <Notice>Agent data not available</Notice>

  type SettlementRow = { id?: string; createdAt?: string; amount?: number; direction?: string; settlementType?: string; previousBalance?: number; newBalance?: number; notes?: string };
  const totalSettled = summary?.totalAmount ?? 0;
  const toAgent = summary?.toAgent ?? 0;
  const fromAgent = summary?.fromAgent ?? 0;
  // Until the first answer the figures keep their layout with placeholders.
  const historyPending = settlementsLoading && !settlementsData;
  const pendingPending = pendingLoading && !pendingData;

  // Get pending amount from pending settlements query: signed (positive = TO_AGENT, the agent is paid;
  // negative = FROM_AGENT). Only a SHARING agent has this tab: a CREDIT agent settles by moving chips
  // (Deposit / Withdraw of its Ref P/L, spec 2026-11-02 decision 8), on its Chips tab.
  const pendingAmount = Number(pendingSettlement?.pendingAmount) || 0;
  const pendingDirection = settlementDirectionOf(pendingSettlement?.settlementDirection, pendingAmount);
  // The agent looking at its own profile sees its side ("You receive" / "You pay"); admins and the parent see the settler's.
  const ownProfile = !!loggedInAgent && loggedInAgent.id === agentId;
  const pendingDirectionLabel = ownProfile ? agentDirectionLabel(pendingDirection) : settlerDirectionLabel(pendingDirection);
  const hasPending = hasPendingAmount(pendingAmount);

  const handleSettle = () => {
    if (!agent?.id || !agent?.schemeType) return;
    setSelectedAgentForSettlement({
      agentId: agent.id,
      agent: {
        id: agent.id,
        username: agent.username,
        schemeType: agent.schemeType,
      },
      schemeType: agent.schemeType,
      pendingAmount: pendingAmount,
      settlementType: 'P_L',
      settlementDirection: pendingSettlement?.settlementDirection ?? null,
      periodTo: pendingSettlement?.periodTo ?? null,
      settlementBreakdownByDomain: pendingSettlement?.settlementBreakdownByDomain,
    });
    setSettlementModalVisible(true);
  };

  const handleSettlementSubmit = async (values: { notes?: string; amount?: number; direction?: string }) => {
    if (!agent?.id || !agent?.schemeType) return;
    const notes = (values?.notes != null ? String(values.notes) : '').trim();
    if (!notes || notes.length < 3) {
      notify.error('Notes must be at least 3 characters', 'Validation');
      return;
    }
    const input: Record<string, unknown> = {
      agentId: agent.id,
      settlementType: 'P_L',
      amount: values.amount,
      direction: values.direction,
      notes,
      // SHARING: settle exactly the window the pending figure covers (its periodTo), so the posted amount is the shown one.
      ...sharingSettlePeriod({ schemeType: agent.schemeType, periodTo: selectedAgentForSettlement?.periodTo }),
    };
    await settleAgent({
      variables: { input },
    });
  };

  const directionCell = (row: SettlementRow) => <span className={row.direction === 'TO_AGENT' ? styles.positive : styles.negative}>{row.direction === 'TO_AGENT' ? 'To Agent' : 'From Agent'}</span>
  const columns: DataTableColumn<SettlementRow>[] = [
    { key: 'date', header: 'Date', cell: row => <div className={styles.rowDetails}><span>{row.createdAt ? formatDateTime(row.createdAt, 'MMM d, yyyy HH:mm') : '—'}</span>{isMobile && row.settlementType && <span className={styles.muted}>{row.settlementType}</span>}</div> },
    { key: 'type', header: 'Type', hidden: isMobile, cell: row => <StatusPill tone="info">{row.settlementType}</StatusPill> },
    { key: 'direction', header: 'Direction', cell: directionCell },
    { key: 'amount', header: 'Amount', align: 'right', cell: row => <strong>{formatCurrency(row.amount)}</strong> },
    { key: 'balance', header: 'Balance', hidden: isMobile, cell: row => <span><span className={styles.muted}>{formatCurrency(row.previousBalance)} → </span>{formatCurrency(row.newBalance)}</span> },
    { key: 'notes', header: 'Notes', hidden: isMobile, cell: row => row.notes || '—' },
  ]
  const reload = () => { void refetchSettlements(); void refetchPending() }
  return <div className={clsx(styles.stack, styles.tabPanel)}>
    <Card title="Settlement Summary" sub="P/L settlements with this agent" tools={<Button size="sm" onClick={reload}>Refresh</Button>}>
      <div className={styles.stack}>
        <div className={styles.tabKpis} role="group" aria-label="Settlement figures">
          <AccountListMetric label="Pending Settlement" value={formatCurrency(Math.abs(pendingAmount))} note={hasPending ? pendingDirectionLabel : 'Settled'} icon={<IconHourglass size={18} />} hue="amb" loading={pendingPending} />
          <AccountListMetric label="Total Settled" value={formatCurrency(totalSettled)} note={`${summary?.total ?? 0} transactions`} icon={<IconChecks size={18} />} hue="blu" loading={historyPending} />
          <AccountListMetric label="Paid to Agent" value={formatCurrency(toAgent)} note={`${summary?.toCount ?? 0} txns`} icon={<IconArrowUpRight size={18} />} hue="grn" loading={historyPending} />
          <AccountListMetric label="Collected from Agent" value={formatCurrency(fromAgent)} note={`${summary?.fromCount ?? 0} txns`} icon={<IconArrowDownLeft size={18} />} hue="vio" loading={historyPending} />
        </div>
        {hasPending && agent.id && <Notice tone="info" title="Pending Settlement Available" action={canSettle ? <Button variant="primary" onClick={handleSettle}>Settle Now</Button> : undefined}>{formatCurrency(Math.abs(pendingAmount))} pending P/L settlement · {pendingDirectionLabel}</Notice>}
      </div>
    </Card>
    <Card title="Settlement History" sub="Each settlement and the balance it left" body="table" tools={<Button size="sm" onClick={() => void refetchSettlements()}>Refresh</Button>}>
      <DataTable label="Agent settlement history" columns={columns} rows={settlements} rowKey={row => String(row.id)} state={settlementsLoading ? 'loading' : settlementsError ? 'error' : 'ready'} error={settlementsError?.message || 'Failed to load settlement history'} onRetry={() => void refetchSettlements()} empty={<EmptyState title="No settlement history" />}
        density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined}
        pagination={{ current: page, pageSize, total: summary?.total ?? 0, onChange: setPage, onPageSizeChange: size => { setPageSize(size); setPage(1) } }} />
    </Card>
    {selectedAgentForSettlement && <SettlementModal visible={settlementModalVisible} agent={selectedAgentForSettlement} onCancel={() => { setSettlementModalVisible(false); setSelectedAgentForSettlement(null) }} onSubmit={handleSettlementSubmit} formatCurrency={formatCurrency} />}
  </div>
}
