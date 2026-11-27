# Security, Privacy & AI Safety Architecture — Scheme Saathi

**Document Version:** 1.0

---

## 1. Privacy-by-Design Principles

Scheme Saathi is engineered for sensitive Indian citizen workflows (Aadhaar, land records, income/caste certificates, bank passbooks) using **zero-storage privacy defaults**:

1. **No Server Database for Citizen Data:** Citizen conversations, extracted facts, and document checks live exclusively in transient server RAM (`Map<string, InternalSession>`) and disappear on session reset or server restart.
2. **Explicit, Per-Session, Revocable Photo Consent:**
   - The frontend presents `ConsentModal.tsx` explaining in-memory-only processing, masking, and non-submission before opening the photo upload sheet.
   - The backend enforces `session.documentConsentGranted === true` on `POST /api/document/analyze`, returning `403 CONSENT_REQUIRED` if bypassed.
   - Revoking consent (`POST /api/session/consent` with `granted: false`) immediately clears extracted document details and masked identifiers from session state.
3. **Sanitized Client-Local Save/Resume (`src/lib/sessionStorage.ts`):**
   - Optional "Save Progress" writes only to the citizen's own browser `localStorage`.
   - Uploaded photos are never stored in browser storage, `maskedIdentifier` fields are stripped prior to serialization, and `documentConsentGranted` is forced to `false` on restore.
4. **Opt-In Browser Geolocation:**
   - Location is requested **only** when the citizen taps *"Use my location"* inside the Help Centre Locator modal, used strictly to center the map and bias nearby CSC/Tehsil/Bank search, and never stored or transmitted to our backend.

---

## 2. Defense-in-Depth PII Masking

Raw citizen identifiers are scrubbed across **four independent layers**:

| Layer | Module | Protection |
| --- | --- | --- |
| **Server Response Sanitization** | `server/piiMasker.ts` | Masks 12-digit Aadhaar patterns (`\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b`) to `XXXX-XXXX-1234` and 9–18 digit bank accounts to `XXXX1234`. |
| **Server Logging** | `server/costGuard.ts`, `server.ts` | Logs only structured non-PII JSON telemetry (`event`, `model`, `callType`, token counts, estimated USD cost, truncated error message). Never logs citizen messages, photos, or IDs. |
| **Shareable Summary Export** | `src/lib/shareChecklist.ts` | `stripSensitiveNumbers()` re-scrubs Aadhaar and long numeric sequences before Clipboard, WhatsApp, or SMS output. |
| **Calendar `.ics` Export** | `src/lib/calendarReminder.ts` | `scrubSensitiveNumbers()` strips accidental 12-digit Aadhaar or 9–18 digit account numbers from reminder titles and notes prior to `.ics` generation. |

---

## 3. Application & Network Security Controls

### 3.1 Secret Management
- `GEMINI_API_KEY` is strictly server-side (`process.env.GEMINI_API_KEY`) and never bundled into client assets.
- `VITE_GOOGLE_MAPS_API_KEY` is a scoped browser key used solely for Maps JavaScript API & Places API (New) and should be restricted by HTTP referrer and API scope in Google Cloud Console.

### 3.2 Input Validation & Payload Limits
- Every `/api/*` endpoint validates request bodies and path parameters using **Zod** (`server.ts`) with explicit string length, array size, and regex bounds (`SessionIdSchema`).
- Express JSON body limit is capped at `10 MB`; `POST /api/document/analyze` independently verifies decoded base64 image size `<= 6 MB` (`SESSION_LIMITS.MAX_DOCUMENT_BYTES`).
- HTTP hardening: `app.disable("x-powered-by")`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`.

### 3.3 SSRF & Outbound Fetch Protection (`server/mySchemeService.ts`)
- `validateOfficialUrl()` allows **only** `https:` URLs targeting `myscheme.gov.in`, `www.myscheme.gov.in`, `api.myscheme.gov.in`, or verified Indian public domains ending in `.gov.in`, `.nic.in`, or `.org.in`.
- Blocks `localhost`, `.local`, `.internal`, and all raw IPv4/IPv6 literals (including cloud metadata endpoints like `169.254.169.254` and RFC 1918 private ranges).
- Respects `myscheme.gov.in/robots.txt`, enforces a `>= 350ms` outbound request throttle, and applies `AbortController` timeouts.

### 3.4 Frontend XSS & Link Safety
- Zero use of `dangerouslySetInnerHTML`, `eval`, or `window.open`.
- Every external link rendered in `PlanPanel.tsx`, `SchemeCompareModal.tsx`, `HelpCentreLocatorModal.tsx`, and exported in `shareChecklist.ts` / `calendarReminder.ts` is validated via `new URL(rawUrl).protocol === "https:"` and rendered with `rel="noopener noreferrer"`.

---

## 4. AI Grounding, Calibration & Anti-Hallucination Controls

1. **Calibrated Confidence Only:** Scheme confidence badges (`High`, `Medium`, `Low`) are derived exclusively from `gemini-decision-1` probabilities and confidence scores (`CONFIDENCE_THRESHOLDS`), never from unconstrained LLM self-reporting.
2. **Honest Grounding & Unavailability Handling:** All scheme criteria must originate from live `myscheme.gov.in` retrieval. If live retrieval is unavailable, the UI surfaces an explicit warning banner and directs the citizen to `https://www.myscheme.gov.in/` rather than fabricating criteria.
3. **Mandatory Human Handoff:** Whenever `gemini-decision-1` flags conflicting eligibility criteria, low confidence (`< 0.75`), or escalates to `gemini-4-neon`, the UI displays official CSC, helpline, and nearby help-centre map options.
4. **No Silent Application Submission:** Disclaimers clearly state *"Potential match, official verification required"* and *"Scheme Saathi never submits applications for you"*.
5. **Cost & Abuse Guardrails:** `server/costGuard.ts` enforces per-session token caps (`SESSION_TOKEN_CAP`, default `45,000`) and daily UTC spend caps (`DAILY_SPEND_CAP_USD`, default `$5.00`), returning structured `429 DEMO_LIMIT_REACHED` responses cleanly.
