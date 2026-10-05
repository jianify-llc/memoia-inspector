# Test deployment

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

Source management uses the fixed SDK 0.5.0 read contract: source lists contain summaries; message IDs, input batches and evidence each load bounded pages on demand. Each collection advances its own offset, and only a returned null next-offset means exhaustion. The UI does not fetch the complete historical source automatically or treat the first page as complete. Paging is not a transaction snapshot; refresh after concurrent mutations. Missing pagination fields from an older backend fail validation, so deploy the matching Memoia API before this Inspector candidate. Existing management writes, same-origin protection and explicit operation recovery are unchanged.

The shared `verify.yml` runs code/SDK checks and selects tool checks by mode below. PR/full include a native Docker build without push; publishing Verify does not run host `pnpm build` or duplicate that build. `deploy-test.yml` explicitly verifies the current Test SHA, runs publish-mode Verify, then publishes AMD64 once per SHA without QEMU and confirms anonymous pull/source identity. A historical multi-arch image may be reused if its AMD64 and source pass. With the gate enabled, `apply` replaces only Inspector; changed Compose/runtime config, stale run, unresolved attempt or wrong source blocks deployment.

Next.js and related versions have one source: `package.json` plus the frozen lockfile, not repeated patch assertions in workflows. The current requested `15.5.26` baseline is unchanged by CI simplification; check current official advisories before Online approval. A passing audit/build does not establish complete security acceptance. Keep origin loopback-only and Access on the whole hostname.

The host records `current` (last accepted image), `previous` (accepted image before it), and any unresolved `pending` candidate under `/opt/memoia-inspector/.deploy`. If activation or health validation fails, the script stops the failed candidate when it is the running container and keeps `pending` plus container logs for investigation. A failed first install has no accepted image: investigate, then use `clear-pending <exact-source-sha>` before retrying `init`.

For a failed A → B update, `current` still identifies A; `previous` may be absent or older than A. After investigating the failed operation, use `restore-api <current-image> <current-source-sha> <pending-run-id> <pending-source-sha>`. This explicitly restarts A, archives the failed B record, and retains the run-ID high-water mark. It can reuse the locally cached accepted image if GHCR is unavailable. Do **not** clear `pending` merely to retry CI. Once B has been accepted, an intentional rollback instead uses `restore-api <previous-image> <previous-source-sha> <new-run-id>` with no pending candidate. Routine deployment also refuses to replace a container that differs from the accepted `current` record. Image restoration does **not** undo management changes made against Memoia. Recheck Access and management operations after recovery.

Manual acceptance must cover: unauthorized Access denial; no direct public port 3001; correct and incorrect Memoia token; failed and successful user deletion/config update with read confirmation; project switch and credential loss; user/profile/event reads; container restart; memory/OOM. With blank model settings, confirm the visible Playground chat returns unavailable without creating a test user or writing memory. Real streaming chat, insert, and flush are required only if optional model settings are enabled. Automated local health checks do not establish these external boundaries. If no second compatible digest exists, cross-version update/restore remains unverified.

## Local checks and explicit Test acceptance

The [company branch/release policy](https://github.com/jianify-llc/Jianify-LLC/blob/main/docs/engineering/branch-release.md) owns the shared rules. Ordinary development/Test/release pushes and development PRs do not start Actions. Only pull requests archiving to main and their merge queue retain Required Verify; Online tags and approval remain separate.

```bash
pnpm hooks:install
pnpm ci:local --mode quick --base <remote-Test-SHA>
pnpm ci:local --mode full
# After committing this batch, from its clean worktree:
pnpm push:test
# Only for an explicitly authorized Test acceptance batch:
gh workflow run deploy-test.yml --ref test --repo jianify-llc/memoia-inspector
```

Local and remote Verify use `scripts/verify_local.py` (default full):

| Mode | Business checks | Tool/build checks |
| --- | --- | --- |
| quick | Frozen install, SDK identity, typecheck, lint, offline/mock tests | Reliable-base diff selects tooling; no ordinary Docker build/audit |
| full | All business checks and production dependency audit | All tool fixtures and native Docker build, no push |
| publish | Fixed full business checks and audit | No historical-base inference, tool regression, host build or Docker build |
| pr | Full business checks/audit | PR/merge-queue base selects tools; native Docker build remains |

Missing/unreadable base expands tool checks; `push:test` obtains the exact remote Test base before quick. Python 3, Node and pnpm 10.12.4 are always needed; ShellCheck/Docker are required only by selected modes. Dependency downloads are preparation, not offline test execution.

Local runs copy source excluding business .env files. Cloud `--checkout` validates a clean candidate directly, with history prefetched and checkout credentials disabled. Business subprocesses use an environment allowlist without deployment/platform secrets. Only credential-free proxy settings survive dependency preparation. Fixtures run with no network; cleanup inspects/removes only this batch's unique container/image and fails on uncertain cleanup. Budget is 30 minutes. No mode calls real Memoia/models or proves Access acceptance.

The allowlist retains the pnpm tool directory `PNPM_HOME`, so dependency installation uses the same package store that `setup-node` caches. Registry, platform and business credentials remain excluded.

Long checks finish before the push connection opens. The pre-push hook validates the exact commit and remote Test baseline for that invocation, refuses dirty or changed source, stale proof, force updates and Test deletion. Direct Test pushes are refused. Internal proof is not a security credential or cache and must not be forged/reused; do not bypass hooks. Installation refuses an existing hook manager rather than overwriting it. Update/install each checkout and verify default-branch workflow registration after merging; do not dispatch Actions merely to test that ordinary pushes remain quiet.

Manual Test selection is checked against the current Test branch before Verify and image construction. `INSPECTOR_TEST_DEPLOY_ENABLED`, package identity/anonymous-pull checks and existing runtime recovery gates still apply. Changes to this source do not establish that a new organization GHCR package can be pulled or that Online is ready.

### Registering the replacement workflow

Register the `workflow_dispatch` Test entry on the default branch with authorization, and keep matching scripts/deployment contracts on Test. Registration does not require merging unaccepted application changes to main. Read back triggers: no Test push, no development/Test PR or duplicate main push Verify; check hooks/dependencies.

If the workflow is disabled, enable it only after source confirmation with `gh workflow enable deploy-test.yml --repo jianify-llc/memoia-inspector`; never restore the old push trigger. Dispatch only an authorized acceptance batch. Local checks, default-branch registration and actual Test deployment are separate acceptance steps.

## Release and Online boundary

Feature branches start from `main`, enter Test after local checks and explicit manual acceptance, then the same feature enters Release. Release push does not run Actions. Only a stable `v*` tag at Release HEAD starts Online: publish Verify → native AMD64/ARM64 runners each build once → validate anonymous pull, source, architecture and local health → assemble/verify the same manifest → Online approval → deploy that digest. No build after approval. Existing version identities are validated/reused, never silently overwritten; registry errors are not absence. Per-platform receipts belong to the current run and can be replaced by a failed-job rerun, while assembly revalidates SHA/digest. Test/Release SHAs need not produce the same digest.

Only the tag's `deploy-online` job references the `online` GitHub Environment. That Environment must require approval by `jianify`, permit self-review, disable administrator bypass, and allow only `v*` tags; its deployment credentials must not be repository-level secrets. Approval releases the Online SSH credentials and deploys the exact validated digest. The Online host, dedicated SSH key, secrets, Access/Tunnel route, and business acceptance have **not** been configured or verified in this Test-only rollout. The workflow's local health check does not prove Cloudflare Access isolation or management correctness; those remain explicit Online acceptance requirements before `release` is archived to `main`.
