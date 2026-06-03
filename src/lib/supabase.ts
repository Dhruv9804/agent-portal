// ── Supabase connection (hardcoded — same project as main app) ─────────────────
export const SUPABASE_URL = 'https://nmjhacobtvvuoxlnydoy.supabase.co';
export const PROXY_URL    = 'https://supabase-proxy.dhruv-chopra92.workers.dev';
export const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tamhhY29idHZ2dW94bG55ZG95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMTU5MzYsImV4cCI6MjA5MzY5MTkzNn0.uYX0iSBWNg4elwNUtPdag8duHpXsYQlr3e00D4Lj7oI';

// ── Android secure storage (same pattern as catalog-viewer) ───────────────────
function androidStorage(): { get: (k: string) => string | null; set: (k: string, v: string) => void; remove: (k: string) => void } | null {
  try {
    if ((window as any).Capacitor?.isNativePlatform?.()) {
      const store: Record<string, string> = JSON.parse(localStorage.getItem('ap_native_store') || '{}');
      return {
        get:    (k) => store[k] ?? null,
        set:    (k, v) => { store[k] = v; localStorage.setItem('ap_native_store', JSON.stringify(store)); },
        remove: (k) => { delete store[k]; localStorage.setItem('ap_native_store', JSON.stringify(store)); },
      };
    }
  } catch { /* ignore */ }
  return null;
}

function getStore() {
  const n = androidStorage();
  return {
    get:    (k: string) => (n ? n.get(k) : null) ?? localStorage.getItem(k),
    set:    (k: string, v: string) => { n?.set(k, v); try { localStorage.setItem(k, v); } catch { /**/ } },
    remove: (k: string) => { n?.remove(k); try { localStorage.removeItem(k); } catch { /**/ } },
  };
}

const store = getStore();
const SESSION_KEY = 'ap_session';

// ── Session types ──────────────────────────────────────────────────────────────
export interface APSession {
  email:        string;
  accessToken:  string;
  refreshToken: string;
  name:         string;
  role:         string;
  agentId?:     number;
  // Name from app_user_permissions where type='agent' — used to look up agents table
  agentPermissionName?: string;
  isFirstLogin: boolean;
}

