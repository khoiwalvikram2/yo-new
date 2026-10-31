import { gql } from '@apollo/client';

export const ADJUST_SUB_AGENT_CREDIT_MUTATION = gql`
  mutation AdjustSubAgentCredit($agentId: ID!, $creditLimit: Float!) {
    agents {
      adjustSubAgentCredit(agentId: $agentId, creditLimit: $creditLimit) {
        success
        message
        agent {
          id
          creditLimit
          creditUsed
          creditAvailable
        }
      }
    }
  }
`;

export const CREDIT_ALLOCATION = gql`
	query CreditAllocation($agentId: ID!) {
		agents {
			creditAllocation(agentId: $agentId) {
				agentId
				creditLimit
				creditUsed
				creditAvailable
				creditAlertThreshold
				usagePercentage
				isOverLimit
				isNearThreshold
			}
		}
	}
`;

export const CREDIT_TRANSACTION_HISTORY = gql`
	query CreditTransactionHistory(
		$entityType: String!
		$entityId: ID!
		$transactionTypes: [CreditTransactionType!]
		$from: String
		$to: String
		$limit: Int
	) {
		agents {
			creditTransactionHistory(
				entityType: $entityType
				entityId: $entityId
				transactionTypes: $transactionTypes
				from: $from
				to: $to
				limit: $limit
			) {
				id
				fromEntityType
				fromEntityId
				toEntityType
				toEntityId
				transactionType
				amount
				currency
				balanceBefore
				balanceAfter
				reason
				createdBy
				betId
				settlementId
				cashoutId
				createdByType
				createdAt
			}
		}
	}
`;

export const AGENT_PLAYER_CREDITS = gql`
	query AgentPlayerCredits($agentId: ID!) {
		agents {
			agentPlayerCredits(agentId: $agentId) {
				playerId
				playerName
				creditLimit
				currentBalance
				openExposure
				creditUsed
				creditAvailable
			}
		}
	}
`;

export const ALLOCATE_CREDIT_TO_PLAYER = gql`
	mutation AllocateCreditToPlayer($input: AllocateCreditToPlayerInput!) {
		agents {
			allocateCreditToPlayer(input: $input) {
				playerId
				playerName
				creditLimit
				currentBalance
				openExposure
				creditUsed
				creditAvailable
			}
		}
	}
`;

export const DEPOSIT_CREDIT = gql`
	mutation DepositCredit($input: CreditOperationInput!) {
		agents {
			depositCredit(input: $input) {
				agentId
				creditLimit
				creditUsed
				creditAvailable
				creditAlertThreshold
				usagePercentage
				isOverLimit
				isNearThreshold
			}
		}
	}
`;

export const WITHDRAW_CREDIT = gql`
	mutation WithdrawCredit($input: CreditOperationInput!) {
		agents {
			withdrawCredit(input: $input) {
				agentId
				creditLimit
				creditUsed
				creditAvailable
				creditAlertThreshold
				usagePercentage
				isOverLimit
				isNearThreshold
			}
		}
	}
`;

export const TRANSFER_CREDIT = gql`
	mutation TransferCredit($input: TransferCreditInput!) {
		agents {
			transferCredit(input: $input)
		}
	}
`;

export const SETTLE_SHARING_AGENT = gql`
	mutation SettleSharingAgent($input: SettlementInput!) {
		agents {
			settleSharingAgent(input: $input) {
				id
				agentId
				periodFrom
				periodTo
				totalAmount
				currency
				status
				postedAt
				postedBy
				createdAt
			}
		}
	}
`;

export const PREVIEW_CREDIT_RECONCILIATION = gql`
	query PreviewCreditReconciliation($agentId: ID!) {
		agents {
			previewCreditReconciliation(agentId: $agentId) {
				agentId
				currentUsed
				calculatedUsed
				delta
				affectedPlayers {
					playerId
					currentUsed
					calculatedUsed
					delta
					currentBalance
					openExposure
				}
				subAgentAllocations
			}
		}
	}
`;

export const APPLY_CREDIT_RECONCILIATION = gql`
	mutation ApplyCreditReconciliation($agentId: ID!) {
		agents {
			applyCreditReconciliation(agentId: $agentId)
		}
	}
`;

export const AGENT_CREDIT_ALERTS_QUERY = gql`
	query AgentCreditAlerts($agentId: ID!, $isActive: Boolean) {
		agents {
			agentCreditAlerts(agentId: $agentId, isActive: $isActive) {
				id
				agentId
				alertType
				threshold
				currentValue
				isActive
				notifiedAt
				createdAt
			}
		}
	}
`;

// Legacy export for backward compatibility
export const AGENT_CREDIT_ALERTS = AGENT_CREDIT_ALERTS_QUERY;

