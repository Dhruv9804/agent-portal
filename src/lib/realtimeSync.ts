/**
 * realtimeSync.ts — Agent Portal
 *
 * Lightweight Supabase Realtime channel watching the tables agent-portal cares about. When any row
 * changes the caller's onChanged callback fires (debounced) so the app triggers a fresh data pull.
 *
 * Uses @supabase/realtime-js directly (same as catalog-viewer) — lighter than the full SDK.
 *
 * TRANSPORT: PROXY FIRST — the Cloudflare Worker tunnels the WebSocket Upgrade and works on networks
 * that block direct AWS IPs (e.g. Jio). We auto-flip to DIRECT after repeated subscribe failures and
 * keep flipping until a path connects. (Supersedes the old "WebSockets must go directly to Supabase"
 * note — the Worker tunnels them, exactly like the main app's realtimeSync.) If realtime can't
 * connect at all, the app still catches up via the on-foreground reload, which uses apFetch's
 * direct↔proxy fallback.
 */

import { RealtimeClient } from '@supabase/realtime-js';

const DIRECT_URL = 'https://nmjhacobtvvuoxlnydoy.supabase.co';
const PROXY_URL  = 'https://supabase-proxy.dhruv-chopra92.workers.dev';
const ANON_KEY   =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tamhhY29idHZ2dW94bG55ZG95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMTU5MzYsImV4cCI6MjA5MzY5MTkzNn0.' +
  'uYX0iSBWNg4elwNUtPdag8duHpXsYQlr3e00D4Lj7oI';

// Tables that affect the agent-portal view
const WATCHED_TABLES = [
  'catalogs',
  'volumes',
  'orders',
  'order_items',
  'customers',
  'challans',
];

type Transport = 'proxy' | 'direct';
const RT_URL: Record<Transport, string> = {
  proxy:  `${PROXY_URL}/realtime/v1`,
  direct: `${DIRECT_URL}/realtime/v1`,
};
const FLIP_AFTER = 2;   // consecutive subscribe failures on a transport before flipping to the other

// ── Module-level state ────────────────────────────────────────────────────────
let _client:           RealtimeClient | null = null;
let _onChanged:        (() => void) | null   = null;
let _onSessionRevoked: (() => void) | null   = null;
let _watchedEmail:     string | undefined;
let _token:            string | undefined;
let _kind:             Transport = 'proxy';
let _fails           = 0;
let _stopped         = false;
let _timer:            ReturnType<typeof setTimeout> | null = null;

export function getRealtimeStatus(): 'disconnected' | 'connecting' | 'connected' {
  if (!_client) return 'disconnected';
  const s = (_client as any).connState as string | undefined;
  if (s === 'open') return 'connected';
  if (s === 'connecting') return 'connecting';
  return 'disconnected';
}

/**
 * Push a new JWT to the live Realtime connection without tearing it down.
 * Call this after every successful token refresh.
 */
export function updateRealtimeToken(newToken: string) {
  _token = newToken;
  _client?.setAuth(newToken);
}

/**
 * Start listening for DB changes on agent-portal tables.
 *
 * @param onChanged        Called whenever any watched table changes.
 * @param accessToken      User's Supabase JWT.
 * @param userEmail        Used to scope the app_users filter for forced logout.
 * @param onSessionRevoked Called when an admin revokes this device's access.
 * @returns cleanup function — call it to stop.
 */
export function startRealtimeSync(
  onChanged: () => void,
  accessToken: string,
  userEmail: string,
  onSessionRevoked?: () => void,
): () => void {
  _teardown();

  _onChanged        = onChanged;
  _onSessionRevoked = onSessionRevoked ?? null;
  _watchedEmail     = userEmail;
  _token            = accessToken;
  _kind             = 'proxy';
  _fails            = 0;
  _stopped          = false;

  _connect();
  return _teardown;
}

/** (Re)build the client + channels on the current transport, flipping proxy↔direct on failure. */
function _connect() {
  if (_stopped) return;
  if (_client) { try { _client.disconnect(); } catch {} }

  _client = new RealtimeClient(RT_URL[_kind], { params: { apikey: ANON_KEY } });
  if (_token) _client.setAuth(_token);

  // ── Data channel — one channel, all watched tables ────────────────────────
  const dataChannel: any = _client.channel('ap-sync');
  for (const table of WATCHED_TABLES) {
    dataChannel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      () => { if (_onChanged) _onChanged(); },
    );
  }
  dataChannel.subscribe((status: string) => {
    if (status === 'SUBSCRIBED') {
      _fails = 0;
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      if (_stopped) return;
      _fails++;
      if (_fails >= FLIP_AFTER) { _fails = 0; _kind = _kind === 'proxy' ? 'direct' : 'proxy'; }
      if (_timer) clearTimeout(_timer);
      _timer = setTimeout(_connect, 3000);
    }
  });

  // ── app_users channel — forced logout watch ───────────────────────────────
  if (_watchedEmail && /^[^\s,()]+@[^\s,()]+\.[^\s,()]+$/.test(_watchedEmail)) {
    const kickChannel: any = _client.channel(`ap-kick:${_watchedEmail}`);
    kickChannel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'app_users', filter: `email=eq.${_watchedEmail}` },
      (payload: any) => {
        const ids: string[] | null =
          payload.new?.agent_device_ids ?? payload.new?.party_device_ids ?? null;
        if (Array.isArray(ids) && ids.length === 0 && _onSessionRevoked) {
          _onSessionRevoked();
        }
      },
    );
    kickChannel.subscribe();
  }

  _client.connect();
  console.log(`[ap-realtime] 🔌 connecting via ${_kind} — watching`, WATCHED_TABLES.length, 'tables');
}

export function stopRealtimeSync() {
  _teardown();
}

function _teardown() {
  _stopped          = true;
  _onChanged        = null;
  _onSessionRevoked = null;
  _watchedEmail     = undefined;
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (_client) {
    try { _client.disconnect(); } catch {}
    _client = null;
  }
}
