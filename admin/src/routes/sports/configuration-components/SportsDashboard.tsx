import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useQuery, useMutation, useApolloClient } from '@apollo/client'
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { IconSettings, IconSearch, IconGripVertical, IconBallFootball } from '@tabler/icons-react'
import { LIST_SPORTS, SPORT_SETTINGS, UPSERT_SPORT_SETTINGS, SET_SPORT_STATUS, REORDER_SPORTS, LIST_EXISTING_LEAGUES, LIST_EXISTING_EVENTS, LIST_LEAGUES, LIST_EVENTS, SEARCH_SPORTS_HIERARCHY } from '@/lib/graphql/sports'
import { useVIPTiers } from '@/modules/vip/hooks/useVIP'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useSportsScopeStore } from '@/state/sportsScopeStore'
import { useSportsConfigStore } from '@/state/sportsConfigStore'
import { Button } from '@/ui/components/Button'
import { IconButton } from '@/ui/components/IconButton'
import { Checkbox } from '@/ui/components/Checkbox'
import { Card } from '@/ui/components/Card'
import { Drawer } from '@/ui/components/Drawer'
import { Popover } from '@/ui/components/Popover'
import { Combobox } from '@/ui/components/Combobox'
import { TextField } from '@/ui/components/TextField'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { Notice } from '@/ui/components/Notice'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import { Table, THead, TBody, TH, TR, TD } from '@/ui/components/Table'
import { LeaguesDashboard } from './LeaguesDashboard'
import { EventsDashboard } from './EventsDashboard'
import { MarketsDashboard } from './MarketsDashboard'
import { SettingsEditor } from './SettingsEditor'
import { useSettingsForm } from './useSettingsForm'
import { CATALOGUE_READ_ONLY_NOTE, useCanEditCatalogue } from './catalogueAccess'
import { hydrateSettings, valuesForVisitedTabs, tabsFor, tabFields, limitErrors, tabOfField, type ConfigValues, type SettingsTab, type SportRecord, type LeagueRecord, type EventRecord } from './settingsModel'
import styles from './SportsConfiguration.module.css'
const EMPTY_SPORTS: SportRecord[] = []
const assets = import.meta.glob('/src/assets/images/sports/*.png', { eager: true, import: 'default' }) as Record<string, string>
function SportImage({ row }: { row: SportRecord }) {
  const [failed, setFailed] = useState(false)
  const key = (row.name || row.key).toLowerCase().replace(/\s+/g,'-')
  const source = assets['/src/assets/images/sports/' + key + '.png']
  return <span className={styles.thumb}>{source && !failed ? <img src={source} alt={row.name || row.key} onError={() => setFailed(true)} /> : <IconBallFootball size={20} aria-hidden="true" />}</span>
}
function SportLeaguesCount({ sportId }: { sportId: string }) {
  const { data, loading } = useQuery<{ existingLeagueCodes: string[] }>(LIST_EXISTING_LEAGUES, { variables: { sportId }, errorPolicy: 'all' })
  return <span>{loading ? '…' : data?.existingLeagueCodes?.length || 0} leagues</span>
}
function SportEventsCount({ sportId }: { sportId: string }) {
  const { data, loading } = useQuery<{ existingLeagueCodes: string[] }>(LIST_EXISTING_LEAGUES, { variables: { sportId }, errorPolicy: 'all' })
  const client = useApolloClient(); const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    async function run() {
      const leagues = data?.existingLeagueCodes || []
      if (!leagues.length) { setCount(0); return }
      try {
        const results = await Promise.all(leagues.slice(0,20).map(leagueCode => client.query<{ existingEventCodes: string[] }>({ query: LIST_EXISTING_EVENTS, variables: { leagueCode }, fetchPolicy: 'network-only' })))
        if (!cancelled) setCount(results.reduce((sum,r) => sum + (r.data?.existingEventCodes?.length || 0),0))
      } catch { if (!cancelled) setCount(0) }
    }
    if (!loading) void run()
    return () => { cancelled = true }
  }, [loading,data,client])
  return <span>{loading || count === null ? '…' : count} events</span>
}
function SportStakeLimitsCell({ sportId }: { sportId: string }) {
  const { data, loading } = useQuery<{ sportSettings?: ConfigValues }>(SPORT_SETTINGS, { variables: { sportId, tierId: null }, errorPolicy: 'all' })
  const s = data?.sportSettings; const value = (key: string) => s?.[key] == null ? '—' : String(s[key])
  return <div className={styles.cell}>{loading ? 'Loading…' : <><span>Ex {value('exchangeMinStake')}–{value('exchangeMaxStake')}</span><span>Bk {value('bookmakerMinStake')}–{value('bookmakerMaxStake')}</span><span>Fn {value('fancyMinStake')}–{value('fancyMaxStake')}</span></>}</div>
}
interface RowProps { row: SportRecord; selected: boolean; toggle: () => void; edit: () => void; navigate: () => void; canReorder: boolean }
function SortableSportRow({ row, selected, toggle, edit, navigate, canReorder }: RowProps) {
  const { formatDateTime } = useFormatDate()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !canReorder })
  const dragStyle: CSSProperties = { transform: CSS.Transform.toString(transform), transition, userSelect: 'none', opacity: isDragging ? .7 : 1 }
  return <TR ref={setNodeRef} style={dragStyle} className={styles.dragRow} data-dragging={isDragging}>
    <TD><Checkbox label={'Select ' + row.name} hideLabel checked={selected} onChange={toggle} /></TD>
    <TD><div className={styles.priority}>{canReorder && <IconButton ref={setActivatorNodeRef} label={'Reorder ' + row.name} icon={<IconGripVertical size={16} />} className={styles.dragHandle} {...attributes} {...listeners} />}<span>{row.sort ?? '—'}</span></div></TD>
    <TD><div className={styles.actions}><SportImage row={row} /><div><button type="button" className={styles.link} onClick={navigate}>{row.name || row.key}</button><p className={styles.secondary}>{row.key}</p></div></div></TD>
    <TD><div className={styles.cell}><StatusPill tone={String(row.status).toUpperCase() === 'ACTIVE' ? 'ok' : 'neutral'}>{String(row.status).toUpperCase() || '—'}</StatusPill><span className={styles.secondary}>Updated: {row.updatedAt ? formatDateTime(row.updatedAt) : '—'}</span></div></TD>
    <TD><SportStakeLimitsCell sportId={row.id} /></TD>
    <TD><div className={styles.cell}><SportLeaguesCount sportId={row.id} /><SportEventsCount sportId={row.id} /><span className={styles.secondary}>Exposure: —</span></div></TD>
    <TD><div className={styles.cell}><span>—</span><span className={styles.secondary}>Bets: —</span><span className={styles.secondary}>Win rate: —</span><span className={styles.secondary}>Avg stake: —</span></div></TD>
    <TD><IconButton label={'Edit ' + row.name} icon={<IconSettings size={16} />} onClick={edit} /></TD>
  </TR>
}
interface HierarchyResult { type: string; sportId: string; sportName: string; leagueId?: string; leagueName?: string; eventId?: string; eventName?: string }
export function SportsDashboard() {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'bulk'|'single'>('bulk')
  const [drawerSport, setDrawerSport] = useState<SportRecord | null>(null)
  // A single edit holds the sport's status; a bulk edit starts at null, keeping each sport's own.
  const [drawerActive, setDrawerActive] = useState<boolean | null>(null)
  const canEditCatalogue = useCanEditCatalogue()
  const [tab, setTab] = useState<SettingsTab>('stake')
  const [visited, setVisited] = useState<Set<SettingsTab>>(new Set(['stake']))
  const [errorMessage, setErrorMessage] = useState('')
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false); const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const { form, methods } = useSettingsForm({ mode: 'overwrite', tier: 'default' })
  const watchTier = typeof form.values.tier === 'string' ? form.values.tier : 'default'
  const { data: qdata, loading, error } = useQuery<{ sports: SportRecord[] }>(LIST_SPORTS, { errorPolicy: 'all' })
  const sports = qdata?.sports || EMPTY_SPORTS
  const [rows, setRows] = useState<SportRecord[]>([])
  useEffect(() => { setRows([...sports].sort((a,b) => (a.sort ?? 999) - (b.sort ?? 999))) }, [sports])
  const search = useSportsConfigStore(s => s.search); const setSearch = useSportsConfigStore(s => s.setSearch)
  const filtered = useMemo(() => rows.filter(s => !search || [s.name || '',s.key || '',s.id].some(v => v.toLowerCase().includes(search.toLowerCase()))).sort((a,b) => (a.sort ?? 999) - (b.sort ?? 999)), [rows,search])
  const total = filtered.length; const allSelected = selectedKeys.size > 0 && selectedKeys.size === total
  const toggleAll = () => setSelectedKeys(allSelected ? new Set() : new Set(filtered.map(row => String(row.id))))
  function toggle(id: string) { setSelectedKeys(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  const { getCurrencySymbol } = useCurrency()
  const { data: vipData } = useVIPTiers()
  const tiers = useMemo(() => [{ label: 'Default', value: 'default' }, ...(vipData?.vipTiers || []).map(t => ({ label: t.name, value: String(t.id) }))], [vipData])
  const [mutateStatus] = useMutation(SET_SPORT_STATUS)
  const [upsertSettings, { loading: savingRequest }] = useMutation(UPSERT_SPORT_SETTINGS)
  const [pending, setPending] = useState(false); const submitRef = useRef(false)
  const saving = savingRequest || pending
  const [reorderSports] = useMutation(REORDER_SPORTS, { refetchQueries: [{ query: LIST_SPORTS }] })
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  function dragEnd({ active,over }: DragEndEvent) {
    if (!canEditCatalogue || !over || active.id === over.id) return
    const from = filtered.findIndex(row => row.id === active.id); const to = filtered.findIndex(row => row.id === over.id)
    if (from < 0 || to < 0) return
    const next = arrayMove(filtered,from,to).map((row,index) => ({ ...row,sort:index+1 }))
    setRows(next); void reorderSports({ variables: { inputs: next.map(row => ({ id:row.id,sort:row.sort })) }, context: { uiToast:'message' } }).catch(() => {})
  }
  const { data: settingsData, loading: settingsLoading, refetch: refetchSettings } = useQuery<{ sportSettings?: ConfigValues }>(SPORT_SETTINGS, { variables: { sportId:drawerSport?.id,tierId:watchTier !== 'default' ? watchTier : null }, skip: !(drawerOpen && drawerMode === 'single' && drawerSport?.id), fetchPolicy:'cache-and-network', errorPolicy:'all', notifyOnNetworkStatusChange:true })
  useEffect(() => { if (drawerOpen && drawerMode === 'single' && drawerSport?.id) void refetchSettings({ sportId:drawerSport.id,tierId:watchTier !== 'default' ? watchTier : null }) }, [drawerOpen,drawerMode,drawerSport?.id,watchTier,refetchSettings])
  useEffect(() => {
    if (settingsData?.sportSettings) methods.hydrate(hydrateSettings(settingsData.sportSettings,'sport'))
    else if (drawerOpen && drawerMode === 'single') methods.clear(tabsFor('sport').flatMap(t => tabFields[t]))
  }, [settingsData,drawerOpen,drawerMode,methods])
  useEffect(() => { if (drawerOpen) { setTab('stake'); setVisited(new Set(['stake'])); setErrorMessage('') } }, [drawerOpen])
  const { scope,setScope,selectedSportId,setSportId,selectedLeagueId,setLeagueId,selectedEventId,setEventId } = useSportsScopeStore()
  const { data: leagueData } = useQuery<{ leagues:LeagueRecord[] }>(LIST_LEAGUES, { variables:{sportId:selectedSportId || ''},skip:!selectedSportId || (scope !== 'events' && scope !== 'markets'),fetchPolicy:'cache-and-network',errorPolicy:'all' })
  const { data: eventData } = useQuery<{ events:EventRecord[] }>(LIST_EVENTS, { variables:{leagueId:selectedLeagueId || ''},skip:!selectedLeagueId || scope !== 'markets',errorPolicy:'all' })
  const { data: searchData,loading:searchLoading } = useQuery<{ searchSportsHierarchy:HierarchyResult[] }>(SEARCH_SPORTS_HIERARCHY,{variables:{input:{query:globalSearchQuery.trim(),limit:25}},skip:!globalSearchOpen || globalSearchQuery.trim().length<2,errorPolicy:'all'})
  const results = searchData?.searchSportsHierarchy || []
  // The four lists share one search box, so the text typed to find an event stayed in the box after
  // drilling into its markets, which then read "No markets found for this event". Moving to another scope
  // starts with an empty search; a global search result is the one move that sets the text on purpose.
  const searchForNextScope = useRef<string | null>(null); const shownScope = useRef(scope)
  useEffect(() => {
    if (shownScope.current === scope) return
    shownScope.current = scope; setSearch(searchForNextScope.current ?? ''); searchForNextScope.current = null
  }, [scope, setSearch])
  function resultSelect(row:HierarchyResult) {
    const text = row.type === 'sport' ? row.sportName : row.type === 'league' ? row.leagueName || '' : row.eventName || ''
    // Only a pick that moves to another scope hands its text over: on the scope already shown the effect
    // above does not run, so a kept text would reach the next drill-down (Sports > Cricket > its leagues).
    const target = row.type === 'sport' ? 'sports' : row.type === 'league' && row.leagueId ? 'leagues' : row.type === 'event' && row.eventId ? 'events' : null
    searchForNextScope.current = target !== null && target !== scope ? text : null
    if (row.type === 'sport') { setScope('sports');setSportId(undefined);setLeagueId(undefined);setEventId(undefined);setSearch(text) }
    else if (row.type === 'league' && row.leagueId) { setScope('leagues');setSportId(row.sportId);setLeagueId(undefined);setEventId(undefined);setSearch(text) }
    else if (row.type === 'event' && row.eventId) { setScope('events');setSportId(row.sportId);setLeagueId(row.leagueId);setEventId(undefined);setSearch(text) }
    setGlobalSearchQuery('');setGlobalSearchOpen(false)
  }
  async function status(active:boolean | null) {
    setDrawerActive(active)
    if (active === null || !canEditCatalogue || !drawerSport?.key || drawerMode !== 'single') return
    try { await mutateStatus({variables:{key:drawerSport.key,status:active?'active':'inactive'},context:{uiToast:'notification'}}) }
    catch (cause) { setErrorMessage(cause instanceof Error ? cause.message : 'Failed to update status') }
  }
  async function save() {
    if (submitRef.current) return
    const values = valuesForVisitedTabs(methods.values(),visited,'sport')
    // Contradicting stake or odds limits stop here, on their field, before anything is written.
    const refused = Object.keys(limitErrors(values))
    if (refused.length) { void methods.validate(refused); const at = tabOfField(refused[0]); if (at) setTab(at); return }
    submitRef.current = true; setPending(true)
    const sportIds = drawerMode === 'single' && drawerSport?.id ? [drawerSport.id] : Array.from(selectedKeys)
    const { mode,tier,...payload } = values
    setErrorMessage('')
    try {
      // A single edit's switch already wrote the status; a bulk edit writes one only when chosen.
      if (drawerMode === 'bulk' && canEditCatalogue && drawerActive !== null) {
        const keyById = Object.fromEntries(filtered.map(row => [String(row.id),String(row.key)]))
        const keys = sportIds.map(id => keyById[id]).filter(Boolean)
        if (keys.length) await Promise.all(keys.map(key => mutateStatus({variables:{key,status:drawerActive?'active':'inactive'},context:{uiToast:'notification'}})))
      }
      const result = await upsertSettings({variables:{input:{sportIds,tierId:tier && tier !== 'default' ? tier : null,mode:mode || 'overwrite',...payload}},context:{uiToast:'notification'}})
      if (!result.data?.upsertSportSettings?.success) throw new Error(result.data?.upsertSportSettings?.message || 'Failed to save sport settings')
      setDrawerOpen(false)
    } catch (cause) { setErrorMessage(cause instanceof Error ? cause.message : 'Failed to save sport settings') }
    finally { submitRef.current = false; setPending(false) }
  }
  const controls = <div className={styles.stack}><div className={styles.actions}>
    <Popover open={globalSearchOpen} onOpenChange={open => { setGlobalSearchOpen(open);if(!open)setGlobalSearchQuery('') }} label="Global search" trigger={<IconButton label="Global search" icon={<IconSearch size={16} />} />} placement="bottom-start">
      <div className={styles.stack}><TextField label="Search sports, leagues, events" value={globalSearchQuery} onChange={setGlobalSearchQuery} clearable placeholder="Search sports, leagues, events..." /><div className={styles.searchResults}>{globalSearchQuery.trim().length<2 ? <p className={styles.secondary}>Type at least 2 characters</p> : searchLoading ? <LoadingState label="Searching hierarchy" /> : results.length ? results.map((r,i) => <Button key={r.type+'-'+r.sportId+'-'+i} className={styles.searchResult} onClick={() => resultSelect(r)}>{r.type === 'sport' ? r.sportName + ' · Sport' : r.type === 'league' ? r.leagueName + ' · ' + r.sportName : r.eventName + ' · ' + r.leagueName}</Button>) : <p className={styles.secondary}>No results</p>}</div></div>
    </Popover>
    <SegmentedControl label="Scope selector" value={scope} onChange={setScope} options={[{value:'sports',label:'Sports'},{value:'leagues',label:'Leagues'},{value:'events',label:'Events'},{value:'markets',label:'Markets'}]} />
    </div>{scope !== 'sports' && <div className={styles.actions}><Combobox label="Sport" value={selectedSportId || null} onChange={value => setSportId(value || undefined)} options={sports.map(row => ({label:row.name,value:row.id}))} placeholder="Select sport..." />{(scope === 'events' || scope === 'markets') && <Combobox label="League" value={selectedLeagueId || null} onChange={value => setLeagueId(value || undefined)} options={(leagueData?.leagues || []).map(row => ({label:row.name,value:row.id}))} placeholder="Select league..." />}{scope === 'markets' && <Combobox label="Event" value={selectedEventId || null} onChange={value => setEventId(value || undefined)} options={(eventData?.events || []).map(row => ({label:row.name,value:row.id}))} placeholder="Select event..." />}</div>}
    {!canEditCatalogue && <Notice>{CATALOGUE_READ_ONLY_NOTE}</Notice>}
    {scope !== 'sports' && <nav aria-label="Sports hierarchy" className={styles.actions}><Button variant="link" size="sm" onClick={() => setScope('sports')}>Sports</Button>{selectedSportId && <Button variant="link" size="sm" onClick={() => {setScope('leagues');setLeagueId(undefined);setEventId(undefined)}}>{sports.find(row => row.id===selectedSportId)?.name || 'Sport'}</Button>}{selectedLeagueId && (scope === 'events' || scope === 'markets') && <Button variant="link" size="sm" onClick={() => {setScope('events');setEventId(undefined)}}>{leagueData?.leagues.find(row => row.id===selectedLeagueId)?.name || 'League'}</Button>}{scope === 'markets' && selectedEventId && <span className={styles.secondary}>{eventData?.events.find(row => row.id===selectedEventId)?.name || 'Event'}</span>}</nav>}
  </div>
  return <div className={styles.stack}>{controls}
    {scope === 'leagues' ? <LeaguesDashboard /> : scope === 'events' ? <EventsDashboard /> : scope === 'markets' ? <MarketsDashboard /> : <>
      <Card title="Sports Management" sub="Configure and monitor sports across global markets" body="table" tools={<div className={styles.actions}><TextField label="Search sports" hideLabel value={search} onChange={setSearch} clearable placeholder="Search sports..." />{selectedKeys.size > 0 ? <><StatusPill>{selectedKeys.size} selected</StatusPill><Button variant="primary" size="sm" onClick={() => {setDrawerMode('bulk');setDrawerSport(null);setDrawerActive(null);setDrawerOpen(true)}}>Update Settings</Button><Button size="sm" onClick={() => setSelectedKeys(new Set())}>Clear</Button></> : <p className={styles.secondary}>Select one or more sports to update settings</p>}</div>}>
        {error && <Notice tone="error" title="Failed to load sports">{error.message}</Notice>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={dragEnd}><Table caption="Sports" width="wide"><THead><TR><TH><Checkbox label="Select all" hideLabel checked={allSelected} indeterminate={selectedKeys.size>0 && !allSelected} onChange={toggleAll} /></TH>{['Priority','Sport Details','Status','Stake Limits','Markets & Exposure','Performance','Actions'].map(label => <TH key={label}>{label}</TH>)}</TR></THead><TBody><SortableContext items={filtered.map(row => row.id)} strategy={verticalListSortingStrategy}>{loading ? <TR><TD colSpan={8}><LoadingState label="Loading sports" /></TD></TR> : filtered.length ? filtered.map(row => <SortableSportRow key={row.id} row={row} selected={selectedKeys.has(String(row.id))} toggle={() => toggle(String(row.id))} edit={() => {setDrawerMode('single');setDrawerSport(row);setDrawerActive(String(row.status || 'active').toLowerCase()==='active');setDrawerOpen(true)}} navigate={() => {setSportId(String(row.id));setScope('leagues')}} canReorder={canEditCatalogue} />) : <TR><TD colSpan={8}><EmptyState title="No sports found" /></TD></TR>}</SortableContext></TBody></Table></DndContext>
      </Card>
      <Drawer title={drawerMode==='single'?'Edit Sport Settings':'Bulk Update Sport Settings'} open={drawerOpen} onOpenChange={open => {if(!open && !saving)setDrawerOpen(false)}} dismissible={!saving} size="lg" footer={<><Button disabled={saving} onClick={() => methods.reset()}>Reset</Button><Button disabled={saving} onClick={() => setDrawerOpen(false)}>Cancel</Button><Button variant="primary" loading={saving} disabled={settingsLoading || (drawerMode==='bulk' && selectedKeys.size===0)} onClick={() => void save()}>Apply Changes</Button></>}>
        <div className={styles.stack}><p className={styles.secondary}>{drawerMode==='single'?'Editing: '+(drawerSport?.name || drawerSport?.key):'Bulk Update ('+selectedKeys.size+' sports): '+sports.filter(row=>selectedKeys.has(String(row.id))).map(row=>row.name || row.key).join(', ')}</p>
        <SettingsEditor form={form} variant="sport" tab={tab} onTab={value => {setTab(value);setVisited(prev => new Set([...prev,value]))}} tier={watchTier} onTier={value => form.setValue('tier',value)} tiers={tiers} currencySymbol={getCurrencySymbol()} active={drawerActive} onActive={value => void status(value)} canEditStatus={canEditCatalogue} bulk={drawerMode==='bulk'} busy={saving || settingsLoading} />
        {errorMessage && <Notice tone="error" live="assertive">{errorMessage}</Notice>}
        </div>
      </Drawer>
    </>}
  </div>
}
