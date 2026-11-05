import { getCloudflareContext } from "@opennextjs/cloudflare";

export function memoiaBindingOrigin(): string | undefined {
  const configuredOrigin = process.env.MEMOIA_BINDING_ORIGIN;
  if (!configuredOrigin) return undefined;

  const bindingOrigin = new URL(configuredOrigin);
  if (bindingOrigin.origin !== configuredOrigin || bindingOrigin.protocol !== "https:") {
    throw new Error("MEMOIA_BINDING_ORIGIN must be an HTTPS origin");
  }
  return configuredOrigin;
}

export function memoiaEndpointAllowed(baseUrl: string, origin = memoiaBindingOrigin()): boolean {
  return Boolean(baseUrl) && (!origin || baseUrl === origin || baseUrl === `${origin}/`);
}

export function memoiaTransport(baseUrl: string): typeof fetch | undefined {
  const origin = memoiaBindingOrigin();
  if (!origin) return undefined;
  if (!memoiaEndpointAllowed(baseUrl, origin)) throw new Error("Memoia endpoint does not match this deployment");

  const binding = getCloudflareContext().env.MEMOIA;
  if (!binding) throw new Error("MEMOIA service binding is missing");
  return (input, init) => binding.fetch(input, init);
}
