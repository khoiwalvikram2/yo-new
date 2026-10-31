/**
 * Score card and Live TV URLs. Only use when parsedSettings.features.liveTvAndScoreCardEnabled is true
 * (grandwinn-com only; kondareddi-com and other tenants get false from server). Optional: use
 * sportsExtraUrls GraphQL query for server-provided URLs instead of these constants.
 *
 * Score card API: https://tv.tresting.com/lnt.php?eventid={eventId}
 * Live TV API:  https://e765432.diamondcricketid.com/dtv.php?id={eventId}
 */

export const SCOREBOARD_BASE_URL = 'https://tv.tresting.com/lnt.php'
export const LIVE_TV_BASE_URL = 'https://e765432.diamondcricketid.com/dtv.php'

/** Score card iframe URL – query param: eventid (exact API spec). Use only when liveTvAndScoreCardEnabled is true. */
export function getScoreboardUrl(eventId: string): string {
  const id = typeof eventId === 'string' ? eventId.trim() : ''
  if (!id) return ''
  return `${SCOREBOARD_BASE_URL}?eventid=${encodeURIComponent(id)}`
}

/** Live TV iframe URL – query param: id (exact API spec). Use only when liveTvAndScoreCardEnabled is true. */
export function getLiveTvUrl(eventId: string): string {
  const id = typeof eventId === 'string' ? eventId.trim() : ''
  if (!id) return ''
  return `${LIVE_TV_BASE_URL}?id=${encodeURIComponent(id)}`
}
