# Memoia Inspector

Memoia Inspector is a fork of [Memobase Inspector](https://github.com/memodb-io/memobase-inspector). It keeps the upstream project-switching UI, user/profile/event management, and chat Playground. All management pages, provenance controls and Playground use one `@jianify/memoia` SDK and the server’s unversioned `/api` contract.

The source is MIT-licensed; see [LICENSE](LICENSE). Memoia server itself is a separate Apache-2.0 project. Deployment of this admin UI should be protected by an access layer: the project token entered in the UI is still required to access a Memoia project, but is not a substitute for authenticating the human administrator.

## Source management

User/profile/event/config/usage management and optional Playground share the fixed `@jianify/memoia@0.9.0` SDK from `vendor/`. Generated types and runtime validation come from the server OpenAPI. The selected project cookie supplies the same origin/token, with no second session or profile cache.

Import and message-deletion `completed` receipts confirm Fact commits only. Fixed Blobs are sealed by explicit/timed flush (30s quiet / 120s maximum) into one user-scoped AgentLoop that atomically maintains Profiles and Events. The UI shows unbatched Blobs, flush identity, attempts, failure and original-operation recovery; pending or failed maintenance never reimports messages. Until flush succeeds, old derived text may remain readable. Event cards retain legacy text and show story time/location/keywords and an explicitly non-factual interpretation. These local contracts do not establish real model or browser acceptance.

The maintenance summary prioritizes a failed original flush over pending batches; new work cannot hide an unresolved failure. Retryable backoff remains pending until the operation is terminal.
After an explicit recovery, a known failure keeps its error code and original-flush recovery button instead of appearing as an unknown outcome. Repairing a flush never resends completed source input; permanent input rejection remains non-replayable.

Sources are caller-owned groups (Luvel uses dialog IDs), containing server-owned Blobs, message IDs, valid facts and support groups. The UI displays Blob IDs and state separately from Source identity. Profile history displays actual revisions with added/removed diffs and valid snapshots; deleted evidence is excluded and there is no snapshot restore operation. A separate accepted-operation list allows refresh-safe recovery of processing or retryable failures. Sources, revisions and operations use bounded pagination. Selecting message IDs and confirming **Delete messages** removes their contributions across the Source and rebuilds affected profiles/events from remaining facts. Ordinary event deletion retains its original event-only meaning. Completed raw input is erased; incomplete input expires after seven days by default. Explicit operation retry does not resend bodies; `input_required` needs the original caller, original batch and original key, not a reconstructed browser request.

Evidence cards display the Fact subject, reporter and certainty when supplied; legacy facts without these fields remain readable. Deletion confirmation distinguishes a profile entry or event from the user account. A completed message deletion confirms the Fact commit, not completion of asynchronous Profile/Event maintenance.

A processing or lost-acknowledgement response is not successful deletion. Keep the displayed stable operation key, query it, then explicitly resume the server's accepted operation if appropriate. Operation state is owned by the Users view per user and survives tab changes, closing the detail sheet and switching users within that project. Accepted-operation recovery can query its operation ID when its original key is unavailable. Starting a memory mutation clears the old memory/evidence display, hides stale counts and disables downloads until confirmation. Direct completion, queried completion and explicit recovery all refresh memories, sources and user counts. A failed readback displays an error with no old snapshot; aborted reads cannot restore deleted content. The UI never reconstructs and resubmits a changed message body. Switching users cancels stale detail reads; switching projects clears the local view and operation state. Rolling back an Inspector image cannot undo completed management writes.

The SDK sends every mutation once; only reads receive automatic retries. Write 5xx responses remain unknown even when the service reports `retryable`. Source operations recover by their receipt; unkeyed profile/event writes first refresh current resources. Profile/event routes preserve controlled HTTP errors instead of returning successful empty results. The memory sheet checks the `{code, message}` response, shows an uncertainty notice for unknown writes, and never automatically resubmits them; a failed refresh is reported separately from a confirmed successful write.

Deploy server and consumers together for this breaking API switch; no version aliases remain. Local tests/builds do not prove source withdrawal, Cloudflare Access isolation, real model calls, or coordinated recovery; those are separate Test acceptance steps.

The additional **Projects & permissions** tab reads current projects and scoped keys with bounded pagination. Root credentials can create/suspend projects; project administrators can issue/revoke their own `read`/`write`/`admin` keys, and the backend enforces these boundaries. Newly issued tokens are shown once in the mounted view, never placed in a Cookie or local storage. Unknown mutations are not repeated automatically: refresh current server state before continuing. Access changes require confirmation; existing project switching and legacy-token display stay unchanged. Legacy token rotation is intentionally not offered as a UI button.

## Development

All Cookie-backed write routes (including the retained optional Playground) validate browser origin before parsing or SDK calls. Missing/opaque/cross-origin requests fail closed. Routes accepting JSON explicitly require `application/json` and a valid JSON object; incorrect media types return 415 and malformed JSON returns 400 before a write. Bodyless DELETE routes require no JSON header: a Node request stream can exist even when it contains zero bytes. Direct requests compare the complete scheme/host/port. Behind a proxy, the original Host is accepted only with browser `Sec-Fetch-Site: same-origin`; raw forwarded headers alone never authorize a write. An optional runtime `INSPECTOR_PUBLIC_ORIGIN` pins the public origin for deployments that cannot supply that metadata; it must be the actual origin including any port, not a URL path. This optional setting is separate operator-managed runtime maintenance, not installed by the Playground Secrets workflow; normal browsers need no additional setting. Access and project Bearer authentication remain separate and unchanged.

History-capacity failures (`reconciliation_too_large`) are not automatically retried. Keep/query the accepted operation key even for HTTP 413: withdrawal may already have hidden evidence. After correcting capacity or the affected evidence scope, the existing explicit recovery control resumes the same operation; it never creates a new key or resubmits message bodies. Ordinary oversized-input failures remain non-recoverable without changing the input range.

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

The test-server setup, CI modes and recovery are in [deploy/README.md](deploy/README.md). Use `pnpm ci:local --mode quick` during development. Install `pnpm hooks:install`, then `pnpm push:test` runs reliable-base full checks before Test synchronization; full without a base includes all checks, audit, Docker build and deployment fixtures. Ordinary pushes do not start Actions. Manual Test publishes AMD64; Online tags build on two native architectures and deploy the validated manifest after approval. Actions only builds and delivers images; lint, types, SDK, business tests, audit and deployment-tool tests run locally. Production builds belong to Docker, not a duplicate host build; the VPS never builds source.
