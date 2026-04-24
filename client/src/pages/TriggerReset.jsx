import { useState, useRef, useCallback } from 'react';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { api, apiStream } from '../api';
import { exportXlsx, cn } from '../lib/helpers';
import CopyButton from '../components/CopyButton';
import { usePricing } from '../pricing';
import { Zap, Square, Download, Search, Copy, Check, Mail, Loader2, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

export default function TriggerReset() {
  const { user, refreshUser } = useAuth();
  const pricing = usePricing();
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [country, setCountry] = useState('');
  const [defaultProxy, setDefaultProxy] = useState('');
  const [results, setResults] = useState([]);
  const [copiedRow, setCopiedRow] = useState(-1);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, active: 0 });
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [linkState, setLinkState] = useState({});
  const [bulkFetch, setBulkFetch] = useState({ running: false, results: [], done: false });
  const [bulkCopied, setBulkCopied] = useState(false);
  const abortRef = useRef(null);
  const bulkAbortRef = useRef(false);

  const fetchResetLink = useCallback(async (r) => {
    const key = r.email;
    setLinkState(prev => ({ ...prev, [key]: { status: 'fetching' } }));
    try {
      const data = await api('/user/imap/fetch-reset-link', {
        method: 'POST',
        body: JSON.stringify({ accountEmail: r.email }),
      });
      if (data.found && data.resetLink) {
        const country = (r.country || '').toUpperCase();
        const cpLine = country ? `${data.resetLink}||${country}` : data.resetLink;
        await navigator.clipboard.writeText(cpLine);
        setLinkState(prev => ({ ...prev, [key]: { status: 'done', cpLine } }));
        setTimeout(() => setLinkState(prev => ({ ...prev, [key]: { status: 'idle' } })), 3000);
      } else {
        setLinkState(prev => ({ ...prev, [key]: { status: 'error', error: data.message || 'Link not found in inbox' } }));
      }
    } catch (err) {
      setLinkState(prev => ({ ...prev, [key]: { status: 'error', error: err.message || 'Fetch failed' } }));
    }
  }, []);

  const fetchAllLinks = useCallback(async () => {
    const successRows = results.filter(r => r.success);
    if (!successRows.length) return;
    bulkAbortRef.current = false;

    const initRows = successRows.map(r => ({
      email: r.email,
      country: (r.country || '').toUpperCase(),
      status: 'fetching',
      cpLine: '',
      error: '',
    }));
    setBulkFetch({ running: true, results: initRows, done: false });
    setBulkCopied(false);

    try {
      const accounts = successRows.map(r => {
        const cc = (r.country || '').toUpperCase();
        return cc ? `${r.email}:${cc}` : r.email;
      });
      const data = await api('/user/imap/fetch-bulk-reset-links', {
        method: 'POST',
        body: JSON.stringify({ accounts, sinceHours: 2 }),
      });
      const newRows = successRows.map(r => {
        const cc = (r.country || '').toUpperCase();
        const cpLine = data.results && data.results[r.email];
        if (cpLine) {
          setLinkState(prev => ({ ...prev, [r.email]: { status: 'done', cpLine } }));
          return { email: r.email, country: cc, status: 'success', cpLine, error: '' };
        } else {
          setLinkState(prev => ({ ...prev, [r.email]: { status: 'error', error: 'Link not found in inbox' } }));
          return { email: r.email, country: cc, status: 'failed', cpLine: '', error: 'Link not found in inbox' };
        }
      });
      setBulkFetch({ running: false, results: newRows, done: true });
    } catch (err) {
      const msg = err.message || 'Fetch failed';
      setBulkFetch(prev => ({
        running: false,
        results: prev.results.map(r => ({ ...r, status: 'failed', error: msg })),
        done: true,
      }));
    }
  }, [results]);

  const stopBulkFetch = useCallback(() => { bulkAbortRef.current = true; }, []);

  const bulkSuccessLines = bulkFetch.results.filter(r => r.status === 'success').map(r => r.cpLine);
  const bulkSuccessText = bulkSuccessLines.join('\n');

  const copyAllBulk = useCallback(async () => {
    if (!bulkSuccessText) return;
    await navigator.clipboard.writeText(bulkSuccessText);
    setBulkCopied(true);
    setTimeout(() => setBulkCopied(false), 2000);
  }, [bulkSuccessText]);

  const exportBulkXlsx = useCallback(() => {
    exportXlsx(
      bulkFetch.results.map(r => ({
        Email: r.email,
        Country: r.country,
        Status: r.status === 'success' ? 'SUCCESS' : r.status === 'fetching' ? 'PENDING' : 'FAILED',
        'Reset Link': r.cpLine || '',
        Error: r.error || '',
      })),
      'FetchLinks',
      'tr-fetch-links.xlsx'
    );
  }, [bulkFetch.results]);

  const start = useCallback(async () => {
    if (!input.trim()) return;

    setResults([]);
    setRunning(true);
    setFilter('all');
    const controller = new AbortController();
    abortRef.current = controller;
    const lineEst = input.split('\n').filter(l => l.trim()).length;
    setProgress({ completed: 0, total: lineEst, active: 0 });

    try {
      await apiStream(
        '/proxy/trigger-reset-bulk',
        {
          method: 'POST',
          body: JSON.stringify({ rawList: input, defaultCountry: country || undefined, defaultProxy: defaultProxy || undefined }),
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
  }, [input, country, defaultProxy, refreshUser, toast]);

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const successCount     = results.filter(r => r.success).length;
  const failedCount      = results.filter(r => !r.success).length;
  const emailOnlyCount   = results.filter(r => r.success && r.steps === 1).length;
  const emailPhoneCount  = results.filter(r => r.success && r.steps === 2).length;

  const byStatus = (r) => {
    if (filter === 'success')     return r.success;
    if (filter === 'failed')      return !r.success;
    if (filter === 'emailOnly')   return r.success && r.steps === 1;
    if (filter === 'emailPhone')  return r.success && r.steps === 2;
    return true;
  };

  const filtered = results.filter(r =>
    byStatus(r) && (search.trim() === '' || r.email.toLowerCase().includes(search.trim().toLowerCase()))
  );
  const emailsText = filtered.map(r => {
    const cc = (r.country || '').toUpperCase();
    return cc ? `${r.email}:${cc}` : r.email;
  }).join('\n');

  const handleExport = () => {
    exportXlsx(
      filtered.map(r => ({
        Email: r.email,
        IP: (r.country || '').toUpperCase(),
        Status: r.success ? 'SUCCESS' : 'FAILED',
        Steps: r.steps ?? '',
        Duration_ms: r.durationMs ?? '',
        Error: r.error || '',
      })),
      'TriggerReset',
      'trigger-reset-results.xlsx'
    );
  };

  const creditCost = pricing.credit_cost_trigger_reset || 1;

  const statusBoxes = [
    { key: 'all',        label: 'All',           count: results.length, border: '#444',    text: '#d1d5db', bg: '#1f1f1f' },
    { key: 'success',    label: 'Sent',          count: successCount,   border: '#166534', text: '#4ade80', bg: 'rgba(20,83,45,0.2)' },
    { key: 'failed',     label: 'Failed',        count: failedCount,    border: '#991b1b', text: '#f87171', bg: 'rgba(127,29,29,0.2)' },
    { key: 'emailOnly',  label: 'Email Only',    count: emailOnlyCount, border: '#1e40af', text: '#60a5fa', bg: 'rgba(30,58,138,0.2)' },
    { key: 'emailPhone', label: 'Email + Phone', count: emailPhoneCount,border: '#6b21a8', text: '#c084fc', bg: 'rgba(88,28,135,0.2)' },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Trigger Reset</h1>
          <p className="text-gray-400 text-sm">Submit account emails to trigger password reset emails.</p>
        </div>
        <div className="flex items-center gap-1.5 bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2">
          <Zap size={14} className="text-[#e50914]" />
          <span className="text-xs text-gray-400">{creditCost} cr/email</span>
          <span className="text-[#555] mx-1">|</span>
          <span className="text-sm font-semibold text-[#e50914]">{user?.credits.toFixed(2)}</span>
          <span className="text-xs text-gray-500">left</span>
        </div>
      </div>

      <div className="rounded-lg border p-5 space-y-4" style={{ backgroundColor: '#1c1c1c', borderColor: '#333' }}>

        {/* BOX 1 — Emails */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#e50914] text-white text-xs font-bold">1</span>
              Email List
            </span>
            <span className="text-gray-500 font-normal ml-2 text-xs">
              One per line — <code className="text-gray-400">email</code> or <code className="text-gray-400">email:COUNTRY</code>
            </span>
          </label>
          <textarea
            data-testid="input-emails"
            className="w-full h-40 rounded border px-3 py-2 text-sm font-mono text-gray-200 resize-y placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#e50914]"
            style={{ backgroundColor: '#111', borderColor: '#444' }}
            placeholder={`user@gmail.com\nother@gmail.com:US\nuser3@hotmail.com:TH`}
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={running}
          />
        </div>

        {/* BOX 2 — Default Country */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#e50914] text-white text-xs font-bold">2</span>
              Default Country Code
            </span>
            <span className="text-gray-500 font-normal ml-2 text-xs">
              Applied to all emails without an inline country (e.g. <code className="text-gray-400">TH</code>, <code className="text-gray-400">US</code>, <code className="text-gray-400">IN</code>)
            </span>
          </label>
          <input
            type="text"
            className="w-full rounded border px-3 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#e50914] uppercase"
            style={{ backgroundColor: '#111', borderColor: '#444' }}
            placeholder="US"
            value={country}
            onChange={e => setCountry(e.target.value.toUpperCase())}
            disabled={running}
          />
        </div>

        {/* BOX 3 — Default Proxy URL */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#e50914] text-white text-xs font-bold">3</span>
              Default Proxy URL
            </span>
            <span className="text-gray-500 font-normal ml-2 text-xs">
              Leave blank to use the droplet's own proxy. Per-line <code className="text-gray-400">email:IP:PROXY</code> overrides this.
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
            <button
              data-testid="button-stop"
              onClick={stop}
              className="px-5 py-2 rounded font-semibold text-white text-sm"
              style={{ backgroundColor: '#374151' }}
            >
              <Square className="w-3 h-3 inline mr-1.5" /> Stop
            </button>
          ) : (
            <button
              data-testid="button-start"
              onClick={start}
              disabled={!input.trim()}
              className="px-5 py-2 rounded font-semibold text-white text-sm transition-colors disabled:opacity-50"
              style={{ backgroundColor: '#e50914' }}
            >
              Start Reset
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

          {/* Status count boxes */}
          <div className="grid grid-cols-5 gap-2">
            {statusBoxes.map(box => (
              <button
                key={box.key}
                data-testid={`filter-${box.key}`}
                onClick={() => setFilter(box.key)}
                className="rounded border p-3 text-left transition-all"
                style={{
                  backgroundColor: filter === box.key ? box.bg : '#1a1a1a',
                  borderColor: filter === box.key ? box.border : '#2a2a2a',
                  outline: filter === box.key ? `1px solid ${box.border}` : 'none',
                }}
              >
                <div className="text-2xl font-bold" style={{ color: box.text }}>{box.count}</div>
                <div className="text-xs text-gray-500 mt-0.5">{box.label}</div>
              </button>
            ))}
          </div>

          {/* Fetch All Links panel */}
          {!running && successCount > 0 && (
            <div className="rounded-lg border p-4 space-y-3" style={{ backgroundColor: '#1a1a1a', borderColor: '#333' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-white">Fetch All Reset Links</h3>
                  {bulkFetch.done && (
                    <span className="text-xs text-gray-400">
                      {bulkFetch.results.filter(r => r.status === 'success').length} found / {bulkFetch.results.length} total
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {bulkFetch.running ? (
                    <>
                      <span className="text-xs text-gray-400">
                        <Loader2 className="w-3 h-3 inline animate-spin mr-1" />
                        {bulkFetch.results.length} / {successCount}
                      </span>
                      <button
                        onClick={stopBulkFetch}
                        className="px-3 py-1.5 rounded text-xs font-medium text-white"
                        style={{ backgroundColor: '#374151' }}
                      >
                        <Square className="w-3 h-3 inline mr-1" /> Stop
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={fetchAllLinks}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white transition-colors"
                      style={{ backgroundColor: '#e50914' }}
                    >
                      {bulkFetch.done ? <RefreshCw className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                      {bulkFetch.done ? 'Re-fetch All' : `Fetch All (${successCount})`}
                    </button>
                  )}
                </div>
              </div>

              {bulkFetch.results.length > 0 && (
                <>
                  <div className="flex items-center gap-2">
                    {bulkSuccessLines.length > 0 && (
                      <button
                        onClick={copyAllBulk}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors"
                        style={{
                          backgroundColor: bulkCopied ? 'rgba(20,83,45,0.3)' : '#2a2a2a',
                          borderColor: bulkCopied ? '#166534' : '#444',
                          color: bulkCopied ? '#4ade80' : '#d1d5db',
                        }}
                      >
                        {bulkCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {bulkCopied ? 'Copied!' : `Copy All Links (${bulkSuccessLines.length})`}
                      </button>
                    )}
                    <button
                      onClick={exportBulkXlsx}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium text-gray-300 hover:text-white transition-colors"
                      style={{ backgroundColor: '#2a2a2a', borderColor: '#444' }}
                    >
                      <Download className="w-3 h-3" /> Excel
                    </button>
                  </div>

                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {bulkFetch.results.map((r, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-3 py-1.5 rounded text-xs"
                        style={{
                          backgroundColor: r.status === 'success' ? 'rgba(20,83,45,0.15)' : r.status === 'failed' ? 'rgba(127,29,29,0.15)' : '#111',
                          borderLeft: `2px solid ${r.status === 'success' ? '#166534' : r.status === 'failed' ? '#991b1b' : '#444'}`,
                        }}
                      >
                        {r.status === 'fetching' && <Loader2 className="w-3 h-3 text-gray-400 animate-spin shrink-0" />}
                        {r.status === 'success' && <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />}
                        {r.status === 'failed' && <XCircle className="w-3 h-3 text-red-400 shrink-0" />}
                        <span className="font-mono text-gray-300 w-48 truncate shrink-0">{r.email}</span>
                        {r.country && <span className="text-gray-500 w-8 shrink-0">{r.country}</span>}
                        {r.status === 'success' && (
                          <span className="text-green-400/70 font-mono truncate flex-1">{r.cpLine}</span>
                        )}
                        {r.status === 'failed' && (
                          <span className="text-red-400/70 truncate flex-1">{r.error}</span>
                        )}
                        {r.status === 'fetching' && (
                          <span className="text-gray-500">Fetching…</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Search + actions row */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Search emails…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded border text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                style={{ backgroundColor: '#111', borderColor: '#444' }}
              />
            </div>
            <div className="flex gap-2 shrink-0">
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
                data-testid={`result-row-${i}`}
                className="flex items-start justify-between gap-3 rounded border px-4 py-3 text-sm"
                style={{
                  backgroundColor: r.success ? 'rgba(20,83,45,0.15)' : 'rgba(127,29,29,0.15)',
                  borderColor: r.success ? 'rgba(22,101,52,0.4)' : 'rgba(153,27,27,0.4)',
                }}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <StatusDot success={r.success} />
                  <span className="font-mono text-gray-200 truncate">{r.email}</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(r.email); setCopiedRow(i); setTimeout(() => setCopiedRow(-1), 1500); }}
                    className="shrink-0 p-0.5 rounded text-gray-600 hover:text-gray-300 transition-colors"
                    title="Copy email"
                  >
                    {copiedRow === i ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                  <span className="text-gray-500 text-xs shrink-0">{(r.country || '').toUpperCase()}</span>
                  {r.steps && (
                    <span className="text-gray-500 text-xs shrink-0">
                      {r.steps === 1 ? 'email-only' : 'email+phone'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {r.durationMs && (
                    <span className="text-gray-500 text-xs">{(r.durationMs / 1000).toFixed(1)}s</span>
                  )}
                  {!r.success && r.error && (
                    <span className="text-red-400 text-xs max-w-xs truncate">{r.error}</span>
                  )}
                  {r.success && (() => {
                    const ls = linkState[r.email] || { status: 'idle' };
                    if (ls.status === 'fetching') {
                      return (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-400 border border-[#333] bg-[#1a1a1a]">
                          <Loader2 className="w-3 h-3 animate-spin" /> Fetching…
                        </span>
                      );
                    }
                    if (ls.status === 'done') {
                      return (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-green-400 border border-green-800/50 bg-green-900/20">
                          <Check className="w-3 h-3" /> Copied!
                        </span>
                      );
                    }
                    if (ls.status === 'error') {
                      return (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-red-400 border border-red-800/50 bg-red-900/20 max-w-[180px] truncate" title={ls.error}>
                          {ls.error}
                        </span>
                      );
                    }
                    return (
                      <button
                        onClick={() => fetchResetLink(r)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-300 border border-[#444] bg-[#1a1a1a] hover:border-[#e50914] hover:text-white transition-colors"
                        title="Fetch reset link from inbox and copy for CP"
                      >
                        <Mail className="w-3 h-3" /> Get Link
                      </button>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusDot({ success }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border',
        success
          ? 'bg-green-900/50 text-green-400 border-green-800/50'
          : 'bg-red-900/50 text-red-400 border-red-800/50'
      )}
    >
      {success ? 'SUCCESS' : 'FAILED'}
    </span>
  );
}
