# Docker and Cloudflare deployment

Both targets run the same TypeScript Next.js application and fixed SDK. Docker uses `next build` and Node standalone; Cloudflare uses OpenNext and Workers Static Assets. They can run simultaneously on different protected hostnames and connect to the same Memoia service. A single hostname routes to the explicitly selected deployment; switching that target is separate configuration maintenance. Switching or restoring a UI does not undo completed Memoia writes.

## Cloudflare Workers

`wrangler.jsonc` has a generic `memoia-inspector` configuration and the Luvel Test instance `luvel-memoia-inspector-test`. It has no upstream routes, R2 bucket, tail Worker or incremental-cache service. The app's authenticated pages use dynamic rendering; no ISR cache, database or Queue is needed. Keep `workers_dev` and preview URLs disabled. Preserve whole-hostname Cloudflare Access protection, including API routes and Server Actions; project Bearer credentials are separate from the administrator identity.

The optional Test `MEMOIA` binding targets `luvel-memoia-test`. `MEMOIA_BINDING_ORIGIN` identifies which entered project endpoint belongs to this binding. Only that exact HTTPS origin uses the bound transport; other project endpoints use the existing HTTP path. Missing or failed configured bindings never silently resend to HTTP. Docker leaves this setting unset. Both paths use the same SDK, project cookies, validation and original-operation recovery.

For local work, build and preview from an isolated copy without business `.env` or `.dev.vars` files. Next/OpenNext can read those files before Wrangler starts; an empty Wrangler env file alone is not enough. `pnpm ci:local --mode full` prepares such a copy automatically. Generic manual commands are:

```sh
pnpm build:cloudflare
pnpm preview
# Test configuration: pass --env test to the corresponding OpenNext command.
# Local packaging only; no upload or automatic resource provisioning:
node node_modules/wrangler/bin/wrangler.js versions upload --env test --dry-run --outdir /tmp/inspector-worker-output --env-file /path/to/empty.env
```

Before the first Test release, the resource owner registers a closed initial Worker, configures the protected hostname and Access application, and adds the Test Service Binding. This is a separate approved setup; the release helper does not create resources, routes, Access policies or Secrets. Set `MEMOIA_BINDING_ORIGIN` to the actual Memoia endpoint if different from the candidate. Optional Playground settings are runtime Worker secrets/vars using the existing `OPENAI_*` names; never embed provider credentials in the build. With no model configuration the optional Playground remains unavailable, while administration works.

The manual `deploy-cloudflare-test.yml` workflow requires repository variable `ENABLE_CLOUDFLARE_TEST_DEPLOY=true`, the GitHub `test` Environment, `CLOUDFLARE_ACCOUNT_ID`, `CF_TEST_ZONE_ID` and `CF_TEST_PUBLIC_ORIGIN` variables, and a `CLOUDFLARE_API_TOKEN` secret. The token needs target Worker publication plus read-only metadata for the Memoia binding, zone and Access checks; it does not need permission to change Access policies, routes or domains. Configure the Environment to admit only `test`. The helper checks current Test SHA and the existing Worker/Access configuration, uploads once, reads the exact version ID from Wrangler's structured output, then rechecks before activating that ID. It cannot prove every Access precedence rule: the resource owner must review the actual protection and routes, and acceptance must verify unauthorized denial. Unknown or overlapping configurations stop publication instead of changing the platform.

The existing Docker Test and Online workflows remain separate. This change adds a manual Cloudflare Test path; it does not enable automatic Cloudflare Online publication. For a later Online release use the company tag, frozen-artifact and approval contract, not an unreviewed CLI bypass. Recover a Cloudflare deployment only to a compatible, accepted exact Worker version; keep the current binding/Secret configuration compatible and verify routes/Access afterward. Neither a version rollback nor a Docker restore rolls back Memoia data.

Local acceptance must exercise the built OpenNext Worker in workerd, cookies and project switching, SDK reads/writes and original-operation queries, same-origin rejection, and optional unconfigured-model behavior. Node tests, `next dev` and a successful bundle do not prove Workers behavior. Real Access, model streaming, remote Service Binding and release/rollback remain separate Test acceptance.

## Docker / existing Test host

## GitHub Organization and image ownership

