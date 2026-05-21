import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { LogOut, Package, ShoppingCart, Users, BarChart3, Flame } from 'lucide-react'
import { useAuth } from '@/lib/auth'

export function Layout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  const isAdmin = profile?.role === 'admin'

  return (
    <div className="flex min-h-screen flex-col">
      <header className="relative overflow-hidden text-white shadow-lg bg-gradient-to-br from-brand-800 via-brand-600 to-ember-500">
        {/* halo lumineux discret en haut à droite */}
        <div
          className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/10 blur-3xl"
          aria-hidden
        />
        <div className="relative mx-auto flex max-w-6xl items-center justify-between px-4 pt-4 pb-3">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="rounded-xl bg-white/15 p-2 ring-1 ring-white/25 backdrop-blur-sm shadow-inner transition-all group-hover:bg-white/25 group-hover:scale-105">
              <Flame className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <div className="leading-tight">
              <div className="font-bold text-lg tracking-tight">Coopérative CHG</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/70">
                Caserne de Château-Gombert
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-sm text-right hidden sm:block">
              <div className="font-medium">{profile?.display_name}</div>
              <div className="text-xs text-white/75">
                {profile?.role === 'admin' ? 'Administrateur' : 'Vendeur'}
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-white/90 hover:bg-white/15 transition-colors"
              title="Se déconnecter"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Déconnexion</span>
            </button>
          </div>
        </div>
        <nav className="relative mx-auto max-w-6xl px-4 pb-4">
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            <NavItem to="/" label="Catalogue" icon={<ShoppingCart className="h-4 w-4" />} end />
            {isAdmin && (
              <>
                <NavItem
                  to="/admin/products"
                  label="Stock"
                  icon={<Package className="h-4 w-4" />}
                />
                <NavItem
                  to="/admin/users"
                  label="Comptes"
                  icon={<Users className="h-4 w-4" />}
                />
              </>
            )}
            {/* Visible par tous : un vendeur n'y voit que ses propres ventes */}
            <NavItem
              to="/admin/sales"
              label={isAdmin ? 'Rapports' : 'Mes ventes'}
              icon={<BarChart3 className="h-4 w-4" />}
            />
          </div>
        </nav>
      </header>
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-4">
        <Outlet />
      </main>
    </div>
  )
}

function NavItem({
  to,
  label,
  icon,
  end,
}: {
  to: string
  label: string
  icon: React.ReactNode
  end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
          isActive
            ? 'bg-white text-brand-700 shadow-lg shadow-black/10 ring-1 ring-black/5'
            : 'bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}
