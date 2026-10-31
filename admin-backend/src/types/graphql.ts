import { commonTypes, currencyTypes } from '@src/types/domains/common/index.js'
import { sportsTypes } from '@src/types/domains/sports/index.js'
import { casinoTypes } from '@src/types/domains/casino/index.js'
import { matkaTypes, matkaResultsTypes } from '@src/types/domains/matka/index.js'
import { worliTypes } from '@src/types/domains/matkaWorli/index.js'
import { usersTypes } from '@src/types/domains/users/index.js'
import { playersTypes, ledgerTypes } from '@src/types/domains/players/index.js'
import { rbacTypes } from '@src/types/domains/rbac/index.js'
import { vipTypeDefs } from '@src/types/domains/vip/index.js'
import { marketingTypeDefs } from '@src/types/domains/marketing/index.js'
import { agentsTypes } from '@src/types/domains/agents/index.js'
import { appConfigTypes } from '@src/types/domains/app-config/index.js'
import { referralsTypeDefs } from '@src/types/domains/referrals/index.js'
import { paymentsTypes, pgSettingsTypes } from '@src/types/domains/payments/index.js'
import { depositsTypes } from '@src/types/domains/deposits/index.js'
import { otpTypes } from '@src/types/domains/otp/index.js'
import { reportingTypes } from '@src/types/domains/reporting/index.js'
import { settlementsTypes } from '@src/types/domains/settlements/index.js'
import { notificationsTypes } from '@src/types/domains/notifications/index.js'
import { auditTypes } from '@src/types/domains/audit/index.js'
import { betsTypes } from '@src/types/domains/bets/index.js'
import { searchTypes } from '@src/types/domains/search/index.js'
import { aiAssistantTypes } from '@src/types/domains/aiAssistant/index.js'
import { crmTypes } from '@src/types/domains/crm/index.js'
import { queryTypes, mutationTypes, subscriptionTypes } from '@src/types/operations/index.js'

export const typeDefs = /* GraphQL */ `
  ${commonTypes}
  ${currencyTypes}
  ${sportsTypes}
  ${casinoTypes}
  ${matkaTypes}
  ${matkaResultsTypes}
  ${worliTypes}
  ${usersTypes}
  ${playersTypes}
  ${ledgerTypes}
  ${rbacTypes}
  ${vipTypeDefs}
  ${marketingTypeDefs}
  ${agentsTypes}
  ${appConfigTypes}
  ${referralsTypeDefs}
  ${paymentsTypes}
  ${pgSettingsTypes}
  ${depositsTypes}
  ${otpTypes}
  ${reportingTypes}
  ${settlementsTypes}
  ${notificationsTypes}
  ${auditTypes}
  ${betsTypes}
  ${searchTypes}
  ${aiAssistantTypes}
  ${crmTypes}
  ${queryTypes}
  ${mutationTypes}
  ${subscriptionTypes}
`
