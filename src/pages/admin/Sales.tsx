import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Download,
  FileText,
  Wallet,
  Building2,
  Sparkles,
  ShoppingBag,
  Receipt,
  Trash2,
  AlertTriangle,
  Image as ImageIcon,
  Trophy,
  ArrowRight,
} from 'lucide-react'
import {
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  subDays,
  format,
} from 'date-fns'
import { supabase, publicImageUrl } from '@/lib/supabase'
import { formatPrice, formatDateTime, formatDate } from '@/lib/format'
import { DbHealth } from '@/components/DbHealth'
import { Modal } from '@/components/Modal'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/lib/auth'
import { useCancelTransaction, useDbStats, usePurgeTransactions } from '@/hooks/useDbStats'
import { useProducts } from '@/hooks/useProducts'
import { formatGrams, type Profile, type Transaction, type TransactionItem } from '@/lib/database.types'

interface TxWithDetails extends Transaction {
  items: TransactionItem[]
  seller_name: string
}

interface ProductBreakdown {
  product_id: string | null
  product_name: string
  /**
   * Si non null : article vendu au poids, qty est un nombre de portions,
   * portion_grams donne le poids unitaire. Sinon : qty = pièces.
   */
  portion_grams: number | null
  qty: number
  client_cents: number
  foyer_cents: number
  commission_cents: number
  cost_cents: number
}

