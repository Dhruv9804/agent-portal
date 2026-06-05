/**
 * Push notifications for Kanika Agents (agent-portal).
 *
 * On a native device we register with APNs (iOS) / FCM (Android) via
 * @capacitor/push-notifications, then save the device token to the SHARED
 * `user_push_tokens` table (same Supabase project as the main app). The existing
 * `send-push` Edge Function delivers to it:
 *   • Android — routed by FCM token within the shared Firebase project.
 *   • iOS     — delivered to this app's bundle id, taken from the row's `app_id`
 *               (so the main app's bundle is NOT used as the APNs topic).
 *
 * The server (send-push, the FCM service account, the APNs .p8 key) is fully
 * shared. Per-app console steps still required:
 *   • Android: add this app to Firebase project `smart-stock-9cde2`, drop its own
 *     google-services.json into android/app/.
 *   • iOS: enable the Push Notifications capability on the App ID + in Xcode. The
 *     APNs .p8 key is shared at the Apple-team level — no new key needed.
 */
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { SUPABASE_URL, PROXY_URL, ANON_KEY } from './supabase';

// This app's bundle id / applicationId — saved with each token so send-push can
// target the correct APNs topic (iOS). MUST match capacitor.config.ts `appId`.
const APP_ID = 'com.dhruv.agents';

type Auth = { email: string | null; token: string | null };
let _getAuth: () => Auth = () => ({ email: null, token: null });
let _listenersAdded = false;

async function saveToken(deviceToken: string): Promise<void> {
  const { email, token } = _getAuth();
  if (!email || !deviceToken) return;
  const body = JSON.stringify({
    user_id:  email,
    token:    deviceToken,
    platform: Capacitor.getPlatform(),   // 'ios' | 'android'
    app_id:   APP_ID,
  });
  const headers: Record<string, string> = {
    'Content-Type':  'application/json',
    apikey:          ANON_KEY,
    Authorization:   `Bearer ${token || ANON_KEY}`,
    Prefer:          'resolution=merge-duplicates',
  };
  // Proxy first, direct Supabase as fallback (same preference as the rest of the app).
  for (const base of [PROXY_URL, SUPABASE_URL]) {
    try {
      const res = await fetch(`${base}/rest/v1/user_push_tokens`, { method: 'POST', headers, body });
      if (res.ok || res.status < 500) { console.log('[push] token saved', res.status); return; }
    } catch { /* network — try the other base */ }
  }
  console.warn('[push] token save failed on both bases');
}

async function ensureRegistered(): Promise<void> {
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') { console.log('[push] permission not granted'); return; }
    await PushNotifications.register();
  } catch (e) {
    console.error('[push] register failed', e);
  }
}

/**
 * Idempotent. Call once a session exists, and again whenever the signed-in user
 * changes — it refreshes the auth getter and re-registers so the token is
 * re-associated to the current user. No-op on web.
 */
export function initPush(getAuth: () => Auth): void {
  _getAuth = getAuth;
  if (!Capacitor.isNativePlatform()) return;
  if (_listenersAdded) { void ensureRegistered(); return; }
  _listenersAdded = true;

  PushNotifications.addListener('registration', t => { void saveToken(t.value); });
  PushNotifications.addListener('registrationError', e => console.error('[push] registration error', e));
  PushNotifications.addListener('pushNotificationReceived', n => console.log('[push] received', n?.title ?? ''));
  PushNotifications.addListener('pushNotificationActionPerformed', () => {});

  void ensureRegistered();
}
