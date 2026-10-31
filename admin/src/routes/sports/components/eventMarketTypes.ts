export interface MarketPriceSize { price?: number | string | null; size?: number | string | null }
export interface MarketRunner {
  id?: string | number | null; selectionId?: string | number | null; selectionCode?: string | number | null; runnerId?: string | number | null
  name?: string | null; selection?: string | null
  back?: number | string | null; backPrice?: number | string | null; backSize?: number | string | null
  lay?: number | string | null; layPrice?: number | string | null; laySize?: number | string | null; volume?: number | string | null
  ex?: { availableToBack?: MarketPriceSize[] | null; availableToLay?: MarketPriceSize[] | null } | null
  fancyData?: { status1?: string | null; minBet?: number | null; ls1?: number | string | null; bs1?: number | string | null } | null
  _fancyLine?: { id?: string | number | null } | null
}
export interface EventMarket {
  id?: string | number | null; name?: string | null; kind?: string | null; type?: string | null; status?: string | null; state?: string | null
  runners?: MarketRunner[] | null; odds?: MarketRunner[] | null; liquidity?: number | null; _dbMarketIds?: (string | number)[] | null
  [key: string]: unknown
}
export interface EventMarketBet {
  id?: string | number | null; userId?: string | number | null; userName?: string | null; userFlags?: unknown
  marketId?: string | number | null; selectionId?: string | number | null; runnerId?: string | number | null
  selection?: string | null; selectionName?: string | null; team?: string | null; side?: string | null; status?: string | null
  stake?: number | null; liability?: number | null; price?: number | null; odds?: number | null; oddsSize?: number | null; odds_size?: number | null
  agentInfo?: { agentId?: string | number | null; agentName?: string | null; schemeType?: string | null; rate?: number | null } | null
  [key: string]: unknown
}
export interface SportsSharingData {
  myAgentSharing?: { sharingRates?: { domain?: string | null; rate?: number | null }[] | null } | null
  myWhitelabelSharing?: { sharingRates?: { domain?: string | null; rate?: number | null }[] | null } | null
}
