import { Type } from "@google/genai";
import * as cheerio from "cheerio";
import { MODELS } from "../shared/models.ts";
import type {
  JourneyType,
  OfficialSchemeRecord,
  SchemeFetchBundle,
} from "../shared/models.ts";
import { assertBudgetAvailable, recordModelUsage } from "./costGuard.ts";
import {
  extractInteractionOutputText,
  extractInteractionTokens,
  getInteractionsClient,
  withTransientRetry,
} from "./geminiClient.ts";

const USER_AGENT =
  "SchemeSaathi/1.0 (+https://www.myscheme.gov.in; Indian Citizen Scheme Readiness Companion)";

const ALLOWED_MYSCHEME_HOSTS = new Set([
  "www.myscheme.gov.in",
  "myscheme.gov.in",
  "api.myscheme.gov.in",
]);

const ALLOWED_OFFICIAL_SUFFIXES = [".gov.in", ".nic.in", ".org.in"];

const JOURNEY_SEARCH_CONFIG: Record<
  Exclude<JourneyType, "other">,
  {
    categoryLabel: string;
    apiQuery: string;
    searchPromptFocus: string;
    targetCount: number;
  }
> = {
  farmer: {
    categoryLabel: "Agriculture, Rural & Environment",
    apiQuery: "kisan farmer agriculture credit crop insurance",
    searchPromptFocus:
      "smallholder farmer income support, farm credit, and crop insurance schemes on myscheme.gov.in (for example PM-KISAN, Kisan Credit Card, Pradhan Mantri Fasal Bima Yojana)",
    targetCount: 3,
  },
  student: {
    categoryLabel: "Education & Learning",
    apiQuery: "scholarship student post matric merit education",
    searchPromptFocus:
      "central government student scholarship schemes on myscheme.gov.in (for example National Means-Cum-Merit Scholarship Scheme, Central Sector Scheme of Scholarships for College and University Students, Post Matric Scholarship)",
    targetCount: 3,
  },
  health: {
    categoryLabel: "Health & Wellness",
    apiQuery: "ayushman bharat health insurance hospital maternity",
    searchPromptFocus:
      "central government health coverage and maternal health schemes on myscheme.gov.in (for example Ayushman Bharat Pradhan Mantri Jan Arogya Yojana PM-JAY, Janani Suraksha Yojana)",
    targetCount: 2,
  },
  livelihood: {
    categoryLabel: "Business & Entrepreneurship",
    apiQuery: "vishwakarma mudra svanidhi artisan vendor loan livelihood",
    searchPromptFocus:
      "central government livelihood, artisan, street vendor, and micro-enterprise schemes on myscheme.gov.in (for example PM Vishwakarma, PM SVANidhi, Pradhan Mantri Mudra Yojana)",
    targetCount: 3,
  },
};

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface RobotsPolicy {
  disallowedPaths: string[];
  fetchedAt: string;
}

const journeyCache = new Map<Exclude<JourneyType, "other">, CacheEntry<SchemeFetchBundle>>();
const inFlightJourneyFetches = new Map<
  Exclude<JourneyType, "other">,
  Promise<SchemeFetchBundle>
>();
let robotsCache: CacheEntry<RobotsPolicy> | null = null;

// Outbound request rate limiter (minimum 350ms spacing across all outbound HTTP calls)
let lastOutboundFetchMs = 0;
let outboundQueue: Promise<void> = Promise.resolve();

function getCacheTtlMs(): number {
  const hours = Number(process.env.MYSCHEME_CACHE_TTL_HOURS);
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return safeHours * 60 * 60 * 1000;
}

function isPrivateOrBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower === "0.0.0.0" ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal")
  ) {
    return true;
  }
  // Block raw IPv4 / IPv6 literals including metadata IPs (169.254.169.254, 10.x, 172.16-31.x, 192.168.x)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower) || lower.includes(":")) {
    return true;
  }
  return false;
}

/**
 * Strict SSRF validator: only allows HTTPS URLs on myscheme.gov.in or verified Indian govt domains.
 */
