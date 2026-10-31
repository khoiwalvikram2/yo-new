import { useEffect, useRef, useState } from 'react'
import { useMutation, gql } from '@apollo/client'
import type { Player } from '@/shared/types/player'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { Switch } from '@/ui/components/Switch'
import { Notice } from '@/ui/components/Notice'
import styles from './PlayerDomainControls.module.css'

const SetUserDomainBets = gql`
  mutation SetUserDomainBets($id: ID!, $sports: Boolean, $casino: Boolean, $matka: Boolean, $sportsVisible: Boolean, $casinoVisible: Boolean, $matkaVisible: Boolean) {
    setUserDomainBets(id: $id, sports: $sports, casino: $casino, matka: $matka, sportsVisible: $sportsVisible, casinoVisible: $casinoVisible, matkaVisible: $matkaVisible) {
      success message user { id sportsVisible casinoVisible matkaVisible sportsBetAllowed casinoBetAllowed matkaBetAllowed }
    }
  }
`
const domains = ['sports', 'casino', 'matka'] as const
type Domain = typeof domains[number]
const labels = { sports: 'Sports', casino: 'Casino', matka: 'Matka' }
const flagsFrom = (user: Player) => Object.fromEntries(domains.map(domain => [domain, { visible: !!user[`${domain}Visible`], allowed: !!user[`${domain}BetAllowed`] }])) as Record<Domain, { visible: boolean; allowed: boolean }>
interface Props { user: Player; saving: Record<string, boolean>; setSavingFlag: (key: string, val: boolean) => void }

export function BettingControlsSection({ user, saving, setSavingFlag }: Props) {
  const [mutate] = useMutation(SetUserDomainBets)
  const [flags, setFlags] = useState(() => flagsFrom(user))
  const [error, setError] = useState('')
  const currentId = useRef(user.id); currentId.current = user.id
  const permissions = useAuthStore(state => state.permissions)
  const agent = useAuthStore(state => state.agent)
  const readOnly = useAuthStore(state => state.isAgentReadOnly())
  const canEdit = !readOnly && (!!agent || hasPermissionWithNested(permissions, 'players.profile', 'update'))
  useEffect(() => {
    setFlags({ sports: { visible: !!user.sportsVisible, allowed: !!user.sportsBetAllowed }, casino: { visible: !!user.casinoVisible, allowed: !!user.casinoBetAllowed }, matka: { visible: !!user.matkaVisible, allowed: !!user.matkaBetAllowed } }); setError('')
  }, [user.id, user.sportsVisible, user.casinoVisible, user.matkaVisible, user.sportsBetAllowed, user.casinoBetAllowed, user.matkaBetAllowed])
  async function update(domain: Domain, kind: 'visible' | 'allowed', value: boolean) {
    const id = user.id, key = `domain-${domain}-${id}`
    setError(''); setSavingFlag(key, true)
    try {
      const response = await mutate({ variables: { id, [kind === 'visible' ? `${domain}Visible` : domain]: value }, context: { uiToast: 'message' } })
      if (!response.data?.setUserDomainBets.success) throw new Error(response.data?.setUserDomainBets.message || 'Could not update player access')
      if (currentId.current === id) setFlags(current => ({ ...current, [domain]: { ...current[domain], [kind]: value } }))
    } catch (cause) {
      if (currentId.current === id) setError(cause instanceof Error ? cause.message : 'Could not update player access')
    } finally { setSavingFlag(key, false) }
  }
  return <div className={styles.stack}>
    <p className={styles.help}>Visible controls the player menu and game access. Betting Allowed controls new bets. Agent and site restrictions also apply. Each switch saves immediately.</p>
    {domains.map(domain => {
      const ownDomain = !agent || agent.allowedDomains?.some(item => item.toLowerCase() === domain)
      const busy = !!saving[`domain-${domain}-${user.id}`]
      return <section className={styles.domain} key={domain} aria-label={`${labels[domain]} access`}>
        <div><strong>{labels[domain]}</strong><p>{!ownDomain ? 'This domain is outside your agent permissions.' : flags[domain].visible ? 'Visibility enabled for this player.' : 'Hidden from this player. New bets are blocked.'}</p></div>
        <div className={styles.switches}>
          <Switch className={styles.control} label={`${labels[domain]} Visible`} checked={flags[domain].visible} disabled={!canEdit || busy || (!ownDomain && !flags[domain].visible)} onChange={value => void update(domain, 'visible', value)} />
          <Switch className={styles.control} label={`${labels[domain]} Betting Allowed`} checked={flags[domain].allowed} disabled={!canEdit || busy || ((!ownDomain || !flags[domain].visible) && !flags[domain].allowed)} onChange={value => void update(domain, 'allowed', value)} />
        </div>
      </section>
    })}
    {!canEdit && <p className={styles.help}>Your current access is read only.</p>}
    {error && <Notice tone="error" live="assertive">{error}</Notice>}
  </div>
}
