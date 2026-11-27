import type {
  ChatTurnResponse,
  CitizenLocation,
  DocumentAnalyzeResponse,
  DocumentTypeKey,
  EvalSuiteReport,
  Language,
  SessionSnapshot,
} from "../shared/models.ts";

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly messageHi?: string;

  constructor(status: number, code: string, message: string, messageHi?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.messageHi = messageHi;
  }
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    messageHi?: string;
  };
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      payload.error ?? "REQUEST_FAILED",
      payload.message ?? `Request failed (${response.status})`,
      payload.messageHi,
    );
  }
  return payload as T;
}

export async function sendChatTurn(params: {
  sessionId?: string;
  message: string;
  language: Language;
  location?: CitizenLocation;
}): Promise<ChatTurnResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow<ChatTurnResponse>(res);
}

export async function recheckCitizenFacts(params: {
  sessionId: string;
  knownFacts: string[];
  location?: CitizenLocation;
  language: Language;
}): Promise<ChatTurnResponse> {
  const res = await fetch("/api/session/recheck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow<ChatTurnResponse>(res);
}

export async function fetchMapsConfig(): Promise<{
  configured: boolean;
  apiKey: string;
}> {
  const envKey = (
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
  )?.trim();
  if (envKey) {
    return { configured: true, apiKey: envKey };
  }
  const res = await fetch("/api/maps/config");
  return parseJsonOrThrow<{ configured: boolean; apiKey: string }>(res);
}

export async function updateSessionConsent(params: {
  sessionId: string;
  granted: boolean;
  language: Language;
}): Promise<{ session: SessionSnapshot }> {
  const res = await fetch("/api/session/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow<{ session: SessionSnapshot }>(res);
}

export async function resetCitizenSession(params: {
  sessionId?: string;
  language: Language;
}): Promise<{ session: SessionSnapshot }> {
  const res = await fetch("/api/session/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow<{ session: SessionSnapshot }>(res);
}

export async function restoreCitizenSession(params: {
  sessionId?: string;
  language: Language;
  questionCount: number;
  plan: SessionSnapshot["plan"];
}): Promise<{ session: SessionSnapshot }> {
  const res = await fetch("/api/session/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow<{ session: SessionSnapshot }>(res);
}

export async function analyzeDocumentPhoto(params: {
  sessionId: string;
  claimedType: DocumentTypeKey;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  imageBase64: string;
  language: Language;
}): Promise<DocumentAnalyzeResponse> {
  const res = await fetch("/api/document/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return parseJsonOrThrow<DocumentAnalyzeResponse>(res);
}

export async function fetchEvalCases(): Promise<{
  cases: Array<{
    caseId: string;
    profileType: "complete" | "incomplete" | "ambiguous";
    language: Language;
    prompt: string;
  }>;
}> {
  const res = await fetch("/api/eval/cases");
  return parseJsonOrThrow(res);
}

export async function runEvaluationSuite(caseIds?: string[]): Promise<EvalSuiteReport> {
  const res = await fetch("/api/eval/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseIds }),
  });
  return parseJsonOrThrow<EvalSuiteReport>(res);
}
