import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Sun, Moon, Lock, Mail, Loader2, Key, ChevronLeft, Building2, Phone, ShieldCheck,
  Check, LogOut, Home, ClipboardList, BookOpen, User, ChevronRight,
  Package, FileText, Film, X, RefreshCw, AlertCircle, Download,
  TrendingUp, Clock, Truck, Users, Eye, Search, Filter, Calendar,
  Briefcase, Tag, Heart, Pin, Sparkles, FileX, FolderOpen,
} from 'lucide-react';
import {
  APSession, apLogin, apChangePin, apRefreshToken, clearSession, loadSession, saveSession,
  submitAgentRequest, warmUpEdgeFunction, jwtIsExpired,
  fetchAgentId, fetchAgentNameFromDb, fetchMyCustomers, fetchOrdersByAgent, fetchMyChallans,
  fetchCatalogs, fetchVolumes, enrichWithVolumes, resolveStorageUrl, preBatchSignUrls,
  fetchLikes, toggleLike,
  Agent, Customer, Order, Challan, Catalog, CatalogCategory, Volume, LikeData,
} from './lib/supabase';
import { startRealtimeSync, stopRealtimeSync, updateRealtimeToken } from './lib/realtimeSync';
import { Browser } from '@capacitor/browser';

// ── Rate limiting ──────────────────────────────────────────────────────────────
const AP_RATE_KEY      = 'ap_rate_limit';
const AP_MAX_ATTEMPTS  = 5;
const AP_LOCKOUT_MS    = 15 * 60 * 1000;
function getRateData() {
  try { return JSON.parse(sessionStorage.getItem(AP_RATE_KEY) || '{}'); } catch { return { attempts: 0, lockedUntil: 0 }; }
}

// ── Dark mode ─────────────────────────────────────────────────────────────────
function useDarkMode(): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('ap_dark') === '1' || window.matchMedia('(prefers-color-scheme: dark)').matches; }
    catch { return true; }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('ap_dark', dark ? '1' : '0'); } catch { /* ignore */ }
  }, [dark]);
  return [dark, setDark];
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onDone }: { msg: string; type: 'error' | 'success' | 'info'; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  const color = type === 'error' ? 'bg-red-600' : type === 'success' ? 'bg-emerald-600' : 'bg-zinc-700';
  return (
    <motion.div initial={{ opacity: 0, y: -30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }}
      className={`fixed top-16 left-4 right-4 z-[200] ${color} text-white px-5 py-4 rounded-2xl shadow-2xl text-sm font-bold`}>
      {msg}
    </motion.div>
  );
}

// ── Agent Sign-Up Screen ───────────────────────────────────────────────────────
function AgentSignupScreen({ onBack, showToast }: {
  onBack: () => void;
  showToast: (m: string, t: 'error' | 'success' | 'info') => void;
}) {
  const [agencyName, setAgencyName] = useState('');
  const [name, setName]             = useState('');
  const [phone, setPhone]           = useState('');
  const [email, setEmail]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [done, setDone]             = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agencyName.trim() || !name.trim() || !phone.trim() || !email.trim()) {
      showToast('All fields are required.', 'error'); return;
    }
    if (!/^\d{10}$/.test(phone.replace(/\D/g, ''))) {
      showToast('Enter a valid 10-digit phone number.', 'error'); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Enter a valid email address.', 'error'); return;
    }
    setLoading(true);
    const { error } = await submitAgentRequest(agencyName, name, phone, email);
    setLoading(false);
    if (error) { showToast(error, 'error'); return; }
    setDone(true);
  };

  if (done) return (
    <div className="flex flex-col items-center text-center space-y-4 py-8">
      <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
        <Check size={32} className="text-amber-600" />
      </div>
      <h3 className="text-xl font-black text-zinc-900 dark:text-zinc-100">Request Submitted!</h3>
      <p className="text-sm text-zinc-500 max-w-xs">
        Your agent access request has been sent for review. Our team will reach out to you at{' '}
        <strong className="text-zinc-900 dark:text-zinc-100">{email}</strong> once approved.
      </p>
      <button onClick={onBack} className="mt-4 px-6 py-3 bg-amber-500 text-white rounded-2xl font-black text-sm">
        Back to Login
      </button>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 -ml-1">
        <ChevronLeft size={14} /> Back
      </button>
      {[
        { label: 'Agency Name',    icon: Building2, val: agencyName, set: setAgencyName, ph: 'Your agency / firm name',  type: 'text'  },
        { label: 'Your Name',      icon: ShieldCheck, val: name,      set: setName,       ph: 'Full name',               type: 'text'  },
        { label: 'Phone Number',   icon: Phone,      val: phone,     set: setPhone,      ph: '10-digit mobile',          type: 'tel'   },
        { label: 'Email Address',  icon: Mail,       val: email,     set: setEmail,      ph: 'your@email.com',           type: 'email' },
      ].map(({ label, icon: Icon, val, set, ph, type }) => (
        <div key={label}>
          <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-1">{label}</label>
          <div className="relative mt-1">
            <Icon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input type={type} value={val} onChange={e => set(e.target.value)} placeholder={ph}
              autoCapitalize={type === 'email' ? 'none' : 'words'}
              className="w-full pl-10 pr-4 py-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 font-medium text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 text-zinc-900 dark:text-zinc-100" />
          </div>
        </div>
      ))}
      <button type="submit" disabled={loading}
        className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-2xl shadow-lg disabled:opacity-60 flex items-center justify-center gap-2">
        {loading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
        {loading ? 'Submitting...' : 'Submit Request'}
      </button>
    </form>
  );
}

// ── Change PIN Screen ─────────────────────────────────────────────────────────
function ChangePinScreen({ session, onSuccess, showToast }: {
  session: APSession; onSuccess: () => void;
  showToast: (m: string, t: 'error' | 'success' | 'info') => void;
}) {
  const [newPin, setNewPin]         = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading]       = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length < 4) { showToast('PIN must be at least 4 characters.', 'error'); return; }
    if (newPin !== confirmPin) { showToast('PINs do not match.', 'error'); return; }
    setLoading(true);
    const { error } = await apChangePin(session.email, newPin, session.accessToken);
    setLoading(false);
    if (error) { showToast(error, 'error'); return; }
    showToast('PIN changed successfully!', 'success');
    onSuccess();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-6">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-[2rem] shadow-xl border border-zinc-100 dark:border-zinc-800 p-8">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-6 mx-auto">
          <Lock size={28} className="text-amber-600" />
        </div>
        <h2 className="text-2xl font-black text-center text-zinc-900 dark:text-zinc-100 mb-1">Set Your PIN</h2>
        <p className="text-sm text-zinc-500 text-center mb-6">This is your first login. Please set a secure PIN.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { label: 'New PIN', val: newPin, set: setNewPin },
            { label: 'Confirm PIN', val: confirmPin, set: setConfirmPin },
          ].map(({ label, val, set }) => (
            <div key={label}>
              <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-1">{label}</label>
              <div className="relative mt-1">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input type="password" value={val} onChange={e => set(e.target.value)} placeholder="Min 4 characters"
                  className="w-full pl-10 pr-4 py-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 font-medium text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 text-zinc-900 dark:text-zinc-100" />
              </div>
            </div>
          ))}
          <button type="submit" disabled={loading}
            className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-2xl disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Key size={18} />}
            {loading ? 'Saving...' : 'Set PIN'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onSuccess, showToast }: {
  onSuccess: (s: APSession) => void;
  showToast: (m: string, t: 'error' | 'success' | 'info') => void;
}) {
  const [tab, setTab]           = useState<'login' | 'signup'>('login');
  const [email, setEmail]       = useState('');
  const [pin, setPin]           = useState('');
  const [loading, setLoading]   = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [dark, setDark] = useDarkMode();

  useEffect(() => { warmUpEdgeFunction(); }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const { lockedUntil } = getRateData();
      setLockoutRemaining(lockedUntil ? Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const rateData = getRateData();
    if (rateData.lockedUntil && Date.now() < rateData.lockedUntil) {
      showToast(`Too many attempts. Try again in ${Math.ceil((rateData.lockedUntil - Date.now()) / 1000)}s.`, 'error'); return;
    }
    if (!email.trim()) { showToast('Enter your email address.', 'error'); return; }
    if (pin.length < 4) { showToast('Enter your PIN (min 4 characters).', 'error'); return; }
    setLoading(true);
    let result: Awaited<ReturnType<typeof apLogin>>;
    try { result = await apLogin(email, pin); }
    catch { result = { error: 'Network error. Check your connection and try again.' }; }
    setLoading(false);
    if (result.error) {
      // Only count genuine auth failures (wrong PIN / device limit) toward the
      // lockout — network/connection errors are outside the user's control and
      // must not burn their attempt budget.
      const isAuthFailure = /invalid email or pin|access denied|device limit/i.test(result.error)
        || !!result.deviceLimitReached;
      if (isAuthFailure) {
        const cur = getRateData();
        const attempts = (cur.attempts || 0) + 1;
        const lockedUntil = attempts >= AP_MAX_ATTEMPTS ? Date.now() + AP_LOCKOUT_MS : (cur.lockedUntil || 0);
        try { sessionStorage.setItem(AP_RATE_KEY, JSON.stringify({ attempts, lockedUntil })); } catch { /* ignore */ }
        if (attempts >= AP_MAX_ATTEMPTS) {
          showToast('Too many failed attempts. Locked for 15 minutes.', 'error');
          return;
        }
      }
      showToast(result.error, 'error');
      return;
    }
    try { sessionStorage.removeItem(AP_RATE_KEY); } catch { /* ignore */ }
    if (result.session) onSuccess(result.session);
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 select-none">
      {/* Header */}
      <div className="flex items-center justify-end px-6 pt-[max(env(safe-area-inset-top),48px)] pb-2">
        <button onClick={() => setDark(d => !d)} className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
      {/* Branding */}
      <div className="flex flex-col items-center pt-4 pb-8 px-6">
        <div className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-amber-400 via-amber-500 to-orange-600 flex items-center justify-center shadow-2xl shadow-amber-300/40 dark:shadow-amber-900/50 mb-5 relative overflow-hidden">
          {/* Cloth weave pattern overlay */}
          <div className="absolute inset-0 opacity-20" style={{
            backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.3) 0, rgba(255,255,255,0.3) 1px, transparent 0, transparent 50%)',
            backgroundSize: '8px 8px',
          }} />
          <Briefcase size={44} className="text-white relative z-10" />
        </div>
        <h1 className="text-3xl font-black tracking-tight text-center text-zinc-900 dark:text-zinc-100">
          <span className="text-amber-500">Agents</span>
        </h1>
        <p className="text-xs text-zinc-400 mt-1.5 text-center font-bold uppercase tracking-widest">
          Kanika × S.I.M. Agent Portal
        </p>
      </div>
      {/* Card */}
      <div className="flex-1 px-4">
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] shadow-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
          <div className="flex border-b border-zinc-100 dark:border-zinc-800">
            <button onClick={() => setTab('login')}
              className={`flex-1 py-4 text-sm font-black tracking-wide transition-colors ${tab === 'login' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-zinc-400'}`}>
              LOGIN
            </button>
            <button onClick={() => setTab('signup')}
              className={`flex-1 py-4 text-sm font-black tracking-wide transition-colors ${tab === 'signup' ? 'text-amber-500 border-b-2 border-amber-500' : 'text-zinc-400'}`}>
              REGISTER
            </button>
          </div>
          <div className="p-6">
            {tab === 'signup' ? (
              <AgentSignupScreen onBack={() => setTab('login')} showToast={showToast} />
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-1">Email Address</label>
                  <div className="relative mt-1">
                    <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com"
                      autoCapitalize="none" autoComplete="email"
                      className="w-full pl-10 pr-4 py-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 font-medium text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 text-zinc-900 dark:text-zinc-100" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-1">Secret PIN</label>
                  <div className="relative mt-1">
                    <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="Your PIN"
                      autoComplete="current-password"
                      className="w-full pl-10 pr-4 py-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 font-medium text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 text-zinc-900 dark:text-zinc-100" />
                  </div>
                </div>
                <button type="submit" disabled={loading || pin.length < 4 || lockoutRemaining > 0}
                  className="w-full py-4 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-2xl shadow-lg shadow-amber-200 dark:shadow-none disabled:opacity-60 flex items-center justify-center gap-2 mt-2">
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Key size={18} />}
                  {loading ? 'Signing in…' : lockoutRemaining > 0 ? `Locked (${lockoutRemaining}s)` : 'Sign In'}
                </button>
                {lockoutRemaining > 0 && (
                  <button type="button"
                    onClick={() => { try { sessionStorage.removeItem(AP_RATE_KEY); } catch { /**/ } setLockoutRemaining(0); }}
                    className="w-full text-center text-[11px] font-bold text-zinc-400 hover:text-amber-500 py-1">
                    Locked due to a connection error? Tap to unlock
                  </button>
                )}
              </form>
            )}
          </div>
        </div>
        <p className="text-center text-[11px] text-zinc-400 mt-5 px-4">
          Use your existing PIN from the Smart Inventory Manager app. New agents can register above.
        </p>
      </div>
      <div className="h-10" />
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color, onClick }: {
  label: string; value: string | number; icon: React.ElementType;
  color: string; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className={`flex-1 min-w-0 rounded-2xl p-4 text-left bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 shadow-sm active:scale-95 transition-transform ${onClick ? 'cursor-pointer' : 'cursor-default'}`}>
      <div className={`w-9 h-9 rounded-xl ${color} flex items-center justify-center mb-3`}>
        <Icon size={18} className="text-white" />
      </div>
      <p className="text-2xl font-black text-zinc-900 dark:text-zinc-100 leading-none">{value}</p>
      <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mt-1">{label}</p>
    </button>
  );
}

