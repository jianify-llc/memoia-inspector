import { MemoiaError } from "@jianify/memoia";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { memoiaConnection, memoiaEndpoint } from "@/lib/memoia-transport";

export const COOKIE_NAME = "MEMOBASE_INSPECTOR_LOCALE";
export const WORKER_COOKIE_NAME = "MEMOIA_INSPECTOR_CONNECTION";

export function hasManagedProject() {
  return Boolean(process.env.MEMOIA_PROJECT_KEY || process.env.INSPECTOR_ACCESS_ISSUER ||
    process.env.INSPECTOR_ACCESS_AUDIENCE || process.env.INSPECTOR_ACCESS_OPERATOR_EMAIL);
}

let verifier: { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> } | undefined;

export async function projectCredentials(cookieStore?: Awaited<ReturnType<typeof cookies>>, connection = memoiaConnection()): Promise<{ endpoint: string; key: string; subject?: string } | null> {
  if (hasManagedProject()) {
    const key = process.env.MEMOIA_PROJECT_KEY?.trim();
    const issuer = process.env.INSPECTOR_ACCESS_ISSUER?.trim();
    const audience = process.env.INSPECTOR_ACCESS_AUDIENCE?.trim();
    const operatorEmail = process.env.INSPECTOR_ACCESS_OPERATOR_EMAIL?.trim().toLowerCase();
    if (!connection.binding || !key?.startsWith("mka_") || !operatorEmail || !audience || !issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)) {
      throw new MemoiaError("MANAGED_PROJECT_UNAVAILABLE", 503, false);
    }
    const assertion = (await headers()).get("cf-access-jwt-assertion");
    if (!assertion) throw new MemoiaError("ACCESS_REQUIRED", 401, false);
    if (verifier?.issuer !== issuer) {
      verifier = { issuer, keys: createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer), { timeoutDuration: 5000 }) };
    }
    try {
      const { payload } = await jwtVerify(assertion, verifier.keys, {
        issuer, audience, algorithms: ["RS256"], requiredClaims: ["exp", "sub"],
      });
      if (!payload.sub || typeof payload.email !== "string" || payload.email.toLowerCase() !== operatorEmail || payload.type !== "app") throw new Error("Expected the configured Access operator");
      return { endpoint: "worker", key, subject: payload.sub };
    } catch {
      throw new MemoiaError("ACCESS_REQUIRED", 401, false);
    }
  }

  const store = await (cookieStore ?? cookies());
  const name = connection.managed ? WORKER_COOKIE_NAME : COOKIE_NAME;
  const fields = store.get(name)?.value.split("|");
  if (!fields || fields.length !== 2 || !fields[1]) return null;
  const endpoint = memoiaEndpoint(fields[0], connection);
  return endpoint ? { endpoint, key: fields[1] } : null;
}

export async function getPlaygroundSigningKey() {
  const credentials = await projectCredentials();
  if (!credentials) throw new MemoiaError("PROJECT_REQUIRED", 401, false);
  return credentials.key;
}
