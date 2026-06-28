# PostHog Self-driving Setup Report

_Generated: 2026-06-28 — Aura Watch AI (project 91108)_

## Summary

PostHog Self-driving has been configured for this project. Signal sources for error tracking, session replay, and GitHub Issues are now active; the scout troop is trimmed to three scouts suited to this product's heaviest surfaces (LLM analytics and product analytics). Findings will start appearing in the [Self-driving inbox](https://eu.posthog.com/project/91108/inbox) within ~30 minutes as the scout coordinator picks up the new configs.

---

## AI data processing

**Status: approved.** Organization-level AI data processing consent was granted before this run started.

---

## GitHub

**Connected during this run.**

| Field | Value |
|---|---|
| Integration ID | 68611 |
| Account | ankur-kushwaha |
| Connected at | 2026-06-28T06:59:26Z |

GitHub access lets Self-driving research findings against your code and open fix PRs directly.

---

## Signal sources

| source\_product | source\_type | Action | Notes |
|---|---|---|---|
| `signals_scout` | `cross_source_issue` | **On by default** | Scout gate is enabled by default; no row needed |
| `error_tracking` | `issue_created` | **Enabled** | id: 019f0d07-5e46-7253-a189-c0a8130ebb3d |
| `error_tracking` | `issue_reopened` | **Enabled** | id: 019f0d07-6371-79f0-a855-8b7a8f100c3b |
| `error_tracking` | `issue_spiking` | **Enabled** | id: 019f0d07-666b-74b2-a5e3-051ea9b3b1e2 |
| `session_replay` | `session_analysis_cluster` | **Enabled** | id: 019f0d07-68c8-70fe-b636-089b88cefa36; sample\_rate: 0.1 |
| `github` | `issue` | **Enabled** | id: 019f0d09-2e61-715c-b224-de8d695ed220 |
| `conversations` | `ticket` | **Skipped** | Project profile unavailable (first run); enable manually if the team uses PostHog support/conversations |
| `llm_analytics` | — | **Skipped** | Not a user-facing responder (internal-only) |
| `logs` | — | **Skipped** | Not a v1 responder |

---

## Connected tools

| Tool | Status | Detail |
|---|---|---|
| **GitHub Issues** | Connected by this setup | Warehouse source id: `019f0d09-111f-0000-658d-ffff293ba12a`; repo: `ankur-kushwaha/aura-watch`; `issues` table syncing (incremental on `updated_at`). First sync started automatically. Additional tables (e.g. pull\_requests) can be enabled in the UI at [Data sources](https://eu.posthog.com/project/91108/data-management/sources). |
| **Linear** | Not used | Not selected |
| **Zendesk** | Not used | Not selected |
| **pganalyze** | Not used | Not selected |

---

## Scout troop

**3 scouts enabled, 17 disabled.**

### Enabled

| Scout | Reason |
|---|---|
| `signals-scout-general` | Always on — cross-product explorer, sweeps surfaces no specialist covers |
| `signals-scout-ai-observability` | Strongest evidence in this repo: `@posthog/ai` wraps both OpenAI and Gemini clients (`posthogClients.ts`); LLM analytics is the core AI feature of this product |
| `signals-scout-product-analytics` | `posthog-js` (frontend) and `posthog-node` (backend) both actively instrumented; session recordings confirmed active today |

### Disabled

| Scout | Reason |
|---|---|
| `signals-scout-error-tracking` | **Covered by native source** — error\_tracking rows (issue\_created / issue\_reopened / issue\_spiking) handle this pipeline; no duplicate scout needed |
| `signals-scout-session-replay` | **Covered by native source** — session\_replay / session\_analysis\_cluster source handles this pipeline |
| `signals-scout-anomaly-detection` | Not among top-2 specialist surfaces for this project |
| `signals-scout-apm` | No OpenTelemetry spans/APM evidence in this repo |
| `signals-scout-csp-violations` | No Content-Security-Policy reporting configured |
| `signals-scout-customer-analytics` | No group analytics (Accounts product) evidence |
| `signals-scout-data-pipelines` | No CDP destinations, batch exports, or hog flows evidence |
| `signals-scout-experiments` | No A/B experiments in use |
| `signals-scout-feature-flags` | No feature flag usage found in repo |
| `signals-scout-health-checks` | Not in top-2 specialist slots |
| `signals-scout-inbox-validation` | Inappropriate for fresh setup with no resolved findings yet |
| `signals-scout-logs` | No PostHog logs product in use |
| `signals-scout-observability-gaps` | Not in top-2 specialist slots |
| `signals-scout-replay-vision` | No Replay Vision scanners configured |
| `signals-scout-revenue-analytics` | No Stripe SDK or revenue analytics — `Pricing.tsx` exists on the frontend but no payment SDK in `package.json` |
| `signals-scout-surveys` | No surveys evidence |
| `signals-scout-web-analytics` | Not in top-2 specialist slots |

To re-enable a specialist later, go to [Self-driving inbox settings](https://eu.posthog.com/project/91108/inbox) and flip its toggle.

---

## Custom scouts

**Proposed: 1. Declined by user: 1. Created: 0.**

### Proposed and declined

**Camera detection pipeline health** — would have watched `process_video_clip` and `process_motion_clip_metadata` backend events for:

- Cameras going silent (no clips uploaded for a device that was previously active)
- Clips where YOLO detected objects (`trackEventCount > 0`) but the re-identification step produced zero links — a quality regression in the ReID pipeline
- Processing error patterns per device/stream

**Discriminator:** per-camera detection rate and clip upload volume against a 7-day trailing baseline — the fleet-holds-one-breaks pattern that separates a real device outage from an org-wide change.

**Why no built-in covers it:** `signals-scout-ai-observability` covers `$ai_*` LLM events (not video processing), `signals-scout-product-analytics` covers behavioral funnels (not backend pipeline health), and the error\_tracking native source covers JavaScript exceptions (not silent detection failures).

If you change your mind, this scout can be created at any time — ask Claude Code to write a custom `signals-scout-camera-detection-pipeline` skill watching `process_video_clip` events.

**Noise escape hatch:** if any scout turns noisy, set `emit: false` on its config in PostHog to switch it to dry-run (it still runs and logs reasoning, but writes nothing to the inbox).

---

## Follow-ups

- [ ] **Support/conversations source** — the project profile was unavailable on this first run. If your team uses PostHog support/conversations, enable the `conversations` / `ticket` signal source manually in the [Self-driving inbox](https://eu.posthog.com/project/91108/inbox).
- [ ] **Enable exception autocapture** — error tracking sources are now armed, but no `$exception` events were found. Enable exception autocapture in [Project settings](https://eu.posthog.com/project/91108/settings/environment-integrations) to start capturing frontend errors automatically.
- [ ] **GitHub Issues additional tables** — only the `issues` table is syncing. To sync pull requests or other tables, visit [Data sources](https://eu.posthog.com/project/91108/data-management/sources) and enable them on the GitHub source.
- [ ] **Re-enable specialist scouts as surfaces grow** — `signals-scout-feature-flags` (if you add flags), `signals-scout-experiments` (if you run A/B tests), `signals-scout-surveys` (if you add surveys). Flip their toggles in the inbox settings.

---

## What happens next

The scout coordinator picks up fresh configs within ~30 minutes. `signals-scout-general`, `signals-scout-ai-observability`, and `signals-scout-product-analytics` will each fire on their first tick and begin writing durable memory. Findings that clear the confidence bar will appear as reports in your inbox — immediately-actionable ones will include suggested code fixes and can kick off coding tasks directly.

**Inbox:** https://eu.posthog.com/project/91108/inbox
