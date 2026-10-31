import { useEffect, useId, useState } from 'react'
import { useLazyQuery } from '@apollo/client'
import { IconArrowsLeftRight } from '@tabler/icons-react'
import clsx from 'clsx'
import { CONVERT_CURRENCY } from '@/lib/graphql/currency'
import type { Currency } from '@/shared/types/currency'
import { notify } from '@/shared/services/notification'
import {
  canConvert as canConvertPair,
  conversionWarning,
  converterOptions,
  currencySymbol,
  defaultConversionPair,
  formatConvertedAmount,
  rateLine,
} from '@/routes/currency/currencyManagementModel'
import { Button } from '@/ui/components/Button'
import { Combobox } from '@/ui/components/Combobox'
import { Divider } from '@/ui/components/Divider'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { NumberField } from '@/ui/components/NumberField'
import styles from './CurrencyConverter.module.css'

interface CurrencyConverterProps {
  currencies: Currency[]
}

/**
 * The amount converter: the legacy ConvertCurrency lazy query (no-cache), its defaults (USD to INR, else
 * the first two currencies), its warnings and error copy, and its figures (each currency's own decimals,
 * the rate to six places).
 */
export function CurrencyConverter({
  currencies,
}: CurrencyConverterProps) {
  // The field's own value (null while it is empty); the conversion reads it as the legacy `value || 0`.
  const [amountValue, setAmountValue] = useState<number | null>(1)
  const amount = amountValue || 0
  const [fromCurrency, setFromCurrency] = useState<string>('')
  const [toCurrency, setToCurrency] = useState<string>('')
  const [convertedAmount, setConvertedAmount] = useState<number | null>(null)
  const [exchangeRate, setExchangeRate] = useState<number | null>(null)
  const hintId = useId()

  // Set default currencies when currencies data is available
  useEffect(() => {
    if (currencies.length > 0 && !fromCurrency && !toCurrency) {
      const pair = defaultConversionPair(currencies)
      if (pair) {
        setFromCurrency(pair.from)
        setToCurrency(pair.to)
      }
    }
  }, [currencies, fromCurrency, toCurrency])

  const [convertCurrency, { loading }] = useLazyQuery(CONVERT_CURRENCY, {
    fetchPolicy: 'no-cache',
    onCompleted: (data) => {
      if (data?.convertCurrency) {
        setConvertedAmount(data.convertCurrency.convertedAmount)
        setExchangeRate(data.convertCurrency.rate)
      } else {
        setConvertedAmount(null)
        setExchangeRate(null)
      }
    },
    onError: () => {
      notify.error('Failed to convert currency. Please try again.')
    },
  })

  const handleConvert = async () => {
    const warning = conversionWarning(amount, fromCurrency, toCurrency)
    if (warning) {
      notify.warning(warning)
      return
    }

    try {
      await convertCurrency({
        variables: {
          input: {
            amount,
            from: fromCurrency,
            to: toCurrency,
          },
        },
      })
    } catch {
      // Error already surfaced via onError / notify
    }
  }

  // A shown result belongs to the inputs it was converted from; changing one clears it, as Swap did.
  const clearResult = () => {
    setConvertedAmount(null)
    setExchangeRate(null)
  }

  const handleSwapCurrencies = () => {
    if (!fromCurrency || !toCurrency) return

    setFromCurrency(toCurrency)
    setToCurrency(fromCurrency)
    setConvertedAmount(null)
    setExchangeRate(null)
  }

  const options = converterOptions(currencies)
  const fromSymbol = currencySymbol(fromCurrency, currencies)
  const toSymbol = currencySymbol(toCurrency, currencies)
  const canConvert = canConvertPair(amount, fromCurrency, toCurrency)
  // Why Convert is unavailable, in the legacy warning's own words.
  const hint = canConvert ? null : conversionWarning(amount, fromCurrency, toCurrency)
  const swapUnavailable = !fromCurrency || !toCurrency

  return (
    <div className={styles.converter}>
      <NumberField
        label="Amount"
        value={amountValue}
        onChange={(value) => {
          setAmountValue(value)
          clearResult()
        }}
        min={0}
        step={0.01}
        placeholder="Enter amount"
        prefix={fromSymbol}
      />

      <div className={styles.pair}>
        <Combobox
          label="From"
          placeholder="From"
          options={options}
          value={fromCurrency || null}
          onChange={(value) => {
            setFromCurrency(value ?? '')
            clearResult()
          }}
          className={styles.pairField}
        />

        <IconButton
          variant="bordered"
          label="Swap currencies"
          icon={<IconArrowsLeftRight size={16} stroke={strokeFor(16)} />}
          aria-disabled={swapUnavailable ? true : undefined}
          onClick={handleSwapCurrencies}
          className={styles.swap}
        />

        <Combobox
          label="To"
          placeholder="To"
          options={options}
          value={toCurrency || null}
          onChange={(value) => {
            setToCurrency(value ?? '')
            clearResult()
          }}
          className={styles.pairField}
        />
      </div>

      <div className={styles.convert}>
        <Button
          variant="primary"
          size="lg"
          block
          loading={loading}
          aria-disabled={canConvert ? undefined : true}
          aria-describedby={hint ? hintId : undefined}
          onClick={() => void handleConvert()}
        >
          Convert
        </Button>
        {hint ? <p id={hintId} className={styles.hint}>{hint}</p> : null}
      </div>

      {/* Announced when a conversion lands. */}
      <div className={styles.resultRegion} aria-live="polite">
        {convertedAmount !== null && exchangeRate !== null ? (
          <>
            <Divider />
            <div className={styles.result}>
              <div className={styles.sides}>
                <p className={styles.side}>
                  <span className={styles.sideCode}>{fromCurrency}</span>
                  <span className={styles.sideAmount}>
                    {fromSymbol}{formatConvertedAmount(amount, fromCurrency, currencies)}
                  </span>
                </p>
                <p className={styles.side}>
                  <span className={styles.sideCode}>{toCurrency}</span>
                  <span className={clsx(styles.sideAmount, styles.converted)}>
                    {toSymbol}{formatConvertedAmount(convertedAmount, toCurrency, currencies)}
                  </span>
                </p>
              </div>
              <p className={styles.rateLine}>{rateLine(fromCurrency, exchangeRate, toCurrency)}</p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
