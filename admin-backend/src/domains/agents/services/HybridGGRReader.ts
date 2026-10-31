import type { VerticalReaders, DomainGGRBreakdown, CycleAgentGGRRow, OpenBetCounts } from './VerticalReaders';
import { LiveGGRReader } from './LiveGGRReader';

/**
 * GGR reader that delegates to LiveGGRReader for accurate real-time data.
 * Previously used snapshots for past dates, but snapshot gaps (missing days)
 * caused GGR mismatches. Now always reads from actual bets for accuracy.
 */
export class HybridGGRReader implements VerticalReaders {
  private liveReader: LiveGGRReader;

  constructor() {
    this.liveReader = new LiveGGRReader();
  }

  async getSportsGGR(params: {
    agentId: string;
    from: Date;
    to: Date;
    scope: 'direct' | 'downline';
  }): Promise<DomainGGRBreakdown> {
    return this.liveReader.getSportsGGR(params);
  }

  async getCasinoGGR(params: {
    agentId: string;
    from: Date;
    to: Date;
    scope: 'direct' | 'downline';
  }): Promise<DomainGGRBreakdown> {
    return this.liveReader.getCasinoGGR(params);
  }

  async getMatkaGGR(params: {
    agentId: string;
    from: Date;
    to: Date;
    scope: 'direct' | 'downline';
  }): Promise<DomainGGRBreakdown> {
    return this.liveReader.getMatkaGGR(params);
  }

  async getSportsGGRByAgentIds(params: {
    agentIds: string[];
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<DomainGGRBreakdown> {
    return this.liveReader.getSportsGGRByAgentIds!({ ...params, whitelabelId: params.tenantId });
  }

  async getCasinoGGRByAgentIds(params: {
    agentIds: string[];
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<DomainGGRBreakdown> {
    return this.liveReader.getCasinoGGRByAgentIds!({ ...params, whitelabelId: params.tenantId });
  }

  async getMatkaGGRByAgentIds(params: {
    agentIds: string[];
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<DomainGGRBreakdown> {
    return this.liveReader.getMatkaGGRByAgentIds!({ ...params, whitelabelId: params.tenantId });
  }

  async getGGRByCycleAndAgent(params: {
    agentIds: string[];
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<CycleAgentGGRRow[]> {
    return this.liveReader.getGGRByCycleAndAgent({ ...params, whitelabelId: params.tenantId });
  }

  async countOpenBetsByAgentIds(params: {
    agentIds: string[];
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<OpenBetCounts> {
    return this.liveReader.countOpenBetsByAgentIds({ ...params, whitelabelId: params.tenantId });
  }
}