The source repository is `jianify-llc/memoia-inspector`; historical Test images remain in `ghcr.io/jianify/memoia-inspector`. Publishing uses `github.repository`, so new candidates target `ghcr.io/jianify-llc/memoia-inspector`. Confirm package linkage, repository Actions write access, and anonymous pulls: AMD64 for Test, AMD64/ARM64 for Online. Repository visibility does not establish package visibility.

The deployment script accepts digest-addressed images from either namespace. Recovery still requires the exact image and source from an accepted record. Preserve old packages and historical digests until new publication, server pulls and recovery have been verified; changing only the owner string of an old digest is not a migration.

This is a separate application on the existing Japan test host. It does not restart Memoia, PostgreSQL, Redis, or the host cloudflared service. The test hostname is `test-memoia-inspector.jianify.dev`; the container is reachable on the host only at `127.0.0.1:3001`. The Online workflow is prepared separately but has not been accepted on an Online host.

The versioned deployment script requires `INSPECTOR_STAGE=test` or `online` and passes `-p memoia-inspector-<stage>` to Compose. This overrides the file's legacy `name: memoia-inspector-test` without changing the already installed Test Compose or its project identity. Actions passes the stage explicitly through `sudo -n env`; manual recovery must do the same. An absent or unknown stage fails before the script touches deployment state.

## One-time operator setup

1. Review the host identity, available memory, port 3001, and the existing cloudflared service. Actions creates `/opt/memoia-inspector` and installs the versioned Compose and deployment script. The server `.env` is root-owned mode 0600 and may leave the optional Playground model key and model name blank. The administrator enters the Memoia project URL and token in the protected UI.
2. Configure the **existing host Tunnel** to route `test-memoia-inspector.jianify.dev` to `http://127.0.0.1:3001`. Create a Cloudflare Access self-hosted application protecting the **entire hostname**, allowing only the administrator's exact identity. Do this before exposing the route. Neither `wrangler.jsonc` nor the Inspector Compose manages the Tunnel.
3. In the `test` GitHub Environment configure `DEPLOY_HOST` with the test VPS public IP, `DEPLOY_PORT` with its SSH port (normally 22), `DEPLOY_SSH_PRIVATE_KEY`, and `DEPLOY_SSH_KNOWN_HOSTS`. The `INSPECTOR_OPENAI_API_KEY`, `INSPECTOR_OPENAI_BASE_URL`, and `INSPECTOR_OPENAI_MODEL` secrets are optional; if a key or model is supplied, all three must be supplied and Actions installs them together before the first acceptance. An accepted deployment will not silently rotate these values; enabling the demo afterward is separate maintenance. Actions connects directly as the existing `github` SSH user with a key dedicated to this repository and `sudo -n`; it does not use a Cloudflare SSH route or the Lightsail default key. Confirm the host key from a trusted source. Set the **repository-level** variable `INSPECTOR_TEST_DEPLOY_ENABLED` to `true` only when the host, dedicated key, and Test version gate are ready; keep it false until then. Restrict the Environment to the `test` branch. The browser hostname in step 2 is a separate route and still requires Tunnel plus Access before it is exposed.
4. Publish the first `test` image with Actions. Set GHCR visibility to Public and verify anonymous AMD64 pull. When the deployment gate is enabled, Actions installs Compose on the host, selects `init` for a new instance or `deploy` for an accepted one, checks the image label and local health, and records the digest. This does not establish Access isolation or real Memoia management operations; those require separate acceptance. Automatic Deployment success is disabled for this reason.

The project URL/token entered in the UI are browser-session credentials. Inspector project switching clears the associated Playground user. Because the API-key tab shows the project key, Access must cover every page and API route; origin port 3001 must not be exposed publicly. Memoia's own Bearer authentication remains independent.

## Daily update and recovery

Source management uses the fixed SDK 0.11.0 and the single `/api` contract: source lists contain summaries; message IDs, input batches and evidence each load bounded pages on demand. Each collection advances its own offset, and only a returned null next-offset means exhaustion. The UI does not fetch the complete historical source automatically or treat the first page as complete. Paging is not a transaction snapshot; refresh after concurrent mutations. Missing pagination fields from an older backend fail validation, so deploy the matching Memoia API before this Inspector candidate. Playground now also requires the authenticated `/api/project/identity` receipt for cache isolation. Existing management writes, same-origin protection and explicit operation recovery are unchanged.

