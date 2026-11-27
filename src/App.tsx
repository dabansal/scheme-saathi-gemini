import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  Briefcase,
  Camera,
  Check,
  ChevronDown,
  Globe,
  GraduationCap,
  HeartPulse,
  History,
  Landmark,
  Loader2,
  MapPin,
  RotateCcw,
  Send,
  ShieldCheck,
  Sprout,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { INDIA_STATES, findIndiaStateByCode } from "../shared/indiaStates.ts";
import { LANGUAGE_META, SUPPORTED_LANGUAGES } from "../shared/models.ts";
import type {
  ChatMessage,
  CitizenLocation,
  DocumentTypeKey,
  Language,
  PlanState,
  SessionSnapshot,
} from "../shared/models.ts";
import {
  analyzeDocumentPhoto,
  ApiClientError,
  recheckCitizenFacts,
  resetCitizenSession,
  restoreCitizenSession,
  sendChatTurn,
  updateSessionConsent,
} from "./api.ts";
import { ConsentModal } from "./components/ConsentModal.tsx";
import { DocumentUploadSheet } from "./components/DocumentUploadSheet.tsx";
import { EvalPage } from "./components/EvalPage.tsx";
import { HelpCentreLocatorModal } from "./components/HelpCentreLocatorModal.tsx";
import { PlanPanel } from "./components/PlanPanel.tsx";
import type { PlanTab } from "./components/PlanPanel.tsx";
import { UI_COPY } from "./i18n.ts";
import { useNetworkStatus } from "./hooks/useNetworkStatus.ts";
import {
  clearSavedSessionProgress,
  isSessionUnfinished,
  loadSavedSessionProgress,
  saveSessionProgress,
} from "./lib/sessionStorage.ts";
import type { SavedSessionData } from "./lib/sessionStorage.ts";

function buildDefaultPlan(
  language: Language,
  location?: CitizenLocation,
): PlanState {
  const isHi = language === "hi";
  const channels = [
    {
      title: isHi
        ? "नज़दीकी कॉमन सर्विस सेंटर (CSC)"
        : "Nearest Common Service Centre (CSC)",
      description: isHi
        ? "दस्तावेज़ जांच और आधिकारिक आवेदन सहायता के लिए अपने नज़दीकी CSC केंद्र खोजें।"
        : "Locate your nearest government-authorized CSC kiosk for document help and official application.",
      contactOrUrl: "https://locator.csccloud.in/",
      isUrl: true,
    },
    {
      title: isHi ? "आधिकारिक myScheme पोर्टल" : "Official myScheme Portal",
      description: isHi
        ? "भारत सरकार के आधिकारिक पोर्टल पर पात्रता और नियम जांचें।"
        : "Verify official rules and application channels directly on the Government of India portal.",
      contactOrUrl: "https://www.myscheme.gov.in/",
      isUrl: true,
    },
  ];

  const stateInfo = location ? findIndiaStateByCode(location.stateCode) : undefined;
  if (stateInfo?.portalUrl && stateInfo.portalTitleEn) {
    channels.push({
      title:
        isHi && stateInfo.portalTitleHi
          ? stateInfo.portalTitleHi
          : stateInfo.portalTitleEn,
      description: isHi
        ? `${stateInfo.nameHi} के प्रमाण-पत्र (${stateInfo.landRecordTermHi}) और राज्य योजनाओं के लिए आधिकारिक पोर्टल।`
        : `Official ${stateInfo.nameEn} portal for state certificates (${stateInfo.landRecordTermEn}) and state-level schemes.`,
      contactOrUrl: stateInfo.portalUrl,
      isUrl: true,
    });
  }

  return {
    journey: "other",
    location,
    profileCompletenessScore: 0,
    profileCompletenessPercent: 0,
    knownFacts: [],
    unknownFacts: [],
    matches: [],
    documents: [],
    nextStepSummary: isHi
      ? "अपनी स्थिति बताएं (जैसे: खेती, पढ़ाई, स्वास्थ्य या छोटा व्यवसाय) ताकि हम आधिकारिक myScheme नियमों से आपका एक्शन प्लान बना सकें।"
      : "Describe your situation (farming, education, health, or livelihood) to build a verified action plan from official myScheme criteria.",
    showHumanHandoff: false,
    handoffChannels: channels,
    sourceFetchStatus: "idle",
  };
}

const QUICK_START_ICONS = {
  farmer: Sprout,
  student: GraduationCap,
  health: HeartPulse,
  livelihood: Briefcase,
} as const;

export default function App() {
  const isEvalRoute =
    typeof window !== "undefined" &&
    window.location.pathname.replace(/\/+$/, "") === "/eval";

  if (isEvalRoute) {
    return <EvalPage />;
  }

  return <CitizenWorkspace />;
}

