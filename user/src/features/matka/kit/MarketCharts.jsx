/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Icon, IconButton, StatusBadge } from './components';
import { displayDate } from './data';
import { chartDays, chartNames, getWeeklyChart } from './chart-data';
import { FilterSelect } from '../FilterSelect';
import './charts.css';

const PERIODS = [{ value: 'all', label: 'All 8 weeks' }, { value: 'four', label: 'Last 4 weeks' }, { value: 'latest', label: 'Latest week' }];

const scrollBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';

function PanaDigits({ value }) {
  return <span className="m99-chart-pana" aria-hidden="true">{[...value].map((digit, index) => <span key={index}>{digit}</span>)}</span>;
}

export function WeeklyChartTable({ market, type, weeks = getWeeklyChart(market), query = '', scrollRef, onScroll }) {
  const panel = type === 'panel';
  return <div ref={scrollRef} onScroll={onScroll} className={`m99-weekly-chart-scroll ${panel ? 'is-panel' : 'is-jodi'}`} tabIndex={0} role="region" aria-label={`${market.name} ${chartNames[type]} table`}>
    <table className={`m99-weekly-chart m99-${type}-chart`}>
      <caption className="m99-sr-only">{market.name} {chartNames[type]} · Published weekly results, Monday to Sunday</caption>
      <colgroup>{panel && <col className="m99-chart-date-column" />}{chartDays.map(day => <col key={day} />)}</colgroup>
      <thead><tr>{panel && <th scope="col">Date</th>}{chartDays.map(day => <th scope="col" key={day}>{day}</th>)}</tr></thead>
      <tbody>{weeks.map(week => <tr key={week.start} data-week={week.start}>{panel && <th scope="row" className="m99-chart-week-range"><time dateTime={week.start}>{week.start}</time><span>to</span><time dateTime={week.end}>{week.end}</time></th>}{week.days.map(day => {
        const today = day.date === market.runDate;
        const match = query.length === 2 && day.published && day.jodi === query;
        return <td key={day.date} data-date={day.date} data-today={today || undefined} data-match={match || undefined} className={day.published ? '' : 'is-unpublished'}>
          <span className="m99-sr-only">{day.date}: {day.published ? panel ? `${day.open}, ${day.jodi}, ${day.close}` : day.jodi : 'Result unavailable'}{today ? ' · Today' : ''}{match ? ' · Matching Jodi' : ''}</span>
          {panel ? <div className="m99-chart-panel-number" aria-hidden="true"><PanaDigits value={day.open} /><strong>{day.jodi}</strong><PanaDigits value={day.close} /></div> : <strong className="m99-chart-jodi-number" aria-hidden="true">{day.jodi}</strong>}
        </td>;
      })}</tr>)}</tbody>
    </table>
  </div>;
}

