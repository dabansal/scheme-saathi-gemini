import type {
  CitizenLocation,
  Language,
  PlanState,
} from "../../shared/models.ts";

export interface CalendarReminderInput {
  title: string;
  dateYmd: string; // YYYY-MM-DD
  timeHm: string; // HH:MM (24-hour)
  durationMinutes?: number;
  notes: string;
  locationText?: string;
  officialUrl?: string;
}

export interface ReminderPreset {
  id: string;
  label: string;
  title: string;
  dateYmd: string;
  timeHm: string;
  notes: string;
  officialUrl?: string;
}

function isSafeHttpsUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false;
  try {
    return new URL(rawUrl).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Masks accidental 12-digit Aadhaar or 9-18 digit bank account numbers before export.
 */
export function scrubSensitiveNumbers(text: string): string {
  return text
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "XXXX-XXXX-XXXX")
    .replace(/\b\d{9,18}\b/g, "XXXX-XXXX");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function addDaysYmd(baseDate: Date, daysToAdd: number): string {
  const next = new Date(baseDate.getTime());
  next.setDate(next.getDate() + daysToAdd);
  return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`;
}

/**
 * Escapes text per RFC 5545 Section 3.3.11 (TEXT values).
 */
function escapeIcsText(raw: string): string {
  return scrubSensitiveNumbers(raw)
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/**
 * Folds long content lines per RFC 5545 Section 3.1 (<= 75 octets per line).
 */
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    const limit = chunks.length === 0 ? 75 : 74; // Continuation line has leading space
    if (currentBytes + chBytes > limit && current.length > 0) {
      chunks.push(current);
      current = ch;
      currentBytes = chBytes;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks.join("\r\n ");
}

function formatUtcStamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

function formatFloatingLocalDateTime(
  dateYmd: string,
  timeHm: string,
  addMinutes = 0,
): string {
  const [yStr, mStr, dStr] = dateYmd.split("-");
  const [hStr, minStr] = timeHm.split(":");
  const year = Number(yStr) || new Date().getFullYear();
  const month = Number(mStr) || 1;
  const day = Number(dStr) || 1;
  const hour = Number(hStr) || 10;
  const minute = Number(minStr) || 0;

  const dt = new Date(year, month - 1, day, hour, minute + addMinutes, 0);
  return (
    `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}` +
    `T${pad2(dt.getHours())}${pad2(dt.getMinutes())}00`
  );
}

/**
 * Builds a standards-compliant RFC 5545 `.ics` file for Apple Calendar, Google Calendar,
 * Outlook, and Android/iOS Calendar apps. Runs 100% client-side with zero persistence.
 */
export function buildCalendarIcsContent(
  input: CalendarReminderInput,
  now: Date = new Date(),
): string {
  const duration = Math.max(15, Math.min(240, input.durationMinutes ?? 45));
  const dtStart = formatFloatingLocalDateTime(input.dateYmd, input.timeHm, 0);
  const dtEnd = formatFloatingLocalDateTime(
    input.dateYmd,
    input.timeHm,
    duration,
  );
  const dtStamp = formatUtcStamp(now);
  const uid = `scheme-saathi-${dtStart}-${Math.random().toString(36).slice(2, 8)}@schemesaathi.local`;

  const descriptionParts = [input.notes.trim()];
  if (isSafeHttpsUrl(input.officialUrl)) {
    descriptionParts.push(`Official link: ${input.officialUrl}`);
  }
  descriptionParts.push(
    "Reminder created via Scheme Saathi. Verify official rules at myscheme.gov.in or a CSC kiosk.",
  );

  const rawLines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Scheme Saathi//Citizen Action Plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(input.title.trim() || "Scheme Saathi Reminder")}`,
    `DESCRIPTION:${escapeIcsText(descriptionParts.filter(Boolean).join("\n\n"))}`,
  ];

  if (input.locationText?.trim()) {
    rawLines.push(`LOCATION:${escapeIcsText(input.locationText.trim())}`);
  }

  if (isSafeHttpsUrl(input.officialUrl)) {
    rawLines.push(`URL:${input.officialUrl}`);
  }

  // 1-day advance reminder alarm
  rawLines.push(
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(input.title.trim() || "Scheme Saathi Reminder")}`,
    "TRIGGER:-P1D",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );

  return `${rawLines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/**
 * Generates contextual smart reminder presets derived from the citizen's live plan.
 */
export function buildSmartReminderPresets(params: {
  plan: PlanState;
  language: Language;
  location?: CitizenLocation;
  manualReadyDocIds: string[];
  now?: Date;
}): ReminderPreset[] {
  const { plan, language, manualReadyDocIds, now = new Date() } = params;
  const isHi = language === "hi";
  const manualSet = new Set(manualReadyDocIds);
  const topMatch = plan.matches[0];
  const pendingDocs = plan.documents.filter(
    (d) => d.status !== "ready" && !manualSet.has(d.id),
  );
  const topUrl =
    topMatch && isSafeHttpsUrl(topMatch.officialChannelUrl)
      ? topMatch.officialChannelUrl
      : topMatch && isSafeHttpsUrl(topMatch.sourceUrl)
        ? topMatch.sourceUrl
        : "https://www.myscheme.gov.in/";

  const presets: ReminderPreset[] = [];

  if (pendingDocs.length > 0) {
    const docList = pendingDocs
      .slice(0, 4)
      .map((d) => d.label)
      .join(", ");
    presets.push({
      id: "collect_docs",
      label: isHi ? "दस्तावेज़ तैयार करें" : "Collect missing documents",
      title: topMatch
        ? isHi
          ? `${topMatch.schemeName}: दस्तावेज़ तैयार करें`
          : `Prepare documents for ${topMatch.schemeName}`
        : isHi
          ? "सरकारी योजना के दस्तावेज़ तैयार करें"
          : "Collect missing scheme documents",
      dateYmd: addDaysYmd(now, 2),
      timeHm: "10:00",
      notes: isHi
        ? `तैयार करने के लिए शेष दस्तावेज़: ${docList}। नज़दीकी CSC या ई-डिस्ट्रिक्ट पोर्टल से सहायता लें।`
        : `Pending documents to collect or verify: ${docList}. Visit your nearest CSC kiosk or state e-District portal if needed.`,
      officialUrl: topUrl,
    });
  }

  if (topMatch) {
    presets.push({
      id: "apply_csc",
      label: isHi ? "CSC / पोर्टल पर आवेदन" : "CSC / Official portal visit",
      title: isHi
        ? `${topMatch.schemeName}: आधिकारिक आवेदन / CSC विज़िट`
        : `${topMatch.schemeName}: Apply via official channel / CSC`,
      dateYmd: addDaysYmd(now, pendingDocs.length > 0 ? 5 : 2),
      timeHm: "10:30",
      notes: `${topMatch.nextOfficialAction}${
        topMatch.whatToVerify.length > 0
          ? `\nVerify: ${topMatch.whatToVerify.slice(0, 2).join("; ")}`
          : ""
      }`,
      officialUrl: topUrl,
    });
  }

  presets.push({
    id: "status_followup",
    label: isHi ? "स्थिति / DBT जांच" : "Follow-up & DBT check",
    title: topMatch
      ? isHi
        ? `${topMatch.schemeName}: आवेदन व DBT स्थिति जांच`
        : `${topMatch.schemeName}: Check application & DBT status`
      : isHi
        ? "योजना पात्रता और आवेदन फॉलो-अप"
        : "Government scheme readiness follow-up",
    dateYmd: addDaysYmd(now, 10),
    timeHm: "11:00",
    notes: isHi
      ? "आधार-बैंक (NPCI/DBT) सीडिंग और आधिकारिक पोर्टल पर आवेदन स्थिति की जांच करें।"
      : "Check Aadhaar-NPCI (DBT) bank seeding status and follow up on official portal verification.",
    officialUrl: topUrl,
  });

  return presets;
}

/**
 * Triggers a clean browser download for an `.ics` calendar file without using `window.open`.
 */
export function downloadIcsFile(icsContent: string, rawFilename: string): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return false;
  }
  const safeName =
    rawFilename
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "scheme-saathi-reminder";
  const blob = new Blob([icsContent], {
    type: "text/calendar;charset=utf-8",
  });
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = `${safeName}.ics`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  return true;
}
