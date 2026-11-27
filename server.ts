import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { SESSION_LIMITS } from "./shared/models.ts";
import {
  DemoBudgetExceededError,
  getDailyBudgetSummary,
} from "./server/costGuard.ts";
import { runEvalSuite, SYNTHETIC_EVAL_CASES } from "./server/evalHarness.ts";
import {
  fetchSchemesForJourney,
  getMySchemeCacheSummary,
} from "./server/mySchemeService.ts";
import {
  ConsentRequiredError,
  handleChatTurn,
  handleDocumentAnalysis,
  recheckWithEditedFacts,
  resetSession,
  restoreSession,
  setDocumentConsent,
} from "./server/schemeEngine.ts";

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

const LanguageSchema = z.enum(["en", "hi"]);
const SessionIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{8,64}$/)
  .optional();

const LocationSchema = z
  .object({
    stateCode: z.string().trim().min(2).max(4),
    stateName: z.string().trim().min(2).max(80),
    district: z.string().trim().max(80).optional(),
  })
  .optional();

const ChatRequestSchema = z.object({
  sessionId: SessionIdSchema,
  message: z.string().trim().min(1).max(1500),
  language: LanguageSchema.default("en"),
  location: LocationSchema,
});

const RecheckFactsRequestSchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/),
  knownFacts: z.array(z.string().trim().min(1).max(240)).min(1).max(25),
  location: LocationSchema,
  language: LanguageSchema.default("en"),
});

const ConsentRequestSchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/),
  granted: z.boolean(),
  language: LanguageSchema.default("en"),
});

const ResetRequestSchema = z.object({
  sessionId: SessionIdSchema,
  language: LanguageSchema.default("en"),
});

const RestoreSessionRequestSchema = z.object({
  sessionId: SessionIdSchema,
  language: LanguageSchema.default("en"),
  questionCount: z.number().int().min(0).max(SESSION_LIMITS.MAX_FOLLOW_UP_QUESTIONS).default(0),
  plan: z.object({
    journey: z.enum(["farmer", "student", "health", "livelihood", "other"]),
    location: LocationSchema,
    profileCompletenessScore: z.number().min(0).max(3).default(0),
    profileCompletenessPercent: z.number().min(0).max(100).default(0),
    knownFacts: z.array(z.string().max(600)).max(30).default([]),
    unknownFacts: z.array(z.string().max(600)).max(30).default([]),
    matches: z
      .array(
        z.object({
          slug: z.string().max(120),
          schemeName: z.string().max(300),
          category: z.string().max(200),
          whyItMayFit: z.string().max(2500),
          whatToVerify: z.array(z.string().max(600)).max(15),
          whatIsMissing: z.array(z.string().max(600)).max(15),
          nextOfficialAction: z.string().max(1500),
          officialChannelUrl: z.string().max(600),
          sourceUrl: z.string().max(600),
          fetchedAt: z.string().max(64),
          confidence: z.enum(["High", "Medium", "Low"]),
          confidenceSource: z.enum(["decision-1", "decision-1+neon"]),
          decisionProbability: z.number().min(0).max(1),
          decisionConfidence: z.number().min(0).max(1),
        }),
      )
      .max(10)
      .default([]),
    documents: z
      .array(
        z.object({
          id: z.string().max(100),
          documentType: z.enum([
            "aadhaar",
            "land_record",
            "bank_passbook",
            "income_certificate",
            "caste_certificate",
            "ration_card",
            "student_id_marksheet",
            "artisan_business_proof",
            "other",
          ]),
          label: z.string().max(250),
          status: z.enum(["ready", "missing", "needs_verification"]),
          detail: z.string().max(1000),
          requiredForSchemes: z.array(z.string().max(250)).max(10),
        }),
      )
      .max(20)
      .default([]),
    nextStepSummary: z.string().max(2500).default(""),
    showHumanHandoff: z.boolean().default(false),
    humanHandoffReason: z.string().max(2000).optional(),
    handoffChannels: z
      .array(
        z.object({
          title: z.string().max(250),
          description: z.string().max(600),
          contactOrUrl: z.string().max(400),
          isUrl: z.boolean(),
        }),
      )
      .max(10)
      .default([]),
    sourceFetchStatus: z.enum(["idle", "verified", "partial", "unavailable"]).default("idle"),
    sourceFetchNotice: z.string().max(1000).optional(),
    lastFetchedAt: z.string().max(64).optional(),
  }),
});

const DocumentAnalyzeRequestSchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{8,64}$/),
  claimedType: z.enum([
    "aadhaar",
    "land_record",
    "bank_passbook",
    "income_certificate",
    "caste_certificate",
    "ration_card",
    "student_id_marksheet",
    "artisan_business_proof",
    "other",
  ]),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  imageBase64: z.string().min(64).max(9_000_000),
  language: LanguageSchema.default("en"),
});

const EvalRunRequestSchema = z.object({
  caseIds: z.array(z.string().max(40)).max(6).optional(),
});

const JourneyParamSchema = z.enum(["farmer", "student", "health", "livelihood"]);

function sendStructuredError(res: Response, err: unknown): void {
  if (err instanceof DemoBudgetExceededError) {
    res.status(429).json({
      error: "DEMO_LIMIT_REACHED",
      scope: err.scope,
      message: err.message,
      messageHi: err.messageHi,
    });
    return;
  }
  if (err instanceof ConsentRequiredError) {
    res.status(403).json({
      error: "CONSENT_REQUIRED",
      message: err.message,
      messageHi: "दस्तावेज़ की जांच से पहले आपकी स्पष्ट सहमति आवश्यक है।",
    });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: "INVALID_REQUEST",
      message: "Invalid request parameters.",
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }

  const status = (err as { status?: number })?.status;
  const rawMessage = err instanceof Error ? err.message : "Unexpected server error";

  if (status === 403 || rawMessage.includes("GEMINI_API_KEY")) {
    res.status(503).json({
      error: "API_CONFIGURATION_ERROR",
      message:
        "Gemini API key is missing or unauthorized on the server. Please check Settings > Secrets.",
    });
    return;
  }
  if (status === 429) {
    res.status(429).json({
      error: "UPSTREAM_RATE_LIMIT",
      message:
        "The AI service is temporarily rate-limited. Please wait a moment and try again.",
    });
    return;
  }

  console.error(
    JSON.stringify({
      event: "api_error",
      timestamp: new Date().toISOString(),
      message: rawMessage.slice(0, 180),
    }),
  );
  res.status(500).json({
    error: "SERVER_ERROR",
    message: "Unable to process your request right now. Please try again.",
  });
}

