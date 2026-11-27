import { Camera, Check, FileCheck2, Loader2, ShieldOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { DocumentTypeKey, Language } from "../../shared/models.ts";
import { UI_COPY } from "../i18n.ts";

interface DocumentUploadSheetProps {
  open: boolean;
  language: Language;
  analyzing: boolean;
  onClose: () => void;
  onRevokeConsent: () => void;
  onUpload: (params: {
    claimedType: DocumentTypeKey;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    imageBase64: string;
  }) => Promise<void>;
}

const DOC_TYPE_ORDER: DocumentTypeKey[] = [
  "aadhaar",
  "land_record",
  "bank_passbook",
  "income_certificate",
  "caste_certificate",
  "ration_card",
  "student_id_marksheet",
  "artisan_business_proof",
  "other",
];

const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function DocumentUploadSheet({
  open,
  language,
  analyzing,
  onClose,
  onRevokeConsent,
  onUpload,
}: DocumentUploadSheetProps) {
  const [selectedType, setSelectedType] = useState<DocumentTypeKey>("aadhaar");
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open || analyzing) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, analyzing, onClose]);

  if (!open) return null;

  const copy = UI_COPY[language];
  const sheetCopy = copy.uploadSheet;

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLocalError(null);
    if (!ALLOWED_MIMES.has(file.type)) {
      setLocalError(
        language === "hi"
          ? "कृपया केवल JPG, PNG या WEBP फोटो चुनें।"
          : "Please choose a JPG, PNG, or WEBP image.",
      );
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setLocalError(
        language === "hi"
          ? "फोटो का आकार 6 MB से कम होना चाहिए।"
          : "Photo must be under 6 MB.",
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64 = result.split(",")[1] ?? "";
      if (!base64) {
        setLocalError(
          language === "hi"
            ? "फोटो पढ़ने में समस्या आई। कृपया फिर से प्रयास करें।"
            : "Could not read photo. Please try again.",
        );
        return;
      }
      await onUpload({
        claimedType: selectedType,
        mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
        imageBase64: base64,
      });
    };
    reader.onerror = () => {
      setLocalError(
        language === "hi"
          ? "फोटो पढ़ने में समस्या आई।"
          : "Failed to read the selected photo.",
      );
    };
    reader.readAsDataURL(file);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#1F1F1F]/40 backdrop-blur-[2px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-sheet-title"
    >
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-[28px] sm:rounded-[28px] bg-[#F8FAFD] md-elevation-3 p-6 space-y-5">
        <div className="w-8 h-1 bg-[#C4C7C5] rounded-full mx-auto sm:hidden" />

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#D3E3FD] text-[#041E49] flex items-center justify-center shrink-0">
              <FileCheck2 className="w-5 h-5" aria-hidden="true" />
            </div>
            <h2
              id="upload-sheet-title"
              className="text-xl font-semibold text-[#1F1F1F]"
            >
              {sheetCopy.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={analyzing}
            aria-label={sheetCopy.closeBtn}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-[#444746] hover:text-[#1F1F1F] hover:bg-[#1F1F1F]/8 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-[#444746]">
            {sheetCopy.selectTypeLabel}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {DOC_TYPE_ORDER.map((docKey) => {
              const active = selectedType === docKey;
              return (
                <button
                  key={docKey}
                  type="button"
                  disabled={analyzing}
                  aria-pressed={active}
                  onClick={() => setSelectedType(docKey)}
                  className={`min-h-[46px] px-3.5 py-2.5 text-left rounded-2xl border text-sm font-medium inline-flex items-center gap-2 transition-colors focus-visible:outline-2 focus-visible:outline-[#0B57D0] ${
                    active
                      ? "bg-[#D3E3FD] text-[#041E49] border-transparent"
                      : "bg-white text-[#1F1F1F] border-[#C4C7C5] hover:bg-[#F0F4F9]"
                  }`}
                >
                  {active && (
                    <Check className="w-4 h-4 text-[#041E49] shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{copy.documentTypes[docKey]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2.5 pt-3 border-t border-[#E1E5EC]">
          <p className="text-sm font-medium text-[#444746]">
            {sheetCopy.choosePhotoLabel}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            disabled={analyzing}
            onClick={() => fileInputRef.current?.click()}
            className="w-full min-h-[52px] px-6 py-3 rounded-full bg-[#0B57D0] text-white font-medium text-sm flex items-center justify-center gap-2.5 hover:bg-[#0842A0] active:scale-[0.99] transition-all disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B57D0]"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                <span>{sheetCopy.analyzingLabel}</span>
              </>
            ) : (
              <>
                <Camera className="w-5 h-5" aria-hidden="true" />
                <span>{sheetCopy.choosePhotoLabel}</span>
              </>
            )}
          </button>
          <p className="text-xs text-[#444746]">{sheetCopy.choosePhotoHint}</p>
        </div>

        {localError && (
          <p className="text-sm text-[#410E0B] bg-[#F9DEDC] rounded-2xl px-4 py-3">
            {localError}
          </p>
        )}

        <div className="pt-3 border-t border-[#E1E5EC] flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={analyzing}
            onClick={onRevokeConsent}
            className="min-h-[44px] px-3 rounded-full inline-flex items-center gap-1.5 text-xs font-medium text-[#444746] hover:text-[#B3261E] hover:bg-[#B3261E]/8 transition-colors"
          >
            <ShieldOff className="w-4 h-4" aria-hidden="true" />
            <span>{copy.revokeConsentBtn}</span>
          </button>
          <button
            type="button"
            disabled={analyzing}
            onClick={onClose}
            className="min-h-[44px] px-5 rounded-full text-sm font-medium text-[#0B57D0] hover:bg-[#0B57D0]/8 transition-colors"
          >
            {sheetCopy.closeBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
