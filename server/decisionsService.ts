import {
  CONFIDENCE_THRESHOLDS,
  MODELS,
} from "../shared/models.ts";
import type {
  ConfidenceLabel,
  DocumentTypeKey,
  JourneyType,
  OfficialSchemeRecord,
} from "../shared/models.ts";
import { assertBudgetAvailable, recordModelUsage } from "./costGuard.ts";
import {
  extractDecisionTokens,
  getDecisionsClient,
  withTransientRetry,
} from "./geminiClient.ts";

export interface TurnGateDecision {
  isCitizenServicesQuery: boolean;
  isCitizenServicesProb: number;
  isCitizenServicesConfidence: number;
  journey: JourneyType;
  journeyConfidence: number;
  journeyProbabilities: Record<string, number>;
  profileCompletenessScore: number; // 0 to 3
  profileCompletenessConfidence: number;
  hasConflictOrAmbiguity: boolean;
  conflictProb: number;
  conflictConfidence: number;
  lowConfidenceDetected: boolean;
  shouldEscalateToNeon: boolean;
  needsClarification: boolean;
}

export interface DocumentGateDecision {
  matchesClaimedType: boolean;
  matchProbability: number;
  matchConfidence: number;
  isLegible: boolean;
  legibleProbability: number;
  legibleConfidence: number;
  lowConfidenceDetected: boolean;
}

export interface SchemeDecisionScore {
  slug: string;
  probability: number;
  confidence: number;
  label: ConfidenceLabel;
  lowConfidence: boolean;
}

const COMPLETENESS_RUBRIC = [
  "Minimal: only a greeting or vague mention; missing state, occupation or need, and key eligibility facts.",
  "Partial: identifies general need or occupation, but still missing two or more decisive eligibility facts like state, land or income, category, or document status.",
  "Mostly complete: includes journey, state, and main economic or demographic details, with at most one small follow-up fact missing.",
  "Complete: includes journey, state, core eligibility facts (such as landholding, income, education level, or family details), and document availability.",
];

const JOURNEY_CRITERIA: Record<JourneyType, string> = {
  farmer:
    "Agriculture, farming, kisan, landholding, crop insurance, Kisan Credit Card, PM-KISAN, seeds, irrigation, or animal husbandry.",
  health:
    "Medical treatment, hospital insurance, Ayushman Bharat PM-JAY, maternity benefits, medicines, disability, or family healthcare support.",
  livelihood:
    "Small business, street vendor, artisan, Vishwakarma, Mudra loan, skill training, self-employment, MSME, or daily-wage livelihood support.",
  other:
    "Anything outside farmer, student, health, and livelihood, or too vague to classify reliably.",
  student:
    "School or college student, scholarship, fellowship, tuition support, hostel, National Scholarship Portal, or education loan.",
};

const DOCUMENT_TYPE_DESCRIPTIONS: Record<DocumentTypeKey, string> = {
  aadhaar: "Indian Aadhaar card (UIDAI identity card with 12-digit number, photo, name, DOB/year, or masked Aadhaar).",
  land_record: "Indian agricultural land record such as Khatauni, Khasra, 7/12 extract (Satbara), RoR, Patta, or Bhu-Abhilekh.",
  bank_passbook: "Bank account passbook first page, cancelled cheque, or bank statement showing account holder, bank name, and IFSC.",
  income_certificate: "Official Indian state/tehsildar Income Certificate (Aay Praman Patra) stating annual family income.",
  caste_certificate: "Official Indian Caste / Category Certificate (SC, ST, OBC, EWS).",
  ration_card: "Indian Ration Card / NFSA food security card (BPL, Antyodaya/AAY, Priority Household).",
  student_id_marksheet: "School or college ID card, bonafide certificate, or academic marksheet.",
  artisan_business_proof: "Artisan ID, Udyam/MSME registration, street vendor certificate (Vending ID), or trade certificate.",
  other: "Any other supporting government identity or eligibility document.",
};

/**
 * Evaluates a citizen turn in ONE batched Decisions API call (zero output tokens).
 * Uses verified Decisions API types: "noul" (yes/no), "choice", and "score".
 * Always checks confidence < 0.75 in code to decide escalation or clarification.
 */
