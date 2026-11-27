import crypto from "node:crypto";
import { Type } from "@google/genai";
import {
  LANGUAGE_META,
  MODELS,
  SESSION_LIMITS,
  THINKING_LEVELS,
} from "../shared/models.ts";
import type {
  ChatMessage,
  ChatTurnResponse,
  ChoiceOption,
  CitizenLocation,
  DocumentAnalyzeResponse,
  DocumentChecklistItem,
  DocumentTypeKey,
  HumanHandoffChannel,
  JourneyType,
  Language,
  ModelId,
  OfficialSchemeRecord,
  PlanState,
  SchemeMatch,
  SessionSnapshot,
} from "../shared/models.ts";
import { findIndiaStateByCode } from "../shared/indiaStates.ts";
import {
  assertBudgetAvailable,
  clearSessionLedger,
  getSessionBudgetSnapshot,
  recordModelUsage,
} from "./costGuard.ts";
import {
  evaluateCitizenTurn,
  scoreSchemeMatches,
  verifyDocumentMatchesClaimedType,
} from "./decisionsService.ts";
import {
  extractInteractionOutputText,
  extractInteractionTokens,
  getInteractionsClient,
  withTransientRetry,
} from "./geminiClient.ts";
import { fetchSchemesForJourney, validateOfficialUrl } from "./mySchemeService.ts";
import {
  maskIdentifierValue,
  maskSensitiveText,
  sanitizeStringArray,
} from "./piiMasker.ts";

export class ConsentRequiredError extends Error {
  constructor() {
    super(
      "Explicit session consent is required before processing any uploaded document photo.",
    );
    this.name = "ConsentRequiredError";
  }
}

interface VerifiedDocMemory {
  documentType: DocumentTypeKey;
  verified: boolean;
  summary: string;
  maskedIdentifier?: string;
  extractedFacts: string[];
  checkedAt: string;
}

