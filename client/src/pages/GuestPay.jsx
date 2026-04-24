import { useState, useEffect, useRef, useCallback } from 'react';
import { CreditCard, Loader2, CheckCircle, AlertCircle, ShoppingCart, Wand2, ChevronRight, FlaskConical } from 'lucide-react';
import { cn } from '../lib/helpers';

const BRAINTREE_DROPIN_CDN = 'https://js.braintreegateway.com/web/dropin/1.43.0/js/dropin.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

const inputClass = "w-full bg-white border border-gray-300 rounded px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#e50914] focus:ring-1 focus:ring-[#e50914]/30";
const labelClass = "block text-xs text-gray-600 mb-1.5 font-medium uppercase tracking-wide";

const REQUIRED = ['billing_first_name','billing_last_name','billing_email','billing_address_1','billing_city','billing_state','billing_postcode'];

export default function GuestPay() {
  const [step, setStep]               = useState('billing');
  const [sessionId, setSessionId]     = useState('');
  const [clientToken, setClientToken] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [payError, setPayError]       = useState('');
  const [orderResult, setOrderResult] = useState(null);
  const [autoFilling, setAutoFilling] = useState(false);
  const [validationErr, setValidationErr] = useState('');

  const dropinRef  = useRef(null);
  const dropinInst = useRef(null);
  const [dropinReady, setDropinReady] = useState(false);
  const sessionPromise = useRef(null);

  const [billing, setBilling] = useState({
    billing_first_name: '', billing_last_name: '', billing_email: '',
    billing_phone: '', billing_address_1: '', billing_city: '',
    billing_postcode: '', billing_country: 'US', billing_state: '',
  });

  const set = (k) => (e) => {
    setBilling(b => ({ ...b, [k]: e.target.value }));
    if (!sessionPromise.current) startSessionFetch();
  };

  const startSessionFetch = useCallback(() => {
    sessionPromise.current = fetch('/api/pay/session')
      .then(r => r.json().then(d => ({ ok: r.ok, d })));
  }, []);

  const handleTestFill = () => {
    const firstNames = ['James','Michael','David','Robert','William','Richard','Thomas','Daniel'];
    const lastNames  = ['Smith','Johnson','Williams','Brown','Davis','Miller','Wilson','Moore'];
    const rand = arr => arr[Math.floor(Math.random() * arr.length)];
    const first = rand(firstNames);
    const last  = rand(lastNames);
    const streets = ['342 W 56th St','118 E 25th St','509 W 37th St','251 W 30th St','620 W 42nd St','450 W 31st St','330 W 46th St'];
    setBilling({
      billing_first_name: first,
      billing_last_name:  last,
      billing_email:      `${first.toLowerCase()}.${last.toLowerCase()}${Math.floor(Math.random()*99)+1}@gmail.com`,
      billing_phone:      `212${String(Math.floor(Math.random()*9000000)+1000000)}`,
      billing_address_1:  rand(streets),
      billing_city:       'New York',
      billing_postcode:   '10080',
      billing_country:    'US',
      billing_state:      'NY',
    });
    if (!sessionPromise.current) startSessionFetch();
  };

  const handleAutoFill = async () => {
    setAutoFilling(true);
    try {
      const r = await fetch('/api/pay/identity');
      const id = await r.json();
      if (!r.ok) throw new Error(id.error || 'Failed');
      setBilling({
        billing_first_name: id.billing_first_name || '',
        billing_last_name:  id.billing_last_name  || '',
        billing_email:      id.billing_email      || '',
        billing_phone:      id.billing_phone      || '',
        billing_address_1:  id.billing_address_1  || '',
        billing_city:       id.billing_city       || '',
        billing_postcode:   id.billing_postcode   || '',
        billing_country:    id.billing_country    || 'US',
        billing_state:      id.billing_state      || '',
      });
      if (!sessionPromise.current) startSessionFetch();
    } catch {}
    setAutoFilling(false);
  };

  const handleContinue = async () => {
    setValidationErr('');
    for (const k of REQUIRED) {
      if (!billing[k]?.trim()) {
        setValidationErr('Please fill in all required fields.');
        return;
      }
    }

    setStep('loading');
    if (!sessionPromise.current) startSessionFetch();

    try {
      const { ok, d } = await sessionPromise.current;
      if (!ok) throw new Error(d.error || 'Session init failed');
      setSessionId(d.sessionId);
      setClientToken(d.clientToken || '');
      setStep('payment');
    } catch (err) {
      setSessionError(err.message);
      setStep('error');
    }
  };

  useEffect(() => {
    if (step !== 'payment' || !clientToken || !dropinRef.current) return;
    let inst;
    (async () => {
      try {
        await loadScript(BRAINTREE_DROPIN_CDN);
        inst = await window.braintree.dropin.create({
          authorization: clientToken,
          container: dropinRef.current,
          card: {
            cardholderName: { required: true },
            overrides: {
              styles: {
                input: { color: '#111827', 'font-size': '14px', 'font-family': 'inherit' },
                ':focus': { color: '#111827' },
                '::placeholder': { color: '#9ca3af' },
              },
            },
          },
        });
        dropinInst.current = inst;
        setDropinReady(true);
        dropinRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        setPayError('Could not load payment form: ' + err.message);
      }
    })();
    return () => { if (inst) inst.teardown(); setDropinReady(false); };
  }, [step, clientToken]);

  const handlePay = async () => {
    if (!dropinInst.current) return;
    setPayError('');
    setStep('paying');
    try {
      const { nonce } = await dropinInst.current.requestPaymentMethod();
      const r = await fetch('/api/pay/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, paymentNonce: nonce, ...billing }),
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.error || 'Payment failed');
      setOrderResult(data);
      setStep('success');
    } catch (err) {
      setPayError(err.message);
      setStep('payment');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg space-y-6">

        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 mb-3">
            <ShoppingCart size={22} className="text-[#e50914]" />
            <span className="text-gray-900 font-bold text-xl tracking-tight">Secure Checkout</span>
          </div>
          <p className="text-gray-500 text-sm">Your payment is processed securely. No account required.</p>
        </div>

        {/* Success */}
        {step === 'success' && (
          <div className="bg-white border border-green-200 rounded-xl p-8 text-center space-y-4 shadow-sm">
            <div className="flex justify-center"><CheckCircle size={48} className="text-green-500" /></div>
            <h2 className="text-gray-900 font-bold text-xl">Payment Successful!</h2>
            {orderResult?.orderId && <p className="text-gray-600 text-sm">Order #{orderResult.orderId} confirmed.</p>}
            <p className="text-gray-500 text-xs">Thank you for your purchase.</p>
          </div>
        )}

        {/* Fatal session error */}
        {step === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 flex items-start gap-3">
            <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-700 font-semibold text-sm mb-1">Could not start checkout</p>
              <p className="text-red-600 text-xs">{sessionError}</p>
              <button onClick={() => { sessionPromise.current = null; setStep('billing'); }} className="mt-3 text-xs text-red-600 underline hover:text-red-700">← Try again</button>
            </div>
          </div>
        )}

        {/* Main form card */}
        {step !== 'success' && step !== 'error' && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">

            {/* ── Billing section ── */}
            <div className="p-6 space-y-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-gray-900 font-semibold text-sm flex items-center gap-2">
                  <CreditCard size={15} className="text-[#e50914]" /> Billing Information
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTestFill}
                    disabled={step === 'paying'}
                    title="Fill with a random NY test address (ZIP 10080)"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-white border border-[#e50914]/40 text-[#e50914] hover:bg-[#e50914]/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FlaskConical size={12} /> Test
                  </button>
                  <button
                    onClick={handleAutoFill}
                    disabled={autoFilling || step === 'paying'}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-white border border-gray-300 text-gray-600 hover:text-gray-900 hover:border-[#e50914]/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {autoFilling ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                    {autoFilling ? 'Filling…' : 'Auto-fill'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>First Name *</label>
                  <input className={inputClass} value={billing.billing_first_name} onChange={set('billing_first_name')} placeholder="John" />
                </div>
                <div>
                  <label className={labelClass}>Last Name *</label>
                  <input className={inputClass} value={billing.billing_last_name} onChange={set('billing_last_name')} placeholder="Smith" />
                </div>
              </div>
              <div>
                <label className={labelClass}>Email Address *</label>
                <input type="email" className={inputClass} value={billing.billing_email} onChange={set('billing_email')} placeholder="john@example.com" />
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input type="tel" className={inputClass} value={billing.billing_phone} onChange={set('billing_phone')} placeholder="+1 555 000 0000" />
              </div>
              <div>
                <label className={labelClass}>Address *</label>
                <input className={inputClass} value={billing.billing_address_1} onChange={set('billing_address_1')} placeholder="123 Main St" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className={labelClass}>City *</label>
                  <input className={inputClass} value={billing.billing_city} onChange={set('billing_city')} placeholder="New York" />
                </div>
                <div>
                  <label className={labelClass}>State *</label>
                  <input className={inputClass} value={billing.billing_state} onChange={set('billing_state')} placeholder="NY" />
                </div>
                <div>
                  <label className={labelClass}>ZIP *</label>
                  <input className={inputClass} value={billing.billing_postcode} onChange={set('billing_postcode')} placeholder="10001" />
                </div>
              </div>
              <div>
                <label className={labelClass}>Country</label>
                <select className={cn(inputClass, 'cursor-pointer')} value={billing.billing_country} onChange={set('billing_country')}>
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                  <option value="GB">United Kingdom</option>
                  <option value="AU">Australia</option>
                  <option value="AE">United Arab Emirates</option>
                  <option value="IN">India</option>
                  <option value="PK">Pakistan</option>
                  <option value="SG">Singapore</option>
                </select>
              </div>

              {validationErr && (
                <p className="text-xs text-red-600 flex items-center gap-1.5">
                  <AlertCircle size={12} /> {validationErr}
                </p>
              )}

              {(step === 'billing' || step === 'loading') && (
                <button
                  onClick={handleContinue}
                  disabled={step === 'loading'}
                  className="w-full py-3 bg-[#e50914] hover:bg-[#c40812] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 mt-2"
                >
                  {step === 'loading' ? (
                    <><Loader2 size={16} className="animate-spin" /> Setting up payment…</>
                  ) : (
                    <>Continue to Payment <ChevronRight size={16} /></>
                  )}
                </button>
              )}
            </div>

            {/* ── Payment section ── */}
            {(step === 'payment' || step === 'paying') && (
              <div className="p-6 space-y-4 bg-white">
                <h3 className="text-gray-900 font-semibold text-sm flex items-center gap-2">
                  <CreditCard size={15} className="text-[#e50914]" /> Payment Details
                </h3>

                {!clientToken ? (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-xs text-yellow-700">
                    Payment form unavailable. Please refresh and try again.
                  </div>
                ) : (
                  <div ref={dropinRef} />
                )}

                {payError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700 flex items-start gap-2">
                    <AlertCircle size={13} className="shrink-0 mt-0.5" />
                    {payError}
                  </div>
                )}

                <button
                  onClick={handlePay}
                  disabled={step === 'paying' || !clientToken || !dropinReady}
                  className="w-full py-3 bg-[#e50914] hover:bg-[#c40812] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {step === 'paying' ? (
                    <><Loader2 size={16} className="animate-spin" /> Processing payment…</>
                  ) : (
                    <>Complete Payment</>
                  )}
                </button>

                <p className="text-xs text-gray-500 text-center">
                  Your card is processed securely via Braintree. We never store card numbers.
                </p>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
