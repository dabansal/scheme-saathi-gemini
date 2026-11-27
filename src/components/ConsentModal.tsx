import { ShieldCheck, X } from "lucide-react";
import { useEffect } from "react";
import type { Language } from "../../shared/models.ts";
import { UI_COPY } from "../i18n.ts";

interface ConsentModalProps {
  open: boolean;
  language: Language;
  busy: boolean;
  onAgree: () => void;
  onCancel: () => void;
}

export function ConsentModal({
  open,
  language,
  busy,
  onAgree,
  onCancel,
}: ConsentModalProps) {
  useEffect(() => {
    if (!open || busy) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;
  const copy = UI_COPY[language].consentModal;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#1F1F1F]/40 backdrop-blur-[2px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-modal-title"
    >
      <div className="w-full sm:max-w-lg rounded-t-[28px] sm:rounded-[28px] bg-[#F8FAFD] md-elevation-3 p-6 space-y-5">
        <div className="w-8 h-1 bg-[#C4C7C5] rounded-full mx-auto sm:hidden" />

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-[#D3E3FD] text-[#041E49] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="consent-modal-title"
                className="text-xl font-semibold text-[#1F1F1F] leading-snug"
              >
                {copy.title}
              </h2>
              <p className="text-sm text-[#444746] mt-1 leading-relaxed">
                {copy.subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label={copy.cancelBtn}
            className="min-h-[44px] min-w-[44px] -mt-1 -mr-1 flex items-center justify-center rounded-full text-[#444746] hover:text-[#1F1F1F] hover:bg-[#1F1F1F]/8 transition-colors focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <ul className="space-y-3 rounded-[20px] bg-white p-4 text-sm text-[#1F1F1F] leading-relaxed">
          {copy.points.map((point, index) => (
            <li key={index} className="flex items-start gap-3">
              <span className="mt-0.5 text-xs font-semibold text-[#0B57D0] font-mono-tabular shrink-0">
                0{index + 1}.
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-[44px] px-5 py-2.5 rounded-full text-[#0B57D0] font-medium text-sm hover:bg-[#0B57D0]/8 transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#0B57D0]"
          >
            {copy.cancelBtn}
          </button>
          <button
            type="button"
            onClick={onAgree}
            disabled={busy}
            className="min-h-[44px] px-6 py-2.5 rounded-full bg-[#0B57D0] text-white font-medium text-sm hover:bg-[#0842A0] active:scale-[0.99] transition-all whitespace-nowrap disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0]"
          >
            {copy.agreeBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