Import and message-deletion completion confirms Fact changes, not Profile/Event maintenance. Fixed Blobs are grouped by automatic or explicit flush, and one user-scoped Loop commits both derived layers together. Inspector displays pending/failed flush progress and recovers only the original failed operation; it never reimports completed input to repair derived memory. After message deletion, old derived text may remain readable until maintenance succeeds, without presenting its removed Fact links as valid evidence.

`verify.yml` builds the actual main PR or merge-queue candidate with Docker on AMD64 and does not publish. `deploy-test.yml` checks the selected current Test SHA inside the image Job, then publishes AMD64 once per SHA without QEMU and confirms anonymous pull/source identity. It has only image publication and deployment Jobs. Actions does not run standalone lint, type, SDK, business, audit or deployment-tool tests; these belong to local checks. A historical multi-arch image may be reused if its AMD64 and source pass. With the gate enabled, `apply` replaces only Inspector; changed Compose/runtime config, stale run, unresolved attempt or wrong source blocks deployment.

Next.js and related versions have one source: `package.json` plus the frozen lockfile, not repeated patch assertions in workflows. The security baseline uses Next 15.5.28 and Zod 4 with the official Assistant UI data-stream runtime. OpenNext, Wrangler and test tooling are also updated; scoped transitive patch overrides resolve advisories without forcing incompatible major versions. Check both production and full dependency audits against the public npm registry, and recheck current official advisories before Online approval. A passing audit/build does not establish complete security acceptance. Keep origin loopback-only and Access on the whole hostname.

The host records `current` (last accepted image), `previous` (accepted image before it), and any unresolved `pending` candidate under `/opt/memoia-inspector/.deploy`. If activation or health validation fails, the script stops the failed candidate when it is the running container and keeps `pending` plus container logs for investigation. A failed first install has no accepted image: investigate, then use `clear-pending <exact-source-sha>` before retrying `init`.

For a failed A → B update, `current` still identifies A; `previous` may be absent or older than A. After investigating the failed operation, use `restore-api <current-image> <current-source-sha> <pending-run-id> <pending-source-sha>`. This explicitly restarts A, archives the failed B record, and retains the run-ID high-water mark. It can reuse the locally cached accepted image if GHCR is unavailable. Do **not** clear `pending` merely to retry CI. Once B has been accepted, an intentional rollback instead uses `restore-api <previous-image> <previous-source-sha> <new-run-id>` with no pending candidate. Routine deployment also refuses to replace a container that differs from the accepted `current` record. Image restoration does **not** undo management changes made against Memoia. Recheck Access and management operations after recovery.

Manual acceptance must cover: unauthorized Access denial; no direct public port 3001; correct and incorrect Memoia token; failed and successful user deletion/config update with read confirmation; project switch and credential loss; user/profile/event reads; container restart; memory/OOM. With blank model settings, confirm the visible Playground chat returns unavailable without creating a test user or writing memory. Real streaming chat, insert, and flush are required only if optional model settings are enabled. Automated local health checks do not establish these external boundaries. If no second compatible digest exists, cross-version update/restore remains unverified.

## Local checks and explicit Test acceptance

