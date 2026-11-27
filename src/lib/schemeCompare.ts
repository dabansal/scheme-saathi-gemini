import type {
  ConfidenceLabel,
  DocumentChecklistItem,
  SchemeMatch,
} from "../../shared/models.ts";

export interface SchemeReadinessRow {
  match: SchemeMatch;
  matchedDocuments: DocumentChecklistItem[];
  readyDocCount: number;
  totalDocCount: number;
  missingDocs: string[];
  readinessPercent: number;
}

export interface SharedDocumentSummary {
  id: string;
  label: string;
  isReady: boolean;
  schemeCount: number;
}

export type StackingStatus = "verify_stacking" | "complementary_check";

export interface StackingFlag {
  kind: "same_category" | "exclusion_keyword" | "shared_docs";
  detail: string;
}

export interface StackingAssessment {
  status: StackingStatus;
  sameCategoryNames: string[];
  exclusionMentions: string[];
  flags: StackingFlag[];
}

export interface SchemeComparisonResult {
  rows: SchemeReadinessRow[];
  sharedDocuments: SharedDocumentSummary[];
  recommendedFirstSlug: string | null;
  stacking: StackingAssessment;
}

const CONFIDENCE_RANK: Record<ConfidenceLabel, number> = {
  High: 3,
  Medium: 2,
  Low: 1,
};

const EXCLUSION_PATTERN =
  /\b(already receiving|other scheme|another scheme|duplicate|exclusion|excluded|one scholarship|single scholarship|cannot combine|not availing|mutually exclusive|same benefit|income tax payer|pensioner|nsp)\b|अन्य योजना|दूसरी योजना|दोहरा लाभ|छात्रवृत्ति/i;

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u0900-\u0d7f]+/g, " ").trim();
}

export type SchemeCardStatus = "eligible" | "potentially_eligible" | "missing_docs";

export function getSchemeCardStatus(params: {
  match: SchemeMatch;
  documents: DocumentChecklistItem[];
  manualReadyDocIds: string[];
}): SchemeCardStatus {
  const { match, documents, manualReadyDocIds } = params;
  const manualSet = new Set(manualReadyDocIds);
  const linkedDocs = documents.filter((doc) => docMatchesScheme(doc, match));

  const isDocReady = (doc: DocumentChecklistItem): boolean =>
    doc.status === "ready" || manualSet.has(doc.id);

  const hasMissingLinkedDoc = linkedDocs.some(
    (doc) => !isDocReady(doc) && doc.status === "missing",
  );
  const hasUnverifiedLinkedDoc = linkedDocs.some(
    (doc) => !isDocReady(doc) && doc.status === "needs_verification",
  );

  if (
    hasMissingLinkedDoc ||
    (linkedDocs.length === 0 && match.whatIsMissing.length > 0)
  ) {
    return "missing_docs";
  }

  if (match.confidence === "High" && !hasUnverifiedLinkedDoc) {
    return "eligible";
  }

  return "potentially_eligible";
}

function docMatchesScheme(doc: DocumentChecklistItem, match: SchemeMatch): boolean {
  if (doc.requiredForSchemes.length === 0) return false;
  const targetName = normalizeText(match.schemeName);
  const targetSlug = normalizeText(match.slug);

  return doc.requiredForSchemes.some((reqName) => {
    const normReq = normalizeText(reqName);
    if (!normReq) return false;
    return (
      normReq === targetName ||
      targetName.includes(normReq) ||
      normReq.includes(targetName) ||
      (targetSlug.length >= 4 && normReq.includes(targetSlug))
    );
  });
}

/**
 * Pure deterministic comparison & stacking check strictly grounded in live myScheme
 * SchemeMatch and DocumentChecklistItem records. Never fabricates benefits or rules.
 */
