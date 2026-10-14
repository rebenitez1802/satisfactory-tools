import { LoadBalancerTool } from './components/LoadBalancerTool'
import { PlannerTool } from './components/planner/PlannerTool'
import { useHashRoute } from './useHashRoute'

export function App() {
  const [route, navigate] = useHashRoute()

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <span className="brand-mark">⚙</span>
            <div>
              <h1>Satisfactory Tools</h1>
              <p className="tagline">Planning helpers for the factory floor</p>
            </div>
          </div>
          <nav className="toolnav">
            <button
              className={`toolnav-item ${route === 'balancer' ? 'active' : ''}`}
              type="button"
              onClick={() => navigate('balancer')}
            >
              Load Balancer
            </button>
            <button
              className={`toolnav-item ${route === 'planner' ? 'active' : ''}`}
              type="button"
              onClick={() => navigate('planner')}
            >
              Production Chains
            </button>
          </nav>
        </div>
      </header>

      <main className={`app-main${route === 'planner' ? ' app-main-wide' : ''}`}>
        {route === 'planner' ? <PlannerTool /> : <LoadBalancerTool />}
      </main>

      <footer className="app-footer">
        <span>
          Built for the game <strong>Satisfactory</strong>. Splitters divide evenly across
          2–3 belts; mergers combine up to 3.
        </span>
        <span>
          A free, non-commercial fan tool, not affiliated with Coffee Stain Studios. Game
          content and icons © Coffee Stain Studios; icons via the{' '}
          <a href="https://satisfactory.wiki.gg/">Official Satisfactory Wiki</a>, recipe data via{' '}
          <a href="https://github.com/greeny/SatisfactoryTools">greeny/SatisfactoryTools</a> (MIT).
        </span>
      </footer>
    </div>
  )
}