export function validateOfficialUrl(rawUrl: string, requireMyScheme = false): URL | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:") return null;
    if (isPrivateOrBlockedHostname(parsed.hostname)) return null;
    const host = parsed.hostname.toLowerCase();
    if (requireMyScheme) {
      return ALLOWED_MYSCHEME_HOSTS.has(host) ? parsed : null;
    }
    if (
      ALLOWED_MYSCHEME_HOSTS.has(host) ||
      ALLOWED_OFFICIAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function rateLimitedFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = 7000,
): Promise<Response> {
  const parsed = validateOfficialUrl(url, false);
  if (!parsed) {
    throw new Error(`Blocked outbound fetch to non-allowlisted host: ${url}`);
  }

  let release!: () => void;
  const prev = outboundQueue;
  outboundQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;

  try {
    const now = Date.now();
    const waitMs = Math.max(0, 350 - (now - lastOutboundFetchMs));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastOutboundFetchMs = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(parsed.toString(), {
        ...init,
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json, text/html, text/plain;q=0.9",
          ...(init?.headers ?? {}),
        },
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } finally {
    release();
  }
}

async function getMySchemeRobotsPolicy(): Promise<RobotsPolicy> {
  const now = Date.now();
  if (robotsCache && robotsCache.expiresAt > now) {
    return robotsCache.value;
  }

  const disallowedPaths: string[] = [];
  try {
    const resp = await rateLimitedFetch("https://www.myscheme.gov.in/robots.txt", undefined, 4000);
    if (resp.ok) {
      const text = await resp.text();
      let inWildcardAgent = false;
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.split("#")[0]?.trim() ?? "";
        if (!line) continue;
        const lower = line.toLowerCase();
        if (lower.startsWith("user-agent:")) {
          const agent = line.slice("user-agent:".length).trim();
          inWildcardAgent = agent === "*";
        } else if (inWildcardAgent && lower.startsWith("disallow:")) {
          const path = line.slice("disallow:".length).trim();
          if (path) disallowedPaths.push(path);
        }
      }
    }
  } catch {
    disallowedPaths.push("/404");
  }

  const policy: RobotsPolicy = {
    disallowedPaths,
    fetchedAt: new Date().toISOString(),
  };
  robotsCache = {
    value: policy,
    expiresAt: now + getCacheTtlMs(),
  };
  return policy;
}

async function isAllowedByRobots(pathname: string): Promise<boolean> {
  const policy = await getMySchemeRobotsPolicy();
  return !policy.disallowedPaths.some((rule) => {
    if (rule === "/") return true;
    return pathname.startsWith(rule);
  });
}

function normalizeTextList(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === "string" && item.trim().length > 0) {
      out.push(item.trim());
    } else if (item && typeof item === "object") {
      const textVal = (item as { text?: string; children?: Array<{ text?: string }> }).text;
      if (typeof textVal === "string" && textVal.trim()) {
        out.push(textVal.trim());
      } else if (Array.isArray((item as { children?: unknown[] }).children)) {
        const joined = ((item as { children: Array<{ text?: string }> }).children)
          .map((c) => (typeof c?.text === "string" ? c.text : ""))
          .join("")
          .trim();
        if (joined) out.push(joined);
      }
    }
  }
  return Array.from(new Set(out));
}

function buildExtractedText(record: {
  schemeName: string;
  ministry: string;
  category: string;
  sourceUrl: string;
  officialApplicationUrl: string;
  eligibilityCriteria: string[];
  exclusions: string[];
  benefits: string[];
  requiredDocuments: string[];
  applicationChannel: string;
}): string {
  return [
    `Scheme: ${record.schemeName}`,
    `Ministry/Department: ${record.ministry}`,
    `Category: ${record.category}`,
    `Official myScheme Source: ${record.sourceUrl}`,
    `Official Application Channel: ${record.applicationChannel} (${record.officialApplicationUrl})`,
    `Eligibility Criteria:\n- ${record.eligibilityCriteria.join("\n- ") || "Not stated on source page"}`,
    `Exclusions:\n- ${record.exclusions.join("\n- ") || "None explicitly listed; verify on official portal"}`,
    `Benefits:\n- ${record.benefits.join("\n- ") || "See official page"}`,
    `Required Documents:\n- ${record.requiredDocuments.join("\n- ") || "Verify required documents on official page"}`,
  ].join("\n");
}

