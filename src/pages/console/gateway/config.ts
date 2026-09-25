/**
 * Environment-based configuration for the Atlas Voice Gateway.
 *
 * The base URL is read from a frontend environment variable only — no IP
 * addresses are hard-coded anywhere in the console. When the variable is not
 * set, the console stays fully usable in demo mode and live send is disabled.
 */

const RAW_BASE_URL =
  ((import.meta.env.VITE_ATLAS_VOICE_GATEWAY_URL as string | undefined) ?? "").trim();

export interface GatewayConfig {
  baseUrl: string;
  wsBaseUrl: string;
  configured: boolean;
  host: string;
}

const normalise = (value: string): string => value.replace(/\/+$/, "");

const deriveHost = (url: string): string => {
  if (!url) return "not configured";
  try {
    return new URL(url).host;
  } catch {
    return "invalid URL";
  }
};

const deriveWsBase = (url: string): string => {
  if (!url) return "";
  if (url.startsWith("https://")) return `wss://${url.slice("https://".length)}`;
  if (url.startsWith("http://")) return `ws://${url.slice("http://".length)}`;
  return url;
};

const baseUrl = normalise(RAW_BASE_URL);

export const gatewayConfig: GatewayConfig = {
  baseUrl,
  wsBaseUrl: deriveWsBase(baseUrl),
  configured: baseUrl.length > 0,
  host: deriveHost(baseUrl),
};

/** Absolute HTTP URL for a gateway path, e.g. `/api/chat`. */
export const toHttpUrl = (path: string): string => `${gatewayConfig.baseUrl}${path}`;

/** Absolute WebSocket URL for a gateway path, e.g. `/ws`. */
export const toSocketUrl = (path: string): string => `${gatewayConfig.wsBaseUrl}${path}`;