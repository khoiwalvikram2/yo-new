import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { IconSettings } from '@tabler/icons-react'
import { LIST_EVENTS, EVENT_SETTINGS, UPSERT_EVENT_SETTINGS, SET_EVENT_STATUS, LIST_MARKETS } from '@/lib/graphql/sports'
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
import { hydrateSettings,valuesForVisitedTabs,type ConfigValues,type SettingsTab,type EventRecord } from './settingsModel'
import styles from './SportsConfiguration.module.css'
const EMPTY:EventRecord[]=[]
function EventMarketsCount({eventId}:{eventId:string}) {
  const {data,loading}=useQuery<{marketsByEvent:unknown[]}>(LIST_MARKETS,{variables:{eventId},fetchPolicy:'cache-first'})
  return <span>{loading?'…':data?.marketsByEvent?.length || 0} markets</span>
}
function EventStakeLimitsCell({eventId}:{eventId:string}) {
  const {data,loading}=useQuery<{eventSettings?:ConfigValues}>(EVENT_SETTINGS,{variables:{eventId},fetchPolicy:'cache-first',errorPolicy:'all'})
  const s=data?.eventSettings;const value=(key:string)=>s?.[key]==null?'—':String(s[key])
  return <div className={styles.cell}>{loading?'Loading…':<><span>Ex {value('exchangeMinStake')}–{value('exchangeMaxStake')}</span><span>Bk {value('bookmakerMinStake')}–{value('bookmakerMaxStake')}</span><span>Fn {value('fancyMinStake')}–{value('fancyMaxStake')}</span></>}</div>
}
export function EventsDashboard() {
  const {formatDateTime}=useFormatDate()
  const {selectedLeagueId,setScope,setEventId}=useSportsScopeStore()
  const search=useSportsConfigStore(s=>s.search);const setSearch=useSportsConfigStore(s=>s.setSearch)
  const {getCurrencySymbol}=useCurrency()
  const [selectedKeys,setSelectedKeys]=useState<Set<string>>(new Set())
  const [drawerOpen,setDrawerOpen]=useState(false);const [drawerMode,setDrawerMode]=useState<'single'|'bulk'>('single');const [drawerEvent,setDrawerEvent]=useState<EventRecord|null>(null)
  const [drawerActive,setDrawerActive]=useState(true);const [tier,setTier]=useState('default');const [tab,setTab]=useState<SettingsTab>('stake');const [visited,setVisited]=useState<Set<SettingsTab>>(new Set(['stake']));const [message,setMessage]=useState('')
  const {form,methods}=useSettingsForm({mode:'overwrite'})
  const {data:vip}=useVIPTiers();const tiers=useMemo(()=>[{label:'Default',value:'default'},...(vip?.vipTiers || []).map(t=>({label:t.name,value:t.id}))],[vip])
  const {data,loading,error,refetch:refetchEvents}=useQuery<{events:EventRecord[]}>(LIST_EVENTS,{variables:{leagueId:selectedLeagueId || ''},skip:!selectedLeagueId,fetchPolicy:'cache-and-network',errorPolicy:'all',notifyOnNetworkStatusChange:true})
  const events=data?.events || EMPTY
  const filtered=useMemo(()=>events.filter(e=>!search || [e.name || '',e.id].some(value=>value.toLowerCase().includes(search.toLowerCase()))),[events,search])
  const {data:settings,loading:settingsLoading,refetch:refetchSettings}=useQuery<{eventSettings?:ConfigValues}>(EVENT_SETTINGS,{variables:{eventId:drawerEvent?.id,tierId:tier!=='default'?tier:null},skip:!(drawerOpen && drawerEvent?.id),fetchPolicy:'cache-and-network',errorPolicy:'all'})
  useEffect(()=>{if(drawerOpen && drawerEvent?.id)void refetchSettings({eventId:drawerEvent.id,tierId:tier!=='default'?tier:null})},[drawerOpen,drawerEvent?.id,tier,refetchSettings])
  useEffect(()=>{if(settings?.eventSettings && drawerOpen && drawerEvent?.id)methods.hydrate(hydrateSettings(settings.eventSettings,'event'));else if(drawerOpen && !settings?.eventSettings)methods.reset()},[settings,drawerOpen,drawerEvent?.id,methods])
  useEffect(()=>{if(drawerOpen){setTab('stake');setVisited(new Set(['stake']));setMessage('')}},[drawerOpen])
  const [upsert,{loading:savingRequest}]=useMutation(UPSERT_EVENT_SETTINGS);const [setStatus]=useMutation(SET_EVENT_STATUS)
  const [pending,setPending]=useState(false);const submitRef=useRef(false)
  const saving=savingRequest || pending
  const allSelected=selectedKeys.size>0 && selectedKeys.size===filtered.length
  const toggleAll=()=>setSelectedKeys(allSelected?new Set():new Set(filtered.map(e=>String(e.id))))
  function toggle(id:string){setSelectedKeys(prev=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next})}
  async function active(value:boolean) {
    setDrawerActive(value)
    if(!drawerEvent?.id || drawerMode!=='single')return
    try{await setStatus({variables:{id:drawerEvent.id,status:value?'active':'inactive'},context:{uiToast:'notification'}})}catch(cause){setMessage(cause instanceof Error?cause.message:'Failed to update event status')}
  }
  async function save() {
    if(submitRef.current)return
    const eventIds=drawerEvent?.id?[drawerEvent.id]:Array.from(selectedKeys)
    if(!eventIds.length)return
    submitRef.current=true;setPending(true)
    const payload=valuesForVisitedTabs(methods.values(),visited,'event')
    // The legacy event writer's allow-list excludes the visible Apply Mode control.
    delete payload.mode
    setMessage('')
    try {
      await Promise.all(eventIds.map(id=>setStatus({variables:{id,status:drawerActive?'active':'inactive'},context:{uiToast:'notification'}})))
      const result=await upsert({variables:{eventIds,input:{...payload,tierId:tier!=='default'?tier:null}},context:{uiToast:'notification'}})
      if(!result.data?.upsertEventSettings?.success)throw new Error(result.data?.upsertEventSettings?.message || 'Failed to save event settings')
      setDrawerOpen(false);await refetchEvents()
    } catch(cause){setMessage(cause instanceof Error?cause.message:'Failed to save event settings')}
    finally{submitRef.current=false;setPending(false)}
  }
  return <><Card title="Events Management" sub="Manage events for the selected league" body="table" tools={selectedLeagueId && <div className={styles.actions}><TextField label="Search events" hideLabel value={search} onChange={setSearch} clearable placeholder="Search events..."/>{selectedKeys.size>0?<><StatusPill>{selectedKeys.size} selected</StatusPill><Button variant="primary" size="sm" onClick={()=>{setDrawerMode('bulk');setDrawerEvent(null);setDrawerOpen(true)}}>Update Settings</Button><Button size="sm" onClick={()=>setSelectedKeys(new Set())}>Clear</Button></>:<p className={styles.secondary}>Select one or more events to update settings</p>}</div>}>
    {!selectedLeagueId?<Notice>Please choose a sport and league from the top controls or click the league from the leagues table.</Notice>:<>
      {error && <Notice tone="error" title="Failed to load events">{error.message}</Notice>}
      <Table caption="Events" width="wide"><THead><TR><TH><Checkbox label="Select all" hideLabel checked={allSelected} indeterminate={selectedKeys.size>0 && !allSelected} onChange={toggleAll}/></TH>{['Events','Status','Stake Limits','Markets & Exposure','Performance','Actions'].map(label=><TH key={label}>{label}</TH>)}</TR></THead><TBody>{loading?<TR><TD colSpan={7}><LoadingState label="Loading events"/></TD></TR>:filtered.length?filtered.map(row=><TR key={row.id}><TD><Checkbox label={'Select '+row.name} hideLabel checked={selectedKeys.has(String(row.id))} onChange={()=>toggle(String(row.id))}/></TD><TD><div className={styles.cell}><button type="button" className={styles.link} onClick={()=>{setEventId(row.id);setScope('markets')}}>{row.name}</button>{row.startTime && <span className={styles.secondary}>{formatDateTime(row.startTime,'MMM d, HH:mm')}</span>}</div></TD><TD><div className={styles.cell}><StatusPill tone={String(row.status).toUpperCase()==='ACTIVE'?'ok':'neutral'}>{String(row.status || '—').toUpperCase()}</StatusPill><span className={styles.secondary}>Updated: {row.updatedAt?formatDateTime(row.updatedAt,'MMM d, yyyy HH:mm'):'—'}</span></div></TD><TD><EventStakeLimitsCell eventId={row.id}/></TD><TD><div className={styles.cell}><EventMarketsCount eventId={row.id}/><span className={styles.secondary}>Exposure: —</span></div></TD><TD><div className={styles.cell}><span>—</span><span className={styles.secondary}>Bets: —</span><span className={styles.secondary}>Win rate: —</span><span className={styles.secondary}>Avg stake: —</span></div></TD><TD><IconButton label={'Edit '+row.name} icon={<IconSettings size={16}/>} onClick={()=>{setDrawerMode('single');setDrawerEvent(row);setDrawerActive(String(row.status || 'active').toLowerCase()==='active');setDrawerOpen(true)}}/></TD></TR>):<TR><TD colSpan={7}><EmptyState title="No events found for this league"/></TD></TR>}</TBody></Table>
    </>}
  </Card><Drawer title={drawerEvent?'Edit Event Settings':'Bulk Update Settings'} open={drawerOpen} onOpenChange={open=>{if(!open && !saving)setDrawerOpen(false)}} dismissible={!saving} size="lg" footer={<><p className={styles.footerHelp}>{drawerMode==='bulk'?'Changes will apply to all selected events':'Changes will save immediately'}</p><Button disabled={saving} onClick={()=>methods.reset()}>Reset</Button><Button disabled={saving} onClick={()=>setDrawerOpen(false)}>Cancel</Button><Button variant="primary" loading={saving} disabled={settingsLoading || (drawerMode==='bulk' && selectedKeys.size===0)} onClick={()=>void save()}>Apply Changes</Button></>}>
    <div className={styles.stack}><p className={styles.secondary}>{drawerMode==='single'?'Editing: '+drawerEvent?.name:'Selected events: '+events.filter(e=>selectedKeys.has(String(e.id))).map(e=>e.name).join(', ')}</p><SettingsEditor form={form} variant="event" tab={tab} onTab={value=>{setTab(value);setVisited(prev=>new Set([...prev,value]))}} tier={tier} onTier={value=>{setTier(value);if(drawerEvent?.id)void refetchSettings({eventId:drawerEvent.id,tierId:value!=='default'?value:null})}} tiers={tiers} currencySymbol={getCurrencySymbol()} active={drawerActive} onActive={value=>void active(value)} bulk={drawerMode==='bulk'} busy={saving || settingsLoading}/>{message && <Notice tone="error" live="assertive">{message}</Notice>}</div>
  </Drawer></>
}

