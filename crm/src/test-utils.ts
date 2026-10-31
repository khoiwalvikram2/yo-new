import { InMemoryCache } from '@apollo/client'
import { crmTypePolicies } from '@/lib/apollo'

/**
 * The cache tests hand to MockedProvider.
 *
 * MockedProvider builds its own cache, so without this a test runs against
 * different normalisation rules than the app — and the warnings it produces are
 * about the test's cache, not the one users get. Reusing the app's type
 * policies keeps the two the same.
 */
export const testCache = () => new InMemoryCache({ typePolicies: crmTypePolicies })
