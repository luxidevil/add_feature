import { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { apiStream, api } from '../api';
import { exportXlsx, cn } from '../lib/helpers';
import CopyButton from '../components/CopyButton';
import { Zap, Square, Download, Copy, Check } from 'lucide-react';

const TIER_LABEL = {
  mega_fan: 'Mega Fan',
  fan: 'Fan',
  free: 'Free',
};

const TIER_COLOR = {
  mega_fan: 'blue',
  fan: 'green',
  free: 'gray',
  invalid: 'yellow',
  error: 'red',
};

function TierBadge({ status, tier }) {
  if (status === 'invalid') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-yellow-900/50 text-yellow-400 border-yellow-800/50">
        INVALID
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-red-900/50 text-red-400 border-red-800/50">
        ERROR
      </span>
    );
  }
  if (tier === 'mega_fan') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-blue-900/50 text-blue-400 border-blue-800/50">
        MEGA FAN
      </span>
    );
  }
  if (tier === 'fan') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-green-900/50 text-green-400 border-green-800/50">
        FAN
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-gray-800/80 text-gray-400 border-gray-700/50">
      FREE
    </span>
  );
}

function getRowBg(status, tier) {
  if (status === 'invalid') return { bg: 'rgba(113,63,18,0.15)', border: 'rgba(133,77,14,0.4)' };
  if (status === 'error') return { bg: 'rgba(127,29,29,0.15)', border: 'rgba(153,27,27,0.4)' };
  if (tier === 'mega_fan') return { bg: 'rgba(30,58,138,0.15)', border: 'rgba(29,78,216,0.4)' };
  if (tier === 'fan') return { bg: 'rgba(20,83,45,0.15)', border: 'rgba(22,101,52,0.4)' };
  return { bg: 'rgba(30,30,30,0.6)', border: 'rgba(60,60,60,0.6)' };
}

