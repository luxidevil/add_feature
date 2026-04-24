import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/Toast';
import { api } from '../api';
import { Trash2, CheckCircle, XCircle, Loader, Mail, RefreshCw, ChevronDown, ChevronUp, ExternalLink, Copy, Check, Download, Settings } from 'lucide-react';
import { exportXlsx } from '../lib/helpers';

const STEPS = [
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
    title: 'Paste it below',
    body: 'Enter your Gmail and paste the 16-character App Password. Do NOT use your regular Gmail password.',
  },
];

export default function Imap() {
  const { toast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [provider, setProvider] = useState('gmail');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState(993);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testBeforeAdd, setTestBeforeAdd] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [testIdResult, setTestIdResult] = useState({});

  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState([]);
  const [copiedIdx, setCopiedIdx] = useState(-1);
  const [copiedAll, setCopiedAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAccounts(await api('/user/imap')); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!loading && accounts.length === 0) setShowSettings(true);
  }, [loading, accounts.length]);

  const handleTestNew = async () => {
    if (!email || !password) return;
    setTesting(true);
    setTestBeforeAdd(null);
    try {
      const r = await api('/user/imap/test', {
        method: 'POST',
        body: JSON.stringify({ email, password, provider, imapHost: provider === 'imap' ? imapHost : undefined, imapPort: provider === 'imap' ? imapPort : undefined }),
      });
      setTestBeforeAdd(r);
    } catch (err) {
      setTestBeforeAdd({ ok: false, error: err.message });
    }
    setTesting(false);
  };

  const handleAdd = async () => {
    if (!email || !password) return;
    setSaving(true);
    try {
      await api('/user/imap', {
        method: 'POST',
        body: JSON.stringify({ provider, email, password, imapHost: provider === 'imap' ? imapHost : undefined, imapPort: provider === 'imap' ? imapPort : undefined }),
      });
      toast({ title: 'Account connected!' });
      setEmail(''); setPassword(''); setImapHost(''); setTestBeforeAdd(null);
      load();
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    try {
      await api(`/user/imap/${id}`, { method: 'DELETE' });
      setAccounts(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleTestExisting = async (acc) => {
    setTestingId(acc.id);
    try {
      const r = await api('/user/imap/test', { method: 'POST', body: JSON.stringify({ id: acc.id }) });
      setTestIdResult(prev => ({ ...prev, [acc.id]: r }));
    } catch (err) {
      setTestIdResult(prev => ({ ...prev, [acc.id]: { ok: false, error: err.message } }));
    }
    setTestingId(null);
  };

  const parseInput = (text) => {
    return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const parts = line.split(':');
      const em = parts[0].trim();
      const country = parts[1]?.trim().toUpperCase() || '';
      return { email: em, country };
    }).filter(r => r.email.includes('@'));
  };

  const handleFetch = async () => {
    const items = parseInput(input);
    if (!items.length) return;
    setRunning(true);
    setRows(items.map(r => ({ ...r, status: 'pending', resetLink: null, error: null })));

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'fetching' } : r));
      try {
        const data = await api('/user/imap/fetch-reset-link', {
          method: 'POST',
          body: JSON.stringify({ accountEmail: item.email }),
        });
        if (data.found && data.resetLink) {
          setRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'found', resetLink: data.resetLink } : r));
        } else {
          setRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'notfound', error: data.message || 'Not found' } : r));
        }
      } catch (err) {
        setRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: err.message } : r));
      }
    }
    setRunning(false);
  };

  const buildCpLine = (row) => row.country ? `${row.resetLink}||${row.country}` : row.resetLink;

  const copyRow = async (row, idx) => {
    await navigator.clipboard.writeText(buildCpLine(row));
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(-1), 1500);
  };

  const copyAll = async () => {
    const found = rows.filter(r => r.status === 'found');
    if (!found.length) return;
    await navigator.clipboard.writeText(found.map(buildCpLine).join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  };

  const handleExport = () => {
    exportXlsx(
      rows.map(r => ({
        Email: r.email,
        Country: r.country || '',
        Status: r.status === 'found' ? '✓' : '✗',
        ResetLink: r.resetLink || '',
        CP_Line: r.resetLink ? buildCpLine(r) : '',
        Error: r.error || '',
      })),
      'FetchLinks',
      'fetch-links.xlsx'
    );
  };

  const foundCount = rows.filter(r => r.status === 'found').length;
  const notFoundCount = rows.filter(r => r.status === 'notfound' || r.status === 'error').length;
  const hasAccount = accounts.length > 0;
  const inputClass = "w-full bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50";
  const labelClass = "block text-xs font-medium text-gray-400 mb-1.5";

  return (
    <div className="p-6 md:p-8 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Fetch Links</h1>
          <p className="text-gray-400 text-sm">Paste Netflix account emails → get password reset links from your Gmail via IMAP</p>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`flex items-center gap-2 px-3 py-2 rounded border text-xs font-medium transition-colors ${
            hasAccount
              ? 'border-[#333] text-gray-400 hover:text-white hover:border-[#555]'
              : 'border-[#e50914]/50 text-[#e50914] bg-[#e50914]/10 hover:bg-[#e50914]/20'
          }`}
        >
          <Settings size={13} />
          {hasAccount ? `Gmail Connected` : 'Connect Gmail'}
          {hasAccount && <CheckCircle size={11} className="text-green-400" />}
        </button>
      </div>

      {showSettings && (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden">
          <button onClick={() => setShowGuide(!showGuide)}
            className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-[#222] transition-colors">
            <span className="text-sm font-semibold text-white">How to connect Gmail</span>
            {showGuide ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
          </button>
          {showGuide && (
            <div className="px-5 py-4 border-t border-[#222] space-y-4">
              {STEPS.map(s => (
                <div key={s.n} className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#e50914]/10 border border-[#e50914]/30 flex items-center justify-center text-[#e50914] text-xs font-bold">{s.n}</div>
                  <div className="pb-3 border-b border-[#222] w-full last:border-0 last:pb-0">
                    <div className="text-white text-xs font-semibold mb-0.5">{s.title}</div>
                    <div className="text-gray-400 text-xs">{s.body}</div>
                    {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 text-xs text-blue-400 hover:text-blue-300">{s.linkText} <ExternalLink size={9} /></a>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-[#222] p-5 space-y-4">
            {accounts.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-gray-500 font-medium">Connected Accounts</div>
                {accounts.map(acc => (
                  <div key={acc.id} className="flex items-center justify-between bg-[#111] border border-[#2a2a2a] rounded px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Mail size={12} className="text-gray-500" />
                      <span className="text-sm text-white font-mono">{acc.email}</span>
                      <span className="text-xs text-gray-600">{acc.provider === 'gmail' ? 'Gmail' : acc.imapHost || 'Custom'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {testIdResult[acc.id] && (
                        testIdResult[acc.id].ok
                          ? <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={11} /> OK</span>
                          : <span className="text-xs text-red-400 flex items-center gap-1"><XCircle size={11} /> Failed</span>
                      )}
                      <button onClick={() => handleTestExisting(acc)} disabled={testingId === acc.id}
                        className="px-2 py-1 text-xs border border-[#333] text-gray-400 hover:text-white rounded transition-colors disabled:opacity-50">
                        {testingId === acc.id ? <Loader size={10} className="animate-spin" /> : 'Test'}
                      </button>
                      <button onClick={() => handleDelete(acc.id)} className="text-gray-600 hover:text-red-400 transition-colors p-1">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3">
              <div className="text-xs text-gray-500 font-medium">{accounts.length > 0 ? 'Add Another Account' : 'Add Gmail Account'}</div>
              <div className="flex gap-3">
                <select value={provider} onChange={e => setProvider(e.target.value)}
                  className="bg-[#111] border border-[#333] text-white text-xs rounded px-2 py-2 focus:outline-none w-28">
                  <option value="gmail">Gmail</option>
                  <option value="imap">Custom IMAP</option>
                </select>
                <input type="text" placeholder="email@gmail.com" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} />
                <input type="password" placeholder="App Password" value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
              </div>
              {provider === 'imap' && (
                <div className="flex gap-3">
                  <input type="text" placeholder="IMAP Host" value={imapHost} onChange={e => setImapHost(e.target.value)} className={inputClass} />
                  <input type="number" placeholder="993" value={imapPort} onChange={e => setImapPort(Number(e.target.value))} className={inputClass + ' w-24'} />
                </div>
              )}
              {testBeforeAdd && (
                <div className={`text-xs px-3 py-2 rounded border ${testBeforeAdd.ok ? 'bg-green-900/20 border-green-800/40 text-green-400' : 'bg-red-900/20 border-red-800/40 text-red-400'}`}>
                  {testBeforeAdd.ok ? '✓ Connection successful' : `✗ ${testBeforeAdd.error?.includes('auth') || testBeforeAdd.error?.includes('LOGIN') ? 'Wrong App Password — use the 16-char code, not your Gmail password' : testBeforeAdd.error}`}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={handleTestNew} disabled={testing || !email || !password}
                  className="px-3 py-1.5 text-xs border border-[#333] text-gray-400 hover:text-white rounded transition-colors disabled:opacity-50 flex items-center gap-1">
                  {testing ? <Loader size={10} className="animate-spin" /> : <CheckCircle size={10} />} Test
                </button>
                <button onClick={handleAdd} disabled={saving || !email || !password}
                  className="px-4 py-1.5 text-xs bg-[#e50914] text-white rounded font-medium disabled:opacity-50 flex items-center gap-1">
                  {saving ? <Loader size={10} className="animate-spin" /> : null} Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!hasAccount && !showSettings && (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-8 text-center">
          <Mail size={28} className="text-gray-600 mx-auto mb-3" />
          <div className="text-gray-400 text-sm mb-3">Connect your Gmail first to start fetching reset links</div>
          <button onClick={() => setShowSettings(true)} className="px-4 py-2 bg-[#e50914] text-white text-sm rounded font-medium">Connect Gmail</button>
        </div>
      )}

      {hasAccount && (
        <div className="space-y-5">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-5">
            <label className={labelClass}>
              Netflix Account Emails
              <span className="text-gray-600 font-normal ml-2">one per line — <code className="text-gray-500">email:COUNTRY</code></span>
            </label>
            <textarea
              className="w-full h-40 rounded border px-3 py-2 text-sm font-mono text-gray-200 resize-y placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-[#e50914]"
              style={{ backgroundColor: '#111', borderColor: '#444' }}
              placeholder={`user@gmail.com:US\nother@yahoo.com:TH\naccount@hotmail.com:IN`}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={running}
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-gray-500">Searches last 24h — returns latest reset link per account</span>
              <button
                onClick={handleFetch}
                disabled={running || !input.trim()}
                className="px-5 py-2 rounded font-semibold text-white text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: '#e50914' }}
              >
                {running ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {running ? 'Fetching…' : 'Fetch Links'}
              </button>
            </div>
          </div>

          {rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  {foundCount > 0 && (
                    <span className="text-xs px-2 py-1 rounded border bg-green-900/20 border-green-800/40 text-green-400">
                      ✓ {foundCount} found
                    </span>
                  )}
                  {notFoundCount > 0 && (
                    <span className="text-xs px-2 py-1 rounded border bg-red-900/20 border-red-800/40 text-red-400">
                      ✗ {notFoundCount} not found
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {foundCount > 0 && (
                    <button
                      onClick={copyAll}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors"
                      style={{ backgroundColor: copiedAll ? 'rgba(20,83,45,0.3)' : '#1a1a1a', borderColor: copiedAll ? 'rgba(22,101,52,0.6)' : '#444', color: copiedAll ? '#4ade80' : '#d1d5db' }}
                    >
                      {copiedAll ? <Check size={12} /> : <Copy size={12} />}
                      {copiedAll ? 'Copied!' : `Copy All (${foundCount})`}
                    </button>
                  )}
                  {rows.some(r => r.status !== 'pending') && (
                    <button
                      onClick={handleExport}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium text-gray-300 hover:text-white transition-colors"
                      style={{ backgroundColor: '#1a1a1a', borderColor: '#444' }}
                    >
                      <Download size={12} /> Excel
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-[#2a2a2a] overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#2a2a2a]" style={{ backgroundColor: '#161616' }}>
                      <th className="px-4 py-2.5 text-left text-gray-500 font-medium w-8"></th>
                      <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Email</th>
                      <th className="px-4 py-2.5 text-left text-gray-500 font-medium w-16">Country</th>
                      <th className="px-4 py-2.5 text-left text-gray-500 font-medium">Reset Link</th>
                      <th className="px-4 py-2.5 text-right text-gray-500 font-medium w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-[#1e1e1e] last:border-0"
                        style={{ backgroundColor: row.status === 'found' ? 'rgba(20,83,45,0.08)' : row.status === 'notfound' || row.status === 'error' ? 'rgba(127,29,29,0.08)' : '#1a1a1a' }}
                      >
                        <td className="px-4 py-2.5">
                          {row.status === 'pending' && <span className="w-4 h-4 rounded-full border border-[#444] inline-block" />}
                          {row.status === 'fetching' && <Loader size={13} className="animate-spin text-gray-500" />}
                          {row.status === 'found' && <CheckCircle size={13} className="text-green-400" />}
                          {(row.status === 'notfound' || row.status === 'error') && <XCircle size={13} className="text-red-400" />}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-gray-200">{row.email}</td>
                        <td className="px-4 py-2.5 text-gray-400 font-mono">{row.country || '—'}</td>
                        <td className="px-4 py-2.5">
                          {row.status === 'found' && row.resetLink && (
                            <span className="text-blue-400 font-mono text-xs" title={row.resetLink}>
                              {row.resetLink.length > 60 ? row.resetLink.slice(0, 60) + '…' : row.resetLink}
                            </span>
                          )}
                          {(row.status === 'notfound' || row.status === 'error') && (
                            <span className="text-gray-600 italic">{row.error || 'Not found'}</span>
                          )}
                          {(row.status === 'pending' || row.status === 'fetching') && (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {row.status === 'found' && (
                            <button
                              onClick={() => copyRow(row, i)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors"
                              style={{
                                backgroundColor: copiedIdx === i ? 'rgba(20,83,45,0.3)' : '#1a1a1a',
                                borderColor: copiedIdx === i ? 'rgba(22,101,52,0.5)' : '#333',
                                color: copiedIdx === i ? '#4ade80' : '#9ca3af',
                              }}
                            >
                              {copiedIdx === i ? <Check size={10} /> : <Copy size={10} />}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {foundCount > 0 && (
                <div className="bg-[#111] border border-[#2a2a2a] rounded p-3">
                  <div className="text-xs text-gray-500">Copy All → paste into <strong className="text-gray-400">Change Password</strong> textarea. Format: <code className="text-gray-400">resetUrl<span className="text-[#e50914]">||</span>COUNTRY</code></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
