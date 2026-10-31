import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import clsx from 'clsx'
import { gql, useApolloClient, useMutation, useQuery } from '@apollo/client'
import {
  IconChartLine,
  IconInfoCircle,
  IconSearch,
  IconTrophy,
} from '@tabler/icons-react'
import {
  LIST_EVENTS_WITH_OPEN_BETS,
  LIST_LEAGUES_WITH_OPEN_BETS,
  LIST_SPORTS,
  MARKETS_WITH_OPEN_BETS,
  RUNNERS_BY_MARKET,
  SEARCH_SPORTS_HIERARCHY,
  SET_EVENT_STATUS,
  SPORTS_RESULTS,
} from '@/lib/graphql/sports'
import { useCreateSportsResult } from '../../../../modules/sports/results'
import { Combobox, type ListboxOption } from '@/ui/components/Combobox'
import { Form } from '@/ui/components/Form'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Select } from '@/ui/components/Select'
import { Switch } from '@/ui/components/Switch'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import {
  EVENT_DISABLE_MESSAGES,
  EVENT_WITHOUT_OPEN_BETS,
  LEAGUE_WITHOUT_OPEN_BETS,
  SPECIAL_STATUS_OPTIONS,
  WINNER_REQUIRED,
  buildCreateSportsResultInput,
  buildHierarchySearchOptions,
  canDeclare,
  declarableMarkets,
  declareErrorMessage,
  declareMarketTypeOptions,
  declareSubmitBlocker,
  declaredMarketIdSet,
  emptyMarketsHint,
  eventDisableStep,
  fancyResultError,
  isCricketCode,
  isStatusValue,
  marketTypeFromValue,
  marketsOfTypeCount,
  namedOptions,
  openBetsChips,
  searchEmptyText,
  searchFoundText,
  searchNoResultsHint,
  searchPlaceholder,
  searchSelectionMessage,
  searchStepHint,
  winnerOptions,
  type DeclareSelection,
  type HierarchyHit,
  type OpenBetsMarket,
} from '../manualResultsModel'
import styles from '../ManualResultsPage.module.css'

const EVENT_OPEN_BETS_FOR_COUNTS = gql`
  query EventOpenBetsForCounts($query: SportsBetsQuery) {
    sportsBets(query: $query) {
      marketId
    }
  }
`

interface ResultEntryFormProps {
  onSuccess?: () => void
  onLoadingChange?: (loading: boolean) => void
  onCanSubmitChange?: (canSubmit: boolean) => void
}

export interface ResultEntryFormRef {
  submit: () => void
  reset: () => void
}

interface SportItem { id: string; name: string; sportCode?: string | null }
interface LeagueItem { id: string; name: string; sportId?: string | null }
interface EventItem { id: string; name: string }
interface RunnerItem { id: string; name: string }
interface ResultItem { marketId?: string | null }
interface BetItem { marketId?: string | null }

interface SportsData { sports?: SportItem[] }
interface LeaguesData { leaguesWithOpenBets?: LeagueItem[] }
interface EventsData { eventsWithOpenBets?: EventItem[] }
interface MarketsData { marketsWithOpenBets?: OpenBetsMarket[] }
interface RunnersData { runnersByMarket?: RunnerItem[] }
interface ResultsData { sportsResults?: { items?: ResultItem[] } }
interface BetsData { sportsBets?: BetItem[] }
interface SearchData { searchSportsHierarchy?: HierarchyHit[] }

type DeclareField = 'sportId' | 'leagueId' | 'eventId' | 'marketType' | 'marketId' | 'runnerId' | 'result'

const REQUIRED_ERROR: Record<Exclude<DeclareField, 'runnerId' | 'result'>, string> = {
  sportId: 'Please select a sport',
  leagueId: 'Please select a league',
  eventId: 'Please select an event',
  marketType: 'Please select a market type',
  marketId: 'Please select a market',
}

