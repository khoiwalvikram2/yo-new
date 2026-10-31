import { IconSearch } from '@tabler/icons-react'
import { EmptyState as KitEmptyState } from '@/ui/components/EmptyState'
export function EmptyState({ query }: { query: string }) { return <KitEmptyState icon={<IconSearch size={24} />} title="No results found" description={<>No matches for “{query}”. Try a different search term.</>} /> }
