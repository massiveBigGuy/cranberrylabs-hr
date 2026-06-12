import { api } from './api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

async function getVapidKey(): Promise<string | null> {
  const data = await api.get<{ enabled: boolean; vapid_public: string | null }>(
    '/api/notifications/vapid-key',
  );
  return data.enabled ? data.vapid_public : null;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return (
      (await navigator.serviceWorker.getRegistration('/sw.js')) ??
      (await navigator.serviceWorker.register('/sw.js'))
    );
  } catch {
    return null;
  }
}

export type PushState = 'subscribed' | 'unsubscribed' | 'unavailable';

export async function getPushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unavailable';
  try {
    const vapidKey = await getVapidKey();
    if (!vapidKey) return 'unavailable';
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!reg) return 'unsubscribed';
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'unsubscribed';
  } catch {
    return 'unavailable';
  }
}

export async function subscribeToPush(): Promise<boolean> {
  const vapidKey = await getVapidKey();
  if (!vapidKey) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const reg = await getRegistration();
  if (!reg) return false;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  }

  const json = sub.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  await api.post('/api/notifications/subscribe', { endpoint: json.endpoint, keys: json.keys });
  return true;
}

export async function unsubscribeFromPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => null);
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  await api.delete('/api/notifications/subscribe', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}
