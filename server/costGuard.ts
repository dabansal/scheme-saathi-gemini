import { MODELS, SESSION_LIMITS } from "../shared/models.ts";
import type { ModelId } from "../shared/models.ts";

/**
 * Conservative USD per 1M token pricing estimates used strictly for local
 * demo budget guardrails and server console cost telemetry (zero PII logged).
 */
const COST_PER_1M_TOKENS_USD: Record<ModelId, { input: number; output: number }> = {
  [MODELS.DECISION]: { input: 0.15, output: 0.0 },
  [MODELS.HYDROGEN]: { input: 0.30, output: 1.50 },
  [MODELS.NEON]: { input: 1.25, output: 5.00 },
};

export class DemoBudgetExceededError extends Error {
  readonly scope: "session" | "daily";
  readonly messageHi: string;

  constructor(scope: "session" | "daily") {
    const message =
      scope === "daily"
        ? "Demo limit reached: the daily demo budget cap has been reached. Please try again tomorrow or visit myscheme.gov.in directly."
        : "Demo limit reached: this session has reached its token limit. Start a new session or continue directly on myscheme.gov.in.";
    super(message);
    this.name = "DemoBudgetExceededError";
    this.scope = scope;
    this.messageHi =
      scope === "daily"
        ? "डेमो सीमा पूरी हो गई है: आज की दैनिक सीमा समाप्त हो गई है। कृपया कल फिर प्रयास करें या सीधे myscheme.gov.in पर जाएं।"
        : "डेमो सीमा पूरी हो गई है: इस सत्र की सीमा समाप्त हो गई है। नया सत्र शुरू करें या सीधे myscheme.gov.in पर आगे बढ़ें।";
  }
}

interface DailyLedger {
  dateUtc: string;
  totalTokens: number;
  estimatedSpendUsd: number;
  callCount: number;
}

interface SessionLedger {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSessionTokenCap(): number {
  return parsePositiveNumber(
    process.env.SESSION_TOKEN_CAP,
    SESSION_LIMITS.DEFAULT_SESSION_TOKEN_CAP,
  );
}

export function getDailySpendCapUsd(): number {
  return parsePositiveNumber(
    process.env.DAILY_SPEND_CAP_USD,
    SESSION_LIMITS.DEFAULT_DAILY_SPEND_CAP_USD,
  );
}

let dailyLedger: DailyLedger = {
  dateUtc: getTodayUtc(),
  totalTokens: 0,
  estimatedSpendUsd: 0,
  callCount: 0,
};

const sessionLedgers = new Map<string, SessionLedger>();

function rotateDailyLedgerIfNeeded(): void {
  const today = getTodayUtc();
  if (dailyLedger.dateUtc !== today) {
    dailyLedger = {
      dateUtc: today,
      totalTokens: 0,
      estimatedSpendUsd: 0,
      callCount: 0,
    };
  }
}

export function estimateCostUsd(
  model: ModelId,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = COST_PER_1M_TOKENS_USD[model];
  const inputCost = (Math.max(0, inputTokens) / 1_000_000) * rate.input;
  const outputCost = (Math.max(0, outputTokens) / 1_000_000) * rate.output;
  return Number((inputCost + outputCost).toFixed(6));
}

export function assertBudgetAvailable(sessionId: string): void {
  rotateDailyLedgerIfNeeded();
  const dailyCap = getDailySpendCapUsd();
  if (dailyLedger.estimatedSpendUsd >= dailyCap) {
    throw new DemoBudgetExceededError("daily");
  }
  const sessionCap = getSessionTokenCap();
  const sessionStats = sessionLedgers.get(sessionId);
  if (sessionStats && sessionStats.totalTokens >= sessionCap) {
    throw new DemoBudgetExceededError("session");
  }
}

export function recordModelUsage(params: {
  sessionId: string;
  model: ModelId;
  callType: string;
  inputTokens: number;
  outputTokens: number;
}): { callCostUsd: number; sessionTotalTokens: number; sessionCostUsd: number } {
  rotateDailyLedgerIfNeeded();
  const safeInput = Math.max(0, Math.round(params.inputTokens));
  const safeOutput = Math.max(0, Math.round(params.outputTokens));
  const callTotal = safeInput + safeOutput;
  const callCostUsd = estimateCostUsd(params.model, safeInput, safeOutput);

  const existing = sessionLedgers.get(params.sessionId) ?? {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
  existing.inputTokens += safeInput;
  existing.outputTokens += safeOutput;
  existing.totalTokens += callTotal;
  existing.estimatedCostUsd = Number((existing.estimatedCostUsd + callCostUsd).toFixed(6));
  sessionLedgers.set(params.sessionId, existing);

  dailyLedger.totalTokens += callTotal;
  dailyLedger.estimatedSpendUsd = Number((dailyLedger.estimatedSpendUsd + callCostUsd).toFixed(6));
  dailyLedger.callCount += 1;

  // Strict non-PII server console logging of per-call model and token usage
  console.log(
    JSON.stringify({
      event: "gemini_model_call",
      timestamp: new Date().toISOString(),
      model: params.model,
      callType: params.callType,
      inputTokens: safeInput,
      outputTokens: safeOutput,
      estimatedCostUsd: callCostUsd,
      sessionTotalTokens: existing.totalTokens,
      dailySpendUsd: dailyLedger.estimatedSpendUsd,
    }),
  );

  return {
    callCostUsd,
    sessionTotalTokens: existing.totalTokens,
    sessionCostUsd: existing.estimatedCostUsd,
  };
}

export function getSessionBudgetSnapshot(sessionId: string): {
  sessionTokensUsed: number;
  sessionTokenCap: number;
  estimatedSessionCostUsd: number;
  limitReached: boolean;
} {
  rotateDailyLedgerIfNeeded();
  const stats = sessionLedgers.get(sessionId);
  const sessionTokenCap = getSessionTokenCap();
  const dailyCap = getDailySpendCapUsd();
  const used = stats?.totalTokens ?? 0;
  return {
    sessionTokensUsed: used,
    sessionTokenCap,
    estimatedSessionCostUsd: stats?.estimatedCostUsd ?? 0,
    limitReached: used >= sessionTokenCap || dailyLedger.estimatedSpendUsd >= dailyCap,
  };
}

export function getDailyBudgetSummary(): {
  dateUtc: string;
  dailySpendUsd: number;
  dailySpendCapUsd: number;
  totalTokens: number;
  callCount: number;
} {
  rotateDailyLedgerIfNeeded();
  return {
    dateUtc: dailyLedger.dateUtc,
    dailySpendUsd: dailyLedger.estimatedSpendUsd,
    dailySpendCapUsd: getDailySpendCapUsd(),
    totalTokens: dailyLedger.totalTokens,
    callCount: dailyLedger.callCount,
  };
}

export function clearSessionLedger(sessionId: string): void {
  sessionLedgers.delete(sessionId);
}
