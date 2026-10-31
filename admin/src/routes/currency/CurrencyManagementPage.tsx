import { useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  IconAlertCircle,
  IconCalculator,
  IconCoins,
  IconFilter,
  IconPlus,
  IconSettings,
} from '@tabler/icons-react'
import { useCurrencies, useCurrencyActions } from '@/shared/core/useCurrency'
import { CurrencyTable } from '@/modules/currency/components/CurrencyTable'
import { CurrencyForm } from '@/modules/currency/components/CurrencyForm'
import { CurrencyConverter } from '@/modules/currency/components/CurrencyConverter'
import { StatsCards } from './components/StatsCards'
import { FiltersBar } from './components/FiltersBar'
import type { Currency, CreateCurrencyInput, UpdateCurrencyInput } from '@/shared/types/currency'
import { notify } from '@/shared/services/notification'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Dialog } from '@/ui/components/Dialog'
import { strokeFor } from '@/ui/components/icons'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { Select } from '@/ui/components/Select'
import { Stat } from '@/ui/components/Stat'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import {
  CURRENCY_VIEWS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  activeCurrenciesOf,
  clampPage,
  defaultCurrencyOptions,
  defaultCurrencySymbol,
  filterCurrencies,
  inactiveCurrenciesOf,
  pageSlice,
  readDefaultCurrency,
  storeDefaultCurrency,
  type CurrencyView,
} from './currencyManagementModel'
import styles from './CurrencyManagementPage.module.css'

const PAGE_TITLE = 'Currency Management'
const PAGE_SUB = 'Manage currencies, exchange rates, and conversions'
const VIEWS_ID = 'currency-management'
const VIEW_ICON_SIZE = 15

const VIEW_ICONS: Record<CurrencyView, ReactElement> = {
  currencies: <IconCoins size={VIEW_ICON_SIZE} stroke={strokeFor(VIEW_ICON_SIZE)} />,
  converter: <IconCalculator size={VIEW_ICON_SIZE} stroke={strokeFor(VIEW_ICON_SIZE)} />,
  settings: <IconSettings size={VIEW_ICON_SIZE} stroke={strokeFor(VIEW_ICON_SIZE)} />,
}

const VIEW_ITEMS: TabItem<CurrencyView>[] = CURRENCY_VIEWS.map((view) => ({
  value: view.value,
  label: view.label,
  icon: VIEW_ICONS[view.value],
}))

export default function CurrencyManagementPageWrapper() {
  return (
    <RBACGuard required={[{ domain: 'currency.list', actions: ['view'] }]}>
      <CurrencyManagementPageContent />
    </RBACGuard>
  )
}

/** The default display currency: the stored choice and the two legacy read-outs. */
function CurrencySettings({
  defaultCurrency,
  activeCurrencies,
  onChange,
}: {
  defaultCurrency: string
  activeCurrencies: Currency[]
  onChange: (currencyCode: string) => void
}) {
  const defaultTitleId = useId()
  const currentTitleId = useId()
  const symbol = defaultCurrencySymbol(activeCurrencies, defaultCurrency)

  return (
    <Card title="Currency Settings">
      <div className={styles.settings}>
        <section className={styles.settingSection} aria-labelledby={defaultTitleId}>
          <h3 id={defaultTitleId} className={styles.settingTitle}>Default Display Currency</h3>
          <p className={styles.settingText}>
            This currency will be used to display all financial data across the admin panel.
            When switching whitelabels, data will be converted from the whitelabel&apos;s base currency to this
            default currency.
          </p>
          <Select
            label="Default Display Currency"
            hideLabel
            value={defaultCurrency}
            onChange={onChange}
            placeholder="Select default currency"
            options={defaultCurrencyOptions(activeCurrencies, defaultCurrency)}
            className={styles.defaultSelect}
          />
        </section>

        <section className={styles.settingSection} aria-labelledby={currentTitleId}>
          <h3 id={currentTitleId} className={styles.settingTitle}>Current Settings</h3>
          <Grid cols={{ base: 1, md: 2 }} gap={12}>
            <div className={styles.settingTile}>
              <Stat
                variant="bare"
                label="Default Currency"
                value={symbol ? `${symbol} ${defaultCurrency}` : defaultCurrency}
              />
            </div>
            <div className={styles.settingTile}>
              <Stat
                variant="bare"
                label="Active Currencies"
                value={(
                  <>
                    {activeCurrencies.length}{' '}
                    <span className={styles.statSuffix}>currencies</span>
                  </>
                )}
              />
            </div>
          </Grid>
        </section>
      </div>
    </Card>
  )
}

