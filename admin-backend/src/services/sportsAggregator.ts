import { getRedisEmitter } from '@src/realtime/redisPubsub.js'

type Tick = { price: number; backVol: number; layVol: number }

function generateLadder(base: number, volatility = 0.05): Tick[] {
  const numLevels = 8 + Math.floor(Math.random() * 5) // 8-12 price levels
  const prices: number[] = []
  for (let i = 0; i < numLevels; i++) {
    prices.push(Number((base + i * 0.01 + (Math.random() - 0.5) * volatility).toFixed(2)))
  }
  return prices.sort((a, b) => a - b).map((p) => ({
    price: p,
    backVol: Math.round(300 + Math.random() * 800),
    layVol: Math.round(300 + Math.random() * 800),
  }))
}

let seqMap: Record<string, number> = {}
let orderbookState: Record<string, Tick[]> = {}

export async function startSportsAggregator() {
  try {
    const emitter = getRedisEmitter()
    
    // Test listener to verify messages are flowing
    emitter.on('sports.orderbook.mkt-1001', (msg: any, done: any) => {
      done()
    })
    
    // Demo markets with different types
    const markets = [
      { id: 'mkt-1001', type: 'exchange', name: 'MI vs CSK - Match Winner' },
      { id: 'mkt-1002', type: 'bookmaker', name: 'Arsenal vs Chelsea - Match Odds' },
      { id: 'mkt-1003', type: 'fancy', name: 'Djokovic vs Nadal - Total Games' }
    ]
    const marketKindById: Record<string, 'exchange'|'bookmaker'|'fancy'> = Object.fromEntries(markets.map(m => [m.id, m.type as any]))
    const eventToMarkets: Record<string, string[]> = {
      'evt-1001': ['mkt-1001'],
      'evt-1002': ['mkt-1002'],
      'evt-1003': ['mkt-1003'],
    }
    const eventSeq: Record<string, number> = { 'evt-1001': 0, 'evt-1002': 0, 'evt-1003': 0 }

    for (const market of markets) {
      const marketId = market.id
      seqMap[marketId] = 0
      
      // Initialize orderbook state for exchange markets
      if (market.type === 'exchange') {
        orderbookState[marketId] = generateLadder(2.0, 0.08)
        
        // Send initial snapshot
        const snapshot = {
          __typename: 'OrderbookSnapshot',
          seq: ++seqMap[marketId],
          at: new Date().toISOString(),
          marketId,
          items: orderbookState[marketId],
        }
        emitter.emit({ topic: `sports.orderbook.${marketId}`, payload: { orderbook: snapshot } })
      
      // Update orderbook with deltas
      setInterval(() => {
        const currentLadder = orderbookState[marketId]
        const ops: any[] = []
        
        // Randomly update 1-3 price levels
        const numUpdates = 1 + Math.floor(Math.random() * 3)
        for (let i = 0; i < numUpdates; i++) {
          const idx = Math.floor(Math.random() * currentLadder.length)
          const tick = currentLadder[idx]
          
          // Random operation: upsert or delete (10% chance delete)
          if (Math.random() > 0.9 && currentLadder.length > 5) {
            ops.push({ op: 'delete', id: String(tick.price) })
            currentLadder.splice(idx, 1)
          } else {
            const newBackVol = Math.max(0, tick.backVol + (Math.random() - 0.5) * 200)
            const newLayVol = Math.max(0, tick.layVol + (Math.random() - 0.5) * 200)
            tick.backVol = Math.round(newBackVol)
            tick.layVol = Math.round(newLayVol)
            ops.push({
              op: 'upsert',
              id: String(tick.price),
              backVol: tick.backVol,
              layVol: tick.layVol,
            })
          }
        }
        
        // Occasionally add a new price level
        if (Math.random() > 0.7 && currentLadder.length < 15) {
          const newPrice = Number((2.0 + Math.random() * 0.3).toFixed(2))
          if (!currentLadder.find(t => t.price === newPrice)) {
            const newTick = {
              price: newPrice,
              backVol: Math.round(300 + Math.random() * 500),
              layVol: Math.round(300 + Math.random() * 500),
            }
            currentLadder.push(newTick)
            currentLadder.sort((a, b) => a.price - b.price)
            ops.push({
              op: 'upsert',
              id: String(newPrice),
              backVol: newTick.backVol,
              layVol: newTick.layVol,
            })
          }
        }
        
        if (ops.length > 0) {
          const delta = {
            __typename: 'OrderbookDelta',
            seq: ++seqMap[marketId],
            at: new Date().toISOString(),
            marketId,
            ops,
          }
          emitter.emit({ topic: `sports.orderbook.${marketId}`, payload: { orderbook: delta } })
        }
      }, 800) // Fast updates (800ms)
    }

    // Bookmaker book updates
    if (market.type === 'bookmaker' || market.type === 'exchange') {
      const bookSeqKey = `${marketId}_book`
      seqMap[bookSeqKey] = 0
      
      setInterval(() => {
        const selections = [
          { id: 'sel-home', name: 'Home Win', basePrice: 1.85, volatility: 0.05 },
          { id: 'sel-draw', name: 'Draw', basePrice: 3.2, volatility: 0.1 },
          { id: 'sel-away', name: 'Away Win', basePrice: 2.1, volatility: 0.05 },
        ]
        
        const bookType = market.type === 'bookmaker' ? 'BookmakerBook' : 'OrderbookSnapshot'
        
        if (bookType === 'BookmakerBook') {
          const book = {
            __typename: 'BookmakerBook',
            seq: ++seqMap[bookSeqKey],
            at: new Date().toISOString(),
            marketId,
            selections: selections.map((s) => ({
              id: s.id,
              name: s.name,
              price: Number((s.basePrice + (Math.random() - 0.5) * s.volatility).toFixed(2)),
              backVol: Math.round(400 + Math.random() * 600),
              layVol: Math.round(350 + Math.random() * 550),
              lastUpdated: new Date().toISOString(),
            })),
          }
          emitter.emit({ topic: `sports.book.${marketId}`, payload: { book } })
        }
      }, 1200)
    }

    // Fancy book updates
    if (market.type === 'fancy') {
      const fancySeqKey = `${marketId}_fancy`
      seqMap[fancySeqKey] = 0
      
      setInterval(() => {
        const fancyLines = [
          { id: 'fancy-over-150', name: 'Total Runs Over 150.5', baseBack: 1.90, baseLay: 1.95 },
          { id: 'fancy-under-150', name: 'Total Runs Under 150.5', baseBack: 1.92, baseLay: 1.97 },
          { id: 'fancy-player-50', name: 'Player X to Score 50+', baseBack: 2.50, baseLay: 2.60 },
          { id: 'fancy-wickets', name: '10+ Wickets in Match', baseBack: 1.75, baseLay: 1.82 },
          { id: 'fancy-boundaries', name: '30+ Boundaries', baseBack: 1.88, baseLay: 1.93 },
        ]
        
        const fancy = {
          seq: ++seqMap[fancySeqKey],
          at: new Date().toISOString(),
          marketId,
          lines: fancyLines.map((line) => ({
            id: line.id,
            name: line.name,
            back: Number((line.baseBack + (Math.random() - 0.5) * 0.1).toFixed(2)),
            lay: Number((line.baseLay + (Math.random() - 0.5) * 0.1).toFixed(2)),
            at: new Date().toISOString(),
          })),
        }
        emitter.emit({ topic: `sports.fancy.${marketId}`, payload: { fancyBook: fancy } })
      }, 1500)
    }
  } // Close the for loop
  
  // Event-level live snapshot (top-of-book across markets for an event)
  Object.keys(eventToMarkets).forEach((eventId) => {
    setInterval(() => {
      const now = new Date().toISOString()
      const marketsSnapshot = eventToMarkets[eventId].map((mid) => {
        const kind = marketKindById[mid] || 'exchange'
        if (kind === 'exchange') {
          const ladder = orderbookState[mid] || []
          const bestBack = ladder.length ? Math.max(...ladder.filter(t => t.backVol > 0).map(t => t.price)) : 2.0
          const bestLay = ladder.length ? Math.min(...ladder.filter(t => t.layVol > 0).map(t => t.price)) : 2.04
          return {
            marketId: mid,
            kind: 'exchange',
            state: 'open',
            top: [
              { selectionId: 'top', selectionName: 'Top', back: Number(bestBack.toFixed(2)), lay: Number(bestLay.toFixed(2)) }
            ],
            fancy: [],
            seq: ++eventSeq[eventId],
            at: now,
          }
        } else if (kind === 'bookmaker') {
          // Generate simple bookmaker odds for three selections
          const selections = [
            { id: 'sel-home', name: 'Home', base: 1.90 },
            { id: 'sel-draw', name: 'Draw', base: 3.40 },
            { id: 'sel-away', name: 'Away', base: 2.05 },
          ]
          return {
            marketId: mid,
            kind: 'bookmaker',
            state: 'open',
            top: selections.map(s => ({ selectionId: s.id, selectionName: s.name, back: Number((s.base + (Math.random()-0.5)*0.05).toFixed(2)), lay: null as any })),
            fancy: [],
            seq: ++eventSeq[eventId],
            at: now,
          }
        } else {
          // Fancy lines
          const lines = [
            { id: 'line-1', name: 'Line A', back: Number((1.9 + (Math.random()-0.5)*0.1).toFixed(2)), lay: Number((1.95 + (Math.random()-0.5)*0.1).toFixed(2)), at: now },
            { id: 'line-2', name: 'Line B', back: Number((2.1 + (Math.random()-0.5)*0.1).toFixed(2)), lay: Number((2.2 + (Math.random()-0.5)*0.1).toFixed(2)), at: now },
          ]
          return {
            marketId: mid,
            kind: 'fancy',
            state: 'open',
            top: [],
            fancy: lines,
            seq: ++eventSeq[eventId],
            at: now,
          }
        }
      })
      emitter.emit({ topic: `sports.event.${eventId}`, payload: { eventLive: { eventId, markets: marketsSnapshot, seq: ++eventSeq[eventId], at: now } } })
    }, 1200)
  })
  
  } catch (error) {
    throw error
  }
}

