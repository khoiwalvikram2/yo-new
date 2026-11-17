/* What the VIP tier list and detail pages offer to change a tier's status or remove it (MAR-11),
   kept React-free so the copy and rules are tested on their own. Before this, neither page offered
   either: a mistaken tier stayed live for players until someone called the API. */

export interface TierActionTarget {
  id: string
  name: string
  status: string
}

export interface TierStatusChange {
  /** What setVIPTierStatus is sent. */
  status: 'active' | 'inactive'
  /** The button's verb. */
  label: 'Activate' | 'Deactivate'
  title: string
  description: string
  /** The toast once the server has agreed. */
  done: string
}

/**
 * An active tier is deactivated; any other (inactive, or a draft) is activated. The copy says what
 * players see, because a tier carries their deposit rules: the automatic tier is the highest active
 * one their monthly deposits reach, and a member of an inactive tier falls back to it.
 */
export function tierStatusChange(tier: TierActionTarget): TierStatusChange {
  if (tier.status === 'active') {
    return {
      status: 'inactive',
      label: 'Deactivate',
      title: `Deactivate ${tier.name}?`,
      description: `Players can no longer reach ${tier.name}. Its members move to the tier their monthly deposits earn, and that tier's deposit rules apply to them.`,
      done: `${tier.name} deactivated`,
    }
  }
  return {
    status: 'active',
    label: 'Activate',
    title: `Activate ${tier.name}?`,
    description: `Players whose monthly deposits qualify reach ${tier.name} again, with its deposit rules.`,
    done: `${tier.name} activated`,
  }
}

/** The server refuses to delete a tier players have been on, and says to deactivate it instead. */
export function tierDeleteCopy(tier: TierActionTarget): { title: string; description: string; done: string } {
  return {
    title: `Delete ${tier.name}?`,
    description: 'The tier is removed for good. A tier that players have been on cannot be deleted: deactivate it instead.',
    done: `${tier.name} deleted`,
  }
}

/** A mutation payload that did not succeed becomes the error the confirmation shows in place. */
export function payloadOutcome(payload: { success?: boolean | null; message?: string | null } | null | undefined, fallback: string): void {
  if (!payload?.success) throw new Error(payload?.message?.trim() || fallback)
}
