import { useState, useEffect, useMemo, useRef } from 'react'
import { IconFolder } from '@tabler/icons-react'
import { useAuditStore, type AuditFilters } from '@/state/auditStore'
import { TIME_RANGE_PRESETS } from '@/modules/audit/constants'
import { FALLBACK_AUDIT_FILTER_OPTIONS, type AuditFilterOptionLists } from '@/modules/audit/graphql/hooks'
import { Combobox } from '@/ui/components/Combobox'
import { FilterBar } from '@/ui/components/FilterBar'
import { MultiSelect } from '@/ui/components/MultiSelect'
import { Select } from '@/ui/components/Select'
import { TextField } from '@/ui/components/TextField'
import { DateField } from '@/ui/components/DateField'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { Menu, MenuItem, MenuSeparator } from '@/ui/components/Menu'
import { EmptyState } from '@/ui/components/EmptyState'
import { auditActiveFilters, auditTimePreset, auditCalendarDay, auditCalendarRange } from '../auditPageModel'
import styles from '../AuditEvents.module.css'
interface FiltersBarProps { filters: AuditFilters; onFiltersChange: (filters: Partial<AuditFilters>) => void; onReset: () => void; options?: AuditFilterOptionLists }
/** A list's choices: what the trail holds, plus anything already chosen (a saved preset or link may name a
 *  value this tenant's trail no longer has, and it must stay visible to be removed). */
