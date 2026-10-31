/** Reads the user's selected wallet from localStorage (set by Topbar). */
export function getSelectedWallet(): 'balance' | 'bonus' | 'referralBonus' {
  try {
    const s = localStorage.getItem('stakex_selected_wallet')
    if (s === 'bonus') return 'bonus'
    if (s === 'referralBonus') return 'referralBonus'
    return 'balance'
  } catch {
    return 'balance'
  }
}
