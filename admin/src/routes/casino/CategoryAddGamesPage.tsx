import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ASSIGN_GAMES_TO_CATEGORY,
  CASINO_API_PROVIDERS,
  CASINO_CATEGORY,
  CASINO_CUSTOM_CATEGORIES,
  CASINO_LOUNGE_GAME_IMAGES,
  GAMES_IN_CATEGORY,
  REMOVE_GAMES_FROM_CATEGORY,
  SAVE_CASINO_LOUNGE_GAMES,
} from '@/lib/graphql/casino'
import { useAuthStore } from '@/shared/core/authStore'
import { ROUTES } from '@/shared/core/constants'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useUIStore } from '@/shared/core/uiStore'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { CategoryAssignPanel } from './components/CategoryAssignPanel'
import { selectionDiff, type CasinoCategoryType } from './categoryAddGamesModel'
import { isCoreModeView } from './management/casinoManagementModel'
import styles from './CategoryAddGamesPage.module.css'

interface CategoryRecord {
  id: string
  name: string
  mainCategory: 'LIVE_CASINO' | 'CASINO' | 'SLOTS'
  type?: CasinoCategoryType
  subtitle?: string | null
}

interface CategoryQueryData {
  casinoCategory?: CategoryRecord | null
}

interface ProvidersQueryData {
  casinoApiProviders?: Array<{ id: string | number }>
}

interface AssignedGamesData {
  gamesInCategory?: Array<string | number>
}

interface LoungeImagesData {
  casinoLoungeGameImages?: Array<{ gameId: string; imageData: string | null }>
}

const MAX_LOUNGE_IMAGE_BATCH = 6 * 1024 * 1024

export default function CategoryAddGamesPage() {
  return (
    <RBACGuard required={[{ domain: 'casino.categories', actions: ['view', 'update'] }]}>
      <CategoryAddGamesPageContent />
    </RBACGuard>
  )
}

