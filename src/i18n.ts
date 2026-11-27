import type { DocumentTypeKey, Language } from "../shared/models.ts";

export interface UiCopy {
  brandName: string;
  newSession: string;
  heroTitle: string;
  heroSubtitle: string;
  quickStartHeading: string;
  quickStarts: Array<{
    id: string;
    title: string;
    subtitle: string;
    prompt: string;
  }>;
  inputPlaceholder: string;
  sendLabel: string;
  checkDocumentBtn: string;
  revokeConsentBtn: string;
  consentActiveLabel: string;
  planHeading: string;
  printPlanBtn: string;
  printPlanTitle: string;
  printedOn: string;
  tabs: {
    matches: string;
    documents: string;
    nextStep: string;
  };
  potentialMatchDisclaimer: string;
  noSubmissionNotice: string;
  whyItMayFit: string;
  whatToVerify: string;
  whatIsMissing: string;
  nextOfficialAction: string;
  openOfficialSource: string;
  openOfficialChannel: string;
  fetchedOn: string;
  confidenceLabel: string;
  confidenceNames: {
    High: string;
    Medium: string;
    Low: string;
  };
  docStatuses: {
    ready: string;
    missing: string;
    needs_verification: string;
  };
  emptyMatches: string;
  emptyDocs: string;
  knownFactsHeading: string;
  unknownFactsHeading: string;
  humanHandoffHeading: string;
  humanHandoffCta: string;
  questionsProgress: (used: number, max: number) => string;
  thinkingMessage: string;
  consentModal: {
    title: string;
    subtitle: string;
    points: string[];
    agreeBtn: string;
    cancelBtn: string;
  };
  uploadSheet: {
    title: string;
    selectTypeLabel: string;
    choosePhotoLabel: string;
    choosePhotoHint: string;
    analyzingLabel: string;
    closeBtn: string;
  };
  documentTypes: Record<DocumentTypeKey, string>;
  demoLimitTitle: string;
  saveProgress: {
    promptTitle: string;
    promptBody: string;
    saveBtn: string;
    dismissBtn: string;
    savedNotice: string;
    clearSavedBtn: string;
  };
  resumeSession: {
    title: string;
    subtitle: (savedAtText: string, messageCount: number, matchCount: number) => string;
    resumeBtn: string;
    resumingBtn: string;
    discardBtn: string;
  };
  networkStatus: {
    offlineLabel: string;
    offlineDetail: string;
    reconnectedLabel: string;
  };
  shareChecklist: {
    shareBtn: string;
    summaryTitle: string;
    chooseSchemesLabel: string;
    previewLabel: string;
    whatsappBtn: string;
    smsBtn: string;
    copyBtn: string;
    copiedLabel: string;
    copyFailedLabel: string;
    privacyHint: string;
  };
  locationFilter: {
    stateLabel: string;
    allIndiaOption: string;
    districtPlaceholder: string;
    selectedBadge: (stateName: string, district?: string) => string;
  };
  documentChecklist: {
    markReady: string;
    markMissing: string;
    markedByYou: string;
    photoChecked: string;
    howToGetBtn: string;
    hideGuideBtn: string;
  };
  whatIfEditor: {
    editBtn: string;
    heading: string;
    hint: string;
    addPlaceholder: string;
    addBtn: string;
    recheckBtn: string;
    recheckingBtn: string;
    cancelBtn: string;
    removeFactAria: string;
  };
  helpCentreMap: {
    openMapBtn: string;
    modalTitle: string;
    modalSubtitle: string;
    searchPlaceholder: string;
    searchBtn: string;
    useMyLocationBtn: string;
    locatingBtn: string;
    locationPrivacyNote: string;
    categories: {
      csc: string;
      tehsil: string;
      bank: string;
    };
    searchingLabel: string;
    noResultsLabel: string;
    openInGoogleMaps: string;
    openNow: string;
    closedNow: string;
    closeBtn: string;
    mapUnavailable: string;
    geoDenied: string;
  };
}

