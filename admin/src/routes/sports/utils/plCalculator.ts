/**
 * Calculate P&L with cut based on user type
 * @param grossPL - Gross P&L (without cut) - this is playerNetPL from book calculations
 * @param sharingRate - Sharing rate as percentage (0-100), or null for super admin
 * @returns Object with withoutCut and withCut values
 */
export function calculatePLWithCut(
  grossPL: number,
  sharingRate: number | null
): { withoutCut: number; withCut: number } {
  // For super admin (sharingRate is null): show Platform P&L (inverse of player P&L)
  if (sharingRate === null) {
    const platformPL = -grossPL; // Platform P&L is inverse of player P&L
    return {
      withoutCut: platformPL,
      withCut: platformPL, // Same value for super admin
    };
  }
  
  // For agents/whitelabel: apply sharing percentage
  // Formula: withCut = grossPL × (sharingRate/100)
  // sharingRate is what the agent/whitelabel GETS (not what they give away)
  // This applies to both profit and loss
  const withCut = grossPL * (sharingRate / 100);
  
  return {
    withoutCut: grossPL,
    withCut,
  };
}
