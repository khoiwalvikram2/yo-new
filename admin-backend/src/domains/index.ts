import { sportsResolvers } from '@src/domains/sports/resolvers/index.js'
import { casinoResolvers } from '@src/domains/casino/resolvers/index.js'
import { usersResolvers } from '@src/domains/users/resolvers/index.js'
import { playersResolvers } from '@src/domains/players/resolvers/index.js'
import { rbacResolvers } from '@src/domains/rbac/resolvers/index.js'
import { matkaResolvers } from '@src/domains/matka/resolvers/index.js'
import { worliResolvers } from '@src/domains/matka-worli/resolvers/index.js'
import { agentsResolvers } from '@src/domains/agents/resolvers/index.js'
import { reportingResolvers } from '@src/domains/reporting/resolvers/index.js'
import { auditResolvers } from '@src/domains/audit/resolvers/index.js'
import { commonResolvers } from '@src/domains/common/resolvers/index.js'
import { vipResolvers } from '@src/domains/vip/resolvers/index.js'
import { appConfigResolvers } from '@src/domains/app-config/resolvers/index.js'
import { marketingResolvers } from '@src/domains/marketing/resolvers/index.js'
import { referralsResolvers } from '@src/domains/referrals/resolvers/index.js'
import { paymentsResolvers } from '@src/domains/payments/resolvers/index.js'
import { depositsResolvers } from '@src/domains/deposits/resolvers/index.js'
import { otpResolvers } from '@src/domains/otp/resolvers/index.js'
import { settlementsResolvers } from '@src/domains/settlements/resolvers/index.js'
import { notificationsResolvers } from '@src/domains/notifications/resolvers/index.js'
import { betsResolvers } from '@src/domains/bets/resolvers/index.js'
import { searchResolvers } from '@src/domains/search/resolvers/index.js'
import { aiAssistantResolvers } from '@src/domains/aiAssistant/resolvers/index.js'
import { crmResolvers } from '@src/domains/crm/resolvers/index.js'
import { guardAdminSurface } from '@src/domains/crmSurfaceGuard.js'
import { guardSubscriptions } from '@src/domains/common/guardSubscriptions.js'

// Combine all domain resolvers
const rawResolvers = {
  Query: {
    ...commonResolvers.Query,
    ...sportsResolvers.Query,
    ...casinoResolvers.Query,
    ...usersResolvers.Query,
    ...playersResolvers.Query,
    ...rbacResolvers.Query,
    ...matkaResolvers.Query,
    ...worliResolvers.Query,
    ...agentsResolvers.Query,
    ...reportingResolvers.Query,
    ...auditResolvers.Query,
    ...vipResolvers.Query,
    ...appConfigResolvers.Query,
    ...marketingResolvers.Query,
    ...referralsResolvers.Query,
    ...paymentsResolvers.Query,
    ...depositsResolvers.Query,
    ...otpResolvers.Query,
    ...settlementsResolvers.Query,
    ...notificationsResolvers.Query,
    ...betsResolvers.Query,
    ...searchResolvers.Query,
    ...aiAssistantResolvers.Query,
    ...crmResolvers.Query,
  },
  Mutation: {
    ...aiAssistantResolvers.Mutation,
    ...crmResolvers.Mutation,
    ...commonResolvers.Mutation,
    ...sportsResolvers.Mutation,
    ...casinoResolvers.Mutation,
    ...usersResolvers.Mutation,
    ...playersResolvers.Mutation,
    ...rbacResolvers.Mutation,
    ...matkaResolvers.Mutation,
    ...worliResolvers.Mutation,
    ...agentsResolvers.Mutation,
    ...reportingResolvers.Mutation,
    ...auditResolvers.Mutation,
    ...vipResolvers.Mutation,
    ...appConfigResolvers.Mutation,
    ...marketingResolvers.Mutation,
    ...referralsResolvers.Mutation,
    ...paymentsResolvers.Mutation,
    ...depositsResolvers.Mutation,
    ...otpResolvers.Mutation,
    ...settlementsResolvers.Mutation,
    ...notificationsResolvers.Mutation,
  },
  // Every subscription is gated per field. `guardAdminSurface` wraps Query and
  // Mutation and structurally cannot reach these, because they are
  // `{subscribe, resolve}` objects rather than functions — so until now a
  // signed-in admin holding nothing reached 30 of the 32. See
  // guardSubscriptions.ts, and `npm run probe:subscriptions` for the measurement.
  Subscription: guardSubscriptions({
    ...commonResolvers.Subscription,
    ...sportsResolvers.Subscription,
    ...casinoResolvers.Subscription,
    ...matkaResolvers.Subscription,
    ...worliResolvers.Subscription,
    ...agentsResolvers.Subscription,
    ...auditResolvers.Subscription,
    ...notificationsResolvers.Subscription,
    ...depositsResolvers.Subscription,
  }),
  // Type resolvers
  AgentsQuery: agentsResolvers.AgentsQuery,
  AgentsMutation: agentsResolvers.AgentsMutation,
  AgentAccount: agentsResolvers.AgentAccount,
  ReportingQuery: reportingResolvers.ReportingQuery,
  AppConfig: appConfigResolvers.AppConfig,
  Advertisement: appConfigResolvers.Advertisement,
  AuditEvent: auditResolvers.AuditEvent,
  Whitelabel: commonResolvers.Whitelabel,
  Market: commonResolvers.Market,
  Game: commonResolvers.Game,
  User: commonResolvers.User,
  PlayerBonus: commonResolvers.PlayerBonus,
  CasinoCategory: casinoResolvers.CasinoCategory,
  BetItem: betsResolvers.BetItem,
}

/**
 * Every admin-surface field refuses a CRM principal.
 *
 * Applied once, here, rather than resolver by resolver: the two applications
 * share one endpoint, and a field that forgets the check is indistinguishable
 * from one that does not need it. See domains/crmSurfaceGuard.ts.
 */
export const domainResolvers = {
  ...rawResolvers,
  Query: guardAdminSurface(rawResolvers.Query),
  Mutation: guardAdminSurface(rawResolvers.Mutation),
}