export function saveSession(s: APSession) {
  store.set(SESSION_KEY, JSON.stringify(s));
}
export function loadSession(): APSession | null {
  try { const raw = store.get(SESSION_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function clearSession() { store.remove(SESSION_KEY); }

// ── Device ID ─────────────────────────────────────────────────────────────────
export function getDeviceId(): string {
  const k = 'ap_device_id';
  let id = store.get(k);
  if (!id) {
    id = crypto.randomUUID();
    store.set(k, id);
  }
  return id;
}

// ── JWT helpers ───────────────────────────────────────────────────────────────
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(part.length + (4 - part.length % 4) % 4, '=');
    return JSON.parse(atob(b64));
  } catch { return null; }
}
export function jwtIsExpired(token: string): boolean {
  if (!token) return true;
  const p = decodeJwtPayload(token);
  if (!p?.exp) return true;
  return p.exp * 1000 < Date.now() + 60_000;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
function baseHeaders(token?: string): Record<string, string> {
  return {
    'apikey':        ANON_KEY,
    'Authorization': `Bearer ${token || ANON_KEY}`,
    'Content-Type':  'application/json',
  };
}

// Tracks which base URL is currently working. Start with the Cloudflare proxy (reliable on
// networks that block direct AWS IPs, e.g. Jio); direct Supabase is the fallback. apFetch flips
// to whichever actually responds.
let _activeBase = PROXY_URL;

async function apFetch(path: string, opts: RequestInit = {}, timeout = 15000, token?: string): Promise<Response> {
  const hdrs = { ...baseHeaders(token), ...(opts.headers as Record<string, string> || {}) };

  // Try whichever base URL last succeeded
  const primaryBase = _activeBase;
  const ac1 = new AbortController();
  const t1  = setTimeout(() => ac1.abort(), timeout);
  try {
    const res = await window.fetch(`${primaryBase}${path}`, { ...opts, headers: hdrs, signal: ac1.signal });
    clearTimeout(t1);
    return res;
  } catch (e) {
    clearTimeout(t1);
    const isNetwork = e instanceof TypeError;
    const isAbort   = e instanceof DOMException && (e as DOMException).name === 'AbortError';
    // Only fall back on network / timeout failures — propagate other errors immediately
    if (!isNetwork && !isAbort) throw e;
  }

  // Fallback: try the other base URL
  const fallbackBase = primaryBase === PROXY_URL ? SUPABASE_URL : PROXY_URL;
  const ac2 = new AbortController();
  const t2  = setTimeout(() => ac2.abort(), timeout);
  try {
    const res = await window.fetch(`${fallbackBase}${path}`, { ...opts, headers: hdrs, signal: ac2.signal });
    clearTimeout(t2);
    // Remember what worked so the next call skips the failing base
    if (res.ok) _activeBase = fallbackBase;
    return res;
  } catch (e) {
    clearTimeout(t2);
    throw e;
  }
}

// ── Edge Function warm-up ─────────────────────────────────────────────────────
export function warmUpEdgeFunction() {
  window.fetch(`${PROXY_URL}/functions/v1/ensure-user-session`, {
    method: 'OPTIONS', headers: { 'apikey': ANON_KEY },
  }).catch(() => {});
}

// ── Token refresh ─────────────────────────────────────────────────────────────
export async function apRefreshToken(refreshToken: string): Promise<{ accessToken?: string; refreshToken?: string; error?: string }> {
  try {
    const r = await apFetch(`/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    }, 15000);
    if (!r.ok) return { error: 'Session expired. Please log in again.' };
    const d = await r.json();
    return { accessToken: d.access_token, refreshToken: d.refresh_token || refreshToken };
  } catch { return { error: 'Network error during token refresh.' }; }
}

// ── Sign-up (agent request) ───────────────────────────────────────────────────
export async function submitAgentRequest(
  agencyName: string, applicantName: string, phone: string, email: string
): Promise<{ error?: string }> {
  try {
    const res = await apFetch('/rest/v1/cv_agent_requests', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        agency_name:    agencyName.trim(),
        applicant_name: applicantName.trim(),
        phone:          phone.replace(/\D/g, '').trim(),
        email:          email.trim().toLowerCase(),
        status:         'pending',
      }),
    }, 15000);
    if (res.ok || res.status === 201) return {};
    const d = await res.json().catch(() => ({}));
    return { error: d.message || d.error || `Server error (${res.status})` };
  } catch (e: any) { return { error: e?.message || 'Network error. Please try again.' }; }
}

// ── Login ─────────────────────────────────────────────────────────────────────
const ALLOWED_ROLES = ['Agent', 'Owner', 'Admin', 'LazyAdmin'];

export async function apLogin(email: string, pin: string): Promise<{
  session?: APSession; error?: string;
  deviceLimitReached?: boolean; limitEmail?: string;
}> {
  const cleanEmail = email.trim().toLowerCase();
  const deviceId   = getDeviceId();

  // Step 1: Verify PIN
  let rpcRes: Response | null = null;
  try {
    const ac = new AbortController();
    const t  = setTimeout(() => ac.abort(), 12000);
    rpcRes = await window.fetch(`${PROXY_URL}/rest/v1/rpc/login_with_pin`, {
      method: 'POST', headers: baseHeaders(),
      body: JSON.stringify({ p_email: cleanEmail, p_pin: pin.trim() }),
      signal: ac.signal,
    });
    clearTimeout(t);
  } catch { /* try direct */ }

  if (!rpcRes) {
    try {
      const ac = new AbortController();
      const t  = setTimeout(() => ac.abort(), 12000);
      rpcRes = await window.fetch(`${SUPABASE_URL}/rest/v1/rpc/login_with_pin`, {
        method: 'POST', headers: baseHeaders(),
        body: JSON.stringify({ p_email: cleanEmail, p_pin: pin.trim() }),
        signal: ac.signal,
      });
      clearTimeout(t);
    } catch { /**/ }
  }

  if (!rpcRes) return { error: 'Server unavailable. Check your connection.' };
  if (!rpcRes.ok) {
    const d = await rpcRes.json().catch(() => ({}));
    return { error: d.error || 'Invalid email or PIN.' };
  }

  const user = await rpcRes.json().catch(() => null);
  if (!user?.email) return { error: user?.error || 'Invalid email or PIN.' };

  // Role check — only agents, owner, admin
  if (!ALLOWED_ROLES.includes(user.role)) {
    return { error: `Access denied. This app is for agents only. Your role: ${user.role}` };
  }

  const authToken: string | undefined = user.auth_token;
  if (!authToken) return { error: 'Could not establish session. Please try again.' };
  delete user.auth_token;

  const flagKey = `ap_gotrue_${cleanEmail}`;
  const gotrueFlagSet = store.get(flagKey);

  // JWT acquisition (fast: GoTrue direct, slow: ensure-user-session)
  // Fast path: GoTrue password login (works instantly when GoTrue account exists)
  const getJwtFast = async () => {
    try {
      const ac = new AbortController();
      const t  = setTimeout(() => ac.abort(), 10000);
      const r = await window.fetch(`${PROXY_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: baseHeaders(),
        body: JSON.stringify({ email: cleanEmail, password: `${authToken}_ssp` }),
        signal: ac.signal,
      });
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json();
        if (d.access_token) {
          store.set(flagKey, '1'); // GoTrue account confirmed — skip slow path next time
          return { access: d.access_token, refresh: d.refresh_token || '' };
        }
      }
      if ([400, 401, 422].includes(r.status)) { store.remove(flagKey); }
    } catch { /* fall through */ }
    return null;
  };

  // Slow path: Edge Function provisions GoTrue account on first login, then returns JWT
  const getJwtSlow = async (timeoutMs = 35000) => {
    try {
      const ac = new AbortController();
      const t  = setTimeout(() => ac.abort(), timeoutMs);
      const r = await window.fetch(`${PROXY_URL}/functions/v1/ensure-user-session`, {
        method: 'POST', headers: baseHeaders(),
        body: JSON.stringify({ email: cleanEmail, pin: authToken }),
        signal: ac.signal,
      });
      clearTimeout(t);
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        if (d.access_token) {
          store.set(flagKey, '1');
          return { access: d.access_token, refresh: d.refresh_token || '' };
        }
      }
    } catch { /* fall through */ }
    return null;
  };

  // Resolve to the first promise that yields a non-null token; null if all do.
  const firstValid = (promises: Promise<{ access: string; refresh: string } | null>[]) =>
    new Promise<{ access: string; refresh: string } | null>(resolve => {
      let remaining = promises.length, done = false;
      promises.forEach(p => p.then(v => {
        if (done) return;
        if (v) { done = true; resolve(v); }
        else if (--remaining === 0) resolve(null);
      }).catch(() => { if (!done && --remaining === 0) resolve(null); }));
    });

  // Bounded parallel race: fire fast path; if no valid token in 600ms, start the slow
  // edge-function path in parallel and take whichever returns first. Repeat logins win on
  // fast (~200ms) and never fire slow — saves an Edge Function call per login. First login
  // (no GoTrue account yet): fast 400s quickly → slow provisions the account then returns.
  const getJwtRaced = (): Promise<{ access: string; refresh: string } | null> => (async () => {
    const fast = getJwtFast();
    const raced = await Promise.race([
      fast,
      new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 600)),
    ]);
    if (raced && raced !== 'timeout') return raced;
    return firstValid([fast, getJwtSlow()]);
  })();

  // Device check for agents (5-device limit)
  const devicePromise = user.role === 'Agent'
    ? apFetch(`/rest/v1/rpc/cv_check_agent_device`, {
        method: 'POST',
        body: JSON.stringify({ p_email: cleanEmail, p_device_id: deviceId }),
      }, 10000)
    : Promise.resolve(new Response('{}', { status: 200 }));

  // Run device check and JWT race in parallel
  const jwtPromise = getJwtRaced().then(r => r ?? getJwtSlow(40000)); // one retry with longer timeout if race fails

  let deviceRes: Response;
  let jwtResult: { access: string; refresh: string } | null;
  try {
    [deviceRes, jwtResult] = await Promise.all([devicePromise, jwtPromise]);
  } catch {
    return { error: 'Network error. Check your connection and try again.' };
  }

  if (user.role === 'Agent') {
    const deviceData = await deviceRes.json().catch(() => ({}));
    if (!deviceRes.ok || deviceData?.error) {
      return {
        error: deviceData?.error || 'Device limit reached. Your agent account supports a maximum of 5 devices.',
        deviceLimitReached: true,
        limitEmail: cleanEmail,
      };
    }
  }

  if (!jwtResult?.access) return { error: 'Could not establish session. Please try again.' };

  // login_with_pin is SECURITY DEFINER and already returns the full
  // app_user_permissions array as `permissions: [{type,value,...}]`.
  // Read directly — no extra network call, no RLS exposure.
  const permsFromLogin: { type: string; value: string }[] =
    Array.isArray(user.permissions) ? user.permissions : [];
  const agentPerm = permsFromLogin.find(p => p.type === 'agent');

  const session: APSession = {
    email:               cleanEmail,
    accessToken:         jwtResult.access,
    refreshToken:        jwtResult.refresh,
    name:                user.name || cleanEmail,
    role:                user.role,
    isFirstLogin:        !!user.is_first_login,
    agentPermissionName: agentPerm?.value ?? undefined,
  };
  saveSession(session);
  return { session };
}

