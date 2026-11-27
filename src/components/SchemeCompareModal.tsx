import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDashed,
  Columns2,
  ExternalLink,
  HelpCircle,
  Layers,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ConfidenceLabel,
  DocumentChecklistItem,
  Language,
  SchemeMatch,
} from "../../shared/models.ts";
import { UI_COPY } from "../i18n.ts";
import { compareSelectedSchemes } from "../lib/schemeCompare.ts";

interface SchemeCompareModalProps {
  open: boolean;
  language: Language;
  matches: SchemeMatch[];
  documents: DocumentChecklistItem[];
  manualReadyDocIds: string[];
  onClose: () => void;
}

function isSafeHttpsUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === "https:";
  } catch {
    return false;
  }
}

function renderConfidenceBadge(confidence: ConfidenceLabel, language: Language) {
  const label = UI_COPY[language].confidenceNames[confidence];
  if (confidence === "High") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#146C2E]">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (confidence === "Medium") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B57D0]">
        <HelpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#7A4F01]">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function SchemeCompareModal({
  open,
  language,
  matches,
  documents,
  manualReadyDocIds,
  onClose,
}: SchemeCompareModalProps) {
  const copy = UI_COPY[language];
  const cmpCopy = copy.compareSchemes;
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>(() =>
    matches.slice(0, 3).map((m) => m.slug),
  );

  // Sync default selection whenever modal opens or matches change
  const matchesKey = matches.map((m) => m.slug).join("|");
  useEffect(() => {
    if (!open) return;
    const valid = matches.map((m) => m.slug);
    setSelectedSlugs((prev) => {
      const kept = prev.filter((slug) => valid.includes(slug));
      if (kept.length >= 2) return kept.slice(0, 3);
      return valid.slice(0, 3);
    });
  }, [open, matchesKey, matches]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const activeMatches = useMemo(
    () => matches.filter((m) => selectedSlugs.includes(m.slug)),
    [matches, selectedSlugs],
  );

  const comparison = useMemo(
    () =>
      compareSelectedSchemes({
        matches: activeMatches,
        documents,
        manualReadyDocIds,
      }),
    [activeMatches, documents, manualReadyDocIds],
  );

  if (!open || matches.length < 2) return null;

  function handleToggleSlug(slug: string) {
    setSelectedSlugs((prev) => {
      if (prev.includes(slug)) {
        if (prev.length <= 2) return prev;
        return prev.filter((s) => s !== slug);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), slug];
      }
      return [...prev, slug];
    });
  }

  const gridColsClass =
    comparison.rows.length >= 3
      ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
      : "grid-cols-1 md:grid-cols-2";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scheme-compare-title"
      className="fixed inset-0 z-50 bg-[#1F1F1F]/40 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5 print:hidden"
    >
      <div className="bg-[#F8FAFD] rounded-[28px] w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden md-elevation-3">
        {/* M3 Dialog Header */}
        <div className="px-6 py-4 bg-white border-b border-[#E1E5EC] flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-[#D3E3FD] text-[#041E49] flex items-center justify-center shrink-0">
              <Columns2 className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="scheme-compare-title"
                className="text-lg sm:text-xl font-semibold text-[#1F1F1F]"
              >
                {cmpCopy.modalTitle}
              </h2>
              <p className="text-xs sm:text-sm text-[#444746] mt-0.5 leading-snug">
                {cmpCopy.modalSubtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={cmpCopy.closeBtn}
            className="min-h-[44px] min-w-[44px] rounded-full text-[#444746] hover:text-[#1F1F1F] hover:bg-[#1F1F1F]/8 inline-flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* Scheme Picker M3 Filter Chips */}
          {matches.length > 2 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#444746]">
                {cmpCopy.selectSchemesLabel}
              </p>
              <div className="flex flex-wrap gap-2">
                {matches.map((match) => {
                  const active = selectedSlugs.includes(match.slug);
                  return (
                    <button
                      key={match.slug}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleToggleSlug(match.slug)}
                      className={`min-h-[40px] px-4 py-1.5 rounded-full text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 border transition-colors ${
                        active
                          ? "bg-[#D3E3FD] border-transparent text-[#041E49]"
                          : "bg-white border-[#C4C7C5] text-[#444746] hover:bg-[#F0F4F9]"
                      }`}
                    >
                      {active && (
                        <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate max-w-[220px]">
                        {match.schemeName}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stacking & Compatibility Tonal Callout */}
          <div
            className={`rounded-[20px] p-4 space-y-2 ${
              comparison.stacking.status === "verify_stacking"
                ? "bg-[#FFF4D6] text-[#422006]"
                : "bg-[#F0F4F9] text-[#1F1F1F]"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {comparison.stacking.status === "verify_stacking" ? (
                <AlertTriangle
                  className="w-4 h-4 text-[#7A4F01] mt-0.5 shrink-0"
                  aria-hidden="true"
                />
              ) : (
                <ShieldCheck
                  className="w-4 h-4 text-[#0B57D0] mt-0.5 shrink-0"
                  aria-hidden="true"
                />
              )}
              <div className="space-y-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
                  {cmpCopy.stackingHeading}
                </p>
                <p className="text-sm font-semibold">
                  {comparison.stacking.status === "verify_stacking"
                    ? cmpCopy.stackingVerifyTitle
                    : cmpCopy.stackingComplementaryTitle}
                </p>
                {comparison.stacking.sameCategoryNames.length > 0 && (
                  <p className="text-xs leading-relaxed">
                    {cmpCopy.stackingSameCategoryNote(
                      comparison.stacking.sameCategoryNames.join(", "),
                    )}
                  </p>
                )}
                {comparison.stacking.exclusionMentions.length > 0 && (
                  <p className="text-xs leading-relaxed">
                    {cmpCopy.stackingExclusionNote}
                  </p>
                )}
                {comparison.stacking.status === "complementary_check" && (
                  <p className="text-xs leading-relaxed text-[#444746]">
                    {cmpCopy.stackingComplementaryNote}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Shared Documents Across Selected Schemes */}
          {comparison.sharedDocuments.length > 0 && (
            <div className="rounded-[20px] bg-white border border-[#E1E5EC] p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#1F1F1F]">
                <Layers className="w-4 h-4 text-[#0B57D0] shrink-0" aria-hidden="true" />
                <span>{cmpCopy.sharedDocsHeading}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                {comparison.sharedDocuments.map((doc) => (
                  <span
                    key={doc.id}
                    className={`inline-flex items-center gap-1.5 font-medium ${
                      doc.isReady ? "text-[#146C2E]" : "text-[#444746]"
                    }`}
                  >
                    {doc.isReady ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <CircleDashed className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span>{doc.label}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Side-by-Side Comparison Cards */}
          <div className={`grid ${gridColsClass} gap-4 items-stretch`}>
            {comparison.rows.map((row) => {
              const isRecommended =
                row.match.slug === comparison.recommendedFirstSlug;
              return (
                <article
                  key={row.match.slug}
                  className={`rounded-[24px] bg-white border p-5 flex flex-col justify-between gap-4 ${
                    isRecommended
                      ? "border-[#0B57D0]/55 md-elevation-1"
                      : "border-[#E1E5EC]"
                  }`}
                >
                  <div className="space-y-3.5">
                    <div className="space-y-1.5">
                      {isRecommended && (
                        <p className="text-[11px] font-semibold text-[#0B57D0] inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>{cmpCopy.recommendedFirstLabel}</span>
                        </p>
                      )}
                      <h3 className="text-base font-semibold text-[#1F1F1F] leading-snug">
                        {row.match.schemeName}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#444746]">
                        <span>{row.match.category}</span>
                        <span aria-hidden="true">·</span>
                        {renderConfidenceBadge(row.match.confidence, language)}
                      </div>
                    </div>

                    {/* Document Readiness Bar */}
                    <div className="rounded-2xl bg-[#F0F4F9] p-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#444746]">
                          {cmpCopy.docsReadyLabel}
                        </span>
                        <span className="font-mono-tabular font-semibold text-[#1F1F1F]">
                          {row.totalDocCount > 0
                            ? `${row.readyDocCount}/${row.totalDocCount} (${row.readinessPercent}%)`
                            : `${row.readinessPercent}%`}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-[#DCE4F0] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#0B57D0] transition-all"
                          style={{ width: `${row.readinessPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Missing / To Prepare */}
                    {row.missingDocs.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-[#7A4F01]">
                          {cmpCopy.missingLabel} ({row.missingDocs.length})
                        </p>
                        <ul className="list-disc pl-4 space-y-0.5 text-xs text-[#422006] leading-relaxed">
                          {row.missingDocs.slice(0, 4).map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Official Rules to Verify */}
                    {row.match.whatToVerify.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-[#444746]">
                          {cmpCopy.verifyRulesLabel}
                        </p>
                        <ul className="list-disc pl-4 space-y-0.5 text-xs text-[#1F1F1F] leading-relaxed">
                          {row.match.whatToVerify.slice(0, 3).map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Next Official Action */}
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-[#444746]">
                        {copy.nextOfficialAction}
                      </p>
                      <p className="text-xs text-[#1F1F1F] font-medium leading-relaxed">
                        {row.match.nextOfficialAction}
                      </p>
                    </div>
                  </div>

                  {/* Verified Official Links */}
                  <div className="pt-2 border-t border-[#E1E5EC] flex flex-wrap items-center gap-2">
                    {isSafeHttpsUrl(row.match.officialChannelUrl) && (
                      <a
                        href={row.match.officialChannelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[40px] px-4 py-2 rounded-full bg-[#0B57D0] text-white text-xs font-medium inline-flex items-center gap-1.5 hover:bg-[#0842A0] transition-colors whitespace-nowrap"
                      >
                        <span>{copy.openOfficialChannel}</span>
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      </a>
                    )}
                    {isSafeHttpsUrl(row.match.sourceUrl) && (
                      <a
                        href={row.match.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[40px] px-3 py-2 rounded-full text-xs font-medium text-[#0B57D0] hover:bg-[#0B57D0]/8 inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                      >
                        <span>{copy.openOfficialSource}</span>
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
