# REST API Specification — Scheme Saathi

**Base URL:** `/api` (served on port `3000` by `server.ts`)  
**Content-Type:** `application/json` (max body size `10 MB`)  
**Supported Language Codes:** `"en" | "hi" | "mr" | "ta" | "te" | "bn" | "kn" | "gu"`

---

## 1. Health & Configuration

### `GET /api/health`
Liveness check for local development and Cloud Run health probes.
- **Response `200 OK`:**
  ```json
  { "ok": true, "service": "scheme-saathi" }
  ```

### `GET /api/maps/config`
Returns whether the scoped browser Google Maps Platform key is configured for the Help Centre Locator modal.
- **Response `200 OK`:**
  ```json
  { "configured": true, "apiKey": "<VITE_GOOGLE_MAPS_API_KEY>" }
  ```

---

## 2. Session Lifecycle

### `POST /api/session/reset`
Creates a fresh in-memory citizen session or clears an existing session and its token ledger.
- **Request Body:**
  ```json
  {
    "sessionId": "optional-alphanumeric-id-8-to-64-chars",
    "language": "en"
  }
  ```
- **Response `200 OK`:** `{ "session": SessionSnapshot }`

### `POST /api/session/restore`
Hydrates an in-memory server session from a sanitized client `localStorage` snapshot (never accepts uploaded photos or raw IDs; forces `documentConsentGranted: false`).
- **Request Body:**
  ```json
  {
    "sessionId": "optional-id",
    "language": "mr",
    "questionCount": 2,
    "plan": { "...sanitized PlanState..." }
  }
  ```
- **Response `200 OK`:** `{ "session": SessionSnapshot }`

### `POST /api/session/consent`
Grants or revokes explicit per-session document photo inspection consent. Revoking (`granted: false`) immediately wipes extracted document summaries and masked identifiers from server session state.
- **Request Body:**
  ```json
  {
    "sessionId": "sess_abc12345",
    "granted": true,
    "language": "en"
  }
  ```
- **Response `200 OK`:** `{ "session": SessionSnapshot }`

---

## 3. Citizen Eligibility & Document Workflows

### `POST /api/chat`
Processes one citizen conversational turn through `gemini-decision-1` gating, live `myScheme` retrieval, calibrated scheme scoring, and `gemini-4-hydrogen` (or `gemini-4-neon` on conflict/ambiguity).
- **Request Body:**
  ```json
  {
    "sessionId": "optional-existing-session-id",
    "message": "I am a smallholder farmer with 2 acres in Maharashtra.",
    "language": "mr",
    "location": {
      "stateCode": "MH",
      "stateName": "Maharashtra",
      "district": "Pune"
    }
  }
  ```
  - `message`: required, `1..1500` chars.
  - `location`: optional (`stateCode` 2–4 chars, `stateName` 2–80 chars, optional `district` <= 80 chars).
- **Response `200 OK`:**
  ```json
  {
    "session": { "...SessionSnapshot..." },
    "assistantMessage": {
      "id": "a_...",
      "role": "assistant",
      "text": "...",
      "timestamp": "2026-11-27T08:49:00.000Z",
      "choices": [{ "label": "...", "value": "..." }],
      "isClarification": false,
      "escalated": false
    },
    "routingMeta": {
      "isCitizenServicesQuery": true,
      "journeyConfidence": 0.94,
      "completenessScore": 2,
      "completenessConfidence": 0.88,
      "escalatedToNeon": false,
      "modelUsed": "gemini-4-hydrogen"
    }
  }
  ```
- **Error Responses:** `400 INVALID_REQUEST`, `429 DEMO_LIMIT_REACHED`, `429 UPSTREAM_RATE_LIMIT`, `503 API_CONFIGURATION_ERROR`.

### `POST /api/session/recheck`
Re-evaluates eligibility using edited "What-If" citizen facts without starting a new session.
- **Request Body:**
  ```json
  {
    "sessionId": "sess_abc12345",
    "knownFacts": [
      "Smallholder farmer in Uttar Pradesh",
      "Land area: 1.5 acres",
      "Annual family income: Rs 1.8 lakh"
    ],
    "location": { "stateCode": "UP", "stateName": "Uttar Pradesh" },
    "language": "en"
  }
  ```
  - `knownFacts`: `1..25` strings, each `1..240` chars.
- **Response `200 OK`:** `ChatTurnResponse` (updated `session`, `assistantMessage`, `routingMeta`).

### `POST /api/document/analyze`
Verifies a citizen's uploaded document photo strictly in server memory (requires active session consent).
- **Request Body:**
  ```json
  {
    "sessionId": "sess_abc12345",
    "claimedType": "aadhaar",
    "mimeType": "image/jpeg",
    "imageBase64": "<base64-string-max-6MB-decoded>",
    "language": "en"
  }
  ```
  - `claimedType`: `"aadhaar" | "land_record" | "bank_passbook" | "income_certificate" | "caste_certificate" | "ration_card" | "student_id_marksheet" | "artisan_business_proof" | "other"`
  - `mimeType`: `"image/jpeg" | "image/png" | "image/webp"`
- **Response `200 OK`:**
  ```json
  {
    "session": { "...SessionSnapshot with updated documents[]..." },
    "assistantMessage": { "...ChatMessage with documentEvent..." },
    "verification": {
      "matchesClaimedType": true,
      "matchConfidence": 0.91,
      "isLegible": true,
      "extractedSummary": "Masked summary...",
      "maskedIdentifier": "XXXX-XXXX-4321",
      "escalatedForReview": false
    }
  }
  ```
- **Error Responses:** `400 FILE_TOO_LARGE`, `400 INVALID_REQUEST`, `403 CONSENT_REQUIRED`, `429 DEMO_LIMIT_REACHED`.

---

## 4. Official Scheme Retrieval & Operational Status

### `GET /api/schemes/journey/:journey`
Fetches live official `myscheme.gov.in` criteria for one journey (`farmer | student | health | livelihood`). Supports optional `?refresh=true` to bypass the 24h in-memory cache.
- **Response `200 OK`:** `SchemeFetchBundle`

### `GET /api/schemes/status`
Returns non-PII operational summary of cached `myScheme` journeys and UTC daily budget ledger.
- **Response `200 OK`:**
  ```json
  {
    "cachedJourneys": [],
    "dailyBudget": {
      "dateUtc": "2026-11-27",
      "dailySpendUsd": 0.012,
      "dailySpendCapUsd": 5.0,
      "totalTokens": 8420,
      "callCount": 6
    }
  }
  ```

---

## 5. Synthetic Evaluation Harness (`/eval`)

### `GET /api/eval/cases`
Lists built-in synthetic test profiles (`complete`, `incomplete`, `ambiguous` across English and Hindi).

### `POST /api/eval/run`
Executes all or selected synthetic evaluation cases and returns accuracy, checklist completeness, source traceability, latency, and cost metrics.
- **Request Body:** `{ "caseIds": ["optional-subset-max-6"] }`
- **Response `200 OK`:** `EvalSuiteReport`
