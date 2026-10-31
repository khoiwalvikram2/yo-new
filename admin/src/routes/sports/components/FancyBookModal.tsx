import { useMemo, useState, useEffect } from 'react'
import { IconChartBar, IconTrendingUp, IconTrendingDown, IconDownload } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { Dialog } from '@/ui/components/Dialog'
import { EmptyState } from '@/ui/components/EmptyState'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { toast } from '@/ui/components/toast'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { calculateFancyBook, type FancyBookEntry } from '../utils/fancyBookCalculator'
import { fancyBookCsv, fancyBookSummary } from './eventDetailModel'
import styles from './EventDetailUi.module.css'

interface FancyRunner { id?: string | number | null; selectionId?: string | number | null; name?: string | null; selection?: string | null }
interface FancyBookModalProps {
  open: boolean; onClose: () => void
  market: { id?: string | number | null; runners?: FancyRunner[] | null; odds?: FancyRunner[] | null }
  bets: unknown[]
  fancySelection?: string
}

export function FancyBookModal({ open, onClose, market, bets, fancySelection }: FancyBookModalProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const [showFullRange, setShowFullRange] = useState(false)
  useEffect(() => { if (!open) setShowFullRange(false) }, [open, market?.id])
  const bookData = useMemo(() => {
    if (!bets || !bets.length || !market?.id) return null
    let selectionId: string | undefined
    let selectionName: string | undefined
    if (fancySelection) {
      const runner = (market.runners || market.odds || []).find(item => String(item.name || item.selection || '').trim() === String(fancySelection).trim())
      if (runner) {
        const identifier = runner.id || runner.selectionId
        selectionId = identifier ? String(identifier) : undefined
        selectionName = runner.name || runner.selection || undefined
      } else selectionName = fancySelection
    }
    try { return calculateFancyBook(bets, String(market.id), selectionId, selectionName) }
    catch { return null }
  }, [bets, market?.id, market?.runners, market?.odds, fancySelection])
  const filteredEntries = useMemo(() => fancyBookSummary(bookData?.entries || [], showFullRange), [bookData, showFullRange])
  const formatPL = (value: number) => Number.isFinite(value) ? formatAmount(convertFromWhitelabelCurrency(value)) : 'N/A'
  function exportCSV() {
    if (!bookData?.entries.length) return
    try {
      const url = URL.createObjectURL(new Blob([fancyBookCsv(bookData.entries)], { type: 'text/csv;charset=utf-8;' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `fancy-book-${market?.id || 'unknown'}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    } catch (reason) { toast({ tone: 'error', title: 'Export failed', message: reason instanceof Error ? reason.message : 'The fancy book could not be exported.' }) }
  }
  const columns: DataTableColumn<FancyBookEntry>[] = [
    { key: 'position', header: 'Position', cell: (entry, index) => {
      const previous = index > 0 ? filteredEntries[index - 1] : null
      const boundary = previous && ((previous.pnl < 0 && entry.pnl >= 0) || (previous.pnl >= 0 && entry.pnl < 0))
      return <span className={styles.row}>{entry.position}{boundary && <StatusPill tone="neutral">Break Even</StatusPill>}</span>
    } },
    { key: 'pnl', header: 'P/L', align: 'right', cell: entry => <span className={entry.pnl >= 0 ? styles.positive : styles.negative}>{entry.pnl >= 0 ? '+' : ''}{formatPL(entry.pnl)}</span> },
  ]
  return <Dialog open={open} onOpenChange={next => { if (!next) onClose() }} title="Fancy Book Analysis" description={fancySelection} size="xl" footer={<>
    {!!bookData?.entries.length && <Button icon={<IconDownload size={16} />} onClick={exportCSV}>Export CSV</Button>}
    <Button onClick={onClose}>Close</Button>
  </>}>
    {!bookData?.entries.length ? <EmptyState title="No bets found for this fancy market" icon={<IconChartBar size={24} />} /> : <div className={styles.stack}>
      <div className={styles.metrics}>
        <Card><div className={styles.stack}><Stat label="Total Bets" value={bookData.statistics.totalBets} icon={<IconChartBar size={18} />} hue="grn" variant="bare" /><DescriptionList items={[
          { term: 'Back', value: bookData.statistics.backBets }, { term: 'Lay', value: bookData.statistics.layBets },
          { term: 'Back Stake', value: formatPL(bookData.statistics.totalBackStake) }, { term: 'Lay Stake', value: formatPL(bookData.statistics.totalLayStake) },
        ]} /></div></Card>
        {bookData.bestPosition && bookData.bestPosition.pnl > 0 && <Stat label="Best Position" value={bookData.bestPosition.position} icon={<IconTrendingUp size={18} />} hue="grn" note={formatPL(bookData.bestPosition.pnl)} />}
        {bookData.worstPosition && bookData.worstPosition.pnl < 0 && <Stat label="Worst Position" value={bookData.worstPosition.position} icon={<IconTrendingDown size={18} />} hue="red" note={formatPL(bookData.worstPosition.pnl)} />}
      </div>
      <div className={styles.between}><Switch label="Full Range" checked={showFullRange} onChange={setShowFullRange} /><span className={styles.muted}>Showing {filteredEntries.length} of {bookData.entries.length} positions</span></div>
      <Card body="table"><DataTable label="Fancy book positions" columns={columns} rows={filteredEntries} rowKey={entry => String(entry.position)} pagination={false} width="narrow" /></Card>
      <p className={styles.muted}>{showFullRange ? 'Showing potential P/L for each result position' : 'Summary view: Top 5 profitable and worst 5 loss positions'}</p>
    </div>}
  </Dialog>
}

