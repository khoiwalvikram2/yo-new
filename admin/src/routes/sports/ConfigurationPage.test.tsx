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
  assert.equal(calls.filter(c=>c.name==='UpsertSportSettings').length,1);assert.deepEqual(calls.find(c=>c.name==='SetSportStatus')?.variables,{key:'cricket',status:'active'})
  assert.equal(calls.find(c=>c.name==='UpsertSportSettings')?.context.uiToast,'notification')
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
  page();await table();fireEvent.click(screen.getByRole('checkbox',{name:'Select all'}));fireEvent.click(screen.getByRole('button',{name:'Update Settings'}))
  await screen.findByRole('dialog',{name:'Bulk Update Sport Settings'});fireEvent.click(screen.getByRole('button',{name:'Suspend all'}))
  fireEvent.change(screen.getByRole('textbox',{name:'Exchange Max Stake'}),{target:{value:'300'}});await apply()
  await waitFor(()=>assert.equal(Boolean(screen.queryByRole('dialog')),false))
  assert.deepEqual(calls.find(c=>c.name==='UpsertSportSettings')?.variables.input,{sportIds:['sport-1','sport-2'],tierId:null,mode:'overwrite',exchangeMaxStake:300})
  assert.deepEqual(calls.filter(c=>c.name==='SetSportStatus').map(c=>c.variables),[{key:'cricket',status:'inactive'},{key:'football',status:'inactive'}])
})
test('hierarchy selections navigate sports to leagues to events to markets with unchanged list and status arguments',async()=>{
  page();await table();fireEvent.click(screen.getByRole('button',{name:'Cricket'}));await table('Leagues')
  assert.ok(calls.some(c=>c.name==='ListLeagues' && c.variables.sportId==='sport-1'));fireEvent.click(screen.getByRole('button',{name:'Premier league'}));await table('Events')
  assert.ok(calls.some(c=>c.name==='ListEvents' && c.variables.leagueId==='league-1'));fireEvent.click(screen.getByRole('button',{name:'Preview event'}));await table('Markets')
  assert.ok(calls.some(c=>c.name==='ListMarkets' && c.variables.eventId==='event-1'));fireEvent.click(screen.getByRole('switch',{name:'Active Match odds'}))
  await waitFor(()=>assert.deepEqual(calls.find(c=>c.name==='SetMarketStatus')?.variables,{id:'market-1',status:'inactive'}));assert.equal(calls.find(c=>c.name==='SetMarketStatus')?.context.uiToast,'message')
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
  assert.deepEqual(calls.find(c=>c.name==='SetLeagueStatus')?.variables,{id:'league-1',status:'active'})
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