function CitizenWorkspace() {
  const [language, setLanguage] = useState<Language>("en");
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<PlanTab>("matches");
  const [consentModalOpen, setConsentModalOpen] = useState(false);
  const [uploadSheetOpen, setUploadSheetOpen] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [analyzingDoc, setAnalyzingDoc] = useState(false);
  const [errorBanner, setErrorBanner] = useState<{
    isDemoLimit: boolean;
    message: string;
  } | null>(null);
  const [savedProgress, setSavedProgress] = useState<SavedSessionData | null>(() =>
    loadSavedSessionProgress(),
  );
  const [resumingSession, setResumingSession] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [savePromptDismissed, setSavePromptDismissed] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [location, setLocation] = useState<CitizenLocation | undefined>(undefined);
  const [manualReadyDocIds, setManualReadyDocIds] = useState<string[]>([]);
  const [recheckingFacts, setRecheckingFacts] = useState(false);
  const [helpCentreMapOpen, setHelpCentreMapOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const langMenuRef = useRef<HTMLDivElement | null>(null);
  const { isOnline, justReconnected } = useNetworkStatus();
  const copy = UI_COPY[language];
  const basePlan = session?.plan ?? buildDefaultPlan(language, location);
  const statePortalUrls = new Set(
    INDIA_STATES.map((st) => st.portalUrl).filter((u): u is string => Boolean(u)),
  );
  const selectedStateInfo = location
    ? findIndiaStateByCode(location.stateCode)
    : undefined;
  const syncedHandoffChannels = session?.plan
    ? (() => {
        const nonStateChannels = basePlan.handoffChannels.filter(
          (ch) => !statePortalUrls.has(ch.contactOrUrl),
        );
        if (selectedStateInfo?.portalUrl && selectedStateInfo.portalTitleEn) {
          const isHi = language === "hi";
          return [
            ...nonStateChannels,
            {
              title:
                isHi && selectedStateInfo.portalTitleHi
                  ? selectedStateInfo.portalTitleHi
                  : selectedStateInfo.portalTitleEn,
              description: isHi
                ? `${selectedStateInfo.nameHi} के प्रमाण-पत्र (${selectedStateInfo.landRecordTermHi}) और राज्य योजनाओं के लिए आधिकारिक पोर्टल।`
                : `Official ${selectedStateInfo.nameEn} portal for state certificates (${selectedStateInfo.landRecordTermEn}) and state-level schemes.`,
              contactOrUrl: selectedStateInfo.portalUrl,
              isUrl: true,
            },
          ];
        }
        return nonStateChannels;
      })()
    : basePlan.handoffChannels;

  const currentPlan: PlanState = session?.plan
    ? {
        ...basePlan,
        location: location ?? basePlan.location,
        handoffChannels: syncedHandoffChannels,
      }
    : basePlan;
  const sessionUnfinished = isSessionUnfinished(session, messages);

  useEffect(() => {
    if (messages.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages, sending]);

  useEffect(() => {
    if (!langMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (
        langMenuRef.current &&
        !langMenuRef.current.contains(event.target as Node)
      ) {
        setLangMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLangMenuOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [langMenuOpen]);

  useEffect(() => {
    if (!hasUnsavedChanges || !sessionUnfinished) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedChanges, sessionUnfinished]);

  async function ensureSessionId(): Promise<string> {
    if (session?.sessionId) return session.sessionId;
    const res = await resetCitizenSession({ language });
    setSession(res.session);
    return res.session.sessionId;
  }

  async function handleSendText(textToSend: string) {
    const trimmed = textToSend.trim();
    if (!trimmed || sending || !isOnline) return;

    setErrorBanner(null);
    setInputText("");
    const citizenMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: "citizen",
      text: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, citizenMsg]);
    setSending(true);

    try {
      const response = await sendChatTurn({
        sessionId: session?.sessionId,
        message: trimmed,
        language,
        location,
      });
      setSession(response.session);
      setMessages((prev) => [...prev, response.assistantMessage]);
      setHasUnsavedChanges(true);
      setSavePromptDismissed(false);
      setSavedFeedback(false);
      if (response.session.plan.matches.length > 0 && activeTab !== "matches") {
        setActiveTab("matches");
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "DEMO_LIMIT_REACHED") {
        setErrorBanner({
          isDemoLimit: true,
          message: language === "hi" && err.messageHi ? err.messageHi : err.message,
        });
      } else {
        setErrorBanner({
          isDemoLimit: false,
          message:
            err instanceof Error
              ? err.message
              : language === "hi"
                ? "अनुरोध पूरा करने में समस्या आई। कृपया पुनः प्रयास करें।"
                : "Unable to complete your request. Please try again.",
        });
      }
    } finally {
      setSending(false);
    }
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    void handleSendText(inputText);
  }

  async function handleResetSession() {
    setErrorBanner(null);
    setMessages([]);
    setActiveTab("matches");
    setConsentModalOpen(false);
    setUploadSheetOpen(false);
    setHasUnsavedChanges(false);
    setSavePromptDismissed(false);
    setSavedFeedback(false);
    setManualReadyDocIds([]);
    setSavedProgress(loadSavedSessionProgress());
    if (!isOnline) {
      setSession(null);
      return;
    }
    try {
      const res = await resetCitizenSession({
        sessionId: session?.sessionId,
        language,
      });
      setSession(res.session);
    } catch {
      setSession(null);
    }
  }

  function handleStateChange(stateCode: string) {
    if (!stateCode) {
      setLocation(undefined);
      return;
    }
    const info = findIndiaStateByCode(stateCode);
    if (!info) return;
    setLocation((prev) => ({
      stateCode: info.code,
      stateName: info.nameEn,
      district: prev?.stateCode === info.code ? prev.district : undefined,
    }));
    if (session && messages.length > 0) {
      setHasUnsavedChanges(true);
      setSavedFeedback(false);
    }
  }

  function handleDistrictChange(districtValue: string) {
    setLocation((prev) =>
      prev
        ? {
            ...prev,
            district: districtValue.slice(0, 80) || undefined,
          }
        : prev,
    );
    if (session && messages.length > 0) {
      setHasUnsavedChanges(true);
      setSavedFeedback(false);
    }
  }

  function handleToggleManualDocReady(docId: string) {
    setManualReadyDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId],
    );
    if (session && messages.length > 0) {
      setHasUnsavedChanges(true);
      setSavedFeedback(false);
    }
  }

  async function handleRecheckFacts(editedFacts: string[]) {
    if (!session?.sessionId || !isOnline || recheckingFacts) return;
    setRecheckingFacts(true);
    setErrorBanner(null);
    try {
      const response = await recheckCitizenFacts({
        sessionId: session.sessionId,
        knownFacts: editedFacts,
        location,
        language,
      });
      setSession(response.session);
      setMessages((prev) => [...prev, response.assistantMessage]);
      setHasUnsavedChanges(true);
      setSavePromptDismissed(false);
      setSavedFeedback(false);
      setActiveTab("matches");
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "DEMO_LIMIT_REACHED") {
        setErrorBanner({
          isDemoLimit: true,
          message: language === "hi" && err.messageHi ? err.messageHi : err.message,
        });
      } else {
        setErrorBanner({
          isDemoLimit: false,
          message:
            err instanceof Error
              ? err.message
              : language === "hi"
                ? "पात्रता फिर से जांचने में समस्या आई। कृपया पुनः प्रयास करें।"
                : "Unable to re-check eligibility. Please try again.",
        });
      }
    } finally {
      setRecheckingFacts(false);
    }
  }

  function handleSaveProgress() {
    if (!session || messages.length === 0) return;
    const saved = saveSessionProgress({
      language,
      activeTab,
      location,
      manualReadyDocIds,
      session,
      messages,
    });
    if (saved) {
      setSavedProgress(saved);
      setHasUnsavedChanges(false);
      setSavePromptDismissed(true);
      setSavedFeedback(true);
    }
  }

  function handleDiscardSaved() {
    clearSavedSessionProgress();
    setSavedProgress(null);
    setSavedFeedback(false);
  }

  async function handleResumeSession() {
    if (!savedProgress || resumingSession) return;
    setErrorBanner(null);
    const restoredLocation =
      savedProgress.location ?? savedProgress.session.plan.location;
    const restoredManualDocs = savedProgress.manualReadyDocIds ?? [];

    if (!isOnline) {
      setLanguage(savedProgress.language);
      setLocation(restoredLocation);
      setManualReadyDocIds(restoredManualDocs);
      setSession({
        ...savedProgress.session,
        documentConsentGranted: false,
      });
      setMessages(savedProgress.messages);
      setActiveTab(savedProgress.activeTab);
      setHasUnsavedChanges(false);
      setSavePromptDismissed(true);
      setSavedFeedback(true);
      return;
    }
    setResumingSession(true);
    try {
      const res = await restoreCitizenSession({
        sessionId: savedProgress.session.sessionId,
        language: savedProgress.language,
        questionCount: savedProgress.session.questionCount,
        plan: {
          ...savedProgress.session.plan,
          location: restoredLocation,
        },
      });
      setLanguage(savedProgress.language);
      setLocation(restoredLocation);
      setManualReadyDocIds(restoredManualDocs);
      setSession(res.session);
      setMessages(savedProgress.messages);
      setActiveTab(savedProgress.activeTab);
      setHasUnsavedChanges(false);
      setSavePromptDismissed(true);
      setSavedFeedback(true);
    } catch {
      setLanguage(savedProgress.language);
      setLocation(restoredLocation);
      setManualReadyDocIds(restoredManualDocs);
      setSession({
        ...savedProgress.session,
        documentConsentGranted: false,
      });
      setMessages(savedProgress.messages);
      setActiveTab(savedProgress.activeTab);
      setHasUnsavedChanges(false);
      setSavePromptDismissed(true);
      setSavedFeedback(true);
    } finally {
      setResumingSession(false);
    }
  }

  function formatSavedAt(iso: string): string {
    try {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "";
      return date.toLocaleString(LANGUAGE_META[language].locale, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function handleOpenDocumentFlow() {
    if (!isOnline) return;
    setErrorBanner(null);
    if (session?.documentConsentGranted) {
      setUploadSheetOpen(true);
    } else {
      setConsentModalOpen(true);
    }
  }

  async function handleGrantConsent() {
    if (!isOnline) return;
    setConsentBusy(true);
    setErrorBanner(null);
    try {
      const sid = await ensureSessionId();
      const res = await updateSessionConsent({
        sessionId: sid,
        granted: true,
        language,
      });
      setSession(res.session);
      setConsentModalOpen(false);
      setUploadSheetOpen(true);
    } catch (err) {
      setErrorBanner({
        isDemoLimit: false,
        message: err instanceof Error ? err.message : "Could not record consent.",
      });
    } finally {
      setConsentBusy(false);
    }
  }

  async function handleRevokeConsent() {
    if (!session?.sessionId) return;
    if (!isOnline) {
      setSession({
        ...session,
        documentConsentGranted: false,
      });
      setUploadSheetOpen(false);
      return;
    }
    setConsentBusy(true);
    try {
      const res = await updateSessionConsent({
        sessionId: session.sessionId,
        granted: false,
        language,
      });
      setSession(res.session);
      setUploadSheetOpen(false);
    } finally {
      setConsentBusy(false);
    }
  }

  async function handleUploadDocument(params: {
    claimedType: DocumentTypeKey;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    imageBase64: string;
  }) {
    if (!isOnline) return;
    setAnalyzingDoc(true);
    setErrorBanner(null);
    try {
      const sid = await ensureSessionId();
      const res = await analyzeDocumentPhoto({
        sessionId: sid,
        claimedType: params.claimedType,
        mimeType: params.mimeType,
        imageBase64: params.imageBase64,
        language,
      });
      setSession(res.session);
      setMessages((prev) => [...prev, res.assistantMessage]);
      setHasUnsavedChanges(true);
      setSavePromptDismissed(false);
      setSavedFeedback(false);
      setUploadSheetOpen(false);
      setActiveTab("documents");
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "DEMO_LIMIT_REACHED") {
        setUploadSheetOpen(false);
        setErrorBanner({
          isDemoLimit: true,
          message: language === "hi" && err.messageHi ? err.messageHi : err.message,
        });
      } else {
        setErrorBanner({
          isDemoLimit: false,
          message:
            err instanceof Error ? err.message : "Document check failed. Please try again.",
        });
      }
    } finally {
      setAnalyzingDoc(false);
    }
  }

  const latestAssistantChoices =
    messages.length > 0 && messages[messages.length - 1]?.role === "assistant"
      ? messages[messages.length - 1]?.choices
      : undefined;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFD] text-[#1F1F1F] print:bg-white">
      {/* Material Design 3 Small Top App Bar (3-zone contract, <= 64px) */}
      <header className="sticky top-0 z-30 h-16 bg-[#F8FAFD]/95 backdrop-blur-md border-b border-[#E1E5EC] print:hidden">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="/"
            className="inline-flex items-center gap-2.5 text-base sm:text-lg font-bold tracking-[-0.015em] text-[#1F1F1F] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#0B57D0] rounded-full"
          >
            <span className="w-9 h-9 rounded-2xl bg-[#D3E3FD] text-[#041E49] inline-flex items-center justify-center shrink-0">
              <Landmark className="w-4 h-4" aria-hidden="true" />
            </span>
            <span>{copy.brandName}</span>
          </a>

          {/* Zone 2: Material 3 Language Selector Menu (8 Indian Languages) */}
          <div ref={langMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setLangMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={langMenuOpen}
              aria-label={`Language: ${LANGUAGE_META[language].englishName}`}
              className={`min-h-[40px] px-3.5 sm:px-4 rounded-full border text-xs sm:text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#0B57D0] ${
                langMenuOpen
                  ? "border-transparent bg-[#C2E7FF] text-[#001D35]"
                  : "border-[#747775]/75 bg-white text-[#1F1F1F] hover:bg-[#F0F4F9]"
              }`}
            >
              <Globe className="w-4 h-4 text-[#0B57D0] shrink-0" aria-hidden="true" />
              <span>{LANGUAGE_META[language].nativeLabel}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-[#444746] transition-transform ${
                  langMenuOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>

            {langMenuOpen && (
              <div
                role="menu"
                aria-label="Select language"
                className="absolute left-1/2 -translate-x-1/2 mt-2 w-56 rounded-[20px] bg-white border border-[#E1E5EC] md-elevation-2 py-2 z-50"
              >
                {SUPPORTED_LANGUAGES.map((langCode) => {
                  const meta = LANGUAGE_META[langCode];
                  const active = language === langCode;
                  return (
                    <button
                      key={langCode}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        setLanguage(langCode);
                        setLangMenuOpen(false);
                      }}
                      className={`w-full min-h-[42px] px-4 py-2 text-left flex items-center justify-between gap-3 transition-colors ${
                        active
                          ? "bg-[#D3E3FD]/65 text-[#041E49] font-semibold"
                          : "text-[#1F1F1F] hover:bg-[#F0F4F9]"
                      }`}
                    >
                      <span className="flex flex-col leading-tight">
                        <span className="text-sm">{meta.nativeLabel}</span>
                        {meta.nativeLabel !== meta.englishName && (
                          <span className="text-[11px] text-[#444746] font-normal">
                            {meta.englishName}
                          </span>
                        )}
                      </span>
                      {active && (
                        <Check
                          className="w-4 h-4 text-[#0B57D0] shrink-0"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Zone 3: Single Primary Utility Action (M3 Filled Tonal Button) */}
          <button
            type="button"
            onClick={handleResetSession}
            className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#D3E3FD] text-[#041E49] text-xs sm:text-sm font-medium hover:bg-[#C2D8FC] active:scale-[0.98] transition-all whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
          >
            <RotateCcw className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">{copy.newSession}</span>
          </button>
        </div>
      </header>

      {/* Main Responsive Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-7 print:max-w-none print:p-0">
        {/* Demo Limit / Error Banner (M3 Tonal Container) */}
        {errorBanner && (
          <div
            role="alert"
            className={`mb-5 rounded-[20px] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden ${
              errorBanner.isDemoLimit
                ? "bg-[#FFF4D6] text-[#422006]"
                : "bg-[#F9DEDC] text-[#410E0B]"
            }`}
          >
            <div className="flex items-start gap-3 text-sm">
              <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                {errorBanner.isDemoLimit && (
                  <p className="font-semibold">{copy.demoLimitTitle}</p>
                )}
                <p className="leading-relaxed">{errorBanner.message}</p>
              </div>
            </div>
            {errorBanner.isDemoLimit && (
              <a
                href="https://www.myscheme.gov.in/"
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[40px] px-4 py-2 rounded-full bg-white text-xs font-medium text-[#422006] hover:bg-white/80 inline-flex items-center justify-center whitespace-nowrap shrink-0"
              >
                myscheme.gov.in
              </a>
            )}
          </div>
        )}

        {/* Resume Saved Session Banner (M3 Tonal Surface Card) */}
        {savedProgress && messages.length === 0 && (
          <div
            role="region"
            aria-label={copy.resumeSession.title}
            className="mb-5 rounded-[24px] bg-[#F0F4F9] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden"
          >
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-[#D3E3FD] text-[#041E49] flex items-center justify-center shrink-0">
                <History className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm sm:text-base font-semibold text-[#1F1F1F]">
                  {copy.resumeSession.title}
                </p>
                <p className="text-xs sm:text-sm text-[#444746] mt-0.5 leading-snug">
                  {copy.resumeSession.subtitle(
                    formatSavedAt(savedProgress.savedAt),
                    savedProgress.messages.length,
                    savedProgress.session.plan.matches.length,
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                disabled={resumingSession}
                onClick={() => void handleResumeSession()}
                className="min-h-[44px] px-5 py-2.5 rounded-full bg-[#0B57D0] text-white text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-[#0842A0] active:scale-[0.98] transition-all disabled:opacity-55 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0]"
              >
                {resumingSession ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>{copy.resumeSession.resumingBtn}</span>
                  </>
                ) : (
                  <span>{copy.resumeSession.resumeBtn}</span>
                )}
              </button>
              <button
                type="button"
                disabled={resumingSession}
                onClick={handleDiscardSaved}
                className="min-h-[44px] px-4 py-2.5 rounded-full border border-[#747775]/65 bg-white text-[#444746] text-sm font-medium hover:bg-[#E9EEF6] hover:text-[#1F1F1F] transition-colors disabled:opacity-55 whitespace-nowrap"
              >
                {copy.resumeSession.discardBtn}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start print:block">
          {/* LEFT / TOP COLUMN: Material 3 Conversation Surface */}
          <section
            aria-label="Conversation"
            className="lg:col-span-7 bg-white border border-[#E1E5EC] md-elevation-1 rounded-[28px] flex flex-col overflow-hidden print:hidden"
          >
            {/* Non-intrusive Network Connectivity Indicator */}
            {!isOnline && (
              <div
                role="status"
                aria-live="polite"
                className="px-5 py-2.5 bg-[#FFF4D6] border-b border-[#F4DF9F] text-[#422006] flex items-start gap-2.5"
              >
                <WifiOff
                  className="w-4 h-4 text-[#7A4F01] mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0 text-xs leading-snug">
                  <span className="font-semibold">
                    {copy.networkStatus.offlineLabel}
                  </span>
                  <span>
                    {" — "}
                    {copy.networkStatus.offlineDetail}
                  </span>
                </div>
              </div>
            )}
            {isOnline && justReconnected && (
              <div
                role="status"
                aria-live="polite"
                className="px-5 py-2 bg-[#C4EED0] text-[#072711] flex items-center gap-2 text-xs font-medium"
              >
                <Wifi className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{copy.networkStatus.reconnectedLabel}</span>
              </div>
            )}

            {/* State / UT & District Auto-Filter Strip (M3 Tonal Toolbar) */}
            <div className="px-5 py-3 bg-[#F0F4F9]/75 border-b border-[#E1E5EC] flex flex-col sm:flex-row sm:items-center gap-2.5">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <MapPin
                  className="w-4 h-4 text-[#0B57D0] shrink-0"
                  aria-hidden="true"
                />
                <select
                  aria-label={copy.locationFilter.stateLabel}
                  value={location?.stateCode ?? ""}
                  onChange={(e) => handleStateChange(e.target.value)}
                  className="flex-1 min-w-0 min-h-[42px] px-3.5 py-2 rounded-xl bg-white border border-[#C4C7C5] text-xs sm:text-sm text-[#1F1F1F] focus:outline-none focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/15 transition-colors"
                >
                  <option value="">{copy.locationFilter.allIndiaOption}</option>
                  {INDIA_STATES.map((st) => (
                    <option key={st.code} value={st.code}>
                      {language === "hi" ? st.nameHi : st.nameEn}
                    </option>
                  ))}
                </select>
              </div>
              {location?.stateCode && (
                <input
                  type="text"
                  value={location.district ?? ""}
                  onChange={(e) => handleDistrictChange(e.target.value)}
                  placeholder={copy.locationFilter.districtPlaceholder}
                  aria-label={copy.locationFilter.districtPlaceholder}
                  className="sm:w-48 min-h-[42px] px-3.5 py-2 rounded-xl bg-white border border-[#C4C7C5] text-xs sm:text-sm text-[#1F1F1F] placeholder:text-[#747775] focus:outline-none focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/15 transition-colors"
                />
              )}
            </div>

            {/* Empty State Hero or Conversation Timeline */}
            <div className="p-5 sm:p-7 space-y-6 min-h-[340px] max-h-[62vh] lg:max-h-[66vh] overflow-y-auto">
              {messages.length === 0 ? (
                <div className="space-y-7 py-2">
                  <div className="space-y-3">
                    <h1 className="text-2xl sm:text-[32px] font-bold text-[#1F1F1F] tracking-[-0.02em] leading-[1.2]">
                      {copy.heroTitle}
                    </h1>
                    <p className="text-sm sm:text-base text-[#444746] leading-relaxed max-w-2xl">
                      {copy.heroSubtitle}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs font-medium text-[#444746]">
                      {copy.quickStartHeading}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {copy.quickStarts.map((item) => {
                        const Icon =
                          QUICK_START_ICONS[
                            item.id as keyof typeof QUICK_START_ICONS
                          ] ?? Sprout;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={sending || !isOnline}
                            onClick={() => void handleSendText(item.prompt)}
                            className="min-h-[76px] p-4 rounded-[20px] bg-[#F0F4F9] hover:bg-[#E4ECF7] text-left transition-colors flex items-start gap-3.5 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
                          >
                            <div className="w-11 h-11 rounded-2xl bg-[#D3E3FD] text-[#041E49] flex items-center justify-center shrink-0">
                              <Icon className="w-5 h-5" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-[#1F1F1F]">
                                {item.title}
                              </p>
                              <p className="text-xs text-[#444746] mt-0.5 leading-snug">
                                {item.subtitle}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Quiet Inline Session Metadata (Zero-Pill Discipline) */}
                  {session && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#444746] pb-3 border-b border-[#E1E5EC]">
                      <span className="font-mono-tabular">
                        {copy.questionsProgress(
                          session.questionCount,
                          session.maxQuestions,
                        )}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-[#444746]">
                        <ShieldCheck
                          className="w-3.5 h-3.5 text-[#0B57D0]"
                          aria-hidden="true"
                        />
                        <span>{copy.potentialMatchDisclaimer}</span>
                      </span>
                    </div>
                  )}

                  {messages.map((msg) => {
                    const isCitizen = msg.role === "citizen";
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isCitizen ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[90%] sm:max-w-[84%] px-4 py-3 text-sm sm:text-[15px] leading-relaxed whitespace-pre-line ${
                            isCitizen
                              ? "bg-[#D3E3FD] text-[#041E49] rounded-[22px] rounded-br-[6px]"
                              : "bg-[#F0F4F9] text-[#1F1F1F] rounded-[22px] rounded-bl-[6px]"
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    );
                  })}

                  {sending && (
                    <div className="flex justify-start">
                      <div className="rounded-[22px] rounded-bl-[6px] px-4 py-3 bg-[#F0F4F9] text-sm text-[#444746] inline-flex items-center gap-2.5">
                        <Loader2
                          className="w-4 h-4 animate-spin text-[#0B57D0]"
                          aria-hidden="true"
                        />
                        <span>{copy.thinkingMessage}</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            {/* M3 Suggestion / Assist Chips for Follow-Up Questions */}
            {!sending && latestAssistantChoices && latestAssistantChoices.length > 0 && (
              <div className="px-5 pb-3 pt-1 flex flex-wrap gap-2">
                {latestAssistantChoices.map((choice, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={!isOnline}
                    onClick={() => void handleSendText(choice.value)}
                    className="min-h-[44px] px-4 py-2 rounded-full border border-[#747775]/65 bg-white text-[#0B57D0] text-sm font-medium hover:bg-[#D3E3FD]/55 hover:border-[#0B57D0] transition-colors text-left disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            )}

            {/* Unfinished Session Save Progress Prompt (M3 Tonal Banner) */}
            {session &&
              sessionUnfinished &&
              hasUnsavedChanges &&
              !savePromptDismissed &&
              !sending && (
                <div
                  role="region"
                  aria-label={copy.saveProgress.promptTitle}
                  className="mx-4 mb-3 rounded-[20px] px-4 py-3.5 bg-[#F0F4F9] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Bookmark
                      className="w-4 h-4 text-[#0B57D0] mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1F1F1F]">
                        {copy.saveProgress.promptTitle}
                      </p>
                      <p className="text-xs text-[#444746] mt-0.5 leading-relaxed">
                        {copy.saveProgress.promptBody}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleSaveProgress}
                      className="min-h-[40px] px-4 py-2 rounded-full bg-[#0B57D0] text-white text-xs sm:text-sm font-medium hover:bg-[#0842A0] transition-colors whitespace-nowrap"
                    >
                      {copy.saveProgress.saveBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSavePromptDismissed(true)}
                      className="min-h-[40px] px-3.5 py-2 rounded-full text-[#444746] text-xs sm:text-sm font-medium hover:bg-[#1F1F1F]/8 transition-colors whitespace-nowrap"
                    >
                      {copy.saveProgress.dismissBtn}
                    </button>
                  </div>
                </div>
              )}

            {/* Material Design 3 Stadium Composer + Utility Actions */}
            <form
              onSubmit={handleFormSubmit}
              className="p-4 sm:p-5 border-t border-[#E1E5EC] bg-white space-y-3"
            >
              <div className="flex items-center gap-2 rounded-full bg-[#F0F4F9] pl-4 sm:pl-5 pr-1.5 py-1.5 border border-transparent focus-within:bg-white focus-within:border-[#0B57D0] focus-within:ring-2 focus-within:ring-[#0B57D0]/15 transition-all">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={sending || !isOnline || session?.budget.limitReached}
                  placeholder={copy.inputPlaceholder}
                  aria-label={copy.inputPlaceholder}
                  className="flex-1 min-h-[42px] bg-transparent text-sm sm:text-base text-[#1F1F1F] placeholder:text-[#747775] focus:outline-none disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={
                    sending ||
                    !isOnline ||
                    !inputText.trim() ||
                    Boolean(session?.budget.limitReached)
                  }
                  className="min-h-[42px] px-5 rounded-full bg-[#0B57D0] text-white text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-[#0842A0] active:scale-[0.98] transition-all disabled:opacity-45 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0]"
                >
                  <span>{copy.sendLabel}</span>
                  <Send className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={
                      sending || !isOnline || Boolean(session?.budget.limitReached)
                    }
                    onClick={handleOpenDocumentFlow}
                    className="min-h-[40px] px-4 py-2 rounded-full border border-[#747775]/60 bg-white text-[#1F1F1F] text-xs sm:text-sm font-medium inline-flex items-center gap-2 hover:bg-[#F0F4F9] hover:border-[#0B57D0] hover:text-[#0B57D0] transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    <Camera className="w-4 h-4" aria-hidden="true" />
                    <span>{copy.checkDocumentBtn}</span>
                  </button>

                  {session && messages.length > 0 && (hasUnsavedChanges || !savedFeedback) && (
                    <button
                      type="button"
                      disabled={sending}
                      onClick={handleSaveProgress}
                      className="min-h-[40px] px-4 py-2 rounded-full border border-[#747775]/60 bg-white text-[#1F1F1F] text-xs sm:text-sm font-medium inline-flex items-center gap-2 hover:bg-[#F0F4F9] hover:border-[#0B57D0] hover:text-[#0B57D0] transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      <Bookmark className="w-4 h-4" aria-hidden="true" />
                      <span>{copy.saveProgress.saveBtn}</span>
                    </button>
                  )}

                  {session && messages.length > 0 && savedFeedback && !hasUnsavedChanges && (
                    <div className="inline-flex items-center gap-2.5 px-1">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#146C2E]">
                        <BookmarkCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>{copy.saveProgress.savedNotice}</span>
                      </span>
                      <button
                        type="button"
                        onClick={handleDiscardSaved}
                        className="min-h-[36px] px-2 rounded-full text-xs font-medium text-[#444746] hover:text-[#1F1F1F] hover:bg-[#1F1F1F]/6 whitespace-nowrap"
                      >
                        {copy.saveProgress.clearSavedBtn}
                      </button>
                    </div>
                  )}
                </div>

                {session?.documentConsentGranted && (
                  <button
                    type="button"
                    onClick={() => void handleRevokeConsent()}
                    className="min-h-[36px] px-2.5 rounded-full text-xs font-medium text-[#444746] hover:text-[#B3261E] hover:bg-[#B3261E]/8 transition-colors"
                  >
                    {copy.revokeConsentBtn}
                  </button>
                )}
              </div>
            </form>
          </section>

          {/* RIGHT / BOTTOM COLUMN: Material 3 "Your Plan" Surface */}
          <div className="lg:col-span-5 lg:sticky lg:top-20 print:static print:w-full">
            <PlanPanel
              plan={currentPlan}
              language={language}
              location={location}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              documentConsentGranted={Boolean(session?.documentConsentGranted)}
              isOffline={!isOnline}
              canRecheckFacts={Boolean(session?.sessionId && messages.length > 0)}
              recheckingFacts={recheckingFacts}
              manualReadyDocIds={manualReadyDocIds}
              onToggleManualDocReady={handleToggleManualDocReady}
              onRecheckFacts={handleRecheckFacts}
              onOpenHelpCentreMap={() => setHelpCentreMapOpen(true)}
              onRequestDocumentCheck={handleOpenDocumentFlow}
              onRevokeConsent={() => void handleRevokeConsent()}
            />
          </div>
        </div>
      </main>

      {/* Nearest CSC / Help Centre Locator Modal (Google Maps Platform) */}
      <HelpCentreLocatorModal
        open={helpCentreMapOpen}
        language={language}
        location={location ?? session?.plan.location}
        isOffline={!isOnline}
        onClose={() => setHelpCentreMapOpen(false)}
      />

      {/* Explicit Per-Session Consent Modal */}
      <ConsentModal
        open={consentModalOpen}
        language={language}
        busy={consentBusy}
        onAgree={() => void handleGrantConsent()}
        onCancel={() => setConsentModalOpen(false)}
      />

      {/* Document Upload Sheet (Only reachable after explicit consent) */}
      <DocumentUploadSheet
        open={uploadSheetOpen}
        language={language}
        analyzing={analyzingDoc}
        onClose={() => setUploadSheetOpen(false)}
        onRevokeConsent={() => void handleRevokeConsent()}
        onUpload={handleUploadDocument}
      />
    </div>
  );
}