interface SessionState {
  sessionId: string;
  language: Language;
  journey: JourneyType;
  location?: CitizenLocation;
  questionCount: number;
  documentConsentGranted: boolean;
  previousInteractionId?: string;
  previousInteractionModel?: ModelId;
  knownFacts: string[];
  unknownFacts: string[];
  verifiedDocuments: Map<DocumentTypeKey, VerifiedDocMemory>;
  plan: PlanState;
  createdAt: number;
  lastActiveAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, SessionState>();

// Periodically evict idle in-memory sessions so no citizen data lingers
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions.entries()) {
    if (session.lastActiveAt < cutoff) {
      sessions.delete(id);
      clearSessionLedger(id);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Stable system instruction prefix (kept constant across turns so Gemini 4
 * automatic implicit caching activates at 4,096+ tokens with zero manual cache calls).
 */
const STABLE_SYSTEM_PROMPT = `You are Scheme Saathi, a calm, trustworthy application-readiness companion for Indian citizens.
You are NOT a generic scheme directory and you NEVER submit applications on behalf of citizens.

STRICT RULES:
1. GROUNDING: Base EVERY eligibility claim, benefit, exclusion warning, and required document STRICTLY on the "OFFICIAL MYSCHEME CRITERIA" provided in the prompt. NEVER invent schemes, criteria, benefits, URLs, or document lists. If official criteria are missing or fetch failed, state that plainly.
2. LANGUAGE: Reply naturally in the exact language the citizen wrote in or selected (English, Hindi, Marathi, Tamil, Telugu, Bengali, Kannada, or Gujarati in their native scripts, or Hinglish/Hindi if they wrote Hinglish). Keep sentences short, simple, and low-literacy friendly.
3. FEWER, BETTER QUESTIONS: Ask at most ONE decisive follow-up question per turn, and NEVER exceed the session's remaining question budget. Whenever asking a yes/no or multiple-choice question, ALWAYS include 2 to 4 concise tappable choices.
4. SAFE UNCERTAINTY: If key facts (such as state, landholding, income, tax/pension exclusion, or category) are unknown or conflicting, explicitly list what is unknown in "unknownFacts" and "whatToVerify". Never guess eligibility.
5. PRIVACY: Never repeat a full 12-digit Aadhaar number or full bank account number; mask to last 4 digits only.
6. CONCISENESS: Keep assistantReply under 110 words, warm, structured, and directly actionable.
7. OFFICIAL HANDOFF: Always remind that matches are potential matches requiring official verification on myScheme, state portal, bank, or CSC.`;

function sanitizeCitizenLocation(
  input?: CitizenLocation,
): CitizenLocation | undefined {
  if (!input || !input.stateCode) return undefined;
  const matched = findIndiaStateByCode(input.stateCode);
  if (!matched) return undefined;
  const cleanDistrict = input.district
    ? maskSensitiveText(input.district.trim()).slice(0, 80)
    : undefined;
  return {
    stateCode: matched.code,
    stateName: matched.nameEn,
    district: cleanDistrict || undefined,
  };
}

function getHandoffChannels(
  journey: JourneyType,
  language: Language,
  location?: CitizenLocation,
): HumanHandoffChannel[] {
  const isHi = language === "hi";
  const base: HumanHandoffChannel[] = [
    {
      title: isHi ? "नज़दीकी कॉमन सर्विस सेंटर (CSC)" : "Nearest Common Service Centre (CSC)",
      description: isHi
        ? "दस्तावेज़ जांच और आधिकारिक आवेदन सहायता के लिए अपने नज़दीकी CSC केंद्र खोजें।"
        : "Locate your nearest government-authorized CSC kiosk for document help and official application.",
      contactOrUrl: "https://locator.csccloud.in/",
      isUrl: true,
    },
    {
      title: isHi ? "आधिकारिक myScheme पोर्टल" : "Official myScheme Portal",
      description: isHi
        ? "भारत सरकार के आधिकारिक पोर्टल पर पात्रता और नियम जांचें।"
        : "Verify official rules and application channels directly on the Government of India portal.",
      contactOrUrl: "https://www.myscheme.gov.in/",
      isUrl: true,
    },
  ];

  // Append verified official State/UT citizen portal when state is selected
  const stateInfo = location ? findIndiaStateByCode(location.stateCode) : undefined;
  if (stateInfo?.portalUrl && stateInfo.portalTitleEn) {
    base.push({
      title: isHi && stateInfo.portalTitleHi ? stateInfo.portalTitleHi : stateInfo.portalTitleEn,
      description: isHi
        ? `${stateInfo.nameHi} के प्रमाण-पत्र (आय, जाति, ${stateInfo.landRecordTermHi}) और राज्य योजनाओं के लिए आधिकारिक पोर्टल।`
        : `Official ${stateInfo.nameEn} portal for state certificates (income, caste, ${stateInfo.landRecordTermEn}) and state-level schemes.`,
      contactOrUrl: stateInfo.portalUrl,
      isUrl: true,
    });
  }

  if (journey === "farmer") {
    base.unshift({
      title: isHi ? "किसान कॉल सेंटर (टोल-फ्री)" : "Kisan Call Centre (Toll-Free)",
      description: isHi
        ? "PM-KISAN, KCC और भूमि रिकॉर्ड संबंधी सहायता के लिए कॉल करें।"
        : "Free government helpline for farmer scheme and land-record queries (6 AM – 10 PM).",
      contactOrUrl: "1800-180-1551",
      isUrl: false,
    });
  } else if (journey === "health") {
    base.unshift({
      title: isHi ? "आयुष्मान भारत हेल्पलाइन (24x7)" : "Ayushman Bharat Helpline (24x7)",
      description: isHi
        ? "PM-JAY पात्रता और सूचीबद्ध अस्पताल की पुष्टि के लिए टोल-फ्री नंबर।"
        : "Official toll-free helpline for PM-JAY eligibility and empanelled hospital verification.",
      contactOrUrl: "14555",
      isUrl: false,
    });
  } else if (journey === "student") {
    base.unshift({
      title: isHi ? "राष्ट्रीय छात्रवृत्ति पोर्टल (NSP) सहायता" : "National Scholarship Portal (NSP) Helpdesk",
      description: isHi
        ? "छात्रवृत्ति पात्रता और सत्यापन के लिए आधिकारिक NSP हेल्पडेस्क।"
        : "Official Government of India scholarship helpdesk and portal.",
      contactOrUrl: "https://scholarships.gov.in/",
      isUrl: true,
    });
  } else if (journey === "livelihood") {
    base.unshift({
      title: isHi ? "पीएम विश्वकर्मा / उद्यम हेल्पलाइन" : "PM Vishwakarma / MSME Helpline",
      description: isHi
        ? "कारीगर, स्ट्रीट वेंडर और लघु व्यवसाय योजनाओं के लिए आधिकारिक सहायता।"
        : "Official helpline for artisan, vendor, and micro-enterprise registration support.",
      contactOrUrl: "1800-267-7777",
      isUrl: false,
    });
  }

  return base;
}

function createInitialPlan(language: Language): PlanState {
  return {
    journey: "other",
    profileCompletenessScore: 0,
    profileCompletenessPercent: 0,
    knownFacts: [],
    unknownFacts: [],
    matches: [],
    documents: [],
    nextStepSummary:
      language === "hi"
        ? "अपनी स्थिति बताएं (जैसे: खेती, पढ़ाई, स्वास्थ्य या छोटा व्यवसाय) ताकि हम आधिकारिक myScheme नियमों से आपका एक्शन प्लान बना सकें।"
        : "Describe your situation (farming, education, health, or livelihood) to build a verified action plan from official myScheme criteria.",
    showHumanHandoff: false,
    handoffChannels: getHandoffChannels("other", language),
    sourceFetchStatus: "idle",
  };
}

export function getOrCreateSession(
  sessionId?: string,
  language: Language = "en",
): SessionState {
  const id =
    sessionId && /^[a-zA-Z0-9_-]{8,64}$/.test(sessionId)
      ? sessionId
      : crypto.randomUUID();

  let session = sessions.get(id);
  if (!session) {
    session = {
      sessionId: id,
      language,
      journey: "other",
      questionCount: 0,
      documentConsentGranted: false,
      knownFacts: [],
      unknownFacts: [],
      verifiedDocuments: new Map(),
      plan: createInitialPlan(language),
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    sessions.set(id, session);
  } else {
    session.lastActiveAt = Date.now();
    session.language = language;
  }
  return session;
}

export function resetSession(sessionId: string, language: Language = "en"): SessionSnapshot {
  sessions.delete(sessionId);
  clearSessionLedger(sessionId);
  const fresh = getOrCreateSession(crypto.randomUUID(), language);
  return buildSessionSnapshot(fresh);
}

/**
 * Rehydrates a citizen's saved progress from browser storage into in-memory server state.
 * Document consent is NEVER restored across reloads (always reset to false) and all
 * text fields are re-masked and URL-validated server-side.
 */
export function restoreSession(params: {
  sessionId?: string;
  language: Language;
  questionCount: number;
  plan: PlanState;
}): SessionSnapshot {
  const session = getOrCreateSession(params.sessionId, params.language);
  const safeJourney = params.plan.journey;
  const safeQuestionCount = Math.min(
    SESSION_LIMITS.MAX_FOLLOW_UP_QUESTIONS,
    Math.max(0, Math.floor(params.questionCount)),
  );

  const sanitizedMatches: SchemeMatch[] = (params.plan.matches ?? [])
    .filter((m) => validateOfficialUrl(m.sourceUrl, true) !== null)
    .slice(0, 10)
    .map((m) => ({
      slug: m.slug,
      schemeName: maskSensitiveText(m.schemeName),
      category: maskSensitiveText(m.category),
      whyItMayFit: maskSensitiveText(m.whyItMayFit),
      whatToVerify: sanitizeStringArray(m.whatToVerify),
      whatIsMissing: sanitizeStringArray(m.whatIsMissing),
      nextOfficialAction: maskSensitiveText(m.nextOfficialAction),
      officialChannelUrl:
        validateOfficialUrl(m.officialChannelUrl, false)?.toString() ?? m.sourceUrl,
      sourceUrl: validateOfficialUrl(m.sourceUrl, true)!.toString(),
      fetchedAt: m.fetchedAt,
      confidence: m.confidence,
      confidenceSource: m.confidenceSource,
      decisionProbability: m.decisionProbability,
      decisionConfidence: m.decisionConfidence,
    }));

  const sanitizedDocs: DocumentChecklistItem[] = (params.plan.documents ?? [])
    .slice(0, 20)
    .map((d) => ({
      id: d.id,
      documentType: d.documentType,
      label: maskSensitiveText(d.label),
      status: d.status,
      detail: maskSensitiveText(d.detail),
      maskedIdentifier: undefined,
      requiredForSchemes: sanitizeStringArray(d.requiredForSchemes),
    }));

  const safeLocation = sanitizeCitizenLocation(params.plan.location);
  session.language = params.language;
  session.journey = safeJourney;
  session.location = safeLocation;
  session.questionCount = safeQuestionCount;
  session.documentConsentGranted = false;
  session.verifiedDocuments.clear();
  session.previousInteractionId = undefined;
  session.previousInteractionModel = undefined;
  session.knownFacts = sanitizeStringArray(params.plan.knownFacts);
  session.unknownFacts = sanitizeStringArray(params.plan.unknownFacts);
  session.plan = {
    journey: safeJourney,
    location: safeLocation,
    profileCompletenessScore: Math.min(3, Math.max(0, params.plan.profileCompletenessScore ?? 0)),
    profileCompletenessPercent: Math.min(
      100,
      Math.max(0, Math.round(params.plan.profileCompletenessPercent ?? 0)),
    ),
    knownFacts: session.knownFacts,
    unknownFacts: session.unknownFacts,
    matches: sanitizedMatches,
    documents: sanitizedDocs,
    nextStepSummary: maskSensitiveText(
      params.plan.nextStepSummary || createInitialPlan(params.language).nextStepSummary,
    ),
    showHumanHandoff: Boolean(params.plan.showHumanHandoff),
    humanHandoffReason: params.plan.humanHandoffReason
      ? maskSensitiveText(params.plan.humanHandoffReason)
      : undefined,
    handoffChannels: getHandoffChannels(safeJourney, params.language, safeLocation),
    sourceFetchStatus: params.plan.sourceFetchStatus ?? "idle",
    sourceFetchNotice: params.plan.sourceFetchNotice
      ? maskSensitiveText(params.plan.sourceFetchNotice)
      : undefined,
    lastFetchedAt: params.plan.lastFetchedAt,
  };
  session.lastActiveAt = Date.now();

  return buildSessionSnapshot(session);
}

export function setDocumentConsent(
  sessionId: string,
  granted: boolean,
  language: Language = "en",
): SessionSnapshot {
  const session = getOrCreateSession(sessionId, language);
  session.documentConsentGranted = granted;
  if (!granted) {
    // Revoking consent immediately purges any extracted document data from memory
    session.verifiedDocuments.clear();
    session.plan.documents = session.plan.documents.map((doc) =>
      doc.status === "ready" && doc.maskedIdentifier
        ? {
            ...doc,
            status: "needs_verification",
            maskedIdentifier: undefined,
            detail:
              language === "hi"
                ? "सहमति वापस ली गई — दस्तावेज़ डेटा हटाया गया।"
                : "Consent revoked — document data cleared from memory.",
          }
        : doc,
    );
  }
  return buildSessionSnapshot(session);
}

export function buildSessionSnapshot(session: SessionState): SessionSnapshot {
  return {
    sessionId: session.sessionId,
    language: session.language,
    questionCount: session.questionCount,
    maxQuestions: SESSION_LIMITS.MAX_FOLLOW_UP_QUESTIONS,
    documentConsentGranted: session.documentConsentGranted,
    plan: session.plan,
    budget: getSessionBudgetSnapshot(session.sessionId),
  };
}

function detectLanguageFromScript(text: string, fallback: Language): Language {
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta";
  if (/[\u0C00-\u0C7F]/.test(text)) return "te";
  if (/[\u0980-\u09FF]/.test(text)) return "bn";
  if (/[\u0C80-\u0CFF]/.test(text)) return "kn";
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu";
  if (/[\u0900-\u097F]/.test(text)) {
    return fallback === "mr" ? "mr" : "hi";
  }
  return fallback;
}

function buildOfficialCriteriaPrefix(schemes: OfficialSchemeRecord[]): string {
  if (schemes.length === 0) {
    return "OFFICIAL MYSCHEME CRITERIA: No live criteria could be fetched from myscheme.gov.in for this turn. Do NOT invent any scheme criteria, benefits, documents, or URLs.";
  }
  return (
    "OFFICIAL MYSCHEME CRITERIA (ONLY ALLOWED BASIS FOR ELIGIBILITY CLAIMS):\n" +
    schemes
      .map(
        (s, idx) =>
          `=== SCHEME ${idx + 1}: ${s.slug} ===\n${s.extractedText}\nFetched At: ${s.fetchedAt}`,
      )
      .join("\n\n")
  );
}

const CITIZEN_TURN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    assistantReply: {
      type: Type.STRING,
      description:
        "Clear, calm, concise message to the citizen in their language (<= 110 words). Ask at most one decisive follow-up question if needed.",
    },
    askedFollowUpQuestion: {
      type: Type.BOOLEAN,
      description: "True if assistantReply asks a clarifying/follow-up question.",
    },
    choices: {
      type: Type.ARRAY,
      description:
        "2 to 4 short tappable choices if asking a yes/no or multiple-choice question; empty array if no question is asked.",
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          value: { type: Type.STRING },
        },
        required: ["label", "value"],
      },
    },
    knownFacts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Concise updated list of facts stated by the citizen so far (masked PII only).",
    },
    unknownFacts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Key eligibility facts still unknown or unverified.",
    },
    schemeAssessments: {
      type: Type.ARRAY,
      description:
        "Assessments ONLY for schemes present in OFFICIAL MYSCHEME CRITERIA above. Use exact slug.",
      items: {
        type: Type.OBJECT,
        properties: {
          slug: { type: Type.STRING },
          relevant: { type: Type.BOOLEAN },
          whyItMayFit: { type: Type.STRING },
          whatToVerify: { type: Type.ARRAY, items: { type: Type.STRING } },
          whatIsMissing: { type: Type.ARRAY, items: { type: Type.STRING } },
          nextOfficialAction: { type: Type.STRING },
        },
        required: [
          "slug",
          "relevant",
          "whyItMayFit",
          "whatToVerify",
          "whatIsMissing",
          "nextOfficialAction",
        ],
      },
    },
    documentChecklist: {
      type: Type.ARRAY,
      description:
        "Consolidated checklist of required documents from OFFICIAL MYSCHEME CRITERIA with status ready / missing / needs_verification.",
      items: {
        type: Type.OBJECT,
        properties: {
          documentType: {
            type: Type.STRING,
            enum: [
              "aadhaar",
              "land_record",
              "bank_passbook",
              "income_certificate",
              "caste_certificate",
              "ration_card",
              "student_id_marksheet",
              "artisan_business_proof",
              "other",
            ],
          },
          label: { type: Type.STRING },
          status: {
            type: Type.STRING,
            enum: ["ready", "missing", "needs_verification"],
          },
          detail: { type: Type.STRING },
          requiredForSchemes: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["documentType", "label", "status", "detail", "requiredForSchemes"],
      },
    },
    nextStepSummary: {
      type: Type.STRING,
      description: "1-2 sentence plain summary of the citizen's clearest next official action.",
    },
    conflictOrExclusionNote: {
      type: Type.STRING,
      description:
        "ONLY non-empty if the citizen explicitly stated a conflicting or potentially disqualifying condition (such as government pensioner spouse, income tax payer, joint/disputed land title). Leave empty string for routine verification checks.",
    },
  },
  required: [
    "assistantReply",
    "askedFollowUpQuestion",
    "choices",
    "knownFacts",
    "unknownFacts",
    "schemeAssessments",
    "documentChecklist",
    "nextStepSummary",
    "conflictOrExclusionNote",
  ],
};

