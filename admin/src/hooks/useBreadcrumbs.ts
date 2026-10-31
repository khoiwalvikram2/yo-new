import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { matchRoute, routeConfig, parentDefaultRoutes } from '../shared/core/routeConfig'
import { useAuthStore } from '../shared/core/authStore'

export interface BreadcrumbItem {
  label: string
  path?: string
  isLast?: boolean
}

/**
 * Hook to generate dynamic breadcrumbs based on current route
 * Uses route configuration to build breadcrumb trail
 */
export function useBreadcrumbs(): BreadcrumbItem[] {
  const location = useLocation()
  const isAgent = useAuthStore((state) => state.isAgent())

  return useMemo(() => {
    const pathname = location.pathname

    // Skip breadcrumb generation for login page
    if (pathname === '/login') {
      return []
    }

    // Determine if this is an agent route
    const isAgentRoute = isAgent && (pathname.startsWith('/agent') || pathname === '/notifications' || pathname.startsWith('/commission') || pathname.startsWith('/settlement'))

    // Get current route config
    const currentRoute = matchRoute(pathname)

    // If on overview/dashboard page, return only Dashboard or Agent Dashboard
    if (pathname === '/overview' || pathname === '/') {
      return [{
        label: isAgentRoute ? 'Agent Dashboard' : 'Dashboard',
        path: isAgentRoute ? '/agent' : '/overview',
        isLast: true,
      }]
    }

    // If on agent dashboard
    if (pathname === '/agent') {
      return [{
        label: 'Agent Dashboard',
        path: '/agent',
        isLast: true,
      }]
    }

    if (!currentRoute) {
      // Fallback: use pathname segments
      const fallbackBreadcrumbs: BreadcrumbItem[] = [{
        label: isAgentRoute ? 'Agent Dashboard' : 'Dashboard',
        path: isAgentRoute ? '/agent' : '/overview',
      }]
      const segments = pathname.split('/').filter(Boolean)
      if (segments.length > 0) {
        fallbackBreadcrumbs.push({
          label: formatSegment(segments[segments.length - 1]),
          isLast: true,
        })
      }
      return fallbackBreadcrumbs
    }

    // Build breadcrumb trail starting with Dashboard or Agent Dashboard
    const breadcrumbs: BreadcrumbItem[] = [{
      label: isAgentRoute ? 'Agent Dashboard' : 'Dashboard',
      path: isAgentRoute ? '/agent' : '/overview',
    }]

    const trail: BreadcrumbItem[] = []

    // If route has a parent label, add it first
    if (currentRoute.parent) {
      let parentBreadcrumb: BreadcrumbItem | null = null

      // First, check if parent has a default route defined
      const defaultRoute = parentDefaultRoutes[currentRoute.parent]
      if (defaultRoute) {
        // Use default route for parent label
        parentBreadcrumb = {
          label: currentRoute.parent,
          path: defaultRoute,
        }
      } else {
        // Try to find if parent label matches a route label
        // First, try to find a route with matching label
        let parentRoutePath: string | null = null
        for (const [routePath, route] of Object.entries(routeConfig)) {
          if (route.label === currentRoute.parent) {
            parentRoutePath = routePath
            break
          }
        }

        if (parentRoutePath) {
          // Found a route with matching label
          parentBreadcrumb = {
            label: currentRoute.parent,
            path: parentRoutePath,
          }
        } else {
          // Try to find if parent is a direct route path
          const parentPath = findParentPath(pathname)
          if (parentPath && routeConfig[parentPath]) {
            // Only use if it's an exact match in config (not a fallback)
            const parentRoute = routeConfig[parentPath]
            parentBreadcrumb = {
              label: parentRoute.label,
              path: parentPath,
            }
          } else {
            // If still no breadcrumb, make it non-clickable
            parentBreadcrumb = {
              label: currentRoute.parent,
              // No path = non-clickable
            }
          }
        }
      }

      if (parentBreadcrumb) {
        // Only add if it's not a duplicate of Dashboard or Agent Dashboard
        if (parentBreadcrumb.label !== 'Dashboard' && parentBreadcrumb.label !== 'Agent Dashboard') {
          trail.push(parentBreadcrumb)
        }
      }
    }

    // Add current route (skip if it's Dashboard or Agent Dashboard)
    if (currentRoute.label !== 'Dashboard' && currentRoute.label !== 'Agent Dashboard') {
      trail.push({
        label: currentRoute.label,
        path: pathname,
        isLast: true,
      })
    } else {
      // If current route is Dashboard/Agent Dashboard, mark first as last
      breadcrumbs[0].isLast = true
    }

    // Combine dashboard + trail
    return [...breadcrumbs, ...trail]
  }, [location.pathname, isAgent])
}

/**
 * Find parent path for a given route by removing the last segment
 */
function findParentPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  
  if (segments.length <= 1) {
    return null
  }

  // Remove the last segment to get parent path
  const parentPath = '/' + segments.slice(0, -1).join('/')
  
  // Check if parent path exists in config
  const parentRoute = matchRoute(parentPath)
  if (parentRoute) {
    return parentPath
  }

  return null
}

/**
 * Format a URL segment into a readable label
 */
function formatSegment(segment: string): string {
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

