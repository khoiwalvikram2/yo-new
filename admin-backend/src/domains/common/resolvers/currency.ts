import { currencyService } from '@src/services/currencyService'
import { currencyManagementService } from '@src/services/currencyManagementService'
import { CurrencyCode } from '@src/types/currency'
import { z } from 'zod'

const CurrencyConversionInputSchema = z.object({
  amount: z.number().positive(),
  from: z.string().min(3).max(3),
  to: z.string().min(3).max(3),
})

const CreateCurrencyInputSchema = z.object({
  code: z.string().length(3).regex(/^[A-Z]{3}$/),
  name: z.string().min(1),
  symbol: z.string().min(1),
  decimals: z.number().int().min(0).max(8),
  exchangeRate: z.number().positive().optional(),
})

const UpdateCurrencyInputSchema = z.object({
  code: z.string().length(3).regex(/^[A-Z]{3}$/),
  name: z.string().min(1).optional(),
  symbol: z.string().min(1).optional(),
  decimals: z.number().int().min(0).max(8).optional(),
  isActive: z.boolean().optional(),
  exchangeRate: z.number().positive().optional(),
})

const UpdateExchangeRatesInputSchema = z.object({
  rates: z.array(z.object({
    currency: z.string().length(3).regex(/^[A-Z]{3}$/),
    rate: z.number().positive(),
  })).min(1),
})

import { hasPermission } from '@/domains/common/auth.js'

export const currencyResolvers = {
  Query: {
    // Active currencies (the display-currency list everyone reads). The Currency Management page asks for
    // inactive ones too: it is where they are activated again or deleted, and they used to vanish from it.
    currencies: async (_: any, args: { includeInactive?: boolean | null } | undefined, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'view')) {
        throw new Error('Forbidden: insufficient permissions for currency')
      }
      await currencyManagementService.ready()
      return args?.includeInactive
        ? currencyManagementService.getAllCurrencies()
        : currencyManagementService.getActiveCurrencies()
    },

    currency: async (_: any, { code }: { code: string }, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'view')) {
        throw new Error('Forbidden: insufficient permissions for currency')
      }
      await currencyManagementService.ready()

      const upperCode = code.toUpperCase() as CurrencyCode
      if (!currencyManagementService.isValidCurrency(upperCode)) {
        return null
      }
      return currencyManagementService.getCurrency(upperCode)
    },

    convertCurrency: async (_: any, { input }: { input: any }, ctx: any) => {
      const validated = CurrencyConversionInputSchema.parse(input)
      // currencyService reads the page's currencies: the rate saved there is the rate used here.
      await currencyManagementService.ready()

      if (!currencyService.isValidCurrency(validated.from)) {
        throw new Error(`Invalid currency code: ${validated.from}`)
      }
      
      if (!currencyService.isValidCurrency(validated.to)) {
        throw new Error(`Invalid currency code: ${validated.to}`)
      }

      return currencyService.convertAmount(
        validated.amount,
        validated.from as CurrencyCode,
        validated.to as CurrencyCode
      )
    },

    exchangeRates: async (_: any, __: any, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'view')) {
        throw new Error('Forbidden: insufficient permissions for currency')
      }
      await currencyManagementService.ready()
      return currencyManagementService.getActiveCurrencies()
    },
  },

  // Each change is saved (currencyStore) before it answers; a change that cannot be saved is refused.
  Mutation: {
    createCurrency: async (_: any, { input }: { input: any }, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'create')) {
        return {
          success: false,
          message: 'Forbidden: insufficient permissions for currency',
          currency: undefined
        }
      }
      try {
        // Normalize the input - convert code to uppercase
        const normalizedInput = {
          ...input,
          code: input.code?.toUpperCase()
        }
        
        const validated = CreateCurrencyInputSchema.parse(normalizedInput)
        return await currencyManagementService.createCurrency({
          ...validated,
          isActive: true // Default to active
        })
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Invalid input data',
          currency: undefined
        }
      }
    },

    updateCurrency: async (_: any, { input }: { input: any }, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'update')) {
        return {
          success: false,
          message: 'Forbidden: insufficient permissions for currency',
          currency: undefined
        }
      }
      try {
        // Normalize the input - convert code to uppercase
        const normalizedInput = {
          ...input,
          code: input.code?.toUpperCase()
        }
        
        const validated = UpdateCurrencyInputSchema.parse(normalizedInput)
        const { code, ...updates } = validated
        return await currencyManagementService.updateCurrency(code as CurrencyCode, updates)
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Invalid input data',
          currency: undefined
        }
      }
    },

    deleteCurrency: async (_: any, { code }: { code: string }, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'delete')) {
        return {
          success: false,
          message: 'Forbidden: insufficient permissions for currency'
        }
      }
      await currencyManagementService.ready()
      const upperCode = code.toUpperCase() as CurrencyCode
      if (!currencyManagementService.isValidCurrency(upperCode)) {
        return {
          success: false,
          message: `Currency ${code} not found`
        }
      }
      return currencyManagementService.deleteCurrency(upperCode)
    },

    updateExchangeRates: async (_: any, { input }: { input: any }, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'update')) {
        return {
          success: false,
          message: 'Forbidden: insufficient permissions for currency',
          updatedRates: []
        }
      }
      try {
        const validated = UpdateExchangeRatesInputSchema.parse(input)
        const rates = validated.rates.map((r: any) => ({
          currency: r.currency.toUpperCase() as CurrencyCode,
          rate: r.rate
        }))
        return await currencyManagementService.updateExchangeRates(rates)
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Invalid input data',
          updatedRates: []
        }
      }
    },

    activateCurrency: async (_: any, { code }: { code: string }, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'update')) {
        return {
          success: false,
          message: 'Forbidden: insufficient permissions for currency'
        }
      }
      await currencyManagementService.ready()
      const upperCode = code.toUpperCase() as CurrencyCode
      if (!currencyManagementService.isValidCurrency(upperCode)) {
        return {
          success: false,
          message: `Currency ${code} not found`
        }
      }
      return currencyManagementService.activateCurrency(upperCode)
    },

    deactivateCurrency: async (_: any, { code }: { code: string }, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'update')) {
        return {
          success: false,
          message: 'Forbidden: insufficient permissions for currency'
        }
      }
      await currencyManagementService.ready()
      const upperCode = code.toUpperCase() as CurrencyCode
      if (!currencyManagementService.isValidCurrency(upperCode)) {
        return {
          success: false,
          message: `Currency ${code} not found`
        }
      }
      return currencyManagementService.deactivateCurrency(upperCode)
    },
  },
}
