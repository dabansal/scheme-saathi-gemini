import { findIndiaStateByCode } from "../../shared/indiaStates.ts";
import type {
  CitizenLocation,
  DocumentTypeKey,
  Language,
} from "../../shared/models.ts";

export interface DocumentGuide {
  steps: string[];
  officialPortalLabel: string;
  officialPortalUrl: string;
}

export function getDocumentGuide(
  docType: DocumentTypeKey,
  language: Language,
  location?: CitizenLocation,
): DocumentGuide {
  const isHi = language === "hi";
  const stateInfo = location ? findIndiaStateByCode(location.stateCode) : undefined;
  const statePortalUrl = stateInfo?.portalUrl ?? "https://www.myscheme.gov.in/";
  const statePortalLabel = stateInfo
    ? isHi
      ? stateInfo.portalTitleHi ?? `${stateInfo.nameHi} ई-डिस्ट्रिक्ट / CSC`
      : stateInfo.portalTitleEn ?? `${stateInfo.nameEn} e-District / CSC`
    : isHi
      ? "आधिकारिक myScheme / CSC पोर्टल"
      : "Official myScheme / CSC Portal";

  switch (docType) {
    case "aadhaar":
      return isHi
        ? {
            steps: [
              "अपने नज़दीकी आधार सेवा केंद्र या CSC पर जाकर आधार अपडेट / मोबाइल नंबर लिंक कराएं।",
              "OTP सत्यापन के लिए आधार से जुड़ा मोबाइल नंबर सक्रिय होना चाहिए।",
              "आप DigiLocker या myAadhaar पोर्टल से ई-आधार डाउनलोड कर सकते हैं।",
            ],
            officialPortalLabel: "myAadhaar (UIDAI) पोर्टल",
            officialPortalUrl: "https://myaadhaar.uidai.gov.in/",
          }
        : {
            steps: [
              "Visit your nearest Aadhaar Seva Kendra or CSC to update details or link your mobile number.",
              "Keep your Aadhaar-linked mobile number active for OTP and e-KYC verification.",
              "Download a valid e-Aadhaar copy anytime from myAadhaar or DigiLocker.",
            ],
            officialPortalLabel: "myAadhaar (UIDAI) Portal",
            officialPortalUrl: "https://myaadhaar.uidai.gov.in/",
          };

    case "land_record": {
      const term = stateInfo
        ? isHi
          ? stateInfo.landRecordTermHi
          : stateInfo.landRecordTermEn
        : isHi
          ? "खतौनी / 7/12 / जमाबंदी (RoR)"
          : "Khatauni / 7/12 / Jamabandi (RoR)";
      return isHi
        ? {
            steps: [
              `अपनी तहसील, पटवारी/लेखपाल या राज्य भूलेख पोर्टल से अद्यतन ${term} की प्रति निकालें।`,
              "सुनिश्चित करें कि भूमि रिकॉर्ड में आपका नाम आधार कार्ड के नाम से मेल खाता है।",
              "डिजिटल हस्ताक्षरित प्रति के लिए नज़दीकी CSC या राज्य ई-डिस्ट्रिक्ट केंद्र जाएं।",
            ],
            officialPortalLabel: statePortalLabel,
            officialPortalUrl: statePortalUrl,
          }
        : {
            steps: [
              `Obtain an updated copy of your ${term} from your state Bhulekh portal, Tehsil office, or Patwari/Lekhpal.`,
              "Verify that the owner name and land area match your Aadhaar record.",
              "For a digitally signed copy, visit your nearest CSC or state e-District portal.",
            ],
            officialPortalLabel: statePortalLabel,
            officialPortalUrl: statePortalUrl,
          };
    }

    case "bank_passbook":
      return isHi
        ? {
            steps: [
              "अपनी बैंक शाखा से अपडेटेड पासबुक या कैंसिल्ड चेक लें जिसमें IFSC कोड और खाताधारक का नाम साफ लिखा हो।",
              "बैंक शाखा में जाकर Aadhaar-NPCI (DBT) सीडिंग सक्रिय होने की पुष्टि करें।",
              "myAadhaar पोर्टल पर 'Bank Seeding Status' से ऑनलाइन DBT स्थिति जांचें।",
            ],
            officialPortalLabel: "myAadhaar बैंक सीडिंग जांच",
            officialPortalUrl: "https://myaadhaar.uidai.gov.in/",
          }
        : {
            steps: [
              "Get an updated bank passbook first page or cancelled cheque clearly showing your name and IFSC code.",
              "Ask your bank branch to confirm Aadhaar-NPCI (DBT) seeding is active on the account.",
              "You can also check your DBT Bank Seeding Status online via myAadhaar.",
            ],
            officialPortalLabel: "myAadhaar Bank Seeding Check",
            officialPortalUrl: "https://myaadhaar.uidai.gov.in/",
          };

    case "income_certificate":
      return isHi
        ? {
            steps: [
              "अपने राज्य के ई-डिस्ट्रिक्ट पोर्टल या नज़दीकी CSC केंद्र से आय प्रमाण-पत्र के लिए आवेदन करें।",
              "आधार कार्ड, स्व-घोषणा पत्र और राशन कार्ड/पते का प्रमाण साथ रखें।",
              "तहसीलदार/राजस्व अधिकारी द्वारा जारी डिजिटल प्रमाण-पत्र की वैधता अवधि जांचें।",
            ],
            officialPortalLabel: statePortalLabel,
            officialPortalUrl: statePortalUrl,
          }
        : {
            steps: [
              "Apply through your state e-District portal or nearest CSC kiosk for an official Income Certificate.",
              "Carry Aadhaar, address proof/ration card, and a signed income self-declaration.",
              "Check that the Tehsildar/Revenue certificate is within its valid period for the current financial year.",
            ],
            officialPortalLabel: statePortalLabel,
            officialPortalUrl: statePortalUrl,
          };

    case "caste_certificate":
      return isHi
        ? {
            steps: [
              "राज्य ई-डिस्ट्रिक्ट पोर्टल या CSC केंद्र पर SC/ST/OBC प्रमाण-पत्र के लिए आवेदन करें।",
              "आधार, निवास प्रमाण और पारिवारिक/राजस्व रिकॉर्ड संलग्न करें।",
              "यदि केंद्र सरकार की योजना (जैसे NSP छात्रवृत्ति) है, तो केंद्रीय प्रारूप की पुष्टि करें।",
            ],
            officialPortalLabel: statePortalLabel,
            officialPortalUrl: statePortalUrl,
          }
        : {
            steps: [
              "Apply for a digital SC/ST/OBC certificate via your state e-District portal or nearest CSC.",
              "Keep Aadhaar, residence proof, and supporting family revenue/community records ready.",
              "For central schemes (e.g., NSP scholarships), confirm whether central-format or non-creamy-layer status is needed.",
            ],
            officialPortalLabel: statePortalLabel,
            officialPortalUrl: statePortalUrl,
          };

    case "ration_card":
      return isHi
        ? {
            steps: [
              "खाद्य एवं नागरिक आपूर्ति विभाग (NFSA) पोर्टल या CSC से अपने राशन कार्ड और परिवार के सदस्यों का विवरण जांचें।",
              "नया राशन कार्ड या सदस्य जोड़ने के लिए राज्य ई-डिस्ट्रिक्ट / खाद्य विभाग पोर्टल पर आवेदन करें।",
              "राशन कार्ड की डिजिटल प्रति DigiLocker से प्राप्त की जा सकती है।",
            ],
            officialPortalLabel: "राष्ट्रीय खाद्य सुरक्षा पोर्टल (NFSA)",
            officialPortalUrl: "https://nfsa.gov.in/",
          }
        : {
            steps: [
              "Verify your NFSA Ration Card status and listed family members on the official NFSA portal or at a CSC.",
              "To add a family member or request a copy, apply via your state Food & Civil Supplies / e-District portal.",
              "You can also pull a digital copy from DigiLocker.",
            ],
            officialPortalLabel: "National Food Security Portal (NFSA)",
            officialPortalUrl: "https://nfsa.gov.in/",
          };

    case "student_id_marksheet":
      return isHi
        ? {
            steps: [
              "अपने स्कूल/कॉलेज से बोनाफाइड प्रमाण-पत्र (Bonafide) और पिछली परीक्षा की सत्यापित अंकतालिका प्राप्त करें।",
              "सुनिश्चित करें कि संस्थान का AISHE / UDISE कोड राष्ट्रीय छात्रवृत्ति पोर्टल (NSP) पर पंजीकृत है।",
              "CBSE/राज्य बोर्ड की अंकतालिका DigiLocker से भी डाउनलोड की जा सकती है।",
            ],
            officialPortalLabel: "राष्ट्रीय छात्रवृत्ति पोर्टल (NSP)",
            officialPortalUrl: "https://scholarships.gov.in/",
          }
        : {
            steps: [
              "Collect a Bonafide Student Certificate and your latest verified marksheet from your school or college.",
              "Confirm your institution's AISHE / UDISE code is registered on the National Scholarship Portal (NSP).",
              "Board marksheets can also be retrieved digitally via DigiLocker.",
            ],
            officialPortalLabel: "National Scholarship Portal (NSP)",
            officialPortalUrl: "https://scholarships.gov.in/",
          };

    case "artisan_business_proof":
      return isHi
        ? {
            steps: [
              "कारीगर या लघु व्यवसाय के लिए निःशुल्क उद्यम पंजीकरण (Udyam Assist / Udyam) ऑनलाइन या CSC से कराएं।",
              "स्ट्रीट वेंडर हैं तो नगर निकाय (ULB) से वेंडिंग प्रमाण-पत्र या सिफारिश पत्र (LoR) प्राप्त करें।",
              "पंजीकरण के लिए आधार और बैंक खाता विवरण साथ रखें।",
            ],
            officialPortalLabel: "आधिकारिक उद्यम पंजीकरण पोर्टल",
            officialPortalUrl: "https://udyamregistration.gov.in/",
          }
        : {
            steps: [
              "Register free of cost on the official Udyam / Udyam Assist portal (or through a CSC) for micro-business proof.",
              "Street vendors can request a Certificate of Vending or Letter of Recommendation (LoR) from their Urban Local Body.",
              "Keep your Aadhaar and active bank account details ready during registration.",
            ],
            officialPortalLabel: "Official Udyam Registration Portal",
            officialPortalUrl: "https://udyamregistration.gov.in/",
          };

    default:
      return isHi
        ? {
            steps: [
              "इस दस्तावेज़ के लिए अपने राज्य के ई-डिस्ट्रिक्ट पोर्टल या नज़दीकी CSC केंद्र से मार्गदर्शन लें।",
              "आधार और पते के प्रमाण की मूल प्रति साथ ले जाएं।",
            ],
            officialPortalLabel: statePortalLabel,
            officialPortalUrl: statePortalUrl,
          }
        : {
            steps: [
              "Check issuance requirements on your state e-District portal or visit your nearest CSC kiosk.",
              "Carry your original Aadhaar and proof of address for verification.",
            ],
            officialPortalLabel: statePortalLabel,
            officialPortalUrl: statePortalUrl,
          };
  }
}
