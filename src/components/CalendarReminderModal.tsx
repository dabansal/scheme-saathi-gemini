import {
  CalendarPlus,
  Check,
  CheckCircle2,
  Download,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type {
  CitizenLocation,
  Language,
  PlanState,
} from "../../shared/models.ts";
import { UI_COPY } from "../i18n.ts";
import {
  buildCalendarIcsContent,
  buildSmartReminderPresets,
  downloadIcsFile,
} from "../lib/calendarReminder.ts";

interface CalendarReminderModalProps {
  open: boolean;
  language: Language;
  plan: PlanState;
  location?: CitizenLocation;
  manualReadyDocIds: string[];
  onClose: () => void;
}

export function CalendarReminderModal({
  open,
  language,
  plan,
  location,
  manualReadyDocIds,
  onClose,
}: CalendarReminderModalProps) {
  const copy = UI_COPY[language].calendarReminder;

  const presets = useMemo(
    () =>
      buildSmartReminderPresets({
        plan,
        language,
        location,
        manualReadyDocIds,
      }),
    [plan, language, location, manualReadyDocIds],
  );

  const [activePresetId, setActivePresetId] = useState<string>(
    presets[0]?.id ?? "status_followup",
  );
  const [title, setTitle] = useState<string>(presets[0]?.title ?? "");
  const [dateYmd, setDateYmd] = useState<string>(presets[0]?.dateYmd ?? "");
  const [timeHm, setTimeHm] = useState<string>(presets[0]?.timeHm ?? "10:00");
  const [notes, setNotes] = useState<string>(presets[0]?.notes ?? "");
  const [officialUrl, setOfficialUrl] = useState<string | undefined>(
    presets[0]?.officialUrl,
  );
  const [downloaded, setDownloaded] = useState(false);

  // Reset form to first relevant preset whenever modal opens
  useEffect(() => {
    if (!open) return;
    const first = presets[0];
    if (first) {
      setActivePresetId(first.id);
      setTitle(first.title);
      setDateYmd(first.dateYmd);
      setTimeHm(first.timeHm);
      setNotes(first.notes);
      setOfficialUrl(first.officialUrl);
    }
    setDownloaded(false);
  }, [open, presets]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function handleSelectPreset(presetId: string) {
    const found = presets.find((p) => p.id === presetId);
    if (!found) return;
    setActivePresetId(found.id);
    setTitle(found.title);
    setDateYmd(found.dateYmd);
    setTimeHm(found.timeHm);
    setNotes(found.notes);
    setOfficialUrl(found.officialUrl);
    setDownloaded(false);
  }

  function handleDownload(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !dateYmd) return;

    const locationText = location?.stateName
      ? `${location.district ? `${location.district}, ` : ""}${location.stateName}`
      : undefined;

    const ics = buildCalendarIcsContent({
      title: title.trim(),
      dateYmd,
      timeHm: timeHm || "10:00",
      notes,
      locationText,
      officialUrl,
    });

    const ok = downloadIcsFile(ics, `scheme-saathi-${dateYmd}`);
    if (ok) {
      setDownloaded(true);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-reminder-title"
      className="fixed inset-0 z-50 bg-[#1F1F1F]/40 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5 print:hidden"
    >
      <div className="bg-[#F8FAFD] rounded-[28px] w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden md-elevation-3">
        {/* M3 Header */}
        <div className="px-6 py-4 bg-white border-b border-[#E1E5EC] flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-[#D3E3FD] text-[#041E49] flex items-center justify-center shrink-0">
              <CalendarPlus className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="calendar-reminder-title"
                className="text-lg sm:text-xl font-semibold text-[#1F1F1F]"
              >
                {copy.modalTitle}
              </h2>
              <p className="text-xs sm:text-sm text-[#444746] mt-0.5 leading-snug">
                {copy.modalSubtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.closeBtn}
            className="min-h-[44px] min-w-[44px] rounded-full text-[#444746] hover:text-[#1F1F1F] hover:bg-[#1F1F1F]/8 inline-flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleDownload}
          className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4"
        >
          {/* Smart Preset Chips */}
          {presets.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#444746]">
                {copy.presetsLabel}
              </p>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => {
                  const active = activePresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleSelectPreset(preset.id)}
                      className={`min-h-[38px] px-3.5 py-1.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 border transition-colors ${
                        active
                          ? "bg-[#D3E3FD] border-transparent text-[#041E49]"
                          : "bg-white border-[#C4C7C5] text-[#444746] hover:bg-[#F0F4F9]"
                      }`}
                    >
                      {active && (
                        <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span>{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label
              htmlFor="reminder-title-input"
              className="block text-xs font-medium text-[#444746]"
            >
              {copy.titleLabel}
            </label>
            <input
              id="reminder-title-input"
              type="text"
              required
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDownloaded(false);
              }}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-[#C4C7C5] text-sm text-[#1F1F1F] focus:outline-none focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/15"
            />
          </div>

          {/* Date & Time Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="reminder-date-input"
                className="block text-xs font-medium text-[#444746]"
              >
                {copy.dateLabel}
              </label>
              <input
                id="reminder-date-input"
                type="date"
                required
                value={dateYmd}
                onChange={(e) => {
                  setDateYmd(e.target.value);
                  setDownloaded(false);
                }}
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-[#C4C7C5] text-sm font-mono-tabular text-[#1F1F1F] focus:outline-none focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/15"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="reminder-time-input"
                className="block text-xs font-medium text-[#444746]"
              >
                {copy.timeLabel}
              </label>
              <input
                id="reminder-time-input"
                type="time"
                required
                value={timeHm}
                onChange={(e) => {
                  setTimeHm(e.target.value);
                  setDownloaded(false);
                }}
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-white border border-[#C4C7C5] text-sm font-mono-tabular text-[#1F1F1F] focus:outline-none focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/15"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label
              htmlFor="reminder-notes-input"
              className="block text-xs font-medium text-[#444746]"
            >
              {copy.notesLabel}
            </label>
            <textarea
              id="reminder-notes-input"
              rows={4}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setDownloaded(false);
              }}
              className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#C4C7C5] text-sm text-[#1F1F1F] leading-relaxed focus:outline-none focus:border-[#0B57D0] focus:ring-2 focus:ring-[#0B57D0]/15 resize-y"
            />
          </div>

          {downloaded && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-2xl bg-[#C4EED0] text-[#072711] px-4 py-3 text-xs font-medium flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{copy.downloadedNotice}</span>
            </div>
          )}

          {/* Privacy Note */}
          <p className="text-xs text-[#444746] flex items-start gap-2 leading-snug">
            <ShieldCheck
              className="w-4 h-4 text-[#0B57D0] mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <span>{copy.privacyHint}</span>
          </p>

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 rounded-full text-sm font-medium text-[#0B57D0] hover:bg-[#0B57D0]/8 transition-colors"
            >
              {copy.closeBtn}
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !dateYmd}
              className="min-h-[44px] px-5 py-2.5 rounded-full bg-[#0B57D0] text-white text-sm font-medium inline-flex items-center gap-2 hover:bg-[#0842A0] active:scale-[0.98] transition-all disabled:opacity-45"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              <span>{copy.downloadBtn}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
