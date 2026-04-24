import { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { api, apiStream } from '../api';
import { exportXlsx, cn } from '../lib/helpers';
import { usePricing } from '../pricing';
import { Link } from 'wouter';
import {
  KeySquare, Zap, Square, Download, Search, Copy, Check,
  CheckCircle, XCircle, Loader2, Mail, AlertTriangle, ExternalLink,
  ChevronDown, ChevronUp, Clock, RefreshCw,
} from 'lucide-react';

const PUPPETEER_MSG = {
  wip: 'Puppeteer browser session running…',
  success: 'Logged in via Puppeteer',
  failed: 'Puppeteer could not complete login',
};

function rowState(r) {
  if (r.status === 'wip') return 'wip';
  return r.ok ? 'success' : 'failed';
}

const IMAP_STEPS = [
  {
    n: '1',
    title: 'Enable 2-Step Verification on Google',
    body: 'Go to myaccount.google.com → Security → "2-Step Verification" and turn it ON.',
    link: 'https://myaccount.google.com/security',
    linkText: 'Open Google Security →',
  },
  {
    n: '2',
    title: 'Create an App Password',
    body: 'Go to Security → "App passwords". Select "Mail" and "Windows Computer", then click Generate.',
    link: 'https://myaccount.google.com/apppasswords',
    linkText: 'Open App Passwords →',
  },
  {
    n: '3',
    title: 'Copy the 16-character code',
    body: 'Google shows a code like "abcd efgh ijkl mnop". Copy it — you only see it once.',
  },
  {
    n: '4',
    title: 'Connect it in the IMAP settings',
    body: 'Go to IMAP / Gmail in the sidebar, enter your Gmail and paste the App Password, then click Save.',
  },
];

export default function SignupCode() {
  const { user, refreshUser } = useAuth();
  const pricing = usePricing();
  const { toast } = useToast();

  const [imapAccounts, setImapAccounts] = useState(null);
  const [loadingImap, setLoadingImap] = useState(true);
  const [showGuide, setShowGuide] = useState(false);

  const [input, setInput] = useState('');
  const [country, setCountry] = useState('');
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, active: 0 });
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [copiedRow, setCopiedRow] = useState(-1);
  const [linkState, setLinkState] = useState({});
  const [bulkFetch, setBulkFetch] = useState({ running: false, results: [], done: false });
  const [bulkCopied, setBulkCopied] = useState(false);
  // One-time popup before "Copy All Links" — reminds the user that the country
  // tag (||CC) was auto-extracted from the Netflix email's SRC: footer and they
  // should override per-row if a different region is needed. Persisted via
  // localStorage so we never nag the same user twice.
  const COUNTRY_NOTICE_KEY = 'dxb_signin_country_notice_v1_dismissed';
  const [showCountryNotice, setShowCountryNotice] = useState(false);
  const [dontShowCountryNotice, setDontShowCountryNotice] = useState(false);
  const abortRef = useRef(null);

  const fetchSigninLink = useCallback(async (r) => {
    const key = r.email;
    setLinkState((prev) => ({ ...prev, [key]: { status: 'fetching' } }));
    try {
      const data = await api('/user/imap/fetch-signin-link', {
        method: 'POST',
        body: JSON.stringify({ accountEmail: r.email }),
      });
      if (data.found && data.resetLink) {
        // Manual country (row-level or default field) wins; otherwise use the
        // country Netflix embeds in the email's SRC: footer (auto-detected).
        const manualCc = (r.country || '').toUpperCase();
        const autoCc = (data.country || '').toUpperCase();
        const cc = manualCc || autoCc;
        const cpLine = cc ? `${data.resetLink}||${cc}` : data.resetLink;
        await navigator.clipboard.writeText(cpLine);
        setLinkState((prev) => ({ ...prev, [key]: { status: 'done', cpLine, country: cc } }));
        setTimeout(() => setLinkState((prev) => ({ ...prev, [key]: { status: 'idle' } })), 3000);
      } else {
        setLinkState((prev) => ({ ...prev, [key]: { status: 'error', error: data.message || 'Link not found in inbox' } }));
      }
    } catch (err) {
      setLinkState((prev) => ({ ...prev, [key]: { status: 'error', error: err.message || 'Fetch failed' } }));
    }
  }, []);

  const fetchAllLinks = useCallback(async () => {
    const successRows = results.filter((r) => rowState(r) === 'success');
    if (!successRows.length) return;

    const initRows = successRows.map((r) => ({
      email: r.email,
      country: (r.country || '').toUpperCase(),
      status: 'fetching',
      cpLine: '',
      error: '',
    }));
    setBulkFetch({ running: true, results: initRows, done: false });
    setBulkCopied(false);

    try {
      const accounts = successRows.map((r) => {
        const cc = (r.country || '').toUpperCase();
        return cc ? `${r.email}:${cc}` : r.email;
      });
      const data = await api('/user/imap/fetch-bulk-signin-links', {
        method: 'POST',
        body: JSON.stringify({ accounts, sinceHours: 24 }),
      });
      const effectiveCountries = (data && data.countries) || {};
      const newRows = successRows.map((r) => {
        const cpLine = data.results && data.results[r.email];
        // Display country = whatever the backend actually appended (manual > auto).
        // Falls back to the row's own country if backend didn't return one.
        const cc = (effectiveCountries[r.email] || r.country || '').toUpperCase();
        if (cpLine) {
          setLinkState((prev) => ({ ...prev, [r.email]: { status: 'done', cpLine, country: cc } }));
          return { email: r.email, country: cc, status: 'success', cpLine, error: '' };
        }
        setLinkState((prev) => ({ ...prev, [r.email]: { status: 'error', error: 'Link not found in inbox' } }));
        return { email: r.email, country: cc, status: 'failed', cpLine: '', error: 'Link not found in inbox' };
      });
      setBulkFetch({ running: false, results: newRows, done: true });
    } catch (err) {
      const msg = err.message || 'Fetch failed';
      setBulkFetch((prev) => ({
        running: false,
        results: prev.results.map((r) => ({ ...r, status: 'failed', error: msg })),
        done: true,
      }));
    }
  }, [results]);

  const bulkSuccessLines = bulkFetch.results.filter((r) => r.status === 'success').map((r) => r.cpLine);
  const bulkSuccessText = bulkSuccessLines.join('\n');

  const performCopyAllBulk = useCallback(async () => {
    if (!bulkSuccessText) return;
    await navigator.clipboard.writeText(bulkSuccessText);
    setBulkCopied(true);
    setTimeout(() => setBulkCopied(false), 2000);
  }, [bulkSuccessText]);

  const copyAllBulk = useCallback(async () => {
    if (!bulkSuccessText) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem(COUNTRY_NOTICE_KEY) === '1'; } catch { /* private mode */ }
    if (dismissed) {
      await performCopyAllBulk();
    } else {
      setDontShowCountryNotice(false);
      setShowCountryNotice(true);
    }
  }, [bulkSuccessText, performCopyAllBulk]);

  const confirmCountryNotice = useCallback(async () => {
    if (dontShowCountryNotice) {
      try { localStorage.setItem(COUNTRY_NOTICE_KEY, '1'); } catch { /* private mode */ }
    }
    setShowCountryNotice(false);
    await performCopyAllBulk();
  }, [dontShowCountryNotice, performCopyAllBulk]);

  const exportBulkXlsx = useCallback(() => {
    exportXlsx(
      bulkFetch.results.map((r) => ({
        Email: r.email,
        Country: r.country,
        Status: r.status === 'success' ? 'SUCCESS' : r.status === 'fetching' ? 'PENDING' : 'FAILED',
        'Sign-in Link': r.cpLine || '',
        Error: r.error || '',
      })),
      'FetchSignInLinks',
      'signin-fetch-links.xlsx',
    );
  }, [bulkFetch.results]);

  useEffect(() => {
    api('/user/imap')
      .then((data) => setImapAccounts(data || []))
      .catch(() => setImapAccounts([]))
      .finally(() => setLoadingImap(false));
  }, []);

  const start = useCallback(async () => {
    if (!input.trim()) return;
    // Parse rows into { email, country }. Supports `email`, `email:CC`, or
    // `email:password:CC` style — only the email + a 2-letter trailing CC are
    // taken; everything else is ignored. Country is OPTIONAL and only used to
    // emit "link||CC" in the Fetch Link / Fetch All output (matches TR).
    const parsedRows = input
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split(':').map((s) => s.trim());
        const email = parts[0] || '';
        let cc = '';
        for (let i = parts.length - 1; i >= 1; i--) {
          if (/^[A-Za-z]{2}$/.test(parts[i])) { cc = parts[i].toUpperCase(); break; }
        }
        return { email, country: cc || (country || '').trim().toUpperCase() };
      })
      .filter((r) => /\S+@\S+\.\S+/.test(r.email));
    if (!parsedRows.length) return;

    const countryMap = {};
    parsedRows.forEach((r) => { countryMap[r.email.toLowerCase()] = r.country; });

    setResults([]);
    setBulkFetch({ running: false, results: [], done: false });
    setLinkState({});
    setRunning(true);
    setFilter('all');
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ completed: 0, total: parsedRows.length, active: 0 });

    try {
      await apiStream(
        '/cr/signup-code-bulk',
        {
          method: 'POST',
          body: JSON.stringify({ emails: input }),
          signal: controller.signal,
        },
        (result) => {
          // Tag each row with its (optional) country so per-row & bulk fetch
          // can emit "link||CC". Backend doesn't need the country at all.
          const cc = countryMap[(result.email || '').toLowerCase()] || '';
          setResults((prev) => [...prev, { ...result, country: cc }]);
        },
        (completed, total, active) => {
          if (completed === -1) {
            setProgress((p) => ({ ...p, total }));
            return;
          }
          setProgress((p) => ({ completed, total: p.total, active }));
        },
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
    }

    setRunning(false);
    refreshUser();
  }, [input, country, refreshUser, toast]);

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const creditCost = pricing.credit_cost_signup_code || 4;
  const successCount = results.filter((r) => rowState(r) === 'success').length;
  const failedCount = results.filter((r) => rowState(r) === 'failed').length;

  const filtered = results.filter((r) => {
    const s = rowState(r);
    const matchFilter = filter === 'all' || filter === s;
    const matchSearch =
      search.trim() === '' || r.email.toLowerCase().includes(search.trim().toLowerCase());
    return matchFilter && matchSearch;
  });

  const emailsText = filtered.map((r) => r.email).join('\n');

  // Customer-facing export — only Email + Status. No internal diagnostics.
  const handleExport = () => {
    exportXlsx(
      filtered.map((r) => {
        const s = rowState(r);
        return {
          Email: r.email,
          Status: s === 'success' ? 'SUCCESS' : s === 'wip' ? 'WIP' : 'FAILED',
          Result: PUPPETEER_MSG[s],
        };
      }),
      'SignInCode',
      'signin-code-results.xlsx',
    );
  };

  const statusBoxes = [
    { key: 'all',     label: 'All',     count: results.length, border: '#444',    text: '#d1d5db', bg: '#1f1f1f' },
    { key: 'success', label: 'Success', count: successCount,    border: '#166534', text: '#4ade80', bg: 'rgba(20,83,45,0.2)' },
    { key: 'failed',  label: 'Failed',  count: failedCount,     border: '#991b1b', text: '#f87171', bg: 'rgba(127,29,29,0.2)' },
  ];

  if (loadingImap) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
      </div>
    );
  }

  const hasImap = imapAccounts && imapAccounts.length > 0;

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Reset via Sign-in Code</h1>
          <p className="text-gray-400 text-sm">
            Triggers Netflix to send a one-time sign-in code, fetches it from your IMAP inbox,
            and completes the login flow automatically.
          </p>
        </div>
        <div className="flex items-center gap-1.5 bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 shrink-0">
          <Zap size={14} className="text-[#e50914]" />
          <span className="text-xs text-gray-400">{creditCost} cr/email</span>
          <span className="text-[#555] mx-1">|</span>
          <span className="text-sm font-semibold text-[#e50914]">{user?.credits?.toFixed(2)}</span>
          <span className="text-xs text-gray-500">left</span>
        </div>
      </div>

      {/* IMAP gate */}
      {!hasImap ? (
        <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/10 p-5 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-300 font-semibold text-sm">IMAP connection required</p>
              <p className="text-yellow-200/70 text-xs mt-1">
                This feature reads the sign-in OTP from your email inbox. You need to connect a Gmail
                (or other IMAP) account first.
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowGuide((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
          >
            {showGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showGuide ? 'Hide setup guide' : 'How to connect Gmail →'}
          </button>

          {showGuide && (
            <div className="space-y-3 pl-1">
              {IMAP_STEPS.map((step) => (
                <div key={step.n} className="flex gap-3">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#e50914] text-white text-xs font-bold shrink-0 mt-0.5">
                    {step.n}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-200">{step.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{step.body}</p>
                    {step.link && (
                      <a
                        href={step.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#e50914] hover:underline mt-1"
                      >
                        <ExternalLink className="w-3 h-3" /> {step.linkText}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Link href="/imap">
            <a className="inline-flex items-center gap-2 px-4 py-2 rounded font-semibold text-sm text-white transition-colors"
               style={{ backgroundColor: '#e50914' }}>
              <Mail className="w-4 h-4" /> Go to IMAP Settings
            </a>
          </Link>
        </div>
      ) : (
        <>
          {/* Connected IMAP badge */}
          <div className="flex items-center gap-2 text-xs text-green-400">
            <CheckCircle className="w-3.5 h-3.5" />
            IMAP connected: <span className="font-mono">{imapAccounts[0].email}</span>
            <Link href="/imap">
              <a className="text-gray-500 hover:text-gray-300 transition-colors">
                <ExternalLink className="w-3 h-3" />
              </a>
            </Link>
          </div>

          {/* Input form */}
          <div className="rounded-lg border p-5 space-y-4" style={{ backgroundColor: '#1c1c1c', borderColor: '#333' }}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#e50914] text-white text-xs font-bold">1</span>
                  Netflix Account Emails
                </span>
                <span className="text-gray-500 font-normal ml-2 text-xs">One email per line</span>
              </label>
              <textarea
                className="w-full h-40 rounded border px-3 py-2 text-sm font-mono text-gray-200 resize-y placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                style={{ backgroundColor: '#111', borderColor: '#444' }}
                placeholder={`user@gmail.com\nother@hotmail.com:US\nthird@yahoo.com:IN`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={running}
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Default country (optional)</label>
                <input
                  type="text"
                  maxLength={2}
                  placeholder="US"
                  value={country}
                  onChange={(e) => setCountry(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                  className="w-16 rounded border px-2 py-1 text-xs font-mono text-gray-200 uppercase placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                  style={{ backgroundColor: '#111', borderColor: '#444' }}
                  disabled={running}
                />
                <span className="text-[11px] text-gray-600">
                  Optional. If left empty, the country is auto-detected from each Netflix email
                  (the <span className="font-mono">SRC:</span> footer carries the account region).
                  Per-row override: <span className="font-mono">email:CC</span>
                </span>
              </div>
            </div>

            <div className="rounded border border-[#2a2a2a] bg-[#161616] px-4 py-3 text-xs text-gray-400 space-y-1">
              <p className="text-gray-300 font-medium text-xs mb-1">How it works</p>
              <p>① Netflix receives a request to send a one-time sign-in code to the account email.</p>
              <p>② The code is fetched from your connected IMAP inbox ({imapAccounts[0].email}).</p>
              <p>③ The code is submitted back to Netflix — success means Puppeteer login was successful.</p>
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
                  style={{ backgroundColor: '#e50914' }}
                >
                  <KeySquare className="w-3.5 h-3.5 inline mr-1.5" />
                  Start Reset
                </button>
              )}
              {(running || results.length > 0) && (
                <span className="text-sm text-gray-400">
                  {running && <Loader2 className="w-3 h-3 inline animate-spin mr-1" />}
                  {progress.completed} / {progress.total}
                  {progress.active > 0 && ` — ${progress.active} active Puppeteer`}
                </span>
              )}
            </div>
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="space-y-3">
              {/* Status boxes */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {statusBoxes.map((box) => (
                  <button
                    key={box.key}
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

              {/* Fetch All Sign-in Links panel — mirrors TR's Fetch All Reset Links */}
              {!running && successCount > 0 && (
                <div className="rounded-lg border p-4 space-y-3" style={{ backgroundColor: '#1a1a1a', borderColor: '#333' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-semibold text-white">Fetch All Sign-in Links</h3>
                      {bulkFetch.done && (
                        <span className="text-xs text-gray-400">
                          {bulkFetch.results.filter((r) => r.status === 'success').length} found / {bulkFetch.results.length} total
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {bulkFetch.running ? (
                        <span className="text-xs text-gray-400">
                          <Loader2 className="w-3 h-3 inline animate-spin mr-1" />
                          Fetching {bulkFetch.results.length}…
                        </span>
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
                            {r.status === 'fetching' && <span className="text-gray-500">Fetching…</span>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Search + export */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[180px] max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search emails…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded border text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                    style={{ backgroundColor: '#111', borderColor: '#444' }}
                  />
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(emailsText);
                      toast({ title: 'Copied', description: `${filtered.length} emails copied` });
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium text-gray-300 hover:text-white transition-colors"
                    style={{ backgroundColor: '#2a2a2a', borderColor: '#444' }}
                  >
                    <Copy className="w-3 h-3" /> Copy {filtered.length}
                  </button>
                  <button
                    onClick={handleExport}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium text-gray-300 hover:text-white transition-colors"
                    style={{ backgroundColor: '#2a2a2a', borderColor: '#444' }}
                  >
                    <Download className="w-3 h-3" /> Excel
                  </button>
                </div>
              </div>

              {/* Rows — customer-facing: only Email + WIP/SUCCESS/FAILED + Puppeteer phrase.
                   No country, OTP, timing, or droplet detail is shown to the user.
                   Admin sees the full raw payload on the Logs page. */}
              <div className="space-y-1.5">
                {filtered.map((r, i) => {
                  const s = rowState(r);
                  const styles = {
                    wip:     { bg: 'rgba(133,77,14,0.12)',  border: 'rgba(133,77,14,0.4)',  badge: 'bg-yellow-900/50 text-yellow-300 border-yellow-800/50', msg: 'text-yellow-300/70' },
                    success: { bg: 'rgba(20,83,45,0.15)',   border: 'rgba(22,101,52,0.4)',  badge: 'bg-green-900/50 text-green-400 border-green-800/50',     msg: 'text-green-400/70' },
                    failed:  { bg: 'rgba(127,29,29,0.15)',  border: 'rgba(153,27,27,0.4)',  badge: 'bg-red-900/50 text-red-400 border-red-800/50',           msg: 'text-red-400/70' },
                  }[s];
                  const Icon = s === 'wip' ? Loader2 : s === 'success' ? CheckCircle : XCircle;
                  return (
                    <div
                      key={i}
                      className="flex items-start justify-between gap-3 rounded border px-4 py-3 text-sm"
                      style={{ backgroundColor: styles.bg, borderColor: styles.border }}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border shrink-0', styles.badge)}>
                          <Icon className={cn('w-3 h-3', s === 'wip' && 'animate-spin')} />
                          {s === 'wip' ? 'WIP' : s === 'success' ? 'SUCCESS' : 'FAILED'}
                        </span>
                        <span className="font-mono text-gray-200 truncate">{r.email}</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(r.email);
                            setCopiedRow(i);
                            setTimeout(() => setCopiedRow(-1), 1500);
                          }}
                          className="shrink-0 p-0.5 rounded text-gray-600 hover:text-gray-300 transition-colors"
                        >
                          {copiedRow === i ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-xs">
                        {r.country && (
                          <span className="text-gray-500 text-[11px] font-mono">{r.country}</span>
                        )}
                        <span className={cn('truncate max-w-xs', styles.msg)}>
                          {PUPPETEER_MSG[s]}
                        </span>
                        {s === 'success' && (() => {
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
                              onClick={() => fetchSigninLink(r)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-300 border border-[#444] bg-[#1a1a1a] hover:border-[#e50914] hover:text-white transition-colors"
                              title="Fetch Netflix sign-in / new-device link from inbox and copy"
                            >
                              <Mail className="w-3 h-3" /> Get Link
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {showCountryNotice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setShowCountryNotice(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border shadow-2xl"
            style={{ backgroundColor: '#1a1a1a', borderColor: '#444' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 px-5 py-4 border-b" style={{ borderColor: '#2a2a2a' }}>
              <div className="rounded-full p-2" style={{ backgroundColor: 'rgba(229,9,20,0.15)' }}>
                <AlertTriangle className="w-5 h-5 text-[#e50914]" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-gray-100">Country auto-detected</h3>
                <p className="text-xs text-gray-500 mt-0.5">Heads up before you paste into CP</p>
              </div>
            </div>

            <div className="px-5 py-4 text-sm text-gray-300 space-y-2">
              <p>
                Each <span className="font-mono text-gray-100">link||CC</span> uses the country
                <span className="text-gray-100 font-medium"> Netflix itself put in the email</span>
                {' '}(read from the <span className="font-mono">SRC:</span> footer).
              </p>
              <p>
                If a row's region is wrong, set the <span className="text-gray-100 font-medium">Default Country</span> field
                or use the per-row <span className="font-mono">email:CC</span> override and re-fetch — your input always wins over auto-detection.
              </p>
            </div>

            <div className="px-5 py-3 border-t flex items-center justify-between gap-3" style={{ borderColor: '#2a2a2a' }}>
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={dontShowCountryNotice}
                  onChange={(e) => setDontShowCountryNotice(e.target.checked)}
                  className="w-3.5 h-3.5 accent-[#e50914] cursor-pointer"
                />
                Don't show this again
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCountryNotice(false)}
                  className="rounded border px-3 py-1.5 text-xs text-gray-300 hover:text-gray-100 transition-colors"
                  style={{ backgroundColor: '#2a2a2a', borderColor: '#444' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmCountryNotice}
                  className="rounded px-3 py-1.5 text-xs font-medium text-white transition-colors"
                  style={{ backgroundColor: '#e50914' }}
                >
                  Got it, copy ({bulkSuccessLines.length})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