/**
 * Stage 1: Direct live API fetch from api.myscheme.gov.in (works in India regions).
 * Fast 3.5s timeout so non-India regions fall through immediately to Stage 2.
 */
async function tryDirectMySchemeApi(
  journey: Exclude<JourneyType, "other">,
): Promise<OfficialSchemeRecord[] | null> {
  const cfg = JOURNEY_SEARCH_CONFIG[journey];
  try {
    const searchUrl = `https://api.myscheme.gov.in/search/v4/schemes?lang=en&q=${encodeURIComponent(cfg.apiQuery)}&from=0&size=${cfg.targetCount}`;
    const searchResp = await rateLimitedFetch(searchUrl, undefined, 3500);
    if (!searchResp.ok) {
      return null;
    }
    const searchJson = (await searchResp.json()) as {
      data?: { hits?: { items?: Array<{ fields?: { slug?: string } }> } };
    };
    const slugs = (searchJson?.data?.hits?.items ?? [])
      .map((item) => item.fields?.slug)
      .filter((s): s is string => typeof s === "string" && /^[a-z0-9-]+$/i.test(s))
      .slice(0, cfg.targetCount);

    if (slugs.length === 0) return null;

    const fetchedAt = new Date().toISOString();
    const records: OfficialSchemeRecord[] = [];
    for (const slug of slugs) {
      const detailUrl = `https://api.myscheme.gov.in/schemes/v5/public/schemes?slug=${encodeURIComponent(slug)}&lang=en`;
      const detailResp = await rateLimitedFetch(detailUrl, undefined, 4500);
      if (!detailResp.ok) continue;
      const detailJson = (await detailResp.json()) as {
        data?: {
          en?: {
            basicDetails?: {
              schemeName?: string;
              nodalMinistryName?: { label?: string };
              schemeCategory?: Array<{ label?: string }>;
            };
            eligibilityCriteria?: { eligibilityDescription?: unknown[] };
            exclusions?: { exclusionDescription?: unknown[] };
            schemeContent?: {
              benefits?: unknown[];
              references?: Array<{ url?: string; title?: string }>;
            };
            applicationProcess?: Array<{ mode?: string; process?: unknown[] }>;
            documents?: { documents_required?: unknown[] };
          };
        };
      };
      const en = detailJson?.data?.en;
      const schemeName = en?.basicDetails?.schemeName?.trim();
      if (!schemeName) continue;

      const sourceUrl = `https://www.myscheme.gov.in/schemes/${slug}`;
      const refUrl = en?.schemeContent?.references?.find((r) =>
        validateOfficialUrl(r.url ?? "", false),
      )?.url;
      const officialApplicationUrl = refUrl ?? sourceUrl;

      const eligibilityCriteria = normalizeTextList(
        en?.eligibilityCriteria?.eligibilityDescription,
      );
      if (eligibilityCriteria.length === 0) continue;

      const exclusions = normalizeTextList(en?.exclusions?.exclusionDescription);
      const benefits = normalizeTextList(en?.schemeContent?.benefits);
      const requiredDocuments = normalizeTextList(en?.documents?.documents_required);
      const ministry =
        en?.basicDetails?.nodalMinistryName?.label?.trim() || "Government of India";
      const category =
        en?.basicDetails?.schemeCategory?.[0]?.label?.trim() || cfg.categoryLabel;
      const applicationChannel =
        en?.applicationProcess?.[0]?.mode
          ? `${en.applicationProcess[0].mode} via official portal / CSC`
          : "Official myScheme portal / Common Service Centre (CSC)";

      records.push({
        slug,
        schemeName,
        ministry,
        category,
        journey,
        sourceUrl,
        officialApplicationUrl,
        eligibilityCriteria,
        exclusions,
        benefits,
        requiredDocuments,
        applicationChannel,
        extractedText: buildExtractedText({
          schemeName,
          ministry,
          category,
          sourceUrl,
          officialApplicationUrl,
          eligibilityCriteria,
          exclusions,
          benefits,
          requiredDocuments,
          applicationChannel,
        }),
        fetchedAt,
        urlVerified: true,
        fetchMethod: "myscheme-api",
      });
    }

    return records.length > 0 ? records : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a candidate myscheme.gov.in scheme URL resolves live over HTTPS,
 * respects robots.txt, and attempts HTML text extraction via cheerio when present.
 */
async function verifyMySchemePageLive(sourceUrl: string): Promise<{
  verified: boolean;
  htmlSnippet: string;
}> {
  const parsed = validateOfficialUrl(sourceUrl, true);
  if (!parsed || !parsed.pathname.startsWith("/schemes/")) {
    return { verified: false, htmlSnippet: "" };
  }
  const allowed = await isAllowedByRobots(parsed.pathname);
  if (!allowed) {
    return { verified: false, htmlSnippet: "" };
  }
  try {
    const resp = await rateLimitedFetch(parsed.toString(), { method: "GET" }, 5000);
    if (!resp.ok) {
      return { verified: false, htmlSnippet: "" };
    }
    const html = await resp.text();
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();
    const bodyText = $("main").text().replace(/\s+/g, " ").trim();
    return {
      verified: true,
      htmlSnippet: bodyText.slice(0, 1500),
    };
  } catch {
    return { verified: false, htmlSnippet: "" };
  }
}

const DISCOVERED_SCHEMES_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    schemes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          slug: {
            type: Type.STRING,
            description:
              "Exact URL slug from https://www.myscheme.gov.in/schemes/<slug> observed in live search results.",
          },
          schemeName: { type: Type.STRING },
          ministry: { type: Type.STRING },
          category: { type: Type.STRING },
          sourceUrl: {
            type: Type.STRING,
            description: "Exact https://www.myscheme.gov.in/schemes/<slug> URL observed in live search results.",
          },
          officialApplicationUrl: {
            type: Type.STRING,
            description: "Official .gov.in / .nic.in / .org.in portal URL or the myScheme URL.",
          },
          eligibilityCriteria: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          exclusions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          benefits: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          requiredDocuments: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          applicationChannel: { type: Type.STRING },
        },
        required: [
          "slug",
          "schemeName",
          "ministry",
          "category",
          "sourceUrl",
          "officialApplicationUrl",
          "eligibilityCriteria",
          "exclusions",
          "benefits",
          "requiredDocuments",
          "applicationChannel",
        ],
      },
    },
  },
  required: ["schemes"],
};