export async function evaluateCitizenTurn(params: {
  sessionId: string;
  latestMessage: string;
  knownFacts: string[];
  currentJourney: JourneyType;
  turnNumber: number;
}): Promise<TurnGateDecision> {
  assertBudgetAvailable(params.sessionId);

  const decisionsAi = getDecisionsClient();
  const payload = {
    current_journey: params.currentJourney,
    turn_number: params.turnNumber,
    known_citizen_facts: params.knownFacts,
    latest_citizen_message: params.latestMessage,
  };

  const response = await withTransientRetry(() =>
    decisionsAi.decisions.create({
      model: MODELS.DECISION,
      input: [
        {
          type: "text",
          text:
            "Citizen-services conversation state (India government schemes readiness assistant):\n" +
            JSON.stringify(payload),
        },
      ],
      questions: {
        is_citizen_services_query: {
          type: "noul",
          instructions:
            "Is the citizen asking about Indian government welfare schemes, eligibility, subsidies, scholarships, healthcare cover, livelihood support, required documents, or answering an eligibility follow-up question?",
          criteria: {
            true_description:
              "Relates to Indian government schemes, eligibility, documents, citizen benefits, or is a direct answer (yes/no, state, land size, income, category, document availability) in an active scheme-readiness conversation.",
            false_description:
              "Completely unrelated off-topic request such as coding homework, movie trivia, recipes, or sports scores.",
          },
        },
        journey: {
          type: "choice",
          instructions:
            "Based on `known_citizen_facts`, `current_journey`, and `latest_citizen_message`, which Indian citizen scheme journey best fits this citizen?",
          criteria: JOURNEY_CRITERIA,
        },
        profile_completeness: {
          type: "score",
          instructions:
            "Considering both `known_citizen_facts` and `latest_citizen_message`, how complete is this citizen's profile for evaluating official scheme eligibility?",
          criteria: COMPLETENESS_RUBRIC,
        },
        has_conflict_or_ambiguity: {
          type: "noul",
          instructions:
            "Does the citizen's situation contain potentially conflicting eligibility conditions, exclusion edge cases (such as government pensioner, income tax payer, institutional land, joint family land ownership, overlapping state/central criteria), or contradictory facts that need deep eligibility reasoning?",
          criteria: {
            true_description:
              "Contains potential exclusion rules, conflicting facts (e.g., smallholder farmer whose spouse receives government pension or pays income tax, tenant farmer without land title, borderline income/age), or complex multi-condition ambiguity.",
            false_description:
              "Straightforward standard profile or simple early greeting/information gathering without conflicting eligibility rules.",
          },
        },
      },
    }),
  );

  const tokens = extractDecisionTokens(response);
  recordModelUsage({
    sessionId: params.sessionId,
    model: MODELS.DECISION,
    callType: "turn_gate_and_routing",
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
  });

  if (!response.answers) {
    throw new Error("Decisions API returned no answers for citizen turn.");
  }

  const csAns = response.answers.is_citizen_services_query;
  const journeyAns = response.answers.journey;
  const compAns = response.answers.profile_completeness;
  const conflictAns = response.answers.has_conflict_or_ambiguity;

  const isCitizenServicesProb = csAns?.type === "noul" ? csAns.noul : 0.5;
  const isCitizenServicesConfidence = csAns?.type === "noul" ? csAns.confidence : 0.5;
  const isCitizenServicesQuery = isCitizenServicesProb >= 0.45;

  const rawJourney = (journeyAns?.type === "choice" ? journeyAns.choice : "other") as JourneyType;
  const journeyConfidence = journeyAns?.type === "choice" ? journeyAns.confidence : 0.5;
  const journeyProbabilities =
    journeyAns?.type === "choice" ? journeyAns.probabilities : {};

  // Preserve confirmed journey if citizen gives a short follow-up answer ("Yes", "2 acres", "UP")
  let resolvedJourney: JourneyType = rawJourney;
  if (
    params.currentJourney !== "other" &&
    (rawJourney === "other" || journeyConfidence < CONFIDENCE_THRESHOLDS.DECISION_ESCALATION)
  ) {
    resolvedJourney = params.currentJourney;
  }

  const profileCompletenessScore = compAns?.type === "score" ? compAns.score : 0;
  const profileCompletenessConfidence = compAns?.type === "score" ? compAns.confidence : 0.5;

  const conflictProb = conflictAns?.type === "noul" ? conflictAns.noul : 0.1;
  const conflictConfidence = conflictAns?.type === "noul" ? conflictAns.confidence : 0.5;
  const hasConflictOrAmbiguity = conflictProb >= 0.55;

  const threshold = CONFIDENCE_THRESHOLDS.DECISION_ESCALATION;
  const lowJourneyConf = resolvedJourney === "other" || journeyConfidence < threshold;
  const lowCitizenQueryConf = isCitizenServicesConfidence < threshold;
  const lowConfidenceDetected = lowJourneyConf || lowCitizenQueryConf;

  // Escalate to Gemini 4 Neon ONLY when the case is genuinely ambiguous,
  // conditions conflict, or Decision 1 routing confidence is below 0.75 on a substantive profile.
  const needsClarification =
    resolvedJourney === "other" ||
    (lowJourneyConf && params.currentJourney === "other") ||
    lowCitizenQueryConf;

  const shouldEscalateToNeon =
    hasConflictOrAmbiguity ||
    (resolvedJourney !== "other" &&
      (lowJourneyConf || lowCitizenQueryConf || conflictProb >= 0.5));

  return {
    isCitizenServicesQuery,
    isCitizenServicesProb,
    isCitizenServicesConfidence,
    journey: resolvedJourney,
    journeyConfidence,
    journeyProbabilities,
    profileCompletenessScore,
    profileCompletenessConfidence,
    hasConflictOrAmbiguity,
    conflictProb,
    conflictConfidence,
    lowConfidenceDetected,
    shouldEscalateToNeon,
    needsClarification,
  };
}

