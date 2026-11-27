import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Copy,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  MapPin,
  MessageSquare,
  Pencil,
  PhoneCall,
  Plus,
  Printer,
  Share2,
  ShieldCheck,
  ShieldOff,
  Square,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  CitizenLocation,
  ConfidenceLabel,
  Language,
  PlanState,
} from "../../shared/models.ts";
import { UI_COPY } from "../i18n.ts";
import { getDocumentGuide } from "../lib/documentGuides.ts";
import {
  buildShareableChecklistText,
  buildSmsShareUrl,
  buildWhatsAppShareUrl,
  copyTextToClipboard,
} from "../lib/shareChecklist.ts";

export type PlanTab = "matches" | "documents" | "nextStep";

interface PlanPanelProps {
  plan: PlanState;
  language: Language;
  location?: CitizenLocation;
  activeTab: PlanTab;
  onTabChange: (tab: PlanTab) => void;
  documentConsentGranted: boolean;
  isOffline?: boolean;
  canRecheckFacts?: boolean;
  recheckingFacts?: boolean;
  manualReadyDocIds: string[];
  onToggleManualDocReady: (docId: string) => void;
  onRecheckFacts: (editedFacts: string[]) => Promise<void>;
  onOpenHelpCentreMap: () => void;
  onRequestDocumentCheck: () => void;
  onRevokeConsent: () => void;
}

function isSafeHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatDateShort(iso: string, language: Language): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function renderConfidenceText(confidence: ConfidenceLabel, language: Language) {
  const label = UI_COPY[language].confidenceNames[confidence];
  if (confidence === "High") {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-[#146C2E]">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (confidence === "Medium") {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-[#0B57D0]">
        <HelpCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-[#7A4F01]">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function PlanPanel({
  plan,
  language,
  location,
  activeTab,
  onTabChange,
  documentConsentGranted,
  isOffline = false,
  canRecheckFacts = false,
  recheckingFacts = false,
  manualReadyDocIds,
  onToggleManualDocReady,
  onRecheckFacts,
  onOpenHelpCentreMap,
  onRequestDocumentCheck,
  onRevokeConsent,
}: PlanPanelProps) {
  const copy = UI_COPY[language];
  const [shareOpen, setShareOpen] = useState(false);
  const [copiedChecklist, setCopiedChecklist] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [selectedSchemeSlugs, setSelectedSchemeSlugs] = useState<string[]>(() =>
    plan.matches.map((m) => m.slug),
  );
  const [expandedGuides, setExpandedGuides] = useState<Record<string, boolean>>({});
  const [editingFacts, setEditingFacts] = useState(false);
  const [draftFacts, setDraftFacts] = useState<string[]>(plan.knownFacts);
  const [newFactInput, setNewFactInput] = useState("");

  useEffect(() => {
    if (!editingFacts) {
      setDraftFacts(plan.knownFacts);
    }
  }, [plan.knownFacts, editingFacts]);

  // Keep chosen schemes synced when new matches arrive
  const matchSlugsKey = plan.matches.map((m) => m.slug).join("|");
  useEffect(() => {
    const validSlugs = plan.matches.map((m) => m.slug);
    setSelectedSchemeSlugs((prev) => {
      const kept = prev.filter((slug) => validSlugs.includes(slug));
      return kept.length > 0 ? kept : validSlugs;
    });
  }, [matchSlugsKey, plan.matches]);

  const manualReadySet = new Set(manualReadyDocIds);
  const isDocReady = (docId: string, status: PlanState["documents"][number]["status"]) =>
    status === "ready" || manualReadySet.has(docId);

  const readyCount = plan.documents.filter((d) => isDocReady(d.id, d.status)).length;
  const missingCount = plan.documents.length - readyCount;

  const activeLocation = location ?? plan.location;

  const shareText = buildShareableChecklistText({
    plan,
    language,
    location: activeLocation,
    manualReadyDocIds,
    selectedSchemeSlugs,
  });
  const whatsappUrl = buildWhatsAppShareUrl(shareText);
  const smsUrl = buildSmsShareUrl(shareText);

  function handleToggleShareScheme(slug: string) {
    setSelectedSchemeSlugs((prev) => {
      if (prev.includes(slug)) {
        // Keep at least one scheme selected when matches exist
        if (prev.length <= 1) return prev;
        return prev.filter((s) => s !== slug);
      }
      return [...prev, slug];
    });
    setCopiedChecklist(false);
    setCopyFailed(false);
  }

  function handlePrintPlan() {
    if (typeof window !== "undefined") {
      window.print();
    }
  }

  async function handleCopyChecklist() {
    setCopyFailed(false);
    const copied = await copyTextToClipboard(shareText);
    if (copied) {
      setCopiedChecklist(true);
      window.setTimeout(() => setCopiedChecklist(false), 2500);
    } else {
      setCopyFailed(true);
    }
  }

  function toggleGuide(docId: string) {
    setExpandedGuides((prev) => ({ ...prev, [docId]: !prev[docId] }));
  }

  function handleOpenFactEditor() {
    setDraftFacts(plan.knownFacts.length > 0 ? [...plan.knownFacts] : []);
    setNewFactInput("");
    setEditingFacts(true);
  }

  function handleAddDraftFact() {
    const trimmed = newFactInput.trim();
    if (!trimmed) return;
    setDraftFacts((prev) => [...prev, trimmed].slice(0, 25));
    setNewFactInput("");
  }

  async function handleSubmitEditedFacts() {
    const combined = [
      ...draftFacts.map((f) => f.trim()).filter(Boolean),
      ...(newFactInput.trim() ? [newFactInput.trim()] : []),
    ].slice(0, 25);
    if (combined.length === 0) return;
    await onRecheckFacts(combined);
    setEditingFacts(false);
    setNewFactInput("");
  }

  const printedDateText = formatDateShort(new Date().toISOString(), language);

  return (
    <section
      aria-label={copy.planHeading}
      className="bg-white border border-[#E1E5EC] md-elevation-1 rounded-[28px] overflow-hidden flex flex-col print:border-0 print:rounded-none print:shadow-none print:overflow-visible"
    >
      {/* Print-only Document Header */}
      <div className="hidden print:block pb-4 mb-4 border-b border-[#C4C7C5] space-y-1">
        <h1 className="text-xl font-bold text-[#0B57D0]">
          {copy.printPlanTitle}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#444746] font-mono-tabular">
          <span>
            {copy.printedOn}: {printedDateText}
          </span>
          {activeLocation?.stateName && (
            <span>
              {copy.locationFilter.selectedBadge(
                activeLocation.stateName,
                activeLocation.district,
              )}
            </span>
          )}
          {plan.lastFetchedAt && (
            <span>
              {copy.fetchedOn}: {formatDateShort(plan.lastFetchedAt, language)}
            </span>
          )}
        </div>
        <p className="text-xs font-semibold text-[#1F1F1F] pt-1">
          {copy.potentialMatchDisclaimer} {copy.noSubmissionNotice}
        </p>
      </div>

      {/* Material 3 Panel Header + Primary Tab Row */}
      <div className="pt-5 border-b border-[#E1E5EC] print:hidden">
        <div className="px-5 sm:px-6 pb-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-[#1F1F1F]">
                {copy.planHeading}
              </h2>
              {plan.lastFetchedAt && (
                <p className="text-xs text-[#444746] font-mono-tabular whitespace-nowrap mt-0.5">
                  {copy.fetchedOn}: {formatDateShort(plan.lastFetchedAt, language)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setShareOpen((prev) => !prev)}
                aria-expanded={shareOpen}
                aria-label={copy.shareChecklist.shareBtn}
                className={`min-h-[40px] px-3.5 py-2 rounded-full border text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#0B57D0] ${
                  shareOpen
                    ? "border-transparent bg-[#D3E3FD] text-[#041E49]"
                    : "border-[#747775]/60 bg-white text-[#0B57D0] hover:bg-[#0B57D0]/8"
                }`}
              >
                <Share2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{copy.shareChecklist.shareBtn}</span>
              </button>
              <button
                type="button"
                onClick={handlePrintPlan}
                aria-label={copy.printPlanBtn}
                className="min-h-[40px] px-3.5 py-2 rounded-full border border-[#747775]/60 bg-white text-[#0B57D0] text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 hover:bg-[#0B57D0]/8 transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
              >
                <Printer className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">{copy.printPlanBtn}</span>
              </button>
            </div>
          </div>

          {/* Shareable Eligibility & Chosen Schemes Summary Drawer (M3 Tonal Sheet) */}
          {shareOpen && (
            <div className="rounded-[20px] bg-[#F0F4F9] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#1F1F1F]">
                  {copy.shareChecklist.summaryTitle}
                </p>
                <button
                  type="button"
                  onClick={() => setShareOpen(false)}
                  aria-label="Close share panel"
                  className="min-h-[32px] min-w-[32px] rounded-full text-[#444746] hover:bg-[#1F1F1F]/8 inline-flex items-center justify-center"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              {plan.matches.length > 1 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-[#444746]">
                    {copy.shareChecklist.chooseSchemesLabel}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.matches.map((match) => {
                      const active = selectedSchemeSlugs.includes(match.slug);
                      return (
                        <button
                          key={match.slug}
                          type="button"
                          aria-pressed={active}
                          onClick={() => handleToggleShareScheme(match.slug)}
                          className={`min-h-[34px] px-3 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1.5 border transition-colors ${
                            active
                              ? "bg-[#D3E3FD] border-transparent text-[#041E49]"
                              : "bg-white border-[#C4C7C5] text-[#444746] hover:bg-white/80"
                          }`}
                        >
                          {active && (
                            <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          )}
                          <span className="truncate max-w-[180px]">{match.schemeName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-[11px] font-medium text-[#444746]">
                  {copy.shareChecklist.previewLabel}
                </p>
                <pre className="rounded-2xl bg-white border border-[#E1E5EC] p-3 text-[11px] sm:text-xs font-mono-tabular text-[#1F1F1F] leading-relaxed whitespace-pre-wrap break-words max-h-44 overflow-y-auto select-all">
                  {shareText}
                </pre>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyChecklist()}
                  className="min-h-[40px] px-4 py-2 rounded-full bg-[#0B57D0] text-white text-xs font-medium inline-flex items-center gap-1.5 hover:bg-[#0842A0] active:scale-[0.98] transition-all whitespace-nowrap"
                >
                  {copiedChecklist ? (
                    <>
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{copy.shareChecklist.copiedLabel}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{copy.shareChecklist.copyBtn}</span>
                    </>
                  )}
                </button>
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[40px] px-4 py-2 rounded-full border border-[#747775]/60 bg-white text-[#1F1F1F] text-xs font-medium inline-flex items-center gap-1.5 hover:bg-[#E4ECF7] transition-colors whitespace-nowrap"
                >
                  <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{copy.shareChecklist.whatsappBtn}</span>
                </a>
                <a
                  href={smsUrl}
                  className="min-h-[40px] px-4 py-2 rounded-full border border-[#747775]/60 bg-white text-[#1F1F1F] text-xs font-medium inline-flex items-center gap-1.5 hover:bg-[#E4ECF7] transition-colors whitespace-nowrap"
                >
                  <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{copy.shareChecklist.smsBtn}</span>
                </a>
              </div>

              {copyFailed && (
                <p className="text-xs text-[#7A4F01]">
                  {copy.shareChecklist.copyFailedLabel}
                </p>
              )}

              <p className="text-[11px] text-[#444746] leading-snug">
                {copy.shareChecklist.privacyHint}
              </p>
            </div>
          )}
        </div>

        {/* Authentic Material Design 3 Primary Tabs (Bottom Indicator Bar) */}
        <div
          role="tablist"
          aria-label={copy.planHeading}
          className="grid grid-cols-3 px-2"
        >
          {(
            [
              {
                key: "matches" as const,
                label: copy.tabs.matches,
                count: plan.matches.length,
              },
              {
                key: "documents" as const,
                label: copy.tabs.documents,
                count: plan.documents.length,
              },
              {
                key: "nextStep" as const,
                label: copy.tabs.nextStep,
                count: null,
              },
            ]
          ).map((tab) => {
            const selected = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onTabChange(tab.key)}
                className={`relative min-h-[48px] px-2.5 py-2.5 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap truncate hover:bg-[#0B57D0]/6 rounded-t-xl focus-visible:outline-2 focus-visible:outline-[#0B57D0] ${
                  selected ? "text-[#0B57D0]" : "text-[#444746] hover:text-[#1F1F1F]"
                }`}
              >
                <span>
                  {tab.label}
                  {tab.count !== null && tab.count > 0 ? (
                    <span className="font-mono-tabular"> ({tab.count})</span>
                  ) : (
                    ""
                  )}
                </span>
                {selected && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-4 right-4 h-[3px] rounded-t-full bg-[#0B57D0]"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panel Body */}
      <div className="p-5 sm:p-6 space-y-5 print:p-0 print:space-y-6">
        {/* TAB 1: MATCHES */}
        <div
          className={
            activeTab === "matches"
              ? "space-y-5"
              : "hidden print:block space-y-5"
          }
        >
          <h2 className="hidden print:block text-base font-bold text-[#1F1F1F] pb-1.5 border-b border-[#C4C7C5]">
            {copy.tabs.matches}
            {plan.matches.length > 0 ? ` (${plan.matches.length})` : ""}
          </h2>

          {/* Mandatory Potential Match Disclaimer (M3 Tonal Callout) */}
          <div className="rounded-[16px] bg-[#F0F4F9] px-4 py-3 text-xs text-[#444746] leading-relaxed flex items-start gap-2.5 print:hidden">
            <ShieldCheck
              className="w-4 h-4 text-[#0B57D0] mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold text-[#1F1F1F]">
                {copy.potentialMatchDisclaimer}
              </p>
              <p className="mt-0.5 text-[#444746]">{copy.noSubmissionNotice}</p>
            </div>
          </div>

          {plan.sourceFetchStatus === "unavailable" && plan.sourceFetchNotice && (
            <div className="rounded-[16px] bg-[#FFF4D6] px-4 py-3.5 text-sm text-[#422006] space-y-1">
              <p className="font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {language === "hi"
                    ? "myScheme से लाइव नियम उपलब्ध नहीं हो सके"
                    : "Live myScheme criteria unavailable"}
                </span>
              </p>
              <p className="text-xs leading-relaxed">
                {plan.sourceFetchNotice}
              </p>
            </div>
          )}

          {plan.matches.length === 0 ? (
            <div className="py-10 text-center space-y-2.5">
              <div className="w-12 h-12 rounded-2xl bg-[#F0F4F9] text-[#444746] flex items-center justify-center mx-auto">
                <FileText className="w-6 h-6" aria-hidden="true" />
              </div>
              <p className="text-sm text-[#444746] max-w-sm mx-auto leading-relaxed">
                {copy.emptyMatches}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E1E5EC]">
              {plan.matches.map((match) => (
                <article
                  key={match.slug}
                  className="py-5 first:pt-0 last:pb-0 space-y-3.5 print:break-inside-avoid"
                >
                  {/* Title + Clean Unboxed Inline Metadata */}
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-[#1F1F1F] leading-snug">
                      {match.schemeName}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#444746]">
                      <span>{match.category}</span>
                      <span aria-hidden="true">·</span>
                      {renderConfidenceText(match.confidence, language)}
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">
                        {copy.fetchedOn} {formatDateShort(match.fetchedAt, language)}
                      </span>
                    </div>
                  </div>

                  {/* Structured Explainability Fields */}
                  <dl className="space-y-2.5 text-sm">
                    <div>
                      <dt className="text-xs font-medium text-[#444746]">
                        {copy.whyItMayFit}
                      </dt>
                      <dd className="text-[#1F1F1F] mt-0.5 leading-relaxed">
                        {match.whyItMayFit}
                      </dd>
                    </div>

                    {match.whatToVerify.length > 0 && (
                      <div>
                        <dt className="text-xs font-medium text-[#444746]">
                          {copy.whatToVerify}
                        </dt>
                        <dd className="mt-1">
                          <ul className="space-y-1 text-[#1F1F1F] list-disc pl-4">
                            {match.whatToVerify.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}

                    {match.whatIsMissing.length > 0 && (
                      <div>
                        <dt className="text-xs font-semibold text-[#7A4F01]">
                          {copy.whatIsMissing}
                        </dt>
                        <dd className="mt-1">
                          <ul className="space-y-1 text-[#422006] list-disc pl-4">
                            {match.whatIsMissing.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    )}

                    <div>
                      <dt className="text-xs font-medium text-[#444746]">
                        {copy.nextOfficialAction}
                      </dt>
                      <dd className="text-[#1F1F1F] font-medium mt-0.5 leading-relaxed">
                        {match.nextOfficialAction}
                      </dd>
                    </div>
                  </dl>

                  {/* Official Links (M3 Filled + Text Buttons; strict https check) */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 print:hidden">
                    {isSafeHttpsUrl(match.officialChannelUrl) && (
                      <a
                        href={match.officialChannelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[42px] inline-flex items-center gap-2 px-5 py-2 rounded-full bg-[#0B57D0] text-white text-xs sm:text-sm font-medium hover:bg-[#0842A0] transition-colors whitespace-nowrap"
                      >
                        <span>{copy.openOfficialChannel}</span>
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      </a>
                    )}
                    {isSafeHttpsUrl(match.sourceUrl) && (
                      <a
                        href={match.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs sm:text-sm font-medium text-[#0B57D0] hover:bg-[#0B57D0]/8 transition-colors whitespace-nowrap"
                      >
                        <span>{copy.openOfficialSource}</span>
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </div>

                  {/* Print-readable Official URLs */}
                  <div className="hidden print:block space-y-1 pt-1 text-xs text-[#444746] font-mono-tabular break-all">
                    {isSafeHttpsUrl(match.officialChannelUrl) && (
                      <p>
                        <span className="font-sans font-semibold text-[#1F1F1F]">
                          {copy.openOfficialChannel}:{" "}
                        </span>
                        {match.officialChannelUrl}
                      </p>
                    )}
                    {isSafeHttpsUrl(match.sourceUrl) && (
                      <p>
                        <span className="font-sans font-semibold text-[#1F1F1F]">
                          {copy.openOfficialSource}:{" "}
                        </span>
                        {match.sourceUrl}
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* Human Handoff Prompt when Low Confidence / Ambiguous (M3 Warm Tonal Card) */}
          {plan.showHumanHandoff && (
            <div className="rounded-[20px] bg-[#FFF4D6] p-4 space-y-3 print:hidden">
              <div className="flex items-start gap-2.5">
                <PhoneCall
                  className="w-4 h-4 text-[#7A4F01] mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#422006]">
                    {copy.humanHandoffHeading}
                  </p>
                  {plan.humanHandoffReason && (
                    <p className="text-xs text-[#422006]/90 leading-relaxed">
                      {plan.humanHandoffReason}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isOffline}
                  onClick={onOpenHelpCentreMap}
                  className="min-h-[42px] px-4 py-2 rounded-full bg-[#0B57D0] text-white text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 hover:bg-[#0842A0] transition-colors disabled:opacity-50"
                >
                  <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{copy.helpCentreMap.openMapBtn}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onTabChange("nextStep")}
                  className="min-h-[42px] px-4 py-2 rounded-full bg-white text-[#422006] text-xs sm:text-sm font-medium hover:bg-white/80 transition-colors"
                >
                  {copy.humanHandoffCta}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* TAB 2: DOCUMENTS (Interactive M3 Checklist + "How to get this") */}
        <div
          className={
            activeTab === "documents"
              ? "space-y-5 print:pt-4 print:border-t print:border-[#C4C7C5]"
              : "hidden print:block space-y-4 print:pt-4 print:border-t print:border-[#C4C7C5]"
          }
        >
          <h2 className="hidden print:block text-base font-bold text-[#1F1F1F] pb-1.5 border-b border-[#C4C7C5]">
            {copy.tabs.documents}
            {plan.documents.length > 0 ? ` (${plan.documents.length})` : ""}
          </h2>

          {/* Document Photo Action Bar (M3 Filled Button) */}
          <div className="space-y-2.5 print:hidden">
            <button
              type="button"
              disabled={isOffline}
              onClick={onRequestDocumentCheck}
              className="w-full min-h-[48px] px-5 py-3 rounded-full bg-[#0B57D0] text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-[#0842A0] active:scale-[0.99] transition-all disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0]"
            >
              <Camera className="w-4 h-4" aria-hidden="true" />
              <span>{copy.checkDocumentBtn}</span>
            </button>

            {documentConsentGranted && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#444746] pt-1">
                <span className="inline-flex items-center gap-1.5 text-[#146C2E] font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{copy.consentActiveLabel}</span>
                </span>
                <button
                  type="button"
                  onClick={onRevokeConsent}
                  className="min-h-[36px] px-2.5 rounded-full inline-flex items-center gap-1 text-[#444746] hover:text-[#B3261E] hover:bg-[#B3261E]/8 font-medium transition-colors"
                >
                  <ShieldOff className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{copy.revokeConsentBtn}</span>
                </button>
              </div>
            )}
          </div>

          {plan.documents.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-[#444746] font-mono-tabular">
              <span className="text-[#146C2E] font-semibold">
                {copy.docStatuses.ready}: {readyCount}
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-[#7A4F01] font-semibold">
                {copy.docStatuses.missing} / {copy.docStatuses.needs_verification}:{" "}
                {missingCount}
              </span>
            </div>
          )}

          {plan.documents.length === 0 ? (
            <div className="py-10 text-center space-y-2.5">
              <div className="w-12 h-12 rounded-2xl bg-[#F0F4F9] text-[#444746] flex items-center justify-center mx-auto">
                <FileText className="w-6 h-6" aria-hidden="true" />
              </div>
              <p className="text-sm text-[#444746] max-w-sm mx-auto leading-relaxed">
                {copy.emptyDocs}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[#E1E5EC]">
              {plan.documents.map((doc) => {
                const isPhotoVerified = doc.status === "ready";
                const isManualChecked = manualReadySet.has(doc.id);
                const isReady = isPhotoVerified || isManualChecked;
                const isMissing = !isReady && doc.status === "missing";
                const guideOpen = Boolean(expandedGuides[doc.id]);
                const guide = getDocumentGuide(
                  doc.documentType,
                  language,
                  activeLocation,
                );

                return (
                  <li
                    key={doc.id}
                    className="py-4 first:pt-0 last:pb-0 space-y-2 print:break-inside-avoid"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        {/* M3 Interactive Checkbox (44px tap target) */}
                        {!isPhotoVerified ? (
                          <button
                            type="button"
                            onClick={() => onToggleManualDocReady(doc.id)}
                            aria-pressed={isManualChecked}
                            aria-label={
                              isManualChecked
                                ? copy.documentChecklist.markMissing
                                : copy.documentChecklist.markReady
                            }
                            className="min-h-[40px] min-w-[40px] -ml-2 -mt-1.5 rounded-full inline-flex items-center justify-center text-[#444746] hover:text-[#0B57D0] hover:bg-[#0B57D0]/8 transition-colors shrink-0 print:hidden"
                          >
                            {isManualChecked ? (
                              <CheckSquare
                                className="w-5 h-5 text-[#146C2E]"
                                aria-hidden="true"
                              />
                            ) : (
                              <Square className="w-5 h-5" aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          <CheckCircle2
                            className="w-4 h-4 text-[#146C2E] mt-0.5 shrink-0 print:hidden"
                            aria-hidden="true"
                          />
                        )}

                        <span className="hidden print:inline-flex mt-0.5 shrink-0">
                          {isReady ? (
                            <CheckCircle2
                              className="w-4 h-4 text-[#146C2E]"
                              aria-hidden="true"
                            />
                          ) : isMissing ? (
                            <AlertTriangle
                              className="w-4 h-4 text-[#7A4F01]"
                              aria-hidden="true"
                            />
                          ) : (
                            <CircleDashed
                              className="w-4 h-4 text-[#444746]"
                              aria-hidden="true"
                            />
                          )}
                        </span>

                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#1F1F1F]">
                            {doc.label}
                          </p>
                          <p className="text-xs text-[#444746] mt-0.5 leading-relaxed">
                            {doc.detail}
                          </p>
                          {doc.maskedIdentifier && (
                            <p className="text-xs font-mono-tabular text-[#1F1F1F] mt-1">
                              ID: {doc.maskedIdentifier} ·{" "}
                              {copy.documentChecklist.photoChecked}
                            </p>
                          )}
                          {!isPhotoVerified && isManualChecked && (
                            <p className="text-xs text-[#146C2E] font-medium mt-0.5">
                              {copy.documentChecklist.markedByYou}
                            </p>
                          )}
                          {doc.requiredForSchemes.length > 0 && (
                            <p className="text-xs text-[#444746] mt-1">
                              {doc.requiredForSchemes.join(" · ")}
                            </p>
                          )}

                          {/* Expandable "How to get this" M3 Text Trigger */}
                          <div className="mt-1.5 print:hidden">
                            <button
                              type="button"
                              onClick={() => toggleGuide(doc.id)}
                              aria-expanded={guideOpen}
                              className="min-h-[34px] -ml-2 px-2.5 rounded-full inline-flex items-center gap-1 text-xs font-medium text-[#0B57D0] hover:bg-[#0B57D0]/8 transition-colors"
                            >
                              <span>
                                {guideOpen
                                  ? copy.documentChecklist.hideGuideBtn
                                  : copy.documentChecklist.howToGetBtn}
                              </span>
                              {guideOpen ? (
                                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-xs font-semibold shrink-0 ${
                          isReady
                            ? "text-[#146C2E]"
                            : isMissing
                              ? "text-[#7A4F01]"
                              : "text-[#444746]"
                        }`}
                      >
                        {isReady ? copy.docStatuses.ready : copy.docStatuses[doc.status]}
                      </span>
                    </div>

                    {guideOpen && (
                      <div className="ml-0 sm:ml-7 rounded-[16px] bg-[#F0F4F9] p-3.5 space-y-2 text-xs text-[#1F1F1F]">
                        <ol className="list-decimal pl-4 space-y-1 leading-relaxed">
                          {guide.steps.map((step, idx) => (
                            <li key={idx}>{step}</li>
                          ))}
                        </ol>
                        {isSafeHttpsUrl(guide.officialPortalUrl) && (
                          <a
                            href={guide.officialPortalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-[#0B57D0] hover:underline pt-0.5"
                          >
                            <span>{guide.officialPortalLabel}</span>
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* TAB 3: NEXT STEP, WHAT-IF FACT EDITOR & HUMAN HANDOFF */}
        <div
          className={
            activeTab === "nextStep"
              ? "space-y-5 print:pt-4 print:border-t print:border-[#C4C7C5]"
              : "hidden print:block space-y-4 print:pt-4 print:border-t print:border-[#C4C7C5]"
          }
        >
          <h2 className="hidden print:block text-base font-bold text-[#1F1F1F] pb-1.5 border-b border-[#C4C7C5]">
            {copy.tabs.nextStep}
          </h2>

          <div className="rounded-[20px] bg-[#F0F4F9] p-4 space-y-2">
            <h3 className="text-sm font-semibold text-[#1F1F1F]">
              {copy.nextOfficialAction}
            </h3>
            <p className="text-sm text-[#1F1F1F] leading-relaxed">
              {plan.nextStepSummary}
            </p>
            <p className="text-xs text-[#444746] pt-1">
              {copy.noSubmissionNotice}
            </p>
          </div>

          {/* Known Facts + Interactive "What-If" Fact Editor */}
          {(plan.knownFacts.length > 0 ||
            plan.unknownFacts.length > 0 ||
            canRecheckFacts) && (
            <div className="grid grid-cols-1 gap-4 pt-1">
              {(plan.knownFacts.length > 0 || canRecheckFacts) && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-medium text-[#444746]">
                      {copy.knownFactsHeading}
                    </h4>
                    {canRecheckFacts && !editingFacts && (
                      <button
                        type="button"
                        disabled={isOffline || recheckingFacts}
                        onClick={handleOpenFactEditor}
                        className="min-h-[36px] px-3.5 py-1.5 rounded-full border border-[#747775]/60 bg-white text-xs font-medium text-[#0B57D0] inline-flex items-center gap-1.5 hover:bg-[#0B57D0]/8 transition-colors disabled:opacity-50 print:hidden"
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{copy.whatIfEditor.editBtn}</span>
                      </button>
                    )}
                  </div>

                  {editingFacts ? (
                    <div className="rounded-[20px] bg-[#F0F4F9] p-4 space-y-3 print:hidden">
                      <div>
                        <p className="text-xs font-semibold text-[#1F1F1F]">
                          {copy.whatIfEditor.heading}
                        </p>
                        <p className="text-xs text-[#444746] mt-0.5 leading-snug">
                          {copy.whatIfEditor.hint}
                        </p>
                      </div>

                      <div className="space-y-2">
                        {draftFacts.map((fact, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={fact}
                              disabled={recheckingFacts}
                              onChange={(e) => {
                                const next = [...draftFacts];
                                next[idx] = e.target.value;
                                setDraftFacts(next);
                              }}
                              className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-white border border-[#C4C7C5] text-xs sm:text-sm text-[#1F1F1F] focus:outline-none focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/15"
                            />
                            <button
                              type="button"
                              disabled={recheckingFacts}
                              aria-label={copy.whatIfEditor.removeFactAria}
                              onClick={() =>
                                setDraftFacts((prev) =>
                                  prev.filter((_, i) => i !== idx),
                                )
                              }
                              className="min-h-[42px] min-w-[42px] rounded-full text-[#444746] hover:text-[#B3261E] hover:bg-[#B3261E]/8 inline-flex items-center justify-center shrink-0 transition-colors"
                            >
                              <X className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        ))}

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newFactInput}
                            disabled={recheckingFacts}
                            onChange={(e) => setNewFactInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddDraftFact();
                              }
                            }}
                            placeholder={copy.whatIfEditor.addPlaceholder}
                            className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-white border border-[#C4C7C5] text-xs sm:text-sm text-[#1F1F1F] placeholder:text-[#747775] focus:outline-none focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/15"
                          />
                          <button
                            type="button"
                            disabled={recheckingFacts || !newFactInput.trim()}
                            onClick={handleAddDraftFact}
                            className="min-h-[42px] px-3.5 rounded-full border border-[#747775]/60 bg-white text-xs font-medium text-[#0B57D0] inline-flex items-center gap-1 hover:bg-[#0B57D0]/8 disabled:opacity-45 whitespace-nowrap transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{copy.whatIfEditor.addBtn}</span>
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={
                            isOffline ||
                            recheckingFacts ||
                            (draftFacts.filter((f) => f.trim()).length === 0 &&
                              !newFactInput.trim())
                          }
                          onClick={() => void handleSubmitEditedFacts()}
                          className="min-h-[42px] px-5 py-2 rounded-full bg-[#0B57D0] text-white text-xs sm:text-sm font-medium inline-flex items-center gap-2 hover:bg-[#0842A0] transition-colors disabled:opacity-45"
                        >
                          {recheckingFacts && (
                            <Loader2
                              className="w-4 h-4 animate-spin"
                              aria-hidden="true"
                            />
                          )}
                          <span>
                            {recheckingFacts
                              ? copy.whatIfEditor.recheckingBtn
                              : copy.whatIfEditor.recheckBtn}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={recheckingFacts}
                          onClick={() => setEditingFacts(false)}
                          className="min-h-[42px] px-4 py-2 rounded-full text-[#0B57D0] text-xs sm:text-sm font-medium hover:bg-[#0B57D0]/8 transition-colors"
                        >
                          {copy.whatIfEditor.cancelBtn}
                        </button>
                      </div>
                    </div>
                  ) : plan.knownFacts.length > 0 ? (
                    <ul className="space-y-1 text-sm text-[#1F1F1F] list-disc pl-4">
                      {plan.knownFacts.map((fact, idx) => (
                        <li key={idx}>{fact}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}

              {plan.unknownFacts.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-[#7A4F01]">
                    {copy.unknownFactsHeading}
                  </h4>
                  <ul className="space-y-1 text-sm text-[#422006] list-disc pl-4">
                    {plan.unknownFacts.map((fact, idx) => (
                      <li key={idx}>{fact}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Always-available Official Human Handoff Channels + Map Locator */}
          <div className="pt-4 border-t border-[#E1E5EC] space-y-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2.5">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-[#1F1F1F] flex items-center gap-2">
                  <PhoneCall className="w-4 h-4 text-[#0B57D0]" aria-hidden="true" />
                  <span>{copy.humanHandoffHeading}</span>
                </h3>
                {plan.humanHandoffReason && (
                  <p className="text-xs text-[#7A4F01] leading-relaxed">
                    {plan.humanHandoffReason}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={isOffline}
                onClick={onOpenHelpCentreMap}
                className="min-h-[42px] px-4 py-2 rounded-full bg-[#D3E3FD] text-[#041E49] text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 hover:bg-[#C2D8FC] transition-colors disabled:opacity-50 whitespace-nowrap print:hidden"
              >
                <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{copy.helpCentreMap.openMapBtn}</span>
              </button>
            </div>

            <div className="space-y-2">
              {plan.handoffChannels.map((channel, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-[16px] bg-[#F0F4F9]/80 space-y-1"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1F1F1F]">
                        {channel.title}
                      </p>
                      <p className="text-xs text-[#444746] mt-0.5 leading-relaxed">
                        {channel.description}
                      </p>
                    </div>
                    {channel.isUrl && isSafeHttpsUrl(channel.contactOrUrl) ? (
                      <>
                        <a
                          href={channel.contactOrUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[38px] px-3 rounded-full inline-flex items-center gap-1 text-xs font-medium text-[#0B57D0] hover:bg-[#0B57D0]/8 whitespace-nowrap shrink-0 print:hidden transition-colors"
                        >
                          <span>{language === "hi" ? "खोलें" : "Open"}</span>
                          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        </a>
                        <span className="hidden print:inline text-xs font-mono-tabular text-[#444746] break-all">
                          {channel.contactOrUrl}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm font-mono-tabular font-semibold text-[#0B57D0] whitespace-nowrap shrink-0">
                        {channel.contactOrUrl}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
