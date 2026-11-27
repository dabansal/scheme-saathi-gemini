# Scheme Saathi

An application-readiness companion for Indian citizens built with **Material Design 3**, **React 19**, **Express**, **Google Gemini**, and **Google Maps Platform**. Scheme Saathi turns a citizen's situation in **8 Indian languages** into a verified, explainable action plan using live official criteria from [myScheme](https://www.myscheme.gov.in), an interactive Ready / Missing document checklist, and direct links to official application channels.

## Documentation

| Document | Description |
| --- | --- |
| [**High-Level Design (`docs/HLD.md`)**](./docs/HLD.md) | System architecture diagram, core subsystems, data flows, non-functional requirements, and deployment topology. |
| [**Low-Level Design (`docs/LLD.md`)**](./docs/LLD.md) | Module map, detailed sequence diagrams, TypeScript data contracts, deterministic client algorithms, caching, and i18n internals. |
| [**REST API Specification (`docs/API_SPEC.md`)**](./docs/API_SPEC.md) | Complete `/api/*` endpoint reference, Zod validation rules, request/response schemas, and error codes. |
| [**Security & Privacy (`docs/SECURITY_AND_PRIVACY.md`)**](./docs/SECURITY_AND_PRIVACY.md) | Consent-first document inspection, defense-in-depth PII masking, SSRF allowlisting, AI grounding, and cost guardrails. |

## Key Capabilities

- **8 Indian Languages**: Native UI, regional Google Noto Sans typography, automatic script detection, AI guidance, and localized map search across **English, Hindi (हिन्दी), Marathi (मराठी), Tamil (தமிழ்), Telugu (తెలుగు), Bengali (বাংলা), Kannada (ಕನ್ನಡ), and Gujarati (ગુજરાતી)**.
- **Fewer, Better Questions**: Uses `gemini-decision-1` (Decisions API, `v1beta`) to gate citizen-services queries, classify journeys (`farmer`, `student`, `health`, `livelihood`, `other`), score profile completeness, and calibrate scheme confidence (`< 0.75` triggers clarification or escalation).
- **Tiered Gemini 4 Routing**: Uses `gemini-4-hydrogen` (`thinking_level: "medium"`) via the stateful Interactions API (`previous_interaction_id`) for routine guidance and document checks; escalates to `gemini-4-neon` (`thinking_level: "high"`) only for ambiguous or conflicting eligibility cases.
- **Live Official Criteria from myScheme**: Server-side fetcher respects `robots.txt`, rate-limits outbound requests (`350ms`), verifies HTTPS `.gov.in` / `.nic.in` URLs, and caches results in memory for 24 hours. Never falls back to mocked or pre-written criteria.
- **Visual Readiness Status Badges & Interactive Checklist**: Each matched scheme displays a live **Eligible**, **Potentially Eligible**, or **Missing Docs** badge that updates as citizens verify photos or check off documents, paired with state-aware *"How to get this"* issuance guides across all 36 Indian States/UTs.
- **Side-by-Side Scheme Comparison & Stacking Check**: Compare 2–3 matched schemes side by side on document readiness, shared documents, verification rules, and potential stacking/exclusion overlaps grounded in official criteria.
- **Consent-First Privacy & PII Masking**: Explicit, per-session, revocable consent before inspecting any document photo. Photos are processed strictly in RAM—never persisted or logged—and Aadhaar/bank numbers are masked to the last 4 digits (`XXXX-XXXX-1234`).
- **Share, Print A4 PDF, Calendar Reminders & Save/Resume**: Copy/WhatsApp/SMS a concise privacy-safe eligibility summary, export a print-optimized A4 PDF dossier, download RFC 5545 `.ics` calendar reminders with smart presets, or save/resume progress locally with offline detection.
- **Google Maps Nearby Help Centre Locator**: Interactive Google Maps Platform (`@vis.gl/react-google-maps` + Places API New) search for nearby CSC kiosks, Tehsil/Block offices, and bank branches.
- **What-If Fact Editor & Evaluation Harness (`/eval`)**: Edit known facts to re-check eligibility without starting over, and run the built-in synthetic evaluation suite at `/eval`.

## Architecture & Shared Model Constants

All Gemini model IDs are centralized in `/shared/models.ts`:
- `MODELS.DECISION` = `"gemini-decision-1"` (`ai.decisions.create`, `apiVersion: "v1beta"`)
- `MODELS.HYDROGEN` = `"gemini-4-hydrogen"` (`ai.interactions.create`, `thinking_level: "medium"`)
- `MODELS.NEON` = `"gemini-4-neon"` (`ai.interactions.create`, `thinking_level: "high"`, escalation only)

## Environment Variables

Copy `.env.example` or configure these variables in your environment / Cloud Run service:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Yes | — | Gemini API key (server-side only; required for `gemini-4-neon`, `gemini-4-hydrogen`, and `gemini-decision-1`). |
| `VITE_GOOGLE_MAPS_API_KEY` | Optional | — | Scoped browser Google Maps Platform API key for the Nearby CSC / Help Centre Locator map modal. |
| `APP_URL` | No | Auto-injected | Hosted application URL. |
| `SESSION_TOKEN_CAP` | No | `45000` | Maximum combined input + output tokens per citizen session. |
| `DAILY_SPEND_CAP_USD` | No | `5.00` | Global daily estimated spend ceiling across all sessions. |
| `MYSCHEME_CACHE_TTL_HOURS` | No | `24` | In-memory cache duration (hours) for live myScheme fetches. |

## Local Development

```bash
npm install
npm run dev
```

The server starts on `http://localhost:3000`:
- Citizen companion: `/`
- Synthetic evaluation harness: `/eval`

## Production Build & Cloud Run Deployment

```bash
npm run build
npm start
```

- `npm run build` compiles the React/Vite client into `dist/`.
- `npm start` runs `node server.ts` on `0.0.0.0:${PORT:-3000}` serving `/api/*` routes and the compiled frontend.
- Deploying Cloud Run in an India region (e.g., `asia-south1`) is recommended for lowest latency and direct `myscheme.gov.in` access.