// ── Formatted date ────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso.slice(0, 10); }
}

// ── Order Card ────────────────────────────────────────────────────────────────
function OrderCard({ order, highlight, mode }: { order: Order; highlight?: string; mode?: OrderFilterMode }) {
  const [expanded, setExpanded] = useState(false);
  const pending = order.status !== 'Delivered';
  const totalPcs = order.items.reduce((s, i) => s + (i.quantity || 0), 0);

  // Unique catalog names for the collapsed summary line
  const catalogSummary = useMemo(() => {
    const names = [...new Set(order.items.map(i => i.catalog_name).filter(Boolean))] as string[];
    return names.length ? names.join(' · ') : null;
  }, [order.items]);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm overflow-hidden">
      <button className="w-full flex items-center justify-between p-4 text-left" onClick={() => setExpanded(e => !e)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-black text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">{order.order_number}</span>
            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${pending ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600'}`}>
              {order.status}
            </span>
            {highlight && <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-0.5 rounded-full">{highlight}</span>}
          </div>
          {mode === 'catalog'
            ? <p className="font-black text-zinc-900 dark:text-zinc-100 mt-1 truncate">{order.customer_name || '—'}</p>
            : catalogSummary
              ? <p className="font-black text-zinc-900 dark:text-zinc-100 mt-1 truncate">{catalogSummary}</p>
              : <p className="font-black text-zinc-400 mt-1 truncate">{order.items.length} item{order.items.length !== 1 ? 's' : ''}</p>}
          <p className="text-[11px] text-zinc-400">{order.city_name} · {fmtDate(order.created_at)}</p>
        </div>
        <div className="text-right ml-3 shrink-0">
          <p className="text-base font-black text-zinc-900 dark:text-zinc-100">₹{order.total_amount.toLocaleString('en-IN')}</p>
          <p className="text-[11px] text-zinc-400">{totalPcs} pcs</p>
          <ChevronRight size={14} className={`text-zinc-300 mx-auto mt-1 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-2">
              {order.remarks && <p className="text-xs text-zinc-500 italic">{order.remarks}</p>}
              {order.items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-1.5 border-b border-zinc-50 dark:border-zinc-800 last:border-0">
                  <div>
                    <p className="text-xs font-black text-zinc-800 dark:text-zinc-200">{item.catalog_name || '—'}</p>
                    <p className="text-[11px] text-zinc-500">{item.volume_name || `Vol #${item.volume_id}`} · {item.size}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-black text-zinc-700 dark:text-zinc-300">{item.quantity} pcs × ₹{item.rate}</p>
                    <p className="text-[11px] text-amber-600 font-bold">₹{item.amount.toLocaleString('en-IN')}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── PDF Viewer Modal ──────────────────────────────────────────────────────────
function PdfViewerModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[150] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}>
        <button onClick={onClose} className="p-2 rounded-xl bg-zinc-800 text-white"><ChevronLeft size={18} /></button>
        <p className="text-sm font-black text-white truncate flex-1 mx-3">{title}</p>
        <a href={url} target="_blank" rel="noreferrer" className="p-2 rounded-xl bg-zinc-800 text-white">
          <Download size={18} />
        </a>
      </div>
      <iframe src={url} className="flex-1 w-full border-0 bg-white" title={title} />
    </div>
  );
}

// ── Video Viewer Modal ────────────────────────────────────────────────────────
function VideoViewerModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[150] bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}>
        <button onClick={onClose} className="p-2 rounded-xl bg-zinc-800 text-white"><ChevronLeft size={18} /></button>
        <p className="text-sm font-black text-white truncate flex-1 mx-3">{title}</p>
        <Film size={18} className="text-zinc-400 mr-1" />
      </div>
      <div className="flex-1 flex items-center justify-center bg-black p-4">
        <video src={url} controls autoPlay className="max-w-full max-h-full rounded-xl" playsInline />
      </div>
    </div>
  );
}

// ── Storage image with auto-sign ──────────────────────────────────────────────
function StorageImg({ src, alt, className, token }: { src?: string; alt: string; className: string; token: string }) {
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!src) return;
    if (src.startsWith('blob:') || src.startsWith('data:') || !src.includes('/storage/')) {
      setResolved(src); return;
    }
    resolveStorageUrl(src, token).then(url => { if (!cancelled) setResolved(url); });
    return () => { cancelled = true; };
  }, [src, token]);
  if (!resolved) return <div className={`${className} bg-zinc-200 dark:bg-zinc-800 animate-pulse`} />;
  return <img src={resolved} alt={alt} className={className} />;
}

// ── Catalog Card (3×3 grid tile with double-tap like) ─────────────────────────
function CatalogCard({
  catalog, volCount, likeCount, likedByMe, token, onClick, onLike,
}: {
  catalog: Catalog; volCount: number; likeCount: number; likedByMe: boolean;
  token: string; onClick: () => void; onLike: (id: number) => void;
}) {
  const lastTap   = useRef(0);
  const [heartAnim, setHeartAnim] = useState(false);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 320) {
      onLike(catalog.id);
      setHeartAnim(true);
      setTimeout(() => setHeartAnim(false), 800);
    } else {
      setTimeout(() => {
        if (Date.now() - now < 310) return;
        onClick();
      }, 320);
    }
    lastTap.current = now;
  }, [catalog.id, onClick, onLike]);

  return (
    <div className={`relative rounded-2xl overflow-hidden border bg-white dark:bg-zinc-900 shadow-sm
      ${catalog.is_pinned ? 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-200 dark:ring-amber-800' : 'border-zinc-100 dark:border-zinc-800'}`}>
      {catalog.is_pinned && (
        <div className="absolute top-1 left-1 z-10 bg-amber-400 rounded-md p-0.5 shadow">
          <Pin size={8} className="text-white" fill="white" />
        </div>
      )}
      <button className="w-full text-left active:scale-95 transition-transform" onClick={handleTap}>
        <div className="aspect-square bg-zinc-100 dark:bg-zinc-800 relative overflow-hidden">
          {catalog.cover_photo
            ? <StorageImg src={catalog.cover_photo} alt={catalog.name} className="w-full h-full object-cover" token={token} />
            : <div className="w-full h-full flex items-center justify-center"><BookOpen size={22} className="text-zinc-300 dark:text-zinc-600" /></div>}
          {/* Double-tap heart burst */}
          {heartAnim && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Heart size={48} className="text-white drop-shadow-2xl" fill="white"
                style={{ animation: 'heartPop 0.8s ease forwards' }} />
            </div>
          )}
        </div>
        <div className="px-1.5 pt-1 pb-0.5">
          <p className="text-[9px] font-black text-zinc-900 dark:text-zinc-100 truncate leading-tight">{catalog.name}</p>
          <p className="text-[8px] text-zinc-400">{volCount} vol</p>
        </div>
      </button>
      {/* Like row */}
      <div className="flex items-center gap-1 px-1.5 pb-1.5">
        <button onClick={e => { e.stopPropagation(); onLike(catalog.id); }} className="flex items-center gap-1 group">
          <Heart size={11} fill={likedByMe ? 'currentColor' : 'none'}
            className={`transition-all ${likedByMe ? 'text-red-500 fill-red-500 scale-110' : 'text-zinc-300 dark:text-zinc-600 group-hover:text-red-400'}`} />
          <span className={`text-[8px] font-black ${likedByMe ? 'text-red-500' : 'text-zinc-400'}`}>{likeCount}</span>
        </button>
      </div>
    </div>
  );
}

