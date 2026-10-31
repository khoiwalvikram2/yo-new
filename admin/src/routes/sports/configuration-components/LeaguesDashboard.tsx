import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useQuery, useMutation, useApolloClient } from '@apollo/client'
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { IconSettings, IconGripVertical } from '@tabler/icons-react'
import { LIST_LEAGUES, LIST_EVENTS, LEAGUE_SETTINGS, UPSERT_LEAGUE_SETTINGS, SET_LEAGUE_STATUS, LIST_MARKETS, REORDER_LEAGUES } from '@/lib/graphql/sports'
import { useSportsScopeStore } from '@/state/sportsScopeStore'
import { useSportsConfigStore } from '@/state/sportsConfigStore'
import { useVIPTiers } from '@/modules/vip/hooks/useVIP'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { IconButton } from '@/ui/components/IconButton'
import { Checkbox } from '@/ui/components/Checkbox'
import { Card } from '@/ui/components/Card'
import { Drawer } from '@/ui/components/Drawer'
import { TextField } from '@/ui/components/TextField'
import { Notice } from '@/ui/components/Notice'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import { Table, THead, TBody, TH, TR, TD } from '@/ui/components/Table'
import { SettingsEditor } from './SettingsEditor'
import { useSettingsForm } from './useSettingsForm'
import { hydrateSettings, valuesForVisitedTabs, type ConfigValues, type SettingsTab, type LeagueRecord, type EventRecord } from './settingsModel'
import styles from './SportsConfiguration.module.css'
const EMPTY: LeagueRecord[] = []; const EMPTY_EVENTS: EventRecord[] = []
function LeagueStakeLimitsCell({ leagueId }: { leagueId:string }) {
  const { data,loading } = useQuery<{ leagueSettings?:ConfigValues }>(LEAGUE_SETTINGS,{variables:{leagueId,tierId:null},errorPolicy:'all'})
  const s=data?.leagueSettings; const value=(key:string)=>s?.[key]==null?'—':String(s[key])
  return <div className={styles.cell}>{loading?'Loading…':<><span>Ex {value('exchangeMinStake')}–{value('exchangeMaxStake')}</span><span>Bk {value('bookmakerMinStake')}–{value('bookmakerMaxStake')}</span><span>Fn {value('fancyMinStake')}–{value('fancyMaxStake')}</span></>}</div>
}
function LeagueEventsCount({ leagueId }: { leagueId:string }) {
  const {data,loading}=useQuery<{events:EventRecord[]}>(LIST_EVENTS,{variables:{leagueId},errorPolicy:'all'})
  return <span>{loading?'…':data?.events?.length || 0} events</span>
}
function LeagueMarketsCount({ leagueId }: { leagueId:string }) {
  const {data,loading}=useQuery<{events:EventRecord[]}>(LIST_EVENTS,{variables:{leagueId},errorPolicy:'all'})
  const events=data?.events || EMPTY_EVENTS; const client=useApolloClient()
  const [count,setCount]=useState<number|null>(null); const [fetching,setFetching]=useState(false)
  useEffect(()=>{
    let cancelled=false
    if (loading || !events.length) {setCount(events.length===0?0:null);return}
    setFetching(true)
    void Promise.all(events.slice(0,50).map(e=>client.query<{marketsByEvent:unknown[]}>({query:LIST_MARKETS,variables:{eventId:e.id},fetchPolicy:'cache-first',errorPolicy:'all'}))).then(results=>{if(!cancelled){setCount(results.reduce((sum,r)=>sum+(r.data?.marketsByEvent?.length || 0),0));setFetching(false)}}).catch(()=>{if(!cancelled){setCount(0);setFetching(false)}})
    return ()=>{cancelled=true}
  },[loading,events,client])
  return <span>{loading || fetching || count===null?'…':count} markets</span>
}
interface RowProps { row:LeagueRecord;index:number;selected:boolean;toggle:()=>void;edit:()=>void;navigate:()=>void }
function SortableLeagueRow({row,index,selected,toggle,edit,navigate}:RowProps) {
  const {formatDateTime}=useFormatDate()
  const {attributes,listeners,setNodeRef,setActivatorNodeRef,transform,transition,isDragging}=useSortable({id:row.id})
  const style:CSSProperties={transform:CSS.Transform.toString(transform),transition,userSelect:'none',opacity:isDragging ? .7 : 1}
  return <TR ref={setNodeRef} style={style} className={styles.dragRow} data-dragging={isDragging}><TD><Checkbox label={'Select '+row.name} hideLabel checked={selected} onChange={toggle}/></TD><TD><div className={styles.priority}><IconButton ref={setActivatorNodeRef} label={'Reorder '+row.name} icon={<IconGripVertical size={16}/>} className={styles.dragHandle} {...attributes} {...listeners}/><span>{row.sort??index+1}</span></div></TD><TD><button type="button" className={styles.link} onClick={navigate}>{row.name}</button></TD><TD><div className={styles.cell}><StatusPill tone={String(row.status).toUpperCase()==='ACTIVE'?'ok':'neutral'}>{String(row.status || '—').toUpperCase()}</StatusPill><span className={styles.secondary}>Updated: {row.updatedAt?formatDateTime(row.updatedAt,'MMM d, yyyy HH:mm'):'—'}</span></div></TD><TD><LeagueStakeLimitsCell leagueId={row.id}/></TD><TD><div className={styles.cell}><LeagueEventsCount leagueId={row.id}/><LeagueMarketsCount leagueId={row.id}/></div></TD><TD><div className={styles.cell}><span>—</span><span className={styles.secondary}>Bets: —</span><span className={styles.secondary}>Win rate: —</span><span className={styles.secondary}>Avg stake: —</span></div></TD><TD><IconButton label={'Edit '+row.name} icon={<IconSettings size={16}/>} onClick={edit}/></TD></TR>
}
export function LeaguesDashboard() {
  const {selectedSportId,setScope,setLeagueId}=useSportsScopeStore()
  const search=useSportsConfigStore(s=>s.search);const setSearch=useSportsConfigStore(s=>s.setSearch)
  const [selectedKeys,setSelectedKeys]=useState<Set<string>>(new Set())
  const [drawerOpen,setDrawerOpen]=useState(false);const [drawerLeague,setDrawerLeague]=useState<LeagueRecord|null>(null);const [drawerActive,setDrawerActive]=useState(true)
  const [tier,setTier]=useState('default');const [tab,setTab]=useState<SettingsTab>('stake');const [visited,setVisited]=useState<Set<SettingsTab>>(new Set(['stake']))
  const [message,setMessage]=useState('');const {form,methods}=useSettingsForm()
  const {getCurrencySymbol}=useCurrency();const {data:vip}=useVIPTiers()
  const tiers=useMemo(()=>[{label:'Default',value:'default'},...(vip?.vipTiers || []).map(t=>({label:t.name,value:t.id}))],[vip])
  const {data,loading,error,refetch}=useQuery<{leagues:LeagueRecord[]}>(LIST_LEAGUES,{variables:{sportId:selectedSportId || ''},skip:!selectedSportId,errorPolicy:'all'})
  const raw=data?.leagues || EMPTY;const [rows,setRows]=useState<LeagueRecord[]>([])
  useEffect(()=>{setRows([...raw].sort((a,b)=>(a.sort || 999)-(b.sort || 999)))},[raw])
  const filtered=useMemo(()=>rows.filter(row=>!search || [row.name || '',row.id].some(value=>value.toLowerCase().includes(search.toLowerCase()))),[rows,search])
  const allSelected=selectedKeys.size>0 && selectedKeys.size===filtered.length
  const toggleAll=()=>setSelectedKeys(allSelected?new Set():new Set(filtered.map(row=>String(row.id))))
  function toggle(id:string){setSelectedKeys(prev=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next})}
  const [setStatus]=useMutation(SET_LEAGUE_STATUS);const [upsert,{loading:savingRequest}]=useMutation(UPSERT_LEAGUE_SETTINGS)
  const [pending,setPending]=useState(false);const submitRef=useRef(false)
  const saving=savingRequest || pending
  const [reorder]=useMutation(REORDER_LEAGUES,{refetchQueries:[{query:LIST_LEAGUES,variables:{sportId:selectedSportId || ''}}]})
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:5}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}))
  function dragEnd({active,over}:DragEndEvent) {
    if(!over || active.id===over.id)return
    const from=rows.findIndex(row=>row.id===active.id);const to=rows.findIndex(row=>row.id===over.id)
    if(from<0 || to<0)return
    const next=arrayMove(rows,from,to).map((row,index)=>({...row,sort:index+1}))
    setRows(next);void reorder({variables:{inputs:next.map((row,index)=>({id:row.id,sort:row.sort || index+1}))},context:{uiToast:'message'}}).catch(()=>{})
  }
  const {data:settings,loading:settingsLoading,refetch:refetchSettings}=useQuery<{leagueSettings?:ConfigValues}>(LEAGUE_SETTINGS,{variables:{leagueId:drawerLeague?.id,tierId:tier!=='default'?tier:null},skip:!(drawerOpen && drawerLeague?.id),fetchPolicy:'cache-and-network',errorPolicy:'all',notifyOnNetworkStatusChange:true})
  useEffect(()=>{if(settings?.leagueSettings && drawerOpen && drawerLeague?.id)methods.hydrate(hydrateSettings(settings.leagueSettings,'league'));else if(drawerOpen && !settings?.leagueSettings)methods.reset()},[settings,drawerOpen,drawerLeague?.id,methods])
  useEffect(()=>{if(drawerOpen){setTab('stake');setVisited(new Set(['stake']));setMessage('')}},[drawerOpen])
  async function active(value:boolean){setDrawerActive(value);if(!drawerLeague?.id)return;try{await setStatus({variables:{id:drawerLeague.id,status:value?'active':'inactive'},context:{uiToast:'notification'}})}catch(cause){setMessage(cause instanceof Error?cause.message:'Failed to update league status')}}
  async function save() {
    if(submitRef.current)return
    const leagueIds=drawerLeague?.id?[drawerLeague.id]:Array.from(selectedKeys)
    if(!leagueIds.length)return
    submitRef.current=true;setPending(true)
    const values=valuesForVisitedTabs(methods.values(),visited,'league')
    setMessage('')
    // Preserve the legacy status-first operation; its errors are reported by the Apollo link.
    try{await Promise.all(leagueIds.map(id=>setStatus({variables:{id,status:drawerActive?'active':'inactive'},context:{uiToast:'notification'}})))}catch{/* Original flow still proceeds with settings. */}
    try{
      const result=await upsert({variables:{leagueIds,input:{...values,tierId:tier!=='default'?tier:null}},context:{uiToast:'notification'}})
      if(!result.data?.upsertLeagueSettings?.success)throw new Error(result.data?.upsertLeagueSettings?.message || 'Failed to save league settings')
      setDrawerOpen(false);void refetch()
    }catch(cause){setMessage(cause instanceof Error?cause.message:'Failed to save league settings')}
    finally{submitRef.current=false;setPending(false)}
  }
  return <><Card title="Leagues Management" sub={selectedSportId?'Configure leagues for the selected sport':'Select a sport to manage its leagues'} body="table" tools={selectedSportId && <div className={styles.actions}><TextField label="Search leagues" hideLabel value={search} onChange={setSearch} clearable placeholder="Search leagues..."/>{selectedKeys.size>0?<><StatusPill>{selectedKeys.size} selected</StatusPill><Button variant="primary" size="sm" onClick={()=>{setDrawerLeague(null);setDrawerOpen(true)}}>Update Settings</Button><Button size="sm" onClick={()=>setSelectedKeys(new Set())}>Clear</Button></>:<p className={styles.secondary}>Select one or more leagues to update settings</p>}</div>}>
    {!selectedSportId?<Notice>Please choose a sport from the top controls or click the sport from the sports table.</Notice>:<>
      {error && <Notice tone="error" title="Failed to load leagues">{error.message}</Notice>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={dragEnd}><Table caption="Leagues" width="wide"><THead><TR><TH><Checkbox label="Select all" hideLabel checked={allSelected} indeterminate={selectedKeys.size>0 && !allSelected} onChange={toggleAll}/></TH>{['Priority','Leagues','Status','Stake Limits','Markets & Exposure','Performance','Actions'].map(label=><TH key={label}>{label}</TH>)}</TR></THead><TBody><SortableContext items={filtered.map(row=>row.id)} strategy={verticalListSortingStrategy}>{loading?<TR><TD colSpan={8}><LoadingState label="Loading leagues"/></TD></TR>:filtered.length?filtered.map((row,index)=><SortableLeagueRow key={row.id} row={row} index={index} selected={selectedKeys.has(String(row.id))} toggle={()=>toggle(String(row.id))} edit={()=>{setDrawerLeague(row);setDrawerActive(String(row.status || 'active').toLowerCase()==='active');setDrawerOpen(true)}} navigate={()=>{setLeagueId(row.id);setScope('events')}}/>):<TR><TD colSpan={8}><EmptyState title="No leagues found"/></TD></TR>}</SortableContext></TBody></Table></DndContext>
    </>}
  </Card><Drawer title={drawerLeague?'Edit League Settings':'Bulk Update League Settings ('+selectedKeys.size+')'} open={drawerOpen} onOpenChange={open=>{if(!open && !saving)setDrawerOpen(false)}} dismissible={!saving} size="lg" footer={<><Button disabled={saving} onClick={()=>methods.reset()}>Reset</Button><Button disabled={saving} onClick={()=>setDrawerOpen(false)}>Cancel</Button><Button variant="primary" loading={saving} disabled={settingsLoading} onClick={()=>void save()}>Apply Changes</Button></>}>
    <div className={styles.stack}><p className={styles.secondary}>{drawerLeague?'Editing: '+drawerLeague.name:'Selected leagues: '+filtered.filter(row=>selectedKeys.has(String(row.id))).map(row=>row.name).join(', ')}</p>
    <SettingsEditor form={form} variant="league" tab={tab} onTab={value=>{setTab(value);setVisited(prev=>new Set([...prev,value]))}} tier={tier} onTier={value=>{setTier(value);if(drawerLeague?.id)void refetchSettings({leagueId:drawerLeague.id,tierId:value!=='default'?value:null})}} tiers={tiers} currencySymbol={getCurrencySymbol()} active={drawerActive} onActive={value=>void active(value)} bulk={!drawerLeague} busy={saving || settingsLoading}/>
    {message && <Notice tone="error" live="assertive">{message}</Notice>}</div>
  </Drawer></>
}