export function SalesPage() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const today = new Date()
  const [from, setFrom] = useState(format(startOfMonth(today), 'yyyy-MM-dd'))
  const [to, setTo] = useState(format(endOfMonth(today), 'yyyy-MM-dd'))
  const [cancelTarget, setCancelTarget] = useState<TxWithDetails | null>(null)

  const fromDate = startOfDay(new Date(from))
  const toDate = endOfDay(new Date(to))

  const { data, isLoading } = useQuery({
    queryKey: ['sales', from, to],
    queryFn: async (): Promise<TxWithDetails[]> => {
      const { data: txs, error: txErr } = await supabase
        .from('transactions')
        .select('*')
        .gte('created_at', fromDate.toISOString())
        .lte('created_at', toDate.toISOString())
        .order('created_at', { ascending: false })
      if (txErr) throw txErr
      const transactions = (txs ?? []) as Transaction[]
      if (transactions.length === 0) return []

      const ids = transactions.map((t) => t.id)
      const { data: items, error: itErr } = await supabase
        .from('transaction_items')
        .select('*')
        .in('transaction_id', ids)
      if (itErr) throw itErr

      const sellerIds = Array.from(new Set(transactions.map((t) => t.seller_id)))
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', sellerIds)
      if (pErr) throw pErr
      const profileById = Object.fromEntries(
        (profiles as Pick<Profile, 'id' | 'display_name'>[]).map((p) => [p.id, p.display_name])
      )

      const itemsByTx = new Map<string, TransactionItem[]>()
      for (const it of (items ?? []) as TransactionItem[]) {
        const arr = itemsByTx.get(it.transaction_id) ?? []
        arr.push(it)
        itemsByTx.set(it.transaction_id, arr)
      }

      return transactions.map((t) => ({
        ...t,
        items: itemsByTx.get(t.id) ?? [],
        seller_name: profileById[t.seller_id] ?? '—',
      }))
    },
  })

  const stats = useMemo(() => {
    const txs = data ?? []
    let clientTotal = 0
    let foyerTotal = 0
    let commissionTotal = 0
    let costTotal = 0
    const txCount = txs.length
    const byProductMap = new Map<string, ProductBreakdown>()
    const bySellerMap = new Map<
      string,
      { seller_name: string; qty: number; client_cents: number }
    >()

    for (const t of txs) {
      const sellerEntry = bySellerMap.get(t.seller_id) ?? {
        seller_name: t.seller_name,
        qty: 0,
        client_cents: 0,
      }
      sellerEntry.client_cents += t.total_cents

      for (const it of t.items) {
        const lineClient = (it.unit_sale_cents + it.unit_commission_cents) * it.qty
        const lineFoyer = it.unit_sale_cents * it.qty
        const lineCommission = it.unit_commission_cents * it.qty
        const lineCost = it.unit_cost_cents * it.qty

        clientTotal += lineClient
        foyerTotal += lineFoyer
        commissionTotal += lineCommission
        costTotal += lineCost
        sellerEntry.qty += it.qty

        const entry =
          byProductMap.get(it.product_name) ??
          ({
            product_id: it.product_id,
            product_name: it.product_name,
            portion_grams: it.unit_portion_grams,
            qty: 0,
            client_cents: 0,
            foyer_cents: 0,
            commission_cents: 0,
            cost_cents: 0,
          } satisfies ProductBreakdown)
        // garde le 1er product_id non null vu (utile si certaines lignes ont un id null)
        if (entry.product_id === null && it.product_id !== null) {
          entry.product_id = it.product_id
        }
        // garde le 1er portion_grams non null vu
        if (entry.portion_grams === null && it.unit_portion_grams !== null) {
          entry.portion_grams = it.unit_portion_grams
        }
        entry.qty += it.qty
        entry.client_cents += lineClient
        entry.foyer_cents += lineFoyer
        entry.commission_cents += lineCommission
        entry.cost_cents += lineCost
        byProductMap.set(it.product_name, entry)
      }
      bySellerMap.set(t.seller_id, sellerEntry)
    }
    const byProduct = [...byProductMap.values()].sort((a, b) => b.client_cents - a.client_cents)
    const bySeller = [...bySellerMap.values()].sort((a, b) => b.client_cents - a.client_cents)
    return {
      clientTotal,
      foyerTotal,
      commissionTotal,
      costTotal,
      txCount,
      byProduct,
      bySeller,
    }
  }, [data])

  async function handleExportPdf() {
    if (!data) return
    const { generateSalesPdf } = await import('@/lib/pdf')
    generateSalesPdf({
      from: fromDate,
      to: toDate,
      clientTotal: stats.clientTotal,
      foyerTotal: stats.foyerTotal,
      commissionTotal: stats.commissionTotal,
      costTotal: stats.costTotal,
      txCount: stats.txCount,
      byProduct: stats.byProduct,
      bySeller: stats.bySeller,
      transactions: data.map((t) => ({
        created_at: t.created_at,
        seller_name: t.seller_name,
        items_count: t.items.reduce((s, it) => s + it.qty, 0),
        total_cents: t.total_cents,
      })),
    })
  }

  // Plage globale (1ère et dernière transaction de la base) pour le bouton "Toute la période"
  // (réservé aux admins : la RPC get_db_stats est admin-only)
  const { data: dbStats } = useDbStats({ enabled: isAdmin })
  const globalRange = useMemo(() => {
    if (!dbStats?.oldest_transaction || !dbStats?.newest_transaction) return null
    return {
      from: new Date(dbStats.oldest_transaction),
      to: new Date(dbStats.newest_transaction),
    }
  }, [dbStats])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">{isAdmin ? 'Rapports' : 'Mes ventes'}</h1>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <PurgeButton
              from={fromDate}
              to={toDate}
              count={stats.txCount}
              disabled={isLoading}
            />
            <button
              onClick={handleExportPdf}
              disabled={!data || data.length === 0}
              className="btn-primary"
            >
              <Download className="h-4 w-4" /> Export PDF
            </button>
          </div>
        )}
      </div>

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <RangeDateInput
          fromValue={from}
          toValue={to}
          onFromChange={setFrom}
          onToChange={setTo}
        />
        <DatePresets
          globalRange={globalRange}
          onPick={(f, t) => {
            setFrom(f)
            setTo(t)
          }}
        />
      </div>

      {isAdmin ? (
        <>
          <DbHealth
            txCountInPeriod={stats.txCount}
            periodFrom={fromDate}
            periodTo={toDate}
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi
              label="Total client"
              value={formatPrice(stats.clientTotal)}
              icon={<Wallet className="h-5 w-5" />}
              color="brand"
            />
            <Kpi
              label="Foyer"
              value={formatPrice(stats.foyerTotal)}
              icon={<Building2 className="h-5 w-5" />}
              color="sky"
            />
            <Kpi
              label="Caisse noire"
              value={formatPrice(stats.commissionTotal)}
              icon={<Sparkles className="h-5 w-5" />}
              color="purple"
            />
            <Kpi
              label="Coût d'achat"
              value={formatPrice(stats.costTotal)}
              icon={<ShoppingBag className="h-5 w-5" />}
              color="slate"
            />
            <Kpi
              label="Transactions"
              value={`${stats.txCount}`}
              icon={<Receipt className="h-5 w-5" />}
              color="amber"
            />
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Kpi
            label="Total de mes ventes"
            value={formatPrice(stats.clientTotal)}
            icon={<Wallet className="h-5 w-5" />}
            color="brand"
          />
          <Kpi
            label="Mes transactions"
            value={`${stats.txCount}`}
            icon={<Receipt className="h-5 w-5" />}
            color="amber"
          />
        </div>
      )}

      {isAdmin && stats.txCount > 0 && <TopProducts byProduct={stats.byProduct} />}

      {isAdmin && (
      <div className="card overflow-x-auto">
        <div className="px-4 py-2 border-b border-slate-200 font-semibold text-sm">
          Ventilation par article
        </div>
        {stats.byProduct.length === 0 ? (
          <div className="p-4 text-center text-sm text-slate-500">Aucune vente sur la période.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">Article</th>
                <th className="text-right px-3 py-2">Qté</th>
                <th className="text-right px-3 py-2">Client</th>
                <th className="text-right px-3 py-2">Foyer</th>
                <th className="text-right px-3 py-2">Caisse noire</th>
                <th className="text-right px-3 py-2">Coût</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.byProduct.map((r) => (
                <tr key={r.product_name}>
                  <td className="px-3 py-2 font-medium">{r.product_name}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.portion_grams != null ? (
                      <>
                        {r.qty} portions
                        <span className="block text-[10px] text-slate-400">
                          ({formatGrams(r.portion_grams * r.qty)})
                        </span>
                      </>
                    ) : (
                      r.qty
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{formatPrice(r.client_cents)}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatPrice(r.foyer_cents)}
                  </td>
                  <td className="px-3 py-2 text-right text-purple-700">
                    {formatPrice(r.commission_cents)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {formatPrice(r.cost_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}

      {isAdmin && (
      <div className="card overflow-x-auto">
        <div className="px-4 py-2 border-b border-slate-200 font-semibold text-sm">
          Par vendeur
        </div>
        {stats.bySeller.length === 0 ? (
          <div className="p-4 text-center text-sm text-slate-500">—</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">Vendeur</th>
                <th className="text-right px-3 py-2 w-28">Articles</th>
                <th className="text-right px-3 py-2 w-28">Total client</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.bySeller.map((r) => (
                <tr key={r.seller_name}>
                  <td className="px-3 py-2">{r.seller_name}</td>
                  <td className="px-3 py-2 text-right">{r.qty}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatPrice(r.client_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-200 font-semibold text-sm flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Transactions ({stats.txCount})
        </div>
        {isLoading ? (
          <div className="p-4 text-center text-slate-500">Chargement…</div>
        ) : (data ?? []).length === 0 ? (
          <div className="p-4 text-center text-sm text-slate-500">Aucune transaction.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Vendeur</th>
                  <th className="text-left px-3 py-2">Articles</th>
                  <th className="text-right px-3 py-2 w-24">Total</th>
                  <th className="px-3 py-2 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data ?? []).map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(t.created_at)}</td>
                    <td className="px-3 py-2">{t.seller_name}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {t.items.map((it) => `${it.qty}× ${it.product_name}`).join(', ')}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {formatPrice(t.total_cents)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setCancelTarget(t)}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        title="Annuler cette transaction"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {cancelTarget && (
        <CancelTransactionModal
          tx={cancelTarget}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </div>
  )
}

function CancelTransactionModal({
  tx,
  onClose,
}: {
  tx: TxWithDetails
  onClose: () => void
}) {
  const toast = useToast()
  const cancel = useCancelTransaction()

  async function handleConfirm() {
    try {
      await cancel.mutateAsync(tx.id)
      toast.success('Transaction annulée, stock restauré')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Annulation impossible')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Annuler la transaction ?"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Retour
          </button>
          <button onClick={handleConfirm} className="btn-danger" disabled={cancel.isPending}>
            <Trash2 className="h-4 w-4" />
            {cancel.isPending ? 'Annulation…' : 'Confirmer l\'annulation'}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-700">
          Cette transaction sera <strong>définitivement supprimée</strong> et le stock des
          articles vendus sera <strong>restauré</strong>.
        </p>
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500">Date</span>
            <span className="font-medium">{formatDateTime(tx.created_at)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Vendeur</span>
            <span className="font-medium">{tx.seller_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Total</span>
            <span className="font-bold text-brand-700">{formatPrice(tx.total_cents)}</span>
          </div>
        </div>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {tx.items.map((it) => (
            <li key={it.id} className="flex justify-between px-3 py-1.5">
              <span className="text-slate-700">
                {it.qty}
                {it.unit_portion_grams != null ? ' portions' : '×'} {it.product_name}
              </span>
              <span className="text-slate-500 text-xs">
                +
                {it.unit_portion_grams != null
                  ? formatGrams(it.unit_portion_grams * it.qty)
                  : `${it.qty}`}{' '}
                en stock
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}

type KpiColor = 'brand' | 'purple' | 'emerald' | 'rose' | 'sky' | 'amber' | 'slate'

const kpiColorMap: Record<KpiColor, { bg: string; text: string; valueText: string }> = {
  brand: { bg: 'bg-brand-50', text: 'text-brand-600', valueText: 'text-brand-700' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600', valueText: 'text-purple-700' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', valueText: 'text-emerald-700' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-600', valueText: 'text-rose-700' },
  sky: { bg: 'bg-sky-50', text: 'text-sky-600', valueText: 'text-sky-700' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600', valueText: 'text-amber-700' },
  slate: { bg: 'bg-slate-100', text: 'text-slate-600', valueText: 'text-slate-700' },
}

function Kpi({
  label,
  value,
  subtitle,
  icon,
  color = 'slate',
}: {
  label: string
  value: string
  subtitle?: string
  icon: ReactNode
  color?: KpiColor
}) {
  const c = kpiColorMap[color]
  return (
    <div className="card p-3 flex items-start gap-3">
      <div className={`shrink-0 rounded-xl p-2 ${c.bg} ${c.text}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-slate-500 truncate">{label}</div>
        <div className={`text-lg font-bold mt-0.5 ${c.valueText}`}>{value}</div>
        {subtitle && <div className="text-[11px] text-slate-400 mt-0.5">{subtitle}</div>}
      </div>
    </div>
  )
}

function TopProducts({ byProduct }: { byProduct: ProductBreakdown[] }) {
  const [mode, setMode] = useState<'top' | 'least'>('top')
  const { data: products = [] } = useProducts({ includeArchived: true })

  const productById = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products]
  )

  // On combine les ventes de la période avec tous les articles actifs
  // (qty=0 pour ceux qui n'ont rien vendu) afin que "moins vendus" remonte
  // bien les articles qui n'ont pas bougé sur la période.
  const ranking = useMemo(() => {
    const map = new Map<
      string,
      { product_id: string | null; product_name: string; image_path: string | null; qty: number; client_cents: number }
    >()

    for (const p of products) {
      if (p.archived) continue
      map.set(p.id, {
        product_id: p.id,
        product_name: p.name,
        image_path: p.image_path,
        qty: 0,
        client_cents: 0,
      })
    }

    for (const sale of byProduct) {
      const key = sale.product_id ?? `name:${sale.product_name}`
      const existing = map.get(key)
      if (existing) {
        existing.qty = sale.qty
        existing.client_cents = sale.client_cents
      } else {
        // produit archivé / supprimé qui a quand même des ventes sur la période
        map.set(key, {
          product_id: sale.product_id,
          product_name: sale.product_name,
          image_path: sale.product_id
            ? (productById[sale.product_id]?.image_path ?? null)
            : null,
          qty: sale.qty,
          client_cents: sale.client_cents,
        })
      }
    }

    // En mode "Plus vendus", on n'affiche que ceux qui ont au moins 1 vente.
    // En mode "Moins vendus", on garde tout (y compris les articles à 0 vente)
    // pour identifier ce qui ne se vend pas.
    const arr =
      mode === 'top'
        ? [...map.values()].filter((x) => x.qty > 0)
        : [...map.values()]
    arr.sort((a, b) => (mode === 'top' ? b.qty - a.qty : a.qty - b.qty))
    return arr.slice(0, 10)
  }, [byProduct, products, productById, mode])

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" />
          Top 10 articles
        </h2>
        <div className="inline-flex rounded-full bg-slate-100 p-0.5">
          <ModeButton active={mode === 'top'} onClick={() => setMode('top')}>
            Plus vendus
          </ModeButton>
          <ModeButton active={mode === 'least'} onClick={() => setMode('least')}>
            Moins vendus
          </ModeButton>
        </div>
      </div>

      {ranking.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500">
          Aucun article à afficher.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {ranking.map((item, idx) => {
            const imageUrl = publicImageUrl(item.image_path)
            const rankColor =
              mode === 'top' && idx === 0
                ? 'bg-amber-400 text-amber-900'
                : mode === 'top' && idx === 1
                  ? 'bg-slate-300 text-slate-700'
                  : mode === 'top' && idx === 2
                    ? 'bg-orange-300 text-orange-900'
                    : 'bg-white/95 text-slate-700 ring-1 ring-slate-200'
            return (
              <div
                key={item.product_id ?? item.product_name}
                className="card overflow-hidden flex flex-col"
              >
                <div className="relative aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
                  {imageUrl ? (
                    <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-slate-300" />
                  )}
                  <div
                    className={`absolute top-1 left-1 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold ${rankColor}`}
                  >
                    {idx + 1}
                  </div>
                </div>
                <div className="p-1.5 flex flex-col gap-0.5">
                  <div className="text-xs font-medium leading-tight line-clamp-2 text-slate-900">
                    {item.product_name}
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-slate-500 tabular-nums">
                      {item.qty} {item.qty > 1 ? 'vendus' : 'vendu'}
                    </span>
                    <span className="font-semibold text-brand-700 tabular-nums">
                      {formatPrice(item.client_cents)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
        active
          ? 'bg-white text-slate-900 shadow-sm'
          : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  )
}

function PurgeButton({
  from,
  to,
  count,
  disabled,
}: {
  from: Date
  to: Date
  count: number
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const purge = usePurgeTransactions()
  const toast = useToast()

  async function handleConfirm() {
    try {
      const deleted = await purge.mutateAsync({ from, to })
      toast.success(
        deleted === 0
          ? 'Aucune transaction à supprimer sur cette période.'
          : `${deleted} transaction${deleted > 1 ? 's' : ''} supprimée${deleted > 1 ? 's' : ''}.`
      )
      setOpen(false)
      setConfirmText('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur lors de la purge')
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled || count === 0}
        className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-700 border border-red-200 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title={count === 0 ? 'Aucune transaction sur cette période' : 'Supprimer les transactions de la période'}
      >
        <Trash2 className="h-4 w-4" />
        Purger
      </button>

      {open && (
        <Modal
          open
          onClose={() => {
            setOpen(false)
            setConfirmText('')
          }}
          title="Purger les transactions"
          footer={
            <>
              <button
                onClick={() => {
                  setOpen(false)
                  setConfirmText('')
                }}
                className="btn-secondary"
                disabled={purge.isPending}
              >
                Annuler
              </button>
              <button
                onClick={handleConfirm}
                disabled={purge.isPending || confirmText !== 'PURGER'}
                className="btn-danger"
              >
                <Trash2 className="h-4 w-4" />
                {purge.isPending ? 'Suppression…' : `Supprimer ${count} transaction${count > 1 ? 's' : ''}`}
              </button>
            </>
          }
        >
          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-amber-900">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <div className="font-semibold">Action irréversible</div>
                <p className="mt-1">
                  Tu vas supprimer définitivement <strong>{count}</strong> transaction
                  {count > 1 ? 's' : ''} entre le <strong>{formatDate(from.toISOString())}</strong>{' '}
                  et le <strong>{formatDate(to.toISOString())}</strong>.
                </p>
              </div>
            </div>

            <div className="text-slate-600 space-y-2">
              <p>
                Pense à <strong>exporter le PDF</strong> de cette période avant la purge si tu veux
                garder une trace.
              </p>
              <p className="text-xs text-slate-500">
                Note : l'espace disque est récupéré progressivement par PostgreSQL après la
                suppression. Le pourcentage de la base peut mettre quelques minutes à diminuer.
              </p>
            </div>

            <div>
              <label className="label">
                Pour confirmer, tape <code className="text-red-700 font-mono">PURGER</code>{' '}
                ci-dessous :
              </label>
              <input
                className="input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="PURGER"
                autoFocus
              />
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

function RangeDateInput({
  fromValue,
  toValue,
  onFromChange,
  onToChange,
}: {
  fromValue: string
  toValue: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <DatePill label="Du" value={fromValue} onChange={onFromChange} max={toValue} />
      <ArrowRight className="h-4 w-4 text-slate-400" />
      <DatePill label="Au" value={toValue} onChange={onToChange} min={fromValue} />
    </div>
  )
}

function DatePill({
  label,
  value,
  onChange,
  ...rest
}: {
  label: string
  value: string
  onChange: (v: string) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleClick(e: React.MouseEvent) {
    // Si on a cliqué directement sur l'input, laisse le navigateur gérer
    if (e.target === inputRef.current) return
    // Sinon, ouvre le date picker depuis n'importe où dans la pill
    try {
      inputRef.current?.showPicker?.()
    } catch {
      inputRef.current?.focus()
    }
  }

  return (
    <label
      onClick={handleClick}
      className="inline-flex h-9 cursor-pointer items-center rounded-full border border-slate-200 bg-white shadow-sm transition-all hover:border-slate-300 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20"
    >
      <span className="select-none pl-3 pr-2 text-[11px] font-bold uppercase leading-none tracking-widest text-slate-500">
        {label}
      </span>
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full appearance-none border-0 bg-transparent pl-0 pr-3 text-sm font-medium leading-none text-slate-900 focus:outline-none focus:ring-0"
        {...rest}
      />
    </label>
  )
}

function DatePresets({
  onPick,
  globalRange,
}: {
  onPick: (from: string, to: string) => void
  globalRange?: { from: Date; to: Date } | null
}) {
  const today = new Date()
  const yesterday = subDays(today, 1)
  // Semaine française : commence le lundi
  const weekOpts = { weekStartsOn: 1 as const }

  const presets: { label: string; from: Date; to: Date }[] = [
    { label: "Aujourd'hui", from: today, to: today },
    { label: 'Hier', from: yesterday, to: yesterday },
    {
      label: 'Cette semaine',
      from: startOfWeek(today, weekOpts),
      to: endOfWeek(today, weekOpts),
    },
    { label: 'Ce mois', from: startOfMonth(today), to: endOfMonth(today) },
  ]

  if (globalRange) {
    presets.push({
      label: 'Toute la période',
      from: globalRange.from,
      to: globalRange.to,
    })
  }

  return (
    <div className="flex gap-1.5 ml-auto flex-wrap">
      {presets.map((p) => (
        <button
          key={p.label}
          type="button"
          onClick={() =>
            onPick(format(p.from, 'yyyy-MM-dd'), format(p.to, 'yyyy-MM-dd'))
          }
          className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-95"
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