The [company branch/release policy](https://github.com/jianify-llc/Jianify-LLC/blob/main/docs/engineering/branch-release.md) owns the shared rules. Ordinary development/Test/release pushes and development PRs do not start Actions. Only pull requests archiving to main and their merge queue retain Required Verify; Online tags and approval remain separate.

```bash
pnpm hooks:install
pnpm ci:local --mode quick
pnpm ci:local --mode full --base <remote-Test-SHA>
pnpm ci:local --mode full
# After committing this batch, from its clean worktree:
pnpm push:test
# Only for an explicitly authorized Test acceptance batch:
gh workflow run deploy-test.yml --ref test --repo jianify-llc/memoia-inspector
```

Local verification uses `scripts/verify-local.ts` with Node's native TypeScript execution (default full):

| Mode | Business checks | Tool/build checks |
| --- | --- | --- |
| quick | Frozen install, SDK identity, typecheck, lint, offline/mock tests; loopback HTTP fixtures remain in full | Development feedback; no audit, deployment fixtures or image build |
| full with base | Business-affecting changes run SDK, types, lint, business tests and audit | Reliable multi-commit diff selects deployment fixtures; build/dependency changes add Docker and OpenNext verification |
| full without reliable base | Complete business checks and production dependency audit | All deployment fixtures, native Docker and OpenNext builds, no push |

`push:test` obtains the exact remote Test SHA before full checks. An empty reliable diff selects nothing; missing, zero, unavailable or non-ancestor base, or a dirty worktree, expands to all checks, and malformed bases fail. Business scope covers application/components/lib/hooks/i18n/types/public/api/utils/messages, business tests and their configuration. Build scope covers Dockerfile, .dockerignore, dependency/registry manifests, vendored SDK, Next/PostCSS/TypeScript and Worker configuration. Deployment-tool scope covers scripts, deploy, hooks, workflows and their tests. These are one application's explicit path rules, not historical successful-run inference. Node 22.17+ (Node 24 in Docker) and pnpm 10.12.4 run the TS tools; ShellCheck/Docker are required for selected tool/build work. Dependency downloads are preparation, not offline test execution.

Local runs copy source excluding business `.env`, `.dev.vars` and their environment variants. Business subprocesses use an environment allowlist without GitHub, deployment or platform secrets. Only credential-free proxy settings survive dependency preparation. Local image builds label the exact Git HEAD and never push. Fixtures run in a Node/Debian container with no network; cleanup inspects/removes only this batch's unique container/image and fails on uncertain cleanup. Budget is 30 minutes. No local or cloud build proves real Memoia/model calls or Access acceptance.

The allowlist retains the pnpm tool directory `PNPM_HOME`, so local dependency installation reuses the configured package store. Registry, platform and business credentials remain excluded.

Long checks finish before the push connection opens. The pre-push hook validates the exact commit and remote Test baseline for that invocation, refuses dirty or changed source, stale proof, force updates and Test deletion. Direct Test pushes are refused. Internal proof is not a security credential or cache and must not be forged/reused; do not bypass hooks. Installation refuses an existing hook manager rather than overwriting it. Update/install each checkout and verify default-branch workflow registration after merging; do not dispatch Actions merely to test that ordinary pushes remain quiet.

Manual Test selection is checked against the current Test branch before registry access and image construction, then checked again before deployment. `INSPECTOR_TEST_DEPLOY_ENABLED`, package identity/anonymous-pull checks and existing runtime recovery gates still apply. Changes to this source do not establish that a new organization GHCR package can be pulled or that Online is ready.

### Registering the replacement workflow

Register the `workflow_dispatch` Test entry on the default branch with authorization, and keep matching scripts/deployment contracts on Test. Registration does not require merging unaccepted application changes to main. Read back triggers: no Test push, no development/Test PR or duplicate main push Verify; check hooks/dependencies.

If the workflow is disabled, enable it only after source confirmation with `gh workflow enable deploy-test.yml --repo jianify-llc/memoia-inspector`; never restore the old push trigger. Dispatch only an authorized acceptance batch. Local checks, default-branch registration and actual Test deployment are separate acceptance steps.

## Release and Online boundary

Feature branches start from `main`, enter Test after local checks and explicit manual acceptance, then the same feature enters Release. Release push does not run Actions. Only a stable `v*` tag at Release HEAD starts Online: Release tag guard → native AMD64/ARM64 runners each build once → validate anonymous pull, source, architecture and local health → assemble/verify the same manifest → Online approval → deploy that digest. No build after approval. Existing version identities are validated/reused, never silently overwritten; registry errors are not absence. Test exports minimal cache in its AMD64 scope; Online keeps separate AMD64/ARM64 cache scopes. Per-platform receipts belong to the current run and can be replaced by a failed-job rerun, while assembly revalidates SHA/digest. Test/Release SHAs need not produce the same digest.

Only the tag's `deploy-online` job references the `online` GitHub Environment. That Environment must require approval by `jianify`, permit self-review, disable administrator bypass, and allow only `v*` tags; its deployment credentials must not be repository-level secrets. Approval releases the Online SSH credentials and deploys the exact validated digest. The Online host, dedicated SSH key, secrets, Access/Tunnel route, and business acceptance have **not** been configured or verified in this Test-only rollout. The workflow's local health check does not prove Cloudflare Access isolation or management correctness; those remain explicit Online acceptance requirements before `release` is archived to `main`.