// ── Change PIN ────────────────────────────────────────────────────────────────
export async function apChangePin(email: string, newPin: string, accessToken: string): Promise<{ error?: string }> {
  const res = await apFetch('/rest/v1/rpc/update_my_pin', {
    method: 'POST',
    body: JSON.stringify({ p_email: email, p_pin: newPin }),
  }, 20000, accessToken);
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d?.error) return { error: d.error || 'Failed to change PIN.' };
  return {};
}

// ── Data types ────────────────────────────────────────────────────────────────
export interface Agent    { id: number; name: string; }
export interface Customer { id: number; name: string; city_name: string; }
export interface OrderItem { id: number; volume_id: number; size: string; quantity: number; rate: number; amount: number; volume_name?: string; catalog_name?: string; }
export interface Order {
  id: number; order_number: string; customer_id: number; customer_name: string;
  city_name: string; status: string; created_at: string; remarks: string;
  items: OrderItem[]; total_amount: number;
}
export interface Challan {
  id: number; challan_number: string; order_id: number; customer_id: number;
  customer_name: string; created_at: string; bale_number: string;
}
export interface CatalogCategory { id: number; name: string; }
export interface Catalog  { id: number; name: string; cover_photo?: string; thumbnail?: string; is_active: number; is_pinned?: boolean; category_id?: number; category_name?: string; }
export interface LikeData { counts: Record<number, number>; likedByMe: Set<number>; }
export interface Volume   { id: number; catalog_id: number; volume_name: string; pdf_url?: string; video_url?: string; catalogs?: { name: string }; }

