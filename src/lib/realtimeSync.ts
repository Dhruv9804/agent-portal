/**
 * realtimeSync.ts — Agent Portal
 *
 * Lightweight Supabase Realtime channel watching the tables agent-portal cares
 * about. When any row changes the caller's onChanged callback fires (debounced)
 * so the app triggers a fresh data pull.
 *
 * Uses @supabase/realtime-js directly (same as catalog-viewer) — lighter than
 * pulling in the full @supabase/supabase-js SDK.
 *
 * IMPORTANT: Realtime WebSockets must go directly to Supabase — they cannot
 * be routed through the Cloudflare HTTP proxy.
 */

import { RealtimeClient } from '@supabase/realtime-js';

const DIRECT_URL = 'https://nmjhacobtvvuoxlnydoy.supabase.co';
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

// ── Module-level state ────────────────────────────────────────────────────────
let _client:           RealtimeClient | null = null;
let _onChanged:        (() => void) | null   = null;
let _onSessionRevoked: (() => void) | null   = null;
let _watchedEmail:     string | undefined;

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
  // Tear down any existing connection first
  _teardown();

  _onChanged        = onChanged;
  _onSessionRevoked = onSessionRevoked ?? null;
  _watchedEmail     = userEmail;

  _client = new RealtimeClient(`${DIRECT_URL}/realtime/v1`, {
    params: { apikey: ANON_KEY },
  });
  _client.setAuth(accessToken);

  // ── Data channel — one channel, all watched tables ────────────────────────
  const dataChannel = _client.channel('ap-sync');

  for (const table of WATCHED_TABLES) {
    dataChannel.on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table },
      () => { if (_onChanged) _onChanged(); },
    );
  }

  dataChannel.subscribe();

  // ── app_users channel — forced logout watch ───────────────────────────────
  if (userEmail && /^[^\s,()]+@[^\s,()]+\.[^\s,()]+$/.test(userEmail)) {
    const kickChannel = _client.channel(`ap-kick:${userEmail}`);
    kickChannel.on(
      'postgres_changes' as any,
      { event: 'UPDATE', schema: 'public', table: 'app_users', filter: `email=eq.${userEmail}` },
      (payload: any) => {
        // agent_device_ids cleared → kick this device
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
  console.log('[ap-realtime] 🔌 connecting — watching', WATCHED_TABLES.length, 'tables');

  return _teardown;
}

export function stopRealtimeSync() {
  _teardown();
}

function _teardown() {
  _onChanged        = null;
  _onSessionRevoked = null;
  _watchedEmail     = undefined;
  if (_client) {
    try { _client.disconnect(); } catch {}
    _client = null;
  }
}
