/**
 * Shared model constants, thresholds, and domain types for Scheme Saathi.
 * All Gemini model IDs live strictly in this single module.
 */

export const MODELS = {
  DECISION: "gemini-decision-1",
  HYDROGEN: "gemini-4-hydrogen",
  NEON: "gemini-4-neon",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

/**
 * Valid Gemini 4 thinking levels: "low" | "medium" | "high" | "xhigh".
 * Never use "minimal" on Hydrogen or Neon.
 */
export const THINKING_LEVELS = {
  HYDROGEN_DEFAULT: "medium",
  NEON_ESCALATION: "high",
} as const;

export const CONFIDENCE_THRESHOLDS = {
  /** Below 0.75, escalate to Gemini 4 Neon or ask the citizen a clarifying question. */
  DECISION_ESCALATION: 0.75,
  HIGH_MATCH_PROB: 0.74,
  HIGH_CONFIDENCE: 0.78,
  MEDIUM_MATCH_PROB: 0.48,
  MEDIUM_CONFIDENCE: 0.65,
} as const;

export const SESSION_LIMITS = {
  MAX_FOLLOW_UP_QUESTIONS: 5,
  MAX_DOCUMENT_BYTES: 6 * 1024 * 1024,
  DEFAULT_SESSION_TOKEN_CAP: 45_000,
  DEFAULT_DAILY_SPEND_CAP_USD: 5.0,
  TARGET_SESSION_COST_USD: 0.05,
} as const;

export const SUPPORTED_LANGUAGES = [
  "en",
  "hi",
  "mr",
  "ta",
  "te",
  "bn",
  "kn",
  "gu",
] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export interface LanguageMeta {
  code: Language;
  nativeLabel: string;
  englishName: string;
  locale: string;
  scriptName: string;
}

export const LANGUAGE_META: Record<Language, LanguageMeta> = {
  en: {
    code: "en",
    nativeLabel: "English",
    englishName: "English",
    locale: "en-IN",
    scriptName: "English (Latin script)",
  },
  hi: {
    code: "hi",
    nativeLabel: "हिन्दी",
    englishName: "Hindi",
    locale: "hi-IN",
    scriptName: "Hindi (Devanagari script)",
  },
  mr: {
    code: "mr",
    nativeLabel: "मराठी",
    englishName: "Marathi",
    locale: "mr-IN",
    scriptName: "Marathi (Devanagari script)",
  },
  ta: {
    code: "ta",
    nativeLabel: "தமிழ்",
    englishName: "Tamil",
    locale: "ta-IN",
    scriptName: "Tamil script",
  },
  te: {
    code: "te",
    nativeLabel: "తెలుగు",
    englishName: "Telugu",
    locale: "te-IN",
    scriptName: "Telugu script",
  },
  bn: {
    code: "bn",
    nativeLabel: "বাংলা",
    englishName: "Bengali",
    locale: "bn-IN",
    scriptName: "Bengali script",
  },
  kn: {
    code: "kn",
    nativeLabel: "ಕನ್ನಡ",
    englishName: "Kannada",
    locale: "kn-IN",
    scriptName: "Kannada script",
  },
  gu: {
    code: "gu",
    nativeLabel: "ગુજરાતી",
    englishName: "Gujarati",
    locale: "gu-IN",
    scriptName: "Gujarati script",
  },
};

export function isSupportedLanguage(value: unknown): value is Language {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

export type JourneyType = "farmer" | "student" | "health" | "livelihood" | "other";

export type ConfidenceLabel = "High" | "Medium" | "Low";

export type DocumentStatus = "ready" | "missing" | "needs_verification";

export type DocumentTypeKey =
  | "aadhaar"
  | "land_record"
  | "bank_passbook"
  | "income_certificate"
  | "caste_certificate"
  | "ration_card"
  | "student_id_marksheet"
  | "artisan_business_proof"
  | "other";

export interface ChoiceOption {
  label: string;
  value: string;
}

export interface OfficialSchemeRecord {
  slug: string;
  schemeName: string;
  ministry: string;
  category: string;
  journey: Exclude<JourneyType, "other">;
  sourceUrl: string;
  officialApplicationUrl: string;
  eligibilityCriteria: string[];
  exclusions: string[];
  benefits: string[];
  requiredDocuments: string[];
  applicationChannel: string;
  extractedText: string;
  fetchedAt: string;
  urlVerified: boolean;
  fetchMethod: "myscheme-api" | "myscheme-html" | "myscheme-live-search-verified";
}

export interface SchemeFetchBundle {
  journey: Exclude<JourneyType, "other">;
  schemes: OfficialSchemeRecord[];
  fetchedAt: string;
  fromCache: boolean;
  unavailableReason?: string;
}

export interface SchemeMatch {
  slug: string;
  schemeName: string;
  category: string;
  whyItMayFit: string;
  whatToVerify: string[];
  whatIsMissing: string[];
  nextOfficialAction: string;
  officialChannelUrl: string;
  sourceUrl: string;
  fetchedAt: string;
  confidence: ConfidenceLabel;
  confidenceSource: "decision-1" | "decision-1+neon";
  decisionProbability: number;
  decisionConfidence: number;
}

export interface DocumentChecklistItem {
  id: string;
  documentType: DocumentTypeKey;
  label: string;
  status: DocumentStatus;
  detail: string;
  maskedIdentifier?: string;
  requiredForSchemes: string[];
}

export interface HumanHandoffChannel {
  title: string;
  description: string;
  contactOrUrl: string;
  isUrl: boolean;
}

export interface CitizenLocation {
  stateCode: string;
  stateName: string;
  district?: string;
}

export interface PlanState {
  journey: JourneyType;
  location?: CitizenLocation;
  profileCompletenessScore: number; // 0 to 3
  profileCompletenessPercent: number; // 0 to 100
  knownFacts: string[];
  unknownFacts: string[];
  matches: SchemeMatch[];
  documents: DocumentChecklistItem[];
  nextStepSummary: string;
  showHumanHandoff: boolean;
  humanHandoffReason?: string;
  handoffChannels: HumanHandoffChannel[];
  sourceFetchStatus: "idle" | "verified" | "partial" | "unavailable";
  sourceFetchNotice?: string;
  lastFetchedAt?: string;
}

export interface ChatMessage {
  id: string;
  role: "citizen" | "assistant";
  text: string;
  timestamp: string;
  choices?: ChoiceOption[];
  isClarification?: boolean;
  escalated?: boolean;
  documentEvent?: {
    claimedType: DocumentTypeKey;
    verified: boolean;
    maskedSummary: string;
  };
}

export interface SessionSnapshot {
  sessionId: string;
  language: Language;
  questionCount: number;
  maxQuestions: number;
  documentConsentGranted: boolean;
  plan: PlanState;
  budget: {
    sessionTokensUsed: number;
    sessionTokenCap: number;
    estimatedSessionCostUsd: number;
    limitReached: boolean;
  };
}

export interface ChatTurnResponse {
  session: SessionSnapshot;
  assistantMessage: ChatMessage;
  routingMeta: {
    isCitizenServicesQuery: boolean;
    journeyConfidence: number;
    completenessScore: number;
    completenessConfidence: number;
    escalatedToNeon: boolean;
    modelUsed: ModelId;
  };
}

export interface DocumentAnalyzeResponse {
  session: SessionSnapshot;
  assistantMessage: ChatMessage;
  verification: {
    matchesClaimedType: boolean;
    matchConfidence: number;
    isLegible: boolean;
    extractedSummary: string;
    maskedIdentifier?: string;
    escalatedForReview: boolean;
  };
}

export interface EvalCaseMetrics {
  caseId: string;
  profileType: "complete" | "incomplete" | "ambiguous";
  language: Language;
  promptUsed: string;
  passed: boolean;
  durationMs: number;
  explanationAccuracy: {
    score: number; // 0-100
    notes: string;
  };
  checklistCompleteness: {
    score: number; // 0-100
    totalItems: number;
    readyCount: number;
    missingCount: number;
  };
  sourceTraceability: {
    percent: number; // 0-100
    matchesWithVerifiedSource: number;
    totalMatches: number;
  };
  languageMatch: boolean;
  hasClearNextAction: boolean;
  escalatedToNeon: boolean;
  showedHumanHandoff: boolean;
  modelsUsed: ModelId[];
  estimatedCostUsd: number;
  sampleReply: string;
  error?: string;
}

export interface EvalSuiteReport {
  runAt: string;
  totalDurationMs: number;
  cases: EvalCaseMetrics[];
  summary: {
    passRatePercent: number;
    avgSourceTraceabilityPercent: number;
    avgChecklistCompleteness: number;
    avgDurationMs: number;
    totalEstimatedCostUsd: number;
    bilingualCompletion: boolean;
  };
}