// ── Resolve agent name from DB (SECURITY DEFINER RPC — bypasses RLS) ──────────
// Call this when the session was cached before agentPermissionName was stored.
// SQL to create this function is in the session notes.
export async function fetchAgentNameFromDb(email: string, token: string): Promise<string | null> {
  try {
    const res = await apFetch('/rest/v1/rpc/ap_get_agent_name', {
      method: 'POST',
      body: JSON.stringify({ p_email: email }),
    }, 10000, token);
    if (!res.ok) return null;
    const val = await res.json();
    // PostgREST returns a scalar as a plain value (string or null)
    return typeof val === 'string' ? val : null;
  } catch { return null; }
}

// ── Resolve agent ID from name ─────────────────────────────────────────────────
export async function fetchAgentId(name: string, token: string): Promise<number | null> {
  try {
    // Use ilike for case-insensitive match — agent names may vary in case
    const res = await apFetch(`/rest/v1/agents?select=id,name&name=ilike.${encodeURIComponent(name)}&limit=1`, {}, 10000, token);
    const rows = res.ok ? await res.json() : [];
    return rows[0]?.id ?? null;
  } catch { return null; }
}

// ── Fetch agent's customers ────────────────────────────────────────────────────
// PostgREST hard-caps at 1000 rows — paginate to catch all customers.
export async function fetchMyCustomers(agentId: number, token: string): Promise<Customer[]> {
  const all: Customer[] = [];
  const PAGE = 1000;
  let offset = 0;
  const filter = agentId > 0 ? `agent_id=eq.${agentId}&` : '';
  while (true) {
    try {
      const res = await apFetch(
        `/rest/v1/customers?select=id,name,cities(name)&${filter}order=id.desc&limit=${PAGE}&offset=${offset}`,
        {}, 20000, token
      );
      if (!res.ok) break;
      const rows: any[] = await res.json();
      all.push(...rows.map(r => ({ id: r.id, name: r.name, city_name: r.cities?.name || '' })));
      if (rows.length < PAGE) break;
      offset += PAGE;
    } catch { break; }
  }
  return all;
}

