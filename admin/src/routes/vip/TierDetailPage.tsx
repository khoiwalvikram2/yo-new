import { useParams, Link, useNavigate } from 'react-router-dom'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useVIPTiers, useVIPMembers, useAddVIPPoints, useUpdateVIPMember } from '../../modules/vip'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import { Notice } from '@/ui/components/Notice'
import { toast } from '@/ui/components/toast'
import { useVipTierActions } from './useVipTierActions'
import { tierStatusChange } from './vipTierActionsModel'
import styles from './TierDetailPage.module.css'

export default function VIPTierDetailPage() {
  return <RBACGuard required={[{ domain: 'vip.tiers', actions: ['view'] }]}><VIPTierDetailPageContent /></RBACGuard>
}
function VIPTierDetailPageContent() {
  const { id } = useParams()
  const eyebrow = usePageEyebrow()
  const { data, loading, error } = useVIPTiers()
  const tier = data?.vipTiers.find((item) => item.id === id)
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { data: membersData, refetch: refetchMembers } = useVIPMembers({ tierId: id })
  const [addPoints, { loading: adding }] = useAddVIPPoints()
  const [updateMember, { loading: upgrading }] = useUpdateVIPMember()
  const navigate = useNavigate()
  const tierActions = useVipTierActions({ onDeleted: () => navigate('/vip/tiers') })
  if (loading) return <Page><LoadingState label="Loading VIP tier" /></Page>
  if (!tier) return <Page><PageHeader title="VIP Tier" eyebrow={eyebrow} back={{ to: '/vip/tiers', label: 'Back to VIP Tiers' }} />
    <EmptyState title="VIP Tier not found" /></Page>
  const members = membersData?.vipMembers || []
  const reportFailure = (error: unknown) => toast({ tone: 'error', message: error instanceof Error ? error.message : 'Unable to update VIP member' })
  const statusChange = tierStatusChange(tier)
  return (
    <Page maxWidth="wide">
      <PageHeader title={tier.name} eyebrow={eyebrow}
        meta={<span className={styles.inline}><span>Level {tier.level}</span>
          <StatusPill status={tier.status}>{tier.status === 'active' ? 'Active' : 'Inactive'}</StatusPill></span>}
        back={{ to: '/vip/tiers', label: 'Back to VIP Tiers' }}
        actions={<>
          <Link to={`/vip/tiers/${tier.id}/edit`} className={buttonClassName()}>Edit</Link>
          {tierActions.canChangeStatus ? <Button onClick={() => tierActions.requestStatusChange(tier)}>{statusChange.label}</Button> : null}
          {tierActions.canDelete ? <Button variant="danger" onClick={() => tierActions.requestDelete(tier)}>Delete</Button> : null}
        </>} />
      <div className={styles.stack}>
        {error ? <Notice tone="error">{error.message}</Notice> : null}
        <div className={styles.stats}>
          <Stat label="Minimum Monthly Deposit" value={formatAmount(convertFromWhitelabelCurrency(tier.minMonthlyDeposit))} size="compact" />
          <Stat label="Total Members" value={members.length.toLocaleString()} size="compact" />
          <Stat label="Tier Color" value={<span className={styles.inline}>
            <span className={styles.swatch} style={{ backgroundColor: tier.color }} aria-hidden="true" />
            {tier.color.toUpperCase()}</span>} size="compact" />
        </div>
        <Card title="Members in this Tier" sub={`${members.length} members`}>
          {!members.length ? <EmptyState title="No members in this tier yet" /> :
            <div className={styles.members}>{members.slice(0, 20).map((member) => (
              <div key={member.id} className={styles.member}>
                <div className={styles.identity}><span className={styles.avatar} aria-hidden="true">{member.userName?.charAt(0).toUpperCase() || 'U'}</span>
                  <div><div className={styles.name}>{member.userName}</div><div className={styles.secondary}>{member.userEmail || member.userId}</div></div>
                </div>
                <div className={styles.points}><span className={styles.secondary}>Current Points</span><strong>{member.currentPoints.toLocaleString()}</strong>
                  {member.nextTierName ? <span className={styles.secondary}>To {member.nextTierName}: {member.pointsToNextTier == null ? '-' : `${formatAmount(convertFromWhitelabelCurrency(member.pointsToNextTier))} more this month`}</span> : null}</div>
                <div className={styles.inline}>
                  <Button size="sm" loading={adding} aria-label={`Add 100 points to ${member.userName}`}
                    onClick={() => { void addPoints({ variables: { input: { memberId: member.id, points: 100, description: 'Nudge' } } })
                      .then(() => { void refetchMembers() }).catch(reportFailure) }}>+100 pts</Button>
                  <Button size="sm" variant="primary" loading={upgrading} aria-disabled={!member.nextTierId}
                    aria-label={`Upgrade ${member.userName}`} onClick={() => {
                      if (!member.nextTierId) return
                      void updateMember({ variables: { input: { memberId: member.id, tierId: member.nextTierId } } })
                        .then(() => { void refetchMembers() }).catch(reportFailure)
                    }}>Upgrade</Button>
                </div>
              </div>
            ))}</div>}
        </Card>
        <div className={styles.details}>
          <Card title="Benefits">{tier.benefits.length ? <ul className={styles.benefits}>
            {tier.benefits.map((benefit, index) => <li key={index}>{benefit}</li>)}</ul> : <EmptyState title="No benefits configured" />}</Card>
          <Card title="Perks">{tier.perks.length ? <div className={styles.stack}>
            {tier.perks.map((perk, index) => <section key={index} className={styles.perk}><h3>{perk.name}</h3><p>{perk.description}</p></section>)}</div> :
            <EmptyState title="No perks configured" />}</Card>
        </div>
      </div>
    </Page>
  )
}

