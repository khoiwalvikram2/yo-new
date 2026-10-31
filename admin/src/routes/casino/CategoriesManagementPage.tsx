import { useState } from 'react'
import { useApolloClient, useMutation } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import { IconPlus } from '@tabler/icons-react'
import {
  CASINO_CUSTOM_CATEGORIES,
  CREATE_CASINO_CATEGORY,
  UPDATE_CASINO_CATEGORY,
} from '@/lib/graphql/casino'
import { ROUTES } from '@/shared/core/constants'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { FilterBar } from '@/ui/components/FilterBar'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import { CategoriesDashboard } from './components/CategoriesDashboard'
import CategoryFormDrawer from './components/CategoryFormDrawer'
import { CategoryStatsCards } from './components/CategoryStatsCards'
import {
  CREATE_CATEGORY_LABEL,
  DEFAULT_MAIN_CATEGORY,
  DEFAULT_TYPE_FILTER,
  MAIN_CATEGORY_OPTIONS,
  PAGE_SUB,
  PAGE_TITLE,
  TYPE_FILTER_OPTIONS,
  categoryUpdatePatch,
  saveErrorToast,
  saveSuccessToast,
  type CasinoCategory,
  type CategorySubmitValues,
  type DrawerMode,
  type MainCategory,
  type TypeFilter,
} from './categoriesManagementModel'
import styles from './CategoriesManagementPage.module.css'

export default function CategoriesManagementPage() {
  return (
    <RBACGuard required={[{ domain: 'casino.categories', actions: ['view'] }]}>
      <CategoriesManagementPageContent />
    </RBACGuard>
  )
}

function CategoriesManagementPageContent() {
  const navigate = useNavigate()
  const pageEyebrow = usePageEyebrow()
  const apolloClient = useApolloClient()
  const [mainCategory, setMainCategory] = useState<MainCategory>(DEFAULT_MAIN_CATEGORY)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(DEFAULT_TYPE_FILTER)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('create')
  const [editing, setEditing] = useState<CasinoCategory | null>(null)

  const [createCategory] = useMutation(CREATE_CASINO_CATEGORY, {
    context: { skipNotification: true },
  })
  const [updateCategory] = useMutation(UPDATE_CASINO_CATEGORY, {
    context: { skipNotification: true },
  })

  const activeFilterCount =
    Number(mainCategory !== DEFAULT_MAIN_CATEGORY) + Number(typeFilter !== DEFAULT_TYPE_FILTER)
  const clearFilters = () => {
    setMainCategory(DEFAULT_MAIN_CATEGORY)
    setTypeFilter(DEFAULT_TYPE_FILTER)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setEditing(null)
  }

  const openCreateDrawer = () => {
    setEditing(null)
    setDrawerMode('create')
    setDrawerOpen(true)
  }

  const openEditDrawer = (category: CasinoCategory) => {
    setEditing(category)
    setDrawerMode('edit')
    setDrawerOpen(true)
  }

  const openGames = (category: CasinoCategory) => {
    navigate(ROUTES.CASINO_CATEGORY_ADD_GAMES.replace(':categoryId', category.id))
  }

  const saveCategory = async (values: CategorySubmitValues) => {
    try {
      const result =
        drawerMode === 'create'
          ? await createCategory({ variables: { input: values } })
          : editing?.id
            ? await updateCategory({
                variables: { id: editing.id, input: categoryUpdatePatch(values) },
              })
            : null

      const saved =
        drawerMode === 'create'
          ? result?.data?.createCasinoCategory
          : result?.data?.updateCasinoCategory
      if (!saved) return

      await apolloClient.refetchQueries({ include: [CASINO_CUSTOM_CATEGORIES] })
      toast(saveSuccessToast(drawerMode, values.name))
      closeDrawer()
    } catch (error) {
      toast(saveErrorToast(drawerMode, error))
      throw error
    }
  }

  return (
    <Page maxWidth="wide" className={styles.page}>
      <PageHeader
        eyebrow={pageEyebrow}
        title={PAGE_TITLE}
        sub={PAGE_SUB}
        actions={
          <Button
            variant="primary"
            icon={<IconPlus size={16} stroke={strokeFor(16)} />}
            onClick={openCreateDrawer}
          >
            {CREATE_CATEGORY_LABEL}
          </Button>
        }
      />

      <CategoryStatsCards mainCategory={mainCategory} typeFilter={typeFilter} />

      <FilterBar label="Category filters" activeCount={activeFilterCount} onClearAll={clearFilters}>
        <SegmentedControl
          label="Main category"
          value={mainCategory}
          options={MAIN_CATEGORY_OPTIONS}
          onChange={setMainCategory}
          size="sm"
          stretch="phone"
        />
        <SegmentedControl
          label="Category type"
          value={typeFilter}
          options={TYPE_FILTER_OPTIONS}
          onChange={setTypeFilter}
          size="sm"
          stretch="phone"
        />
      </FilterBar>

      <CategoriesDashboard
        mainCategory={mainCategory}
        typeFilter={typeFilter}
        onEdit={openEditDrawer}
        onAddGames={openGames}
      />

      <CategoryFormDrawer
        open={drawerOpen}
        mode={drawerMode}
        initial={editing ?? { mainCategory }}
        onClose={closeDrawer}
        onSubmit={saveCategory}
      />
    </Page>
  )
}
