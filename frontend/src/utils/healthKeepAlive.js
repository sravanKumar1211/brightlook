import { apiUrl } from '../services/api.js';

export const HEALTH_PING_INTERVAL_MS = 60_000;

export function isHealthKeepAliveEnabled() {
  if (import.meta.env.MODE === 'test') return false;
  return Boolean(import.meta.env.PROD || (import.meta.env.VITE_API_URL || '').trim());
}

/**
 * Periodically pings the backend `/api/v1/health` endpoint every 1 minute while the
 * frontend app is open so deployed API instances stay warm without waking the DB.
 */
export function startHealthKeepAlive({
  intervalMs = HEALTH_PING_INTERVAL_MS,
  enabled = isHealthKeepAliveEnabled(),
  fetcher = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null,
} = {}) {
  if (!enabled || !fetcher) return () => {};

  const endpoint = apiUrl('/api/v1/health');
  let active = true;
  let inFlight = false;
  let controller = null;

  const ping = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutMs = Math.max(5_000, intervalMs - 5_000);
    const timeoutId = controller ? setTimeout(() => controller?.abort(), timeoutMs) : null;
    try {
      await fetcher(endpoint, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch {
      // Best-effort keep-alive: swallow network/cold-start errors quietly.
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      controller = null;
      inFlight = false;
    }
  };

  const timerId = setInterval(ping, intervalMs);
  return () => {
    active = false;
    clearInterval(timerId);
    controller?.abort();
  };
}