interface StructuredTurnOutput {
  assistantReply: string;
  askedFollowUpQuestion: boolean;
  choices: ChoiceOption[];
  knownFacts: string[];
  unknownFacts: string[];
  schemeAssessments: Array<{
    slug: string;
    relevant: boolean;
    whyItMayFit: string;
    whatToVerify: string[];
    whatIsMissing: string[];
    nextOfficialAction: string;
  }>;
  documentChecklist: Array<{
    documentType: DocumentTypeKey;
    label: string;
    status: "ready" | "missing" | "needs_verification";
    detail: string;
    requiredForSchemes: string[];
  }>;
  nextStepSummary: string;
  conflictOrExclusionNote: string;
}

function buildJourneyClarificationResponse(
  session: SessionState,
  replyLang: Language,
  isOffTopic: boolean,
): {
  text: string;
  choices: ChoiceOption[];
} {
  if (isOffTopic) {
    return replyLang === "hi"
      ? {
          text: "मैं स्कीम साथी हूँ — मैं केवल भारतीय सरकारी योजनाओं की पात्रता, ज़रूरी दस्तावेज़ और आधिकारिक चैनल तक पहुँचने में मदद करता हूँ। इनमें से कौन-सी स्थिति आप पर लागू होती है?",
          choices: [
            { label: "किसान / खेती", value: "मैं एक किसान हूँ और सरकारी योजनाएं जानना चाहता हूँ।" },
            { label: "छात्र / छात्रवृत्ति", value: "मैं छात्र हूँ और छात्रवृत्ति योजनाओं के बारे में जानना चाहता हूँ।" },
            { label: "स्वास्थ्य / इलाज", value: "मुझे परिवार के स्वास्थ्य और बीमा योजनाओं की जानकारी चाहिए।" },
            { label: "आजीविका / छोटा व्यवसाय", value: "मैं कारीगर या छोटा व्यवसायी हूँ और आजीविका योजनाएं जानना चाहता हूँ।" },
          ],
        }
      : {
          text: "I am Scheme Saathi — I help Indian citizens check government scheme readiness, required documents, and official application channels. Which area describes your need?",
          choices: [
            { label: "Farmer / Agriculture", value: "I am a smallholder farmer looking for government schemes." },
            { label: "Student / Scholarship", value: "I am a student looking for scholarship schemes." },
            { label: "Health / Family Care", value: "I need help checking health coverage schemes for my family." },
            { label: "Livelihood / Small Business", value: "I am a self-employed artisan or small business owner looking for livelihood schemes." },
          ],
        };
  }

  return replyLang === "hi"
    ? {
        text: "सही आधिकारिक योजनाएं खोजने के लिए, कृपया चुनें कि आपकी ज़रूरत इनमें से किससे जुड़ी है:",
        choices: [
          { label: "किसान / खेती", value: "मैं किसान हूँ और खेती से जुड़ी सरकारी योजनाएं जांचना चाहता हूँ।" },
          { label: "छात्र / छात्रवृत्ति", value: "मैं छात्र हूँ और सरकारी छात्रवृत्ति जांचना चाहता हूँ।" },
          { label: "स्वास्थ्य / बीमा", value: "मुझे परिवार के लिए सरकारी स्वास्थ्य बीमा योजना जांचनी है।" },
          { label: "आजीविका / व्यवसाय", value: "मुझे कारीगर, रेहड़ी-पटरी या छोटे व्यवसाय के लिए योजना जांचनी है।" },
        ],
      }
    : {
        text: "To fetch the right official criteria from myScheme, please tap the category that best matches your situation:",
        choices: [
          { label: "Farmer / Agriculture", value: "I am a farmer looking for agriculture schemes." },
          { label: "Student / Scholarship", value: "I am a student looking for scholarships." },
          { label: "Health / Medical Cover", value: "I am checking health insurance schemes for my family." },
          { label: "Livelihood / Small Business", value: "I am a small business owner or artisan looking for livelihood schemes." },
        ],
      };
}