// ── Shared row parser ─────────────────────────────────────────────────────────
function parseOrderRows(rows: any[]): Order[] {
  return rows.map(r => {
    const items: OrderItem[] = (r.order_items || []).map((i: any) => ({
      id: i.id, volume_id: i.volume_id, size: i.size,
      quantity: i.quantity, rate: i.rate, amount: i.amount,
    }));
    const total = items.reduce((s, i) => s + (i.amount ?? (i.rate * i.quantity)), 0);
    return {
      id: r.id, order_number: r.order_number || `#${r.id}`,
      customer_id: r.customer_id,
      customer_name: r.customers?.name || '',
      city_name: r.customers?.cities?.name || '',
      status: r.status || 'Pending',
      created_at: r.created_at, remarks: r.remarks || '',
      items, total_amount: total,
    };
  });
}

// ── Fetch orders by agent_id (direct column on orders table) ──────────────────
// Orders have an agent_id FK directly — no need to go through customers at all.
// Owner/Admin (agentId=null): fetches all orders without filter.
export async function fetchOrdersByAgent(
  agentId: number | null,
  token: string,
): Promise<Order[]> {
  const SELECT = 'id,order_number,customer_id,status,created_at,remarks,customers(name,cities(name)),order_items(id,volume_id,size,quantity,rate,amount)';
  const PAGE   = 1000;
  const filter = agentId ? `&agent_id=eq.${agentId}` : '';

  const all: Order[] = [];
  let offset = 0;
  while (true) {
    try {
      const res = await apFetch(
        `/rest/v1/orders?select=${SELECT}${filter}&order=id.desc&limit=${PAGE}&offset=${offset}`,
        {}, 30000, token
      );
      if (!res.ok) break;
      const rows: any[] = await res.json();
      all.push(...parseOrderRows(rows));
      if (rows.length < PAGE) break;
      offset += PAGE;
    } catch { break; }
  }
  return all;
}

// kept for backward compat
export async function fetchMyOrders(customerIds: number[], token: string, fetchAll = false): Promise<Order[]> {
  return fetchOrdersByAgent(fetchAll ? null : null, token);
}

// ── Enrich order items with volume/catalog names ───────────────────────────────
export async function enrichWithVolumes(orders: Order[], token: string): Promise<Order[]> {
  const volIds = [...new Set(orders.flatMap(o => o.items.map(i => i.volume_id)).filter(id => id && id > 0))];
  if (!volIds.length) return orders;
  const chunks: number[][] = [];
  for (let i = 0; i < volIds.length; i += 200) chunks.push(volIds.slice(i, i + 200));
  const volMap = new Map<number, { volume_name: string; catalog_name: string }>();
  for (const chunk of chunks) {
    try {
      const res = await apFetch(
        `/rest/v1/volumes?select=id,volume_name,catalogs(name)&id=in.(${chunk.join(',')})&order=id.desc`,
        {}, 10000, token
      );
      if (res.ok) {
        const rows: any[] = await res.json();
        for (const v of rows) volMap.set(v.id, { volume_name: v.volume_name || '', catalog_name: v.catalogs?.name || '' });
      }
    } catch { /* skip enrichment */ }
  }
  return orders.map(o => ({
    ...o,
    items: o.items.map(i => ({ ...i, ...volMap.get(i.volume_id) })),
  }));
}

