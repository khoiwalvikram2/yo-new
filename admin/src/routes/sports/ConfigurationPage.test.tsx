import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import { useSportsScopeStore } from '@/state/sportsScopeStore'
import { useSportsConfigStore } from '@/state/sportsConfigStore'
import { sportsConfigResponse, configSettings, type SportsConfigFixtureOptions } from '../../../test/sportsConfigurationPreviewData'
import ConfigurationPage from './ConfigurationPage'
const notify=vi.hoisted(()=>({success:vi.fn(),error:vi.fn()}))
vi.mock('@/shared/services/notification',()=>({notify}))
vi.mock('@/shared/core/CurrencyContext',()=>({useCurrency:()=>({getCurrencySymbol:()=> '₹'})}))
let options:SportsConfigFixtureOptions
let calls:{name:string;variables:Record<string,unknown>;context:Record<string,unknown>}[]
function page() {
  const current=calls;const fixture=options
  const link=new ApolloLink(operation=>new Observable(observer=>{
    current.push({name:operation.operationName,variables:JSON.parse(JSON.stringify(operation.variables)) as Record<string,unknown>,context:operation.getContext()})
    queueMicrotask(()=>{try{observer.next(sportsConfigResponse(operation,fixture));observer.complete()}catch(cause){observer.error(cause)}})
  }))
  return render(<MockedProvider cache={new InMemoryCache()} link={link}><MemoryRouter><ConfigurationPage/></MemoryRouter></MockedProvider>)
}
async function table(name='Sports'){return screen.findByRole('table',{name})}
function scope(name:string){fireEvent.click(within(screen.getByRole('group',{name:'Scope selector'})).getByRole('button',{name}))}
async function choose(label:string,text:string) {
  const input=screen.getByRole('combobox',{name:label});await waitFor(()=>assert.equal((input as HTMLInputElement).disabled,false))
  fireEvent.change(input,{target:{value:text}});fireEvent.keyDown(input,{key:'ArrowDown'});fireEvent.click(await screen.findByRole('option',{name:text}))
}
async function apply() {await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Apply Changes'}))})}
// Status and order are the platform's (catalogueAccess); the default session is a Whitelabel Admin.
function asPlatformAdmin(){useAuthStore.setState({permissions:[{domain:'all',actions:['*']}],roles:['Super Admin']})}
const READ_ONLY_NOTE='Status and order are shared by every whitelabel, so only the platform administrator can change them.'
beforeEach(()=>{
  options={};calls=[];vi.clearAllMocks()
  useAuthStore.setState({permissions:[{domain:'sports.configuration',actions:['view','update']}],roles:['Whitelabel Admin'],agent:undefined})
  useSportsScopeStore.setState({scope:'sports',selectedSportId:undefined,selectedLeagueId:undefined,selectedEventId:undefined})
  useSportsConfigStore.setState({search:'',selectedSport:null,selectedLeagues:[]})
})
test('RBAC denies without queries and Default Settings is limited to update-enabled non-super whitelabel admins',async()=>{
  useAuthStore.setState({permissions:[],roles:[]});const view=page();screen.getByText('Access denied');assert.equal(calls.length,0);view.unmount()
  for(const [roles,actions] of [[['Super Admin'],['view','update']],[['Whitelabel Admin'],['view']]] as const){
    useAuthStore.setState({permissions:[{domain:'sports.configuration',actions:[...actions]}],roles:[...roles]});const p=page();await table()
    assert.equal(Boolean(screen.queryByRole('button',{name:'Default Settings'})),false);assert.equal(calls.some(c=>c.name==='AppConfig'),false);p.unmount();calls=[]
  }
  useAuthStore.setState({permissions:[{domain:'sports.configuration',actions:['view','update']}],roles:['Whitelabel Admin']});page();await table();screen.getByRole('button',{name:'Default Settings'});assert.ok(calls.some(c=>c.name==='AppConfig'))
})
test('sport single edit preserves registered-tab subset, tier scope, nullable fields, status-first context and prevents duplicate saves',async()=>{
  page();await table();fireEvent.click(screen.getByRole('button',{name:'Edit Cricket'}));await screen.findByRole('dialog',{name:'Edit Sport Settings'})
  await waitFor(()=>assert.equal((screen.getByRole('textbox',{name:'Exchange Min Stake'}) as HTMLInputElement).value,'10'))
  fireEvent.change(screen.getByRole('textbox',{name:'Exchange Min Stake'}),{target:{value:'25'}})
  fireEvent.change(screen.getByRole('textbox',{name:'Bookmaker Min Stake'}),{target:{value:''}})
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Apply Changes'}));fireEvent.click(screen.getByRole('button',{name:'Apply Changes'}))})
  await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
  assert.deepEqual(calls.find(c=>c.name==='UpsertSportSettings')?.variables.input,{sportIds:['sport-1'],tierId:null,mode:'overwrite',exchangeMinStake:25,exchangeMaxStake:1000,bookmakerMinStake:null,bookmakerMaxStake:1000,fancyMinStake:10,fancyMaxStake:1000})
  // The sport's status is the platform's: the whitelabel admin's save writes its own settings only.
  assert.equal(calls.filter(c=>c.name==='UpsertSportSettings').length,1);assert.equal(calls.some(c=>c.name==='SetSportStatus'),false)
  assert.equal(calls.find(c=>c.name==='UpsertSportSettings')?.context.uiToast,'notification')
})
test('a whitelabel admin reads status and order but is offered no control that changes them for every whitelabel',async()=>{
  page();await table();screen.getByText(READ_ONLY_NOTE)
  assert.equal(Boolean(screen.queryByRole('button',{name:'Reorder Cricket'})),false)
  fireEvent.click(screen.getByRole('button',{name:'Edit Cricket'}));const dialog=await screen.findByRole('dialog',{name:'Edit Sport Settings'})
  assert.equal(Boolean(within(dialog).queryByRole('switch',{name:'Active state'})),false);within(dialog).getByText('ACTIVE');within(dialog).getByText(READ_ONLY_NOTE)
  fireEvent.click(within(dialog).getByRole('button',{name:'Cancel'}));await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
  fireEvent.click(screen.getByRole('checkbox',{name:'Select all'}));fireEvent.click(screen.getByRole('button',{name:'Update Settings'}))
  const bulk=await screen.findByRole('dialog',{name:'Bulk Update Sport Settings'})
  for(const name of ['Keep current','Activate all','Suspend all'])assert.equal(Boolean(within(bulk).queryByRole('button',{name})),false)
  fireEvent.change(screen.getByRole('textbox',{name:'Exchange Max Stake'}),{target:{value:'300'}});await apply()
  await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
  assert.ok(calls.some(c=>c.name==='UpsertSportSettings'));assert.equal(calls.some(c=>c.name==='SetSportStatus' || c.name==='ReorderSports'),false)
})
test('the platform administrator switches a sport at once; Apply does not write the status again',async()=>{
  asPlatformAdmin();page();await table();assert.equal(Boolean(screen.queryByText(READ_ONLY_NOTE)),false);screen.getByRole('button',{name:'Reorder Cricket'})
  fireEvent.click(screen.getByRole('button',{name:'Edit Cricket'}));await screen.findByRole('dialog',{name:'Edit Sport Settings'})
  fireEvent.click(screen.getByRole('switch',{name:'Active state'}))
  await waitFor(()=>assert.deepEqual(calls.filter(c=>c.name==='SetSportStatus').map(c=>c.variables),[{key:'cricket',status:'inactive'}]))
  await apply();await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
  assert.equal(calls.filter(c=>c.name==='SetSportStatus').length,1)
})
test('all seven sport tabs retain commission/cashout/risk fields, VIP and apply mode; rejected save keeps draft',async()=>{
  page();await table();fireEvent.click(screen.getByRole('button',{name:'Edit Cricket'}));await screen.findByRole('dialog',{name:'Edit Sport Settings'})
  fireEvent.change(screen.getByRole('combobox',{name:'VIP Tier'}),{target:{value:'vip-1'}})
  await waitFor(()=>assert.ok(calls.some(c=>c.name==='SportSettings' && c.variables.tierId==='vip-1')))
  for(const name of ['Bet Delays','Odds Limits','Cashout','Commission','Exposure Limits','Risk & Alerts'])fireEvent.click(screen.getByRole('tab',{name}))
  fireEvent.change(screen.getByRole('combobox',{name:'Apply Mode'}),{target:{value:'fill-empty'}})
  fireEvent.change(screen.getByRole('textbox',{name:'Risk Threshold'}),{target:{value:'80'}})
  options.reject='UpsertSportSettings';await apply();await screen.findByText('Preview settings rejected')
  assert.equal((screen.getByRole('textbox',{name:'Risk Threshold'}) as HTMLInputElement).value,'80')
  const input=calls.find(c=>c.name==='UpsertSportSettings')?.variables.input as Record<string,unknown>
  assert.deepEqual(input,{sportIds:['sport-1'],tierId:'vip-1',mode:'fill-empty',...configSettings,riskThreshold:80})
  options.reject=undefined;await apply();await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
})
test('sport bulk selection uses exact selected ids and keys; untouched fields are not invented',async()=>{
  asPlatformAdmin();page();await table();fireEvent.click(screen.getByRole('checkbox',{name:'Select all'}));fireEvent.click(screen.getByRole('button',{name:'Update Settings'}))
  await screen.findByRole('dialog',{name:'Bulk Update Sport Settings'});fireEvent.click(screen.getByRole('button',{name:'Suspend all'}))
  fireEvent.change(screen.getByRole('textbox',{name:'Exchange Max Stake'}),{target:{value:'300'}});await apply()
  await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
  assert.deepEqual(calls.find(c=>c.name==='UpsertSportSettings')?.variables.input,{sportIds:['sport-1','sport-2'],tierId:null,mode:'overwrite',exchangeMaxStake:300})
  assert.deepEqual(calls.filter(c=>c.name==='SetSportStatus').map(c=>c.variables),[{key:'cricket',status:'inactive'},{key:'football',status:'inactive'}])
})
test('a bulk edit keeps every status unless one is chosen, whatever the last single edit held',async()=>{
  asPlatformAdmin();useSportsScopeStore.setState({scope:'events',selectedSportId:'sport-1',selectedLeagueId:'league-1'});page();await table('Events')
  // The inactive event's single edit used to leave "Suspend all" chosen for the next bulk edit.
  fireEvent.click(screen.getByRole('button',{name:'Edit Second event'}));await screen.findByRole('dialog',{name:'Edit Event Settings'})
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
  fireEvent.click(screen.getByRole('checkbox',{name:'Select all'}));fireEvent.click(screen.getByRole('button',{name:'Update Settings'}))
  await screen.findByRole('dialog',{name:'Bulk Update Settings'})
  assert.equal(screen.getByRole('button',{name:'Keep current'}).getAttribute('aria-pressed'),'true')
  assert.equal(screen.getByRole('button',{name:'Suspend all'}).getAttribute('aria-pressed'),'false')
  fireEvent.change(screen.getByRole('textbox',{name:'Exchange Max Stake'}),{target:{value:'900'}});await apply()
  await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
  assert.deepEqual(calls.find(c=>c.name==='UpsertEventSettings')?.variables,{eventIds:['event-1','event-2'],input:{exchangeMaxStake:900,tierId:null}})
  assert.equal(calls.some(c=>c.name==='SetEventStatus'),false)
})
test('hierarchy selections navigate sports to leagues to events to markets with unchanged list and status arguments',async()=>{
  asPlatformAdmin();page();await table();fireEvent.click(screen.getByRole('button',{name:'Cricket'}));await table('Leagues')
  assert.ok(calls.some(c=>c.name==='ListLeagues' && c.variables.sportId==='sport-1'));fireEvent.click(screen.getByRole('button',{name:'Premier league'}));await table('Events')
  assert.ok(calls.some(c=>c.name==='ListEvents' && c.variables.leagueId==='league-1'));fireEvent.click(screen.getByRole('button',{name:'Preview event'}));await table('Markets')
  assert.ok(calls.some(c=>c.name==='ListMarkets' && c.variables.eventId==='event-1'));fireEvent.click(screen.getByRole('switch',{name:'Active Match odds'}))
  await waitFor(()=>assert.deepEqual(calls.find(c=>c.name==='SetMarketStatus')?.variables,{id:'market-1',status:'inactive'}));assert.equal(calls.find(c=>c.name==='SetMarketStatus')?.context.uiToast,'message')
})
test('a whitelabel admin reads a market status without a switch',async()=>{
  useSportsScopeStore.setState({scope:'markets',selectedSportId:'sport-1',selectedLeagueId:'league-1',selectedEventId:'event-1'});page();await table('Markets')
  await screen.findByText('Match odds');assert.equal(Boolean(screen.queryByRole('switch',{name:'Active Match odds'})),false);screen.getByText('ACTIVE')
})
test('the search typed to find an event does not follow into its markets',async()=>{
  useSportsScopeStore.setState({scope:'events',selectedSportId:'sport-1',selectedLeagueId:'league-1'});page();await table('Events')
  fireEvent.change(screen.getByRole('textbox',{name:'Search events'}),{target:{value:'Preview ev'}})
  fireEvent.click(screen.getByRole('button',{name:'Preview event'}));await table('Markets')
  await waitFor(()=>assert.equal(useSportsConfigStore.getState().search,''))
  assert.equal((screen.getByRole('textbox',{name:'Search markets'}) as HTMLInputElement).value,'');await screen.findByText('Match odds')
})
test('a global search result on the scope already shown does not hand its text to the next drill-down',async()=>{
  useSportsScopeStore.setState({scope:'events',selectedSportId:'sport-1',selectedLeagueId:'league-1'});page();await table('Events')
  fireEvent.click(screen.getByRole('button',{name:'Global search'}));fireEvent.change(screen.getByRole('textbox',{name:'Search sports, leagues, events'}),{target:{value:'event'}})
  fireEvent.click(await screen.findByRole('button',{name:'Preview event · Premier league'}))
  await waitFor(()=>assert.equal(useSportsConfigStore.getState().search,'Preview event'))
  fireEvent.click(await screen.findByRole('button',{name:'Preview event'}));await table('Markets')
  await waitFor(()=>assert.equal(useSportsConfigStore.getState().search,''))
  assert.equal((screen.getByRole('textbox',{name:'Search markets'}) as HTMLInputElement).value,'');await screen.findByText('Match odds')
})
test('league single settings preserve tier, hydration differences and unnamed Apply Mode omission',async()=>{
  page();await table();scope('Leagues');await choose('Sport','Cricket');await table('Leagues')
  fireEvent.click(screen.getByRole('button',{name:'Edit Premier league'}));await screen.findByRole('dialog',{name:'Edit League Settings'})
  await waitFor(()=>assert.equal((screen.getByRole('textbox',{name:'Exchange Min Stake'}) as HTMLInputElement).value,'10'))
  fireEvent.change(screen.getByRole('combobox',{name:'VIP Tier'}),{target:{value:'vip-1'}})
  await waitFor(()=>assert.ok(calls.some(c=>c.name==='LeagueSettings' && c.variables.tierId==='vip-1')))
  fireEvent.click(screen.getByRole('tab',{name:'Risk & Alerts'}));assert.equal((screen.getByRole('textbox',{name:'Risk Threshold'}) as HTMLInputElement).value,'')
  fireEvent.change(screen.getByRole('textbox',{name:'Risk Threshold'}),{target:{value:'90'}});fireEvent.change(screen.getByRole('combobox',{name:'Apply Mode'}),{target:{value:'fill-empty'}})
  await apply();await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
  assert.deepEqual(calls.find(c=>c.name==='UpsertLeagueSettings')?.variables,{leagueIds:['league-1'],input:{exchangeMinStake:10,exchangeMaxStake:1000,bookmakerMinStake:10,bookmakerMaxStake:1000,fancyMinStake:10,fancyMaxStake:1000,riskThreshold:90,tierId:'vip-1'}})
  assert.equal(calls.some(c=>c.name==='SetLeagueStatus'),false)
})
test('event settings retain the allow-list, tier and mode omission without adding unsupported cashout/commission controls',async()=>{
  useSportsScopeStore.setState({scope:'events',selectedSportId:'sport-1',selectedLeagueId:'league-1'});page();await table('Events')
  fireEvent.click(screen.getByRole('button',{name:'Edit Preview event'}));await screen.findByRole('dialog',{name:'Edit Event Settings'})
  assert.equal(Boolean(screen.queryByRole('tab',{name:'Commission'})),false);assert.equal(Boolean(screen.queryByRole('tab',{name:'Cashout'})),false)
  await waitFor(()=>assert.equal((screen.getByRole('textbox',{name:'Exchange Min Stake'}) as HTMLInputElement).value,'10'))
  fireEvent.change(screen.getByRole('combobox',{name:'Apply Mode'}),{target:{value:'fill-empty'}});fireEvent.change(screen.getByRole('combobox',{name:'VIP Tier'}),{target:{value:'vip-1'}})
  await waitFor(()=>assert.ok(calls.some(c=>c.name==='EventSettings' && c.variables.tierId==='vip-1')))
  fireEvent.click(screen.getByRole('tab',{name:'Bet Delays'}));fireEvent.change(screen.getByRole('textbox',{name:'Exchange Delay (seconds)'}),{target:{value:'4'}});await apply()
  await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
  assert.deepEqual(calls.find(c=>c.name==='UpsertEventSettings')?.variables,{eventIds:['event-1'],input:{exchangeMinStake:10,exchangeMaxStake:1000,bookmakerMinStake:10,bookmakerMaxStake:1000,fancyMinStake:10,fancyMaxStake:1000,exchangeDelay:4,exchangeCooldown:3,bookmakerDelay:2,bookmakerCooldown:3,fancyDelay:2,fancyCooldown:3,tierId:'vip-1'}})
})
test('a min stake above the max, or odds no price can meet, stops on the field and writes nothing',async()=>{
  useSportsScopeStore.setState({scope:'events',selectedSportId:'sport-1',selectedLeagueId:'league-1'});page();await table('Events')
  fireEvent.click(screen.getByRole('button',{name:'Edit Preview event'}));await screen.findByRole('dialog',{name:'Edit Event Settings'})
  await waitFor(()=>assert.equal((screen.getByRole('textbox',{name:'Exchange Min Stake'}) as HTMLInputElement).value,'10'))
  fireEvent.change(screen.getByRole('textbox',{name:'Exchange Min Stake'}),{target:{value:'5000'}});fireEvent.change(screen.getByRole('textbox',{name:'Exchange Max Stake'}),{target:{value:'100'}})
  await apply();await screen.findByText('Exchange Min Stake cannot exceed the Max Stake (100)')
  assert.ok(screen.getByRole('dialog',{name:'Edit Event Settings'}));assert.equal(calls.some(c=>c.name==='UpsertEventSettings'),false)
  // Raising the max clears the error; the odds tab then refuses a min odds of zero and opens on it.
  fireEvent.change(screen.getByRole('textbox',{name:'Exchange Max Stake'}),{target:{value:'9000'}})
  await waitFor(()=>assert.equal(Boolean(screen.queryByText('Exchange Min Stake cannot exceed the Max Stake (100)')),false))
  fireEvent.click(screen.getByRole('tab',{name:'Odds Limits'}));fireEvent.change(screen.getByRole('textbox',{name:'Min Odds'}),{target:{value:'0'}})
  fireEvent.click(screen.getByRole('tab',{name:'Stake Limits'}));await apply()
  await screen.findByText('Min Odds must be at least 1.01');assert.equal(screen.getByRole('tab',{name:'Odds Limits'}).getAttribute('aria-selected'),'true')
  assert.equal(calls.some(c=>c.name==='UpsertEventSettings'),false)
})
test('default twelve fields retain zero-stake fallback, reset, exact nested payload and rejected draft',async()=>{
  page();await table();fireEvent.click(screen.getByRole('button',{name:'Default Settings'}));await screen.findByRole('dialog',{name:'Default Settings'})
  await waitFor(()=>assert.equal((screen.getByRole('textbox',{name:'Exchange Min Stake'}) as HTMLInputElement).value,'10'))
  fireEvent.change(screen.getByRole('textbox',{name:'Exchange Min Stake'}),{target:{value:'20'}});fireEvent.change(screen.getByRole('textbox',{name:'Exchange Delay'}),{target:{value:'4'}})
  options.reject='UpdateAppConfig';await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Save'}))});await screen.findByText('Preview settings rejected')
  assert.equal((screen.getByRole('textbox',{name:'Exchange Min Stake'}) as HTMLInputElement).value,'20')
  const input=calls.find(c=>c.name==='UpdateAppConfig')?.variables.input
  assert.deepEqual(input,{sportsGlobalConfig:{defaultStakeLimits:{exchangeMin:20,exchangeMax:100000,bookmakerMin:10,bookmakerMax:100000,fancyMin:10,fancyMax:100000},defaultBetDelays:{exchange:4,bookmaker:0,fancy:0},defaultBetCooldowns:{exchange:0,bookmaker:0,fancy:0}}})
  fireEvent.click(screen.getByRole('button',{name:'Reset'}));assert.equal((screen.getByRole('textbox',{name:'Exchange Min Stake'}) as HTMLInputElement).value,'10')
  fireEvent.keyDown(screen.getByRole('textbox',{name:'Exchange Min Stake'}),{key:'ArrowUp'});assert.equal((screen.getByRole('textbox',{name:'Exchange Min Stake'}) as HTMLInputElement).value,'11')
  fireEvent.keyDown(screen.getByRole('textbox',{name:'Exchange Max Stake'}),{key:'ArrowUp'});assert.equal((screen.getByRole('textbox',{name:'Exchange Max Stake'}) as HTMLInputElement).value,'100100')
  fireEvent.click(screen.getByRole('button',{name:'Reset'}))
  options.reject=undefined;await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Save'}))});await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
})
test('hierarchy search keeps minimum length, limit25 and selected scope IDs',async()=>{
  page();await table();fireEvent.click(screen.getByRole('button',{name:'Global search'}))
  fireEvent.change(screen.getByRole('textbox',{name:'Search sports, leagues, events'}),{target:{value:'x'}});assert.equal(calls.some(c=>c.name==='SearchSportsHierarchy'),false)
  fireEvent.change(screen.getByRole('textbox',{name:'Search sports, leagues, events'}),{target:{value:'event'}})
  fireEvent.click(await screen.findByRole('button',{name:'Preview event · Premier league'}));await table('Events')
  assert.deepEqual(calls.find(c=>c.name==='SearchSportsHierarchy')?.variables,{input:{query:'event',limit:25}})
  assert.equal(useSportsScopeStore.getState().selectedSportId,'sport-1');assert.equal(useSportsScopeStore.getState().selectedLeagueId,'league-1');assert.equal(useSportsConfigStore.getState().search,'Preview event')
})
test('the three absent-parent scopes remain informative and do not start dependent list queries',async()=>{
  for(const [target,message] of [['Leagues','Please choose a sport from the top controls or click the sport from the sports table.'],['Events','Please choose a sport and league from the top controls or click the league from the leagues table.'],['Markets','Please select an event from the top controls or click the event from the events table.']]){
    const view=page();await table();scope(target);screen.getByText(message);assert.equal(calls.some(c=>['ListLeagues','ListEvents','ListMarkets'].includes(c.name)),false);view.unmount();cleanup();calls=[];useSportsScopeStore.setState({scope:'sports'})
  }
})

test('league and event bulk editors retain exact selection and omit unvisited overrides',async()=>{
  useSportsScopeStore.setState({scope:'leagues',selectedSportId:'sport-1'});const view=page();await table('Leagues')
  fireEvent.click(screen.getByRole('checkbox',{name:'Select all'}));fireEvent.click(screen.getByRole('button',{name:'Update Settings'}));await screen.findByRole('dialog',{name:'Bulk Update League Settings (2)'})
  fireEvent.change(screen.getByRole('textbox',{name:'Fancy Max Stake'}),{target:{value:'700'}});await apply();await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
  assert.deepEqual(calls.find(c=>c.name==='UpsertLeagueSettings')?.variables,{leagueIds:['league-1','league-2'],input:{fancyMaxStake:700,tierId:null}})
  view.unmount();cleanup();calls=[];useSportsScopeStore.setState({scope:'events',selectedSportId:'sport-1',selectedLeagueId:'league-1'})
  page();await table('Events');fireEvent.click(screen.getByRole('checkbox',{name:'Select all'}));fireEvent.click(screen.getByRole('button',{name:'Update Settings'}));await screen.findByRole('dialog',{name:'Bulk Update Settings'})
  fireEvent.change(screen.getByRole('textbox',{name:'Bookmaker Max Stake'}),{target:{value:'800'}});await apply();await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
  assert.deepEqual(calls.find(c=>c.name==='UpsertEventSettings')?.variables,{eventIds:['event-1','event-2'],input:{bookmakerMaxStake:800,tierId:null}})
})
