import { isSupportedLanguage } from "../../shared/models.ts";
import type {
  ChatMessage,
  CitizenLocation,
  Language,
  PlanState,
  SessionSnapshot,
} from "../../shared/models.ts";
import type { PlanTab } from "../components/PlanPanel.tsx";

const STORAGE_KEY = "scheme_saathi_saved_session_v1";
const STORAGE_VERSION = 1;

export interface SavedSessionData {
  version: number;
  savedAt: string;
  language: Language;
  activeTab: PlanTab;
  location?: CitizenLocation;
  manualReadyDocIds?: string[];
  session: SessionSnapshot;
  messages: ChatMessage[];
}

const AADHAAR_REGEX = /\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})\b/g;
const LONG_ACCOUNT_REGEX = /\b\d{9,18}\b/g;

function scrubTextForLocalStorage(text: string): string {
  if (!text) return "";
  return text
    .replace(AADHAAR_REGEX, (_m, _g1, _g2, last4: string) => `XXXX-XXXX-${last4}`)
    .replace(LONG_ACCOUNT_REGEX, (digits: string) => `XXXX${digits.slice(-4)}`);
}

function sanitizePlanForStorage(plan: PlanState): PlanState {
  return {
    ...plan,
    knownFacts: (plan.knownFacts ?? []).map(scrubTextForLocalStorage),
    unknownFacts: (plan.unknownFacts ?? []).map(scrubTextForLocalStorage),
    nextStepSummary: scrubTextForLocalStorage(plan.nextStepSummary ?? ""),
    humanHandoffReason: plan.humanHandoffReason
      ? scrubTextForLocalStorage(plan.humanHandoffReason)
      : undefined,
    matches: (plan.matches ?? []).map((m) => ({
      ...m,
      whyItMayFit: scrubTextForLocalStorage(m.whyItMayFit),
      whatToVerify: (m.whatToVerify ?? []).map(scrubTextForLocalStorage),
      whatIsMissing: (m.whatIsMissing ?? []).map(scrubTextForLocalStorage),
      nextOfficialAction: scrubTextForLocalStorage(m.nextOfficialAction),
    })),
    // Never persist uploaded document identifiers in browser storage
    documents: (plan.documents ?? []).map((doc) => ({
      ...doc,
      detail: scrubTextForLocalStorage(doc.detail),
      maskedIdentifier: undefined,
    })),
  };
}

function sanitizeMessagesForStorage(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-30).map((msg) => ({
    id: msg.id,
    role: msg.role,
    text: scrubTextForLocalStorage(msg.text),
    timestamp: msg.timestamp,
    choices: msg.choices,
    isClarification: msg.isClarification,
    escalated: msg.escalated,
    // Omit raw document event details from persisted storage
  }));
}

/**
 * Determines whether the citizen has an active session that is not yet finished
 * (still has follow-up choices, unknown facts, missing documents, or incomplete profile).
 */
export function isSessionUnfinished(
  session: SessionSnapshot | null,
  messages: ChatMessage[],
): boolean {
  if (!session || messages.length === 0) return false;
  const latestMsg = messages[messages.length - 1];
  const hasPendingQuestion =
    latestMsg?.role === "assistant" &&
    Boolean(latestMsg.choices && latestMsg.choices.length > 0);
  const hasUnknownFacts = session.plan.unknownFacts.length > 0;
  const hasMissingDocs = session.plan.documents.some((d) => d.status !== "ready");
  const incompleteProfile = session.plan.profileCompletenessPercent < 95;
  const noMatchesYet = session.plan.matches.length === 0;

  return (
    hasPendingQuestion ||
    noMatchesYet ||
    incompleteProfile ||
    hasUnknownFacts ||
    hasMissingDocs
  );
}

export function saveSessionProgress(params: {
  language: Language;
  activeTab: PlanTab;
  location?: CitizenLocation;
  manualReadyDocIds?: string[];
  session: SessionSnapshot;
  messages: ChatMessage[];
}): SavedSessionData | null {
  if (typeof window === "undefined") return null;
  try {
    const safeLocation: CitizenLocation | undefined = params.location?.stateCode
      ? {
          stateCode: params.location.stateCode,
          stateName: params.location.stateName,
          district: params.location.district
            ? scrubTextForLocalStorage(params.location.district.trim()).slice(0, 80)
            : undefined,
        }
      : undefined;
    const sanitizedSession: SessionSnapshot = {
      ...params.session,
      // Consent is strictly per-session and must never be persisted across reloads
      documentConsentGranted: false,
      plan: {
        ...sanitizePlanForStorage(params.session.plan),
        location: safeLocation ?? params.session.plan.location,
      },
    };
    const payload: SavedSessionData = {
      version: STORAGE_VERSION,
      savedAt: new Date().toISOString(),
      language: params.language,
      activeTab: params.activeTab,
      location: safeLocation,
      manualReadyDocIds: (params.manualReadyDocIds ?? []).slice(0, 30),
      session: sanitizedSession,
      messages: sanitizeMessagesForStorage(params.messages),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

export function loadSavedSessionProgress(): SavedSessionData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedSessionData>;
    if (
      parsed.version !== STORAGE_VERSION ||
      typeof parsed.savedAt !== "string" ||
      !isSupportedLanguage(parsed.language) ||
      !parsed.session ||
      typeof parsed.session.sessionId !== "string" ||
      !Array.isArray(parsed.messages) ||
      parsed.messages.length === 0
    ) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const validTabs = new Set<PlanTab>(["matches", "documents", "nextStep"]);
    const safeTab: PlanTab =
      typeof parsed.activeTab === "string" &&
      validTabs.has(parsed.activeTab as PlanTab)
        ? (parsed.activeTab as PlanTab)
        : "matches";
    const safeManualIds = Array.isArray(parsed.manualReadyDocIds)
      ? parsed.manualReadyDocIds
          .filter((id): id is string => typeof id === "string" && id.length <= 80)
          .slice(0, 30)
      : [];
    return {
      version: STORAGE_VERSION,
      savedAt: parsed.savedAt,
      language: parsed.language,
      activeTab: safeTab,
      location: parsed.location ?? parsed.session.plan.location,
      manualReadyDocIds: safeManualIds,
      session: {
        ...parsed.session,
        documentConsentGranted: false,
      },
      messages: parsed.messages,
    };
  } catch {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    return null;
  }
}

export function clearSavedSessionProgress(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}
