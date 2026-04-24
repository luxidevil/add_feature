import { useState } from 'react';
import { useAuth } from '../auth';
import { Zap, KeyRound, Mail, BarChart2, ShieldCheck, Users, UserPlus } from 'lucide-react';

const STATS = [
  {
    icon: Zap,
    op: 'Trigger Reset',
    tagline: '100 resets in under 3 minutes',
    speed: '120–200s',
    price: '$1.00',
    credits: '100 credits',
    badge: null,
  },
  {
    icon: KeyRound,
    op: 'Change Password',
    tagline: '100 accounts changed in one run',
    speed: '~5 min',
    price: '$1.50',
    credits: '150 credits',
    badge: null,
  },
  {
    icon: Mail,
    op: 'VM Email Check',
    tagline: '100 VMs verified in 40 seconds',
    speed: '40s',
    price: '$0.25',
    credits: '25 credits',
    badge: 'FASTEST',
  },
];

const FEATURES = [
  {
    icon: Zap,
    title: 'Trigger Reset',
    desc: 'Each reset spawns a dedicated Puppeteer page, navigates Netflix directly, and fires the password reset flow — no API, no limits.',
  },
  {
    icon: KeyRound,
    title: 'Change Password',
    desc: 'Puppeteer opens a headless Chrome page per account, loads the reset link, and completes the password change through Netflix\'s own UI.',
  },
  {
    icon: Mail,
    title: 'VM Email Check',
    desc: 'Puppeteer checks Netflix account email status across your inventory — fast bulk processing with live results per account.',
  },
  {
    icon: BarChart2,
    title: 'Real-Time Results',
    desc: 'All bulk operations stream results live — no waiting for a batch to finish before you see progress.',
  },
  {
    icon: ShieldCheck,
    title: 'Credit System',
    desc: 'Pay only for what you use. Top up with USDT and spend credits per operation.',
  },
  {
    icon: Users,
    title: 'Multi-User Access',
    desc: 'Admin controls every account — assign credits, generate vouchers, monitor all activity.',
  },
];