function extractGroundedMySchemeSlugs(interaction: unknown): string[] {
  const text = JSON.stringify(interaction ?? {});
  const matches = text.match(/https?:\/\/(?:www\.)?myscheme\.gov\.in\/schemes\/([a-z0-9-]+)/gi) ?? [];
  const slugs = matches
    .map((m) => m.replace(/^https?:\/\/(?:www\.)?myscheme\.gov\.in\/schemes\//i, "").toLowerCase())
    .filter((s) => /^[a-z0-9-]+$/.test(s));
  return Array.from(new Set(slugs));
}

/**
 * Stage 2: Live grounded discovery from myscheme.gov.in via Gemini Interactions
 * `google_search` tool (when api.myscheme.gov.in is geo-fenced outside India),
 * followed by strict live HTTP resolution verification + robots.txt check.
 * Never fabricates slugs or falls back to pre-written scheme data.
 */
async function discoverMySchemeViaLiveGroundedSearch(
  journey: Exclude<JourneyType, "other">,
  sessionId: string,
): Promise<OfficialSchemeRecord[]> {
  assertBudgetAvailable(sessionId);

  const cfg = JOURNEY_SEARCH_CONFIG[journey];
  const ai = getInteractionsClient();

  const discoveryPrompt = [
    `Search site:myscheme.gov.in/schemes for ${cfg.targetCount} active central Indian government schemes in "${cfg.categoryLabel}", specifically ${cfg.searchPromptFocus}.`,
    `For EACH scheme found on myscheme.gov.in:`,
    `1. Give the exact URL https://www.myscheme.gov.in/schemes/<slug> and its <slug> from the search results.`,
    `2. Give concise official eligibility criteria (3-5 bullets), exclusions (e.g. income tax payer, govt employee/pensioner if applicable), key benefits (2-3 bullets), required documents (3-6 items), and official application channel.`,
    `Keep each bullet short (under 20 words). Do not invent criteria or URLs not supported by the live search results.`,
  ].join("\n");

  let rawText = "";
  let groundedSlugs: string[] = [];

  try {
    // Primary fast call: live google_search + structured response_format with low thinking
    const interaction = await withTransientRetry(() =>
      ai.interactions.create({
        model: MODELS.HYDROGEN,
        input: discoveryPrompt,
        system_instruction:
          "You are a concise official-source extractor for myscheme.gov.in. Use live Google Search on site:myscheme.gov.in/schemes to locate real scheme pages and return compact structured JSON with exact myscheme.gov.in/schemes/<slug> URLs, official eligibility criteria, exclusions, benefits, and required documents.",
        tools: [{ type: "google_search" }],
        response_format: DISCOVERED_SCHEMES_SCHEMA,
        generation_config: {
          thinking_level: "low",
          max_output_tokens: 5500,
        },
      }),
    );

    const tokens = extractInteractionTokens(interaction);
    recordModelUsage({
      sessionId,
      model: MODELS.HYDROGEN,
      callType: `myscheme_live_discovery_${journey}`,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
    });
    groundedSlugs = extractGroundedMySchemeSlugs(interaction);
    rawText = extractInteractionOutputText(interaction);
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "myscheme_discovery_two_step_retry",
        journey,
        reason: err instanceof Error ? err.message.slice(0, 140) : "unknown",
      }),
    );
    const searchInteraction = await withTransientRetry(() =>
      ai.interactions.create({
        model: MODELS.HYDROGEN,
        input: discoveryPrompt,
        system_instruction:
          "Use Google Search strictly on site:myscheme.gov.in/schemes to list real Indian government schemes, their exact myscheme.gov.in/schemes/<slug> URLs, official eligibility criteria, exclusions, benefits, required documents, and official application channels.",
        tools: [{ type: "google_search" }],
        generation_config: {
          thinking_level: "low",
          max_output_tokens: 4500,
        },
      }),
    );
    const t1 = extractInteractionTokens(searchInteraction);
    recordModelUsage({
      sessionId,
      model: MODELS.HYDROGEN,
      callType: `myscheme_live_search_${journey}`,
      inputTokens: t1.inputTokens,
      outputTokens: t1.outputTokens,
    });
    groundedSlugs = extractGroundedMySchemeSlugs(searchInteraction);
    const searchSummary = extractInteractionOutputText(searchInteraction);
    if (!searchSummary) return [];

    const structInteraction = await withTransientRetry(() =>
      ai.interactions.create({
        model: MODELS.HYDROGEN,
        input: `Extract ONLY the verified myscheme.gov.in schemes from these live search notes (grounded slugs observed: ${groundedSlugs.join(", ") || "none"}):\n\n${searchSummary}`,
        response_format: DISCOVERED_SCHEMES_SCHEMA,
        generation_config: {
          thinking_level: "low",
          max_output_tokens: 5000,
        },
      }),
    );
    const t2 = extractInteractionTokens(structInteraction);
    recordModelUsage({
      sessionId,
      model: MODELS.HYDROGEN,
      callType: `myscheme_live_structure_${journey}`,
      inputTokens: t2.inputTokens,
      outputTokens: t2.outputTokens,
    });
    rawText = extractInteractionOutputText(structInteraction);
  }

  if (!rawText) {
    console.warn(JSON.stringify({ event: "myscheme_empty_raw_text", journey }));
    return [];
  }

  let parsed: { schemes?: Array<Record<string, unknown>> } = {};
  try {
    parsed = JSON.parse(rawText) as { schemes?: Array<Record<string, unknown>> };
  } catch {
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]) as { schemes?: Array<Record<string, unknown>> };
      } catch {
        console.warn(
          JSON.stringify({
            event: "myscheme_json_parse_failed",
            journey,
            length: rawText.length,
          }),
        );
        return [];
      }
    }
  }

  const candidates = Array.isArray(parsed.schemes) ? parsed.schemes : [];
  const fetchedAt = new Date().toISOString();
  const verifiedRecords: OfficialSchemeRecord[] = [];

  for (const item of candidates.slice(0, cfg.targetCount + 1)) {
    const rawSourceUrl = typeof item.sourceUrl === "string" ? item.sourceUrl.trim() : "";
    const rawSlug = typeof item.slug === "string" ? item.slug.trim().toLowerCase() : "";

    let canonicalUrl = "";
    let canonicalSlug = "";
    const parsedSource = validateOfficialUrl(rawSourceUrl, true);
    if (parsedSource && parsedSource.pathname.startsWith("/schemes/")) {
      const slugFromUrl = parsedSource.pathname
        .replace(/^\/schemes\//, "")
        .replace(/\/.*$/, "")
        .trim()
        .toLowerCase();
      if (/^[a-z0-9-]+$/.test(slugFromUrl)) {
        canonicalSlug = slugFromUrl;
        canonicalUrl = `https://www.myscheme.gov.in/schemes/${slugFromUrl}`;
      }
    } else if (/^[a-z0-9-]+$/.test(rawSlug) && rawSlug.length >= 2) {
      canonicalSlug = rawSlug;
      canonicalUrl = `https://www.myscheme.gov.in/schemes/${rawSlug}`;
    }

    if (!canonicalUrl || !canonicalSlug) continue;
    if (verifiedRecords.some((r) => r.slug === canonicalSlug)) continue;

    const liveCheck = await verifyMySchemePageLive(canonicalUrl);
    if (!liveCheck.verified) continue;

    const schemeName = typeof item.schemeName === "string" ? item.schemeName.trim() : "";
    const eligibilityCriteria = normalizeTextList(item.eligibilityCriteria);
    if (!schemeName || eligibilityCriteria.length === 0) continue;

    const ministry =
      typeof item.ministry === "string" && item.ministry.trim()
        ? item.ministry.trim()
        : "Government of India";
    const category =
      typeof item.category === "string" && item.category.trim()
        ? item.category.trim()
        : cfg.categoryLabel;
    const rawAppUrl =
      typeof item.officialApplicationUrl === "string" ? item.officialApplicationUrl.trim() : "";
    const validAppUrl = validateOfficialUrl(rawAppUrl, false)?.toString() ?? canonicalUrl;
    const exclusions = normalizeTextList(item.exclusions);
    const benefits = normalizeTextList(item.benefits);
    const requiredDocuments = normalizeTextList(item.requiredDocuments);
    const applicationChannel =
      typeof item.applicationChannel === "string" && item.applicationChannel.trim()
        ? item.applicationChannel.trim()
        : "Official myScheme portal / Common Service Centre (CSC)";

    verifiedRecords.push({
      slug: canonicalSlug,
      schemeName,
      ministry,
      category,
      journey,
      sourceUrl: canonicalUrl,
      officialApplicationUrl: validAppUrl,
      eligibilityCriteria,
      exclusions,
      benefits,
      requiredDocuments,
      applicationChannel,
      extractedText: buildExtractedText({
        schemeName,
        ministry,
        category,
        sourceUrl: canonicalUrl,
        officialApplicationUrl: validAppUrl,
        eligibilityCriteria,
        exclusions,
        benefits,
        requiredDocuments,
        applicationChannel,
      }),
      fetchedAt,
      urlVerified: true,
      fetchMethod:
        liveCheck.htmlSnippet.length > 200
          ? "myscheme-html"
          : "myscheme-live-search-verified",
    });

    if (verifiedRecords.length >= cfg.targetCount) break;
  }

  console.log(
    JSON.stringify({
      event: "myscheme_live_discovery_summary",
      journey,
      candidatesCount: candidates.length,
      groundedSlugsCount: groundedSlugs.length,
      verifiedCount: verifiedRecords.length,
    }),
  );

  return verifiedRecords;
}