export default function MarketCharts({ market, type, onChart }) {
  const allWeeks = useMemo(() => getWeeklyChart(market), [market]);
  const [period, setPeriod] = useState('all');
  const [query, setQuery] = useState('');
  const [scroll, setScroll] = useState({ left: 0, max: 0 });
  const scrollRef = useRef(null);
  const weeks = period === 'latest' ? allWeeks.slice(-1) : period === 'four' ? allWeeks.slice(-4) : allWeeks;
  const published = weeks.flatMap(week => week.days).filter(day => day.published);
  const matches = query.length === 2 ? published.filter(day => day.jodi === query).length : 0;
  const types = Object.entries(chartNames).filter(([key]) => key === 'panel' ? !['JACKPOT', 'SATTA_MATKA'].includes(market.kind) : market.kind !== 'STARLINE').map(([value, label]) => ({ value, label }));
  const updateScroll = useCallback(() => {
    const element = scrollRef.current;
    if (element) {
      const left = element.scrollLeft;
      const max = Math.max(0, element.scrollWidth - element.clientWidth);
      setScroll(previous => previous.left === left && previous.max === max ? previous : { left, max });
    }
  }, []);
  useEffect(() => {
    const element = scrollRef.current;
    element?.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    updateScroll();
    const observer = new ResizeObserver(updateScroll);
    if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [market.id, type, period, updateScroll]);

  function jumpToLatest() {
    const element = scrollRef.current;
    if (element) {
      element.scrollTo({ top: element.scrollHeight, left: 0, behavior: scrollBehavior() });
      element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: scrollBehavior() });
    }
  }
  function findJodi(event) {
    event.preventDefault();
    scrollRef.current?.querySelector('[data-match="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: scrollBehavior() });
  }

  return <div className="m99-chart-page">
    {/* One filter strip, as on the Matka directory and market pages: market, chart type, period, Find Jodi and Latest week */}
    <div className="gw-matka-detail-filters gw-matka-chart-filters"><section className="gw-matka-filterbar" aria-label="Chart controls">
      <FilterSelect label="Switch chart market" value={market.id} options={market.options.map(item => ({ value: item.id, label: item.name }))} onChange={id => onChart(market.options.find(item => item.id === id), type)} />
      <FilterSelect label="Chart type" value={type} options={types} onChange={key => onChart(market, key)} />
      <FilterSelect label="Chart period" value={period} options={PERIODS} onChange={setPeriod} />
      <form className="gw-matka-filter-search" role="search" aria-label="Find a Jodi result" onSubmit={findJodi}><Icon name="search" size={16} /><input aria-label="Find Jodi" placeholder="Find Jodi, e.g. 58" inputMode="numeric" maxLength={2} value={query} onChange={event => setQuery(event.target.value.replace(/\D/g, ''))} />{query && <button type="button" aria-label="Clear Jodi search" onClick={() => setQuery('')}><Icon name="close" size={15} /></button>}</form>
      <button type="button" className="gw-matka-filter-action" onClick={jumpToLatest}><Icon name="down" size={16} />Latest week</button>
    </section></div>
    {/* A compact ribbon: the chart's name with its icon, and the latest result as flap tiles (Jodi in the brand colour).
        The page header above already has the market name and the back button. */}
    <section className="gw-chart-ribbon" aria-label="Latest result">
      <div className="gw-chart-ribbon-name"><span aria-hidden="true"><Icon name={type === 'panel' ? 'layers' : 'grid'} size={19} /></span><div><h2 id="m99-chart-title"><span className="m99-sr-only">{market.name} </span>{chartNames[type]}</h2><p>Weekly results · Monday to Sunday</p></div></div>
      <div className="gw-chart-ribbon-result"><span><b>Latest</b><StatusBadge status={market.status} /><small>{displayDate(market.runDate)}</small></span>
        <strong aria-label={`Latest result ${market.result}`}>{market.result.split(' – ').map((part, index) => <span key={index} className={index === 1 ? 'is-jodi' : ''} aria-hidden="true">{index > 0 && <i>–</i>}{[...part].map((digit, place) => <em key={place} className={/\d/.test(digit) ? '' : 'is-empty'}>{digit}</em>)}</span>)}</strong></div>
    </section>
    <section className="m99-chart-sheet" aria-labelledby="m99-chart-title">
      <div className="m99-chart-controls"><div className="m99-chart-history-title"><span><Icon name="chart" size={17} /></span><div><h2>Weekly history</h2><p>{published.length} published results · {weeks.length} {weeks.length === 1 ? 'week' : 'weeks'}</p></div></div></div>
      <div className="m99-chart-sheet-meta"><span><Icon name="clock" size={12} /><time dateTime={weeks[0].start}>{weeks[0].start}</time><i>—</i><time dateTime={weeks.at(-1).end}>{weeks.at(-1).end}</time></span><div className="m99-chart-legend">{query ? <span className="m99-chart-match-count" role="status">{query.length === 1 ? 'Enter 2 digits to find a Jodi' : `${matches} ${matches === 1 ? 'match' : 'matches'} for ${query}`}</span> : <span>{type === 'panel' ? 'Open Pana · Jodi · Close Pana' : '7 days · Monday to Sunday'}</span>}<span className="m99-chart-today-key"><i />Today</span><Badge>Published results</Badge></div></div>
      {type === 'panel' && scroll.max > 0 && <div className="m99-chart-scroll-hint"><span><Icon name="arrow" size={13} />Swipe to explore all 7 days</span><div><IconButton icon="arrow" className="m99-chart-scroll-back" label="Scroll chart left" disabled={scroll.left <= 1} onClick={() => scrollRef.current?.scrollBy({ left: -220, behavior: scrollBehavior() })} /><IconButton icon="arrow" label="Scroll chart right" disabled={scroll.left >= scroll.max - 1} onClick={() => scrollRef.current?.scrollBy({ left: 220, behavior: scrollBehavior() })} /></div></div>}
      <WeeklyChartTable market={market} type={type} weeks={weeks} query={query} scrollRef={scrollRef} onScroll={updateScroll} />
      <div className="m99-chart-sheet-foot"><span><i />A dash or asterisk means the result is unavailable.</span><span><Icon name="clock" size={11} />Dates in {market.timezoneLabel}</span></div>
    </section>
  </div>;
}
