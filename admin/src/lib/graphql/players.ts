import { gql } from '@apollo/client';

export const PLAYER_CREDIT_TRANSACTIONS_QUERY = gql`
	query PlayerCreditTransactions($playerId: ID!, $limit: Int, $offset: Int) {
		playerCreditTransactions(playerId: $playerId, limit: $limit, offset: $offset) {
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
`;

export const PLAYER_CREDIT_STATEMENT_QUERY = gql`
	query PlayerCreditStatement($playerId: ID!, $dateFrom: String!, $dateTo: String!, $limit: Int, $offset: Int) {
		playerCreditStatement(playerId: $playerId, dateFrom: $dateFrom, dateTo: $dateTo, limit: $limit, offset: $offset) {
			playerId
			playerType
			dateFrom
			dateTo
			openingBalance
			closingBalance
			totalRows
			limit
			offset
			summary {
				creditLimit
				creditUsed
				creditAvailable
				settlementBalance
				settlementBalanceSports
				settlementBalanceCasino
				settlementBalanceMatka
			}
			totals {
				totalWon
				totalLost
				netResult
				settlementsTotal
				settlementCount
				betCount
			}
			rows {
				id
				type
				occurredAt
				domain
				reference
				details
				amount
				affectsBalance
				balanceAfter
				valueBefore
				valueAfter
			}
		}
	}
`;
