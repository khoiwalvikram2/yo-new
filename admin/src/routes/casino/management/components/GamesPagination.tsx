import { Pagination } from '@/ui/components/Pagination'
import { PAGE_SIZE_OPTIONS } from '../casinoManagementModel'

interface GamesPaginationProps {
  page: number
  pageSize: number
  totalGames: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export function GamesPagination({
  page,
  pageSize,
  totalGames,
  onPageChange,
  onPageSizeChange,
}: GamesPaginationProps) {
  return (
    <Pagination
      current={page}
      pageSize={pageSize}
      total={totalGames}
      itemName="games"
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      variant="embedded"
      onChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
    />
  )
}