async function startServer(): Promise<void> {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));

  // Basic security headers compatible with AI Studio iframe preview
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, service: "scheme-saathi" });
  });

  app.get("/api/maps/config", (_req: Request, res: Response) => {
    const apiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ||
      process.env.GOOGLE_MAPS_API_KEY?.trim() ||
      "";
    res.json({
      configured: Boolean(apiKey),
      apiKey,
    });
  });

  app.post("/api/session/reset", (req: Request, res: Response) => {
    try {
      const parsed = ResetRequestSchema.parse(req.body ?? {});
      const snapshot = resetSession(parsed.sessionId ?? "", parsed.language);
      res.json({ session: snapshot });
    } catch (err) {
      sendStructuredError(res, err);
    }
  });

  app.post("/api/session/restore", (req: Request, res: Response) => {
    try {
      const parsed = RestoreSessionRequestSchema.parse(req.body ?? {});
      const snapshot = restoreSession({
        sessionId: parsed.sessionId,
        language: parsed.language,
        questionCount: parsed.questionCount,
        plan: parsed.plan,
      });
      res.json({ session: snapshot });
    } catch (err) {
      sendStructuredError(res, err);
    }
  });

  app.post("/api/session/recheck", async (req: Request, res: Response) => {
    try {
      const parsed = RecheckFactsRequestSchema.parse(req.body ?? {});
      const result = await recheckWithEditedFacts({
        sessionId: parsed.sessionId,
        knownFacts: parsed.knownFacts,
        location: parsed.location,
        uiLanguage: parsed.language,
      });
      res.json(result);
    } catch (err) {
      sendStructuredError(res, err);
    }
  });

  app.post("/api/session/consent", (req: Request, res: Response) => {
    try {
      const parsed = ConsentRequestSchema.parse(req.body);
      const snapshot = setDocumentConsent(
        parsed.sessionId,
        parsed.granted,
        parsed.language,
      );
      res.json({ session: snapshot });
    } catch (err) {
      sendStructuredError(res, err);
    }
  });

  app.post("/api/chat", async (req: Request, res: Response) => {
    try {
      const parsed = ChatRequestSchema.parse(req.body);
      const result = await handleChatTurn({
        sessionId: parsed.sessionId,
        message: parsed.message,
        uiLanguage: parsed.language,
        location: parsed.location,
      });
      res.json(result);
    } catch (err) {
      sendStructuredError(res, err);
    }
  });

  app.post("/api/document/analyze", async (req: Request, res: Response) => {
    try {
      const parsed = DocumentAnalyzeRequestSchema.parse(req.body);
      // Strip optional data URI prefix safely and validate decoded size strictly in memory
      const cleanedBase64 = parsed.imageBase64.replace(
        /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
        "",
      );
      const approxBytes = Math.floor((cleanedBase64.length * 3) / 4);
      if (approxBytes > SESSION_LIMITS.MAX_DOCUMENT_BYTES) {
        res.status(400).json({
          error: "FILE_TOO_LARGE",
          message: "Document photo must be under 6 MB.",
          messageHi: "दस्तावेज़ की फोटो 6 MB से कम होनी चाहिए।",
        });
        return;
      }

      const result = await handleDocumentAnalysis({
        sessionId: parsed.sessionId,
        claimedType: parsed.claimedType,
        imageBase64: cleanedBase64,
        mimeType: parsed.mimeType,
        uiLanguage: parsed.language,
      });
      res.json(result);
    } catch (err) {
      sendStructuredError(res, err);
    }
  });

  app.get("/api/schemes/journey/:journey", async (req: Request, res: Response) => {
    try {
      const journey = JourneyParamSchema.parse(req.params.journey);
      const forceRefresh = req.query.refresh === "true";
      const bundle = await fetchSchemesForJourney(
        journey,
        "public_scheme_fetch",
        forceRefresh,
      );
      res.json(bundle);
    } catch (err) {
      sendStructuredError(res, err);
    }
  });

  app.get("/api/schemes/status", (_req: Request, res: Response) => {
    res.json({
      cachedJourneys: getMySchemeCacheSummary(),
      dailyBudget: getDailyBudgetSummary(),
    });
  });

  app.get("/api/eval/cases", (_req: Request, res: Response) => {
    res.json({
      cases: SYNTHETIC_EVAL_CASES.map((c) => ({
        caseId: c.caseId,
        profileType: c.profileType,
        language: c.language,
        prompt: c.prompt,
      })),
    });
  });

  app.post("/api/eval/run", async (req: Request, res: Response) => {
    try {
      const parsed = EvalRunRequestSchema.parse(req.body ?? {});
      const report = await runEvalSuite(parsed.caseIds);
      res.json(report);
    } catch (err) {
      sendStructuredError(res, err);
    }
  });

  // Frontend serving: Vite middleware in development, static dist/ in production
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.get("*", (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }
      const indexHtml = path.join(distDir, "index.html");
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send("Build artifacts not found. Run npm run build.");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      JSON.stringify({
        event: "server_started",
        port: PORT,
        mode: IS_PROD ? "production" : "development",
      }),
    );
  });
}

startServer().catch((err) => {
  console.error("Fatal server startup error:", err);
  process.exit(1);
});