export function compareSelectedSchemes(params: {
  matches: SchemeMatch[];
  documents: DocumentChecklistItem[];
  manualReadyDocIds: string[];
}): SchemeComparisonResult {
  const { matches, documents, manualReadyDocIds } = params;
  const manualSet = new Set(manualReadyDocIds);

  const isDocReady = (doc: DocumentChecklistItem): boolean =>
    doc.status === "ready" || manualSet.has(doc.id);

  // Build per-scheme readiness rows
  const rows: SchemeReadinessRow[] = matches.map((match) => {
    const matchedDocs = documents.filter((doc) => docMatchesScheme(doc, match));
    const readyDocCount = matchedDocs.filter(isDocReady).length;
    const totalDocCount = matchedDocs.length;

    const missingFromChecklist = matchedDocs
      .filter((doc) => !isDocReady(doc))
      .map((doc) => doc.label);

    // Combine checklist missing items with live match.whatIsMissing without duplicates
    const seenMissing = new Set(missingFromChecklist.map(normalizeText));
    const combinedMissing = [...missingFromChecklist];
    for (const item of match.whatIsMissing) {
      const norm = normalizeText(item);
      if (norm && !seenMissing.has(norm)) {
        seenMissing.add(norm);
        combinedMissing.push(item);
      }
    }

    const readinessPercent =
      totalDocCount > 0
        ? Math.round((readyDocCount / totalDocCount) * 100)
        : combinedMissing.length === 0
          ? 100
          : 0;

    return {
      match,
      matchedDocuments: matchedDocs,
      readyDocCount,
      totalDocCount,
      missingDocs: combinedMissing,
      readinessPercent,
    };
  });

  // Identify documents shared across 2+ compared schemes
  const docSchemeCounts = new Map<
    string,
    { doc: DocumentChecklistItem; count: number }
  >();
  for (const row of rows) {
    for (const doc of row.matchedDocuments) {
      const existing = docSchemeCounts.get(doc.id);
      if (existing) {
        existing.count += 1;
      } else {
        docSchemeCounts.set(doc.id, { doc, count: 1 });
      }
    }
  }

  const sharedDocuments: SharedDocumentSummary[] = Array.from(
    docSchemeCounts.values(),
  )
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => b.count - a.count || a.doc.label.localeCompare(b.doc.label))
    .map((entry) => ({
      id: entry.doc.id,
      label: entry.doc.label,
      isReady: isDocReady(entry.doc),
      schemeCount: entry.count,
    }));

  // Determine recommended first scheme (highest confidence -> probability -> fewest missing docs)
  const rankedRows = [...rows].sort((a, b) => {
    const confDiff =
      CONFIDENCE_RANK[b.match.confidence] - CONFIDENCE_RANK[a.match.confidence];
    if (confDiff !== 0) return confDiff;
    const probDiff = b.match.decisionProbability - a.match.decisionProbability;
    if (Math.abs(probDiff) > 0.01) return probDiff;
    const missingDiff = a.missingDocs.length - b.missingDocs.length;
    if (missingDiff !== 0) return missingDiff;
    return b.readinessPercent - a.readinessPercent;
  });

  const recommendedFirstSlug = rankedRows[0]?.match.slug ?? null;

  // Grounded stacking & mutual-exclusion check
  const categoryBuckets = new Map<string, string[]>();
  for (const match of matches) {
    const catKey = normalizeText(match.category || "");
    if (!catKey) continue;
    const bucket = categoryBuckets.get(catKey) ?? [];
    bucket.push(match.category);
    categoryBuckets.set(catKey, bucket);
  }

  const sameCategoryNames = Array.from(categoryBuckets.values())
    .filter((items) => items.length >= 2)
    .map((items) => items[0]!);

  const exclusionMentions: string[] = [];
  for (const match of matches) {
    const candidateLines = [
      ...match.whatToVerify,
      ...match.whatIsMissing,
      match.whyItMayFit,
    ];
    for (const line of candidateLines) {
      if (EXCLUSION_PATTERN.test(line)) {
        const snippet = `${match.schemeName}: ${line.trim()}`;
        if (!exclusionMentions.includes(snippet)) {
          exclusionMentions.push(snippet);
        }
      }
    }
  }

  const flags: StackingFlag[] = [];
  if (sameCategoryNames.length > 0) {
    flags.push({
      kind: "same_category",
      detail: sameCategoryNames.join(", "),
    });
  }
  if (exclusionMentions.length > 0) {
    flags.push({
      kind: "exclusion_keyword",
      detail: exclusionMentions[0]!,
    });
  }
  if (sharedDocuments.length > 0) {
    flags.push({
      kind: "shared_docs",
      detail: sharedDocuments.map((d) => d.label).join(", "),
    });
  }

  const status: StackingStatus =
    sameCategoryNames.length > 0 || exclusionMentions.length > 0
      ? "verify_stacking"
      : "complementary_check";

  return {
    rows,
    sharedDocuments,
    recommendedFirstSlug,
    stacking: {
      status,
      sameCategoryNames,
      exclusionMentions,
      flags,
    },
  };
}
