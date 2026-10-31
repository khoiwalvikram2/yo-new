import { z } from 'zod'

// Simple environment validation schema - only essential variables
const environmentSchema = z.object({
  // API Configuration
  VITE_API_BASE_URL: z.string().url().default('http://localhost:4000'),
  VITE_GRAPHQL_ENDPOINT: z.string().url().default('http://localhost:4000/graphql'),
  VITE_WS_ENDPOINT: z.string().url().default('ws://localhost:4000/graphql'),
  
  // User Frontend URL (for referral links)
  VITE_USER_FRONTEND_URL: z.string().url().optional(),
  
  // Environment
  VITE_ENVIRONMENT: z.enum(['development', 'staging', 'production']).default('development'),
  VITE_DEBUG: z.string().transform(val => val === 'true').default(false),
})

// Validate environment variables
export const env = environmentSchema.parse(import.meta.env)

// Simple environment configuration
export const environmentConfig = {
  api: {
    baseUrl: env.VITE_API_BASE_URL,
    graphqlEndpoint: env.VITE_GRAPHQL_ENDPOINT,
    wsEndpoint: env.VITE_WS_ENDPOINT,
  },
  userFrontendUrl: env.VITE_USER_FRONTEND_URL,
  environment: env.VITE_ENVIRONMENT,
  debug: env.VITE_DEBUG,
} as const

// Simple helpers
export const isDevelopment = () => environmentConfig.environment === 'development'
export const isProduction = () => environmentConfig.environment === 'production'
export const isDebugMode = () => environmentConfig.debug

// Configuration export
export default environmentConfig