function mergeVerifiedDocumentsIntoChecklist(
  session: SessionState,
  aiChecklist: StructuredTurnOutput["documentChecklist"],
): DocumentChecklistItem[] {
  const byType = new Map<string, DocumentChecklistItem>();

  aiChecklist.forEach((item, idx) => {
    const key = item.documentType === "other" ? `other_${idx}` : item.documentType;
    byType.set(key, {
      id: key,
      documentType: item.documentType,
      label: maskSensitiveText(item.label),
      status: item.status,
      detail: maskSensitiveText(item.detail),
      requiredForSchemes: sanitizeStringArray(item.requiredForSchemes),
    });
  });

  // Overlay verified in-memory uploaded documents (only when consent is active)
  if (session.documentConsentGranted) {
    for (const [docType, mem] of session.verifiedDocuments.entries()) {
      const existing = byType.get(docType);
      if (existing) {
        existing.status = mem.verified ? "ready" : "needs_verification";
        existing.detail = mem.summary;
        existing.maskedIdentifier = mem.maskedIdentifier;
      } else {
        byType.set(docType, {
          id: docType,
          documentType: docType,
          label: docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          status: mem.verified ? "ready" : "needs_verification",
          detail: mem.summary,
          maskedIdentifier: mem.maskedIdentifier,
          requiredForSchemes: [],
        });
      }
    }
  }

  return Array.from(byType.values());
}

/**
 * Main conversational turn pipeline:
 * 1. Decision 1 gate (`gemini-decision-1`) -> citizen query, journey, completeness, conflict
 * 2. Live server-side myScheme fetch (24h cached)
 * 3. Hydrogen (`medium`) or Neon escalation (`high`) via stateful Interactions API
 * 4. Decision 1 calibrated match confidence scoring -> High / Medium / Low labels
 */
