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
    currencies: (_: any, __: any, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'view')) {
        throw new Error('Forbidden: insufficient permissions for currency')
      }
      return currencyManagementService.getActiveCurrencies()
    },

    currency: (_: any, { code }: { code: string }, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'view')) {
        throw new Error('Forbidden: insufficient permissions for currency')
      }
      
      const upperCode = code.toUpperCase() as CurrencyCode
      if (!currencyManagementService.isValidCurrency(upperCode)) {
        return null
      }
      return currencyManagementService.getCurrency(upperCode)
    },

    convertCurrency: (_: any, { input }: { input: any }, ctx: any) => {
      const validated = CurrencyConversionInputSchema.parse(input)
      
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

    exchangeRates: (_: any, __: any, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'view')) {
        throw new Error('Forbidden: insufficient permissions for currency')
      }
      return currencyManagementService.getActiveCurrencies()
    },
  },

  Mutation: {
    createCurrency: (_: any, { input }: { input: any }, ctx: any) => {
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
        return currencyManagementService.createCurrency({
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

    updateCurrency: (_: any, { input }: { input: any }, ctx: any) => {
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
        return currencyManagementService.updateCurrency(code as CurrencyCode, updates)
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Invalid input data',
          currency: undefined
        }
      }
    },

    deleteCurrency: (_: any, { code }: { code: string }, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'delete')) {
        return {
          success: false,
          message: 'Forbidden: insufficient permissions for currency'
        }
      }
      const upperCode = code.toUpperCase() as CurrencyCode
      if (!currencyManagementService.isValidCurrency(upperCode)) {
        return {
          success: false,
          message: `Currency ${code} not found`
        }
      }
      return currencyManagementService.deleteCurrency(upperCode)
    },

    updateExchangeRates: (_: any, { input }: { input: any }, ctx: any) => {
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
        return currencyManagementService.updateExchangeRates(rates)
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Invalid input data',
          updatedRates: []
        }
      }
    },

    activateCurrency: (_: any, { code }: { code: string }, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'update')) {
        return {
          success: false,
          message: 'Forbidden: insufficient permissions for currency'
        }
      }
      const upperCode = code.toUpperCase() as CurrencyCode
      if (!currencyManagementService.isValidCurrency(upperCode)) {
        return {
          success: false,
          message: `Currency ${code} not found`
        }
      }
      return currencyManagementService.activateCurrency(upperCode)
    },

    deactivateCurrency: (_: any, { code }: { code: string }, ctx: any) => {
      const perms = ctx?.permissions || []
      if (!hasPermission(perms, 'currency.list', 'update')) {
        return {
          success: false,
          message: 'Forbidden: insufficient permissions for currency'
        }
      }
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
