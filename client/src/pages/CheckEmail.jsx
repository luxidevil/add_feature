import { useState, useRef, useCallback } from 'react';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { apiStream } from '../api';
import { exportXlsx, cn } from '../lib/helpers';
import CopyButton from '../components/CopyButton';
import { usePricing } from '../pricing';
import { Zap, Square, Download, Copy, Check } from 'lucide-react';

export default function CheckEmail() {
  const { user, refreshUser } = useAuth();
  const pricing = usePricing();
  const { toast } = useToast();

  const [input, setInput] = useState('');
  const [results, setResults] = useState([]);
  const [copiedRow, setCopiedRow] = useState(-1);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, active: 0 });
  const [filter, setFilter] = useState('all');
  const abortRef = useRef(null);

  const start = useCallback(async () => {
    const emails = input.split('\n').map(l => l.trim()).filter(Boolean);
    if (!emails.length) return;

    setResults([]);
    setRunning(true);
    setFilter('all');
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ completed: 0, total: emails.length, active: 0 });

    try {
      await apiStream(
        '/proxy/check-email-bulk',
        {
          method: 'POST',
          body: JSON.stringify({ emails }),
          signal: controller.signal,
        },
        (result) => {
          setResults(prev => [...prev, result]);
        },
        (completed, _total, active) => {
          setProgress({ completed, total: emails.length, active });
        }
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
    }

    setRunning(false);
    refreshUser();
  }, [input, refreshUser, toast]);

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const filtered = filter === 'all' ? results : results.filter(r => r.status === filter);
  const emailsText = filtered.map(r => r.email).join('\n');

  const handleExport = () => {
    exportXlsx(
      filtered.map(r => ({
        Email: r.email,
        Status: r.status,
        Screen: r.screenName || '',
        Detail: r.detail || '',
        ProxyCountry: r.proxyCountry || '',
        Duration_ms: r.durationMs ?? '',
        Error: r.error || '',
      })),
      'CheckEmail',
      'check-email-results.xlsx'
    );
  };

  const STATUS_COLOR = {
    working: 'green',
    invalid: 'yellow',
    error: 'red',
    unknown: 'orange',
    wiped: 'purple',
  };

  const statusCounts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const STATUS_ORDER = ['working', 'invalid', 'error', 'unknown', 'wiped'];
  const allStatuses = [
    ...STATUS_ORDER.filter(s => statusCounts[s]),
    ...Object.keys(statusCounts).filter(s => !STATUS_ORDER.includes(s)),
  ];

  const creditCostVM = pricing.credit_cost_check_email || 0.25;
  const vmFilters = [
    { key: 'all', label: 'All', count: results.length, color: '' },
    ...allStatuses.map(s => ({
      key: s,
      label: s.charAt(0).toUpperCase() + s.slice(1),
      count: statusCounts[s] || 0,
      color: STATUS_COLOR[s] || 'orange',
    })),
  ];

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">VM Email</h1>
            <p className="text-gray-400 text-sm">Check if email addresses have active Netflix accounts.</p>
          </div>
          <div className="flex items-center gap-1.5 bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2">
            <Zap size={14} className="text-[#e50914]" />
            <span className="text-xs text-gray-400">{creditCostVM} cr/email</span>
            <span className="text-[#555] mx-1">|</span>
            <span className="text-sm font-semibold text-[#e50914]">{user?.credits.toFixed(2)}</span>
            <span className="text-xs text-gray-500">left</span>
          </div>
        </div>

        <div className="rounded-lg border p-5 space-y-4" style={{ backgroundColor: '#1c1c1c', borderColor: '#333' }}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
              Email List <span className="text-gray-500 font-normal">(one per line)</span>
            </label>
            <textarea
              className="w-full h-40 rounded border px-3 py-2 text-sm font-mono text-gray-200 resize-y placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#e50914]"
              style={{ backgroundColor: '#111', borderColor: '#444' }}
              placeholder={`user@gmail.com\nother@hotmail.com\nuser3@outlook.com`}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={running}
            />
            <p className="text-xs text-gray-500 mt-1">💡 Paste up to 100 emails at a time for best results</p>
          </div>

          <div className="flex items-center gap-3">
            {running ? (
              <button onClick={stop} className="px-5 py-2 rounded font-semibold text-white text-sm" style={{ backgroundColor: '#374151' }}>
                <Square className="w-3 h-3 inline mr-1.5" /> Stop
              </button>
            ) : (
              <button
                onClick={start}
                disabled={!input.trim()}
                className="px-5 py-2 rounded font-semibold text-white text-sm transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#e50914' }}
              >
                Start Check
              </button>
            )}
            {(running || results.length > 0) && (
              <span className="text-sm text-gray-400" data-testid="progress-text">
                {progress.completed} / {progress.total} — {progress.active} active Puppeteer
              </span>
            )}
          </div>
        </div>

        {results.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-1">
                {vmFilters.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      'px-3 py-1.5 rounded text-xs font-medium border transition-colors',
                      filter === f.key
                        ? f.color === 'green'  ? 'bg-green-900/40 text-green-400 border-green-800/50'
                        : f.color === 'yellow' ? 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50'
                        : f.color === 'red'    ? 'bg-red-900/40 text-red-400 border-red-800/50'
                        : f.color === 'orange' ? 'bg-orange-900/40 text-orange-400 border-orange-800/50'
                        : f.color === 'purple' ? 'bg-purple-900/40 text-purple-400 border-purple-800/50'
                        : 'text-white border-transparent'
                        : 'text-gray-500 border-transparent hover:text-gray-300'
                    )}
                    style={filter === f.key && !f.color ? { backgroundColor: '#333' } : {}}
                  >
                    {f.label} ({f.count})
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <CopyButton text={emailsText} label={`Copy ${filtered.length}`} />
                <button
                  onClick={handleExport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium text-gray-300 hover:text-white transition-colors"
                  style={{ backgroundColor: '#2a2a2a', borderColor: '#444' }}
                >
                  <Download className="w-3 h-3" /> Excel
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {filtered.map((r, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between gap-3 rounded border px-4 py-3 text-sm"
                  style={{
                    backgroundColor: r.status === 'working' ? 'rgba(20,83,45,0.15)' : r.status === 'invalid' ? 'rgba(113,63,18,0.15)' : 'rgba(127,29,29,0.15)',
                    borderColor: r.status === 'working' ? 'rgba(22,101,52,0.4)' : r.status === 'invalid' ? 'rgba(133,77,14,0.4)' : 'rgba(153,27,27,0.4)',
                  }}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <VMStatusBadge status={r.status} />
                    <span className="font-mono text-gray-200 truncate">{r.email}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(r.email); setCopiedRow(i); setTimeout(() => setCopiedRow(-1), 1500); }}
                      className="shrink-0 p-0.5 rounded text-gray-600 hover:text-gray-300 transition-colors"
                      title="Copy email"
                    >
                      {copiedRow === i ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                    {r.proxyCountry && <span className="text-gray-500 text-xs shrink-0">{r.proxyCountry}</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {r.detail && <span className="text-gray-400 text-xs max-w-xs truncate">{r.detail}</span>}
                    {r.durationMs && <span className="text-gray-500 text-xs">{(r.durationMs / 1000).toFixed(1)}s</span>}
                    {r.error && <span className="text-red-400 text-xs max-w-xs truncate">{r.error}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VMStatusBadge({ status }) {
  const styles = {
    working: 'bg-green-900/50 text-green-400 border-green-800/50',
    invalid: 'bg-yellow-900/50 text-yellow-400 border-yellow-800/50',
    error: 'bg-red-900/50 text-red-400 border-red-800/50',
  };
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border', styles[status] || styles.error)}>
      {(status || 'UNKNOWN').toUpperCase()}
    </span>
  );
}
