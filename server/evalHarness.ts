import crypto from "node:crypto";
import { MODELS } from "../shared/models.ts";
import type {
  EvalCaseMetrics,
  EvalSuiteReport,
  Language,
  ModelId,
} from "../shared/models.ts";
import { clearSessionLedger } from "./costGuard.ts";
import { handleChatTurn } from "./schemeEngine.ts";

interface SyntheticEvalCase {
  caseId: string;
  profileType: "complete" | "incomplete" | "ambiguous";
  language: Language;
  prompt: string;
  expectEscalationOrHandoff: boolean;
  expectFollowUpQuestion: boolean;
}

/**
 * STRICTLY SYNTHETIC evaluation profiles (zero real citizen data).
 * Tests Complete, Incomplete, and Ambiguous/Conflicting situations in both English and Hindi.
 */
export const SYNTHETIC_EVAL_CASES: SyntheticEvalCase[] = [
  {
    caseId: "complete_en",
    profileType: "complete",
    language: "en",
    prompt:
      "I am a smallholder farmer in Uttar Pradesh owning 2 acres of cultivable land. I do not pay income tax and no one in my family is a government employee. I already have my Aadhaar card, Khatauni land record, and bank passbook linked to Aadhaar. Which schemes fit me and what is my next official step?",
    expectEscalationOrHandoff: false,
    expectFollowUpQuestion: false,
  },
  {
    caseId: "complete_hi",
    profileType: "complete",
    language: "hi",
    prompt:
      "मैं उत्तर प्रदेश का छोटा किसान हूँ और मेरे नाम 2 एकड़ खेती की ज़मीन है। मैं आयकर नहीं देता और परिवार में कोई सरकारी नौकरी में नहीं है। मेरे पास आधार कार्ड, खतौनी और आधार से जुड़ा बैंक खाता है। मेरे लिए कौन-सी योजनाएं उपयुक्त हैं और अगला आधिकारिक कदम क्या है?",
    expectEscalationOrHandoff: false,
    expectFollowUpQuestion: false,
  },
  {
    caseId: "incomplete_en",
    profileType: "incomplete",
    language: "en",
    prompt: "I am a college student and need help with government scholarships.",
    expectEscalationOrHandoff: false,
    expectFollowUpQuestion: true,
  },
  {
    caseId: "incomplete_hi",
    profileType: "incomplete",
    language: "hi",
    prompt: "मैं कॉलेज का छात्र हूँ और मुझे सरकारी छात्रवृत्ति के बारे में मदद चाहिए।",
    expectEscalationOrHandoff: false,
    expectFollowUpQuestion: true,
  },
  {
    caseId: "ambiguous_en",
    profileType: "ambiguous",
    language: "en",
    prompt:
      "I farm 1.8 acres of family land in Maharashtra, though the land title is still jointly in my late father's name, and my spouse receives a retired state government pension of Rs 15,000 per month. Can I apply for PM-KISAN or Kisan Credit Card?",
    expectEscalationOrHandoff: true,
    expectFollowUpQuestion: false,
  },
  {
    caseId: "ambiguous_hi",
    profileType: "ambiguous",
    language: "hi",
    prompt:
      "मैं महाराष्ट्र में 1.8 एकड़ पारिवारिक ज़मीन पर खेती करता हूँ लेकिन खतौनी अभी भी मेरे स्वर्गीय पिता के संयुक्त नाम पर है, और मेरी पत्नी को 15,000 रुपये प्रति माह सरकारी पेंशन मिलती है। क्या मैं PM-KISAN या किसान क्रेडिट कार्ड के लिए पात्र हूँ?",
    expectEscalationOrHandoff: true,
    expectFollowUpQuestion: false,
  },
];

function checkLanguageMatch(text: string, expected: Language): boolean {
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  if (expected === "hi") return hasDevanagari;
  return text.trim().length > 10 && !hasDevanagari;
}

