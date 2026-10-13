import { LoadBalancerTool } from './components/LoadBalancerTool'

export function App() {
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
            <button className="toolnav-item active" type="button">
              Load Balancer
            </button>
            <span className="toolnav-item soon" title="Coming soon">
              Production Chains
            </span>
          </nav>
        </div>
      </header>

      <main className="app-main">
        <LoadBalancerTool />
      </main>

      <footer className="app-footer">
        <span>
          Built for the game <strong>Satisfactory</strong>. Splitters divide evenly across
          2–3 belts; mergers combine up to 3. Not affiliated with Coffee Stain Studios.
        </span>
      </footer>
    </div>
  )
}
