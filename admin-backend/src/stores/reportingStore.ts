export type ReportRow = { dimension: string; value: number; date?: string }

export function liquidityReport(range = '7d'): ReportRow[] {
  const days = parseInt(range) || 7
  const out: ReportRow[] = []
  const start = Date.now() - days * 24 * 3600 * 1000
  for (let i = 0; i < days; i++) {
    out.push({ dimension: 'All', value: 500000 + Math.round(Math.random() * 20000), date: new Date(start + i * 24 * 3600 * 1000).toISOString() })
  }
  return out
}

export function exposureReport(range = '7d'): ReportRow[] {
  const days = parseInt(range) || 7
  const out: ReportRow[] = []
  const start = Date.now() - days * 24 * 3600 * 1000
  for (let i = 0; i < days; i++) {
    out.push({ dimension: 'All', value: 200000 + Math.round(Math.random() * 10000), date: new Date(start + i * 24 * 3600 * 1000).toISOString() })
  }
  return out
}

export function pnlReport(range = '7d'): ReportRow[] {
  const days = parseInt(range) || 7
  const out: ReportRow[] = []
  const start = Date.now() - days * 24 * 3600 * 1000
  for (let i = 0; i < days; i++) {
    out.push({ dimension: 'All', value: -5000 + Math.round((Math.random() - 0.5) * 5000), date: new Date(start + i * 24 * 3600 * 1000).toISOString() })
  }
  return out
}
