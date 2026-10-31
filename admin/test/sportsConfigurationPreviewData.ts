import type { Operation, FetchResult } from '@apollo/client'
import type { SelectionSetNode } from 'graphql'
import { DOMAINS, type ConfigValues } from '../src/routes/sports/configuration-components/settingsModel'
export const configSettings: ConfigValues = {
  ...Object.fromEntries(DOMAINS.flatMap(domain => [[domain+'MinStake',10],[domain+'MaxStake',1000],[domain+'Delay',2],[domain+'Cooldown',3],[domain+'Commission',1.5],[domain+'ExposureDaily',50000],[domain+'ExposureWeekly',200000],[domain+'ExposureCap',1000000]])),
  exchangeMinOdds:1.01,exchangeMaxOdds:1000,cashoutActive:true,riskLevel:'medium',riskThreshold:75,volatilityThreshold:30,alertOnBreach:true,alertChannel:'email',alertRateLimit:10,
}
export interface SportsConfigFixtureOptions { refuse?: string; reject?: string; failQuery?: string }
function complete(selection:SelectionSetNode,value:unknown):unknown {
  if(value==null)return null
  if(Array.isArray(value))return value.map(item=>complete(selection,item))
  const source=value as Record<string,unknown>
  return Object.fromEntries(selection.selections.filter(node=>node.kind==='Field').map(field=>{const key=field.alias?.value || field.name.value;const raw=field.name.value==='__typename'?source[key] || 'SportsConfigFixture':source[key]??null;return[key,field.selectionSet?complete(field.selectionSet,raw):raw]}))
}
const sports=[{id:'sport-1',key:'cricket',name:'Cricket',sort:1,status:'active',updatedAt:'2026-10-09T10:00:00Z'},{id:'sport-2',key:'football',name:'Football',sort:2,status:'inactive',updatedAt:'2026-10-09T10:00:00Z'}]
const leagues=[{id:'league-1',name:'Premier league',sportId:'sport-1',status:'active',updatedAt:'2026-10-09T10:00:00Z'},{id:'league-2',name:'Second league',sportId:'sport-1',status:'inactive',updatedAt:'2026-10-09T10:00:00Z'}]
const events=[{id:'event-1',name:'Preview event',leagueId:'league-1',status:'active',startTime:'2026-10-09T12:00:00Z',updatedAt:'2026-10-09T10:00:00Z'},{id:'event-2',name:'Second event',leagueId:'league-1',status:'inactive',startTime:'2026-10-10T12:00:00Z',updatedAt:'2026-10-09T10:00:00Z'}]
const markets=[{id:'market-1',name:'Match odds',eventId:'event-1',type:'match_odds',status:'active',updatedAt:'2026-10-09T10:00:00Z'}]
export function sportsConfigResponse(operation:Operation,options:SportsConfigFixtureOptions={}):FetchResult {
  const definition=operation.query.definitions.find(node=>node.kind==='OperationDefinition')
  if(!definition || definition.kind!=='OperationDefinition')throw new Error('Missing sports fixture operation')
  if(options.refuse===operation.operationName || options.failQuery===operation.operationName)throw new Error('Preview operation refused')
  const v=operation.variables;let result:Record<string,unknown>
  switch(operation.operationName) {
    case 'ListSports':result={sports};break
    case 'ListLeagues':result={leagues};break
    case 'ListEvents':result={events};break
    case 'ListMarkets':result={marketsByEvent:markets};break
    case 'ExistingLeagues':result={existingLeagueCodes:['league-code-1']};break
    case 'ExistingEvents':result={existingEventCodes:['event-code-1','event-code-2']};break
    case 'SportSettings':result={sportSettings:{sportId:v.sportId,tierId:v.tierId,...configSettings}};break
    case 'LeagueSettings':result={leagueSettings:{leagueId:v.leagueId,tierId:v.tierId,...configSettings}};break
    case 'EventSettings':result={eventSettings:{eventId:v.eventId,tierId:v.tierId,...configSettings}};break
    case 'VIPTiers':result={vipTiers:[{id:'vip-1',name:'Gold',level:1,status:'active'}]};break
    case 'SetSportStatus':result={setSportStatus:true};break
    case 'SetLeagueStatus':result={setLeagueStatus:true};break
    case 'SetEventStatus':result={setEventStatus:true};break
    case 'SetMarketStatus':result={setMarketStatus:true};break
    case 'ReorderSports':result={reorderSports:{success:true,message:'Priority updated'}};break
    case 'ReorderLeagues':result={reorderLeagues:{success:true,message:'Priority updated'}};break
    case 'UpsertSportSettings':result={upsertSportSettings:{success:options.reject!==operation.operationName,message:options.reject===operation.operationName?'Preview settings rejected':'Saved'}};break
    case 'UpsertLeagueSettings':result={upsertLeagueSettings:{success:options.reject!==operation.operationName,message:options.reject===operation.operationName?'Preview settings rejected':'Saved'}};break
    case 'UpsertEventSettings':result={upsertEventSettings:{success:options.reject!==operation.operationName,message:options.reject===operation.operationName?'Preview settings rejected':'Saved'}};break
    case 'SearchSportsHierarchy':result={searchSportsHierarchy:[{type:'sport',sportId:'sport-1',sportName:'Cricket'},{type:'league',sportId:'sport-1',sportName:'Cricket',leagueId:'league-1',leagueName:'Premier league'},{type:'event',sportId:'sport-1',sportName:'Cricket',leagueId:'league-1',leagueName:'Premier league',eventId:'event-1',eventName:'Preview event'}]};break
    case 'AppConfig':result={appConfig:{sportsGlobalConfig:{defaultStakeLimits:{exchangeMin:0,exchangeMax:100000,bookmakerMin:10,bookmakerMax:100000,fancyMin:10,fancyMax:100000},defaultBetDelays:{exchange:0,bookmaker:0,fancy:0},defaultBetCooldowns:{exchange:0,bookmaker:0,fancy:0}}}};break
    case 'UpdateAppConfig':result={updateAppConfig:{success:options.reject!==operation.operationName,message:options.reject===operation.operationName?'Preview settings rejected':'Saved'}};break
    case 'CurrentWhitelabel':result={currentWhitelabel:null};break
    case 'Currencies':result={currencies:[{code:'INR',symbol:'₹',exchangeRateToBase:1,isBase:true,isActive:true}]};break
    default:throw new Error('Unexpected sports fixture: '+operation.operationName)
  }
  return {data:complete(definition.selectionSet,result) as Record<string,unknown>}
}