// ── Catalog Modal (volume list popup — same style as catalog-viewer) ───────────
function CatalogModal({
  catalog, volumes, token, onClose, onSelectVolume, onPrev, onNext,
}: {
  catalog: Catalog; volumes: Volume[]; token: string;
  onClose: () => void; onSelectVolume: (v: Volume) => void;
  onPrev?: () => void; onNext?: () => void;
}) {
  const catalogVols = volumes.filter(v => Number(v.catalog_id) === Number(catalog.id));
  const swipeX      = useRef(0);
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end justify-center"
      onClick={onClose}>
      <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
        className="bg-white dark:bg-zinc-900 rounded-t-[2.5rem] w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
        onTouchStart={e => { swipeX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          const delta = e.changedTouches[0].clientX - swipeX.current;
          if (delta > 60 && onPrev) onPrev();
          else if (delta < -60 && onNext) onNext();
        }}>
        {/* Cover */}
        <div className="relative h-44 flex-shrink-0 bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          {catalog.cover_photo
            ? <StorageImg src={catalog.cover_photo} alt={catalog.name} className="w-full h-full object-cover" token={token} />
            : <div className="w-full h-full flex items-center justify-center"><BookOpen size={40} className="text-zinc-400" /></div>}
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/70" />
          {onPrev && (
            <button onClick={e => { e.stopPropagation(); onPrev(); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-black/30 hover:bg-black/50 text-white rounded-full backdrop-blur-sm transition-colors">
              <ChevronLeft size={18} />
            </button>
          )}
          {onNext && (
            <button onClick={e => { e.stopPropagation(); onNext(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-black/30 hover:bg-black/50 text-white rounded-full backdrop-blur-sm transition-colors">
              <ChevronRight size={18} />
            </button>
          )}
          <button onClick={onClose}
            className="absolute top-4 right-4 p-1.5 bg-black/30 text-white rounded-full backdrop-blur-sm">
            <X size={16} />
          </button>
          <div className="absolute bottom-4 left-5 flex items-center gap-3">
            <div>
              <h4 className="text-xl font-black text-white italic">{catalog.name}</h4>
              <p className="text-amber-300 text-[10px] font-black uppercase tracking-[0.15em]">
                {catalogVols.length} Volume{catalogVols.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
        {/* Volumes */}
        <div className="p-5 flex-1 overflow-y-auto custom-scrollbar">
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3">Select Volume</p>
          {catalogVols.length === 0 ? (
            <div className="p-10 text-center text-zinc-400 border-2 border-dashed border-zinc-100 dark:border-zinc-800 rounded-3xl text-sm">
              No volumes yet.
            </div>
          ) : (
            <div className="space-y-2">
              {catalogVols.map(vol => (
                <button key={vol.id} onClick={() => onSelectVolume(vol)}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-amber-50 dark:hover:bg-amber-900/10 hover:border-amber-200 dark:hover:border-amber-800 transition-all group text-left">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white dark:bg-zinc-800 shadow-sm flex items-center justify-center text-amber-600 font-black text-sm italic">
                      {vol.volume_name.match(/\d+/)?.[0] || vol.volume_name[0]}
                    </div>
                    <div>
                      <p className="font-black text-zinc-900 dark:text-zinc-100 text-sm">{vol.volume_name}</p>
                      <p className="text-[10px] text-zinc-400 font-black uppercase tracking-wider group-hover:text-amber-500 flex items-center gap-1">
                        {vol.pdf_url && vol.video_url ? (
                          <><FileText size={8} /> PDF · <Film size={8} /> Video</>
                        ) : vol.pdf_url ? (
                          <><FileText size={8} /> PDF Available</>
                        ) : vol.video_url ? (
                          <><Film size={8} /> Video Available</>
                        ) : 'No Content'}
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-zinc-300 group-hover:text-amber-500" />
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ── Folder Tile (category card in folder view) ────────────────────────────────
function FolderTile({ name, count, coverUrls, onClick, token }: {
  name: string; count: number; coverUrls: string[]; onClick: () => void; token: string;
}) {
  const imgs = coverUrls.slice(0, 4);
  return (
    <button onClick={onClick}
      className="rounded-2xl overflow-hidden border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm active:scale-95 transition-transform text-left">
      {/* 2×2 collage */}
      <div className="aspect-square bg-zinc-100 dark:bg-zinc-800 relative overflow-hidden">
        {imgs.length > 0 ? (
          <div className={`w-full h-full grid ${imgs.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-px`}>
            {imgs.map((url, i) => (
              <StorageImg key={i} src={url} alt="" className="w-full h-full object-cover" token={token} />
            ))}
            {/* Fill empty slots with solid bg */}
            {imgs.length === 3 && <div className="w-full h-full bg-zinc-200 dark:bg-zinc-700" />}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FolderOpen size={28} className="text-zinc-300 dark:text-zinc-600" />
          </div>
        )}
        {/* Gradient overlay + count badge */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        <div className="absolute bottom-2 right-2 bg-amber-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
          {count}
        </div>
      </div>
      <div className="px-2 py-2">
        <p className="text-[10px] font-black text-zinc-900 dark:text-zinc-100 truncate leading-tight">{name}</p>
        <p className="text-[9px] text-zinc-400 mt-0.5">{count} catalog{count !== 1 ? 's' : ''}</p>
      </div>
    </button>
  );
}

// ── Catalog Screen ────────────────────────────────────────────────────────────
function CatalogScreen({ catalogs, volumes, token, likes, onLike, categories }: {
  catalogs: Catalog[]; volumes: Volume[]; token: string;
  likes: LikeData; onLike: (id: number) => void;
  categories: CatalogCategory[];
}) {
  // null = folder view, -1 = all, 0 = uncategorized, N = specific category
  const [browsedCategoryId, setBrowsedCategoryId] = useState<number | null>(null);
  const [selectedCatalog, setSelectedCatalog]     = useState<Catalog | null>(null);
  const [pdfViewer, setPdfViewer]                 = useState<{ url: string; title: string } | null>(null);
  const [videoViewer, setVideoViewer]             = useState<{ url: string; title: string } | null>(null);
  const [resolving, setResolving]                 = useState<number | null>(null);
  const [search, setSearch]                       = useState('');

  // Catalogs that have at least one volume
  const catalogsWithContent = useMemo(() =>
    catalogs.filter(c => volumes.some(v => Number(v.catalog_id) === Number(c.id))),
  [catalogs, volumes]);

  const uncategorizedCount = useMemo(() =>
    catalogsWithContent.filter(c => !c.category_id).length,
  [catalogsWithContent]);

  // Grid catalogs: search overrides folder navigation
  const gridCatalogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      // Search mode: all active catalogs, not just those with content
      return catalogs.filter(c => c.name.toLowerCase().includes(q));
    }
    if (browsedCategoryId === null) return [];
    if (browsedCategoryId === -1)   return catalogsWithContent;
    if (browsedCategoryId === 0)    return catalogsWithContent.filter(c => !c.category_id);
    return catalogsWithContent.filter(c => c.category_id === browsedCategoryId);
  }, [catalogs, catalogsWithContent, browsedCategoryId, search]);

  const showFolderView = !search.trim() && browsedCategoryId === null;

  const currentCategoryName = useMemo(() => {
    if (browsedCategoryId === -1) return 'All Catalogs';
    if (browsedCategoryId === 0)  return 'Uncategorized';
    return categories.find(c => c.id === browsedCategoryId)?.name || '';
  }, [browsedCategoryId, categories]);

  // Nav set for the open catalog modal (prev/next within current grid)
  const navList = useMemo(() =>
    gridCatalogs.filter(c => volumes.some(v => Number(v.catalog_id) === Number(c.id))),
  [gridCatalogs, volumes]);

  const openContent = async (vol: Volume, type: 'pdf' | 'video') => {
    const rawUrl = type === 'pdf' ? vol.pdf_url : vol.video_url;
    if (!rawUrl) return;
    setResolving(vol.id);
    const url = await resolveStorageUrl(rawUrl, token);
    setResolving(null);
    const catalogName = selectedCatalog?.name || '';
    const title = `${catalogName} — ${vol.volume_name}`;
    if (type === 'pdf') {
      try {
        if ((window as any).Capacitor?.isNativePlatform?.()) {
          await Browser.open({ url });
        } else {
          setPdfViewer({ url, title });
        }
      } catch { setPdfViewer({ url, title }); }
    } else {
      setVideoViewer({ url, title });
    }
    setSelectedCatalog(null);
  };

  if (pdfViewer)   return <PdfViewerModal   {...pdfViewer}   onClose={() => setPdfViewer(null)} />;
  if (videoViewer) return <VideoViewerModal {...videoViewer} onClose={() => setVideoViewer(null)} />;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="p-3 space-y-3">

        {/* Search bar */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search catalogs…"
            className="w-full pl-8 pr-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-medium focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 text-zinc-900 dark:text-zinc-100" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Breadcrumb / back button when inside a category */}
        {!search.trim() && browsedCategoryId !== null && (
          <button onClick={() => setBrowsedCategoryId(null)}
            className="flex items-center gap-1.5 text-xs font-black text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-xl w-full">
            <ChevronLeft size={14} />
            <span className="truncate">{currentCategoryName}</span>
            <span className="ml-auto text-amber-400 font-bold">{gridCatalogs.length} catalogs</span>
          </button>
        )}

        {/* ── FOLDER VIEW ── */}
        {showFolderView && (
          <>
            {categories.length === 0 && uncategorizedCount === 0 ? (
              /* No categories at all — show normal 3-col grid directly */
              <div className="grid grid-cols-3 gap-2">
                {catalogsWithContent.map(cat => (
                  <CatalogCard key={cat.id} catalog={cat}
                    volCount={volumes.filter(v => Number(v.catalog_id) === Number(cat.id)).length}
                    likeCount={likes.counts[cat.id] || 0}
                    likedByMe={likes.likedByMe.has(cat.id)}
                    token={token}
                    onClick={() => setSelectedCatalog(cat)}
                    onLike={onLike}
                  />
                ))}
                {catalogsWithContent.length === 0 && (
                  <div className="col-span-3 text-center text-zinc-400 py-16 text-sm">No catalogs available.</div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {/* All Catalogs folder */}
                <FolderTile
                  name="All Catalogs"
                  count={catalogsWithContent.length}
                  coverUrls={catalogsWithContent.slice(0, 4).map(c => c.cover_photo).filter(Boolean) as string[]}
                  onClick={() => setBrowsedCategoryId(-1)}
                  token={token}
                />
                {/* Named category folders */}
                {categories.map(cat => {
                  const catCatalogs = catalogsWithContent.filter(c => c.category_id === cat.id);
                  return (
                    <FolderTile
                      key={cat.id}
                      name={cat.name}
                      count={catCatalogs.length}
                      coverUrls={catCatalogs.slice(0, 4).map(c => c.cover_photo).filter(Boolean) as string[]}
                      onClick={() => setBrowsedCategoryId(cat.id)}
                      token={token}
                    />
                  );
                })}
                {/* Uncategorized folder (only if items exist) */}
                {uncategorizedCount > 0 && (
                  <FolderTile
                    name="Uncategorized"
                    count={uncategorizedCount}
                    coverUrls={catalogsWithContent.filter(c => !c.category_id).slice(0, 4).map(c => c.cover_photo).filter(Boolean) as string[]}
                    onClick={() => setBrowsedCategoryId(0)}
                    token={token}
                  />
                )}
              </div>
            )}
          </>
        )}

        {/* ── CATALOG GRID VIEW (inside a folder, or search results) ── */}
        {!showFolderView && (
          <div className="grid grid-cols-3 gap-2">
            {gridCatalogs.map(cat => (
              <CatalogCard key={cat.id} catalog={cat}
                volCount={volumes.filter(v => Number(v.catalog_id) === Number(cat.id)).length}
                likeCount={likes.counts[cat.id] || 0}
                likedByMe={likes.likedByMe.has(cat.id)}
                token={token}
                onClick={() => setSelectedCatalog(cat)}
                onLike={onLike}
              />
            ))}
            {gridCatalogs.length === 0 && (
              <div className="col-span-3 text-center text-zinc-400 py-16 text-sm">
                {search.trim() ? 'No catalogs found.' : 'No catalogs in this folder.'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Catalog modal popup */}
      <AnimatePresence>
        {selectedCatalog && (() => {
          const navIdx = navList.findIndex(c => c.id === selectedCatalog.id);
          const goPrev = navIdx > 0 ? () => setSelectedCatalog(navList[navIdx - 1]) : undefined;
          const goNext = navIdx < navList.length - 1 ? () => setSelectedCatalog(navList[navIdx + 1]) : undefined;
          return (
            <CatalogModal
              catalog={selectedCatalog} volumes={volumes} token={token}
              onClose={() => setSelectedCatalog(null)}
              onSelectVolume={vol => { resolving === null && openContent(vol, vol.pdf_url ? 'pdf' : 'video'); }}
              onPrev={goPrev} onNext={goNext}
            />
          );
        })()}
      </AnimatePresence>

      {/* Resolving spinner overlay */}
      <AnimatePresence>
        {resolving !== null && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-[150] flex items-center justify-center">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl p-6 flex items-center gap-3 shadow-2xl">
              <Loader2 size={20} className="animate-spin text-amber-500" />
              <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">Opening…</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* heartPop keyframes */}
      <style>{`
        @keyframes heartPop {
          0%   { opacity: 0; transform: scale(0.3); }
          30%  { opacity: 1; transform: scale(1.3); }
          60%  { opacity: 1; transform: scale(1.0); }
          100% { opacity: 0; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}

// ── Tutorial Overlay (first-login animated walkthrough) ──────────────────────
const TUTORIAL_KEY = 'ap_tutorial_v1';

function TutorialOverlay({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [dir, setDir]   = useState(1); // 1 = forward, -1 = backward

  const goTo = (next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(next);
  };

  const finish = () => {
    try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch { /**/ }
    onDone();
  };

  // ── Step illustrations ────────────────────────────────────────────────────
  const Step1 = () => (
    <div className="flex flex-col items-center gap-5">
      {/* Mini top-bar mockup */}
      <div className="w-full max-w-[260px] rounded-2xl overflow-hidden border border-zinc-700 bg-zinc-900 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800">
          <div>
            <div className="text-white text-sm font-black">My Orders</div>
            <div className="text-amber-500 text-[9px] font-black uppercase tracking-widest">Kanika Agents</div>
          </div>
          <div className="flex gap-2">
            {/* Pulsing search icon */}
            <div className="relative">
              <div className="w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/50"
                style={{ animation: 'tutorialPulse 1.4s ease-in-out infinite' }}>
                <Search size={14} className="text-white" />
              </div>
              <div className="absolute inset-0 rounded-xl bg-amber-400 opacity-40"
                style={{ animation: 'tutorialRing 1.4s ease-in-out infinite' }} />
            </div>
            <div className="w-8 h-8 rounded-xl bg-zinc-800 flex items-center justify-center">
              <RefreshCw size={13} className="text-zinc-500" />
            </div>
          </div>
        </div>
        {/* Mock order rows */}
        <div className="px-3 py-3 space-y-2">
          {['KAVYA JYOTIKA', 'KAVYA DEEPIKA'].map(name => (
            <div key={name} className="flex items-center justify-between bg-zinc-800 rounded-xl px-3 py-2">
              <div>
                <div className="text-[9px] font-black text-white">{name}</div>
                <div className="text-[8px] text-zinc-500">Bangalore · 25 May</div>
              </div>
              <div className="text-[9px] font-black text-zinc-400">100 pcs</div>
            </div>
          ))}
        </div>
      </div>
      {/* Arrow */}
      <div className="flex flex-col items-end w-full max-w-[260px] -mt-2 pr-6">
        <div className="text-amber-400 text-lg" style={{ animation: 'tutorialBounceRight 1s ease-in-out infinite' }}>↗</div>
        <div className="text-[11px] font-bold text-amber-400 text-right">Tap here</div>
      </div>
    </div>
  );

  const Step2 = () => (
    <div className="w-full max-w-[260px] rounded-2xl overflow-hidden border border-zinc-700 bg-zinc-900 shadow-xl">
      {/* Search input */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800">
        <Search size={13} className="text-amber-500 shrink-0" />
        <span className="text-sm font-medium text-white flex-1">
          test<span className="animate-pulse">|</span>
        </span>
        <X size={11} className="text-zinc-500" />
      </div>
      {/* Smart bundle */}
      <div className="p-2 space-y-2">
        <div className="flex items-center gap-1.5 px-1">
          <Sparkles size={9} className="text-amber-400" />
          <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Smart Bundles</span>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-indigo-900/40 border border-indigo-700/50">
          <Users size={9} className="text-indigo-400 shrink-0" />
          <span className="text-[10px] font-black text-indigo-300 flex-1">TEST GARMENTS</span>
          <span className="bg-indigo-600 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black">2 orders · 200 pcs</span>
          <ChevronRight size={9} className="text-indigo-400 shrink-0" />
        </div>
        {/* Orders section */}
        <div className="flex items-center gap-1.5 px-1 mt-1">
          <ClipboardList size={9} className="text-indigo-400" />
          <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Orders</span>
        </div>
        {['102 · Pending', '87 · Pending'].map(sub => (
          <div key={sub} className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-zinc-800">
            <div className="w-5 h-5 rounded-md bg-indigo-950 flex items-center justify-center shrink-0">
              <ClipboardList size={8} className="text-indigo-400" />
            </div>
            <div>
              <div className="text-[9px] font-black text-white">TEST GARMENTS</div>
              <div className="text-[8px] text-zinc-500">{sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const Step3 = () => (
    <div className="w-full max-w-[260px] rounded-2xl overflow-hidden border border-zinc-700 bg-zinc-900 shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800">
        <Search size={13} className="text-amber-500 shrink-0" />
        <span className="text-sm font-medium text-white flex-1">test</span>
        <X size={11} className="text-zinc-500" />
      </div>
      <div className="p-2 space-y-2">
        <div className="flex items-center gap-1.5 px-1">
          <Sparkles size={9} className="text-amber-400" />
          <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Smart Bundles</span>
        </div>
        {/* Expanded bundle */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-indigo-900/40 border border-indigo-700/50 ring-2 ring-indigo-500/40">
          <Users size={9} className="text-indigo-400 shrink-0" />
          <span className="text-[10px] font-black text-indigo-300 flex-1">TEST GARMENTS</span>
          <span className="bg-indigo-600 text-white text-[8px] px-1.5 py-0.5 rounded-full font-black">2 orders · 200 pcs</span>
          <ChevronRight size={9} className="text-indigo-400 rotate-90 shrink-0" />
        </div>
        {/* Pending Orders action — pulsing highlight */}
        <div className="ml-3 pl-2 border-l-2 border-zinc-700">
          <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-indigo-500 bg-indigo-900/50 w-fit"
            style={{ animation: 'tutorialPulse 1.2s ease-in-out infinite', boxShadow: '0 0 12px rgba(99,102,241,0.5)' }}>
            <ClipboardList size={9} className="text-indigo-300 shrink-0" />
            <span className="text-[10px] font-black text-indigo-300">Pending Orders</span>
          </div>
        </div>
        <div className="text-center text-[9px] text-amber-400 font-bold pt-1">↑ Tap to jump to filtered orders</div>
      </div>
    </div>
  );

  const steps = [
    {
      title: 'Use Universal Search',
      subtitle: 'Tap the 🔍 icon at the top right of any screen to open the search panel.',
      illustration: <Step1 />,
    },
    {
      title: 'Type Any Name',
      subtitle: 'Search by customer name or catalog name. Results appear instantly across orders and parties.',
      illustration: <Step2 />,
    },
    {
      title: 'Smart Bundles',
      subtitle: 'Tap a Smart Bundle card, then "Pending Orders" to jump straight to that customer\'s orders.',
      illustration: <Step3 />,
    },
  ];

  const current = steps[step];

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        className="w-full max-w-md bg-zinc-950 rounded-t-[2.5rem] border-t border-zinc-800 overflow-hidden"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-amber-500' : 'w-1.5 bg-zinc-700'}`} />
            ))}
          </div>
          <button onClick={finish} className="text-[11px] font-bold text-zinc-500 hover:text-zinc-300 px-2 py-1">
            Skip
          </button>
        </div>

        {/* Illustration */}
        <div className="px-6 py-4 flex justify-center overflow-hidden">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div key={step}
              custom={dir}
              initial={{ x: dir * 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: dir * -60, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="w-full flex justify-center"
            >
              {current.illustration}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Text */}
        <div className="px-6 pb-5">
          <AnimatePresence mode="wait">
            <motion.div key={`text-${step}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <h3 className="text-lg font-black text-white mb-1">{current.title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{current.subtitle}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="px-6 flex gap-3">
          {step > 0 && (
            <button onClick={() => goTo(step - 1)}
              className="flex-1 py-3 rounded-2xl border border-zinc-700 text-zinc-400 font-black text-sm">
              Back
            </button>
          )}
          <button
            onClick={() => step < steps.length - 1 ? goTo(step + 1) : finish()}
            className="flex-1 py-3 rounded-2xl bg-amber-500 text-white font-black text-sm shadow-lg shadow-amber-500/30">
            {step < steps.length - 1 ? 'Next →' : 'Got it!'}
          </button>
        </div>
      </motion.div>

      {/* keyframes */}
      <style>{`
        @keyframes tutorialPulse {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.08); }
        }
        @keyframes tutorialRing {
          0%   { transform: scale(1);   opacity: 0.5; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes tutorialBounceRight {
          0%, 100% { transform: translateX(0); }
          50%       { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}

// ── Orders Screen ─────────────────────────────────────────────────────────────
type OrderFilterMode = 'party' | 'catalog';

// ── GlobalSearch — universal search overlay ────────────────────────────────────
type FilterPreset = { search?: string; partyId?: string; catalogName?: string };
function GlobalSearch({
  open, onClose, query, onQueryChange,
  orders, customers, catalogs, onNavigate,
}: {
  open: boolean; onClose: () => void; query: string; onQueryChange: (q: string) => void;
  orders: Order[]; customers: Customer[]; catalogs: Catalog[];
  onNavigate: (tab: string, preset: FilterPreset) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [expandedBundle, setExpandedBundle] = React.useState<string | null>(null);

  React.useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 80); }, [open]);
  React.useEffect(() => { setExpandedBundle(null); }, [query]);
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);

  const q = query.trim().toLowerCase();

  // ── Smart Bundles ─────────────────────────────────────────────────────────────
  const bundles = React.useMemo(() => {
    if (q.length < 2) return [];
    type Bundle = { type: 'party' | 'catalog'; key: string; name: string; badge: string; color: string; icon: any; preset: FilterPreset };
    const out: Bundle[] = [];

    // Party bundles
    const matchedCustomers = customers.filter(c => c.name?.toLowerCase().includes(q)).slice(0, 3);
    matchedCustomers.forEach(c => {
      const active = orders.filter(o => o.customer_id === c.id && o.status !== 'Delivered');
      const pcs = active.reduce((s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0);
      out.push({ type: 'party', key: `party-${c.id}`, name: c.name, badge: `${active.length} orders · ${pcs} pcs`, color: 'indigo', icon: Users, preset: { partyId: String(c.id) } });
    });

    // Catalog bundles
    const matchedCatalogs = catalogs.filter(c => c.name?.toLowerCase().includes(q)).slice(0, 2);
    matchedCatalogs.forEach(cat => {
      const catOrders = orders.filter(o => o.status !== 'Delivered' && o.items.some(i => i.catalog_name?.toLowerCase() === cat.name.toLowerCase()));
      const pcs = catOrders.reduce((s, o) => s + o.items.filter(i => i.catalog_name?.toLowerCase() === cat.name.toLowerCase()).reduce((ss, i) => ss + i.quantity, 0), 0);
      if (catOrders.length > 0)
        out.push({ type: 'catalog', key: `catalog-${cat.id}`, name: cat.name, badge: `${catOrders.length} orders · ${pcs} pcs`, color: 'amber', icon: BookOpen, preset: { catalogName: cat.name } });
    });

    return out;
  }, [q, customers, catalogs, orders]);

  // ── Section results ───────────────────────────────────────────────────────────
  const sections = React.useMemo(() => {
    if (q.length < 2) return [];
    const out: Array<{ tab: string; label: string; icon: any; colorKey: string; items: Array<{ id: string | number; title: string; subtitle?: string; preset: FilterPreset }> }> = [];

    const matchedOrders = orders.filter(o =>
      o.customer_name?.toLowerCase().includes(q) || o.order_number?.toLowerCase().includes(q) ||
      o.items.some(i => (i.catalog_name || '').toLowerCase().includes(q))
    ).slice(0, 4);
    if (matchedOrders.length) out.push({
      tab: 'orders', label: 'Orders', icon: ClipboardList, colorKey: 'indigo',
      items: matchedOrders.map(o => ({ id: o.id, title: o.customer_name || `Order #${o.id}`, subtitle: `${o.order_number} · ${o.status}`, preset: { search: o.customer_name } })),
    });

    const matchedParties = customers.filter(c => c.name?.toLowerCase().includes(q) || c.city_name?.toLowerCase().includes(q)).slice(0, 4);
    if (matchedParties.length) out.push({
      tab: 'orders', label: 'Parties', icon: Users, colorKey: 'emerald',
      items: matchedParties.map(c => ({ id: c.id, title: c.name, subtitle: c.city_name, preset: { partyId: String(c.id) } })),
    });

    const matchedCatalogs = catalogs.filter(c => c.name?.toLowerCase().includes(q)).slice(0, 4);
    if (matchedCatalogs.length) out.push({
      tab: 'catalogs', label: 'Catalogs', icon: BookOpen, colorKey: 'amber',
      items: matchedCatalogs.map(c => ({ id: c.id, title: c.name, preset: {} })),
    });

    return out;
  }, [q, orders, customers, catalogs]);

  const totalCount = sections.reduce((s, sec) => s + sec.items.length, 0);

  const COLOR: Record<string, { bg: string; text: string; icon: string; chip: string; badge: string }> = {
    indigo: { bg: 'bg-indigo-50 dark:bg-indigo-950/40', text: 'text-indigo-700 dark:text-indigo-300', icon: 'text-indigo-500', chip: 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300', badge: 'bg-indigo-600' },
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', icon: 'text-emerald-500', chip: 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300', badge: 'bg-emerald-600' },
    amber:   { bg: 'bg-amber-50 dark:bg-amber-950/40',   text: 'text-amber-700 dark:text-amber-300',   icon: 'text-amber-500',   chip: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300',   badge: 'bg-amber-600'   },
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="gs-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div key="gs-panel"
            initial={{ opacity: 0, y: -16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+12px)] z-[121] rounded-3xl bg-white dark:bg-zinc-900 shadow-[0_32px_80px_-12px_rgba(0,0,0,0.45)] border border-zinc-200/80 dark:border-zinc-700/60 overflow-hidden"
            style={{ maxHeight: 'calc(100dvh - 100px)' }}>

            {/* Input */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-zinc-100 dark:border-zinc-800">
              <Search size={17} className="text-amber-500 shrink-0" />
              <input ref={inputRef} type="text" value={query} onChange={e => onQueryChange(e.target.value)}
                placeholder="Search orders, parties, catalogs…"
                className="flex-1 bg-transparent text-sm font-medium outline-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-400" />
              {query && <button onClick={() => onQueryChange('')} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 shrink-0"><X size={14} /></button>}
              <button onClick={onClose} className="text-[11px] font-bold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0">ESC</button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto overscroll-contain" style={{ maxHeight: 'calc(100dvh - 200px)' }}>
              {q.length < 2 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-zinc-400">
                  <Search size={32} strokeWidth={1.5} />
                  <div className="text-center">
                    <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">Universal Search</p>
                    <p className="text-xs mt-1">Orders · Parties · Catalogs</p>
                  </div>
                </div>
              ) : totalCount === 0 && bundles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-zinc-400">
                  <FileX size={32} strokeWidth={1.5} />
                  <div className="text-center">
                    <p className="text-sm font-semibold">No results for "{query}"</p>
                    <p className="text-xs mt-1">Try a different search term</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 space-y-3">

                  {/* Smart Bundles */}
                  {bundles.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 px-2 pb-1.5">
                        <Sparkles size={11} className="text-amber-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-amber-500">Smart Bundles</span>
                      </div>
                      <div className="flex flex-col gap-2 px-1">
                        {bundles.map(b => {
                          const c = COLOR[b.color] ?? COLOR.indigo;
                          const Icon = b.icon;
                          const isExpanded = expandedBundle === b.key;
                          return (
                            <div key={b.key}>
                              <button onClick={() => setExpandedBundle(isExpanded ? null : b.key)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all w-full ${c.chip} ${isExpanded ? 'ring-2 ring-offset-1 ring-current/30' : ''}`}>
                                <Icon size={11} className="shrink-0" />
                                <span className="max-w-[160px] truncate">{b.name}</span>
                                <span className={`${c.badge} text-white text-[9px] px-1.5 py-0.5 rounded-full font-black whitespace-nowrap`}>{b.badge}</span>
                                <ChevronRight size={11} className={`ml-auto shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                              </button>
                              {isExpanded && (
                                <div className="flex flex-wrap gap-1.5 mt-1.5 ml-3 pl-3 border-l-2 border-zinc-200 dark:border-zinc-700">
                                  <button onClick={() => { onNavigate('orders', b.preset); onClose(); }}
                                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all hover:shadow-sm bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300">
                                    <ClipboardList size={10} className="shrink-0" /> Pending Orders
                                  </button>
                                  {b.type === 'catalog' && (
                                    <button onClick={() => { onNavigate('catalogs', {}); onClose(); }}
                                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all hover:shadow-sm bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-300">
                                      <BookOpen size={10} className="shrink-0" /> View Catalog
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Section results */}
                  {sections.map(sec => {
                    const c = COLOR[sec.colorKey] ?? COLOR.indigo;
                    const Icon = sec.icon;
                    return (
                      <div key={`${sec.tab}-${sec.label}`}>
                        <div className="flex items-center gap-2 px-2 py-1 mb-0.5">
                          <Icon size={11} className={c.icon} />
                          <span className={`text-[10px] font-black uppercase tracking-widest ${c.text}`}>{sec.label}</span>
                          {sec.tab === 'orders' && <button onClick={() => { onNavigate('orders', { search: query }); onClose(); }}
                            className="ml-auto text-[10px] font-bold text-zinc-400 hover:text-amber-500 transition-colors">See all →</button>}
                        </div>
                        {sec.items.map(item => (
                          <button key={item.id} onClick={() => { onNavigate(sec.tab, item.preset); onClose(); }}
                            className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl transition-all hover:bg-zinc-50 dark:hover:bg-zinc-800 group mb-0.5">
                            <div className={`w-7 h-7 rounded-lg ${c.bg} flex items-center justify-center shrink-0`}>
                              <Icon size={13} className={c.icon} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">{item.title}</p>
                              {item.subtitle && <p className="text-[11px] text-zinc-400 truncate">{item.subtitle}</p>}
                            </div>
                            <ChevronRight size={13} className="text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500 shrink-0" />
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-2 flex items-center gap-2">
              {totalCount > 0
                ? <span className="text-[11px] text-zinc-400 font-medium">{totalCount} result{totalCount !== 1 ? 's' : ''} across {sections.length} section{sections.length !== 1 ? 's' : ''}</span>
                : <span className="text-[11px] text-zinc-400 font-medium">{bundles.length} smart bundle{bundles.length !== 1 ? 's' : ''}</span>}
              <div className="ml-auto flex items-center gap-1.5 text-[10px] text-zinc-400">
                <kbd className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded-md font-mono font-bold">ESC</kbd>
                <span>to close</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function OrdersScreen({ orders, customers, filterPreset }: {
  orders: Order[]; customers: Customer[]; filterPreset?: FilterPreset;
}) {
  const [statusTab, setStatusTab]         = useState<'pending' | 'delivered'>('pending');
  const [filterMode, setFilterMode]       = useState<OrderFilterMode>('party');
  const [filterParty, setFilterParty]     = useState('');
  const [filterCatalog, setFilterCatalog] = useState('');
  const [search, setSearch]               = useState('');

  // Apply external filter preset when it changes (from GlobalSearch)
  useEffect(() => {
    if (!filterPreset) return;
    if (filterPreset.search)      { setSearch(filterPreset.search); setFilterParty(''); setFilterCatalog(''); }
    if (filterPreset.partyId)     { setFilterParty(filterPreset.partyId); setFilterMode('party'); setSearch(''); setFilterCatalog(''); }
    if (filterPreset.catalogName) { setFilterCatalog(filterPreset.catalogName); setFilterMode('catalog'); setSearch(''); setFilterParty(''); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterPreset]);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (statusTab === 'pending'   && o.status === 'Delivered') return false;
      if (statusTab === 'delivered' && o.status !== 'Delivered') return false;
      if (search && !o.customer_name.toLowerCase().includes(search.toLowerCase()) &&
          !o.order_number.toLowerCase().includes(search.toLowerCase()) &&
          !o.items.some(i => (i.catalog_name || '').toLowerCase().includes(search.toLowerCase()))) return false;
      if (filterParty && o.customer_id !== Number(filterParty)) return false;
      if (filterCatalog) {
        if (!o.items.some(i => (i.catalog_name || '').toLowerCase() === filterCatalog.toLowerCase())) return false;
      }
      return true;
    });
  }, [orders, statusTab, search, filterParty, filterCatalog]);

  const pendingCount   = useMemo(() => orders.filter(o => o.status !== 'Delivered').length, [orders]);
  const deliveredCount = useMemo(() => orders.filter(o => o.status === 'Delivered').length, [orders]);

  // Group by party or catalog
  const grouped = useMemo(() => {
    if (filterMode === 'party') {
      const map = new Map<string, Order[]>();
      filtered.forEach(o => {
        const key = o.customer_name || 'Unknown';
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(o);
      });
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    } else {
      const map = new Map<string, Order[]>();
      filtered.forEach(o => {
        const cats = [...new Set(o.items.map(i => i.catalog_name).filter(Boolean))] as string[];
        const keys = cats.length ? cats : ['No Catalog'];
        keys.forEach(key => {
          if (!map.has(key)) map.set(key, []);
          if (!map.get(key)!.find(x => x.id === o.id)) map.get(key)!.push(o);
        });
      });
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }
  }, [filtered, filterMode]);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="p-4 space-y-3">
        {/* Status + view-mode tabs — compact single row each */}
        <div className="flex gap-1.5">
          <button onClick={() => setStatusTab('pending')}
            className={`flex-1 py-1.5 rounded-xl font-black text-xs transition-colors ${statusTab === 'pending' ? 'bg-orange-500 text-white' : 'bg-white dark:bg-zinc-900 text-zinc-500 border border-zinc-200 dark:border-zinc-700'}`}>
            Pending ({pendingCount})
          </button>
          <button onClick={() => setStatusTab('delivered')}
            className={`flex-1 py-1.5 rounded-xl font-black text-xs transition-colors ${statusTab === 'delivered' ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-zinc-900 text-zinc-500 border border-zinc-200 dark:border-zinc-700'}`}>
            Delivered ({deliveredCount})
          </button>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setFilterMode('party')}
            className={`flex-1 py-1.5 rounded-xl font-black text-xs transition-colors flex items-center justify-center gap-1 ${filterMode === 'party' ? 'bg-amber-500 text-white' : 'bg-white dark:bg-zinc-900 text-zinc-500 border border-zinc-200 dark:border-zinc-700'}`}>
            <Users size={11} /> Party-wise
          </button>
          <button onClick={() => setFilterMode('catalog')}
            className={`flex-1 py-1.5 rounded-xl font-black text-xs transition-colors flex items-center justify-center gap-1 ${filterMode === 'catalog' ? 'bg-amber-500 text-white' : 'bg-white dark:bg-zinc-900 text-zinc-500 border border-zinc-200 dark:border-zinc-700'}`}>
            <Tag size={11} /> Catalog-wise
          </button>
        </div>

        {/* Active filter chip / search hint */}
        {(filterParty || filterCatalog || search) ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
            <Search size={12} className="text-amber-500 shrink-0" />
            <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex-1 truncate">
              {filterParty
                ? `Party: ${customers.find(c => String(c.id) === filterParty)?.name || filterParty}`
                : filterCatalog
                  ? `Catalog: ${filterCatalog}`
                  : `Search: "${search}"`}
            </span>
            <button
              onClick={() => { setSearch(''); setFilterParty(''); setFilterCatalog(''); }}
              className="shrink-0 w-5 h-5 rounded-full bg-amber-200 dark:bg-amber-700 flex items-center justify-center active:scale-90 transition-transform"
            >
              <X size={10} className="text-amber-700 dark:text-amber-200" />
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-zinc-400 text-center">
            Use search bar to search order details for a customer or a catalog.
          </p>
        )}

        {/* Order groups */}
        {grouped.length === 0 ? (
          <div className="text-center text-zinc-400 py-16 text-sm">No {statusTab} orders found.</div>
        ) : grouped.map(([groupKey, groupOrders]) => (
          <div key={groupKey}>
            <div className="flex items-center gap-2 mb-2 mt-3 first:mt-0">
              {filterMode === 'party' ? <Users size={12} className="text-amber-500 shrink-0" /> : <Tag size={12} className="text-amber-500 shrink-0" />}
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest truncate">{groupKey}</span>
              <span className="text-[10px] font-black text-zinc-400 ml-auto shrink-0">{groupOrders.length} order{groupOrders.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-2">
              {groupOrders.map(o => (
                <OrderCard key={o.id} order={o} mode={filterMode} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dashboard Screen ──────────────────────────────────────────────────────────
function DashboardScreen({ session, customers, orders, catalogs, onTabChange }: {
  session: APSession; customers: Customer[]; orders: Order[];
  catalogs: Catalog[]; onTabChange: (tab: string) => void;
}) {
  const pendingOrders   = useMemo(() => orders.filter(o => o.status !== 'Delivered'), [orders]);
  const deliveredOrders = useMemo(() => orders.filter(o => o.status === 'Delivered'), [orders]);
  const totalPending    = useMemo(() => pendingOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0), [pendingOrders]);
  const totalDelivered  = useMemo(() => deliveredOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0), [deliveredOrders]);

  // Recent orders (last 5)
  const recentOrders = useMemo(() => [...orders].sort((a, b) => b.id - a.id).slice(0, 5), [orders]);

  // Top parties by pending order count
  const topParties = useMemo(() => {
    const map = new Map<string, number>();
    pendingOrders.forEach(o => map.set(o.customer_name, (map.get(o.customer_name) || 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [pendingOrders]);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="p-4 space-y-5">
        {/* Welcome */}
        <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute inset-0 opacity-10" style={{
            backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0, rgba(255,255,255,0.5) 1px, transparent 0, transparent 50%)',
            backgroundSize: '12px 12px',
          }} />
          <p className="text-white/80 text-xs font-bold uppercase tracking-widest">Welcome back</p>
          <h2 className="text-white text-2xl font-black mt-0.5">{session.name}</h2>
          <p className="text-white/70 text-xs mt-1 font-medium">
            {session.role}{session.agentPermissionName ? ` · ${session.agentPermissionName}` : ''}
          </p>
        </div>

        {/* Stats row 1 */}
        <div className="flex gap-3">
          <StatCard label="My Parties"    value={customers.length}        icon={Users}   color="bg-indigo-500"  onClick={() => onTabChange('orders')} />
          <StatCard label="Pending Orders" value={pendingOrders.length}   icon={Clock}   color="bg-orange-500"  onClick={() => onTabChange('orders')} />
        </div>
        {/* Stats row 2 */}
        <div className="flex gap-3">
          <StatCard label="Pending Pcs"   value={totalPending.toLocaleString('en-IN')} icon={Package}  color="bg-amber-500"    />
          <StatCard label="Delivered Pcs" value={totalDelivered.toLocaleString('en-IN')} icon={Truck}    color="bg-emerald-500" onClick={() => onTabChange('orders')} />
        </div>
        <div className="flex gap-3">
          <StatCard label="Catalogs"      value={catalogs.length}         icon={BookOpen} color="bg-violet-500"  onClick={() => onTabChange('catalogs')} />
          <StatCard label="Total Orders"  value={orders.length}           icon={ClipboardList} color="bg-blue-500"   onClick={() => onTabChange('orders')} />
        </div>

        {/* Top pending parties */}
        {topParties.length > 0 && (
          <div>
            <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3">Parties with Most Pending</p>
            <div className="space-y-2">
              {topParties.map(([name, count]) => (
                <div key={name} className="flex items-center justify-between bg-white dark:bg-zinc-900 rounded-xl border border-zinc-100 dark:border-zinc-800 px-4 py-3">
                  <p className="font-black text-sm text-zinc-900 dark:text-zinc-100 truncate">{name}</p>
                  <span className="text-xs font-black text-orange-600 bg-orange-50 dark:bg-orange-900/20 px-2 py-0.5 rounded-full shrink-0 ml-2">{count} pending</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent orders */}
        {recentOrders.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Recent Orders</p>
              <button onClick={() => onTabChange('orders')} className="text-[10px] font-black text-amber-500 uppercase tracking-widest">See All →</button>
            </div>
            <div className="space-y-2">
              {recentOrders.map(o => <OrderCard key={o.id} order={o} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Profile Screen ────────────────────────────────────────────────────────────
function ProfileScreen({ session, onLogout, showToast }: {
  session: APSession; onLogout: () => void;
  showToast: (m: string, t: 'error' | 'success' | 'info') => void;
}) {
  const [showChangePinForm, setShowChangePinForm] = useState(false);
  const [newPin, setNewPin]         = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading]       = useState(false);

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin.length < 4) { showToast('PIN must be at least 4 characters.', 'error'); return; }
    if (newPin !== confirmPin) { showToast('PINs do not match.', 'error'); return; }
    setLoading(true);
    const { error } = await apChangePin(session.email, newPin, session.accessToken);
    setLoading(false);
    if (error) { showToast(error, 'error'); return; }
    showToast('PIN changed successfully!', 'success');
    setShowChangePinForm(false); setNewPin(''); setConfirmPin('');
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
      {/* Agent card */}
      <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-5 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0, rgba(255,255,255,0.5) 1px, transparent 0, transparent 50%)',
          backgroundSize: '12px 12px',
        }} />
        <div className="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center mb-3">
          <User size={28} className="text-white" />
        </div>
        <h2 className="text-white text-xl font-black">{session.name}</h2>
        <p className="text-white/80 text-xs font-bold mt-0.5">{session.email}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          <span className="px-3 py-1 bg-white/20 rounded-full text-white text-[10px] font-black uppercase tracking-widest">{session.role}</span>
          {session.agentPermissionName && (
            <span className="px-3 py-1 bg-white/30 rounded-full text-white text-[10px] font-black uppercase tracking-widest">
              🏢 {session.agentPermissionName}
            </span>
          )}
        </div>
      </div>

      {/* Change PIN */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm overflow-hidden">
        <button onClick={() => setShowChangePinForm(v => !v)}
          className="w-full flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <Lock size={16} className="text-zinc-500" />
            </div>
            <span className="font-black text-sm text-zinc-900 dark:text-zinc-100">Change PIN</span>
          </div>
          <ChevronRight size={16} className={`text-zinc-300 transition-transform ${showChangePinForm ? 'rotate-90' : ''}`} />
        </button>
        <AnimatePresence>
          {showChangePinForm && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
              <form onSubmit={handleChangePin} className="px-4 pb-4 space-y-3 border-t border-zinc-100 dark:border-zinc-800 pt-3">
                {[{ label: 'New PIN', val: newPin, set: setNewPin }, { label: 'Confirm PIN', val: confirmPin, set: setConfirmPin }].map(({ label, val, set }) => (
                  <div key={label}>
                    <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest pl-1">{label}</label>
                    <input type="password" value={val} onChange={e => set(e.target.value)} placeholder="Min 4 characters"
                      className="w-full px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 font-medium text-sm mt-1 text-zinc-900 dark:text-zinc-100" />
                  </div>
                ))}
                <button type="submit" disabled={loading}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-xl disabled:opacity-60 flex items-center justify-center gap-2">
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Key size={16} />}
                  {loading ? 'Saving…' : 'Save New PIN'}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* App info */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm p-4 space-y-1">
        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">App Info</p>
        <p className="text-xs font-bold text-zinc-600 dark:text-zinc-400">Kanika × S.I.M. Agents</p>
        <p className="text-xs text-zinc-400">Version 1.0.0</p>
        <p className="text-xs text-zinc-400">Smart Inventory Manager — Agent Portal</p>
      </div>

      {/* Logout */}
      <button onClick={onLogout}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-red-50 dark:bg-red-900/20 text-red-600 font-black text-sm border border-red-100 dark:border-red-900/30 active:scale-95 transition-transform">
        <LogOut size={18} />
        Sign Out
      </button>
    </div>
  );
}

// ── Bottom Navigation ─────────────────────────────────────────────────────────
const NAV_TABS = [
  { id: 'home',     label: 'Home',     icon: Home          },
  { id: 'orders',   label: 'Orders',   icon: ClipboardList },
  { id: 'catalogs', label: 'Catalogs', icon: BookOpen      },
  { id: 'profile',  label: 'Profile',  icon: User          },
];

function BottomNav({ active, onChange, pendingCount }: {
  active: string; onChange: (t: string) => void; pendingCount: number;
}) {
  return (
    <div className="shrink-0 bg-white dark:bg-zinc-900 border-t border-zinc-100 dark:border-zinc-800"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}>
      <div className="flex">
        {NAV_TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => onChange(id)}
            className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors relative ${active === id ? 'text-amber-500' : 'text-zinc-400'}`}>
            <div className="relative">
              <Icon size={22} strokeWidth={active === id ? 2.5 : 1.8} />
              {id === 'orders' && pendingCount > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-0.5">
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
            </div>
            <span className="text-[10px] font-black uppercase tracking-wide">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession]           = useState<APSession | null>(null);
  const [showChangePinScreen, setShowChangePinScreen] = useState(false);
  const [activeTab, setActiveTab]       = useState('home');
  const [toast, setToast]               = useState<{ msg: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [dark]                          = useDarkMode();
  void dark;

  // Data state
  const [customers, setCustomers]               = useState<Customer[]>([]);
  const [orders, setOrders]                     = useState<Order[]>([]);
  const [catalogs, setCatalogs]                 = useState<Catalog[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<CatalogCategory[]>([]);
  const [volumes, setVolumes]                   = useState<Volume[]>([]);
  const [likes, setLikes]                       = useState<LikeData>({ counts: {}, likedByMe: new Set() });
  const [loading, setLoading]                   = useState(false);
  const [loadError, setLoadError]               = useState('');
  const [agentId, setAgentId]                   = useState<number | null>(null);
  const pendingLikes              = useRef<Set<number>>(new Set());

  // Tutorial state — show once after first login
  const [showTutorial, setShowTutorial] = useState(false);

  // Global search state
  const [gsOpen, setGsOpen]             = useState(false);
  const [gsQuery, setGsQuery]           = useState('');
  const [orderPreset, setOrderPreset]   = useState<FilterPreset | undefined>(undefined);

  const showToast = useCallback((msg: string, type: 'error' | 'success' | 'info') => {
    setToast({ msg, type });
  }, []);

  // ── Session restore on load ───────────────────────────────────────────────
  useEffect(() => {
    const saved = loadSession();
    if (!saved) return;
    // Show tutorial if not yet seen (covers fresh installs with cached session)
    try { if (!localStorage.getItem(TUTORIAL_KEY)) setShowTutorial(true); } catch { /**/ }
    // Check expiry locally first — no network call for a valid unexpired JWT
    if (!jwtIsExpired(saved.accessToken)) { setSession(saved); return; }
    // Expired — try to silently refresh before showing login
    if (saved.refreshToken) {
      apRefreshToken(saved.refreshToken).then(({ accessToken, refreshToken, error }) => {
        if (!error && accessToken) {
          const updated = { ...saved, accessToken, refreshToken: refreshToken || saved.refreshToken };
          saveSession(updated);
          setSession(updated);
        } else {
          clearSession();
        }
      });
    } else {
      clearSession();
    }
  }, []);

  // ── Periodic token refresh (every 4 min) ─────────────────────────────────
  // On app start we already checked expiry above; this handles long sessions
  // where the token expires while the app is open.
  useEffect(() => {
    if (!session) return;
    const iv = setInterval(() => {
      if (!jwtIsExpired(session.accessToken)) return;
      if (!session.refreshToken) { handleLogout(); return; }
      apRefreshToken(session.refreshToken).then(({ accessToken, refreshToken, error }) => {
        if (error || !accessToken) { handleLogout(); return; }
        const updated = { ...session, accessToken: accessToken!, refreshToken: refreshToken || session.refreshToken };
        setSession(updated);
        saveSession(updated);
        updateRealtimeToken(updated.accessToken);
      });
    }, 4 * 60 * 1000); // 4 minutes
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.email, session?.accessToken]);

  // ── Visibility-change reload ──────────────────────────────────────────────
  // Re-fetch all data when the user switches back to the app tab / foreground.
  useEffect(() => {
    if (!session) return;
    const onVisible = () => {
      if (!document.hidden) loadAllData(session);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.email, session?.accessToken]);

  // ── Realtime sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    // Debounce rapid realtime events (150 ms) so we don't hammer the API
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const onChanged = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { loadAllData(session); }, 150);
    };
    const onRevoked = () => {
      showToast('Your session has been revoked by an administrator.', 'error');
      handleLogout();
    };
    const stop = startRealtimeSync(onChanged, session.accessToken, session.email, onRevoked);
    return () => { stop(); if (debounceTimer) clearTimeout(debounceTimer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.email, session?.accessToken]);

  // ── Load data when session is ready ──────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    loadAllData(session);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.email]);

  const loadAllData = async (sess: APSession) => {
    setLoading(true);
    setLoadError('');
    try {
      // If Owner/Admin, show everything regardless of agent mapping
      const isAdmin = ['Owner', 'Admin', 'LazyAdmin'].includes(sess.role);

      // ── Resolve agentPermissionName ───────────────────────────────────────────
      // login_with_pin now returns permissions inline, but cached sessions
      // (saved before that fix) may not have agentPermissionName.
      // Fall back to the ap_get_agent_name SECURITY DEFINER RPC.
      let permName = sess.agentPermissionName;
      if (!permName && !isAdmin) {
        permName = await fetchAgentNameFromDb(sess.email, sess.accessToken) || undefined;
        if (permName) {
          // Persist so subsequent loads skip the RPC call
          const updated = { ...sess, agentPermissionName: permName };
          saveSession(updated);
          setSession(updated);
        }
      }

      // ── Resolve agentId ───────────────────────────────────────────────────────
      // Priority: cached agentId → look up by permName → look up by display name
      let resolvedAgentId = sess.agentId || null;
      if (!resolvedAgentId && !isAdmin) {
        const lookupName = permName || sess.name;
        resolvedAgentId = await fetchAgentId(lookupName, sess.accessToken);
        if (resolvedAgentId) {
          const updated = { ...sess, agentId: resolvedAgentId, agentPermissionName: permName };
          saveSession(updated);
          setSession(updated);
        }
      }
      setAgentId(resolvedAgentId);

      // ── Fetch everything in parallel ──────────────────────────────────────────
      // Orders filter directly by orders.agent_id — no customer lookup needed.
      // For agents: "My Parties" is derived from order customer data (customers.agent_id
      // is not populated in the DB so a direct query always returns 0).
      // For admin/owner: fetch all customers separately.
      const orderAgentId = isAdmin ? null : resolvedAgentId;
      const [adminCustomers, rawOrders, cats, vols, lks] = await Promise.all([
        isAdmin
          ? fetchMyCustomers(-1, sess.accessToken).catch(() => [] as Customer[])
          : Promise.resolve([] as Customer[]),
        fetchOrdersByAgent(orderAgentId, sess.accessToken),
        fetchCatalogs(sess.accessToken),
        fetchVolumes(sess.accessToken),
        fetchLikes(sess.email, sess.accessToken),
      ]);

      // Derive unique customers from order data for agents
      // (avoids the customers.agent_id = NULL problem)
      let resolvedCustomers: Customer[];
      if (isAdmin) {
        resolvedCustomers = adminCustomers;
      } else {
        const customerMap = new Map<number, Customer>();
        rawOrders.forEach(o => {
          if (o.customer_id && !customerMap.has(o.customer_id)) {
            customerMap.set(o.customer_id, { id: o.customer_id, name: o.customer_name, city_name: o.city_name });
          }
        });
        resolvedCustomers = [...customerMap.values()].sort((a, b) => a.name.localeCompare(b.name));
      }
      setCustomers(resolvedCustomers);
      setCatalogs(cats);
      setVolumes(vols);
      setLikes(lks);

      // Derive unique catalog categories from the fetched catalog rows
      const seenCatIds = new Set<number>();
      const uniqueCategories: CatalogCategory[] = [];
      cats.forEach(c => {
        if (c.category_id && !seenCatIds.has(c.category_id)) {
          seenCatIds.add(c.category_id);
          uniqueCategories.push({ id: c.category_id, name: c.category_name || `Category ${c.category_id}` });
        }
      });
      uniqueCategories.sort((a, b) => a.name.localeCompare(b.name));
      setCatalogCategories(uniqueCategories);

      // Enrich orders with volume/catalog names
      const enriched = await enrichWithVolumes(rawOrders, sess.accessToken);
      setOrders(enriched);

      // Batch-sign all catalog cover images so Android WebView doesn't hit its
      // connection-concurrency limit loading 9+ thumbnails simultaneously.
      if (cats.length > 0) {
        const coverUrls = cats.map(c => c.cover_photo).filter(Boolean) as string[];
        preBatchSignUrls(coverUrls, sess.accessToken).catch(() => {});
      }
    } catch (e: any) {
      setLoadError(e?.message || 'Failed to load data. Pull down to retry.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (sess: APSession) => {
    setSession(sess);
    if (sess.isFirstLogin) { setShowChangePinScreen(true); return; }
    // Show tutorial once per device
    try {
      if (!localStorage.getItem(TUTORIAL_KEY)) setShowTutorial(true);
    } catch { /**/ }
  };

  const handleLogout = () => {
    stopRealtimeSync();
    clearSession();
    setSession(null);
    setCustomers([]); setOrders([]); setCatalogs([]); setCatalogCategories([]); setVolumes([]);
    setLikes({ counts: {}, likedByMe: new Set() });
    setActiveTab('home');
  };

  const handleLike = useCallback(async (catalogId: number) => {
    if (!session) return;
    if (pendingLikes.current.has(catalogId)) return;
    pendingLikes.current.add(catalogId);
    const wasLiked = likes.likedByMe.has(catalogId);
    // Optimistic update
    setLikes(prev => {
      const newLiked  = new Set(prev.likedByMe);
      const newCounts = { ...prev.counts };
      if (wasLiked) { newLiked.delete(catalogId); newCounts[catalogId] = Math.max(0, (newCounts[catalogId] || 1) - 1); }
      else          { newLiked.add(catalogId);    newCounts[catalogId] = (newCounts[catalogId] || 0) + 1; }
      return { counts: newCounts, likedByMe: newLiked };
    });
    try {
      const { liked, count, error } = await toggleLike(catalogId, session.email, session.accessToken);
      if (error) {
        // Revert
        setLikes(prev => {
          const newLiked  = new Set(prev.likedByMe);
          const newCounts = { ...prev.counts };
          if (!wasLiked) { newLiked.delete(catalogId); newCounts[catalogId] = Math.max(0, (newCounts[catalogId] || 1) - 1); }
          else           { newLiked.add(catalogId);    newCounts[catalogId] = (newCounts[catalogId] || 0) + 1; }
          return { counts: newCounts, likedByMe: newLiked };
        });
        return;
      }
      if (liked === null) return; // Android WebView empty body — keep optimistic
      setLikes(prev => {
        const newLiked  = new Set(prev.likedByMe);
        const newCounts = { ...prev.counts, [catalogId]: count };
        if (liked) newLiked.add(catalogId); else newLiked.delete(catalogId);
        return { counts: newCounts, likedByMe: newLiked };
      });
    } finally {
      pendingLikes.current.delete(catalogId);
    }
  }, [session, likes.likedByMe]);

  const pendingCount = useMemo(() => orders.filter(o => o.status !== 'Delivered').length, [orders]);

  if (!session) return (
    <>
      <AnimatePresence>
        {toast && <Toast key="t" msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </AnimatePresence>
      <LoginScreen onSuccess={handleLogin} showToast={showToast} />
    </>
  );

  if (showChangePinScreen) return (
    <>
      <AnimatePresence>
        {toast && <Toast key="t" msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </AnimatePresence>
      <ChangePinScreen session={session} onSuccess={() => setShowChangePinScreen(false)} showToast={showToast} />
    </>
  );

  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 select-none">
      {/* Toast */}
      <AnimatePresence>
        {toast && <Toast key="t" msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </AnimatePresence>

      {/* Top bar */}
      <div className="shrink-0 bg-white dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800 px-4 flex items-center justify-between"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)', paddingBottom: '12px' }}>
        <div>
          <h1 className="text-lg font-black text-zinc-900 dark:text-zinc-100 leading-tight">
            {activeTab === 'home'     && 'Dashboard'}
            {activeTab === 'orders'   && 'My Orders'}
            {activeTab === 'catalogs' && 'Catalogs'}
            {activeTab === 'profile'  && 'Profile'}
          </h1>
          <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest leading-none">Kanika Agents</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setGsOpen(true); setGsQuery(''); }}
            className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
            <Search size={15} />
          </button>
          <button onClick={() => session && loadAllData(session)} disabled={loading}
            className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 disabled:opacity-40">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Loading overlay */}
      {loading && orders.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center">
            <Loader2 size={24} className="text-amber-500 animate-spin" />
          </div>
          <p className="text-sm font-bold text-zinc-500">Loading your data…</p>
        </div>
      )}

      {/* Error state */}
      {loadError && !loading && (
        <div className="mx-4 mt-4 p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-2xl flex items-center gap-3">
          <AlertCircle size={18} className="text-red-500 shrink-0" />
          <p className="text-xs font-bold text-red-600 flex-1">{loadError}</p>
          <button onClick={() => session && loadAllData(session)} className="text-xs font-black text-red-600 underline shrink-0">Retry</button>
        </div>
      )}

      {/* Content — all screens stay mounted; CSS show/hide avoids remount cost */}
      {(!loading || orders.length > 0) && (
        <>
          <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${activeTab === 'home' ? '' : 'hidden'}`}>
            <DashboardScreen session={session} customers={customers} orders={orders} catalogs={catalogs} onTabChange={setActiveTab} />
          </div>
          <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${activeTab === 'orders' ? '' : 'hidden'}`}>
            <OrdersScreen orders={orders} customers={customers} filterPreset={orderPreset} />
          </div>
          <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${activeTab === 'catalogs' ? '' : 'hidden'}`}>
            <CatalogScreen catalogs={catalogs} volumes={volumes} token={session.accessToken} likes={likes} onLike={handleLike} categories={catalogCategories} />
          </div>
          <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${activeTab === 'profile' ? '' : 'hidden'}`}>
            <ProfileScreen session={session} onLogout={handleLogout} showToast={showToast} />
          </div>
        </>
      )}

      {/* Bottom nav */}
      <BottomNav active={activeTab} onChange={setActiveTab} pendingCount={pendingCount} />

      {/* Tutorial overlay — shown once on first login */}
      <AnimatePresence>
        {showTutorial && <TutorialOverlay onDone={() => setShowTutorial(false)} />}
      </AnimatePresence>

      {/* Global Search overlay */}
      <GlobalSearch
        open={gsOpen}
        onClose={() => setGsOpen(false)}
        query={gsQuery}
        onQueryChange={setGsQuery}
        orders={orders}
        customers={customers}
        catalogs={catalogs}
        onNavigate={(tab, preset) => {
          setGsOpen(false);
          setGsQuery('');
          setActiveTab(tab);
          if (tab === 'orders') {
            // Use a fresh object reference each time so useEffect in OrdersScreen fires
            setOrderPreset({ ...preset });
          }
        }}
      />
    </div>
  );
}
