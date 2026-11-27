import { GoogleGenAI } from "@google/genai";

let cachedInteractionsClient: GoogleGenAI | null = null;
let cachedDecisionsClient: GoogleGenAI | null = null;
let cachedApiKey: string | undefined;

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error(
      "GEMINI_API_KEY is not configured on the server. Configure it in Settings > Secrets.",
    );
  }
  return apiKey;
}

/**
 * Standard Interactions API client (default v1 in @google/genai 3.x).
 * Server-side only; never imported in browser code.
 */
export function getInteractionsClient(): GoogleGenAI {
  const apiKey = getApiKey();
  if (!cachedInteractionsClient || cachedApiKey !== apiKey) {
    cachedInteractionsClient = new GoogleGenAI({ apiKey });
    cachedDecisionsClient = null;
    cachedApiKey = apiKey;
  }
  return cachedInteractionsClient;
}

/**
 * Dedicated v1beta client for Decisions API (`gemini-decision-1`).
 * Decisions API is strictly v1beta-only in @google/genai >= 3.2.0.
 */
export function getDecisionsClient(): GoogleGenAI {
  const apiKey = getApiKey();
  if (!cachedDecisionsClient || cachedApiKey !== apiKey) {
    cachedDecisionsClient = new GoogleGenAI({
      apiKey,
      apiVersion: "v1beta",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    cachedApiKey = apiKey;
  }
  return cachedDecisionsClient;
}

export function extractInteractionTokens(interaction: unknown): {
  inputTokens: number;
  outputTokens: number;
} {
  const usage = (
    interaction as {
      usage?: {
        total_input_tokens?: number;
        total_output_tokens?: number;
        total_thought_tokens?: number;
        total_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
      };
    }
  )?.usage;

  const inputTokens =
    usage?.total_input_tokens ?? usage?.input_tokens ?? 0;
  const outputTokens =
    (usage?.total_output_tokens ?? usage?.output_tokens ?? 0) +
    (usage?.total_thought_tokens ?? 0);

  if (inputTokens === 0 && outputTokens === 0 && usage?.total_tokens) {
    return {
      inputTokens: Math.round(usage.total_tokens * 0.7),
      outputTokens: Math.round(usage.total_tokens * 0.3),
    };
  }
  return { inputTokens, outputTokens };
}

export function extractDecisionTokens(decisionResponse: unknown): {
  inputTokens: number;
  outputTokens: number;
} {
  const usage = (
    decisionResponse as {
      usage?: {
        total_input_tokens?: number;
        total_output_tokens?: number;
        total_tokens?: number;
      };
    }
  )?.usage;
  return {
    inputTokens: usage?.total_input_tokens ?? usage?.total_tokens ?? 0,
    outputTokens: usage?.total_output_tokens ?? 0,
  };
}

export function extractInteractionOutputText(interaction: unknown): string {
  const typed = interaction as {
    output_text?: string | null;
    steps?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    outputs?: Array<{
      type?: string;
      text?: string;
    }>;
  };

  if (typeof typed?.output_text === "string" && typed.output_text.trim().length > 0) {
    return typed.output_text.trim();
  }
  if (Array.isArray(typed?.steps)) {
    const modelOutputSteps = typed.steps.filter((s) => s.type === "model_output");
    const lastStep = modelOutputSteps.at(-1);
    if (lastStep?.content) {
      const combined = lastStep.content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text ?? "")
        .join("")
        .trim();
      if (combined) return combined;
    }
  }
  if (Array.isArray(typed?.outputs)) {
    const combined = typed.outputs
      .filter((o) => o.type === "text" && typeof o.text === "string")
      .map((o) => o.text ?? "")
      .join("")
      .trim();
    if (combined) return combined;
  }
  return "";
}

/**
 * Exponential backoff retry wrapper strictly for transient network/429/5xx errors.
 */
export async function withTransientRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 2,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number; code?: number })?.status ??
        (err as { code?: number })?.code;
      const isRetryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!isRetryable || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = 450 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
