# GraphQL Types Organization

This directory contains all GraphQL type definitions organized by domain and operation type.

## Structure

```
types/
├── domains/                    # Domain-specific types
│   ├── common/                # Common types (Alert, OverviewKPIs, Whitelabel)
│   │   ├── common.graphql     # GraphQL schema with syntax highlighting
│   │   ├── common.ts          # TypeScript imports
│   │   └── index.ts           # Clean exports
│   ├── users/                 # User management types
│   │   ├── users.graphql      # User, Wallet, Role, AuthPayload
│   │   ├── users.ts
│   │   └── index.ts
│   ├── sports/                # Sports betting types
│   │   ├── sports.graphql     # Market, RiskLimit, OrderbookMessage
│   │   ├── sports.ts
│   │   └── index.ts
│   ├── casino/                # Casino types
│   │   ├── casino.graphql     # Game, ProviderMeta, Jackpot, CategoryTree
│   │   ├── casino.ts
│   │   └── index.ts
│   └── matka/                 # Matka types
│       ├── matka.graphql     # Draw, Result, SettlementBatch
│       ├── matka.ts
│       └── index.ts
├── operations/                # GraphQL operations
│   ├── queries.graphql        # Query definitions
│   ├── mutations.graphql      # Mutation definitions
│   ├── subscriptions.graphql # Subscription definitions
│   ├── queries.ts
│   ├── mutations.ts
│   ├── subscriptions.ts
│   └── index.ts
├── graphql.ts                 # Main schema file
└── README.md                  # This file
```

## Benefits

- **Domain Separation**: Each business domain has its own folder
- **Syntax Highlighting**: All .graphql files have beautiful colors
- **Clean Imports**: Index files provide clean import paths
- **Scalable**: Easy to add new domains or types
- **Maintainable**: Clear organization makes it easy to find types

## Usage

```typescript
// Import domain types
import { commonTypes } from './domains/common/index.js'
import { usersTypes } from './domains/users/index.js'

// Import operations
import { queryTypes, mutationTypes } from './operations/index.js'
```

## Adding New Types

1. Create new domain folder: `domains/newdomain/`
2. Add `.graphql` file with syntax highlighting
3. Add `.ts` file with imports
4. Add `index.ts` for clean exports
5. Update main `graphql.ts` file