/**
 * Fetches official scheme criteria live from myScheme for a citizen journey.
 * Cached in server memory for 24 hours. Never invents or mocks data on failure.
 */
export async function fetchSchemesForJourney(
  journey: Exclude<JourneyType, "other">,
  sessionId: string,
  forceRefresh = false,
): Promise<SchemeFetchBundle> {
  const now = Date.now();
  if (!forceRefresh) {
    const cached = journeyCache.get(journey);
    if (cached && cached.expiresAt > now) {
      return {
        ...cached.value,
        fromCache: true,
      };
    }
  }

  const existingInFlight = inFlightJourneyFetches.get(journey);
  if (existingInFlight && !forceRefresh) {
    return existingInFlight;
  }

  const promise = (async (): Promise<SchemeFetchBundle> => {
    const fetchedAt = new Date().toISOString();
    try {
      // Ensure robots.txt is fetched and respected first
      await getMySchemeRobotsPolicy();

      // Stage 1: Direct api.myscheme.gov.in JSON fetch (works in India Cloud Run regions)
      let schemes = await tryDirectMySchemeApi(journey);

      // Stage 2: Live grounded search on site:myscheme.gov.in + live URL verification
      if (!schemes || schemes.length === 0) {
        schemes = await discoverMySchemeViaLiveGroundedSearch(journey, sessionId);
      }

      if (!schemes || schemes.length === 0) {
        return {
          journey,
          schemes: [],
          fetchedAt,
          fromCache: false,
          unavailableReason:
            "Live criteria could not be retrieved from myscheme.gov.in right now. Please check https://www.myscheme.gov.in directly or visit your nearest Common Service Centre (CSC).",
        };
      }

      const bundle: SchemeFetchBundle = {
        journey,
        schemes,
        fetchedAt,
        fromCache: false,
      };
      journeyCache.set(journey, {
        value: bundle,
        expiresAt: Date.now() + getCacheTtlMs(),
      });
      return bundle;
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "myscheme_fetch_error",
          journey,
          reason: err instanceof Error ? err.message.slice(0, 140) : "unknown",
        }),
      );
      return {
        journey,
        schemes: [],
        fetchedAt,
        fromCache: false,
        unavailableReason:
          "Live fetch from myscheme.gov.in failed. Scheme Saathi will not guess eligibility criteria—please verify directly on https://www.myscheme.gov.in.",
      };
    } finally {
      inFlightJourneyFetches.delete(journey);
    }
  })();

  inFlightJourneyFetches.set(journey, promise);
  return promise;
}

export function getMySchemeCacheSummary(): Array<{
  journey: Exclude<JourneyType, "other">;
  schemeCount: number;
  fetchedAt: string;
  schemes: Array<{ slug: string; schemeName: string; sourceUrl: string; fetchMethod: string }>;
}> {
  const now = Date.now();
  const out: Array<{
    journey: Exclude<JourneyType, "other">;
    schemeCount: number;
    fetchedAt: string;
    schemes: Array<{ slug: string; schemeName: string; sourceUrl: string; fetchMethod: string }>;
  }> = [];

  for (const [journey, entry] of journeyCache.entries()) {
    if (entry.expiresAt > now) {
      out.push({
        journey,
        schemeCount: entry.value.schemes.length,
        fetchedAt: entry.value.fetchedAt,
        schemes: entry.value.schemes.map((s) => ({
          slug: s.slug,
          schemeName: s.schemeName,
          sourceUrl: s.sourceUrl,
          fetchMethod: s.fetchMethod,
        })),
      });
    }
  }
  return out;
}