function FormBlock({
  icon,
  iconClass,
  title,
  sub,
  children,
}: {
  icon: ReactNode
  iconClass: string
  title: string
  sub: string
  children: ReactNode
}) {
  return (
    <section className={styles.formPanel}>
      <header className={styles.blockHeader}>
        <span className={clsx(styles.blockIcon, iconClass)} aria-hidden="true">{icon}</span>
        <div>
          <h3 className={styles.sectionTitle}>{title}</h3>
          <p className={styles.fieldHint}>{sub}</p>
        </div>
      </header>
      <div className={styles.formGrid}>{children}</div>
    </section>
  )
}

export const ResultEntryForm = forwardRef<ResultEntryFormRef, ResultEntryFormProps>(
  ({ onSuccess, onLoadingChange, onCanSubmitChange }, ref) => {
    const [selection, setSelection] = useState<DeclareSelection>({ result: null })
    const [searchValue, setSearchValue] = useState('')
    const [disableEventAfterResult, setDisableEventAfterResult] = useState(false)
    const [checked, setChecked] = useState<Partial<Record<DeclareField, boolean>>>({})
    const sportRef = useRef<HTMLInputElement | null>(null)
    const leagueRef = useRef<HTMLInputElement | null>(null)
    const eventRef = useRef<HTMLInputElement | null>(null)
    const marketTypeRef = useRef<HTMLSelectElement | null>(null)
    const marketRef = useRef<HTMLInputElement | null>(null)
    const runnerRef = useRef<HTMLInputElement | null>(null)
    const resultRef = useRef<HTMLInputElement | null>(null)

    const { data: globalSearchData, loading: globalSearchLoading } = useQuery<SearchData>(SEARCH_SPORTS_HIERARCHY, {
      variables: { input: { query: searchValue, limit: 50 } },
      skip: !searchValue || searchValue.length < 2,
      errorPolicy: 'all',
    })
    const { data: sportsData, loading: sportsLoading } = useQuery<SportsData>(LIST_SPORTS, { errorPolicy: 'all' })
    const { data: leaguesData, loading: leaguesLoading } = useQuery<LeaguesData>(LIST_LEAGUES_WITH_OPEN_BETS, {
      variables: { sportId: selection.sportId || '' },
      skip: !selection.sportId,
      errorPolicy: 'all',
    })
    const { data: eventsData, loading: eventsLoading } = useQuery<EventsData>(LIST_EVENTS_WITH_OPEN_BETS, {
      variables: { leagueId: selection.leagueId || '' },
      skip: !selection.leagueId,
      errorPolicy: 'all',
    })
    const { data: marketsData, loading: marketsLoading } = useQuery<MarketsData>(MARKETS_WITH_OPEN_BETS, {
      variables: { eventId: selection.eventId || '' },
      skip: !selection.eventId,
      errorPolicy: 'all',
    })
    const { data: declaredResultsData } = useQuery<ResultsData>(SPORTS_RESULTS, {
      variables: {
        query: {
          eventId: selection.eventId || undefined,
          rolledBack: false,
          limit: 500,
        },
      },
      skip: !selection.eventId,
      errorPolicy: 'all',
    })
    const { data: openBetsData, loading: openBetsLoading } = useQuery<BetsData>(EVENT_OPEN_BETS_FOR_COUNTS, {
      variables: {
        query: {
          eventId: selection.eventId || undefined,
          statuses: ['matched', 'unmatched'],
          limit: 3000,
          allTenants: true,
        },
      },
      skip: !selection.eventId,
      errorPolicy: 'all',
    })
    const { data: runnersData, loading: runnersLoading } = useQuery<RunnersData>(RUNNERS_BY_MARKET, {
      variables: { marketId: selection.marketId || '' },
      skip: !selection.marketId || !selection.marketType || selection.marketType === 'fancy',
      errorPolicy: 'all',
    })

    const client = useApolloClient()
    const [createResult, { loading: creating }] = useCreateSportsResult()
    const [setEventStatus] = useMutation(SET_EVENT_STATUS)

    const sports = useMemo(() => sportsData?.sports ?? [], [sportsData?.sports])
    const leagues = useMemo(() => leaguesData?.leaguesWithOpenBets ?? [], [leaguesData?.leaguesWithOpenBets])
    const events = useMemo(() => eventsData?.eventsWithOpenBets ?? [], [eventsData?.eventsWithOpenBets])
    const markets = useMemo(() => marketsData?.marketsWithOpenBets ?? [], [marketsData?.marketsWithOpenBets])
    const selectedSport = sports.find((sport) => sport.id === selection.sportId)
    const isCricket = isCricketCode(selectedSport?.sportCode)
    const declaredIds = useMemo(
      () => declaredMarketIdSet(declaredResultsData?.sportsResults?.items),
      [declaredResultsData?.sportsResults?.items],
    )
    const filteredMarkets = useMemo(
      () => declarableMarkets(markets, selection.marketType, declaredIds),
      [markets, selection.marketType, declaredIds],
    )
    const marketCount = marketsOfTypeCount(markets, selection.marketType)
    const betChips = useMemo(
      () => openBetsChips(openBetsData?.sportsBets, markets),
      [openBetsData?.sportsBets, markets],
    )
    const searchOptions = useMemo(
      () => buildHierarchySearchOptions(searchValue, globalSearchData?.searchSportsHierarchy),
      [searchValue, globalSearchData?.searchSportsHierarchy],
    )

    const reset = () => {
      setSelection({ result: null })
      setSearchValue('')
      setDisableEventAfterResult(false)
      setChecked({})
    }

    useEffect(() => {
      onLoadingChange?.(creating)
    }, [creating, onLoadingChange])

    useEffect(() => {
      onCanSubmitChange?.(canDeclare(selection))
    }, [selection, onCanSubmitChange])

    useEffect(() => {
      if (!selection.leagueId || !leaguesData?.leaguesWithOpenBets) return
      if (leagues.some((league) => league.id === selection.leagueId)) return
      setSelection((current) => ({ ...current, leagueId: undefined, eventId: undefined, marketType: undefined, marketId: undefined, runnerId: undefined, fancyStatus: undefined, result: null }))
      toast({ title: 'Warning', message: LEAGUE_WITHOUT_OPEN_BETS, tone: 'warn' })
    }, [selection.leagueId, leaguesData?.leaguesWithOpenBets, leagues])

    useEffect(() => {
      if (!selection.eventId || !eventsData?.eventsWithOpenBets) return
      if (events.some((event) => event.id === selection.eventId)) return
      setSelection((current) => ({ ...current, eventId: undefined, marketType: undefined, marketId: undefined, runnerId: undefined, fancyStatus: undefined, result: null }))
      toast({ title: 'Warning', message: EVENT_WITHOUT_OPEN_BETS, tone: 'warn' })
    }, [selection.eventId, eventsData?.eventsWithOpenBets, events])

    useEffect(() => {
      if (!selection.marketId || !declaredIds.has(selection.marketId)) return
      setSelection((current) => ({ ...current, marketId: undefined, runnerId: undefined, fancyStatus: undefined, result: null }))
    }, [selection.marketId, declaredIds])

    const errorFor = (field: DeclareField): string | undefined => {
      if (!checked[field]) return undefined
      if (field === 'runnerId') {
        return (selection.marketType === 'exchange' || selection.marketType === 'bookmaker') && !selection.runnerId
          ? WINNER_REQUIRED
          : undefined
      }
      if (field === 'result') return fancyResultError(selection.fancyStatus, selection.result)
      return selection[field] ? undefined : REQUIRED_ERROR[field]
    }

    const submit = async () => {
      setChecked({ sportId: true, leagueId: true, eventId: true, marketType: true, marketId: true, runnerId: true, result: true })
      const blocker = declareSubmitBlocker(selection)
      if (blocker) {
        const firstMissing: DeclareField = !selection.sportId
          ? 'sportId'
          : !selection.leagueId
            ? 'leagueId'
            : !selection.eventId
              ? 'eventId'
              : !selection.marketType
                ? 'marketType'
                : !selection.marketId
                  ? 'marketId'
                  : (selection.marketType === 'exchange' || selection.marketType === 'bookmaker') && !selection.runnerId
                    ? 'runnerId'
                    : 'result'
        const target = {
          sportId: sportRef,
          leagueId: leagueRef,
          eventId: eventRef,
          marketType: marketTypeRef,
          marketId: marketRef,
          runnerId: runnerRef,
          result: resultRef,
        }[firstMissing]
        target.current?.focus()
        toast({ title: 'Error', message: blocker, tone: 'error' })
        return
      }

      try {
        const chosenMarket = markets.find((market) => market.id === selection.marketId)
        const response = await createResult({
          variables: {
            input: buildCreateSportsResultInput({ ...selection, marketName: chosenMarket?.name }),
          },
          context: { uiToast: 'notification' },
        })
        if (!response.data?.createSportsResult?.success) return

        const disableStep = eventDisableStep({
          disableEvent: disableEventAfterResult,
          eventId: selection.eventId,
          openBetsLoading,
          chips: betChips,
          marketId: selection.marketId,
        })
        if (disableStep === 'stillLoading') {
          toast({ title: 'Warning', message: EVENT_DISABLE_MESSAGES.stillLoading, tone: 'warn' })
        } else if (disableStep === 'otherMarketsOpen') {
          toast({ title: 'Warning', message: EVENT_DISABLE_MESSAGES.otherMarketsOpen, tone: 'warn' })
        } else if (disableStep === 'disable' && selection.eventId) {
          onLoadingChange?.(true)
          try {
            await setEventStatus({
              variables: { id: selection.eventId, status: 'inactive' },
              context: { uiToast: 'notification' },
            })
            toast({ message: EVENT_DISABLE_MESSAGES.disabled, tone: 'ok' })
          } catch {
            toast({ title: 'Warning', message: EVENT_DISABLE_MESSAGES.failed, tone: 'warn' })
          } finally {
            onLoadingChange?.(false)
          }
        }

        await client.refetchQueries({ include: [SPORTS_RESULTS] })
        reset()
        onSuccess?.()
      } catch (caught: unknown) {
        toast({ title: 'Error', message: declareErrorMessage(caught), tone: 'error' })
      }
    }

    useImperativeHandle(ref, () => ({ submit: () => void submit(), reset }))

    const updateSport = (sportId: string | null) => {
      setSelection({ sportId: sportId ?? undefined, result: null })
      setDisableEventAfterResult(false)
      setChecked((current) => ({ ...current, sportId: true }))
    }
    const updateLeague = (leagueId: string | null) => {
      setSelection((current) => ({ sportId: current.sportId, leagueId: leagueId ?? undefined, result: null }))
      setDisableEventAfterResult(false)
      setChecked((current) => ({ ...current, leagueId: true }))
    }
    const updateEvent = (eventId: string | null) => {
      setSelection((current) => ({ sportId: current.sportId, leagueId: current.leagueId, eventId: eventId ?? undefined, result: null }))
      setDisableEventAfterResult(false)
      setChecked((current) => ({ ...current, eventId: true }))
    }
    const updateMarketType = (value: string) => {
      const marketType = marketTypeFromValue(value)
      setSelection((current) => ({ sportId: current.sportId, leagueId: current.leagueId, eventId: current.eventId, marketType, result: null }))
      if (marketType === 'fancy' || !marketType) setDisableEventAfterResult(false)
      setChecked((current) => ({ ...current, marketType: true, marketId: false, runnerId: false, result: false }))
    }
    const updateMarket = (marketId: string | null) => {
      setSelection((current) => ({ ...current, marketId: marketId ?? undefined, runnerId: undefined, fancyStatus: undefined, result: null }))
      setChecked((current) => ({ ...current, marketId: true, runnerId: false, result: false }))
    }

    const selectSearchOption = (value: string) => {
      const option = searchOptions.find((item) => item.value === value)
      if (!option) return
      if (option.type === 'sport') {
        setSelection({ sportId: option.sportId ?? undefined, result: null })
      } else if (option.type === 'league') {
        setSelection({ sportId: option.sportId ?? undefined, leagueId: option.leagueId ?? undefined, result: null })
      } else {
        setSelection({
          sportId: option.sportId ?? undefined,
          leagueId: option.leagueId ?? undefined,
          eventId: option.eventId ?? undefined,
          result: null,
        })
      }
      setDisableEventAfterResult(false)
      setSearchValue('')
      toast({ message: searchSelectionMessage(option), tone: 'ok' })
    }

    const marketTypeOptions = declareMarketTypeOptions(isCricket)
    const currentMarketType = selection.marketType
    const marketEmpty = currentMarketType && filteredMarkets.length === 0
      ? emptyMarketsHint(currentMarketType, markets.length, marketCount)
      : undefined
    const selectedMarketName = markets.find((market) => market.id === selection.marketId)?.name || 'N/A'
    const hierarchyOptions: readonly ListboxOption[] = searchOptions

    return (
      <Form className={styles.formStack} aria-label="Declare Sports Result" onSubmit={(event) => event.preventDefault()}>
        <section className={styles.quickSearch}>
          <div>
            <h3 className={styles.quickSearchTitle}>Quick Search</h3>
            <p className={styles.quickSearchHint}>{searchStepHint(selection.sportId, selection.leagueId)}</p>
          </div>
          <Combobox
            label="Quick Search"
            hideLabel
            options={hierarchyOptions}
            inputValue={searchValue}
            onInputChange={setSearchValue}
            onSelect={(value) => selectSearchOption(value)}
            filter={false}
            autoHighlight
            loading={globalSearchLoading}
            emptyText={searchEmptyText(searchValue, globalSearchLoading)}
            placeholder={searchPlaceholder(selection.sportId, selection.leagueId)}
          />
          {searchValue.length >= 2 && searchOptions.length > 0 ? (
            <p className={styles.foundText}>{searchFoundText(searchOptions.length)}</p>
          ) : null}
          {searchValue.length >= 2 && searchOptions.length === 0 && !globalSearchLoading ? (
            <p className={styles.emptyText}>{searchNoResultsHint(selection.sportId, selection.leagueId)}</p>
          ) : null}
        </section>

        <FormBlock
          icon={<IconSearch size={15} stroke={strokeFor(15)} />}
          iconClass={styles.blockIconBlue}
          title="Market Scope"
          sub="Choose the sport, league and event with open bets"
        >
          <Combobox
            ref={sportRef}
            label="Sport"
            required
            placeholder="Select sport"
            loading={sportsLoading}
            options={namedOptions(sports)}
            value={selection.sportId ?? null}
            error={errorFor('sportId')}
            onChange={updateSport}
          />
          <Combobox
            ref={leagueRef}
            label="League"
            required
            placeholder="Select league"
            loading={leaguesLoading}
            disabled={!selection.sportId}
            options={namedOptions(leagues)}
            value={selection.leagueId ?? null}
            error={errorFor('leagueId')}
            onChange={updateLeague}
          />
          <Combobox
            ref={eventRef}
            label="Event"
            required
            placeholder="Select event"
            loading={eventsLoading}
            disabled={!selection.leagueId}
            options={namedOptions(events)}
            value={selection.eventId ?? null}
            error={errorFor('eventId')}
            onChange={updateEvent}
          />
          <Select
            ref={marketTypeRef}
            label="Market Type"
            layout="stacked"
            required
            placeholder="Select market type"
            disabled={!selection.eventId}
            value={selection.marketType ?? ''}
            options={[{ value: '', label: 'Select market type' }, ...marketTypeOptions]}
            error={errorFor('marketType')}
            onChange={updateMarketType}
          />
          <Combobox
            ref={marketRef}
            label="Market"
            required
            placeholder="Select market"
            loading={marketsLoading}
            disabled={!selection.eventId || !selection.marketType}
            options={namedOptions(filteredMarkets)}
            value={selection.marketId ?? null}
            error={errorFor('marketId')}
            help={marketEmpty}
            onChange={updateMarket}
          />
          {selection.marketType === 'exchange' || selection.marketType === 'bookmaker' ? (
            <Combobox
              ref={runnerRef}
              label="Winner Selection"
              required
              placeholder="Select winner"
              loading={runnersLoading}
              disabled={!selection.marketId}
              options={winnerOptions(runnersData?.runnersByMarket)}
              value={selection.runnerId ?? null}
              error={errorFor('runnerId')}
              onChange={(runnerId) => {
                setSelection((current) => ({ ...current, runnerId: runnerId ?? undefined }))
                setChecked((current) => ({ ...current, runnerId: true }))
              }}
            />
          ) : <span aria-hidden="true" />}
        </FormBlock>

        {!isCricket && (selection.marketType === 'bookmaker' || selection.marketType === 'fancy') ? (
          <Notice tone="warn" title="Market type unavailable">
            Bookmaker and Fancy market types are only available for cricket (sport code 4)
          </Notice>
        ) : null}

        {selection.marketType === 'fancy' ? (
          <FormBlock
            icon={<IconTrophy size={15} stroke={strokeFor(15)} />}
            iconClass={styles.blockIconViolet}
            title="Fancy Result"
            sub="Fill either a status or a result value (not both)."
          >
            <Select
              label="Status"
              layout="stacked"
              placeholder="Select status"
              value={selection.fancyStatus ?? ''}
              options={[{ value: '', label: 'Select status' }, ...SPECIAL_STATUS_OPTIONS]}
              help={`Selection: ${selectedMarketName}`}
              onChange={(fancyStatus) => {
                setSelection((current) => ({ ...current, fancyStatus: fancyStatus || undefined, result: isStatusValue(fancyStatus) ? null : current.result }))
                setChecked((current) => ({ ...current, result: true }))
              }}
            />
            <NumberField
              ref={resultRef}
              label="Result Value"
              placeholder="e.g., 6"
              min={0}
              step={1}
              precision={0}
              value={selection.result}
              disabled={isStatusValue(selection.fancyStatus)}
              error={errorFor('result')}
              onChange={(result) => {
                setSelection((current) => ({ ...current, result }))
                setChecked((current) => ({ ...current, result: true }))
              }}
            />
          </FormBlock>
        ) : null}

        {selection.eventId && betChips.length > 0 ? (
          <section className={styles.openBets} aria-labelledby="sports-open-bets-title">
            <header className={styles.openBetsHeader}>
              <h3 id="sports-open-bets-title" className={styles.openBetsTitle}>
                <IconChartLine size={14} stroke={strokeFor(14)} aria-hidden="true" />
                Markets with open bets <span className={styles.openBetsSub}>(all whitelabels)</span>
              </h3>
            </header>
            <div className={styles.openBetsList}>
              {betChips.map((chip) => (
                <span className={styles.openBetsChip} key={chip.marketId}>
                  <span className={styles.chipName} title={chip.marketName}>{chip.marketName}</span>
                  <span className={styles.chipCount}>{chip.openCount}</span>
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {selection.marketType === 'exchange' || selection.marketType === 'bookmaker' ? (
          <section className={styles.switchPanel}>
            <div className={styles.switchRow}>
              <div className={styles.switchCopy}>
                <h3 className={styles.switchTitle}>Disable event after declaring result</h3>
                <p className={styles.switchSub}>When on, the event will be set to inactive after this result is saved successfully.</p>
              </div>
              <Switch
                checked={disableEventAfterResult}
                onChange={setDisableEventAfterResult}
                label="Disable event after declaring result"
                hideLabel
              />
            </div>
          </section>
        ) : null}

        <p className={styles.footerHint}>
          <IconInfoCircle size={14} stroke={strokeFor(14)} aria-hidden="true" />
          A market with an active result is removed from the available market list.
        </p>
      </Form>
    )
  },
)