// ── Fetch challans for a set of customer IDs ──────────────────────────────────
// PostgREST hard-caps at 1000 rows — paginate.
export async function fetchMyChallans(customerIds: number[], token: string): Promise<Challan[]> {
  if (!customerIds.length) return [];
  const idList = customerIds.join(',');
  const all: Challan[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    try {
      const res = await apFetch(
        `/rest/v1/challans?select=id,challan_number,order_id,customer_id,created_at,bale_number,customers(name)&customer_id=in.(${idList})&order=id.desc&limit=${PAGE}&offset=${offset}`,
        {}, 20000, token
      );
      if (!res.ok) break;
      const rows: any[] = await res.json();
      all.push(...rows.map((r: any) => ({
        id: r.id, challan_number: r.challan_number, order_id: r.order_id,
        customer_id: r.customer_id,
        customer_name: r.customers?.name || '',
        created_at: r.created_at, bale_number: r.bale_number || '',
      })));
      if (rows.length < PAGE) break;
      offset += PAGE;
    } catch { break; }
  }
  return all;
}

// ── Fetch catalogs + volumes ──────────────────────────────────────────────────
export async function fetchCatalogs(token: string): Promise<Catalog[]> {
  try {
    const res = await apFetch(
      `/rest/v1/catalogs?select=id,name,cover_photo,is_active,is_pinned,category_id,catalog_categories(name)&is_active=eq.1&order=is_pinned.desc,id.desc&limit=500`,
      {}, 15000, token
    );
    if (!res.ok) return [];
    const rows: any[] = await res.json();
    return rows.map(r => ({
      id: r.id, name: r.name, cover_photo: r.cover_photo,
      is_active: r.is_active, is_pinned: !!r.is_pinned,
      category_id:   r.category_id   ?? undefined,
      category_name: r.catalog_categories?.name ?? undefined,
    }));
  } catch { return []; }
}

// ── Likes ─────────────────────────────────────────────────────────────────────
export async function fetchLikes(email: string, token: string): Promise<LikeData> {
  try {
    const res = await apFetch('/rest/v1/rpc/cv_get_likes', {
      method: 'POST', body: JSON.stringify({ p_email: email }),
    }, 10000, token);
    if (!res.ok) return { counts: {}, likedByMe: new Set() };
    const data = await res.json().catch(() => ({}));
    const counts: Record<number, number> = {};
    if (data.counts && typeof data.counts === 'object') {
      for (const [id, cnt] of Object.entries(data.counts)) counts[Number(id)] = cnt as number;
    }
    const likedByMe = new Set<number>(Array.isArray(data.liked_by_me) ? data.liked_by_me.map(Number) : []);
    return { counts, likedByMe };
  } catch { return { counts: {}, likedByMe: new Set() }; }
}

export async function toggleLike(
  catalogId: number, email: string, token: string
): Promise<{ liked: boolean | null; count: number; error?: string }> {
  try {
    const res = await apFetch('/rest/v1/rpc/cv_toggle_like', {
      method: 'POST', body: JSON.stringify({ p_catalog_id: catalogId, p_user_email: email }),
    }, 10000, token);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { liked: null, count: 0, error: data.error || 'Failed to like.' };
    if (data.liked === undefined || data.liked === null) return { liked: null, count: data.count ?? 0 };
    return { liked: !!data.liked, count: data.count ?? 0 };
  } catch (e: any) { return { liked: null, count: 0, error: e?.message || 'Network error.' }; }
}

export async function fetchVolumes(token: string): Promise<Volume[]> {
  const all: Volume[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    try {
      const res = await apFetch(
        `/rest/v1/volumes?select=id,catalog_id,volume_name,pdf_url,video_url,catalogs(name)&order=id.desc&limit=${PAGE}&offset=${offset}`,
        {}, 15000, token
      );
      if (!res.ok) break;
      const rows: Volume[] = await res.json();
      all.push(...rows);
      if (rows.length < PAGE) break;
      offset += PAGE;
    } catch { break; }
  }
  return all;
}

