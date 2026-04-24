import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/Toast';
import { api } from '../api';
import { Trash2 } from 'lucide-react';

export default function Proxy() {
  const { toast } = useToast();
  const [proxy, setProxy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/user/proxy');
      setProxy(data);
      if (data) {
        setHost(data.host || '');
        setPort(data.port?.toString() || '');
        setUsername(data.username || '');
        setPassword('');
      }
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!host || !port || !username || !password) {
      toast({ title: 'Error', description: 'All fields are required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await api('/user/proxy', {
        method: 'POST',
        body: JSON.stringify({ host, port: parseInt(port), username, password }),
      });
      toast({ title: 'Proxy saved!' });
      load();
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirm('Delete your proxy credentials?')) return;
    try {
      await api('/user/proxy', { method: 'DELETE' });
      toast({ title: 'Proxy deleted' });
      setProxy(null);
      setHost('');
      setPort('');
      setUsername('');
      setPassword('');
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const inputClass = "w-full bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50";
  const labelClass = "block text-xs font-medium text-gray-400 mb-1.5";

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Proxy</h1>
        <p className="text-gray-400 text-sm">Configure your proxy credentials for service requests.</p>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-5 space-y-4">
          {proxy && (
            <div className="flex items-center justify-between pb-4 border-b border-[#222]">
              <div className="text-sm text-gray-400">
                Current: <span className="text-white font-mono">{proxy.host}:{proxy.port}</span> — <span className="text-gray-500">{proxy.username}</span>
              </div>
              <button onClick={handleDelete} className="text-red-400 hover:text-red-300 p-1">
                <Trash2 size={14} />
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Host</label>
              <input type="text" value={host} onChange={e => setHost(e.target.value)} placeholder="proxy.example.com" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Port</label>
              <input type="text" value={port} onChange={e => setPort(e.target.value)} placeholder="8080" className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="username" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="password" className={inputClass} />
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-[#e50914] hover:bg-[#c40812] text-white text-sm font-semibold rounded disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : proxy ? 'Update Proxy' : 'Save Proxy'}
          </button>
        </div>
      )}
    </div>
  );
}
