import { getCloudflareContext } from "@opennextjs/cloudflare";

function httpsOrigin(value: string, variable: string): string {
  const url = new URL(value);
  if (url.origin !== value || url.protocol !== "https:") {
    throw new Error(`${variable} must be an HTTPS origin`);
  }
  return value;
}

export function memoiaConnection() {
  let env: CloudflareEnv | undefined;
  try {
    env = getCloudflareContext()?.env;
  } catch {
    // Standalone Next.js has no OpenNext Worker context.
  }
  const http = process.env.MEMOIA_HTTP_ORIGIN;
  const defaultUrl = http ? httpsOrigin(http, "MEMOIA_HTTP_ORIGIN") : undefined;
  const clientId = process.env.MEMOIA_ACCESS_CLIENT_ID;
  const clientSecret = process.env.MEMOIA_ACCESS_CLIENT_SECRET;
  const access = clientId?.trim() && clientSecret?.trim() ? { clientId, clientSecret } : undefined;
  if ((clientId || clientSecret) && (!defaultUrl || !access)) {
    throw new Error("Memoia Access requires an origin, client ID and client secret");
  }
  return { managed: Boolean(env), binding: env?.MEMOIA, defaultUrl, access };
}

export function memoiaEndpoint(value: string, { managed, binding, defaultUrl } = memoiaConnection()): string | null {
  if (value === "worker") return binding ? value : null;
  if (defaultUrl && (value === defaultUrl || value === `${defaultUrl}/`)) return defaultUrl;
  return managed ? null : value || null;
}

export function memoiaTransport(endpoint: string, { defaultUrl, access } = memoiaConnection()): typeof fetch | undefined {
  if (endpoint === defaultUrl && access) {
    return async (input, init) => {
      const request = input instanceof Request ? input : undefined;
      const url = new URL(request?.url ?? String(input));
      if (url.origin !== defaultUrl || url.username || url.password) {
        throw new Error("Memoia request does not match the configured Access origin");
      }
      const headers = new Headers(init?.headers ?? request?.headers);
      headers.set("CF-Access-Client-Id", access.clientId);
      headers.set("CF-Access-Client-Secret", access.clientSecret);
      return fetch(input, { ...init, headers, redirect: "manual" });
    };
  }
  return undefined;
}