export default function CrCheck() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();

  const [input, setInput] = useState('');
  const [results, setResults] = useState([]);
  const [copiedRow, setCopiedRow] = useState(-1);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, active: 0 });
  const [filter, setFilter] = useState('all');
  const [creditCost, setCreditCost] = useState(0.5);
  const abortRef = useRef(null);

  useEffect(() => {
    api('/cr/settings').then(d => {
      if (d.credit_cost_cr_check) setCreditCost(d.credit_cost_cr_check);
    }).catch(() => {});
  }, []);

  const start = useCallback(async () => {
    const lines = input.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;

    setResults([]);
    setRunning(true);
    setFilter('all');
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ completed: 0, total: lines.length, active: 0 });

    try {
      await apiStream(
        '/cr/check-bulk',
        {
          method: 'POST',
          body: JSON.stringify({ accounts: lines.join('\n') }),
          signal: controller.signal,
        },
        (result) => setResults(prev => [...prev, result]),
        (completed, _total, active) => setProgress({ completed, total: lines.length, active })
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

  const statusKey = (r) => {
    if (r.status === 'invalid') return 'invalid';
    if (r.status === 'error') return 'error';
    return r.tier || 'free';
  };

  const statusCounts = results.reduce((acc, r) => {
    const k = statusKey(r);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const filtered = filter === 'all'
    ? results
    : results.filter(r => statusKey(r) === filter);

  const accountsText = filtered.map(r => `${r.email}:${r.password || ''}`).join('\n').trim() ||
    filtered.map(r => r.email).join('\n');

  const handleExport = () => {
    exportXlsx(
      filtered.map(r => ({
        Account: r.email,
        Status: r.status,
        Tier: r.tier || '',
        Error: r.error || '',
        Duration_ms: r.durationMs ?? '',
      })),
      'CrunchyrollCheck',
      'cr-check-results.xlsx'
    );
  };

  const FILTER_ORDER = ['mega_fan', 'fan', 'free', 'invalid', 'error'];
  const allKeys = [
    ...FILTER_ORDER.filter(k => statusCounts[k]),
    ...Object.keys(statusCounts).filter(k => !FILTER_ORDER.includes(k)),
  ];

  const filterLabels = {
    mega_fan: 'Mega Fan',
    fan: 'Fan',
    free: 'Free',
    invalid: 'Invalid',
    error: 'Error',
  };

  const filterColorClass = {
    mega_fan: (active) => active ? 'bg-blue-900/40 text-blue-400 border-blue-800/50' : 'text-gray-500 border-transparent hover:text-gray-300',
    fan: (active) => active ? 'bg-green-900/40 text-green-400 border-green-800/50' : 'text-gray-500 border-transparent hover:text-gray-300',
    free: (active) => active ? 'bg-gray-800 text-gray-300 border-gray-700' : 'text-gray-500 border-transparent hover:text-gray-300',
    invalid: (active) => active ? 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50' : 'text-gray-500 border-transparent hover:text-gray-300',
    error: (active) => active ? 'bg-red-900/40 text-red-400 border-red-800/50' : 'text-gray-500 border-transparent hover:text-gray-300',
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Crunchyroll Checker</h1>
            <p className="text-gray-400 text-sm">Check subscription tier for Crunchyroll accounts (Mega Fan / Fan / Free).</p>
          </div>
          <div className="flex items-center gap-1.5 bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2">
            <Zap size={14} className="text-orange-500" />
            <span className="text-xs text-gray-400">{creditCost} cr/account</span>
            <span className="text-[#555] mx-1">|</span>
            <span className="text-sm font-semibold text-orange-500">{user?.credits.toFixed(2)}</span>
            <span className="text-xs text-gray-500">left</span>
          </div>
        </div>

        <div className="rounded-lg border p-5 space-y-4" style={{ backgroundColor: '#1c1c1c', borderColor: '#333' }}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
              Account List <span className="text-gray-500 font-normal">(email:password — one per line)</span>
            </label>
            <textarea
              className="w-full h-44 rounded border px-3 py-2 text-sm font-mono text-gray-200 resize-y placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-orange-500/60"
              style={{ backgroundColor: '#111', borderColor: '#444' }}
              placeholder={`user@gmail.com:Password123\nother@hotmail.com:MyPass456`}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={running}
            />
            <p className="text-xs text-gray-500 mt-1">
              💡 Each account costs <strong className="text-gray-300">{creditCost} cr</strong>. Paste up to 50 accounts at a time.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {running ? (
              <button
                onClick={stop}
                className="px-5 py-2 rounded font-semibold text-white text-sm"
                style={{ backgroundColor: '#374151' }}
              >
                <Square className="w-3 h-3 inline mr-1.5" /> Stop
              </button>
            ) : (
              <button
                onClick={start}
                disabled={!input.trim()}
                className="px-5 py-2 rounded font-semibold text-white text-sm transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#f97316' }}
              >
                Start Check
              </button>
            )}
            {(running || results.length > 0) && (
              <span className="text-sm text-gray-400">
                {progress.completed} / {progress.total} — {progress.active} active
              </span>
            )}
          </div>
        </div>

        {results.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setFilter('all')}
                  className={cn(
                    'px-3 py-1.5 rounded text-xs font-medium border transition-colors',
                    filter === 'all' ? 'text-white border-transparent' : 'text-gray-500 border-transparent hover:text-gray-300'
                  )}
                  style={filter === 'all' ? { backgroundColor: '#333' } : {}}
                >
                  All ({results.length})
                </button>
                {allKeys.map(k => (
                  <button
                    key={k}
                    onClick={() => setFilter(k)}
                    className={cn(
                      'px-3 py-1.5 rounded text-xs font-medium border transition-colors',
                      (filterColorClass[k] || (() => 'text-gray-500 border-transparent'))(filter === k)
                    )}
                  >
                    {filterLabels[k] || k} ({statusCounts[k]})
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <CopyButton text={filtered.map(r => r.email).join('\n')} label={`Copy ${filtered.length}`} />
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
              {filtered.map((r, i) => {
                const { bg, border } = getRowBg(r.status, r.tier);
                return (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-3 rounded border px-4 py-3 text-sm"
                    style={{ backgroundColor: bg, borderColor: border }}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <TierBadge status={r.status} tier={r.tier} />
                      <span className="font-mono text-gray-200 truncate">{r.email}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(r.email);
                          setCopiedRow(i);
                          setTimeout(() => setCopiedRow(-1), 1500);
                        }}
                        className="shrink-0 p-0.5 rounded text-gray-600 hover:text-gray-300 transition-colors"
                        title="Copy email"
                      >
                        {copiedRow === i ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {r.error && (
                        <span className="text-red-400 text-xs max-w-xs truncate" title={r.error}>{r.error}</span>
                      )}
                      {r.durationMs && (
                        <span className="text-gray-500 text-xs">{(r.durationMs / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
