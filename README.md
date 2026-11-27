# Scheme Saathi

An application-readiness companion for Indian citizens. Scheme Saathi turns a citizen's situation (in Hindi, Hinglish, or English) into a verified, explainable action plan using live official criteria from [myScheme](https://www.myscheme.gov.in), a Ready / Missing document checklist, and direct links to official application channels.

## Key Capabilities

- **Fewer, better questions**: Uses `gemini-decision-1` (Decisions API, `v1beta`) to gate citizen-services queries, classify journeys (`farmer`, `student`, `health`, `livelihood`, `other`), score profile completeness, and check confidence (`< 0.75` triggers clarification or escalation).
- **Tiered Gemini 4 routing**: Uses `gemini-4-hydrogen` (`thinking_level: "medium"`) via the stateful Interactions API (`previous_interaction_id`) for routine question planning, Hindi/English replies, and document field extraction; escalates to `gemini-4-neon` (`thinking_level: "high"`) only for ambiguous or conflicting eligibility cases.
- **Live official criteria from myScheme**: Server-side fetcher respects `robots.txt`, rate-limits outbound requests, uses an honest User-Agent, verifies live URLs, and caches extracted criteria in server memory for 24 hours. Never falls back to mocked or pre-written criteria.
- **Consent-first privacy**: Explicit, per-session, revocable consent before any document photo is analyzed. Documents are processed strictly in memory—never persisted or logged—and Aadhaar numbers are masked to the last 4 digits (`XXXX-XXXX-1234`).
- **No silent submission + Human handoff**: Never submits applications externally. Links citizens to official portals/CSC and surfaces official helplines whenever confidence is low or criteria conflict.
- **Built-in Evaluation Harness (`/eval`)**: Runs 3 synthetic profiles (`complete`, `incomplete`, `ambiguous`) in both English and Hindi, reporting explanation accuracy, checklist completeness, source traceability, latency, bilingual completion, and estimated session cost.

## Architecture & Shared Model Constants

All Gemini model IDs are centralized in `/shared/models.ts`:
- `MODELS.DECISION` = `"gemini-decision-1"` (`ai.decisions.create`, `apiVersion: "v1beta"`)
- `MODELS.HYDROGEN` = `"gemini-4-hydrogen"` (`ai.interactions.create`, `thinking_level: "medium"`)
- `MODELS.NEON` = `"gemini-4-neon"` (`ai.interactions.create`, `thinking_level: "high"`, escalation only)

## Environment Variables

Copy `.env.example` or configure these variables in **AI Studio > Settings > Secrets** (or Cloud Run environment variables):

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Yes | — | Paid Gemini API key (server-side only; required for `gemini-4-neon`, `gemini-4-hydrogen`, and `gemini-decision-1`). |
| `APP_URL` | No | Auto-injected | Hosted application URL. |
| `SESSION_TOKEN_CAP` | No | `45000` | Maximum combined input + output tokens per citizen session. |
| `DAILY_SPEND_CAP_USD` | No | `5.00` | Global daily estimated spend ceiling across all sessions. |
| `MYSCHEME_CACHE_TTL_HOURS` | No | `24` | In-memory cache duration (hours) for live myScheme fetches. |

## Local Development

```bash
npm install
npm run dev
```

The server starts on `http://localhost:3000`.
- Citizen companion: `/`
- Synthetic evaluation harness: `/eval`

## Production Build & Cloud Run Deployment

Scheme Saathi is ready for AI Studio Build's one-click Cloud Run deployment:

```bash
npm run build
npm start
```

- `npm run build` compiles the React/Vite client into `dist/`.
- `npm start` runs `node server.ts` on `0.0.0.0:${PORT:-3000}` serving `/api/*` routes and the compiled frontend.
- For lowest latency and direct `api.myscheme.gov.in` access, deploying Cloud Run in an India region (e.g., `asia-south1`) is recommended; outside India, the server automatically uses live grounded `myscheme.gov.in` retrieval with live HTTPS URL verification.
