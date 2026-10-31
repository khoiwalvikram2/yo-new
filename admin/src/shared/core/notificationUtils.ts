/**
 * Resolves notification actionUrl to actual admin app routes.
 * Backend may send legacy or incorrect paths (e.g. /players/3, /agent/3);
 * this maps them to the correct profile routes.
 */
export function resolveNotificationActionUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;

  const trimmed = url.trim();

  // Player: /players/3 or /players/123 -> /players/profile/3
  const playerMatch = trimmed.match(/^\/players\/(\d+)\/?$/);
  if (playerMatch) return `/players/profile/${playerMatch[1]}`;

  // Agent (singular): /agent/3 -> /agents/3 (profile)
  const agentSingularMatch = trimmed.match(/^\/agent\/(\d+)\/?$/);
  if (agentSingularMatch) return `/agents/${agentSingularMatch[1]}`;

  // Agent profile with sub-path (e.g. /agents/3/credit): route is /agents/:id only, so go to profile
  const agentWithSubMatch = trimmed.match(/^\/agents\/(\d+)\/.+$/);
  if (agentWithSubMatch) return `/agents/${agentWithSubMatch[1]}`;

  return trimmed;
}
