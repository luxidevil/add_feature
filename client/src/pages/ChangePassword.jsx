import { useState, useRef, useCallback } from 'react';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { apiStream } from '../api';
import { exportXlsx, cn } from '../lib/helpers';
import CopyButton from '../components/CopyButton';
import { usePricing } from '../pricing';
import { Zap, Square, Download, Copy, Check } from 'lucide-react';

export default function ChangePassword() {
  const { user, refreshUser } = useAuth();
  const pricing = usePricing();
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [defaultPw, setDefaultPw] = useState('');
  const [defaultCountry, setDefaultCountry] = useState('');
  const [defaultProxy, setDefaultProxy] = useState('');
  const [results, setResults] = useState([]);
  const [copiedRow, setCopiedRow] = useState(-1);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, active: 0 });
  const [filter, setFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState(null);
  const abortRef = useRef(null);

  const start = useCallback(async () => {
    if (!input.trim()) return;

    setResults([]);
    setRunning(true);
    setFilter('all');
    setPlanFilter(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const lineEst = input.split('\n').filter(l => l.trim()).length;
    setProgress({ completed: 0, total: lineEst, active: 0 });

    try {
      await apiStream(
        '/proxy/change-password-bulk',
        {
          method: 'POST',
          body: JSON.stringify({
            rawList: input,
            defaultPassword: defaultPw || undefined,
            defaultCountry: defaultCountry || undefined,
            defaultProxy: defaultProxy || undefined,
          }),
          signal: controller.signal,
        },
        (result) => {
          setResults(prev => [...prev, result]);
        },
        (completed, total, active) => {
          if (completed === -1) {
            setProgress(p => ({ ...p, total }));
            return;
          }
          setProgress(p => ({ completed, total: p.total, active }));
        }
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
    }

    setRunning(false);
    refreshUser();
  }, [input, defaultPw, defaultCountry, defaultProxy, refreshUser, toast]);

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const successCount = results.filter(r => r.success && r.account?.status !== 'inactive').length;
  const holdCount = results.filter(r => r.account?.status === 'hold').length;
  const inactiveCount = results.filter(r => r.account?.status === 'inactive').length;
  const failedCount = results.filter(r => !r.success && r.account?.status !== 'inactive' && r.account?.status !== 'hold').length;

  const byStatus = r => {
    if (filter === 'success') return r.success && r.account?.status !== 'inactive';
    if (filter === 'hold') return r.account?.status === 'hold';
    if (filter === 'inactive') return r.account?.status === 'inactive';
    if (filter === 'failed') return !r.success && r.account?.status !== 'inactive' && r.account?.status !== 'hold';
    return true;
  };

  const filtered = results.filter(r => byStatus(r) && (!planFilter || r.account?.plan === planFilter));

  const uniquePlans = [...new Set(results.filter(r => r.account?.plan).map(r => r.account.plan))].sort();

  const planCounts = Object.fromEntries(
    uniquePlans.map(p => [p, results.filter(r => byStatus(r) && r.account?.plan === p).length])
  );

  const emailsText = (filter === 'success' || filter === 'inactive' || planFilter)
    ? filtered.map(r => r.account?.email || '').filter(Boolean).join('\n')
    : filtered.map(r => r.account?.email || r.resetUrl || '').join('\n');

  const handleExport = () => {
    exportXlsx(
      filtered.map(r => ({
        Email: r.account?.email || '',
        Plan: r.account?.plan || '',
        Status_Account: r.account?.status || '',
        MemberSince: r.account?.memberSince || '',
        NextBilling: r.account?.nextBillingDate || '',
        Result: r.success ? 'SUCCESS' : 'FAILED',
        Duration_ms: r.durationMs ?? '',
        Error: r.error || '',
      })),
      'ChangePassword',
      'change-password-results.xlsx'
    );
  };

  const creditCost = pricing.credit_cost_change_password || 1.5;
  const filters = [
    { key: 'all',      label: 'All',      count: results.length, color: '' },
    { key: 'success',  label: 'Success',  count: successCount,   color: 'green' },
    { key: 'hold',     label: 'Hold',     count: holdCount,      color: 'yellow' },
    { key: 'inactive', label: 'Inactive', count: inactiveCount,  color: 'gray' },
    { key: 'failed',   label: 'Failed',   count: failedCount,    color: 'red' },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Change Password</h1>
          <p className="text-gray-400 text-sm">Use password reset links to change account passwords and retrieve account info.</p>
        </div>
        <div className="flex items-center gap-1.5 bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2">
          <Zap size={14} className="text-[#e50914]" />
          <span className="text-xs text-gray-400">{creditCost} cr/url</span>
          <span className="text-[#555] mx-1">|</span>
          <span className="text-sm font-semibold text-[#e50914]">{user?.credits.toFixed(2)}</span>
          <span className="text-xs text-gray-500">left</span>
        </div>
      </div>

      <div className="rounded-lg border p-5 space-y-4" style={{ backgroundColor: '#1c1c1c', borderColor: '#333' }}>

        {/* BOX 1 — Reset URLs */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#e50914] text-white text-xs font-bold">1</span>
              Reset URLs
            </span>
            <span className="text-gray-500 font-normal ml-2 text-xs">
              One per line — <code className="text-gray-400">url</code> or <code className="text-gray-400">url|password</code> or <code className="text-gray-400">url|password|COUNTRY</code>
            </span>
          </label>
          <textarea
            className="w-full h-40 rounded border px-3 py-2 text-sm font-mono text-gray-200 resize-y placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#e50914]"
            style={{ backgroundColor: '#111', borderColor: '#444' }}
            placeholder={`https://www.netflix.com/password?nftoken=...\nhttps://www.netflix.com/password?nftoken=...|MyNewPass123\nhttps://www.netflix.com/password?nftoken=...|MyNewPass123|TH`}
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={running}
          />
        </div>

        {/* BOX 2 — Default Password / BOX 3 — Default Country */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#e50914] text-white text-xs font-bold">2</span>
                Default Password
              </span>
              <span className="text-gray-500 font-normal ml-2 text-xs">For URLs without <code className="text-gray-400">|password</code></span>
            </label>
            <input
              type="text"
              className="w-full rounded border px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#e50914]"
              style={{ backgroundColor: '#111', borderColor: '#444' }}
              placeholder="NewPass123"
              value={defaultPw}
              onChange={e => setDefaultPw(e.target.value)}
              disabled={running}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-300">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#e50914] text-white text-xs font-bold">3</span>
                Default Country Code
              </span>
              <span className="text-gray-500 font-normal ml-2 text-xs">e.g. <code className="text-gray-400">TH</code>, <code className="text-gray-400">US</code></span>
            </label>
            <input
              type="text"
              className="w-full rounded border px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#e50914] uppercase"
              style={{ backgroundColor: '#111', borderColor: '#444' }}
              placeholder="US"
              value={defaultCountry}
              onChange={e => setDefaultCountry(e.target.value.toUpperCase())}
              disabled={running}
            />
          </div>
        </div>

        {/* BOX 4 — Default Proxy URL */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#e50914] text-white text-xs font-bold">4</span>
              Default Proxy URL
            </span>
            <span className="text-gray-500 font-normal ml-2 text-xs">
              Leave blank to use the droplet's own proxy. Per-line <code className="text-gray-400">|proxy</code> overrides this.
            </span>
          </label>
          <input
            type="text"
            className="w-full rounded border px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#e50914]"
            style={{ backgroundColor: '#111', borderColor: '#444' }}
            placeholder="http://user:pass_country-us@host:port  (optional)"
            value={defaultProxy}
            onChange={e => setDefaultProxy(e.target.value.trim())}
            disabled={running}
          />
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
              Start Change
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
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex gap-1 flex-wrap">
                {filters.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      'px-3 py-1.5 rounded text-xs font-medium border transition-colors',
                      filter === f.key
                        ? f.color === 'green'  ? 'bg-green-900/40 text-green-400 border-green-800/50'
                        : f.color === 'red'    ? 'bg-red-900/40 text-red-400 border-red-800/50'
                        : f.color === 'yellow' ? 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50'
                        : f.color === 'gray'   ? 'bg-gray-700/40 text-gray-300 border-gray-600/50'
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

            {uniquePlans.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-gray-600 pr-1">Plan:</span>
                {planFilter && (
                  <button
                    onClick={() => setPlanFilter(null)}
                    className="px-2 py-0.5 rounded text-xs font-medium border border-gray-600/50 text-gray-400 hover:text-white transition-colors"
                    style={{ backgroundColor: '#2a2a2a' }}
                  >
                    × All
                  </button>
                )}
                {uniquePlans.map(plan => (
                  <button
                    key={plan}
                    onClick={() => setPlanFilter(planFilter === plan ? null : plan)}
                    className={cn(
                      'px-2.5 py-0.5 rounded text-xs font-medium border transition-colors',
                      planFilter === plan
                        ? 'bg-blue-900/50 text-blue-300 border-blue-700/60'
                        : 'text-gray-500 border-transparent hover:text-blue-300 hover:border-blue-800/40'
                    )}
                  >
                    {plan} ({planCounts[plan] ?? 0})
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            {filtered.map((r, i) => (
              <div
                key={i}
                className="rounded border px-4 py-3 text-sm"
                style={{
                  backgroundColor:
                    r.account?.status === 'hold'     ? 'rgba(113,63,18,0.15)' :
                    r.account?.status === 'inactive' ? 'rgba(55,65,81,0.15)'  :
                    r.success                        ? 'rgba(20,83,45,0.15)'  :
                                                       'rgba(127,29,29,0.15)',
                  borderColor:
                    r.account?.status === 'hold'     ? 'rgba(161,98,7,0.4)'   :
                    r.account?.status === 'inactive' ? 'rgba(75,85,99,0.4)'   :
                    r.success                        ? 'rgba(22,101,52,0.4)'  :
                                                       'rgba(153,27,27,0.4)',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <CPStatusBadge success={r.success} account={r.account} />
                    <span className="font-mono text-gray-200 truncate">{r.account?.email || 'N/A'}</span>
                    {(r.account?.email) && (
                      <button
                        onClick={() => { navigator.clipboard.writeText(r.account.email); setCopiedRow(i); setTimeout(() => setCopiedRow(-1), 1500); }}
                        className="shrink-0 p-0.5 rounded text-gray-600 hover:text-gray-300 transition-colors"
                        title="Copy email"
                      >
                        {copiedRow === i ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {r.durationMs && <span className="text-gray-500 text-xs">{(r.durationMs / 1000).toFixed(1)}s</span>}
                  </div>
                </div>
                <AccountBadges account={r.account} error={r.error} success={r.success} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CPStatusBadge({ success, account }) {
  const status = account?.status;

  if (status === 'hold') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-yellow-900/50 text-yellow-400 border-yellow-800/50">
        HOLD
      </span>
    );
  }
  if (status === 'inactive') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border bg-gray-700/40 text-gray-400 border-gray-600/40">
        INACTIVE
      </span>
    );
  }
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border',
      success
        ? 'bg-green-900/50 text-green-400 border-green-800/50'
        : 'bg-red-900/50 text-red-400 border-red-800/50'
    )}>
      {success ? 'SUCCESS' : 'FAILED'}
    </span>
  );
}

function AccountBadges({ account, error, success }) {
  const hasBadges = account?.plan || account?.status === 'active' || account?.memberSince || account?.nextBillingDate || (!success && error);
  if (!hasBadges) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {account?.plan && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-blue-900/40 text-blue-300 border-blue-800/40">
          {account.plan}
        </span>
      )}
      {account?.status === 'active' && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-green-900/40 text-green-300 border-green-800/40">
          ACTIVE
        </span>
      )}
      {account?.memberSince && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs border bg-gray-800/60 text-gray-400 border-gray-700/40">
          Since: {account.memberSince}
        </span>
      )}
      {account?.nextBillingDate && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs border bg-gray-800/60 text-gray-400 border-gray-700/40">
          Next: {account.nextBillingDate}
        </span>
      )}
      {!success && error && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-red-900/30 text-red-400 border-red-800/40">
          {error}
        </span>
      )}
    </div>
  );
}