export async function handleChatTurn(params: {
  sessionId?: string;
  message: string;
  uiLanguage: Language;
  location?: CitizenLocation;
  skipQuestionIncrement?: boolean;
}): Promise<ChatTurnResponse> {
  const cleanMessage = maskSensitiveText(params.message.trim());
  const session = getOrCreateSession(params.sessionId, params.uiLanguage);
  assertBudgetAvailable(session.sessionId);

  if (params.location) {
    const cleanLocation = sanitizeCitizenLocation(params.location);
    if (cleanLocation) {
      session.location = cleanLocation;
      session.plan.location = cleanLocation;
    }
  }

  const replyLanguage: Language = detectLanguageFromScript(
    cleanMessage,
    params.uiLanguage,
  );

  // Step 1: Fast Decisions API gating & routing (zero output tokens)
  const gate = await evaluateCitizenTurn({
    sessionId: session.sessionId,
    latestMessage: cleanMessage,
    knownFacts: session.knownFacts,
    currentJourney: session.journey,
    turnNumber: session.questionCount + 1,
  });

  // Gate 1A: Clearly off-topic query (high confidence false)
  if (!gate.isCitizenServicesQuery && gate.isCitizenServicesConfidence >= 0.75) {
    const clarification = buildJourneyClarificationResponse(session, replyLanguage, true);
    session.plan.handoffChannels = getHandoffChannels(
      session.journey,
      replyLanguage,
      session.location,
    );
    return {
      session: buildSessionSnapshot(session),
      assistantMessage: {
        id: crypto.randomUUID(),
        role: "assistant",
        text: clarification.text,
        timestamp: new Date().toISOString(),
        choices: clarification.choices,
        isClarification: true,
      },
      routingMeta: {
        isCitizenServicesQuery: false,
        journeyConfidence: gate.journeyConfidence,
        completenessScore: gate.profileCompletenessScore,
        completenessConfidence: gate.profileCompletenessConfidence,
        escalatedToNeon: false,
        modelUsed: MODELS.DECISION,
      },
    };
  }

  // Gate 1B: Journey unresolved or low confidence (< 0.75) on an early turn -> ask clarifying choice
  if (gate.journey === "other" || (gate.needsClarification && session.journey === "other")) {
    const clarification = buildJourneyClarificationResponse(session, replyLanguage, false);
    session.plan.showHumanHandoff = gate.lowConfidenceDetected;
    session.plan.humanHandoffReason = gate.lowConfidenceDetected
      ? replyLanguage === "hi"
        ? "आपकी ज़रूरत स्पष्ट करने के लिए कृपया विकल्प चुनें या सहायता केंद्र से बात करें।"
        : "Please pick a category or contact a help centre if your need falls outside these four areas."
      : undefined;
    session.plan.handoffChannels = getHandoffChannels(
      "other",
      replyLanguage,
      session.location,
    );
    return {
      session: buildSessionSnapshot(session),
      assistantMessage: {
        id: crypto.randomUUID(),
        role: "assistant",
        text: clarification.text,
        timestamp: new Date().toISOString(),
        choices: clarification.choices,
        isClarification: true,
      },
      routingMeta: {
        isCitizenServicesQuery: gate.isCitizenServicesQuery,
        journeyConfidence: gate.journeyConfidence,
        completenessScore: gate.profileCompletenessScore,
        completenessConfidence: gate.profileCompletenessConfidence,
        escalatedToNeon: false,
        modelUsed: MODELS.DECISION,
      },
    };
  }

  // Confirmed journey
  session.journey = gate.journey;

  // Step 2: Fetch official criteria live from myScheme (24h cached on server)
  const schemeBundle = await fetchSchemesForJourney(gate.journey, session.sessionId);

  // Step 3: Route to Hydrogen (default, medium thinking) or Neon (escalation only, high thinking)
  const useNeon = gate.shouldEscalateToNeon;
  const selectedModel: ModelId = useNeon ? MODELS.NEON : MODELS.HYDROGEN;
  const selectedThinkingLevel = useNeon
    ? THINKING_LEVELS.NEON_ESCALATION
    : THINKING_LEVELS.HYDROGEN_DEFAULT;

  const remainingQuestions = Math.max(
    0,
    SESSION_LIMITS.MAX_FOLLOW_UP_QUESTIONS - session.questionCount,
  );

  // Stable prefix first (system_instruction + official myScheme criteria) for automatic implicit caching
  const stableCriteriaPrefix = buildOfficialCriteriaPrefix(schemeBundle.schemes);
  const systemInstruction = `${STABLE_SYSTEM_PROMPT}\n\n${stableCriteriaPrefix}`;

  const verifiedDocContext = session.documentConsentGranted
    ? Array.from(session.verifiedDocuments.values()).map((d) => ({
        documentType: d.documentType,
        verified: d.verified,
        summary: d.summary,
        maskedIdentifier: d.maskedIdentifier,
        extractedFacts: d.extractedFacts,
      }))
    : [];

  const stateInfo = session.location
    ? findIndiaStateByCode(session.location.stateCode)
    : undefined;
  const locationContextLine = session.location
    ? `Citizen State / UT: ${session.location.stateName}${
        session.location.district ? `, District: ${session.location.district}` : ""
      }${
        stateInfo
          ? ` (Local land record term: ${stateInfo.landRecordTermEn}${
              stateInfo.portalUrl ? `; Official state portal: ${stateInfo.portalUrl}` : ""
            })`
          : ""
      }`
    : `Citizen State / UT: Not explicitly selected yet.`;

  const langMeta = LANGUAGE_META[replyLanguage];
  const turnPrompt = [
    `Selected UI / Citizen Language: ${langMeta.englishName} — ${langMeta.scriptName}. Respond naturally in ${langMeta.englishName} (${langMeta.scriptName}) for assistantReply, choices, whyItMayFit, whatToVerify, whatIsMissing, nextOfficialAction, document labels/details, and nextStepSummary (or match the citizen's language if they wrote in another Indian language).`,
    `Citizen Journey: ${gate.journey}`,
    locationContextLine,
    `Profile Completeness Score (0-3): ${gate.profileCompletenessScore.toFixed(2)}`,
    `Remaining Follow-Up Questions Allowed: ${remainingQuestions} (if 0, do NOT ask more questions; finalize the best action plan and list remaining items in whatToVerify).`,
    useNeon
      ? `ESCALATION ACTIVE (High-Precision Eligibility Review): Decision 1 detected potential conflict, exclusion edge case, or low confidence. Carefully check every official exclusion criterion (income tax, govt employee/pensioner, land ownership, age/income thresholds), explain any ambiguity honestly, and recommend official verification / human help.`
      : `Routine Readiness Planning: Ask at most 1 decisive follow-up question with tappable choices if critical criteria are still unknown; otherwise give a clear explainable readiness plan.`,
    `Known Citizen Facts So Far: ${JSON.stringify(session.knownFacts)}`,
    verifiedDocContext.length > 0
      ? `Verified Uploaded Documents (In-Memory, Consent Active): ${JSON.stringify(verifiedDocContext)}`
      : `Verified Uploaded Documents: None uploaded yet.`,
    `Latest Citizen Message: ${cleanMessage}`,
  ].join("\n");

  assertBudgetAvailable(session.sessionId);
  const ai = getInteractionsClient();

  // Chain stateful interaction via previous_interaction_id when continuing on the same model
  const canChain =
    Boolean(session.previousInteractionId) &&
    session.previousInteractionModel === selectedModel;

  const interaction = await withTransientRetry(() =>
    ai.interactions.create({
      model: selectedModel,
      input: turnPrompt,
      system_instruction: systemInstruction,
      ...(canChain ? { previous_interaction_id: session.previousInteractionId } : {}),
      response_format: CITIZEN_TURN_SCHEMA,
      generation_config: {
        thinking_level: selectedThinkingLevel,
        max_output_tokens: useNeon ? 6500 : 4500,
      },
    }),
  );

  const tokens = extractInteractionTokens(interaction);
  recordModelUsage({
    sessionId: session.sessionId,
    model: selectedModel,
    callType: useNeon ? "eligibility_reasoning_neon" : "readiness_planning_hydrogen",
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
  });

  if (interaction.id) {
    session.previousInteractionId = interaction.id;
    session.previousInteractionModel = selectedModel;
  }

  const rawOutput = extractInteractionOutputText(interaction);
  if (!rawOutput) {
    throw new Error("Model returned an empty structured response.");
  }

  let structured: StructuredTurnOutput;
  try {
    structured = JSON.parse(rawOutput) as StructuredTurnOutput;
  } catch {
    const match = rawOutput.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Failed to parse structured JSON output from model.");
    }
    structured = JSON.parse(match[0]) as StructuredTurnOutput;
  }

  // Update session facts (strictly PII-masked)
  session.knownFacts = sanitizeStringArray(structured.knownFacts);
  session.unknownFacts = sanitizeStringArray(structured.unknownFacts);

  if (
    structured.askedFollowUpQuestion &&
    remainingQuestions > 0 &&
    !params.skipQuestionIncrement
  ) {
    session.questionCount += 1;
  }

  // Step 4: Calibrate scheme match confidence via Decision 1 (NEVER model self-assertion)
  const schemeMap = new Map(schemeBundle.schemes.map((s) => [s.slug, s]));
  const relevantOfficialSchemes: OfficialSchemeRecord[] = [];
  const assessmentsBySlug = new Map(
    (structured.schemeAssessments ?? []).map((a) => [a.slug, a]),
  );

  for (const official of schemeBundle.schemes) {
    const assessment = assessmentsBySlug.get(official.slug);
    if (!assessment || assessment.relevant) {
      relevantOfficialSchemes.push(official);
    }
  }

  const hasConflict =
    gate.hasConflictOrAmbiguity ||
    Boolean(structured.conflictOrExclusionNote && structured.conflictOrExclusionNote.trim().length > 0);

  const decisionScores = await scoreSchemeMatches({
    sessionId: session.sessionId,
    knownFacts: session.knownFacts,
    latestMessage: cleanMessage,
    schemes: relevantOfficialSchemes,
    hasConflictOrAmbiguity: hasConflict,
  });

  // Bind verified server-side sourceUrl and fetchedAt so URLs/dates can NEVER be invented
  const verifiedMatches: SchemeMatch[] = [];
  for (const official of relevantOfficialSchemes) {
    const assessment = assessmentsBySlug.get(official.slug);
    const calibrated = decisionScores.get(official.slug);
    if (!assessment || !assessment.relevant || !calibrated) continue;

    // Exclude clearly ineligible matches when Decision 1 gives very low probability with high confidence
    if (calibrated.probability < 0.2 && calibrated.confidence >= 0.8 && !hasConflict) {
      continue;
    }

    const safeChannelUrl =
      validateOfficialUrl(official.officialApplicationUrl, false)?.toString() ??
      official.sourceUrl;

    verifiedMatches.push({
      slug: official.slug,
      schemeName: official.schemeName,
      category: official.category,
      whyItMayFit: maskSensitiveText(assessment.whyItMayFit),
      whatToVerify: sanitizeStringArray(assessment.whatToVerify),
      whatIsMissing: sanitizeStringArray(assessment.whatIsMissing),
      nextOfficialAction: maskSensitiveText(assessment.nextOfficialAction),
      officialChannelUrl: safeChannelUrl,
      sourceUrl: official.sourceUrl,
      fetchedAt: official.fetchedAt,
      confidence: calibrated.label,
      confidenceSource: useNeon ? "decision-1+neon" : "decision-1",
      decisionProbability: calibrated.probability,
      decisionConfidence: calibrated.confidence,
    });
  }

  // Sort matches by calibrated probability descending
  verifiedMatches.sort((a, b) => b.decisionProbability - a.decisionProbability);

  const anyLowConfidenceMatch = verifiedMatches.some((m) => m.confidence === "Low");
  const showHumanHandoff =
    useNeon ||
    hasConflict ||
    gate.lowConfidenceDetected ||
    anyLowConfidenceMatch ||
    schemeBundle.schemes.length === 0;

  let humanHandoffReason: string | undefined;
  if (showHumanHandoff) {
    if (schemeBundle.schemes.length === 0) {
      humanHandoffReason =
        replyLanguage === "hi"
          ? "myScheme से लाइव पात्रता विवरण प्राप्त नहीं हो सका। आधिकारिक सहायता केंद्र या पोर्टल से पुष्टि करें।"
          : "Live criteria could not be fetched from myScheme. Please verify with an official portal or help centre.";
    } else if (hasConflict && structured.conflictOrExclusionNote) {
      humanHandoffReason = maskSensitiveText(structured.conflictOrExclusionNote);
    } else {
      humanHandoffReason =
        replyLanguage === "hi"
          ? "कुछ पात्रता शर्तों की आधिकारिक पुष्टि आवश्यक है। आप नज़दीकी CSC या टोल-फ्री हेल्पलाइन से बात कर सकते हैं।"
          : "Some eligibility conditions are ambiguous or have lower confidence. Speak with an official helpline or visit your nearest CSC for confirmation.";
    }
  }

  const completenessPercent = Math.min(
    100,
    Math.max(10, Math.round((gate.profileCompletenessScore / 3) * 100)),
  );

  session.plan = {
    journey: gate.journey,
    location: session.location,
    profileCompletenessScore: Number(gate.profileCompletenessScore.toFixed(2)),
    profileCompletenessPercent: completenessPercent,
    knownFacts: session.knownFacts,
    unknownFacts: session.unknownFacts,
    matches: verifiedMatches,
    documents: mergeVerifiedDocumentsIntoChecklist(
      session,
      structured.documentChecklist ?? [],
    ),
    nextStepSummary: maskSensitiveText(
      structured.nextStepSummary ||
        (replyLanguage === "hi"
          ? "कृपया ऊपर दिखाए गए आधिकारिक लिंक और दस्तावेज़ सूची की जांच करें।"
          : "Review your matched schemes, document checklist, and official channel links."),
    ),
    showHumanHandoff,
    humanHandoffReason,
    handoffChannels: getHandoffChannels(gate.journey, replyLanguage, session.location),
    sourceFetchStatus:
      schemeBundle.schemes.length > 0 ? "verified" : "unavailable",
    sourceFetchNotice: schemeBundle.unavailableReason,
    lastFetchedAt: schemeBundle.fetchedAt,
  };

  // Respect max question limit on returned quick-reply choices
  const safeChoices: ChoiceOption[] =
    remainingQuestions > 0 && Array.isArray(structured.choices)
      ? structured.choices
          .filter((c) => c && typeof c.label === "string" && typeof c.value === "string")
          .slice(0, 4)
          .map((c) => ({
            label: maskSensitiveText(c.label.trim()),
            value: maskSensitiveText(c.value.trim()),
          }))
      : [];

  return {
    session: buildSessionSnapshot(session),
    assistantMessage: {
      id: crypto.randomUUID(),
      role: "assistant",
      text: maskSensitiveText(structured.assistantReply),
      timestamp: new Date().toISOString(),
      choices: safeChoices.length > 0 ? safeChoices : undefined,
      escalated: useNeon,
    },
    routingMeta: {
      isCitizenServicesQuery: gate.isCitizenServicesQuery,
      journeyConfidence: gate.journeyConfidence,
      completenessScore: gate.profileCompletenessScore,
      completenessConfidence: gate.profileCompletenessConfidence,
      escalatedToNeon: useNeon,
      modelUsed: selectedModel,
    },
  };
}

