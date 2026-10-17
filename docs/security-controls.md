# Security controls

What validates this repository, where each control lives, and what it would need under an
enterprise or private-repository setup. Verified against the repository on 2026-10-17.

## Repository status at verification

- **Visibility: public**, owned by a personal account. Public repositories receive GitHub's
  code-security features at no cost. **If the repository is made private, several controls
  below need a paid licence** (see the last column); they must then be licensed, not removed
  or replaced.

## Automated controls

| Control                                                                                                                              | Where                       | Status      | Needs if the repository becomes private         |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ----------- | ----------------------------------------------- |
| Lint and formatting                                                                                                                  | `ci.yml` → `lint`           | Implemented | —                                               |
| Unit tests on Windows and Linux, coverage report                                                                                     | `ci.yml` → `unit-tests`     | Implemented | Windows runners use 2× minutes on private repos |
| Production build and no-database smoke test                                                                                          | `ci.yml` → `build`          | Implemented | —                                               |
| npm audit: **fails** on high/critical in production dependencies; reports dev dependencies                                           | `ci.yml` → `security`       | Implemented | —                                               |
| Dependency review: blocks PRs adding high/critical vulnerable runtime dependencies or licences outside the policy below              | `ci.yml` → `security`       | Implemented | **GitHub Code Security**                        |
| CodeQL static analysis (security-extended queries) on PRs, `main` and weekly                                                         | `codeql.yml`                | Implemented | **GitHub Code Security**                        |
| Database integration: migrations (idempotent), runtime least privilege, live password rotation, lockout exposure, no secrets in logs | `ci.yml` → `db-integration` | Implemented | —                                               |
| Production smoke test against a real database                                                                                        | `ci.yml` → `db-integration` | Implemented | —                                               |
| Browser test (Playwright, Chromium)                                                                                                  | `ci.yml` → `e2e-browser`    | Implemented | —                                               |
| Single required check that aggregates all jobs                                                                                       | `ci.yml` → `ci-passed`      | Implemented | —                                               |
| Dependabot version updates (npm and pinned actions)                                                                                  | `.github/dependabot.yml`    | Implemented | —                                               |

## Repository settings (configured in GitHub, not in code)

| Control                                                                                                                                        | Status at verification                    | Action                                            | Needs if private                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| Secret scanning                                                                                                                                | **Enabled**                               | —                                                 | **GitHub Secret Protection**                 |
| Push protection                                                                                                                                | **Enabled**                               | —                                                 | **GitHub Secret Protection**                 |
| Dependabot alerts                                                                                                                              | Disabled                                  | Enable: Settings → Advanced Security              | Free                                         |
| Dependabot security updates                                                                                                                    | Disabled                                  | Enable: Settings → Advanced Security              | Free                                         |
| Branch ruleset on `main`: require PR, require `CI passed` (and `Analyze JavaScript`), require up-to-date branch, block force-push and deletion | **Not configured**                        | Create: Settings → Rules → Rulesets               | **GitHub Pro** (personal) or Team/Enterprise |
| Allowed actions restricted / SHA pinning required                                                                                              | All actions allowed; pinning not required | Optional tightening: Settings → Actions → General | Free                                         |

## Workflow hardening

- Workflows get `contents: read` only; CodeQL alone adds `security-events: write`.
- Every action is pinned to a full commit SHA (version in a comment); Dependabot updates them.
- `actions/checkout` runs with `persist-credentials: false`.
- No `pull_request_target`; PR code never runs with secrets or write access.
- No repository secrets: the CI database's passwords are generated per run and masked.
- Every job has a timeout; superseded runs on the same PR are cancelled.

## Licence policy (POC)

Allowed licences for dependencies: MIT, MIT-0, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause,
0BSD, BlueOak-1.0.0, CC0-1.0, CC-BY-4.0 and MPL-2.0. At adoption, the only MPL-2.0 packages were
`lightningcss` (a build tool, not shipped) and the only CC-BY-4.0 package was `caniuse-lite`
(browser data). An enterprise licence policy should replace this list.

## Database certificate validation

`DB_TRUST_SERVER_CERTIFICATE=true` is permitted only for local Phase 1 development and the
disposable CI SQL Server container, which use self-signed certificates. The code default is
`false`; TEST and PROD must validate the server certificate.

## Future enterprise requirements (not met by this POC)

- **Human approval** of pull requests (required reviewers, CODEOWNERS); Phase 1 relies on
  automated checks only, by decision.
- **Licences** for GitHub Code Security and Secret Protection if the repository is private.
- **Branch rulesets** enforced by the organisation.
- **PAM-backed credential provider** and two-account rotation (the plug-in point exists).
- **Windows SQL Server lockout behaviour** is not reproduced in CI (the Linux container has
  no Windows lockout policy); the cooldown logic is covered by unit tests.
- **Trusted certificates** on TEST/PROD SQL Server instances.