function CategoryAddGamesPageContent() {
  const { categoryId } = useParams<{ categoryId: string }>()
  const navigate = useNavigate()
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set())
  const [providerId, setProviderId] = useState<string | null>(null)
  const [assignGames] = useMutation(ASSIGN_GAMES_TO_CATEGORY)
  const [removeGames] = useMutation(REMOVE_GAMES_FROM_CATEGORY)
  const [saveLoungeGames] = useMutation<{ saveCasinoLoungeGames: { success: boolean; message?: string } }>(SAVE_CASINO_LOUNGE_GAMES)
  const [loungeImages, setLoungeImages] = useState<Record<string, string | null>>({})
  const [imageDrafts, setImageDrafts] = useState<Record<string, string | null>>({})

  const { data: categoryData, loading: categoryLoading, error: categoryError, refetch: refetchCategory } = useQuery<CategoryQueryData>(CASINO_CATEGORY, {
    variables: { id: categoryId },
    skip: !categoryId,
    errorPolicy: 'all',
  })
  const category = categoryData?.casinoCategory
  const pageEyebrow = usePageEyebrow()
  const roles = useAuthStore((state) => state.roles)
  const directorMode = useUIStore((state) => state.directorMode)
  const coreMode = isCoreModeView(roles, directorMode)
  const isLounge = category?.type === 'LOUNGE'
  const { data: imageData, loading: imagesLoading, error: imagesError, refetch: refetchImages } = useQuery<LoungeImagesData>(CASINO_LOUNGE_GAME_IMAGES, {
    variables: { categoryId }, skip: !categoryId || !isLounge,
    fetchPolicy: 'network-only', errorPolicy: 'all', notifyOnNetworkStatusChange: true,
  })

  useEffect(() => { setImageDrafts({}); setLoungeImages({}) }, [categoryId])
  useEffect(() => {
    if (imageData?.casinoLoungeGameImages && !imagesError) {
      setLoungeImages(Object.fromEntries(imageData.casinoLoungeGameImages.map(image => [String(image.gameId), image.imageData])))
    }
  }, [imageData, imagesError])

  const { data: providersData } = useQuery<ProvidersQueryData>(CASINO_API_PROVIDERS, {
    errorPolicy: 'all',
  })

  useEffect(() => {
    const firstProvider = providersData?.casinoApiProviders?.[0]
    if (firstProvider && !providerId) setProviderId(String(firstProvider.id))
  }, [providerId, providersData])

  const { data: assignedData, loading: assignedLoading, error: assignedError, refetch: refetchAssigned } = useQuery<AssignedGamesData>(
    GAMES_IN_CATEGORY,
    {
      variables: { categoryId },
      skip: !categoryId,
      fetchPolicy: 'network-only',
      errorPolicy: 'all',
    },
  )

  useEffect(() => {
    if (assignedData?.gamesInCategory) {
      setSelectedGameIds(new Set(assignedData.gamesInCategory.map(String)))
    }
  }, [assignedData])

  const save = async () => {
    if (!categoryId || !category) return
    const current = assignedData?.gamesInCategory ?? []
    const changes = selectionDiff(current, selectedGameIds)
    const refetchQueries = [{
      query: CASINO_CUSTOM_CATEGORIES,
      variables: { mainCategory: category.mainCategory },
    }]

    if (isLounge) {
      if (imagesLoading || imagesError || assignedLoading || assignedError) throw new Error('Load the saved Lounge games and images before saving.')
      const images = Object.entries(imageDrafts).filter(([gameId]) => selectedGameIds.has(gameId)).map(([gameId, imageData]) => ({ gameId, imageData }))
      if (images.reduce((bytes, image) => bytes + (image.imageData?.length ?? 0), 0) > MAX_LOUNGE_IMAGE_BATCH) {
        throw new Error('These images exceed the save limit. Save a smaller group of images first.')
      }
      const result = await saveLoungeGames({
        variables: { categoryId, gameIds: [...selectedGameIds], images },
        context: { uiToast: 'notification' }, refetchQueries,
      })
      if (result.data?.saveCasinoLoungeGames?.success !== true) {
        throw new Error(result.data?.saveCasinoLoungeGames?.message || 'Could not save Lounge games and images')
      }
      setLoungeImages(current => ({ ...current, ...Object.fromEntries(images.map(image => [image.gameId, image.imageData])) }))
      setImageDrafts({})
      await Promise.allSettled([refetchAssigned(), refetchImages()])
      return
    }

    if (changes.remove.length) {
      await removeGames({
        variables: { categoryId, gameIds: changes.remove },
        context: { uiToast: 'notification' },
        refetchQueries,
      })
    }
    if (changes.add.length) {
      await assignGames({
        variables: { categoryId, gameIds: changes.add },
        context: { uiToast: 'notification' },
        refetchQueries,
      })
    }
    if (!changes.remove.length && !changes.add.length && current.length !== selectedGameIds.size) {
      await refetchAssigned()
    }
    await refetchAssigned()
  }

  if (!category && categoryLoading) {
    return (
      <Page maxWidth="wide" className={styles.page}>
        <LoadingState label="Loading category" />
      </Page>
    )
  }

  // The server answers a category this whitelabel cannot read (deleted, mistyped, or another whitelabel's) with
  // null or "Category not found"; either used to leave the spinner up for ever under an empty heading.
  if (!category) {
    const unreachable = Boolean(categoryError?.networkError)
    return (
      <Page maxWidth="wide" className={styles.page}>
        <PageHeader
          eyebrow={pageEyebrow}
          title={unreachable ? 'Category unavailable' : 'Category not found'}
          back={{ to: ROUTES.CASINO_CATEGORIES, label: 'Back to Categories' }}
        />
        {unreachable ? (
          <EmptyState
            title="The category could not be loaded"
            description="Check the connection and try again."
            action={<Button size="sm" onClick={() => void refetchCategory()}>Retry</Button>}
          />
        ) : (
          <EmptyState
            title="This category does not exist for the selected whitelabel"
            description={coreMode
              ? 'Core mode reads the platform default. Select the category\'s whitelabel in the top bar, then open it again from Categories.'
              : 'It may have been deleted. Choose a category from the list.'}
          />
        )}
      </Page>
    )
  }

  return (
    <CategoryAssignPanel
      key={category.id}
      categoryId={category.id}
      categoryName={category.name}
      mainCategory={category.mainCategory}
      categoryType={category.type}
      categorySubtitle={category.subtitle}
      providerId={providerId}
      selectedIds={selectedGameIds}
      loungeImages={{ ...loungeImages, ...imageDrafts }}
      onLoungeImageChange={(gameId, imageData) => setImageDrafts(current => ({ ...current, [gameId]: imageData }))}
      imagesLoading={isLounge && imagesLoading}
      imagesError={isLounge && imagesError ? 'Saved Lounge images could not be loaded. Retry before saving.' : null}
      onRetryImages={() => { void refetchImages().catch(() => {}) }}
      saveDisabled={assignedLoading || Boolean(assignedError) || (isLounge && (imagesLoading || Boolean(imagesError)))}
      onToggle={(id) => {
        setSelectedGameIds((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }}
      onBack={() => navigate('/casino/categories')}
      onSave={save}
    />
  )
}
