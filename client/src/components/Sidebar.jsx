import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useAuth } from '../auth';
import { useToast } from './Toast';
import { api } from '../api';
import {
  RotateCcw, KeyRound, MailSearch, Globe, ScrollText,
  Mail, Coins, Shield, ChevronRight, Zap, LogOut, Check, Copy, History,
  Menu, X, KeySquare, ExternalLink
} from 'lucide-react';

const NAV = [
  { path: '/', icon: RotateCcw, label: 'Trigger Reset' },
  { path: '/change-password', icon: KeyRound, label: 'Change Password' },
  { path: '/check-email', icon: MailSearch, label: 'VM Email' },
  { path: '/signup-code', icon: KeySquare, label: 'Sign-in Code' },
  { path: '/proxy', icon: Globe, label: 'Proxy' },
  { path: '/logs', icon: ScrollText, label: 'My Logs' },
  { path: '/imap', icon: Mail, label: 'IMAP / Gmail' },
  { path: '/credits', icon: History, label: 'Credit History' },
  { path: '/buy-credits', icon: Coins, label: 'Buy Credits' },
];

export default function Sidebar() {
  const { user, logout, refreshUser } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const close = () => setMobileOpen(false);

  const handleRedeem = async () => {
    if (!code.trim()) return;
    setRedeeming(true);
    try {
      const res = await api('/user/credits/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      });
      toast({ title: `+${res.credits} credits added!`, description: `New balance: ${res.newBalance.toFixed(2)} credits` });
      setCode('');
      await refreshUser();
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setRedeeming(false);
  };

  return (
    <>
      {/* Hamburger button — mobile only, shows when sidebar is closed */}
      <button
        className="fixed top-4 left-4 z-[60] md:hidden bg-[#0a0a0a] border border-[#222] rounded-md p-2 text-gray-400 hover:text-white transition-colors"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      {/* Overlay — mobile only, behind sidebar */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={close}
        />
      )}

      {/* Sidebar */}
      <aside className={[
        'w-60 bg-[#0a0a0a] border-r border-[#222] flex flex-col',
        // Mobile: fixed drawer, slides in/out
        'fixed top-0 left-0 h-full z-50 transition-transform duration-300',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        // Desktop: back to normal document flow, always visible
        'md:relative md:h-auto md:min-h-screen md:translate-x-0 md:transition-none',
      ].join(' ')}>

        {/* Header */}
        <div className="px-5 py-6 border-b border-[#222] flex items-center justify-between">
          <div>
            <div className="text-xl font-bold tracking-wide">
              <span className="text-[#e50914]">DEALER</span>
              <span className="text-white">-DXB</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">Tools Dashboard</div>
          </div>
          {/* Close button — mobile only */}
          <button
            className="md:hidden text-gray-500 hover:text-white p-1 transition-colors"
            onClick={close}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {user && (
          <div className="px-5 py-4 border-b border-[#222]">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Logged in as</div>
            <div className="text-white font-medium truncate">{user.username}</div>
            <div className="flex items-center gap-1 mt-1">
              <Zap size={12} className="text-[#e50914]" />
              <span className="text-[#e50914] text-sm font-semibold">{user.credits.toFixed(2)}</span>
              <span className="text-gray-500 text-xs">credits</span>
            </div>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map(({ path, icon: Icon, label }) => {
            const active = location === path;
            return (
              <Link key={path} href={path}>
                <div
                  onClick={close}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-all ${
                    active
                      ? 'bg-[#e50914]/10 text-[#e50914] border border-[#e50914]/20'
                      : 'text-gray-400 hover:bg-[#1a1a1a] hover:text-white'
                  }`}
                >
                  <Icon size={16} />
                  <span className="text-sm font-medium">{label}</span>
                  {active && <ChevronRight size={12} className="ml-auto" />}
                </div>
              </Link>
            );
          })}

          {/* External promo — host your own branded Netflix OTP inbox on a custom domain */}
          <a
            href="https://yournfhost.com/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
            className="flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-all mt-2 text-purple-300 hover:bg-purple-500/10 hover:text-purple-200 border border-purple-500/20 bg-purple-500/[0.04]"
            title="Host your own branded Netflix OTP inbox on your own domain — password-protected so resellers can't exploit you."
          >
            <ExternalLink size={16} />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium block leading-tight">Host Your Inbox</span>
              <span className="text-[10px] text-purple-400/70 block leading-tight mt-0.5">Your brand · Your domain</span>
            </div>
          </a>

          {user?.role === 'admin' && (
            <Link href="/admin">
              <div
                onClick={close}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-all mt-2 ${
                  location === '/admin'
                    ? 'bg-[#e50914]/10 text-[#e50914] border border-[#e50914]/20'
                    : 'text-gray-400 hover:bg-[#1a1a1a] hover:text-white'
                }`}
              >
                <Shield size={16} />
                <span className="text-sm font-medium">Admin Panel</span>
                {location === '/admin' && <ChevronRight size={12} className="ml-auto" />}
              </div>
            </Link>
          )}
        </nav>

        <div className="px-3 pb-4 border-t border-[#222] pt-4 space-y-3">
          <div>
            <div className="text-xs text-gray-500 mb-1.5 px-1">Redeem Voucher</div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleRedeem()}
                placeholder="DXB-XXXXXX"
                className="flex-1 bg-[#111] border border-[#333] rounded px-2.5 py-1.5 text-xs text-white font-mono placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50"
              />
              <button
                onClick={handleRedeem}
                disabled={redeeming || !code.trim()}
                className="px-2.5 py-1.5 bg-[#e50914] hover:bg-[#c40812] text-white text-xs font-semibold rounded disabled:opacity-50 transition-colors"
              >
                {redeeming ? '...' : 'Go'}
              </button>
            </div>
          </div>

          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-gray-400 hover:text-white hover:bg-[#1a1a1a] transition-colors text-sm"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