export const SET_AGENT_CREDIT_ALERT_THRESHOLD = gql`
	mutation SetAgentCreditAlertThreshold($agentId: ID!, $threshold: Float!) {
		agents {
			setAgentCreditAlertThreshold(agentId: $agentId, threshold: $threshold) {
				agentId
				creditLimit
				creditUsed
				creditAvailable
				creditAlertThreshold
				usagePercentage
				isOverLimit
				isNearThreshold
			}
		}
	}
`;

export const RESOLVE_AGENT_CREDIT_ALERT = gql`
	mutation ResolveAgentCreditAlert($alertId: ID!) {
		agents {
			resolveAgentCreditAlert(alertId: $alertId)
		}
	}
`;

export const WHITELABEL_CREDIT_PLAYERS_QUERY = gql`
	query WhitelabelCreditPlayers {
		agents {
			whitelabelCreditPlayers {
				id
				name
				email
				phone
				creditLimit
				creditUsed
				creditAvailable
			}
		}
	}
`;

// Export alias for backward compatibility
export const WHITELABEL_CREDIT_PLAYERS = WHITELABEL_CREDIT_PLAYERS_QUERY;

export const ADJUST_WHITELABEL_PLAYER_CREDIT = gql`
	mutation AdjustWhitelabelPlayerCredit($input: AdjustWhitelabelPlayerCreditInput!) {
		agents {
			adjustWhitelabelPlayerCredit(input: $input) {
				id
				name
				email
				phone
				creditLimit
				creditUsed
				creditAvailable
			}
		}
	}
`;

export const DEPOSIT_CREDIT_TO_WHITELABEL_PLAYER = gql`
	mutation DepositCreditToWhitelabelPlayer($input: WhitelabelCreditOperationInput!) {
		agents {
			depositCreditToWhitelabelPlayer(input: $input) {
				id
				name
				email
				phone
				creditLimit
				creditUsed
				creditAvailable
			}
		}
	}
`;

export const WITHDRAW_CREDIT_FROM_WHITELABEL_PLAYER = gql`
	mutation WithdrawCreditFromWhitelabelPlayer($input: WhitelabelCreditOperationInput!) {
		agents {
			withdrawCreditFromWhitelabelPlayer(input: $input) {
				id
				name
				email
				phone
				creditLimit
				creditUsed
				creditAvailable
			}
		}
	}
`;

// Agent Credit Queries (for current logged-in agent)
export const MY_AGENT_CREDIT_QUERY = gql`
	query MyAgentCredit {
		myAgentCredit {
			creditLimit
			creditUsed
			creditAvailable
			creditAlertThreshold
			settlementBalance
			settlementBalanceSports
			settlementBalanceCasino
			settlementBalanceMatka
			usagePercentage
			isNearLimit
		}
	}
`;

export const MY_AGENT_CREDIT_HISTORY_QUERY = gql`
	query MyAgentCreditHistory($limit: Int, $offset: Int) {
		myAgentCreditHistory(limit: $limit, offset: $offset) {
			id
			transactionType
			amount
			balanceBefore
			balanceAfter
			reason
			createdBy
			createdByType
			createdAt
		}
	}
`;

export const MY_AGENT_SETTLEMENTS_QUERY = gql`
	query MyAgentSettlements($limit: Int, $offset: Int) {
		myAgentSettlements(limit: $limit, offset: $offset) {
			agentSettlements {
				id
				tenant
				agentId
				settlementType
				amount
				direction
				previousBalance
				newBalance
				notes
				settledBy
				createdAt
			}
			creditTransactions {
				id
				transactionType
				amount
				balanceBefore
				balanceAfter
				reason
				createdBy
				createdByType
				createdAt
			}
			totalAgentSettled
			totalCreditTransactions
		}
	}
`;

export const AGENT_CREDIT_TRANSACTIONS_QUERY = gql`
	query AgentCreditTransactions($agentId: ID!, $limit: Int, $offset: Int) {
		agents {
      agentCreditTransactionsCount(agentId: $agentId)
			agentCreditTransactions(agentId: $agentId, limit: $limit, offset: $offset) {
				id
				fromEntityType
				fromEntityId
				toEntityType
				toEntityId
				transactionType
				amount
				currency
				balanceBefore
				balanceAfter
				reason
				createdBy
				betId
				settlementId
				cashoutId
				createdByType
				metadata
				createdAt
			}
		}
	}
`;

export const AGENT_CREDIT_UPDATED_SUBSCRIPTION = gql`
	subscription AgentCreditUpdated($agentId: ID!) {
		agentCreditUpdated(agentId: $agentId) {
			agentId
			creditLimit
			creditUsed
			creditAvailable
			creditAlertThreshold
			usagePercentage
			isOverLimit
			isNearThreshold
		}
	}
`;