function StatCards({ compact = false }) {
  if (compact) {
    return (
      <div className="grid grid-cols-3 gap-2 w-full max-w-sm mb-8">
        {STATS.map(({ icon: Icon, op, speed, price, badge }) => (
          <div key={op} className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-3 flex flex-col gap-1.5">
            {badge && (
              <span className="text-[9px] font-bold text-green-400 uppercase tracking-widest">{badge}</span>
            )}
            <span className="text-lg font-extrabold text-white leading-none">{speed}</span>
            <span className="text-[#e50914] text-xs font-bold">{price}</span>
            <span className="text-[9px] text-gray-600 leading-tight">{op}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3 my-10">
      {STATS.map(({ icon: Icon, op, tagline, speed, price, credits, badge }) => (
        <div key={op} className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden">
          {badge && (
            <span className="absolute top-3 right-3 text-[9px] font-bold text-green-400 bg-green-400/10 border border-green-400/20 rounded px-1.5 py-0.5 uppercase tracking-widest">
              {badge}
            </span>
          )}
          <div className="w-7 h-7 rounded-lg bg-[#e50914]/10 flex items-center justify-center flex-shrink-0">
            <Icon size={14} className="text-[#e50914]" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white mb-0.5">{op}</div>
            <div className="text-[10px] text-gray-600 leading-relaxed">{tagline}</div>
          </div>
          <div className="border-t border-[#1e1e1e] pt-3 flex items-end justify-between">
            <div>
              <div className="text-xl font-extrabold text-white leading-none">{speed}</div>
              <div className="text-[10px] text-gray-600 mt-0.5">per 100 accounts</div>
            </div>
            <div className="text-right">
              <div className="text-base font-extrabold text-[#e50914] leading-none">{price}</div>
              <div className="text-[10px] text-gray-600 mt-0.5">{credits}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) return;
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (mode === 'login') {
        await login(username, password);
      } else {
        await register(username, password, promoCode);
      }
    } catch (err) {
      setError(err.message || (mode === 'login' ? 'Login failed' : 'Registration failed'));
    }
    setLoading(false);
  };

  const toggleMode = () => {
    setMode(m => m === 'login' ? 'signup' : 'login');
    setError('');
    setConfirmPassword('');
    setPromoCode('');
  };

  return (
    <div className="min-h-screen flex bg-[#0d0d0d]">

      <div className="hidden lg:flex flex-col justify-between flex-1 px-16 py-14 bg-[#111] border-r border-[#1e1e1e]">
        <div>
          <div className="flex items-center gap-2 mb-14">
            <span className="text-2xl font-extrabold tracking-tight">
              <span className="text-[#e50914]">DEALER</span>
              <span className="text-white">-DXB</span>
            </span>
            <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-gray-600 border border-[#2a2a2a] rounded px-2 py-0.5">Private</span>
          </div>

          <h2 className="text-4xl font-bold text-white leading-tight max-w-md">
            Netflix account operations,<br />
            <span className="text-[#e50914]">built for scale.</span>
          </h2>
          <p className="text-gray-500 text-sm mt-4 max-w-sm leading-relaxed">
            A private toolset for managing Netflix account workflows — resets, password changes, and VM email checks — all in one place.
          </p>
        </div>

        <StatCards />

        <div className="grid grid-cols-2 gap-x-8 gap-y-7 mb-12">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex gap-3">
              <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded bg-[#e50914]/10 flex items-center justify-center">
                <Icon size={14} className="text-[#e50914]" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white mb-0.5">{title}</div>
                <div className="text-xs text-gray-500 leading-relaxed">{desc}</div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-gray-700">
          Create an account to get started — top up credits to run operations.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center w-full lg:w-[420px] lg:flex-none px-8 py-12">

        <div className="lg:hidden mb-6 text-center">
          <span className="text-2xl font-extrabold tracking-tight">
            <span className="text-[#e50914]">DEALER</span>
            <span className="text-white">-DXB</span>
          </span>
          <p className="text-gray-600 text-xs mt-1">Netflix Operations Platform</p>
        </div>

        <div className="lg:hidden w-full max-w-sm">
          <StatCards compact={true} />
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white">
              {mode === 'login' ? 'Welcome back' : 'Create account'}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {mode === 'login' ? 'Sign in to your account to continue' : 'Register to get started — you\'ll start with 0 credits'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={mode === 'login' ? 'Enter username' : 'Choose a username'}
                autoComplete="username"
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/60 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'login' ? 'Enter password' : 'Min 6 characters'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/60 transition-colors"
              />
            </div>

            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/60 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                    Promo Code <span className="text-gray-600 normal-case">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={promoCode}
                    onChange={e => setPromoCode(e.target.value)}
                    placeholder="Enter promo code if you have one"
                    className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/60 transition-colors"
                  />
                </div>
              </>
            )}

            {error && (
              <div className="flex items-center gap-2 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                <span className="text-red-400 text-xs">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password || (mode === 'signup' && !confirmPassword)}
              className="w-full py-3 bg-[#e50914] hover:bg-[#c40812] text-white font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  {mode === 'login' ? 'Signing in...' : 'Creating account...'}
                </span>
              ) : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="text-center mt-6">
            <button
              onClick={toggleMode}
              className="text-gray-500 text-xs hover:text-gray-300 transition-colors"
            >
              {mode === 'login' ? (
                <>Don't have an account? <span className="text-[#e50914] font-semibold">Sign up</span></>
              ) : (
                <>Already have an account? <span className="text-[#e50914] font-semibold">Sign in</span></>
              )}
            </button>
          </div>

          <p className="text-center text-gray-700 text-xs mt-4">
            Top up credits after signing up to start using operations.
          </p>
        </div>
      </div>

    </div>
  );
}
