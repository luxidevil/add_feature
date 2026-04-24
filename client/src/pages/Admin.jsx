import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { api } from '../api';
import { cn } from '../lib/helpers';
import {
  Users, Settings, Sliders, Ticket, ScrollText,
  ArrowLeft, Search, Trash2, RefreshCw, Plus, Download,
  Coins, ExternalLink, Mail, Terminal, Shield, Database, CreditCard
} from 'lucide-react';

const TABS = [
  { key: 'users', icon: Users, label: 'Users' },
  { key: 'settings', icon: Settings, label: 'Settings' },
  { key: 'features', icon: Sliders, label: 'Droplets' },
  { key: 'vouchers', icon: Ticket, label: 'Vouchers' },
  { key: 'logs', icon: ScrollText, label: 'Logs' },
  { key: 'search', icon: Search, label: 'Search' },
  { key: 'topups', icon: Coins, label: 'Top-ups' },
  { key: 'proxies', icon: Shield, label: 'Proxies' },
  { key: 'imap', icon: Mail, label: 'IMAP' },
  { key: 'shell', icon: Terminal, label: 'Shell' },
  { key: 'paylogs', icon: CreditCard, label: 'Pay Logs' },
];

export default function Admin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState({});
  const [editSettings, setEditSettings] = useState({});
  const [vouchers, setVouchers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userLogs, setUserLogs] = useState([]);
  const [dropletStatus, setDropletStatus] = useState({});
  const [dropletLogs, setDropletLogs] = useState(null);
  const [dropletLogsLoading, setDropletLogsLoading] = useState(false);

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newCredits, setNewCredits] = useState('0');
  const [creditUserId, setCreditUserId] = useState(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditOp, setCreditOp] = useState('set');
  const [voucherCredits, setVoucherCredits] = useState('');
  const [voucherCount, setVoucherCount] = useState('1');
  const [logSearch, setLogSearch] = useState('');
  const [logType, setLogType] = useState('');
  const [logStatus, setLogStatus] = useState('');
  const [logUser, setLogUser] = useState('');
  const [topups, setTopups] = useState([]);
  const [topupSearch, setTopupSearch] = useState('');
  const [payLogs, setPayLogs] = useState([]);
  const [payLogsLoading, setPayLogsLoading] = useState(false);
  const [imapCreds, setImapCreds] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [shellCmd, setShellCmd] = useState('');
  const [shellOutput, setShellOutput] = useState('');
  const [shellRunning, setShellRunning] = useState(false);
  const [shellSuccess, setShellSuccess] = useState(null);
  const [emailSearch, setEmailSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [resultModal, setResultModal] = useState(null);
  const [userLogSearch, setUserLogSearch] = useState('');

  const VM_STATUSES = [
    { value: 'working', label: 'Working', activeClass: 'bg-green-900/40 text-green-400 border-green-800/50', inactiveClass: 'text-gray-500 border-[#333]' },
    { value: 'wipe', label: 'Wipe', activeClass: 'bg-orange-900/40 text-orange-400 border-orange-800/50', inactiveClass: 'text-gray-500 border-[#333]' },
    { value: 'invalid', label: 'Invalid', activeClass: 'bg-red-900/40 text-red-400 border-red-800/50', inactiveClass: 'text-gray-500 border-[#333]' },
    { value: 'unknown', label: 'Unknown', activeClass: 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50', inactiveClass: 'text-gray-500 border-[#333]' },
  ];

  const loadUsers = useCallback(async () => {
    try { setUsers(await api('/admin/users')); } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  }, [toast]);

  const loadSettings = useCallback(async () => {
    try {
      const s = await api('/admin/settings');
      setSettings(s);
      setEditSettings(s);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  }, [toast]);

  const loadVouchers = useCallback(async () => {
    try { setVouchers(await api('/admin/vouchers')); } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  }, [toast]);

  const loadTopups = useCallback(async () => {
    try { setTopups(await api('/admin/topups')); } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  }, [toast]);

  const loadImapCreds = useCallback(async () => {
    try { setImapCreds(await api('/admin/imap')); } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  }, [toast]);

  const loadProxies = useCallback(async () => {
    try { setProxies(await api('/admin/proxies')); } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  }, [toast]);

  const loadLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (logSearch) params.set('search', logSearch);
      if (logType) params.set('type', logType);
      if (logStatus) params.set('status', logStatus);
      if (logUser) params.set('user', logUser);
      setLogs(await api(`/admin/logs?${params.toString()}`));
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  }, [logSearch, logType, logStatus, logUser, toast]);

  const loadPayLogs = useCallback(async () => {
    setPayLogsLoading(true);
    try { setPayLogs(await api('/pay/logs?limit=100')); } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally { setPayLogsLoading(false); }
  }, [toast]);

  useEffect(() => { loadUsers(); loadSettings(); }, [loadUsers, loadSettings]);
  useEffect(() => {
    if (tab === 'vouchers') loadVouchers();
    if (tab === 'logs') loadLogs();
    if (tab === 'topups') loadTopups();
    if (tab === 'imap') loadImapCreds();
    if (tab === 'proxies') loadProxies();
    if (tab === 'paylogs') loadPayLogs();
  }, [tab, loadVouchers, loadLogs, loadTopups, loadImapCreds, loadProxies, loadPayLogs]);

  const loadUserLogs = async (userId, search) => {
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const data = await api(`/admin/users/${userId}/logs${params}`);
      setSelectedUser(data.user);
      setUserLogs(data.logs);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const createUser = async () => {
    if (!newUsername || !newPassword) return;
    setSaving(true);
    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username: newUsername, password: newPassword, credits: parseFloat(newCredits) || 0 }),
      });
      toast({ title: 'User created!' });
      setNewUsername('');
      setNewPassword('');
      setNewCredits('0');
      loadUsers();
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const updateCredits = async () => {
    if (!creditUserId) return;
    setSaving(true);
    try {
      await api(`/admin/users/${creditUserId}/credits`, {
        method: 'PUT',
        body: JSON.stringify({ credits: parseFloat(creditAmount) || 0, operation: creditOp }),
      });
      toast({ title: 'Credits updated!' });
      setCreditUserId(null);
      setCreditAmount('');
      loadUsers();
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const deleteUser = async (id) => {
    if (!confirm('Delete this user? Their logs will be kept for audit purposes.')) return;
    try {
      await api(`/admin/users/${id}`, { method: 'DELETE' });
      loadUsers();
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await api('/admin/settings', { method: 'PUT', body: JSON.stringify(editSettings) });
      toast({ title: 'Settings saved!' });
      loadSettings();
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const generateVouchers = async () => {
    setSaving(true);
    try {
      const data = await api('/admin/vouchers', {
        method: 'POST',
        body: JSON.stringify({ credits: parseFloat(voucherCredits) || 0, count: parseInt(voucherCount) || 1 }),
      });
      toast({ title: `${data.codes.length} voucher(s) generated!` });
      setVoucherCredits('');
      setVoucherCount('1');
      loadVouchers();
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const DROPLET_DEFS = [
    { key: 'droplet_trigger_reset',    svc: 'trigger-reset',   label: 'Trigger Reset',   short: 'TR' },
    { key: 'droplet_change_password',  svc: 'change-password', label: 'Change Password', short: 'CP' },
    { key: 'droplet_check_email',      svc: 'check-email',     label: 'VM Email',        short: 'VM' },
    { key: 'droplet_signup_code',      svc: 'signup-code',     label: 'Sign-in Code',    short: 'SC' },
  ];

  const testEndpoints = async () => {
    for (const { key } of DROPLET_DEFS) {
      const url = editSettings[key];
      if (url) {
        setDropletStatus(prev => ({ ...prev, [key]: 'checking' }));
        try {
          const data = await api('/admin/droplet-health', { method: 'POST', body: JSON.stringify({ url }) });
          setDropletStatus(prev => ({ ...prev, [key]: data.status === 'online' ? 'online' : 'offline' }));
        } catch {
          setDropletStatus(prev => ({ ...prev, [key]: 'offline' }));
        }
      } else {
        setDropletStatus(prev => ({ ...prev, [key]: 'unknown' }));
      }
    }
  };

  const fetchDropletLogs = async (service) => {
    setDropletLogsLoading(true);
    setDropletLogs(null);
    try {
      const data = await api(`/admin/droplet-logs?service=${service}&limit=50`);
      setDropletLogs({ service, data });
    } catch (err) {
      toast({ title: 'Error fetching droplet logs', description: err.message, variant: 'destructive' });
    }
    setDropletLogsLoading(false);
  };

  const runShell = async () => {
    if (!shellCmd.trim()) return;
    setShellRunning(true);
    setShellOutput('');
    setShellSuccess(null);
    try {
      const data = await api('/admin/shell', { method: 'POST', body: JSON.stringify({ command: shellCmd }) });
      setShellOutput(data.output || '(no output)');
      setShellSuccess(data.success);
    } catch (err) {
      setShellOutput(err.message);
      setShellSuccess(false);
    }
    setShellRunning(false);
  };

  const doSearch = async () => {
    if (!emailSearch || emailSearch.length < 2) return;
    setSearchLoading(true);
    try {
      const results = await api(`/admin/search?email=${encodeURIComponent(emailSearch)}`);
      setSearchResults(results);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setSearchLoading(false);
  };

  const exportLogs = () => {
    const params = new URLSearchParams();
    if (logSearch) params.set('search', logSearch);
    if (logType) params.set('type', logType);
    if (logStatus) params.set('status', logStatus);
    if (logUser) params.set('user', logUser);
    window.open(`/api/admin/logs/export?${params.toString()}`);
  };

  const inputClass = "w-full bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50";

  if (selectedUser) {
    return (
      <div className="p-6 md:p-8 space-y-5">
        <div className="flex items-center gap-4">
          <button onClick={() => { setSelectedUser(null); setUserLogs([]); }} className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-white">{selectedUser.username}</h2>
            <div className="text-sm text-gray-400">
              {selectedUser.role} • {selectedUser.credits.toFixed(2)} credits • Joined {new Date(selectedUser.createdAt).toLocaleDateString()}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={userLogSearch}
              onChange={e => setUserLogSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadUserLogs(selectedUser.id, userLogSearch)}
              placeholder="Search logs by email..."
              className="w-full bg-[#111] border border-[#333] rounded pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50"
            />
          </div>
          <button onClick={() => loadUserLogs(selectedUser.id, userLogSearch)} className="px-4 py-2 bg-[#e50914] text-white text-sm rounded font-semibold">Search</button>
        </div>

        <div className="text-xs text-gray-500 mb-2">{userLogs.length} logs</div>
        <LogTable logs={userLogs} showUser={false} onViewResult={setResultModal} />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      {resultModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setResultModal(null)}>
          <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-5 w-[520px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-semibold mb-3">Result Detail</h3>
            <pre className="bg-[#0d0d0d] border border-[#222] rounded p-3 text-xs text-gray-300 overflow-auto flex-1 font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(resultModal, null, 2)}
            </pre>
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => { navigator.clipboard.writeText(JSON.stringify(resultModal, null, 2)); toast({ title: 'Copied!' }); }}
                className="px-3 py-1.5 text-xs text-gray-400 border border-[#333] rounded hover:text-white"
              >Copy JSON</button>
              <button onClick={() => setResultModal(null)} className="px-3 py-1.5 text-xs text-gray-400 border border-[#333] rounded hover:text-white">Close</button>
            </div>
          </div>
        </div>
      )}

      <h1 className="text-2xl font-bold text-white">Admin Panel</h1>

      <div className="overflow-x-auto">
        <div className="flex gap-1 border-b border-[#222] pb-px min-w-max">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors',
                tab === t.key
                  ? 'text-[#e50914] border-[#e50914] bg-[#e50914]/5'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              )}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'users' && (
        <div className="space-y-5">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-5 space-y-4">
            <h3 className="text-white font-semibold text-sm flex items-center gap-2"><Plus size={14} /> Create User</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="Username" className={inputClass} />
              <input value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Password" type="password" className={inputClass} />
              <input value={newCredits} onChange={e => setNewCredits(e.target.value)} placeholder="Credits" type="number" className={inputClass} />
            </div>
            <button onClick={createUser} disabled={saving} className="px-5 py-2 bg-[#e50914] hover:bg-[#c40812] text-white text-sm font-semibold rounded disabled:opacity-50">
              Create User
            </button>
          </div>

          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#333]">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Role</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Credits</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">API Key</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Joined</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-[#222] hover:bg-[#222]/50">
                      <td className="px-4 py-3">
                        <button onClick={() => loadUserLogs(u.id)} className="text-blue-400 hover:text-blue-300 font-medium">{u.username}</button>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('text-xs px-2 py-0.5 rounded border', u.role === 'admin' ? 'bg-purple-900/40 text-purple-400 border-purple-800/50' : 'bg-[#222] text-gray-400 border-[#333]')}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { setCreditUserId(u.id); setCreditAmount(u.credits.toString()); setCreditOp('set'); }}
                          className="text-[#e50914] font-semibold hover:underline"
                        >
                          {u.credits.toFixed(2)}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 truncate max-w-[150px]">{u.apiKey || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        {u.role !== 'admin' && (
                          <button onClick={() => deleteUser(u.id)} className="text-gray-600 hover:text-red-400">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {creditUserId && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setCreditUserId(null)}>
              <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-5 space-y-4 w-80" onClick={e => e.stopPropagation()}>
                <h3 className="text-white font-semibold">Update Credits</h3>
                <div className="flex gap-2">
                  <button onClick={() => setCreditOp('set')} className={cn('px-3 py-1.5 rounded text-xs font-medium border', creditOp === 'set' ? 'bg-[#e50914]/10 text-[#e50914] border-[#e50914]/30' : 'text-gray-400 border-[#333]')}>Set</button>
                  <button onClick={() => setCreditOp('add')} className={cn('px-3 py-1.5 rounded text-xs font-medium border', creditOp === 'add' ? 'bg-[#e50914]/10 text-[#e50914] border-[#e50914]/30' : 'text-gray-400 border-[#333]')}>Add</button>
                </div>
                <input type="number" value={creditAmount} onChange={e => setCreditAmount(e.target.value)} placeholder="Amount" className={inputClass} />
                <div className="flex gap-2">
                  <button onClick={updateCredits} disabled={saving} className="px-4 py-2 bg-[#e50914] text-white text-sm font-semibold rounded disabled:opacity-50">Save</button>
                  <button onClick={() => setCreditUserId(null)} className="px-4 py-2 text-gray-400 text-sm border border-[#333] rounded">Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-5 max-w-2xl">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-5 space-y-4">
            <h3 className="text-white font-semibold text-sm">Credit Costs & Pricing</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { key: 'credit_cost_trigger_reset', label: 'Trigger Reset (per email)' },
                { key: 'credit_cost_change_password', label: 'Change Password (per url)' },
                { key: 'credit_cost_check_email', label: 'Check Email (per email)' },
                { key: 'credit_cost_cr_check', label: 'CR Checker (per account)' },
                { key: 'credit_cost_signup_code', label: 'Sign-in Code Reset (per email)' },
                { key: 'credits_per_dollar', label: 'Credits per Dollar' },
                { key: 'min_credit_load', label: 'Minimum Credit Load' },
              ].map(({ key, label }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-xs text-gray-400 font-medium">{label}</label>
                  <input
                    type="text"
                    value={editSettings[key] || ''}
                    onChange={e => setEditSettings(prev => ({ ...prev, [key]: e.target.value }))}
                    className={inputClass + ' font-mono'}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-5 space-y-4">
            <h3 className="text-white font-semibold text-sm">Concurrency Settings</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { key: 'concurrency_trigger_reset', label: 'TR Workers' },
                { key: 'concurrency_change_password', label: 'CP Workers' },
                { key: 'concurrency_check_email', label: 'VM Workers' },
              ].map(({ key, label }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-xs text-gray-400 font-medium">{label}</label>
                  <input
                    type="number"
                    value={editSettings[key] || ''}
                    onChange={e => setEditSettings(prev => ({ ...prev, [key]: e.target.value }))}
                    className={inputClass + ' font-mono'}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-5 space-y-4">
            <h3 className="text-white font-semibold text-sm">Payment</h3>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-medium">Crypto Wallet (BEP20 USDT)</label>
              <input
                type="text"
                value={editSettings.crypto_wallet || ''}
                onChange={e => setEditSettings(prev => ({ ...prev, crypto_wallet: e.target.value }))}
                placeholder="0x..."
                className={inputClass + ' font-mono'}
              />
            </div>
          </div>

          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-5 space-y-4">
            <h3 className="text-white font-semibold text-sm">Testing Mode</h3>
            <p className="text-xs text-gray-500">When enabled, the test API key can be used as a Bearer token to access all endpoints without a real user login. Keep this OFF in production.</p>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setEditSettings(prev => ({ ...prev, testing_mode: prev.testing_mode === 'true' ? 'false' : 'true' }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editSettings.testing_mode === 'true' ? 'bg-[#e50914]' : 'bg-[#333]'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${editSettings.testing_mode === 'true' ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <span className={`text-xs font-semibold ${editSettings.testing_mode === 'true' ? 'text-red-400' : 'text-gray-500'}`}>
                {editSettings.testing_mode === 'true' ? 'ON — test API key accepted' : 'OFF — secure'}
              </span>
            </div>
            {editSettings.testing_mode === 'true' && (
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400 font-medium">Test API Key</label>
                <input
                  type="text"
                  value={editSettings.test_api_key || ''}
                  onChange={e => setEditSettings(prev => ({ ...prev, test_api_key: e.target.value }))}
                  placeholder="Auto-generated if empty"
                  className="w-full bg-[#111] border border-[#333] rounded px-3 py-2 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50"
                />
              </div>
            )}
          </div>

          <button onClick={saveSettings} disabled={saving} className="px-5 py-2 bg-[#e50914] hover:bg-[#c40812] text-white text-sm font-semibold rounded disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}

      {tab === 'features' && (
        <div className="space-y-5 max-w-3xl">

          {/* Health summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {DROPLET_DEFS.map(({ key, label, short }) => {
              const st = dropletStatus[key];
              return (
                <div key={key} className={cn(
                  'bg-[#1a1a1a] border rounded-lg p-3 flex flex-col gap-2 transition-colors',
                  st === 'online' ? 'border-green-800/50' : st === 'offline' ? 'border-red-800/50' : 'border-[#2a2a2a]'
                )}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-500 tracking-widest">{short}</span>
                    <span className={cn('w-2 h-2 rounded-full',
                      st === 'online' ? 'bg-green-400 shadow-[0_0_6px_#4ade80]'
                      : st === 'offline' ? 'bg-red-500'
                      : st === 'checking' ? 'bg-yellow-400 animate-pulse'
                      : 'bg-gray-600'
                    )} />
                  </div>
                  <div className="text-xs text-gray-400 leading-tight">{label}</div>
                  <div className={cn('text-xs font-semibold',
                    st === 'online' ? 'text-green-400' : st === 'offline' ? 'text-red-400'
                    : st === 'checking' ? 'text-yellow-400' : 'text-gray-600'
                  )}>
                    {st ? (st === 'checking' ? 'Checking…' : st.charAt(0).toUpperCase() + st.slice(1)) : 'Not tested'}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Endpoints config */}
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-5 space-y-4">
            <h3 className="text-white font-semibold flex items-center gap-2"><Sliders size={16} /> Droplet Endpoints</h3>
            <p className="text-xs text-gray-500">Configure base URLs for each service droplet. Save then test to verify connectivity.</p>
            <div className="space-y-3">
              {DROPLET_DEFS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-3">
                  <label className="text-sm text-gray-400 w-44 shrink-0">{label}</label>
                  <input
                    type="text"
                    value={editSettings[key] || ''}
                    onChange={e => setEditSettings(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder="http://IP:3000"
                    className="flex-1 bg-[#111] border border-[#333] rounded px-3 py-2 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={saveSettings} disabled={saving} className="px-5 py-2 bg-[#e50914] hover:bg-[#c40812] text-white text-sm font-semibold rounded disabled:opacity-50">
                Save Endpoints
              </button>
              <button onClick={testEndpoints} className="px-5 py-2 text-gray-400 hover:text-white text-sm font-medium rounded border border-[#333] bg-[#111] transition-colors flex items-center gap-2">
                <RefreshCw size={14} /> Test All
              </button>
            </div>
          </div>

          {/* Droplet Logs */}
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><Database size={14} /> Droplet Logs</h3>
              {dropletLogs && (
                <span className="text-xs text-gray-500">{dropletLogs.data?.logs?.length ?? 0} entries · {DROPLET_DEFS.find(d => d.svc === dropletLogs.service)?.label}</span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {DROPLET_DEFS.map(({ svc, short }) => (
                <button
                  key={svc}
                  onClick={() => fetchDropletLogs(svc)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-semibold border rounded transition-colors',
                    dropletLogs?.service === svc
                      ? 'bg-[#e50914]/10 border-[#e50914]/50 text-[#e50914]'
                      : 'border-[#333] text-gray-400 hover:text-white hover:border-[#555]'
                  )}
                >
                  {short} Logs
                </button>
              ))}
            </div>

            {dropletLogsLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                <RefreshCw size={12} className="animate-spin" /> Loading logs…
              </div>
            )}

            {dropletLogs && !dropletLogsLoading && (() => {
              const { data } = dropletLogs;
              if (data.status === 'error') {
                return (
                  <div className="bg-red-900/20 border border-red-800/40 rounded p-3 text-xs text-red-400">
                    Connection failed: {data.error}
                  </div>
                );
              }
              const logs = Array.isArray(data.logs) ? data.logs : [];
              if (logs.length === 0) {
                return <p className="text-xs text-gray-600 py-2">No logs returned from this droplet.</p>;
              }
              const sample = logs[0];
              const hasTable = sample && (sample.email || sample.action || sample.status || sample.timestamp || sample.createdAt);
              if (hasTable) {
                return (
                  <div className="overflow-auto max-h-96 rounded border border-[#222]">
                    <table className="w-full text-xs">
                      <thead className="bg-[#111] sticky top-0">
                        <tr>
                          {(sample.timestamp || sample.createdAt) && <th className="px-3 py-2 text-left text-gray-500 font-medium">Time</th>}
                          {sample.email !== undefined && <th className="px-3 py-2 text-left text-gray-500 font-medium">Email</th>}
                          {sample.action !== undefined && <th className="px-3 py-2 text-left text-gray-500 font-medium">Action</th>}
                          {sample.status !== undefined && <th className="px-3 py-2 text-left text-gray-500 font-medium">Status</th>}
                          {sample.duration !== undefined && <th className="px-3 py-2 text-left text-gray-500 font-medium">Duration</th>}
                          {sample.ip !== undefined && <th className="px-3 py-2 text-left text-gray-500 font-medium">IP</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map((log, i) => {
                          const ts = log.timestamp || log.createdAt;
                          const isOk = log.status === 'success' || log.status === 'ok' || log.status === 200;
                          return (
                            <tr key={i} className="border-t border-[#1e1e1e] hover:bg-[#111]">
                              {ts && <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{new Date(ts).toLocaleTimeString()}</td>}
                              {log.email !== undefined && <td className="px-3 py-1.5 text-gray-300 font-mono">{log.email}</td>}
                              {log.action !== undefined && <td className="px-3 py-1.5 text-gray-400">{log.action}</td>}
                              {log.status !== undefined && (
                                <td className="px-3 py-1.5">
                                  <span className={cn('px-1.5 py-0.5 rounded text-xs font-mono',
                                    isOk ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
                                  )}>{String(log.status)}</span>
                                </td>
                              )}
                              {log.duration !== undefined && <td className="px-3 py-1.5 text-gray-500">{log.duration}ms</td>}
                              {log.ip !== undefined && <td className="px-3 py-1.5 text-gray-600 font-mono">{log.ip}</td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              }
              return (
                <pre className="bg-[#0d0d0d] border border-[#222] rounded p-3 text-xs text-gray-300 overflow-auto max-h-80 font-mono whitespace-pre-wrap">
                  {JSON.stringify(logs, null, 2)}
                </pre>
              );
            })()}
          </div>
        </div>
      )}

      {tab === 'vouchers' && (
        <div className="space-y-5">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-5 space-y-4 max-w-md">
            <h3 className="text-white font-semibold flex items-center gap-2"><Ticket size={14} /> Generate Vouchers</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Credits per voucher</label>
                <input type="number" value={voucherCredits} onChange={e => setVoucherCredits(e.target.value)} placeholder="100" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Count</label>
                <input type="number" value={voucherCount} onChange={e => setVoucherCount(e.target.value)} placeholder="1" className={inputClass} />
              </div>
            </div>
            <button onClick={generateVouchers} disabled={saving || !voucherCredits} className="px-5 py-2 bg-[#e50914] hover:bg-[#c40812] text-white text-sm font-semibold rounded disabled:opacity-50">
              Generate
            </button>
          </div>

          {vouchers.length > 0 && (
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#333]">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Code</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Credits</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vouchers.map(v => (
                      <tr key={v.id} className="border-b border-[#222]">
                        <td className="px-4 py-3 font-mono text-white">{v.code}</td>
                        <td className="px-4 py-3 text-[#e50914] font-semibold">{v.credits}</td>
                        <td className="px-4 py-3">
                          <span className={cn('text-xs px-2 py-0.5 rounded border',
                            v.used ? 'bg-gray-700/40 text-gray-400 border-gray-600/40' : 'bg-green-900/40 text-green-400 border-green-800/50'
                          )}>
                            {v.used ? 'USED' : 'ACTIVE'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{new Date(v.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input type="text" value={logSearch} onChange={e => setLogSearch(e.target.value)} placeholder="Search by email..." className="w-full bg-[#111] border border-[#333] rounded pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50" />
            </div>
            <input type="text" value={logUser} onChange={e => setLogUser(e.target.value)} placeholder="Username" className="bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none w-32" />
            <select value={logType} onChange={e => { setLogType(e.target.value); setLogStatus(''); }} className="bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white">
              <option value="">All Types</option>
              <option value="trigger-reset">Trigger Reset</option>
              <option value="change-password">Change Password</option>
              <option value="check-email">Check Email (VM)</option>
              <option value="signup-code">Sign-in Code</option>
              <option value="imap-fetch">IMAP Fetch</option>
            </select>
            {logType !== 'check-email' && (
              <select value={logStatus} onChange={e => setLogStatus(e.target.value)} className="bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white">
                <option value="">All Status</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="error">Error</option>
              </select>
            )}
            <button onClick={loadLogs} className="px-4 py-2 bg-[#e50914] text-white text-sm rounded font-semibold">Search</button>
            <button onClick={exportLogs} className="px-4 py-2 text-gray-400 hover:text-white text-sm border border-[#333] rounded flex items-center gap-1.5 transition-colors">
              <Download size={13} /> Export CSV
            </button>
          </div>

          {logType === 'check-email' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500 font-medium">VM Filter:</span>
              <button
                onClick={() => setLogStatus('')}
                className={cn('px-3 py-1 text-xs font-medium rounded border transition-colors', logStatus === '' ? 'bg-[#e50914]/10 text-[#e50914] border-[#e50914]/40' : 'text-gray-500 border-[#333] hover:text-gray-300')}
              >
                All
              </button>
              {VM_STATUSES.map(s => (
                <button
                  key={s.value}
                  onClick={() => setLogStatus(logStatus === s.value ? '' : s.value)}
                  className={cn('px-3 py-1 text-xs font-medium rounded border transition-colors', logStatus === s.value ? s.activeClass : s.inactiveClass + ' hover:text-gray-300')}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <div className="text-xs text-gray-500">{logs.length} logs</div>
          <LogTable logs={logs} showUser={true} onViewResult={setResultModal} />
        </div>
      )}

      {tab === 'search' && (
        <div className="space-y-5">
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-lg">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={emailSearch}
                onChange={e => setEmailSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch()}
                placeholder="Search any email across all logs..."
                className="w-full bg-[#111] border border-[#333] rounded pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50"
              />
            </div>
            <button onClick={doSearch} disabled={searchLoading} className="px-5 py-2 bg-[#e50914] hover:bg-[#c40812] text-white text-sm font-semibold rounded disabled:opacity-50">
              {searchLoading ? 'Searching...' : 'Search'}
            </button>
          </div>
          {searchResults !== null && (
            <>
              <div className="text-xs text-gray-500">{searchResults.length} results for "{emailSearch}"</div>
              <LogTable logs={searchResults} showUser={true} onViewResult={setResultModal} />
            </>
          )}
        </div>
      )}

      {tab === 'topups' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Top-up History</h2>
              <p className="text-xs text-gray-500 mt-0.5">All USDT top-ups credited to users</p>
            </div>
            <button onClick={loadTopups} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white border border-[#333] rounded px-3 py-1.5 transition-colors">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Top-ups', value: topups.length },
              { label: 'Total USDT', value: '$' + topups.reduce((s, t) => s + t.usdtAmount, 0).toFixed(2) },
              { label: 'Total Credits', value: topups.reduce((s, t) => s + t.creditsAdded, 0).toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</div>
                <div className="text-xl font-bold text-white">{value}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={topupSearch}
                onChange={e => setTopupSearch(e.target.value)}
                placeholder="Filter by username or TX..."
                className="w-full bg-[#111] border border-[#333] rounded pl-8 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50"
              />
            </div>
          </div>

          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#333]">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">USDT</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Credits</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">TX Hash</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">From Address</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {topups
                    .filter(t => !topupSearch || t.username.toLowerCase().includes(topupSearch.toLowerCase()) || t.txHash.includes(topupSearch.toLowerCase()))
                    .map(t => (
                    <tr key={t.id} className="border-b border-[#222] hover:bg-[#222]/50">
                      <td className="px-4 py-3 text-white font-medium">{t.username}</td>
                      <td className="px-4 py-3"><span className="text-green-400 font-semibold">${t.usdtAmount.toFixed(2)}</span></td>
                      <td className="px-4 py-3"><span className="text-[#e50914] font-semibold">+{t.creditsAdded}</span></td>
                      <td className="px-4 py-3">
                        <a href={`https://bscscan.com/tx/${t.txHash}`} target="_blank" rel="noopener noreferrer"
                          className="font-mono text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                          {t.txHash.slice(0, 12)}...{t.txHash.slice(-6)} <ExternalLink size={10} />
                        </a>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {t.fromAddress ? `${t.fromAddress.slice(0, 10)}...${t.fromAddress.slice(-4)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(t.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {topups.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">No top-ups yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'proxies' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">{proxies.length} proxy credential{proxies.length !== 1 ? 's' : ''}</p>
            <button onClick={loadProxies} className="text-gray-500 hover:text-white transition-colors"><RefreshCw size={14} /></button>
          </div>
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#333]">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Host</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Port</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Username</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Password</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {proxies.map(p => (
                    <tr key={p.id} className="border-b border-[#222] hover:bg-[#222]/50">
                      <td className="px-4 py-3 text-gray-300 font-medium">{p.username}</td>
                      <td className="px-4 py-3 font-mono text-gray-300 text-xs">{p.host}</td>
                      <td className="px-4 py-3 font-mono text-gray-400 text-xs">{p.port}</td>
                      <td className="px-4 py-3 font-mono text-gray-400 text-xs">{p.username_proxy}</td>
                      <td className="px-4 py-3 font-mono text-gray-500 text-xs truncate max-w-[180px]">{p.password}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(p.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {proxies.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">No proxy credentials saved yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'imap' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">{imapCreds.length} account{imapCreds.length !== 1 ? 's' : ''}</p>
            <button onClick={loadImapCreds} className="text-gray-500 hover:text-white transition-colors"><RefreshCw size={14} /></button>
          </div>
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#333]">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Email</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">App Password</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {imapCreds.map(c => (
                    <tr key={c.id} className="border-b border-[#222] hover:bg-[#222]/50">
                      <td className="px-4 py-3 text-gray-300 font-medium">{c.username}</td>
                      <td className="px-4 py-3 font-mono text-gray-300">{c.email}</td>
                      <td className="px-4 py-3 font-mono text-gray-400 text-xs">{c.password}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(c.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {imapCreds.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600">No IMAP accounts saved yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'paylogs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-semibold flex items-center gap-2"><CreditCard size={14} /> WooCommerce Pay Logs</h3>
            <button onClick={loadPayLogs} disabled={payLogsLoading} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2a2a2a] border border-[#333] rounded text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50">
              <RefreshCw size={12} className={payLogsLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          {payLogsLoading && <p className="text-gray-500 text-sm">Loading…</p>}
          {!payLogsLoading && payLogs.length === 0 && (
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-6 text-center text-gray-500 text-sm">
              No pay log entries yet. Pay log entries will appear here after checkout attempts.
            </div>
          )}
          {payLogs.map((entry, i) => {
            const isSuccess = entry.event === 'checkout_success' || entry.event === 'session_ok';
            const isError = entry.event?.includes('fail') || entry.event?.includes('declined');
            const isWarn = entry.event?.includes('warn');
            return (
              <div key={i} className={cn(
                'bg-[#1a1a1a] border rounded-lg p-4 space-y-2',
                isSuccess ? 'border-green-800/40' : isError ? 'border-red-800/40' : isWarn ? 'border-yellow-800/40' : 'border-[#2a2a2a]'
              )}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-xs font-mono px-2 py-0.5 rounded border font-semibold',
                      isSuccess ? 'bg-green-900/30 text-green-400 border-green-800/50'
                      : isError ? 'bg-red-900/30 text-red-400 border-red-800/50'
                      : isWarn ? 'bg-yellow-900/30 text-yellow-400 border-yellow-800/50'
                      : 'bg-[#222] text-gray-400 border-[#333]'
                    )}>{entry.event}</span>
                    {entry.email && <span className="text-sm text-gray-300 font-mono">{entry.email}</span>}
                    {entry.orderId && <span className="text-xs text-green-400">Order #{entry.orderId}</span>}
                  </div>
                  <span className="text-xs text-gray-500">{entry.ts}</span>
                </div>
                {entry.error && (
                  <div className="text-xs text-red-400 bg-red-950/20 border border-red-900/30 rounded px-3 py-2 font-mono break-all">{entry.error}</div>
                )}
                {entry.warning && (
                  <div className="text-xs text-yellow-400 bg-yellow-950/20 border border-yellow-900/30 rounded px-3 py-2">{entry.warning}</div>
                )}
                {(entry.state || entry.zip || entry.elapsed) && (
                  <div className="flex gap-4 text-xs text-gray-500 flex-wrap">
                    {entry.state && <span>State: <span className="text-gray-300">{entry.state}</span></span>}
                    {entry.zip && <span>ZIP: <span className="text-gray-300">{entry.zip}</span></span>}
                    {entry.elapsed && <span>Elapsed: <span className="text-gray-300">{entry.elapsed}ms</span></span>}
                    {entry.nonceFound !== undefined && <span>Nonce: <span className={entry.nonceFound ? 'text-green-400' : 'text-red-400'}>{entry.nonceFound ? 'found' : 'MISSING'}</span></span>}
                    {entry.tokenFound !== undefined && <span>Token: <span className={entry.tokenFound ? 'text-green-400' : 'text-red-400'}>{entry.tokenFound ? 'found' : 'MISSING'}</span></span>}
                  </div>
                )}
                {entry.rawData && (
                  <details className="text-xs">
                    <summary className="text-gray-500 cursor-pointer hover:text-gray-300">Raw WooCommerce response</summary>
                    <pre className="mt-2 bg-[#0d0d0d] border border-[#333] rounded px-3 py-2 overflow-auto max-h-48 text-gray-400 whitespace-pre-wrap break-all">
                      {JSON.stringify(entry.rawData, null, 2)}
                    </pre>
                  </details>
                )}
                {entry.stack && (
                  <details className="text-xs">
                    <summary className="text-gray-500 cursor-pointer hover:text-gray-300">Stack trace</summary>
                    <pre className="mt-2 bg-[#0d0d0d] border border-[#333] rounded px-3 py-2 overflow-auto max-h-48 text-red-400/70 whitespace-pre-wrap text-[10px]">{entry.stack}</pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'shell' && (
        <div className="space-y-4 max-w-3xl">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-5 space-y-3">
            <h3 className="text-white font-semibold flex items-center gap-2"><Terminal size={14} /> Shell</h3>
            <textarea
              value={shellCmd}
              onChange={e => setShellCmd(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runShell(); }}
              rows={3}
              placeholder="Enter command... (Ctrl+Enter to run)"
              className="w-full bg-[#0d0d0d] border border-[#333] rounded px-3 py-2 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50 resize-none"
            />
            <button
              onClick={runShell}
              disabled={shellRunning || !shellCmd.trim()}
              className="px-5 py-2 bg-[#e50914] hover:bg-[#c40812] text-white text-sm font-semibold rounded disabled:opacity-50"
            >
              {shellRunning ? 'Running...' : 'Execute'}
            </button>
          </div>
          {shellOutput && (
            <div className={cn(
              'bg-[#0d0d0d] border rounded-lg p-4 font-mono text-xs text-gray-300 whitespace-pre-wrap overflow-auto max-h-[500px]',
              shellSuccess === false ? 'border-[#e50914]/40' : 'border-[#333]'
            )}>
              {shellOutput}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LogTable({ logs, showUser, onViewResult }) {
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#333]">
              {showUser && <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">User</th>}
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Credits</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Result</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id} className="border-b border-[#222] hover:bg-[#222]/50">
                {showUser && <td className="px-4 py-3 text-gray-300">{log.username || '—'}</td>}
                <td className="px-4 py-3 font-mono text-gray-300 truncate max-w-[200px]">{log.email || '—'}</td>
                <td className="px-4 py-3">
                  <span className="text-xs px-2 py-0.5 rounded bg-[#222] text-gray-400 border border-[#333]">{log.type}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded font-medium border',
                    log.status === 'success' || log.status === 'working' ? 'bg-green-900/40 text-green-400 border-green-800/50'
                    : log.status === 'failed' || log.status === 'invalid' ? 'bg-red-900/40 text-red-400 border-red-800/50'
                    : log.status === 'wipe' || log.status === 'wiped' ? 'bg-orange-900/40 text-orange-400 border-orange-800/50'
                    : log.status === 'unknown' ? 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50'
                    : 'bg-[#222] text-gray-400 border-[#333]'
                  )}>
                    {log.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400">{log.creditsUsed}</td>
                <td className="px-4 py-3">
                  {log.result && Object.keys(log.result).length > 0 && (
                    <button
                      onClick={() => onViewResult && onViewResult(log.result)}
                      className="text-xs px-2 py-0.5 rounded border border-[#333] text-gray-500 hover:text-white hover:border-[#555] transition-colors"
                    >
                      View
                    </button>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{new Date(log.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