export const UI_COPY: Record<Language, UiCopy> = {
  en: {
    brandName: "Scheme Saathi",
    newSession: "New session",
    heroTitle: "Check scheme readiness in under 3 minutes",
    heroSubtitle:
      "Tell us your situation in English, Hindi, or Hinglish. We check live official criteria from myScheme, flag missing documents, and link you to the official channel.",
    quickStartHeading: "Or tap a situation to begin",
    quickStarts: [
      {
        id: "farmer",
        title: "Smallholder Farmer",
        subtitle: "2 acres land · PM-KISAN, KCC & crop cover",
        prompt:
          "I am a smallholder farmer with 2 acres of cultivable land in Uttar Pradesh. I want to check which government schemes I can apply for.",
      },
      {
        id: "student",
        title: "Student Scholarship",
        subtitle: "School or college financial support",
        prompt:
          "I am a college student from a low-income family and want to check central government scholarship schemes.",
      },
      {
        id: "health",
        title: "Family Health Cover",
        subtitle: "Hospitalization & maternity schemes",
        prompt:
          "I want to check if my family qualifies for Ayushman Bharat or other government health coverage schemes.",
      },
      {
        id: "livelihood",
        title: "Artisan / Small Business",
        subtitle: "Tools, credit & livelihood support",
        prompt:
          "I am a self-employed carpenter / small vendor looking for government livelihood or toolkit loan schemes.",
      },
    ],
    inputPlaceholder: "Describe your situation in English, Hindi, or Hinglish...",
    sendLabel: "Send",
    checkDocumentBtn: "Check a document photo",
    revokeConsentBtn: "Revoke consent & clear data",
    consentActiveLabel: "Session photo consent active (in-memory only)",
    planHeading: "Your Plan",
    printPlanBtn: "Print / PDF",
    printPlanTitle: "Scheme Saathi — Personalized Action Plan",
    printedOn: "Printed on",
    tabs: {
      matches: "Matches",
      documents: "Documents",
      nextStep: "Next step",
    },
    potentialMatchDisclaimer: "Potential match, official verification required.",
    noSubmissionNotice:
      "Scheme Saathi never submits applications for you. Use the official government link or visit a CSC.",
    whyItMayFit: "Why it may fit",
    whatToVerify: "What to verify",
    whatIsMissing: "What is missing",
    nextOfficialAction: "Next official action",
    openOfficialSource: "View myScheme source",
    openOfficialChannel: "Open official channel",
    fetchedOn: "Fetched",
    confidenceLabel: "Confidence",
    confidenceNames: {
      High: "High confidence",
      Medium: "Medium confidence",
      Low: "Low confidence",
    },
    docStatuses: {
      ready: "Ready",
      missing: "Missing",
      needs_verification: "Verify",
    },
    emptyMatches:
      "Share your situation above to fetch live official scheme criteria from myScheme.",
    emptyDocs:
      "Once your schemes are identified, your Ready / Missing document checklist will appear here.",
    knownFactsHeading: "What we know",
    unknownFactsHeading: "Still to confirm",
    humanHandoffHeading: "Talk to a human / Find help centre",
    humanHandoffCta: "Talk to a human / Find help centre",
    questionsProgress: (used, max) => `Follow-ups used: ${used} of ${max}`,
    thinkingMessage: "Checking official myScheme criteria...",
    consentModal: {
      title: "Consent to check a document photo",
      subtitle: "Before you share any photo (Aadhaar, land record, passbook, or certificate), please review:",
      points: [
        "Processed strictly in server memory for this session only — never saved to a database or disk.",
        "Aadhaar numbers and bank account numbers are masked to the last 4 digits in the interface and never logged.",
        "Nothing is submitted to any government portal or third party.",
        "Consent applies only to this session and can be revoked at any moment to clear extracted details.",
      ],
      agreeBtn: "I consent for this session",
      cancelBtn: "Not now",
    },
    uploadSheet: {
      title: "Check a document photo",
      selectTypeLabel: "1. Which document is this?",
      choosePhotoLabel: "2. Select or capture a clear photo",
      choosePhotoHint: "JPG, PNG, or WEBP up to 6 MB. Processed in memory only.",
      analyzingLabel: "Verifying document type and readiness...",
      closeBtn: "Close",
    },
    documentTypes: {
      aadhaar: "Aadhaar Card",
      land_record: "Land Record (Khatauni / 7/12 / RoR)",
      bank_passbook: "Bank Passbook / Cancelled Cheque",
      income_certificate: "Income Certificate",
      caste_certificate: "Caste / Category Certificate",
      ration_card: "Ration Card (NFSA / BPL)",
      student_id_marksheet: "Student ID / Marksheet",
      artisan_business_proof: "Artisan / Vendor / Udyam Proof",
      other: "Other Supporting Document",
    },
    demoLimitTitle: "Demo limit reached",
    saveProgress: {
      promptTitle: "Not finished yet? Save your progress",
      promptBody:
        "Save your conversation and scheme plan in this browser so you can continue later. Uploaded document photos and ID numbers are never saved.",
      saveBtn: "Save Progress",
      dismissBtn: "Not now",
      savedNotice: "Progress saved on this device",
      clearSavedBtn: "Clear saved",
    },
    resumeSession: {
      title: "Saved session found on this device",
      subtitle: (savedAtText, messageCount, matchCount) =>
        `Saved ${savedAtText} · ${messageCount} messages · ${matchCount} potential match${matchCount === 1 ? "" : "es"}`,
      resumeBtn: "Resume Session",
      resumingBtn: "Resuming...",
      discardBtn: "Discard",
    },
    networkStatus: {
      offlineLabel: "Offline — no internet connection",
      offlineDetail:
        "Sending messages and document checks are paused until you reconnect. You can still view or save your plan.",
      reconnectedLabel: "Back online",
    },
    shareChecklist: {
      shareBtn: "Share",
      summaryTitle: "Shareable Eligibility & Scheme Summary",
      chooseSchemesLabel: "Choose schemes to include",
      previewLabel: "Summary text preview",
      whatsappBtn: "WhatsApp",
      smsBtn: "SMS",
      copyBtn: "Copy summary",
      copiedLabel: "Copied to clipboard",
      copyFailedLabel: "Copy blocked — select and copy the text above.",
      privacyHint: "Includes only your eligibility summary, chosen scheme links, and document names — never raw ID numbers.",
    },
    locationFilter: {
      stateLabel: "State / UT",
      allIndiaOption: "All India (Select State / UT)",
      districtPlaceholder: "District (optional)",
      selectedBadge: (stateName, district) =>
        district ? `${district}, ${stateName}` : stateName,
    },
    documentChecklist: {
      markReady: "Mark as ready",
      markMissing: "Unmark ready",
      markedByYou: "Checked by you",
      photoChecked: "Photo checked",
      howToGetBtn: "How to get this",
      hideGuideBtn: "Hide steps",
    },
    whatIfEditor: {
      editBtn: "Edit / What-If",
      heading: "Edit facts to test eligibility",
      hint: "Change or add any detail (such as land area, income, or state) and re-check without starting over.",
      addPlaceholder: "Add a fact (e.g., Annual income ₹1.8 lakh)...",
      addBtn: "Add",
      recheckBtn: "Re-check Eligibility",
      recheckingBtn: "Re-checking...",
      cancelBtn: "Cancel",
      removeFactAria: "Remove fact",
    },
    helpCentreMap: {
      openMapBtn: "Find nearby centres on map",
      modalTitle: "Nearby CSC & Help Centres",
      modalSubtitle: "Search verified Common Service Centres, Tehsil offices, or bank branches near you.",
      searchPlaceholder: "Enter city, district, or PIN code...",
      searchBtn: "Search",
      useMyLocationBtn: "Use my location",
      locatingBtn: "Locating...",
      locationPrivacyNote:
        "Your location is requested only when you tap this button to center the map and is never stored.",
      categories: {
        csc: "CSC Kiosk",
        tehsil: "Tehsil / Block Office",
        bank: "Bank Branch",
      },
      searchingLabel: "Searching nearby centres via Google Maps...",
      noResultsLabel: "No centres found for this search. Try a nearby town, district name, or PIN code.",
      openInGoogleMaps: "Open in Google Maps",
      openNow: "Open now",
      closedNow: "Closed",
      closeBtn: "Close",
      mapUnavailable:
        "Unable to load Google Maps right now. You can still use the official CSC Locator portal link.",
      geoDenied:
        "Location access was not granted. Enter your city, district, or PIN code above to search.",
    },
  },
  hi: {
    brandName: "स्कीम साथी",
    newSession: "नया सत्र",
    heroTitle: "3 मिनट से कम में सरकारी योजना की तैयारी जांचें",
    heroSubtitle:
      "अपनी स्थिति हिंदी, हिंग्लिश या अंग्रेजी में बताएं। हम myScheme से लाइव आधिकारिक नियम जांचते हैं, छूटे हुए दस्तावेज़ बताते हैं और सही आधिकारिक चैनल का लिंक देते हैं।",
    quickStartHeading: "या शुरू करने के लिए अपनी स्थिति चुनें",
    quickStarts: [
      {
        id: "farmer",
        title: "छोटे किसान",
        subtitle: "2 एकड़ ज़मीन · PM-KISAN, KCC और फसल बीमा",
        prompt:
          "मैं उत्तर प्रदेश का छोटा किसान हूँ और मेरे पास 2 एकड़ खेती की ज़मीन है। मैं जानना चाहता हूँ कि मैं किन सरकारी योजनाओं के लिए आवेदन कर सकता हूँ।",
      },
      {
        id: "student",
        title: "छात्र / छात्रवृत्ति",
        subtitle: "स्कूल या कॉलेज की छात्रवृत्ति सहायता",
        prompt:
          "मैं कम आय वाले परिवार का कॉलेज छात्र हूँ और केंद्र सरकार की छात्रवृत्ति योजनाएं जांचना चाहता हूँ।",
      },
      {
        id: "health",
        title: "परिवार स्वास्थ्य बीमा",
        subtitle: "अस्पताल इलाज और मातृत्व योजनाएं",
        prompt:
          "मैं जांचना चाहता हूँ कि क्या मेरा परिवार आयुष्मान भारत या अन्य सरकारी स्वास्थ्य बीमा योजनाओं के लिए पात्र है।",
      },
      {
        id: "livelihood",
        title: "कारीगर / छोटा व्यवसाय",
        subtitle: "टूलकिट, ऋण और आजीविका सहायता",
        prompt:
          "मैं स्वरोज़गार कारीगर / छोटा दुकानदार हूँ और सरकारी आजीविका या ऋण योजनाओं के बारे में जानना चाहता हूँ।",
      },
    ],
    inputPlaceholder: "अपनी स्थिति हिंदी, हिंग्लिश या अंग्रेजी में लिखें...",
    sendLabel: "भेजें",
    checkDocumentBtn: "दस्तावेज़ की फोटो जांचें",
    revokeConsentBtn: "सहमति वापस लें और डेटा हटाएं",
    consentActiveLabel: "इस सत्र के लिए फोटो सहमति सक्रिय (केवल मेमोरी में)",
    planHeading: "आपका प्लान",
    printPlanBtn: "प्रिंट / PDF",
    printPlanTitle: "स्कीम साथी — व्यक्तिगत एक्शन प्लान",
    printedOn: "प्रिंट तिथि",
    tabs: {
      matches: "संभावित योजनाएं",
      documents: "दस्तावेज़",
      nextStep: "अगला कदम",
    },
    potentialMatchDisclaimer: "संभावित मिलान, आधिकारिक सत्यापन आवश्यक है।",
    noSubmissionNotice:
      "स्कीम साथी आपकी ओर से कहीं भी आवेदन जमा नहीं करता। आधिकारिक लिंक का उपयोग करें या नज़दीकी CSC केंद्र जाएं।",
    whyItMayFit: "यह क्यों उपयुक्त हो सकती है",
    whatToVerify: "क्या सत्यापित करना है",
    whatIsMissing: "क्या कमी है",
    nextOfficialAction: "अगला आधिकारिक कदम",
    openOfficialSource: "myScheme स्रोत देखें",
    openOfficialChannel: "आधिकारिक चैनल खोलें",
    fetchedOn: "स्रोत तिथि",
    confidenceLabel: "विश्वास स्तर",
    confidenceNames: {
      High: "उच्च विश्वास",
      Medium: "मध्यम विश्वास",
      Low: "कम विश्वास",
    },
    docStatuses: {
      ready: "तैयार",
      missing: "अनुपलब्ध",
      needs_verification: "जांचें",
    },
    emptyMatches:
      "myScheme से लाइव आधिकारिक पात्रता नियम लाने के लिए ऊपर अपनी स्थिति बताएं।",
    emptyDocs:
      "योजनाएं मिलने के बाद आपके तैयार और ज़रूरी दस्तावेज़ों की सूची यहाँ दिखेगी।",
    knownFactsHeading: "आपकी साझा की गई जानकारी",
    unknownFactsHeading: "पुष्टि करना शेष है",
    humanHandoffHeading: "किसी व्यक्ति से बात करें / सहायता केंद्र खोजें",
    humanHandoffCta: "सहायता केंद्र / हेल्पलाइन देखें",
    questionsProgress: (used, max) => `पूछे गए प्रश्न: ${used} / ${max}`,
    thinkingMessage: "myScheme से आधिकारिक पात्रता नियम जांचे जा रहे हैं...",
    consentModal: {
      title: "दस्तावेज़ फोटो जांचने की सहमति",
      subtitle: "कोई भी फोटो (आधार, खतौनी, बैंक पासबुक या प्रमाण-पत्र) साझा करने से पहले कृपया पढ़ें:",
      points: [
        "फोटो केवल इस सत्र की मेमोरी में प्रोसेस होती है — किसी डेटाबेस या डिस्क में सेव नहीं होती।",
        "आधार और बैंक खाता संख्या के केवल अंतिम 4 अंक दिखाए जाते हैं और कोई भी नंबर लॉग नहीं होता।",
        "कोई भी जानकारी किसी सरकारी पोर्टल पर अपने आप जमा नहीं की जाती।",
        "यह सहमति केवल इस सत्र के लिए है और आप कभी भी इसे वापस लेकर सारा डेटा मिटा सकते हैं।",
      ],
      agreeBtn: "मैं इस सत्र के लिए सहमत हूँ",
      cancelBtn: "अभी नहीं",
    },
    uploadSheet: {
      title: "दस्तावेज़ की फोटो जांचें",
      selectTypeLabel: "1. यह कौन-सा दस्तावेज़ है?",
      choosePhotoLabel: "2. साफ फोटो चुनें या खींचें",
      choosePhotoHint: "JPG, PNG या WEBP (अधिकतम 6 MB)। केवल मेमोरी में प्रोसेस।",
      analyzingLabel: "दस्तावेज़ के प्रकार और स्पष्टता की जांच हो रही है...",
      closeBtn: "बंद करें",
    },
    documentTypes: {
      aadhaar: "आधार कार्ड",
      land_record: "भूमि रिकॉर्ड (खतौनी / 7/12 / RoR)",
      bank_passbook: "बैंक पासबुक / कैंसिल्ड चेक",
      income_certificate: "आय प्रमाण-पत्र",
      caste_certificate: "जाति / वर्ग प्रमाण-पत्र",
      ration_card: "राशन कार्ड (NFSA / BPL)",
      student_id_marksheet: "छात्र पहचान-पत्र / अंकतालिका",
      artisan_business_proof: "कारीगर / वेंडर / उद्यम प्रमाण",
      other: "अन्य सहायक दस्तावेज़",
    },
    demoLimitTitle: "डेमो सीमा समाप्त हो गई है",
    saveProgress: {
      promptTitle: "अभी पूरा नहीं हुआ? अपनी प्रगति सहेजें",
      promptBody:
        "अपनी बातचीत और योजना प्लान इस ब्राउज़र में सहेजें ताकि आप बाद में जारी रख सकें। अपलोड की गई फोटो और पहचान संख्या कभी सहेजी नहीं जातीं।",
      saveBtn: "प्रगति सहेजें",
      dismissBtn: "अभी नहीं",
      savedNotice: "प्रगति इस डिवाइस पर सहेजी गई",
      clearSavedBtn: "सहेजा डेटा हटाएं",
    },
    resumeSession: {
      title: "इस डिवाइस पर सहेजा गया सत्र मिला",
      subtitle: (savedAtText, messageCount, matchCount) =>
        `सहेजा गया: ${savedAtText} · ${messageCount} संदेश · ${matchCount} संभावित योजनाएं`,
      resumeBtn: "सत्र जारी रखें",
      resumingBtn: "जारी किया जा रहा है...",
      discardBtn: "हटाएं",
    },
    networkStatus: {
      offlineLabel: "ऑफ़लाइन — इंटरनेट कनेक्शन नहीं है",
      offlineDetail:
        "कनेक्शन वापस आने तक संदेश भेजना और दस्तावेज़ जांच रुकी हुई है। आप अपना प्लान देख या सहेज सकते हैं।",
      reconnectedLabel: "इंटरनेट वापस आ गया है",
    },
    shareChecklist: {
      shareBtn: "शेयर करें",
      summaryTitle: "साझा करने योग्य पात्रता और योजना सारांश",
      chooseSchemesLabel: "शामिल करने के लिए योजनाएं चुनें",
      previewLabel: "संदेश सारांश पूर्वावलोकन",
      whatsappBtn: "व्हाट्सऐप",
      smsBtn: "SMS",
      copyBtn: "सारांश कॉपी करें",
      copiedLabel: "क्लिपबोर्ड पर कॉपी हो गया",
      copyFailedLabel: "ऑटो-कॉपी अवरुद्ध है — ऊपर का टेक्स्ट चुनकर कॉपी करें।",
      privacyHint: "इसमें केवल पात्रता सारांश, चुनी गई योजना के लिंक और दस्तावेज़ के नाम होते हैं — कोई पहचान संख्या नहीं।",
    },
    locationFilter: {
      stateLabel: "राज्य / केंद्र शासित प्रदेश",
      allIndiaOption: "संपूर्ण भारत (राज्य चुनें)",
      districtPlaceholder: "ज़िला (वैकल्पिक)",
      selectedBadge: (stateName, district) =>
        district ? `${district}, ${stateName}` : stateName,
    },
    documentChecklist: {
      markReady: "तैयार के रूप में चुनें",
      markMissing: "तैयार हटाएं",
      markedByYou: "आपके द्वारा चिह्नित",
      photoChecked: "फोटो सत्यापित",
      howToGetBtn: "इसे कैसे बनवाएं",
      hideGuideBtn: "चरण छिपाएं",
    },
    whatIfEditor: {
      editBtn: "बदलें / क्या-अगर जांच",
      heading: "पात्रता जांचने के लिए जानकारी बदलें",
      hint: "ज़मीन, आय या राज्य जैसी जानकारी बदलें या जोड़ें और बिना नया सत्र शुरू किए पात्रता फिर से जांचें।",
      addPlaceholder: "नया तथ्य जोड़ें (जैसे: वार्षिक आय ₹1.8 लाख)...",
      addBtn: "जोड़ें",
      recheckBtn: "पात्रता फिर जांचें",
      recheckingBtn: "जांच हो रही है...",
      cancelBtn: "रद्द करें",
      removeFactAria: "तथ्य हटाएं",
    },
    helpCentreMap: {
      openMapBtn: "मानचित्र पर नज़दीकी केंद्र खोजें",
      modalTitle: "नज़दीकी CSC और सहायता केंद्र",
      modalSubtitle: "अपने आसपास कॉमन सर्विस सेंटर (CSC), तहसील कार्यालय या बैंक शाखा खोजें।",
      searchPlaceholder: "शहर, ज़िला या पिन कोड लिखें...",
      searchBtn: "खोजें",
      useMyLocationBtn: "मेरा स्थान उपयोग करें",
      locatingBtn: "स्थान खोजा जा रहा है...",
      locationPrivacyNote:
        "आपका स्थान केवल इस बटन को दबाने पर मानचित्र दिखाने के लिए उपयोग होता है और कभी सहेजा नहीं जाता।",
      categories: {
        csc: "CSC केंद्र",
        tehsil: "तहसील / ब्लॉक कार्यालय",
        bank: "बैंक शाखा",
      },
      searchingLabel: "Google Maps से नज़दीकी केंद्र खोजे जा रहे हैं...",
      noResultsLabel: "इस खोज के लिए कोई केंद्र नहीं मिला। कृपया नज़दीकी शहर, ज़िला या पिन कोड आज़माएं।",
      openInGoogleMaps: "Google Maps में खोलें",
      openNow: "अभी खुला है",
      closedNow: "बंद",
      closeBtn: "बंद करें",
      mapUnavailable:
        "इस समय Google Maps लोड नहीं हो सका। आप आधिकारिक CSC लोकेटर लिंक का उपयोग कर सकते हैं।",
      geoDenied:
        "स्थान की अनुमति नहीं मिली। खोजने के लिए ऊपर अपना शहर, ज़िला या पिन कोड लिखें।",
    },
  },
};