function CurrencyManagementPageContent() {
  const pageEyebrow = usePageEyebrow()
  const { data, loading, error, refetch } = useCurrencies()
  const { createCurrency, updateCurrency, loading: actionLoading } = useCurrencyActions()

  const [showForm, setShowForm] = useState(false)
  const [editingCurrency, setEditingCurrency] = useState<Currency | undefined>()
  const [activeTab, setActiveTab] = useState<CurrencyView>('currencies')
  // The stored default is read before the first paint (the legacy effect showed INR for one render).
  const [defaultCurrency, setDefaultCurrency] = useState<string>(() => readDefaultCurrency())
  // The dialog's first focus: the code on create, the name on edit.
  const firstFieldRef = useRef<HTMLInputElement>(null)

  // Filter states
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const currencies: Currency[] = data?.currencies || []
  const activeCurrencies = activeCurrenciesOf(currencies)
  const inactiveCurrencies = inactiveCurrenciesOf(currencies)

  // Filter currencies based on search and status
  const filteredCurrencies = filterCurrencies(currencies, query, status)

  // Pagination (a page left past the end by a filter shows the last page)
  const shownPage = clampPage(currentPage, filteredCurrencies.length, pageSize)
  const paginatedCurrencies = pageSlice(filteredCurrencies, shownPage, pageSize)

  const handleCreateCurrency = async (input: CreateCurrencyInput) => {
    const close = notify.loading('Creating currency...')
    try {
      const result = await createCurrency(input)
      if (result.data?.createCurrency?.success) {
        setShowForm(false)
        await refetch() // Refresh the data
        notify.success('Currency created successfully')
      } else {
        notify.error(result.data?.createCurrency?.message || 'Failed to create currency')
      }
    } catch {
      notify.error('Failed to create currency')
    } finally {
      if (close) close()
    }
  }

  const handleUpdateCurrency = async (input: UpdateCurrencyInput) => {
    const close = notify.loading('Updating currency...')
    try {
      const result = await updateCurrency(input)
      if (result.data?.updateCurrency?.success) {
        // The dialog closes on a saved edit (legacy cleared only the record, so the open dialog turned
        // into "Create New Currency" holding the edited values).
        setShowForm(false)
        setEditingCurrency(undefined)
        await refetch() // Refresh the data
        notify.success('Currency updated successfully')
      } else {
        notify.error(result.data?.updateCurrency?.message || 'Failed to update currency')
      }
    } catch {
      notify.error('Failed to update currency')
    } finally {
      if (close) close()
    }
  }

  // Returned, so the form stays busy until the save settles.
  const handleFormSubmit = (values: CreateCurrencyInput | UpdateCurrencyInput) => {
    if (editingCurrency) {
      return handleUpdateCurrency(values as UpdateCurrencyInput)
    }
    return handleCreateCurrency(values as CreateCurrencyInput)
  }

  const handleEditCurrency = (currency: Currency) => {
    setEditingCurrency(currency)
    setShowForm(true)
  }

  const handleCancelForm = () => {
    setShowForm(false)
    setEditingCurrency(undefined)
  }

  // Exchange rates tab removed per requirement; all related handlers deleted

  const handleRefresh = () => {
    void refetch()
  }

  const handleSetDefaultCurrency = (currencyCode: string) => {
    setDefaultCurrency(currencyCode)
    if (storeDefaultCurrency(currencyCode)) {
      notify.success(`Default display currency set to ${currencyCode}`)
    }
  }

  // The legacy view switch and its panel. As before, only the converter and settings views draw it, and
  // nothing opens either view: the legacy CurrencyTable ignored its mainActiveTab / onMainTabChange props,
  // so the currencies view never had a switch. Both views stay unreachable until the owner decides whether
  // to expose them (record, owner question a); drawing this switch on the currencies view would do that.
  const renderSwitchedView = (body: ReactNode) => (
    <>
      <Tabs
        value={activeTab}
        items={VIEW_ITEMS}
        onChange={setActiveTab}
        label="Currency views"
        idPrefix={VIEWS_ID}
        className={styles.tabs}
      />
      <div
        className={styles.panel}
        role="tabpanel"
        id={tabPanelId(VIEWS_ID, activeTab)}
        aria-labelledby={tabId(VIEWS_ID, activeTab)}
      >
        {body}
      </div>
    </>
  )

  const renderContent = () => {
    switch (activeTab) {
      // The only reachable view: no view switch, as before.
      case 'currencies':
        return (
          <div className={styles.panel}>
            <FiltersBar
              query={query}
              status={status}
              onChangeQuery={setQuery}
              onChangeStatus={setStatus}
              onClearAll={() => {
                setQuery('')
                setStatus('')
                setCurrentPage(1)
              }}
            />
            <CurrencyTable
              currencies={paginatedCurrencies}
              loading={loading}
              onEdit={handleEditCurrency}
              footer={!loading && filteredCurrencies.length > 0 ? (
                <Pagination
                  current={shownPage}
                  pageSize={pageSize}
                  total={filteredCurrencies.length}
                  onChange={setCurrentPage}
                  onPageSizeChange={setPageSize}
                  itemName="currencies"
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  variant="embedded"
                />
              ) : null}
            />
          </div>
        )
      case 'converter':
        return renderSwitchedView(
          <Card title="Currency Converter">
            <CurrencyConverter currencies={currencies} />
          </Card>,
        )
      case 'settings':
        return renderSwitchedView(
          <CurrencySettings
            defaultCurrency={defaultCurrency}
            activeCurrencies={activeCurrencies}
            onChange={handleSetDefaultCurrency}
          />,
        )
      default:
        return null
    }
  }

  // Show error state
  if (error) {
    return (
      <Page maxWidth="wide">
        <PageHeader eyebrow={pageEyebrow} title={PAGE_TITLE} sub={PAGE_SUB} />
        <Notice
          tone="error"
          live="assertive"
          icon={<IconAlertCircle size={18} stroke={strokeFor(18)} />}
          title="Error Loading Currencies"
          action={(
            <Button size="sm" variant="danger" onClick={handleRefresh}>
              Retry
            </Button>
          )}
        >
          {error.message || 'Failed to load currency data. Please try again.'}
        </Notice>
      </Page>
    )
  }

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title={PAGE_TITLE}
        sub={PAGE_SUB}
        actions={(
          <>
            {/* Legacy: this button has never had an action. */}
            <Button icon={<IconFilter size={16} stroke={strokeFor(16)} />}>Bulk Actions</Button>
            <Button
              variant="primary"
              icon={<IconPlus size={16} stroke={strokeFor(16)} />}
              onClick={() => {
                setActiveTab('currencies')
                setEditingCurrency(undefined)
                setShowForm(true)
              }}
            >
              Add Currency
            </Button>
          </>
        )}
      />

      <div className={styles.content}>
        <StatsCards
          currencies={currencies}
          activeCurrencies={activeCurrencies}
          inactiveCurrencies={inactiveCurrencies}
          loading={loading}
        />

        {renderContent()}
      </div>

      {/* Create / Edit Currency dialog. Closed, it renders nothing, so the form mounts with its record. */}
      <Dialog
        title={editingCurrency ? 'Edit Currency' : 'Create New Currency'}
        open={showForm}
        onOpenChange={(open) => {
          if (!open) handleCancelForm()
        }}
        size="md"
        initialFocus={firstFieldRef}
      >
        <CurrencyForm
          key={editingCurrency?.code ?? 'new'}
          currency={editingCurrency}
          onSubmit={handleFormSubmit}
          onCancel={handleCancelForm}
          loading={actionLoading.create || actionLoading.update}
          inModal
          firstFieldRef={firstFieldRef}
        />
      </Dialog>
    </Page>
  )
}