function choices(values: readonly string[], chosen: readonly string[] = []) {
  return [...values, ...chosen.filter((value) => !values.includes(value))].map((value) => ({ value, label: value }))
}
export function FiltersBar({ filters, onFiltersChange, onReset, options = FALLBACK_AUDIT_FILTER_OPTIONS }: FiltersBarProps) {
  const { recentSearches, addRecentSearch, savedPresets, addSavedPreset, removeSavedPreset, updateSavedPreset } = useAuditStore()
  const [search, setSearch] = useState(filters.search || '')
  const [period, setPeriod] = useState('')
  const [showRange, setShowRange] = useState(false)
  const periodRef = useRef(period); periodRef.current = period
  const [dates, setDates] = useState({ from: auditCalendarDay(filters.from), to: auditCalendarDay(filters.to) })
  const [saveOpen, setSaveOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => { setSearch(filters.search ?? '') }, [filters.search])
  useEffect(() => {
    setDates({ from: auditCalendarDay(filters.from), to: auditCalendarDay(filters.to) })
    if (!filters.from && !filters.to) { setPeriod(''); setShowRange(false) }
    else if (!periodRef.current) { setPeriod('custom'); setShowRange(true) }
  }, [filters.from, filters.to])
  useEffect(() => {
    const timer = setTimeout(() => { if (search !== (filters.search ?? '')) onFiltersChange({ search: search || undefined, page: 1 }) }, 300)
    return () => clearTimeout(timer)
  }, [search, filters.search, onFiltersChange])
  const suggestions = useMemo(() => [
    ...recentSearches.map((value) => ({ value, label: value, group: 'Recent Searches' })),
    ...options.domains.filter((value) => search && value.toLowerCase().includes(search.toLowerCase())).map((value) => ({ value, label: value, group: 'Domains' })),
    ...options.actions.filter((value) => search && value.toLowerCase().includes(search.toLowerCase())).map((value) => ({ value, label: value, group: 'Actions' })),
  ], [search, recentSearches, options])
  function savePreset() {
    if (!name.trim()) return
    addSavedPreset({ id: crypto.randomUUID(), name: name.trim(), filters: { ...filters }, createdAt: new Date().toISOString() })
    setName(''); setSaveOpen(false)
  }
  function rename() { if (editing && editName.trim()) { updateSavedPreset(editing, { name: editName.trim() }); setEditing(null); setEditName('') } }
  function dateChange(key: 'from' | 'to', value: string) {
    const next = { ...dates, [key]: value }; setDates(next)
    if (next.from && next.to) onFiltersChange(auditCalendarRange(next.from, next.to))
    else if (!value) onFiltersChange({ from: undefined, to: undefined, page: 1 })
  }
  return <>
    <FilterBar label="Audit filters" activeCount={auditActiveFilters(filters)} onClearAll={onReset}
      search={<Combobox label="Search audit events" hideLabel size="sm" data-audit-search-input placeholder="Search ID, actor, domain, action... (Ctrl+K)" options={suggestions} filter={false} value={null} inputValue={search} onInputChange={setSearch}
        onSelect={(value) => { setSearch(value); addRecentSearch(value); onFiltersChange({ search: value, page: 1 }) }} />}>
      <MultiSelect label="Domain" size="sm" options={choices(options.domains, filters.domain)} value={filters.domain ?? []} onChange={(value) => onFiltersChange({ domain: value, page: 1 })} />
      <MultiSelect label="Action" size="sm" options={choices(options.actions, filters.action)} value={filters.action ?? []} onChange={(value) => onFiltersChange({ action: value, page: 1 })} />
      <TextField label="Actor ID" size="sm" value={filters.actorId ?? ''} maxLength={100} clearable onChange={(value) => onFiltersChange({ actorId: value.trim() || undefined, page: 1 })} />
      <MultiSelect label="Resource Type" size="sm" options={choices(options.resourceTypes, filters.resourceType)} value={filters.resourceType ?? []} onChange={(value) => onFiltersChange({ resourceType: value, page: 1 })} />
      <Select label="Time Range" size="sm" value={period} options={[{ value: '', label: 'All time' }, ...TIME_RANGE_PRESETS]} onChange={(value) => {
        setPeriod(value); setShowRange(value === 'custom'); const next = auditTimePreset(value); if (next) onFiltersChange(next)
      }} />
      {showRange && <><DateField label="Start date" size="sm" value={dates.from} max={dates.to || undefined} onChange={(value) => dateChange('from', value)} /><DateField label="End date" size="sm" value={dates.to} min={dates.from || undefined} onChange={(value) => dateChange('to', value)} /></>}
      <Menu trigger={<Button size="sm" icon={<IconFolder size={16} />}>Presets {savedPresets.length ? `(${savedPresets.length})` : ''}</Button>}>
        {savedPresets.map((preset) => <MenuItem key={preset.id} onSelect={() => onFiltersChange({ ...preset.filters })}>{preset.name}</MenuItem>)}
        {savedPresets.length > 0 && <MenuSeparator />}
        <MenuItem onSelect={() => setSaveOpen(true)}>Save current filters</MenuItem>
        <MenuItem onSelect={() => setManageOpen(true)}>Manage presets</MenuItem>
      </Menu>
    </FilterBar>
    <Dialog title="Save filter preset" open={saveOpen} onOpenChange={(open) => { setSaveOpen(open); if (!open) setName('') }} initialFocus={nameInput}
      footer={<div className={styles.actions}><Button onClick={() => { setSaveOpen(false); setName('') }}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={savePreset}>Save</Button></div>}>
      <TextField ref={nameInput} label="Preset name" value={name} onChange={setName} placeholder="Last 7 days — payments" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); savePreset() } }} />
    </Dialog>
    <Dialog title="Manage presets" open={manageOpen} onOpenChange={(open) => { setManageOpen(open); if (!open) { setEditing(null); setEditName('') } }}>
      {savedPresets.length === 0 ? <EmptyState title="No saved presets" description="Save current filters from the Presets menu." /> : <div className={styles.stack}>
        {savedPresets.map((preset) => <div className={styles.row} key={preset.id}>
          {editing === preset.id ? <><TextField label="Preset name" value={editName} onChange={setEditName} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); rename() } }} />
            <div className={styles.actions}><Button size="sm" variant="primary" disabled={!editName.trim()} onClick={rename}>Save</Button><Button size="sm" onClick={() => { setEditing(null); setEditName('') }}>Cancel</Button></div>
          </> : <><span className={styles.name}>{preset.name}</span><div className={styles.actions}>
            <Button size="sm" aria-label={`Rename ${preset.name}`} onClick={() => { setEditing(preset.id); setEditName(preset.name) }}>Rename</Button>
            <Button size="sm" variant="danger" aria-label={`Delete ${preset.name}`} onClick={() => { removeSavedPreset(preset.id); if (editing === preset.id) { setEditing(null); setEditName('') } }}>Delete</Button>
          </div></>}
        </div>)}
      </div>}
    </Dialog>
  </>
}