/**
 * Multimodal Decisions API gate: verifies whether an uploaded document photo
 * matches the claimed document type and is legible, before field extraction.
 */
export async function verifyDocumentMatchesClaimedType(params: {
  sessionId: string;
  imageBase64: string;
  mimeType: string;
  claimedType: DocumentTypeKey;
}): Promise<DocumentGateDecision> {
  assertBudgetAvailable(params.sessionId);

  const decisionsAi = getDecisionsClient();
  const claimedDesc = DOCUMENT_TYPE_DESCRIPTIONS[params.claimedType];

  const response = await withTransientRetry(() =>
    decisionsAi.decisions.create({
      model: MODELS.DECISION,
      input: [
        {
          type: "text",
          text: `The citizen uploaded this document claiming it is: ${params.claimedType} (${claimedDesc}).\n`,
        },
        {
          type: "image",
          data: params.imageBase64,
          mime_type: params.mimeType,
          resolution: "medium",
        },
      ],
      questions: {
        matches_claimed_type: {
          type: "noul",
          instructions: `Does this uploaded document image match the claimed document type: ${claimedDesc}?`,
          criteria: {
            true_description:
              "The image clearly shows the claimed Indian document type (or an official digital/masked copy of it).",
            false_description:
              "The image shows a different document type, a blank page, a selfie, or an unrelated object.",
          },
        },
        is_legible: {
          type: "noul",
          instructions:
            "Is the text and layout in this uploaded document photo sufficiently clear and readable to verify document readiness?",
          criteria: {
            true_description: "Key headings and fields are readable without severe blur or cropping.",
            false_description: "Too blurry, dark, cropped, or obscured to read key fields reliably.",
          },
        },
      },
    }),
  );

  const tokens = extractDecisionTokens(response);
  recordModelUsage({
    sessionId: params.sessionId,
    model: MODELS.DECISION,
    callType: "document_type_gate",
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
  });

  if (!response.answers) {
    throw new Error("Decisions API returned no answers for document verification.");
  }

  const matchAns = response.answers.matches_claimed_type;
  const legibleAns = response.answers.is_legible;

  const matchProbability = matchAns?.type === "noul" ? matchAns.noul : 0.5;
  const matchConfidence = matchAns?.type === "noul" ? matchAns.confidence : 0.5;
  const legibleProbability = legibleAns?.type === "noul" ? legibleAns.noul : 0.5;
  const legibleConfidence = legibleAns?.type === "noul" ? legibleAns.confidence : 0.5;

  const lowConfidenceDetected =
    matchConfidence < CONFIDENCE_THRESHOLDS.DECISION_ESCALATION ||
    legibleConfidence < CONFIDENCE_THRESHOLDS.DECISION_ESCALATION;

  return {
    matchesClaimedType: matchProbability >= 0.55,
    matchProbability,
    matchConfidence,
    isLegible: legibleProbability >= 0.5,
    legibleProbability,
    legibleConfidence,
    lowConfidenceDetected,
  };
}

