# Memoia Inspector

Memoia Inspector is a fork of [Memobase Inspector](https://github.com/memodb-io/memobase-inspector). It keeps the upstream project-switching UI, user/profile/event management, and chat Playground. The original Memobase TypeScript SDK and HTTP contract remain in use for the retained v1 pages; source management uses the separate Memoia v2 SDK.

The source is MIT-licensed; see [LICENSE](LICENSE). Memoia server itself is a separate Apache-2.0 project. Deployment of this admin UI should be protected by an access layer: the project token entered in the UI is still required to access a Memoia project, but is not a substitute for authenticating the human administrator.

## v2 source management

The existing v1 management pages and optional Playground are retained. The Users memory sheet adds a **Sources & history** tab using the fixed `@jianify/memoia@0.2.1` SDK from `vendor/`; generated SDK types and runtime validation come from the Memoia server's OpenAPI. The selected project cookie supplies the same origin/token to both clients, with no second session or profile cache.

Sources expose message IDs, valid facts and their support groups, processing state, and current profile/source relationships. Profile history displays actual revisions with added/removed diffs and valid snapshots; withdrawn evidence is excluded and there is no snapshot restore operation. A separate accepted-operation list allows refresh-safe recovery of processing or retryable failures. Sources, revisions and operations use bounded pagination. Selecting source message IDs and confirming **retraction** rebuilds affected profiles/events from remaining evidence. Ordinary event deletion retains its original event-only meaning.

A processing or lost-acknowledgement response is not successful deletion. Keep the displayed stable operation key, query it, then explicitly resume the server's accepted operation if appropriate. The UI never reconstructs and resubmits a changed message body. Refreshes discard old evidence, and switching users discards/cancels stale read results. Rolling back an Inspector image cannot undo completed management writes.

The server must support v2 before these new controls can be accepted. Local tests/builds do not prove source withdrawal, Cloudflare Access isolation, real model calls, or cross-version recovery; those are separate Test acceptance steps.

The additional **Projects & permissions** tab reads current projects and scoped keys with bounded pagination. Root credentials can create/suspend projects; project administrators can issue/revoke their own `read`/`write`/`admin` keys, and the backend enforces these boundaries. Newly issued tokens are shown once in the mounted view, never placed in a Cookie or local storage. Unknown mutations are not repeated automatically: refresh current server state before continuing. Access changes require confirmation; existing project switching and legacy-token display stay unchanged. Legacy token rotation is intentionally not offered as a UI button.

## Development

Use Node.js 24 LTS and pnpm 10.12.4:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The container image is built for the domain root path and same-origin API calls. An alternate Next.js `basePath` is a **build-time** choice and needs a different image; changing a server `.env` does not alter an already-built image.

The optional Playground calls a model independently of Memoia. Admin features do not require its `OPENAI_API_KEY`, `OPENAI_BASE_URL`, or `OPENAI_MODEL`; without a configured model, the Playground remains visible but its chat and test-user operations are not started. If enabled before first deployment, store its settings in the Inspector repository's GitHub `test` Environment; Actions installs a protected runtime copy on the host. Later changes require separate maintenance. Set the Memoia project origin and Bearer token through the Inspector settings page. Existing upstream Cloudflare Worker commands are retained for compatibility, but the deployment below uses Docker; do not run the upstream `wrangler.jsonc` against its original route.

## Tests and deployment

```bash
pnpm test
pnpm check:sdk
pnpm typecheck
pnpm lint
pnpm build
pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org
docker run --rm --network none -v "$PWD:/work:ro" -w /work python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e bash tests/deploy-inspector.test.sh
```

The test-server installation, GitHub Actions setup, Cloudflare Access boundary, and recovery procedure are in [deploy/README.md](deploy/README.md). The public image is built by Actions from the `test` branch and is deployed by manifest digest; the VPS never builds source code.