/**
 * Re-evaluates scheme eligibility after the citizen edits or adds profile facts
 * ("What-If" check) without forcing a full session reset or burning follow-up budget.
 */
export async function recheckWithEditedFacts(params: {
  sessionId: string;
  knownFacts: string[];
  location?: CitizenLocation;
  uiLanguage: Language;
}): Promise<ChatTurnResponse> {
  const session = getOrCreateSession(params.sessionId, params.uiLanguage);
  const cleanedFacts = sanitizeStringArray(params.knownFacts).slice(0, 25);
  session.knownFacts = cleanedFacts;
  session.plan.knownFacts = cleanedFacts;
  // Reset interaction chain so the model evaluates cleanly from the updated ground-truth facts
  session.previousInteractionId = undefined;
  session.previousInteractionModel = undefined;

  if (params.location) {
    const cleanLocation = sanitizeCitizenLocation(params.location);
    if (cleanLocation) {
      session.location = cleanLocation;
      session.plan.location = cleanLocation;
    }
  }

  const locationSummary = session.location
    ? `${session.location.stateName}${session.location.district ? ` (${session.location.district})` : ""}`
    : undefined;

  const syntheticRecheckMessage =
    params.uiLanguage === "hi"
      ? `मैंने अपनी प्रोफ़ाइल जानकारी अपडेट की है। कृपया इन अपडेट किए गए तथ्यों के आधार पर मेरी सरकारी योजना पात्रता और दस्तावेज़ सूची फिर से जांचें${locationSummary ? ` (राज्य: ${locationSummary})` : ""}: ${cleanedFacts.join("; ")}`
      : `I updated my profile facts for a what-if eligibility check. Please re-evaluate my government scheme matches, confidence, exclusions, and document checklist based on these updated facts${locationSummary ? ` (State: ${locationSummary})` : ""}: ${cleanedFacts.join("; ")}`;

  return handleChatTurn({
    sessionId: session.sessionId,
    message: syntheticRecheckMessage,
    uiLanguage: params.uiLanguage,
    location: session.location,
    skipQuestionIncrement: true,
  });
}