export async function runSingleEvalCase(
  spec: SyntheticEvalCase,
): Promise<EvalCaseMetrics> {
  const evalSessionId = `eval_${spec.caseId}_${crypto.randomBytes(4).toString("hex")}`;
  const startMs = Date.now();

  try {
    const result = await handleChatTurn({
      sessionId: evalSessionId,
      message: spec.prompt,
      uiLanguage: spec.language,
    });
    const durationMs = Date.now() - startMs;
    const plan = result.session.plan;
    const matches = plan.matches;
    const docs = plan.documents;

    // 1. Source traceability: every match must carry a verified myscheme.gov.in URL + fetchedAt
    const verifiedMatches = matches.filter(
      (m) =>
        m.sourceUrl.startsWith("https://www.myscheme.gov.in/schemes/") &&
        Boolean(m.fetchedAt),
    );
    const traceabilityPercent =
      matches.length > 0
        ? Math.round((verifiedMatches.length / matches.length) * 100)
        : plan.sourceFetchStatus === "unavailable"
          ? 100
          : 0;

    // 2. Checklist completeness
    const readyCount = docs.filter((d) => d.status === "ready").length;
    const missingCount = docs.filter((d) => d.status !== "ready").length;
    let checklistScore = 0;
    if (docs.length >= 2) {
      checklistScore = 100;
    } else if (docs.length === 1) {
      checklistScore = 70;
    } else if (spec.profileType === "incomplete" && result.assistantMessage.choices?.length) {
      checklistScore = 80;
    }

    // 3. Explanation accuracy (profile-specific rubric)
    let explanationScore = 50;
    const notes: string[] = [];

    if (spec.profileType === "complete") {
      if (matches.length > 0 && matches.every((m) => m.whyItMayFit.length > 15 && m.nextOfficialAction.length > 10)) {
        explanationScore += 35;
        notes.push(`${matches.length} grounded match(es) explained with next official action.`);
      } else {
        notes.push("Missing detailed grounded match explanation.");
      }
      if (readyCount > 0) {
        explanationScore += 15;
        notes.push(`Recognized ${readyCount} ready document(s).`);
      }
    } else if (spec.profileType === "incomplete") {
      const askedClarifying =
        (result.assistantMessage.choices?.length ?? 0) > 0 ||
        plan.unknownFacts.length > 0 ||
        result.assistantMessage.text.includes("?");
      if (askedClarifying) {
        explanationScore += 35;
        notes.push("Asked targeted follow-up / surfaced unknown facts safely.");
      } else {
        notes.push("Did not ask a decisive follow-up for incomplete profile.");
      }
      if (plan.unknownFacts.length > 0) {
        explanationScore += 15;
        notes.push(`Listed ${plan.unknownFacts.length} unknown fact(s) without guessing.`);
      }
    } else if (spec.profileType === "ambiguous") {
      if (result.routingMeta.escalatedToNeon) {
        explanationScore += 25;
        notes.push("Escalated to Gemini 4 Neon (high thinking).");
      } else {
        notes.push("Did not escalate to Neon.");
      }
      if (plan.showHumanHandoff) {
        explanationScore += 15;
        notes.push("Surfaced human handoff / CSC channel.");
      }
      const flaggedVerify = matches.some((m) => m.whatToVerify.length > 0) || Boolean(plan.humanHandoffReason);
      if (flaggedVerify) {
        explanationScore += 10;
        notes.push("Flagged exclusion/title verification points.");
      }
    }
    explanationScore = Math.min(100, explanationScore);

    const languageMatch = checkLanguageMatch(result.assistantMessage.text, spec.language);
    const hasClearNextAction =
      plan.nextStepSummary.trim().length > 12 ||
      matches.some((m) => m.nextOfficialAction.trim().length > 10);

    const modelsUsed: ModelId[] = Array.from(
      new Set<ModelId>([MODELS.DECISION, result.routingMeta.modelUsed]),
    );

    const passed =
      explanationScore >= 75 &&
      traceabilityPercent === 100 &&
      languageMatch &&
      hasClearNextAction &&
      (!spec.expectEscalationOrHandoff ||
        result.routingMeta.escalatedToNeon ||
        plan.showHumanHandoff);

    const metrics: EvalCaseMetrics = {
      caseId: spec.caseId,
      profileType: spec.profileType,
      language: spec.language,
      promptUsed: spec.prompt,
      passed,
      durationMs,
      explanationAccuracy: {
        score: explanationScore,
        notes: notes.join(" "),
      },
      checklistCompleteness: {
        score: checklistScore,
        totalItems: docs.length,
        readyCount,
        missingCount,
      },
      sourceTraceability: {
        percent: traceabilityPercent,
        matchesWithVerifiedSource: verifiedMatches.length,
        totalMatches: matches.length,
      },
      languageMatch,
      hasClearNextAction,
      escalatedToNeon: result.routingMeta.escalatedToNeon,
      showedHumanHandoff: plan.showHumanHandoff,
      modelsUsed,
      estimatedCostUsd: result.session.budget.estimatedSessionCostUsd,
      sampleReply: result.assistantMessage.text.slice(0, 260),
    };

    clearSessionLedger(evalSessionId);
    return metrics;
  } catch (err) {
    clearSessionLedger(evalSessionId);
    return {
      caseId: spec.caseId,
      profileType: spec.profileType,
      language: spec.language,
      promptUsed: spec.prompt,
      passed: false,
      durationMs: Date.now() - startMs,
      explanationAccuracy: { score: 0, notes: "Run failed." },
      checklistCompleteness: { score: 0, totalItems: 0, readyCount: 0, missingCount: 0 },
      sourceTraceability: { percent: 0, matchesWithVerifiedSource: 0, totalMatches: 0 },
      languageMatch: false,
      hasClearNextAction: false,
      escalatedToNeon: false,
      showedHumanHandoff: false,
      modelsUsed: [],
      estimatedCostUsd: 0,
      sampleReply: "",
      error: err instanceof Error ? err.message : "Unknown evaluation error",
    };
  }
}

