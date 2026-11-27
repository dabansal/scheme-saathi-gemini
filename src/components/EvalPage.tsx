import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Play,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { EvalSuiteReport, Language } from "../../shared/models.ts";
import { fetchEvalCases, runEvaluationSuite } from "../api.ts";

interface EvalCaseSpec {
  caseId: string;
  profileType: "complete" | "incomplete" | "ambiguous";
  language: Language;
  prompt: string;
}

export function EvalPage() {
  const [cases, setCases] = useState<EvalCaseSpec[]>([]);
  const [report, setReport] = useState<EvalSuiteReport | null>(null);
  const [running, setRunning] = useState(false);
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEvalCases()
      .then((res) => setCases(res.cases))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load eval cases"));
  }, []);

  function recomputeSummary(merged: EvalSuiteReport["cases"], runAt: string): EvalSuiteReport {
    const count = merged.length || 1;
    const passCount = merged.filter((c) => c.passed).length;
    const enCases = merged.filter((c) => c.language === "en");
    const hiCases = merged.filter((c) => c.language === "hi");
    return {
      runAt,
      totalDurationMs: merged.reduce((s, c) => s + c.durationMs, 0),
      cases: merged,
      summary: {
        passRatePercent: Math.round((passCount / count) * 100),
        avgSourceTraceabilityPercent: Math.round(
          merged.reduce((s, c) => s + c.sourceTraceability.percent, 0) / count,
        ),
        avgChecklistCompleteness: Math.round(
          merged.reduce((s, c) => s + c.checklistCompleteness.score, 0) / count,
        ),
        avgDurationMs: Math.round(
          merged.reduce((s, c) => s + c.durationMs, 0) / count,
        ),
        totalEstimatedCostUsd: Number(
          merged.reduce((s, c) => s + c.estimatedCostUsd, 0).toFixed(6),
        ),
        bilingualCompletion:
          enCases.length > 0 &&
          hiCases.length > 0 &&
          enCases.every((c) => c.languageMatch && c.hasClearNextAction) &&
          hiCases.every((c) => c.languageMatch && c.hasClearNextAction),
      },
    };
  }

  async function handleRun(caseIds?: string[]) {
    setError(null);
    setRunning(true);
    const targetIds =
      caseIds && caseIds.length > 0
        ? caseIds
        : cases.map((c) => c.caseId);

    let accumulated = caseIds && caseIds.length === 1 && report ? [...report.cases] : [];

    try {
      for (const id of targetIds) {
        setRunningCaseId(id);
        const result = await runEvaluationSuite([id]);
        accumulated = [
          ...accumulated.filter((c) => c.caseId !== id),
          ...result.cases,
        ];
        setReport(recomputeSummary(accumulated, result.runAt));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setRunning(false);
      setRunningCaseId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFD] text-[#1F1F1F]">
      <header className="sticky top-0 z-30 bg-[#F8FAFD]/95 backdrop-blur-md border-b border-[#E1E5EC]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3.5 min-w-0">
            <a
              href="/"
              className="min-h-[40px] px-3 -ml-3 rounded-full inline-flex items-center gap-1.5 text-sm font-medium text-[#444746] hover:text-[#1F1F1F] hover:bg-[#1F1F1F]/6 transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Scheme Saathi</span>
            </a>
            <span className="text-[#C4C7C5]" aria-hidden="true">/</span>
            <h1 className="text-base font-semibold text-[#1F1F1F] truncate">
              Synthetic Evaluation Harness
            </h1>
          </div>

          <button
            type="button"
            disabled={running}
            onClick={() => handleRun()}
            className="min-h-[42px] px-5 py-2 rounded-full bg-[#0B57D0] text-white text-xs sm:text-sm font-medium inline-flex items-center gap-2 hover:bg-[#0842A0] disabled:opacity-55 transition-colors whitespace-nowrap shrink-0"
          >
            {running && runningCaseId !== null ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="w-4 h-4" aria-hidden="true" />
            )}
            <span>Run all 6 synthetic cases</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-7 space-y-6">
        <div className="bg-[#F0F4F9] rounded-[24px] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[#1F1F1F] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#0B57D0]" aria-hidden="true" />
              <span>Synthetic profiles only — live pipeline verification</span>
            </p>
            <p className="text-xs sm:text-sm text-[#444746] leading-relaxed max-w-3xl">
              Tests three synthetic citizen profiles (Complete farmer, Incomplete student,
              Ambiguous/conflicting farmer with pensioner spouse) across both English and
              Hindi using live Decision 1 gating, live myScheme criteria, and Hydrogen /
              Neon escalation.
            </p>
          </div>
          <div className="text-xs text-[#444746] font-mono-tabular shrink-0">
            Target cost &lt; $0.05 / session
          </div>
        </div>

        {error && (
          <div className="rounded-[20px] bg-[#F9DEDC] p-4 text-sm text-[#410E0B] flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Summary KPI Strip */}
        {report && (
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white border border-[#E1E5EC] md-elevation-1 rounded-[24px] p-4 space-y-1">
              <p className="text-xs text-[#444746]">Pass rate</p>
              <p className="text-2xl font-bold font-mono-tabular text-[#1F1F1F]">
                {report.summary.passRatePercent}%
              </p>
            </div>
            <div className="bg-white border border-[#E1E5EC] md-elevation-1 rounded-[24px] p-4 space-y-1">
              <p className="text-xs text-[#444746]">Source traceability</p>
              <p className="text-2xl font-bold font-mono-tabular text-[#1F1F1F]">
                {report.summary.avgSourceTraceabilityPercent}%
              </p>
            </div>
            <div className="bg-white border border-[#E1E5EC] md-elevation-1 rounded-[24px] p-4 space-y-1">
              <p className="text-xs text-[#444746]">Checklist completeness</p>
              <p className="text-2xl font-bold font-mono-tabular text-[#1F1F1F]">
                {report.summary.avgChecklistCompleteness}%
              </p>
            </div>
            <div className="bg-white border border-[#E1E5EC] md-elevation-1 rounded-[24px] p-4 space-y-1">
              <p className="text-xs text-[#444746]">Avg time to next action</p>
              <p className="text-2xl font-bold font-mono-tabular text-[#1F1F1F]">
                {(report.summary.avgDurationMs / 1000).toFixed(1)}s
              </p>
            </div>
            <div className="bg-white border border-[#E1E5EC] md-elevation-1 rounded-[24px] p-4 space-y-1 col-span-2 lg:col-span-1">
              <p className="text-xs text-[#444746]">Bilingual (EN + HI) · Est. cost</p>
              <p className="text-lg font-bold font-mono-tabular text-[#1F1F1F]">
                {report.summary.bilingualCompletion ? "Passed" : "Partial"} · $
                {report.summary.totalEstimatedCostUsd.toFixed(4)}
              </p>
            </div>
          </section>
        )}

        {/* Cases & Results Table */}
        <section className="bg-white border border-[#E1E5EC] md-elevation-1 rounded-[28px] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E1E5EC] flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#1F1F1F]">
              Synthetic Test Profiles (English & Hindi)
            </h2>
            {report && (
              <span className="text-xs text-[#444746] font-mono-tabular">
                Last run: {new Date(report.runAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#E1E5EC] text-xs text-[#444746] bg-[#F0F4F9]/60">
                  <th className="py-3.5 px-4 font-semibold">Profile</th>
                  <th className="py-3.5 px-4 font-semibold">Lang</th>
                  <th className="py-3.5 px-4 font-semibold">Status</th>
                  <th className="py-3.5 px-4 font-semibold">Explanation</th>
                  <th className="py-3.5 px-4 font-semibold">Checklist</th>
                  <th className="py-3.5 px-4 font-semibold">Traceability</th>
                  <th className="py-3.5 px-4 font-semibold">Latency</th>
                  <th className="py-3.5 px-4 font-semibold">Models / Cost</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E5EC]">
                {cases.map((spec) => {
                  const res = report?.cases.find((c) => c.caseId === spec.caseId);
                  const isBusy = running && runningCaseId === spec.caseId;
                  return (
                    <tr key={spec.caseId} className="align-top hover:bg-[#F8FAFD] transition-colors">
                      <td className="py-4 px-4">
                        <p className="font-semibold text-[#1F1F1F] capitalize">
                          {spec.profileType}
                        </p>
                        <p className="text-xs text-[#444746] mt-1 max-w-xs line-clamp-2">
                          {spec.prompt}
                        </p>
                        {res?.sampleReply && (
                          <p className="text-xs text-[#1F1F1F] mt-2 pt-2 border-t border-[#E1E5EC] max-w-sm">
                            {res.sampleReply}
                          </p>
                        )}
                      </td>
                      <td className="py-4 px-4 font-mono-tabular text-xs uppercase text-[#444746]">
                        {spec.language}
                      </td>
                      <td className="py-4 px-4 text-xs font-semibold">
                        {!res ? (
                          <span className="text-[#747775]">Not run</span>
                        ) : res.passed ? (
                          <span className="inline-flex items-center gap-1 text-[#146C2E]">
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Pass</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#7A4F01]">
                            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Review</span>
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-xs">
                        {res ? (
                          <div>
                            <p className="font-mono-tabular font-semibold text-[#1F1F1F]">
                              {res.explanationAccuracy.score}%
                            </p>
                            <p className="text-[#444746] mt-0.5 max-w-[200px]">
                              {res.explanationAccuracy.notes}
                            </p>
                          </div>
                        ) : (
                          <span className="text-[#747775]">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4 font-mono-tabular text-xs">
                        {res ? (
                          <div>
                            <p className="font-semibold text-[#1F1F1F]">
                              {res.checklistCompleteness.score}%
                            </p>
                            <p className="text-[#444746]">
                              {res.checklistCompleteness.readyCount} ready /{" "}
                              {res.checklistCompleteness.missingCount} missing
                            </p>
                          </div>
                        ) : (
                          <span className="text-[#747775]">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4 font-mono-tabular text-xs">
                        {res ? (
                          <div>
                            <p className="font-semibold text-[#1F1F1F]">
                              {res.sourceTraceability.percent}%
                            </p>
                            <p className="text-[#444746]">
                              {res.sourceTraceability.matchesWithVerifiedSource}/
                              {res.sourceTraceability.totalMatches} sourced
                            </p>
                          </div>
                        ) : (
                          <span className="text-[#747775]">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4 font-mono-tabular text-xs text-[#444746]">
                        {res ? `${(res.durationMs / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="py-4 px-4 text-xs font-mono-tabular">
                        {res ? (
                          <div className="space-y-0.5">
                            <p className="text-[#1F1F1F]">
                              {res.modelsUsed.join(", ")}
                            </p>
                            <p className="text-[#444746]">
                              ${res.estimatedCostUsd.toFixed(4)}
                              {res.escalatedToNeon ? " · Neon escalated" : ""}
                              {res.showedHumanHandoff ? " · Human handoff" : ""}
                            </p>
                          </div>
                        ) : (
                          <span className="text-[#747775]">—</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <button
                          type="button"
                          disabled={running}
                          onClick={() => handleRun([spec.caseId])}
                          className="min-h-[36px] px-4 py-1.5 rounded-full border border-[#747775]/60 text-xs font-medium text-[#0B57D0] hover:bg-[#0B57D0]/8 disabled:opacity-45 whitespace-nowrap transition-colors"
                        >
                          {isBusy ? "Running..." : "Run"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
