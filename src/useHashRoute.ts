import { useCallback, useEffect, useState } from 'react'

// Hash routes (`#/planner`) work on GitHub Pages without server rewrites and
// make each tool linkable.

export const ROUTES = ['balancer', 'planner'] as const
export type Route = (typeof ROUTES)[number]

const DEFAULT_ROUTE: Route = 'balancer'

function readRoute(): Route {
  const name = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : DEFAULT_ROUTE
}

export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(readRoute)

  useEffect(() => {
    const onChange = () => setRoute(readRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((next: Route) => {
    window.location.hash = `/${next}`
  }, [])

  return [route, navigate]
}
