import { useMemo, useState } from 'react'
import { gql, useQuery } from '@apollo/client'
import { Combobox, type ListboxOption } from '@/ui/components/Combobox'
import { MultiSelect } from '@/ui/components/MultiSelect'

const USERS_SEARCH_QUERY = gql`
  query UsersSearch($query: String, $limit: Int, $offset: Int) {
    usersPage(query: $query, limit: $limit, offset: $offset) {
      items {
        id
        name
        email
        username
      }
      total
    }
  }
`

interface PlayerSearchSelectProps {
  value?: string[] | string | null
  onChange?: (value: string[] | string | null) => void
  /** When false, only one player can be selected (used for bet settings targeting). @default true */
  multiple?: boolean
  /** When false in single mode, the search input stays empty after a pick. @default true */
  showValueInInput?: boolean
  onSelectDetail?: (detail: { id: string; label: string } | null) => void
}

interface UsersSearchData {
  usersPage?: {
    items?: Array<{ id: string; name?: string | null; email?: string | null; username?: string | null }>
  } | null
}

export function PlayerSearchSelect({
  value,
  onChange,
  multiple = true,
  showValueInInput = true,
  onSelectDetail,
}: PlayerSearchSelectProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const trimmed = searchQuery.trim()
  const { data, loading } = useQuery<UsersSearchData>(USERS_SEARCH_QUERY, {
    variables: {
      query: trimmed.length >= 2 ? searchQuery : undefined,
      limit: 50,
    },
    skip: trimmed.length < 2,
    fetchPolicy: 'cache-and-network',
  })

  const options = useMemo<ListboxOption[]>(
    () => (data?.usersPage?.items ?? []).map((player) => ({
      label: `${player.name || player.username} (${player.email})`,
      value: player.id,
    })),
    [data?.usersPage?.items],
  )
  const emptyText = trimmed.length < 2 ? 'Type at least 2 characters to search' : 'No players found'

  if (!multiple) {
    const singleValue = typeof value === 'string' && value.length > 0 ? value : null
    return (
      <Combobox
        label="Player"
        hideLabel
        placeholder="Search and select a player..."
        value={showValueInInput ? singleValue : null}
        inputValue={showValueInInput ? undefined : searchQuery}
        options={options}
        filter={false}
        loading={loading}
        emptyText={emptyText}
        clearable={showValueInInput}
        onInputChange={setSearchQuery}
        onSelect={(id, option) => {
          onSelectDetail?.({ id, label: option.label })
          if (!showValueInInput) setSearchQuery('')
        }}
        onChange={(id) => {
          onChange?.(id)
          if (id === null) onSelectDetail?.(null)
        }}
      />
    )
  }

  return (
    <MultiSelect
      label="Players"
      hideLabel
      placeholder="Search players by name, email, or username..."
      value={Array.isArray(value) ? value : []}
      inputValue={searchQuery}
      options={options}
      filter={false}
      loading={loading}
      emptyText={emptyText}
      clearable
      maxTagCount={3}
      onInputChange={setSearchQuery}
      onChange={(ids) => onChange?.(ids)}
    />
  )
}