/**
 * Calibrated scheme-match scoring via Decisions API (`gemini-decision-1`).
 * Derives UI confidence labels (High / Medium / Low) strictly from Decision 1
 * outputs (and Neon conflict flags), NEVER from model self-assertion.
 */
export async function scoreSchemeMatches(params: {
  sessionId: string;
  knownFacts: string[];
  latestMessage: string;
  schemes: OfficialSchemeRecord[];
  hasConflictOrAmbiguity: boolean;
}): Promise<Map<string, SchemeDecisionScore>> {
  const results = new Map<string, SchemeDecisionScore>();
  if (params.schemes.length === 0) return results;

  assertBudgetAvailable(params.sessionId);
  const decisionsAi = getDecisionsClient();

  const criteriaBlocks = params.schemes
    .map(
      (s, idx) =>
        `[SCHEME_${idx}: ${s.schemeName}]\nEligibility: ${s.eligibilityCriteria.join("; ")}\nExclusions: ${s.exclusions.join("; ") || "None listed"}`,
    )
    .join("\n\n");

  const questions: Record<
    string,
    {
      type: "noul";
      instructions: string;
      criteria: { true_description: string; false_description: string };
    }
  > = {};

  params.schemes.forEach((scheme, idx) => {
    questions[`scheme_${idx}`] = {
      type: "noul",
      instructions: `Based strictly on the official criteria for "${scheme.schemeName}" above and the citizen facts provided, could this citizen potentially qualify for "${scheme.schemeName}" (meaning no clear exclusion disqualifies them and core criteria align)?`,
      criteria: {
        true_description:
          "Citizen's stated facts align with core eligibility criteria and do not trigger an explicit exclusion rule.",
        false_description:
          "Citizen clearly fails a mandatory criterion, triggers an official exclusion rule, or has far too little matching context.",
      },
    };
  });

  const response = await withTransientRetry(() =>
    decisionsAi.decisions.create({
      model: MODELS.DECISION,
      input: [
        {
          type: "text",
          text:
            `Citizen Profile Facts:\n${JSON.stringify({ knownFacts: params.knownFacts, latestMessage: params.latestMessage })}\n\n` +
            `Official myScheme Criteria:\n${criteriaBlocks}`,
        },
      ],
      questions,
    }),
  );

  const tokens = extractDecisionTokens(response);
  recordModelUsage({
    sessionId: params.sessionId,
    model: MODELS.DECISION,
    callType: "scheme_match_calibration",
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
  });

  params.schemes.forEach((scheme, idx) => {
    const ans = response.answers?.[`scheme_${idx}`];
    const probability = ans?.type === "noul" ? ans.noul : 0.5;
    const confidence = ans?.type === "noul" ? ans.confidence : 0.5;
    const lowConfidence = confidence < CONFIDENCE_THRESHOLDS.DECISION_ESCALATION;

    let label: ConfidenceLabel = "Low";
    if (
      !params.hasConflictOrAmbiguity &&
      !lowConfidence &&
      probability >= CONFIDENCE_THRESHOLDS.HIGH_MATCH_PROB &&
      confidence >= CONFIDENCE_THRESHOLDS.HIGH_CONFIDENCE
    ) {
      label = "High";
    } else if (
      probability >= CONFIDENCE_THRESHOLDS.MEDIUM_MATCH_PROB &&
      confidence >= CONFIDENCE_THRESHOLDS.MEDIUM_CONFIDENCE
    ) {
      label = params.hasConflictOrAmbiguity && probability < 0.7 ? "Low" : "Medium";
    } else {
      label = "Low";
    }

    results.set(scheme.slug, {
      slug: scheme.slug,
      probability: Number(probability.toFixed(3)),
      confidence: Number(confidence.toFixed(3)),
      label,
      lowConfidence,
    });
  });

  return results;
}
