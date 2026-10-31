# Agents Domain

Implements Commission (loss-only) and Sharing (GGR share) agent schemes for sports, casino, and matka with custom-period settlements.

## Key rules
- Commission agents: can have nested hierarchy (like sharing/credit). Parent earns (parent_rate - child_rate) on child's downline GGR; child earns on own direct + downline at child rate. Loss-only (GGR > 0). Optional cross-domain tally for standalone commission when equal rates. Child commission rate must be <= parent per domain.
- Sharing agents: up to 4 levels. Earn per-domain share on GGR across downline using hierarchy closure.
- Credit agents: up to 4 levels; hierarchy for credit allocation and settlement cascade.
- Custom settlement window. Settlement posts ledger lines and credits agent wallet; then locks settlement. Commission agents settle independently (payCommission); parent can pay sub-agent commission.

## Tables
- agents, agent_credentials, agent_commission_config, agent_sharing_config
- agent_wallets, agent_ledger, agent_settlements
- agent_hierarchy_closure (sharing, credit, and commission hierarchy)

## Services
- CommissionService: computes per-domain commission, applies tally logic
- SharingService: computes per-domain GGR shares
- SettlementService: orchestrates compute, creates/post settlement, credits wallet
- VerticalReaders: pluggable readers for sports/casino/matka GGR (currently zero-adapter)