// ── Signed URL cache ──────────────────────────────────────────────────────────
// Keyed by original storage URL. Entries expire 5 min before the 1h Supabase TTL
// so we never hand a near-expiry URL to a long-running PDF/video viewer.
const _signedUrlCache = new Map<string, { signed: string; expiresAt: number }>();

// ── resolveStorageUrl ─────────────────────────────────────────────────────────
export async function resolveStorageUrl(url: string | undefined, token: string): Promise<string> {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (!url.includes('/storage/v1/object/')) return url;

  // Return cached signed URL if still fresh
  const hit = _signedUrlCache.get(url);
  if (hit && hit.expiresAt > Date.now()) return hit.signed;

  const match = url.match(/\/storage\/v1\/object\/(?:public|authenticated)\/([^?]+)/);
  if (!match) return url;
  const fullPath = match[1];
  const slashIdx = fullPath.indexOf('/');
  if (slashIdx === -1) return url;
  const bucket   = fullPath.substring(0, slashIdx);
  const filePath = fullPath.substring(slashIdx + 1);

  try {
    const res = await apFetch(
      `/storage/v1/object/sign/${bucket}/${filePath}`,
      { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) },
      10000, token
    );
    if (!res.ok) return url;
    const data = await res.json().catch(() => ({}));
    if (data?.signedURL) {
      const signed = `${SUPABASE_URL}/storage/v1${data.signedURL}`;
      _signedUrlCache.set(url, { signed, expiresAt: Date.now() + 55 * 60 * 1000 });
      return signed;
    }
  } catch { /* fall back */ }
  return url;
}

// ── preBatchSignUrls ──────────────────────────────────────────────────────────
// Signs all given storage URLs in bulk (one POST per bucket) and populates the
// _signedUrlCache. Reduces N concurrent sign requests to 1-2, which fixes
// Android WebView's connection-concurrency limit killing thumbnail loads.
export async function preBatchSignUrls(urls: string[], accessToken: string): Promise<void> {
  if (!urls.length || !accessToken) return;

  const toSign: { originalUrl: string; bucket: string; path: string }[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (!url || !url.includes('/storage/v1/object/') || seen.has(url)) continue;
    seen.add(url);
    const hit = _signedUrlCache.get(url);
    if (hit && hit.expiresAt > Date.now()) continue;
    const match = url.match(/\/storage\/v1\/object\/(?:public|authenticated)\/([^?]+)/);
    if (!match) continue;
    const fullPath = match[1];
    const slashIdx = fullPath.indexOf('/');
    if (slashIdx === -1) continue;
    toSign.push({ originalUrl: url, bucket: fullPath.substring(0, slashIdx), path: fullPath.substring(slashIdx + 1) });
  }
  if (!toSign.length) return;

  // Group by bucket, then one batch request per bucket (all in parallel)
  const byBucket = new Map<string, typeof toSign>();
  for (const item of toSign) {
    if (!byBucket.has(item.bucket)) byBucket.set(item.bucket, []);
    byBucket.get(item.bucket)!.push(item);
  }

  await Promise.allSettled(Array.from(byBucket.entries()).map(async ([bucket, items]) => {
    try {
      const res = await apFetch(
        `/storage/v1/object/sign/${bucket}`,
        { method: 'POST', body: JSON.stringify({ paths: items.map(i => i.path), expiresIn: 3600 }) },
        15000, accessToken
      );
      if (!res.ok) return;
      const data = await res.json().catch(() => []);
      if (!Array.isArray(data)) return;
      for (const item of items) {
        const row = data.find((r: any) => r.path === item.path);
        if (row?.signedURL && !row.error) {
          const signed = `${SUPABASE_URL}/storage/v1${row.signedURL}`;
          _signedUrlCache.set(item.originalUrl, { signed, expiresAt: Date.now() + 55 * 60 * 1000 });
        }
      }
    } catch { /* non-fatal — individual resolveStorageUrl calls are the fallback */ }
  }));
}
