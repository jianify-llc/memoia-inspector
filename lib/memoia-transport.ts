import { getCloudflareContext } from "@opennextjs/cloudflare";

/** A binding belongs to one origin; never send another server's credentials to it. */
export function memoiaTransport(baseUrl: string): typeof fetch | undefined {
  const configuredOrigin = process.env.MEMOIA_BINDING_ORIGIN;
  if (!configuredOrigin) return undefined;

  const bindingOrigin = new URL(configuredOrigin);
  if (bindingOrigin.origin !== configuredOrigin || bindingOrigin.protocol !== "https:") {
    throw new Error("MEMOIA_BINDING_ORIGIN must be an HTTPS origin");
  }
  const requested = new URL(baseUrl);
  if (requested.origin !== bindingOrigin.origin || requested.pathname !== "/" || requested.username || requested.password || requested.search || requested.hash) return undefined;

  const binding = getCloudflareContext().env.MEMOIA;
  if (!binding) throw new Error("MEMOIA service binding is missing");
  return (input, init) => binding.fetch(input, init);
}
