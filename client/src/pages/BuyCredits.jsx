import { useState, useEffect } from 'react';
import { useAuth } from '../auth';
import { api } from '../api';
import { QRCodeSVG } from 'qrcode.react';
import { Zap, Coins, Copy, Check, Clock, ExternalLink, Loader2, Hash } from 'lucide-react';
import { cn } from '../lib/helpers';

export default function BuyCredits() {
  const { user, refreshUser } = useAuth();
  const [pricing, setPricing] = useState({});
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState([]);

  const [usdtAmount, setUsdtAmount] = useState('');
  const [step, setStep] = useState('pay'); // pay | verifying | needsHash | success
  const [txHash, setTxHash] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/user/pricing').then(data => {
      const map = {};
      data.forEach(s => { map[s.key] = s.value; });
      setPricing(map);
    }).catch(() => {});
    api('/user/credits/topup/history').then(setHistory).catch(() => {});
  }, []);

  const rate = parseFloat(pricing.credits_per_dollar) || 100;
  const minLoad = parseFloat(pricing.min_credit_load) || 500;
  const minUsd = (minLoad / rate).toFixed(2);
  const wallet = pricing.crypto_wallet || '';
  const previewCredits = usdtAmount ? Math.floor(parseFloat(usdtAmount) * rate) : 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(wallet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleAutoPay = async () => {
    if (!usdtAmount || parseFloat(usdtAmount) <= 0) return;
    setStep('verifying');
    setError('');
    try {
      const data = await api('/user/credits/topup/auto', {
        method: 'POST',
        body: JSON.stringify({ usdtAmount: parseFloat(usdtAmount) }),
      });
      setResult(data);
      setStep('success');
      await refreshUser();
      const h = await api('/user/credits/topup/history');
      setHistory(h);
    } catch (err) {
      if (err.needsHash || err.message?.includes('paste')) {
        setError(err.message || 'Could not detect payment automatically.');
        setStep('needsHash');
      } else {
        setError(err.message || 'Verification failed.');
        setStep('needsHash');
      }
    }
  };

  const handleManualHash = async () => {
    if (!txHash.trim()) return;
    setStep('verifying');
    setError('');
    try {
      const data = await api('/user/credits/topup', {
        method: 'POST',
        body: JSON.stringify({ txHash: txHash.trim() }),
      });
      setResult(data);
      setStep('success');
      await refreshUser();
      const h = await api('/user/credits/topup/history');
      setHistory(h);
    } catch (err) {
      setError(err.message || 'Verification failed.');
      setStep('needsHash');
    }
  };

  const reset = () => {
    setStep('pay');
    setTxHash('');
    setError('');
    setResult(null);
    setUsdtAmount('');
  };

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Buy Credits</h1>
        <p className="text-gray-400 text-sm">Top up your account instantly via BEP20 USDT — verified automatically on-chain.</p>
      </div>

      <div className="rounded-lg border p-5 flex items-center gap-4" style={{ backgroundColor: '#1c1c1c', borderColor: '#333' }}>
        <div className="w-10 h-10 rounded-lg bg-[#e50914]/10 flex items-center justify-center shrink-0">
          <Coins size={20} className="text-[#e50914]" />
        </div>
        <div>
          <div className="text-white font-semibold">Current Balance</div>
          <div className="text-[#e50914] text-lg font-bold">{user?.credits.toFixed(2)} credits</div>
        </div>
      </div>

      <div className="rounded-lg border p-5 space-y-4" style={{ backgroundColor: '#1c1c1c', borderColor: '#333' }}>
        <h2 className="text-lg font-semibold text-white">Pricing</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded border p-4" style={{ backgroundColor: '#111', borderColor: '#333' }}>
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Rate</div>
            <div className="text-white text-lg font-bold">{rate} credits / $1</div>
          </div>
          <div className="rounded border p-4" style={{ backgroundColor: '#111', borderColor: '#333' }}>
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Minimum Top-Up</div>
            <div className="text-white text-lg font-bold">{minLoad} credits</div>
            <div className="text-gray-500 text-xs">(${minUsd} USDT)</div>
          </div>
        </div>
        <div className="space-y-1">
          {[
            { label: 'Trigger Reset', val: pricing.credit_cost_trigger_reset || '1', unit: 'credit/email' },
            { label: 'Change Password', val: pricing.credit_cost_change_password || '1.5', unit: 'credits/url' },
            { label: 'VM Email', val: pricing.credit_cost_check_email || '0.25', unit: 'credits/email' },
          ].map(({ label, val, unit }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-gray-300">{label}</span>
              <span className="text-white font-medium">{val} {unit}</span>
            </div>
          ))}
        </div>
      </div>

      {wallet ? (
        <div className="rounded-lg border p-5 space-y-5" style={{ backgroundColor: '#1c1c1c', borderColor: '#333' }}>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Zap size={18} className="text-[#e50914]" /> Payment (BEP20 USDT)
          </h2>

          <div className="flex flex-col sm:flex-row gap-6 items-center">
            <div className="shrink-0 p-3 bg-white rounded-xl">
              <QRCodeSVG value={wallet} size={140} bgColor="#ffffff" fgColor="#000000" level="M" />
            </div>
            <div className="flex-1 space-y-3 w-full">
              <div className="text-sm text-gray-400">Send <span className="text-white font-semibold">BEP20 USDT</span> to this address:</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-[#111] border border-[#444] rounded px-3 py-2.5 text-xs font-mono text-white break-all">{wallet}</div>
                <button onClick={handleCopy} className="shrink-0 bg-[#2a2a2a] border border-[#444] rounded px-3 py-2.5 text-sm text-gray-300 hover:text-white transition-colors">
                  {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                </button>
              </div>
              <div className="text-xs text-yellow-600 font-medium">⚠ Only send USDT on BEP20 (BSC) network</div>
            </div>
          </div>

          <div className="border-t border-[#2a2a2a] pt-4 space-y-4">
            {step === 'success' ? (
              <div className="space-y-3">
                <div className="bg-green-900/20 border border-green-800/40 rounded-lg px-4 py-4 text-sm text-green-400">
                  ✅ <span className="font-semibold">+{result?.creditsAdded} credits added!</span> ${result?.usdtAmount?.toFixed(2)} USDT confirmed on-chain.<br />
                  <span className="text-green-500/70 text-xs">New balance: {result?.newBalance?.toFixed(2)} credits</span>
                </div>
                <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-300 underline">Make another top-up</button>
              </div>
            ) : step === 'verifying' ? (
              <div className="flex items-center gap-3 text-sm text-gray-400">
                <Loader2 size={16} className="animate-spin text-[#e50914]" />
                Scanning blockchain for your payment...
              </div>
            ) : step === 'needsHash' ? (
              <div className="space-y-3">
                <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg px-4 py-3 text-sm text-yellow-400">
                  <Hash size={14} className="inline mr-1" />
                  {error || "Couldn't detect payment automatically. Please paste your TX hash."}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={txHash}
                    onChange={e => { setTxHash(e.target.value); setError(''); }}
                    placeholder="0x... (transaction hash)"
                    className="flex-1 bg-[#111] border border-[#333] rounded px-3 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50"
                  />
                  <button
                    onClick={handleManualHash}
                    disabled={!txHash.trim()}
                    className="px-4 py-2.5 bg-[#e50914] hover:bg-[#c40812] text-white text-sm font-semibold rounded disabled:opacity-50 transition-colors"
                  >
                    Verify
                  </button>
                </div>
                {error && !error.includes('paste') && (
                  <div className="text-xs text-red-400">{error}</div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm font-medium text-white">Step 2 — Enter amount & confirm payment</div>
                <div className="flex gap-2 items-center">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={usdtAmount}
                      onChange={e => setUsdtAmount(e.target.value)}
                      placeholder={minUsd}
                      className="w-full bg-[#111] border border-[#333] rounded pl-7 pr-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#e50914]/50"
                    />
                  </div>
                  <button
                    onClick={handleAutoPay}
                    disabled={!usdtAmount || parseFloat(usdtAmount) <= 0}
                    className="px-5 py-2.5 bg-[#e50914] hover:bg-[#c40812] text-white text-sm font-semibold rounded disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    I've Paid
                  </button>
                </div>
                {previewCredits > 0 && (
                  <div className="text-xs text-gray-500">
                    ${usdtAmount} USDT → <span className="text-white font-semibold">{previewCredits} credits</span>
                    {previewCredits < minLoad && <span className="text-red-400 ml-2">(below minimum {minLoad})</span>}
                  </div>
                )}
                <div className="text-xs text-gray-600">After paying, click "I've Paid" — we'll detect your transaction automatically within 5 minutes.</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border p-5" style={{ backgroundColor: '#1c1c1c', borderColor: '#333' }}>
          <div className="text-sm text-gray-500 bg-[#111] border border-[#333] rounded px-4 py-3">Wallet address not configured yet. Contact admin.</div>
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-lg border overflow-hidden" style={{ backgroundColor: '#1c1c1c', borderColor: '#333' }}>
          <div className="px-5 py-3 border-b border-[#2a2a2a] flex items-center gap-2">
            <Clock size={14} className="text-gray-500" />
            <span className="text-sm font-semibold text-white">Top-up History</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a]">
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 uppercase">TX Hash</th>
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 uppercase">USDT</th>
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 uppercase">Credits</th>
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 uppercase">Date</th>
              </tr>
            </thead>
            <tbody>
              {history.map(t => (
                <tr key={t.txHash} className="border-b border-[#222] hover:bg-[#222]/50">
                  <td className="px-4 py-2.5">
                    <a href={`https://bscscan.com/tx/${t.txHash}`} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                      {t.txHash.slice(0, 10)}...{t.txHash.slice(-6)} <ExternalLink size={10} />
                    </a>
                  </td>
                  <td className="px-4 py-2.5 text-white">${t.usdtAmount.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-[#e50914] font-semibold">+{t.creditsAdded}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
