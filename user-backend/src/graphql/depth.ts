import depthLimit from 'graphql-depth-limit'

/**
 * Caps GraphQL query nesting. Without a limit a self-referencing selection can
 * be nested arbitrarily deep, letting one small request force the server to
 * resolve an exponential number of fields.
 *
 * Matches admin-backend's limit so both APIs behave the same.
 */
export const queryDepthLimit = depthLimit(6)
