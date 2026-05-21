import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface DbStats {
  db_size_bytes: number
  storage_size_bytes: number
  transactions_count: number
  transaction_items_count: number
  products_count: number
  oldest_transaction: string | null
  newest_transaction: string | null
}

// Limites du free tier Supabase (en octets, base 1024)
export const FREE_TIER_DB_BYTES = 500 * 1024 * 1024 // 500 MiB
export const FREE_TIER_STORAGE_BYTES = 1024 * 1024 * 1024 // 1 GiB

export function useDbStats(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['db-stats'],
    queryFn: async (): Promise<DbStats> => {
      const { data, error } = await supabase.rpc('get_db_stats')
      if (error) throw error
      return data as DbStats
    },
    staleTime: 60_000, // ne pas spammer le serveur, refresh max 1×/min
    enabled: options?.enabled ?? true,
  })
}

export function usePurgeTransactions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ from, to }: { from: Date; to: Date }) => {
      const { data, error } = await supabase.rpc('purge_transactions', {
        from_ts: from.toISOString(),
        to_ts: to.toISOString(),
      })
      if (error) throw error
      return data as number // nombre de transactions supprimées
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['db-stats'] })
    },
  })
}

export function useCancelTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (txId: string) => {
      const { error } = await supabase.rpc('cancel_transaction', { tx_id: txId })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['db-stats'] })
    },
  })
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} Ko`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} Mo`
  const gb = mb / 1024
  return `${gb.toFixed(2)} Go`
}