const DOC_EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    detectedDocumentType: { type: Type.STRING },
    isReadable: { type: Type.BOOLEAN },
    maskedLast4Digits: {
      type: Type.STRING,
      description:
        "ONLY the last 4 digits of Aadhaar or bank account number if visible (e.g. '1234'). NEVER return full 12-digit Aadhaar or full account numbers. Empty string if not applicable.",
    },
    extractedReadinessFacts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "Non-sensitive readiness facts only (e.g., 'State: Uttar Pradesh', 'Land area shown: 2 acres', 'IFSC code present', 'Name present on document'). Never include full ID numbers.",
    },
    citizenSummary: {
      type: Type.STRING,
      description:
        "Short 1-2 sentence confirmation in the citizen's language stating what was verified and what still needs checking (if anything).",
    },
  },
  required: [
    "detectedDocumentType",
    "isReadable",
    "maskedLast4Digits",
    "extractedReadinessFacts",
    "citizenSummary",
  ],
};

/**
 * In-memory document photo analysis with mandatory explicit session consent,
 * Decision 1 type/legibility gating, Hydrogen field extraction, and strict PII masking.
 * Never persists or logs image bytes or full ID numbers.
 */
export async function handleDocumentAnalysis(params: {
  sessionId: string;
  claimedType: DocumentTypeKey;
  imageBase64: string;
  mimeType: string;
  uiLanguage: Language;
}): Promise<DocumentAnalyzeResponse> {
  const session = getOrCreateSession(params.sessionId, params.uiLanguage);

  if (!session.documentConsentGranted) {
    throw new ConsentRequiredError();
  }

  assertBudgetAvailable(session.sessionId);

  // Step 1: Decision 1 multimodal verification of document type + legibility
  const docGate = await verifyDocumentMatchesClaimedType({
    sessionId: session.sessionId,
    imageBase64: params.imageBase64,
    mimeType: params.mimeType,
    claimedType: params.claimedType,
  });

  const isHi = params.uiLanguage === "hi";
  const escalatedForReview =
    docGate.lowConfidenceDetected || !docGate.matchesClaimedType || !docGate.isLegible;

  if (!docGate.matchesClaimedType || !docGate.isLegible) {
    const mismatchMsg = !docGate.matchesClaimedType
      ? isHi
        ? "यह फोटो चुने गए दस्तावेज़ के प्रकार से मेल नहीं खाती दिख रही है। कृपया सही दस्तावेज़ चुनें या साफ फोटो फिर से अपलोड करें।"
        : "This photo does not appear to match the selected document type. Please select the correct type or upload a clearer photo."
      : isHi
        ? "यह फोटो थोड़ी धुंधली या कटी हुई है। कृपया रोशनी में पूरी और साफ फोटो अपलोड करें।"
        : "This photo looks blurry or cropped. Please upload a clearer, well-lit photo so we can verify readiness.";

    session.plan.showHumanHandoff = true;
    session.plan.humanHandoffReason = mismatchMsg;

    return {
      session: buildSessionSnapshot(session),
      assistantMessage: {
        id: crypto.randomUUID(),
        role: "assistant",
        text: mismatchMsg,
        timestamp: new Date().toISOString(),
        isClarification: true,
        documentEvent: {
          claimedType: params.claimedType,
          verified: false,
          maskedSummary: mismatchMsg,
        },
      },
      verification: {
        matchesClaimedType: docGate.matchesClaimedType,
        matchConfidence: docGate.matchConfidence,
        isLegible: docGate.isLegible,
        extractedSummary: mismatchMsg,
        escalatedForReview: true,
      },
    };
  }

  // Step 2: Hydrogen (`medium` thinking) extracts ONLY readiness fields (in-memory only)
  assertBudgetAvailable(session.sessionId);
  const ai = getInteractionsClient();

  const extractInteraction = await withTransientRetry(() =>
    ai.interactions.create({
      model: MODELS.HYDROGEN,
      input: [
        {
          type: "text",
          text: [
            `Document Type Claimed: ${params.claimedType}.`,
            `Citizen Language: ${LANGUAGE_META[params.uiLanguage].englishName} (${LANGUAGE_META[params.uiLanguage].scriptName}). Write citizenSummary and extractedReadinessFacts in this language.`,
            `Extract ONLY scheme-readiness facts (such as state/district, land area if land record, bank IFSC/account active status if passbook, income band if income certificate, or name/DOB presence).`,
            `PRIVACY RULE: NEVER output a full 12-digit Aadhaar number or full bank account number. Output ONLY the last 4 digits in maskedLast4Digits.`,
          ].join("\n"),
        },
        {
          type: "image",
          data: params.imageBase64,
          mime_type: params.mimeType,
        },
      ],
      system_instruction:
        "You verify Indian citizen documents strictly for application readiness. Never output full Aadhaar or bank account numbers—only last 4 digits. Keep summary short and clear.",
      response_format: DOC_EXTRACTION_SCHEMA,
      generation_config: {
        thinking_level: THINKING_LEVELS.HYDROGEN_DEFAULT,
        max_output_tokens: 2800,
      },
    }),
  );

  const tokens = extractInteractionTokens(extractInteraction);
  recordModelUsage({
    sessionId: session.sessionId,
    model: MODELS.HYDROGEN,
    callType: "document_field_extraction",
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
  });

  const rawText = extractInteractionOutputText(extractInteraction);
  let extracted: {
    detectedDocumentType?: string;
    isReadable?: boolean;
    maskedLast4Digits?: string;
    extractedReadinessFacts?: string[];
    citizenSummary?: string;
  } = {};

  try {
    extracted = JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) extracted = JSON.parse(match[0]);
  }

  const isAadhaar = params.claimedType === "aadhaar";
  const maskedIdentifier = maskIdentifierValue(extracted.maskedLast4Digits, isAadhaar);
  const safeFacts = sanitizeStringArray(extracted.extractedReadinessFacts);
  const safeSummary = maskSensitiveText(
    extracted.citizenSummary ||
      (isHi
        ? "दस्तावेज़ की जांच हो गई है और इसे आपकी सूची में 'तैयार' चिह्नित किया गया है।"
        : "Document checked and marked as Ready in your checklist."),
  );

  // Store masked readiness result in session memory only (no raw bytes stored!)
  const mem: VerifiedDocMemory = {
    documentType: params.claimedType,
    verified: !docGate.lowConfidenceDetected,
    summary: safeSummary,
    maskedIdentifier,
    extractedFacts: safeFacts,
    checkedAt: new Date().toISOString(),
  };
  session.verifiedDocuments.set(params.claimedType, mem);

  // Add non-sensitive facts to knownFacts
  for (const fact of safeFacts) {
    if (!session.knownFacts.includes(fact)) {
      session.knownFacts.push(fact);
    }
  }

  // Update checklist items in plan
  let matchedExisting = false;
  session.plan.documents = session.plan.documents.map((doc) => {
    if (doc.documentType === params.claimedType) {
      matchedExisting = true;
      return {
        ...doc,
        status: mem.verified ? "ready" : "needs_verification",
        detail: safeSummary,
        maskedIdentifier,
      };
    }
    return doc;
  });

  if (!matchedExisting) {
    session.plan.documents.push({
      id: params.claimedType,
      documentType: params.claimedType,
      label: params.claimedType
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      status: mem.verified ? "ready" : "needs_verification",
      detail: safeSummary,
      maskedIdentifier,
      requiredForSchemes: session.plan.matches.map((m) => m.schemeName),
    });
  }

  // Remove satisfied document from match.whatIsMissing where label matches
  const docKeyword = params.claimedType.replace(/_/g, " ").split(" ")[0]?.toLowerCase() ?? "";
  if (mem.verified && docKeyword) {
    session.plan.matches = session.plan.matches.map((m) => ({
      ...m,
      whatIsMissing: m.whatIsMissing.filter(
        (item) => !item.toLowerCase().includes(docKeyword),
      ),
    }));
  }

  if (docGate.lowConfidenceDetected) {
    session.plan.showHumanHandoff = true;
    session.plan.humanHandoffReason = isHi
      ? "दस्तावेज़ की पुष्टि में कम विश्वास है — कृपया मूल दस्तावेज़ CSC या अधिकारी के साथ जांचें।"
      : "Document verification had lower confidence — please confirm the original document at a CSC or official desk.";
  }

  const replyText = maskedIdentifier
    ? `${safeSummary} (${isHi ? "मास्क किया गया नंबर" : "Masked ID"}: ${maskedIdentifier})`
    : safeSummary;

  return {
    session: buildSessionSnapshot(session),
    assistantMessage: {
      id: crypto.randomUUID(),
      role: "assistant",
      text: replyText,
      timestamp: new Date().toISOString(),
      documentEvent: {
        claimedType: params.claimedType,
        verified: mem.verified,
        maskedSummary: replyText,
      },
    },
    verification: {
      matchesClaimedType: docGate.matchesClaimedType,
      matchConfidence: docGate.matchConfidence,
      isLegible: docGate.isLegible,
      extractedSummary: replyText,
      maskedIdentifier,
      escalatedForReview,
    },
  };
}
