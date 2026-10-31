import NovaHome from '../components/nova/NovaHome'
import { usePageSEO } from '../hooks/usePageSEO'

export default function HomePage() {
  usePageSEO({ title: 'Home' })

  return (
    <NovaHome />
  )
}


