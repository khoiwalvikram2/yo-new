import { ApolloClient, InMemoryCache, HttpLink, from } from '@apollo/client'
import { setContext } from '@apollo/client/link/context'
import { onError } from '@apollo/client/link/error'
import { useAuth, isIdleExpired } from '@/state/auth'

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:4000/graphql' : '/graphql')

const httpLink = new HttpLink({ uri: API_URL, credentials: 'omit' })

/**
 * Attaches the CRM token, and ends a session that has gone idle.
 *
 * The idle check runs before the request rather than on a timer: a tab left
 * open overnight should not be able to make its first request of the morning
 * with last night's session. The server has its own limits — this stops the
 * request from being made at all.
 */
const authLink = setContext((_, { headers }) => {
  const state = useAuth.getState()
  if (state.token && isIdleExpired(state)) {
    state.signOut()
    return { headers }
  }
  state.touch()
  return {
    headers: {
      ...headers,
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      'x-client-type': 'crm',
    },
  }
})

/**
 * A rejected token means the session is over — suspended, roles changed, the
 * whitelabel's CRM switched off. Signing out locally is the honest response;
 * leaving a dead token in place produces a UI that looks signed in and fails
 * every action.
 */
const errorLink = onError(({ graphQLErrors }) => {
  if (!graphQLErrors) return
  const unauthorized = graphQLErrors.some((e) =>
    /unauthor|authentication required/i.test(e.message)
  )
  if (unauthorized && useAuth.getState().token) {
    useAuth.getState().signOut()
  }
})

/**
 * Lists that are replaced whole rather than merged.
 *
 * `CrmPermissionPair` and the timeline entries carry no id, so the cache cannot
 * tell one element from another and warns that data may be lost every time one
 * of these fields is written. Saying `merge: false` states the intent: a new
 * answer for these fields *is* the value, not something to reconcile with the
 * old one. Without it the warning is noise, and noise is where a real warning
 * goes unread.
 *
 * Exported so tests build their cache the same way the app does.
 */
export const crmTypePolicies = {
  CrmMe: {
    fields: {
      permissions: { merge: false },
      bookIds: { merge: false },
    },
  },
  CrmTimelinePage: {
    keyFields: false as const,
    fields: { entries: { merge: false } },
  },
}

export const apolloClient = new ApolloClient({
  link: from([errorLink, authLink, httpLink]),
  cache: new InMemoryCache({ typePolicies: crmTypePolicies }),
  defaultOptions: {
    watchQuery: { fetchPolicy: 'cache-and-network', errorPolicy: 'all' },
    query: { fetchPolicy: 'network-only', errorPolicy: 'all' },
  },
})
