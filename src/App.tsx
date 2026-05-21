import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/lib/auth'
import { Layout } from '@/components/Layout'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ToastViewport } from '@/components/Toast'
import { Login } from '@/pages/Login'
import { Sale } from '@/pages/Sale'
import { ProductsPage } from '@/pages/admin/Products'
import { UsersPage } from '@/pages/admin/Users'
import { SalesPage } from '@/pages/admin/Sales'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={basename}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Sale />} />
              <Route
                path="admin/products"
                element={<ProtectedRoute adminOnly><ProductsPage /></ProtectedRoute>}
              />
              {/* Redirige les anciens liens /admin/categories vers la nouvelle section dans Stock */}
              <Route path="admin/categories" element={<Navigate to="/admin/products" replace />} />
              <Route
                path="admin/users"
                element={<ProtectedRoute adminOnly><UsersPage /></ProtectedRoute>}
              />
              {/* Accessible aux vendeurs : ils n'y verront que leurs propres ventes */}
              <Route
                path="admin/sales"
                element={<ProtectedRoute><SalesPage /></ProtectedRoute>}
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <ToastViewport />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
