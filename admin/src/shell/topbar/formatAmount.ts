/** Shape of useCurrency().formatAmount (CurrencyContext.tsx:24-35). Views take it as a prop so they test without providers. */
export type FormatAmount = (amount: number, currencyCode?: string) => string