export async function runEvalSuite(caseIds?: string[]): Promise<EvalSuiteReport> {
  const selected =
    caseIds && caseIds.length > 0
      ? SYNTHETIC_EVAL_CASES.filter((c) => caseIds.includes(c.caseId))
      : SYNTHETIC_EVAL_CASES;

  const startMs = Date.now();
  const cases: EvalCaseMetrics[] = [];

  // Run sequentially to respect myScheme rate limiting and keep console logs orderly
  for (const spec of selected) {
    const outcome = await runSingleEvalCase(spec);
    cases.push(outcome);
  }

  const totalDurationMs = Date.now() - startMs;
  const count = cases.length || 1;
  const passCount = cases.filter((c) => c.passed).length;
  const enCases = cases.filter((c) => c.language === "en");
  const hiCases = cases.filter((c) => c.language === "hi");
  const bilingualCompletion =
    enCases.length > 0 &&
    hiCases.length > 0 &&
    enCases.every((c) => c.languageMatch && c.hasClearNextAction) &&
    hiCases.every((c) => c.languageMatch && c.hasClearNextAction);

  return {
    runAt: new Date().toISOString(),
    totalDurationMs,
    cases,
    summary: {
      passRatePercent: Math.round((passCount / count) * 100),
      avgSourceTraceabilityPercent: Math.round(
        cases.reduce((acc, c) => acc + c.sourceTraceability.percent, 0) / count,
      ),
      avgChecklistCompleteness: Math.round(
        cases.reduce((acc, c) => acc + c.checklistCompleteness.score, 0) / count,
      ),
      avgDurationMs: Math.round(
        cases.reduce((acc, c) => acc + c.durationMs, 0) / count,
      ),
      totalEstimatedCostUsd: Number(
        cases.reduce((acc, c) => acc + c.estimatedCostUsd, 0).toFixed(6),
      ),
      bilingualCompletion,
    },
  };
}
