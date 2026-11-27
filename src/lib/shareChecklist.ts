import type {
  CitizenLocation,
  Language,
  PlanState,
} from "../../shared/models.ts";

function isSafeHttpsUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Strips any accidental 12-digit Aadhaar or long account numbers before sharing.
 */
function stripSensitiveNumbers(text: string): string {
  return text
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "XXXX-XXXX-XXXX")
    .replace(/\b\d{9,18}\b/g, "XXXX-XXXX");
}

function truncateLine(text: string, maxLen: number): string {
  const clean = stripSensitiveNumbers(text).replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Formats a concise, privacy-safe plain-text summary of the citizen's eligibility
 * and chosen schemes for clipboard copy, WhatsApp, SMS, or other messaging apps.
 * Never includes uploaded document identifiers or unmasked numbers.
 */
export function buildShareableChecklistText(params: {
  plan: PlanState;
  language: Language;
  location?: CitizenLocation;
  manualReadyDocIds: string[];
  selectedSchemeSlugs?: string[];
}): string {
  const {
    plan,
    language,
    location,
    manualReadyDocIds,
    selectedSchemeSlugs,
  } = params;
  const isHi = language === "hi";
  const manualSet = new Set(manualReadyDocIds);
  const lines: string[] = [];

  lines.push(
    isHi
      ? "स्कीम साथी — पात्रता और योजना सारांश"
      : "Scheme Saathi — Eligibility & Scheme Summary",
  );

  const loc = location ?? plan.location;
  if (loc?.stateName) {
    lines.push(
      `${isHi ? "स्थान" : "Location"}: ${loc.district ? `${loc.district}, ` : ""}${loc.stateName}`,
    );
  }

  lines.push(
    isHi
      ? "नोट: संभावित मिलान, आधिकारिक सत्यापन आवश्यक है।"
      : "Note: Potential match, official verification required.",
  );
  lines.push("");

  if (plan.knownFacts.length > 0) {
    lines.push(isHi ? "पात्रता विवरण:" : "Eligibility Summary:");
    plan.knownFacts.slice(0, 5).forEach((fact) => {
      lines.push(`• ${truncateLine(fact, 120)}`);
    });
    lines.push("");
  }

  const chosenSlugs =
    selectedSchemeSlugs && selectedSchemeSlugs.length > 0
      ? new Set(selectedSchemeSlugs)
      : null;
  const chosenMatches = chosenSlugs
    ? plan.matches.filter((m) => chosenSlugs.has(m.slug))
    : plan.matches;

  if (chosenMatches.length > 0) {
    lines.push(isHi ? "चुनी गई संभावित योजनाएं:" : "Chosen Potential Schemes:");
    chosenMatches.forEach((m, idx) => {
      const confLabel = isHi
        ? m.confidence === "High"
          ? "उच्च विश्वास"
          : m.confidence === "Medium"
            ? "मध्यम विश्वास"
            : "कम विश्वास"
        : `${m.confidence} confidence`;
      lines.push(`${idx + 1}. ${m.schemeName} (${confLabel})`);
      if (m.whyItMayFit) {
        lines.push(
          `   ${isHi ? "पात्रता आधार" : "Why it may fit"}: ${truncateLine(m.whyItMayFit, 140)}`,
        );
      }
      lines.push(
        `   ${isHi ? "अगला कदम" : "Next step"}: ${truncateLine(m.nextOfficialAction, 140)}`,
      );
      if (isSafeHttpsUrl(m.officialChannelUrl)) {
        lines.push(
          `   ${isHi ? "आधिकारिक लिंक" : "Official link"}: ${m.officialChannelUrl}`,
        );
      } else if (isSafeHttpsUrl(m.sourceUrl)) {
        lines.push(`   myScheme: ${m.sourceUrl}`);
      }
    });
    lines.push("");
  }

  if (plan.documents.length > 0) {
    const chosenSchemeNames = new Set(
      chosenMatches.map((m) => m.schemeName.toLowerCase()),
    );
    const relevantDocs =
      chosenMatches.length > 0 && chosenMatches.length < plan.matches.length
        ? plan.documents.filter(
            (d) =>
              d.requiredForSchemes.length === 0 ||
              d.requiredForSchemes.some((name) =>
                chosenSchemeNames.has(name.toLowerCase()),
              ),
          )
        : plan.documents;

    if (relevantDocs.length > 0) {
      const readyDocs = relevantDocs.filter(
        (d) => d.status === "ready" || manualSet.has(d.id),
      );
      const pendingDocs = relevantDocs.filter(
        (d) => d.status !== "ready" && !manualSet.has(d.id),
      );

      lines.push(isHi ? "दस्तावेज़ स्थिति:" : "Document Readiness:");
      readyDocs.forEach((d) => {
        lines.push(`[✓ ${isHi ? "तैयार" : "Ready"}] ${d.label}`);
      });
      pendingDocs.forEach((d) => {
        lines.push(`[ ] ${isHi ? "ज़रूरी / जांचें" : "Missing / Verify"}: ${d.label}`);
      });
      lines.push("");
    }
  }

  if (plan.nextStepSummary) {
    lines.push(
      `${isHi ? "मुख्य अगला कदम" : "Main Next Step"}: ${truncateLine(plan.nextStepSummary, 180)}`,
    );
  }

  const topChannel = plan.handoffChannels[0];
  if (topChannel) {
    lines.push(
      `${isHi ? "सहायता" : "Help"}: ${topChannel.title} — ${topChannel.contactOrUrl}`,
    );
  }

  return lines.join("\n").trim();
}

export function buildWhatsAppShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function buildSmsShareUrl(text: string): string {
  return `sms:?body=${encodeURIComponent(text)}`;
}

/**
 * Copies text to clipboard using the Clipboard API with a DOM execCommand fallback
 * so copying succeeds reliably inside iframe sandboxes as well as standalone tabs.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to textarea fallback (common in restricted iframes)
    }
  }

  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
