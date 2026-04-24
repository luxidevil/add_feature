import { Fragment, useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { useAuth } from '../auth';
import { cn } from '../lib/helpers';
import { Search, Trash2, ChevronDown, ChevronRight } from 'lucide-react';

export default function Logs() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      const data = await api(`/user/logs?${params.toString()}`);
      setLogs(data);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  }, [search, typeFilter, statusFilter, toast]);

  useEffect(() => { load(); }, [load]);

  const deleteLog = async (id) => {
    try {
      await api(`/user/logs/${id}`, { method: 'DELETE' });
      setLogs(prev => prev.filter(l => l.id !== id));
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const selectClass = "bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[#e50914]/50";

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">My Logs</h1>
        <p className="text-gray-400 text-sm">View your operation history.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by email..."
            className="w-full bg-[#111] border border-[#333] rounded pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50"
          />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={selectClass}>
          <option value="">All Types</option>
          <option value="trigger-reset">Trigger Reset</option>
          <option value="change-password">Change Password</option>
          <option value="check-email">Check Email</option>
          <option value="signup-code">Sign-in Code</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={selectClass}>
          <option value="">All Status</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="error">Error</option>
        </select>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : logs.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-8">No logs found</div>
      ) : (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#333]">
                {isAdmin && <th className="px-2 py-3 w-6"></th>}
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Credits</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const isOpen = expanded.has(log.id);
                const colSpan = isAdmin ? 7 : 6;
                return (
                  <Fragment key={log.id}>
                    <tr className="border-b border-[#222] hover:bg-[#222]/50">
                      {isAdmin && (
                        <td className="px-2 py-3 align-top">
                          <button
                            onClick={() => toggleExpand(log.id)}
                            className="text-gray-500 hover:text-white transition-colors"
                            title="Show raw payload"
                          >
                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>
                      )}
                      <td className="px-4 py-3 font-mono text-gray-300 truncate max-w-[200px]">{log.email || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded bg-[#222] text-gray-400 border border-[#333]">
                          {log.type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'text-xs px-2 py-0.5 rounded font-medium border',
                          log.status === 'success' ? 'bg-green-900/40 text-green-400 border-green-800/50'
                          : log.status === 'failed' ? 'bg-red-900/40 text-red-400 border-red-800/50'
                          : 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50'
                        )}>
                          {log.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">{log.creditsUsed}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(log.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => deleteLog(log.id)} className="text-gray-600 hover:text-red-400 transition-colors">
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                    {isAdmin && isOpen && (
                      <tr className="border-b border-[#222] bg-[#0b0b0b]">
                        <td colSpan={colSpan} className="px-4 py-3">
                          <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Raw payload (admin only)</div>
                          <pre className="text-xs text-gray-300 bg-black/40 border border-[#222] rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
{JSON.stringify(log.result ?? {}, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-gray-600">{logs.length} logs shown</div>
    </div>
  );
}
