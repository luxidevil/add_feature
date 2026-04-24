import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { cn } from '../lib/helpers';
import { TrendingDown, TrendingUp, Wallet } from 'lucide-react';

const TYPE_LABELS = {
  'trigger-reset': 'Trigger Reset',
  'change-password': 'Change Password',
  'check-email': 'VM Email',
  'top-up': 'Top-Up',
};

const TYPE_SHORT = {
  'trigger-reset': 'TR',
  'change-password': 'CP',
  'check-email': 'VM',
  'top-up': 'TOP',
};

export default function Credits() {
  const { toast } = useToast();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/user/credits/history');
      setHistory(data);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = filter
    ? history.filter(h => h.type === filter)
    : history;

  const totalSpent = history
    .filter(h => h.kind === 'deduction')
    .reduce((sum, h) => sum + Math.abs(h.amount), 0);

  const totalAdded = history
    .filter(h => h.kind === 'topup')
    .reduce((sum, h) => sum + h.amount, 0);

  const selectClass = "bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#e50914]/50";

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Credit History</h1>
        <p className="text-gray-400 text-sm">A full record of how your credits were spent and added.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#222] flex items-center justify-center flex-shrink-0">
            <Wallet size={16} className="text-gray-400" />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-0.5">Total Transactions</div>
            <div className="text-lg font-bold text-white">{history.length}</div>
          </div>
        </div>
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-900/30 flex items-center justify-center flex-shrink-0">
            <TrendingDown size={16} className="text-red-400" />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-0.5">Total Spent</div>
            <div className="text-lg font-bold text-red-400">{totalSpent.toFixed(2)}</div>
          </div>
        </div>
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-green-900/30 flex items-center justify-center flex-shrink-0">
            <TrendingUp size={16} className="text-green-400" />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-0.5">Total Added</div>
            <div className="text-lg font-bold text-green-400">+{totalAdded.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-3">
        <select value={filter} onChange={e => setFilter(e.target.value)} className={selectClass}>
          <option value="">All Types</option>
          <option value="trigger-reset">Trigger Reset</option>
          <option value="change-password">Change Password</option>
          <option value="check-email">VM Email</option>
          <option value="top-up">Top-Up</option>
        </select>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-8">No history found</div>
      ) : (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#333]">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Detail</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Balance After</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} className="border-b border-[#222] hover:bg-[#222]/50">
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded font-mono border',
                      row.kind === 'topup'
                        ? 'bg-green-900/30 text-green-400 border-green-800/40'
                        : row.type === 'trigger-reset'
                        ? 'bg-blue-900/30 text-blue-400 border-blue-800/40'
                        : row.type === 'change-password'
                        ? 'bg-purple-900/30 text-purple-400 border-purple-800/40'
                        : 'bg-orange-900/30 text-orange-400 border-orange-800/40'
                    )}>
                      {TYPE_SHORT[row.type] || row.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 truncate max-w-[180px] font-mono text-xs">
                    {row.kind === 'topup'
                      ? <span title={row.txHash}>{row.usdtAmount} USDT</span>
                      : row.email || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded border',
                      row.status === 'success' ? 'bg-green-900/40 text-green-400 border-green-800/50'
                      : row.status === 'failed' || row.status === 'error' ? 'bg-red-900/40 text-red-400 border-red-800/50'
                      : 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50'
                    )}>
                      {row.status}
                    </span>
                  </td>
                  <td className={cn(
                    'px-4 py-3 text-right font-mono font-semibold',
                    row.kind === 'topup' ? 'text-green-400' : 'text-red-400'
                  )}>
                    {row.kind === 'topup' ? `+${row.amount}` : row.amount.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-400 text-xs">
                    {row.balanceAfter !== null ? row.balanceAfter.toFixed(2) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-gray-600">{filtered.length} entries shown</div>
    </div>
  );
}
