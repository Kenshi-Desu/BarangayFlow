/**
 * kiosk.js — BarangayFlow Self-Service Document Kiosk
 *
 * Works seamlessly both as a public/walk-in self-service kiosk (no login needed)
 * and when signed in (auto-fills resident profile and merges live Firestore services).
 * All kiosk tickets are saved to Firestore `kioskRequests` for Barangay Staff lookup.
 */

import { auth, db } from "./firebase.js";
import {
  collection,
  addDoc,
  getDoc,
  getDocs,
  doc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── BARANGAY STA. RITA PUROK → STREETS (matches register.html) ──────────
const PUROK_STREETS = {
  "Purok 1":  ["Horseshoe Drive", "Filtration Road", "Avocado Street", "Manggahan Street", "Manggahan Extension", "Mabolo Street", "Santolan Street", "Rosal Street", "Amapola Street", "Sampaguita Street", "Azucena Street", "Camia Street", "Begonia Street", "Cabling Lane", "Purok 1-A Road"],
  "Purok 2":  ["Gordon Avenue", "Rizal Avenue", "Del Rosario Street", "Tabacuhan Road", "Balic-Balic Street", "Cerezo Street", "Ilang-Ilang Street", "Lirio Street", "Magnolia Street", "Camia Extension"],
  "Purok 3":  ["Gordon Avenue", "Sampaguita Street (Purok 3E)", "Magiting Street", "Maliwanag Street", "Mapayapa Street", "Masaya Street", "Masipag Street", "Maligaya Street", "Mapagkumbaba Street", "Purok 3-A Road"],
  "Purok 4":  ["Gordon Avenue", "Sta. Rita Road", "Leo Street", "Libra Street", "Virgo Street", "Aries Street", "Gemini Street", "Taurus Street", "Sagittarius Street", "Capricorn Street"],
  "Purok 5":  ["Gordon Avenue", "Bagumbayan Street", "Lanzones Street", "Mangga Street", "Guyabano Street", "Chico Street", "Siniguelas Street", "Bayabas Street", "Papaya Street", "Caimito Street"],
  "Purok 6":  ["Gordon Avenue", "Holy Spirit Drive", "Holy Spirit Village Road (Purok 6E)", "Tabacuhan Street", "Casimiro Street", "Rizal Avenue Extension", "San Jose Street", "San Roque Street", "Del Pilar Street", "Burgos Street"],
  "Purok 7":  ["Gordon Avenue", "Katipunan Street", "Maharlika Street", "Kabayani Street", "Bayanihan Street", "Pagkakaisa Street", "Kalayaan Street", "Mabini Street", "Luna Street", "Bonifacio Street"],
  "Purok 8":  ["Gordon Avenue", "Maunlad Street", "Malinis Street", "Bayani Street", "Cristobal Street", "Dominguez Street", "Bacay Street", "Nebrida Street", "Piano Street", "Sevilla Street"],
  "Purok 9":  ["Sta. Rita Road", "Riverside Drive", "Mabayuan Road", "Kanlaon Street", "Apo Street", "Pulag Street", "Halcon Street", "Baco Street", "Tabayoc Street", "Mayon Extension"],
  "Purok 10": ["Gordon Avenue Extension", "Narra Street", "Molave Street", "Yakal Street", "Kamagong Street", "Ipil Street", "Tindalo Street", "Acacia Street", "Banaba Street", "Dao Street"],
  "Purok 11": ["Gordon Avenue Extension", "Aguho Street", "Dao Extension", "Bitangcol Street", "Cristobal Extension", "Bacay Extension", "Donnabel Street", "Ariola Street", "Arreza Street", "Pangcatan Street"],
  "Purok 12": ["Sta. Rita Road", "Rizal Street", "Aguinaldo Street", "Osias Street", "Quezon Street", "Laurel Street", "Magsaysay Street", "Garcia Street", "Macapagal Street", "Marcos Street"],
  "Purok 13": ["Sta. Rita Road", "Labanos Street", "Sitaw Street", "Pechay Street", "Kangkong Street", "Talong Street", "Kamatis Street", "Patola Street", "Ampalaya Street", "Sigarilyas Street"],
  "Purok 14": ["Sta. Rita Road", "Sampaguita Extension", "Ilang-Ilang Extension", "Rosal Extension", "Amapola Extension", "Boundary Road", "New Road", "End Road", "Riverside Extension", "Mabayuan Extension"]
};

// ── STANDARD DOCUMENTS CATALOG (based on existing project document types) ─
const STANDARD_DOCUMENTS = [
  {
    id: "clearance",
    serviceId: "std-clearance",
    name: "Barangay Clearance",
    code: "CLR",
    category: "Clearances",
    windowLabel: "Window 1 — Clearances & Certificates",
    fee: 50,
    days: 0,
    processingLabel: "Same Day (15–30 mins)",
    sameDay: true,
    badge: "Most Requested",
    tone: "blue",
    description: "Official barangay clearance certifying good moral standing and no derogatory record in Barangay Sta. Rita.",
    requirements: [
      "Valid Government-Issued ID (original + photocopy)",
      "Community Tax Certificate (Cedula) for current year"
    ],
    purposePresets: ["Local Employment", "NBI / Police Clearance", "Postal ID Application", "Bank / Loan Requirement", "Travel / Passport"],
    extraType: null
  },
  {
    id: "residency",
    serviceId: "std-residency",
    name: "Certificate of Residency",
    code: "RES",
    category: "Certificates",
    windowLabel: "Window 1 — Clearances & Certificates",
    fee: 50,
    days: 0,
    processingLabel: "Same Day (15–30 mins)",
    sameDay: true,
    badge: "",
    tone: "blue",
    description: "Official certification proving that the applicant is a bonafide resident of Barangay Sta. Rita, Olongapo City.",
    requirements: [
      "Valid Government-Issued ID showing Sta. Rita address",
      "Proof of Billing or Lease Contract (if ID has old address)"
    ],
    purposePresets: ["School / Scholarship Enrollment", "Government ID Application", "Employment Requirement", "Utility / Internet Application"],
    extraType: null
  },
  {
    id: "indigency",
    serviceId: "std-indigency",
    name: "Certificate of Indigency",
    code: "IND",
    category: "Certificates",
    windowLabel: "Window 1 — Clearances & Certificates",
    fee: 0,
    days: 0,
    processingLabel: "Same Day (15–20 mins)",
    sameDay: true,
    badge: "Fee-Exempt",
    tone: "green",
    description: "Certification issued to residents seeking medical, educational, burial, legal, or DSWD financial assistance.",
    requirements: [
      "Valid Government-Issued ID or Voter's / PhilSys ID",
      "Supporting Referral / Hospital or School Slip (if applicable)"
    ],
    purposePresets: ["Medical / Hospital Assistance", "Scholarship / Educational Aid", "DSWD / AICS Financial Aid", "Burial Assistance", "PAO Legal Assistance"],
    extraType: null
  },
  {
    id: "business",
    serviceId: "std-business",
    name: "Business Permit / Business Clearance",
    code: "BIZ",
    category: "Clearances",
    windowLabel: "Window 2 — Permits & Barangay IDs",
    fee: 300,
    days: 2,
    processingLabel: "1–2 Working Days",
    sameDay: false,
    badge: "Business",
    tone: "amber",
    description: "Mandatory Barangay Business Clearance for new enterprise registration or annual City Business Permit renewal.",
    requirements: [
      "Valid Government-Issued ID of Business Owner",
      "DTI / SEC Registration Certificate",
      "Contract of Lease or Land Title / Tax Declaration",
      "Previous Barangay Business Clearance (if renewal)"
    ],
    purposePresets: ["New Business Permit Application", "Annual Business Permit Renewal", "Mayor's Permit Requirement"],
    extraType: "business"
  },
  {
    id: "job_seeker",
    serviceId: "std-job-seeker",
    name: "First Time Job Seeker Certificate",
    code: "FTJ",
    category: "Certificates",
    windowLabel: "Window 1 — Clearances & Certificates",
    fee: 0,
    days: 0,
    processingLabel: "Same Day (15–30 mins)",
    sameDay: true,
    badge: "Free • RA 11261",
    tone: "green",
    description: "Fee-exempt barangay certification & Oath of Undertaking under the First Time Jobseekers Assistance Act (RA 11261).",
    requirements: [
      "Valid ID or School ID",
      "Birth Certificate (photocopy)",
      "Proof of residency in Barangay Sta. Rita (at least 6 months)"
    ],
    purposePresets: ["First-Time Employment Application", "Fee-Exempt Pre-Employment Clearances"],
    extraType: "job_seeker"
  },
  {
    id: "barangay_id",
    serviceId: "std-barangay-id",
    name: "Barangay ID",
    code: "BID",
    category: "IDs & Assistance",
    windowLabel: "Window 2 — Permits & Barangay IDs",
    fee: 50,
    days: 2,
    processingLabel: "1–2 Working Days",
    sameDay: false,
    badge: "Resident ID",
    tone: "purple",
    description: "Official Barangay Sta. Rita Resident Identification Card with control number and emergency contact details.",
    requirements: [
      "1x1 or 2x2 ID Photo (or on-site capture at Window 2)",
      "Birth Certificate or Valid ID / Proof of Residency"
    ],
    purposePresets: ["Official Barangay Identification", "Local Transactions & Verification", "Barangay ID Renewal / Replacement"],
    extraType: "barangay_id"
  },
  {
    id: "good_moral",
    serviceId: "std-good-moral",
    name: "Certificate of Good Moral Character",
    code: "GMC",
    category: "Certificates",
    windowLabel: "Window 1 — Clearances & Certificates",
    fee: 50,
    days: 0,
    processingLabel: "Same Day (15–30 mins)",
    sameDay: true,
    badge: "",
    tone: "blue",
    description: "Attestation of reputable community standing and absence of derogatory complaints or blotter records on file.",
    requirements: [
      "Valid Government-Issued ID",
      "Community Tax Certificate (Cedula)"
    ],
    purposePresets: ["Employment / Promotion", "School / Board Exam Requirement", "Scholarship Application", "Licensing Requirement"],
    extraType: null
  },
  {
    id: "medical",
    serviceId: "std-medical",
    name: "Medical Assistance Certificate",
    code: "MED",
    category: "IDs & Assistance",
    windowLabel: "Window 3 — Assistance & Desk",
    fee: 0,
    days: 0,
    processingLabel: "Same Day (Priority)",
    sameDay: true,
    badge: "Priority • Free",
    tone: "rose",
    description: "Barangay endorsement and certification for hospital bills, laboratory diagnostics, medicine, or PCSO/DSWD aid.",
    requirements: [
      "Valid Government-Issued ID of Claimant",
      "Medical Abstract, Doctor's Prescription, or Hospital Billing Statement"
    ],
    purposePresets: ["Hospitalization / Billing Assistance", "Laboratory / Diagnostic Test Aid", "Maintenance Medicine Assistance", "PCSO / Malasakit Endorsement"],
    extraType: "medical"
  },
  {
    id: "blotter",
    serviceId: "std-blotter",
    name: "Complaint / Blotter Report",
    code: "BLT",
    category: "Blotter & Reports",
    windowLabel: "Window 3 — Assistance & Desk",
    fee: 0,
    days: 0,
    processingLabel: "Immediate Desk Intake",
    sameDay: true,
    badge: "Desk Intake",
    tone: "rose",
    description: "File an incident log, mediation request, or official Barangay Blotter entry with the Barangay Desk Officer.",
    requirements: [
      "Valid Government-Issued ID of Complainant",
      "Supporting Evidence, Photos, or Incident Details (if available)"
    ],
    purposePresets: ["Official Blotter Entry / Record", "Barangay Mediation (Lupong Tagapamayapa)", "Lost Document / Incident Certification", "Police / Insurance Referral"],
    extraType: "blotter"
  }
];

const CATEGORIES = [
  { id: "All",               label: "All Documents" },
  { id: "Clearances",        label: "Clearances" },
  { id: "Certificates",      label: "Certificates" },
  { id: "IDs & Assistance",  label: "IDs & Assistance" },
  { id: "Blotter & Reports", label: "Blotter & Reports" }
];

// ── STORAGE KEYS ──────────────────────────────────────────────────────────
const LS_QUEUE_KEY   = "bf_kiosk_queue_state";
const LS_TICKETS_KEY = "bf_kiosk_tickets";

// ── APPLICATION STATE ─────────────────────────────────────────────────────
const state = {
  step: 1,
  documents: STANDARD_DOCUMENTS.map(d => ({ ...d })),
  selectedIds: new Set(),
  activeCategory: "All",
  quickFilter: "all",
  searchQuery: "",
  modalDocId: null,
  currentUser: null,
  isStaffUser: false,
  lastTicket: null
};

// ── HELPERS ───────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getPhilippineTime() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  return new Date(utcMs + 8 * 3_600_000);
}

function getPhtDateKey() {
  const pht = getPhilippineTime();
  const y = pht.getFullYear();
  const m = String(pht.getMonth() + 1).padStart(2, "0");
  const d = String(pht.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isWithinWorkingHours() {
  const pht = getPhilippineTime();
  const day = pht.getDay();
  const hour = pht.getHours();
  return day >= 1 && day <= 5 && hour >= 8 && hour < 17;
}

function formatPeso(amount) {
  const num = Number(amount) || 0;
  if (num <= 0) return "Free";
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function showToast(msg, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function getSelectedDocs() {
  return state.documents.filter(d => state.selectedIds.has(d.id));
}

function getTotalFee(docs) {
  return docs.reduce((sum, d) => sum + (Number(d.fee) || 0), 0);
}

function getUniqueRequirements(docs) {
  const seen = new Set();
  const list = [];
  docs.forEach(docItem => {
    (docItem.requirements || []).forEach(req => {
      const key = req.trim().toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        list.push(req.trim());
      }
    });
  });
  if (list.length === 0) {
    list.push("Valid Government-Issued ID");
  }
  return list;
}

function getWindowSummary(docs) {
  const windows = [...new Set(docs.map(d => d.windowLabel || "Window 1 — Clearances & Certificates"))];
  if (windows.length === 1) return windows[0];
  return `${windows[0].split("—")[0].trim()} (Multi-Document Counter)`;
}

function getDocIconSvg(code) {
  switch (code) {
    case "BIZ":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
    case "BID":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><line x1="14" y1="10" x2="19" y2="10"/><line x1="14" y1="14" x2="18" y2="14"/></svg>`;
    case "MED":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
    case "BLT":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    case "FTJ":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`;
    case "IND":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
  }
}

function getCategoryIconSvg(catId) {
  switch (catId) {
    case "Clearances":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    case "Certificates":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    case "IDs & Assistance":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
    case "Blotter & Reports":
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
  }
}

// ── OFFICE HOURS PILL ─────────────────────────────────────────────────────
function updateOfficeStatus() {
  const pill = document.getElementById("officeStatusPill");
  const txt  = document.getElementById("officeStatusText");
  if (!pill || !txt) return;

  const pht = getPhilippineTime();
  const timeStr = pht.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });
  const open = isWithinWorkingHours();

  pill.classList.toggle("closed", !open);
  txt.textContent = open
    ? `Barangay Open Now • ${timeStr} PHT`
    : `Outside Office Hours • ${timeStr} PHT`;
}

// ── QUEUE NUMBER & TICKET STORAGE ─────────────────────────────────────────
function allocateNextQueueNumber() {
  const today = getPhtDateKey();
  let stored = { date: today, seq: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(LS_QUEUE_KEY) || "null");
    if (raw && raw.date === today && typeof raw.seq === "number") {
      stored = raw;
    }
  } catch { /* ignore corrupted storage */ }

  stored.seq += 1;
  localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(stored));

  const padded = String(stored.seq).padStart(3, "0");
  return `K-${padded}`;
}

function getSavedTickets() {
  try {
    const list = JSON.parse(localStorage.getItem(LS_TICKETS_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveTicketToHistory(ticket) {
  const list = getSavedTickets();
  list.unshift(ticket);
  localStorage.setItem(LS_TICKETS_KEY, JSON.stringify(list.slice(0, 15)));
  updateTicketCountBadge();
}

function updateTicketCountBadge() {
  const badge = document.getElementById("ticketCountBadge");
  if (!badge) return;
  badge.textContent = String(getSavedTickets().length);
}

// ── FIRESTORE OPTIONAL SYNC (WHEN SIGNED IN) ──────────────────────────────
function mapServiceNameToStdId(name = "") {
  const s = name.toLowerCase();
  if (s.includes("business") || s.includes("permit")) return "business";
  if (s.includes("clearance")) return "clearance";
  if (s.includes("residency")) return "residency";
  if (s.includes("indigency")) return "indigency";
  if (s.includes("job")) return "job_seeker";
  if (s.includes("barangay id") || s === "id") return "barangay_id";
  if (s.includes("moral") || s.includes("character")) return "good_moral";
  if (s.includes("medical")) return "medical";
  if (s.includes("blotter") || s.includes("complaint")) return "blotter";
  return null;
}

async function syncAuthenticatedContext(user) {
  const statusBar = document.getElementById("userStatusBar");
  try {
    const [userSnap, adminSnap] = await Promise.all([
      getDoc(doc(db, "users", user.uid)).catch(() => null),
      getDoc(doc(db, "admins", user.uid)).catch(() => null)
    ]);

    if (adminSnap && adminSnap.exists()) {
      state.isStaffUser = ["staff", "admin", "it"].includes(adminSnap.data().role);
    }

    if (userSnap && userSnap.exists()) {
      const u = userSnap.data();
      const fullName = `${u.firstName || ""} ${u.lastName || ""}`.trim();
      const nameEl = document.getElementById("applicantFullName");
      const phoneEl = document.getElementById("applicantContact");
      const addrEl = document.getElementById("applicantAddress");
      if (nameEl && !nameEl.value && fullName) nameEl.value = fullName;
      if (phoneEl && !phoneEl.value && u.phone) phoneEl.value = u.phone;
      if (addrEl && !addrEl.value && u.address) addrEl.value = u.address;

      if (statusBar) {
        statusBar.innerHTML = `<span>Signed in as <strong>${esc(fullName || user.email)}</strong> — Your profile information is pre-filled. Present your kiosk queue ticket at the Barangay Hall counter.</span>`;
        statusBar.classList.remove("hidden");
      }
    } else if (state.isStaffUser && statusBar) {
      statusBar.innerHTML = `<span>Barangay Kiosk Desk Mode (<strong>${esc(user.email)}</strong>) — Walk-in tickets submitted here will be saved for Barangay Staff kiosk lookup.</span>`;
      statusBar.classList.remove("hidden");
    }

    // Load live Firestore services and merge with standard catalog
    const svcSnap = await getDocs(collection(db, "services"));
    if (!svcSnap.empty) {
      const merged = STANDARD_DOCUMENTS.map(d => ({ ...d }));
      const disabledStdIds = new Set();

      svcSnap.forEach(docSnap => {
        const data = docSnap.data();
        const stdId = mapServiceNameToStdId(data.name || "");
        if (stdId) {
          if (data.active === false) {
            disabledStdIds.add(stdId);
            return;
          }
          const target = merged.find(item => item.id === stdId);
          if (target) {
            target.serviceId = docSnap.id;
            if (data.description) target.description = data.description;
            if (typeof data.fee === "number") target.fee = data.fee;
            if (typeof data.days === "number") {
              target.days = data.days;
              target.sameDay = data.days === 0;
              target.processingLabel = data.days === 0 ? "Same Day" : `${data.days} working day(s)`;
            }
            if (Array.isArray(data.documents) && data.documents.length) {
              target.requirements = data.documents;
            }
          }
        } else if (data.active !== false && data.name) {
          merged.push({
            id: `fs-${docSnap.id}`,
            serviceId: docSnap.id,
            name: data.name,
            code: "DOC",
            category: "Certificates",
            windowLabel: "Window 1 — Clearances & Certificates",
            fee: Number(data.fee) || 0,
            days: Number(data.days) || 0,
            processingLabel: Number(data.days) > 0 ? `${data.days} working day(s)` : "Same Day",
            sameDay: (Number(data.days) || 0) === 0,
            badge: Number(data.fee) === 0 ? "Free" : "",
            tone: "blue",
            description: data.description || "Official Barangay Sta. Rita document request.",
            requirements: Array.isArray(data.documents) && data.documents.length ? data.documents : ["Valid Government-Issued ID"],
            purposePresets: ["Official Requirement", "Employment", "Personal Record"],
            extraType: null
          });
        }
      });

      state.documents = merged.filter(item => !disabledStdIds.has(item.id));
      renderCategories();
      renderDocsGrid();
      renderTrayBar();
    }
  } catch (err) {
    console.warn("[Kiosk] Optional Firestore sync skipped:", err?.message || err);
  }
}

// ── STEPPER NAVIGATION ────────────────────────────────────────────────────
function goToStep(stepNumber) {
  state.step = stepNumber;

  const view1 = document.getElementById("step1View");
  const view2 = document.getElementById("step2View");
  const view3 = document.getElementById("step3View");
  const trayBar = document.getElementById("kioskTrayBar");

  view1?.classList.toggle("hidden", stepNumber !== 1);
  view2?.classList.toggle("hidden", stepNumber !== 2);
  view3?.classList.toggle("hidden", stepNumber !== 3);
  trayBar?.classList.toggle("hidden", stepNumber !== 1);

  const b1 = document.getElementById("stepBtn1");
  const b2 = document.getElementById("stepBtn2");
  const b3 = document.getElementById("stepBtn3");

  [b1, b2, b3].forEach(b => b?.classList.remove("active", "done", "clickable"));

  if (stepNumber === 1) {
    b1?.classList.add("active");
    if (b2) b2.disabled = state.selectedIds.size === 0;
    if (state.selectedIds.size > 0) b2?.classList.add("clickable");
    if (b3) b3.disabled = !state.lastTicket;
  } else if (stepNumber === 2) {
    b1?.classList.add("done", "clickable");
    b2?.classList.add("active");
    if (b2) b2.disabled = false;
    if (b3) b3.disabled = !state.lastTicket;
    renderStep2Context();
  } else if (stepNumber === 3) {
    b1?.classList.add("done", "clickable");
    b2?.classList.add("done");
    b3?.classList.add("active");
    if (b3) b3.disabled = false;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── STEP 1 RENDERING ──────────────────────────────────────────────────────
function renderCategories() {
  const container = document.getElementById("categoryList");
  if (!container) return;

  container.innerHTML = CATEGORIES.map(cat => {
    const count = cat.id === "All"
      ? state.documents.length
      : state.documents.filter(d => d.category === cat.id).length;
    const isActive = state.activeCategory === cat.id;

    return `
      <button type="button" class="cat-btn${isActive ? " active" : ""}" data-cat="${esc(cat.id)}">
        <span class="cat-btn-left">
          <span class="cat-icon">${getCategoryIconSvg(cat.id)}</span>
          <span>${esc(cat.label)}</span>
        </span>
        <span class="cat-count">${count}</span>
      </button>`;
  }).join("");

  container.querySelectorAll(".cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.activeCategory = btn.dataset.cat;
      renderCategories();
      renderDocsGrid();
    });
  });
}

function getFilteredDocs() {
  const q = state.searchQuery.trim().toLowerCase();
  return state.documents.filter(docItem => {
    if (state.activeCategory !== "All" && docItem.category !== state.activeCategory) {
      return false;
    }
    if (state.quickFilter === "free" && (Number(docItem.fee) || 0) > 0) {
      return false;
    }
    if (state.quickFilter === "sameday" && !docItem.sameDay) {
      return false;
    }
    if (q) {
      const hay = `${docItem.name} ${docItem.description} ${docItem.category} ${docItem.code}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderDocsGrid() {
  const grid = document.getElementById("docsGrid");
  if (!grid) return;

  const docs = getFilteredDocs();
  if (!docs.length) {
    grid.innerHTML = `
      <div class="empty-docs">
        <h4>No matching documents found</h4>
        <p>Try clearing your search or choosing "All Documents" on the left.</p>
      </div>`;
    return;
  }

  grid.innerHTML = docs.map(docItem => {
    const selected = state.selectedIds.has(docItem.id);
    const feeVal = Number(docItem.fee) || 0;
    const isFree = feeVal <= 0;
    const toneClass = docItem.tone ? `tone-${docItem.tone}` : "";
    const reqPreview = (docItem.requirements || []).slice(0, 2).map(esc).join(" • ");

    return `
      <article class="doc-card${selected ? " selected" : ""}" data-doc-id="${esc(docItem.id)}">
        <div>
          <div class="doc-card-top">
            <div class="doc-tile-icon ${toneClass}">
              ${getDocIconSvg(docItem.code)}
            </div>
            <div class="doc-badges">
              <span class="fee-badge${isFree ? " free" : ""}">${isFree ? "FREE" : formatPeso(feeVal)}</span>
              ${docItem.badge ? `<span class="tag-badge">${esc(docItem.badge)}</span>` : ""}
            </div>
          </div>

          <div class="doc-card-body">
            <h3>${esc(docItem.name)}</h3>
            <p>${esc(docItem.description)}</p>
          </div>

          <div class="doc-meta-row">
            <span class="doc-meta-item">${esc(docItem.processingLabel)}</span>
            <span class="doc-meta-item">${esc(docItem.windowLabel.split("—")[0].trim())}</span>
          </div>
        </div>

        <div>
          <div class="doc-reqs-preview">
            <strong>Bring:</strong> ${reqPreview}
          </div>
        </div>

        <div class="doc-card-actions">
          <button type="button" class="btn-info" data-action="details" data-doc-id="${esc(docItem.id)}">
            Requirements
          </button>
          <button type="button" class="btn-select-doc" data-action="toggle" data-doc-id="${esc(docItem.id)}">
            ${selected ? "✓ Added to Request" : "+ Select Document"}
          </button>
        </div>
      </article>`;
  }).join("");

  grid.querySelectorAll("[data-action='details']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDocModal(btn.dataset.docId);
    });
  });

  grid.querySelectorAll("[data-action='toggle']").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDocumentSelection(btn.dataset.docId);
    });
  });

  grid.querySelectorAll(".doc-card").forEach(card => {
    card.addEventListener("click", () => {
      toggleDocumentSelection(card.dataset.docId);
    });
  });
}

function toggleDocumentSelection(docId) {
  const docItem = state.documents.find(d => d.id === docId);
  if (!docItem) return;

  if (state.selectedIds.has(docId)) {
    state.selectedIds.delete(docId);
    showToast(`Removed "${docItem.name}" from tray.`, "info");
  } else {
    state.selectedIds.add(docId);
    showToast(`Added "${docItem.name}" to your request tray.`, "success");
  }

  renderDocsGrid();
  renderTrayBar();

  const b2 = document.getElementById("stepBtn2");
  if (b2) {
    b2.disabled = state.selectedIds.size === 0;
    b2.classList.toggle("clickable", state.selectedIds.size > 0);
  }
}

function renderTrayBar() {
  const selected = getSelectedDocs();
  const countEl = document.getElementById("trayCountText");
  const feeEl   = document.getElementById("trayFeePill");
  const chipsEl = document.getElementById("trayChips");
  const clearBtn = document.getElementById("clearTrayBtn");
  const nextBtn  = document.getElementById("proceedInfoBtn");

  const totalFee = getTotalFee(selected);
  if (countEl) countEl.textContent = `My Request Tray (${selected.length} selected)`;
  if (feeEl) feeEl.textContent = `Est. Fee: ${formatPeso(totalFee)}`;
  if (clearBtn) clearBtn.disabled = selected.length === 0;
  if (nextBtn) nextBtn.disabled = selected.length === 0;

  if (!chipsEl) return;
  if (!selected.length) {
    chipsEl.innerHTML = `<span class="tray-empty-hint">Tap any document above to add it to your request.</span>`;
    return;
  }

  chipsEl.innerHTML = selected.map(docItem => `
    <span class="tray-chip">
      <span>${esc(docItem.name)}</span>
      <button type="button" data-remove-id="${esc(docItem.id)}" aria-label="Remove ${esc(docItem.name)}">&times;</button>
    </span>
  `).join("");

  chipsEl.querySelectorAll("[data-remove-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      toggleDocumentSelection(btn.dataset.removeId);
    });
  });
}

// ── DOCUMENT DETAILS MODAL ────────────────────────────────────────────────
function openDocModal(docId) {
  const docItem = state.documents.find(d => d.id === docId);
  if (!docItem) return;
  state.modalDocId = docId;

  const modal = document.getElementById("docDetailModal");
  const title = document.getElementById("docModalTitle");
  const body  = document.getElementById("docModalBody");
  const toggleBtn = document.getElementById("modalToggleSelectBtn");

  if (title) title.textContent = docItem.name;
  if (body) {
    const reqItems = (docItem.requirements || []).map(r => `<li>${esc(r)}</li>`).join("");
    body.innerHTML = `
      <p class="field-hint">${esc(docItem.description)}</p>
      <div class="modal-meta-grid">
        <div class="modal-meta-box">
          <small>Standard Fee</small>
          <strong>${formatPeso(docItem.fee)}</strong>
        </div>
        <div class="modal-meta-box">
          <small>Processing</small>
          <strong>${esc(docItem.processingLabel)}</strong>
        </div>
        <div class="modal-meta-box">
          <small>Claim Counter</small>
          <strong>${esc(docItem.windowLabel.split("—")[0].trim())}</strong>
        </div>
      </div>
      <div>
        <h4>Requirements to Bring to Barangay Hall</h4>
        <ul class="modal-req-list">${reqItems}</ul>
      </div>
    `;
  }

  if (toggleBtn) {
    toggleBtn.textContent = state.selectedIds.has(docId) ? "Remove from Request" : "Add to Request";
  }

  modal?.classList.add("open");
}

function closeDocModal() {
  document.getElementById("docDetailModal")?.classList.remove("open");
  state.modalDocId = null;
}

// ── STEP 2: FILL UP INFORMATION ───────────────────────────────────────────
function renderStep2Context() {
  const selected = getSelectedDocs();
  const countTag = document.getElementById("step2DocCountTag");
  const listEl   = document.getElementById("summaryDocList");
  const countEl  = document.getElementById("summaryCount");
  const feeEl    = document.getElementById("summaryTotalFee");
  const reqsEl   = document.getElementById("summaryReqsList");

  if (countTag) {
    countTag.textContent = `${selected.length} Document${selected.length === 1 ? "" : "s"} Selected`;
  }
  if (countEl) countEl.textContent = String(selected.length);
  if (feeEl) feeEl.textContent = formatPeso(getTotalFee(selected));

  if (listEl) {
    listEl.innerHTML = selected.map(d => `
      <div class="summary-doc-item">
        <div class="summary-doc-head">
          <strong>${esc(d.name)}</strong>
          <span class="fee-badge${(Number(d.fee) || 0) <= 0 ? " free" : ""}">${formatPeso(d.fee)}</span>
        </div>
        <div class="summary-doc-meta">
          ${esc(d.processingLabel)} &bull; ${esc(d.windowLabel)}
        </div>
      </div>
    `).join("");
  }

  if (reqsEl) {
    reqsEl.innerHTML = getUniqueRequirements(selected)
      .map(req => `<li>${esc(req)}</li>`)
      .join("");
  }

  renderPurposePresets(selected);
  renderDynamicDocFields(selected);
  setFormError("");
}

function renderPurposePresets(selected) {
  const wrap = document.getElementById("purposePresets");
  const purposeInput = document.getElementById("inquiryPurpose");
  if (!wrap) return;

  const seen = new Set();
  const presets = [];
  selected.forEach(d => {
    (d.purposePresets || []).forEach(p => {
      if (!seen.has(p)) {
        seen.add(p);
        presets.push(p);
      }
    });
  });

  const currentVal = (purposeInput?.value || "").trim();
  wrap.innerHTML = presets.map(p => `
    <button type="button" class="purpose-chip${currentVal === p ? " active" : ""}" data-purpose="${esc(p)}">
      ${esc(p)}
    </button>
  `).join("");

  wrap.querySelectorAll(".purpose-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      if (purposeInput) {
        purposeInput.value = btn.dataset.purpose;
      }
      wrap.querySelectorAll(".purpose-chip").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

function renderDynamicDocFields(selected) {
  const container = document.getElementById("dynamicDocFields");
  if (!container) return;

  const extraTypes = new Set(selected.map(d => d.extraType).filter(Boolean));
  const blocks = [];

  if (extraTypes.has("business")) {
    blocks.push(`
      <div class="doc-extra-panel">
        <h4>Business Permit / Clearance Details</h4>
        <div class="form-grid">
          <div class="field">
            <label for="bizName">Business / Trade Name <span class="req-star">*</span></label>
            <input type="text" id="bizName" placeholder="e.g. Dela Cruz Sari-Sari Store" />
          </div>
          <div class="field">
            <label for="bizNature">Nature of Business <span class="req-star">*</span></label>
            <input type="text" id="bizNature" placeholder="e.g. Retail / Food Service / Services" />
          </div>
          <div class="field">
            <label for="bizPermitType">Application Type</label>
            <select id="bizPermitType">
              <option value="New Business Permit">New Business Permit</option>
              <option value="Business Permit Renewal">Business Permit Renewal</option>
            </select>
          </div>
          <div class="field">
            <label for="bizAddress">Business Location / Address <span class="req-star">*</span></label>
            <input type="text" id="bizAddress" placeholder="Street / Purok in Barangay Sta. Rita" />
            <button type="button" id="copyHomeAddrBtn" class="inline-action-link">Same as residential address</button>
          </div>
        </div>
      </div>
    `);
  }

  if (extraTypes.has("job_seeker")) {
    blocks.push(`
      <div class="doc-extra-panel">
        <h4>First Time Job Seeker Details (RA 11261)</h4>
        <div class="form-grid">
          <div class="field">
            <label for="ftjEducation">Highest Educational Attainment</label>
            <input type="text" id="ftjEducation" placeholder="e.g. Senior High School / College Graduate" />
          </div>
          <div class="field">
            <label for="ftjResidencyLength">Length of Residency in Sta. Rita</label>
            <input type="text" id="ftjResidencyLength" placeholder="e.g. 5 years" />
          </div>
          <div class="field full">
            <label class="checkbox-card">
              <input type="checkbox" id="ftjConfirm" />
              <span>I confirm this is my first time seeking employment and I have not previously availed of the RA 11261 fee exemption. <span class="req-star">*</span></span>
            </label>
          </div>
        </div>
      </div>
    `);
  }

  if (extraTypes.has("barangay_id")) {
    blocks.push(`
      <div class="doc-extra-panel">
        <h4>Barangay ID Card Information</h4>
        <div class="form-grid">
          <div class="field">
            <label for="bidBirthdate">Date of Birth <span class="req-star">*</span></label>
            <input type="date" id="bidBirthdate" />
          </div>
          <div class="field">
            <label for="bidBloodType">Blood Type <span class="opt-tag">(Optional)</span></label>
            <input type="text" id="bidBloodType" placeholder="e.g. O+, A+" />
          </div>
          <div class="field full">
            <label for="bidEmergencyContact">Emergency Contact Person &amp; Mobile Number <span class="req-star">*</span></label>
            <input type="text" id="bidEmergencyContact" placeholder="e.g. Maria Dela Cruz — 09181234567" />
          </div>
        </div>
      </div>
    `);
  }

  if (extraTypes.has("medical")) {
    blocks.push(`
      <div class="doc-extra-panel">
        <h4>Medical Assistance Details</h4>
        <div class="form-grid">
          <div class="field">
            <label for="medPatientName">Patient Name <span class="opt-tag">(if different from applicant)</span></label>
            <input type="text" id="medPatientName" placeholder="Leave blank if you are the patient" />
          </div>
          <div class="field">
            <label for="medHospital">Hospital / Clinic / Institution</label>
            <input type="text" id="medHospital" placeholder="e.g. James L. Gordon Memorial Hospital" />
          </div>
        </div>
      </div>
    `);
  }

  if (extraTypes.has("blotter")) {
    blocks.push(`
      <div class="doc-extra-panel">
        <h4>Incident / Blotter Report Details</h4>
        <div class="form-grid">
          <div class="field">
            <label for="blotterDate">Date of Incident</label>
            <input type="date" id="blotterDate" />
          </div>
          <div class="field">
            <label for="blotterRespondent">Other Party / Respondent <span class="opt-tag">(if applicable)</span></label>
            <input type="text" id="blotterRespondent" placeholder="Name or N/A if unknown" />
          </div>
          <div class="field full">
            <label for="blotterSummary">Brief Summary of Incident <span class="req-star">*</span></label>
            <textarea id="blotterSummary" rows="2" placeholder="Briefly describe what happened, when, and where..."></textarea>
          </div>
        </div>
      </div>
    `);
  }

  container.innerHTML = blocks.join("");

  document.getElementById("copyHomeAddrBtn")?.addEventListener("click", () => {
    const homeAddr = document.getElementById("applicantAddress")?.value.trim();
    const bizAddrEl = document.getElementById("bizAddress");
    if (bizAddrEl && homeAddr) {
      bizAddrEl.value = homeAddr;
    } else {
      showToast("Enter your residential address first.", "warning");
    }
  });
}

// ── PUROK / STREET ADDRESS HELPER ─────────────────────────────────────────
function initAddressHelper() {
  const purokSel  = document.getElementById("kioskPurok");
  const streetSel = document.getElementById("kioskStreet");
  const houseEl   = document.getElementById("kioskHouseNo");
  const addrInput = document.getElementById("applicantAddress");
  if (!purokSel || !streetSel) return;

  Object.keys(PUROK_STREETS).forEach(purok => {
    const opt = document.createElement("option");
    opt.value = purok;
    opt.textContent = purok;
    purokSel.appendChild(opt);
  });

  function updateComposedAddress() {
    const purok  = purokSel.value;
    const street = streetSel.value;
    const house  = (houseEl?.value || "").trim();
    if (!purok || !street || !addrInput) return;

    const parts = [];
    if (house) parts.push(house);
    parts.push(street, purok, "Barangay Sta. Rita", "Olongapo City");
    addrInput.value = parts.join(", ");
  }

  purokSel.addEventListener("change", () => {
    const purok = purokSel.value;
    streetSel.innerHTML = `<option value="">Select Street / Road</option>`;
    streetSel.disabled = !purok;
    if (purok && PUROK_STREETS[purok]) {
      PUROK_STREETS[purok].forEach(st => {
        const o = document.createElement("option");
        o.value = st;
        o.textContent = st;
        streetSel.appendChild(o);
      });
    }
    updateComposedAddress();
  });

  streetSel.addEventListener("change", updateComposedAddress);
  houseEl?.addEventListener("input", updateComposedAddress);
}

// ── FORM VALIDATION & SUBMISSION ──────────────────────────────────────────
function setFormError(msg) {
  const box = document.getElementById("formErrorBox");
  if (!box) return;
  box.textContent = msg;
  box.classList.toggle("hidden", !msg);
  if (msg) box.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function handleKioskSubmit(e) {
  e.preventDefault();
  setFormError("");

  const selected = getSelectedDocs();
  if (!selected.length) {
    setFormError("Please select at least one document first.");
    return;
  }

  const fullName    = document.getElementById("applicantFullName")?.value.trim() || "";
  const contact     = document.getElementById("applicantContact")?.value.trim() || "";
  const age         = document.getElementById("applicantAge")?.value.trim() || "";
  const civilStatus = document.getElementById("applicantCivilStatus")?.value || "";
  const claimMode   = document.getElementById("claimMode")?.value || "In Person";
  const repName     = document.getElementById("representativeName")?.value.trim() || "";
  const address     = document.getElementById("applicantAddress")?.value.trim() || "";
  const purpose     = document.getElementById("inquiryPurpose")?.value.trim() || "";
  const notes       = document.getElementById("inquiryNotes")?.value.trim() || "";

  if (!fullName) {
    setFormError("Please enter your full name.");
    document.getElementById("applicantFullName")?.focus();
    return;
  }
  if (!/^09\d{9}$/.test(contact)) {
    setFormError("Please enter a valid 11-digit Philippine mobile number starting with 09 (e.g. 09171234567).");
    document.getElementById("applicantContact")?.focus();
    return;
  }
  if (claimMode === "Representative" && !repName) {
    setFormError("Please enter your authorized representative's full name.");
    document.getElementById("representativeName")?.focus();
    return;
  }
  if (!address) {
    setFormError("Please enter your complete residential address.");
    document.getElementById("applicantAddress")?.focus();
    return;
  }
  if (!purpose) {
    setFormError("Please specify the purpose of your requested document(s).");
    document.getElementById("inquiryPurpose")?.focus();
    return;
  }

  const extraTypes = new Set(selected.map(d => d.extraType).filter(Boolean));
  const extraData = {};

  if (extraTypes.has("business")) {
    const businessName    = document.getElementById("bizName")?.value.trim() || "";
    const businessNature  = document.getElementById("bizNature")?.value.trim() || "";
    const permitType      = document.getElementById("bizPermitType")?.value || "New Business Permit";
    const businessAddress = document.getElementById("bizAddress")?.value.trim() || "";
    if (!businessName || !businessNature || !businessAddress) {
      setFormError("Please complete all required Business Permit / Clearance fields (Business Name, Nature, and Address).");
      return;
    }
    extraData.businessName = businessName;
    extraData.businessNature = businessNature;
    extraData.permitType = permitType;
    extraData.businessAddress = businessAddress;
  }

  if (extraTypes.has("job_seeker")) {
    const confirmed = document.getElementById("ftjConfirm")?.checked;
    if (!confirmed) {
      setFormError("Please confirm eligibility under the First Time Jobseekers Assistance Act (RA 11261).");
      return;
    }
    extraData.ftjEducation = document.getElementById("ftjEducation")?.value.trim() || "";
    extraData.ftjResidencyLength = document.getElementById("ftjResidencyLength")?.value.trim() || "";
  }

  if (extraTypes.has("barangay_id")) {
    const birthdate = document.getElementById("bidBirthdate")?.value || "";
    const emergency = document.getElementById("bidEmergencyContact")?.value.trim() || "";
    if (!birthdate || !emergency) {
      setFormError("Please provide your Date of Birth and Emergency Contact for your Barangay ID.");
      return;
    }
    extraData.birthdate = birthdate;
    extraData.bloodType = document.getElementById("bidBloodType")?.value.trim() || "";
    extraData.emergencyContact = emergency;
  }

  if (extraTypes.has("medical")) {
    extraData.patientName = document.getElementById("medPatientName")?.value.trim() || "";
    extraData.hospital = document.getElementById("medHospital")?.value.trim() || "";
  }

  if (extraTypes.has("blotter")) {
    const summary = document.getElementById("blotterSummary")?.value.trim() || "";
    if (!summary) {
      setFormError("Please enter a brief summary of the incident for your Blotter Report.");
      document.getElementById("blotterSummary")?.focus();
      return;
    }
    extraData.incidentDate = document.getElementById("blotterDate")?.value || "";
    extraData.respondent = document.getElementById("blotterRespondent")?.value.trim() || "";
    extraData.incidentSummary = summary;
  }

  const submitBtn = document.getElementById("submitKioskBtn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Generating Queue Number...";
  }

  try {
    const queueNumber = allocateNextQueueNumber();
    const dateStamp = getPhtDateKey().replace(/-/g, "").slice(4);
    const refCode = `BF-${dateStamp}-${queueNumber}`;
    const issuedAt = new Date().toISOString();
    const withinHours = isWithinWorkingHours();
    let kioskDocId = "";
    let syncedToFirestore = false;

    // Record every kiosk submission (walk-in or signed-in) for Barangay Staff lookup
    try {
      const kioskDocRef = await addDoc(collection(db, "kioskRequests"), {
        source: "kiosk",
        status: "Pending",
        queueNumber,
        kioskReference: refCode,
        serviceType: selected.map(d => d.name).join(", "),
        documents: selected.map(d => ({
          id: d.id,
          serviceId: d.serviceId || d.id,
          name: d.name,
          fee: Number(d.fee) || 0,
          processingLabel: d.processingLabel || "",
          windowLabel: d.windowLabel || ""
        })),
        totalFee: getTotalFee(selected),
        windowLabel: getWindowSummary(selected),
        fullName,
        contact,
        address,
        age,
        civilStatus,
        claimMode,
        representativeName: claimMode === "Representative" ? repName : "",
        purpose,
        notes,
        extraData,
        withinHours,
        submittedMode: state.currentUser ? (state.isStaffUser ? "staff_desk" : "signed_in") : "walk_in",
        createdAt: serverTimestamp()
      });
      kioskDocId = kioskDocRef.id;
      syncedToFirestore = true;
    } catch (fsErr) {
      console.warn("[Kiosk] Could not save request to Firestore kioskRequests:", fsErr?.message || fsErr);
      showToast(
        fsErr?.code === "permission-denied"
          ? "Ticket issued locally, but Firestore rules for 'kioskRequests' are not deployed yet."
          : "Ticket issued locally, but could not sync to Firestore.",
        "warning"
      );
    }

    const ticket = {
      queueNumber,
      refCode,
      issuedAt,
      withinHours,
      windowLabel: getWindowSummary(selected),
      totalFee: getTotalFee(selected),
      requirements: getUniqueRequirements(selected),
      applicant: {
        fullName,
        contact,
        age,
        civilStatus,
        claimMode,
        repName,
        address,
        purpose,
        notes
      },
      extraData,
      documents: selected.map(d => ({
        id: d.id,
        name: d.name,
        fee: d.fee,
        processingLabel: d.processingLabel,
        windowLabel: d.windowLabel
      })),
      kioskDocId,
      syncedToFirestore
    };

    state.lastTicket = ticket;
    saveTicketToHistory(ticket);
    renderTicketView(ticket);
    goToStep(3);
    showToast(`Queue Number ${queueNumber} issued!`, "success");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Get Queue Number &amp; Submit</span>`;
    }
  }
}

// ── STEP 3: RENDER QUEUE TICKET ───────────────────────────────────────────
function renderTicketView(ticket) {
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setText("ticketQueueNumber", ticket.queueNumber);
  setText("ticketWindowText", ticket.windowLabel);
  setText("ticketRefCode", ticket.refCode);
  setText("ticketTotalFee", formatPeso(ticket.totalFee));
  setText("ticketName", ticket.applicant.fullName);
  setText("ticketContact", ticket.applicant.contact);
  setText("ticketAddress", ticket.applicant.address);
  setText("ticketPurpose", ticket.applicant.purpose);

  // Off-hours notice
  const offAlert = document.getElementById("ticketOffHoursAlert");
  if (offAlert) {
    if (!ticket.withinHours) {
      offAlert.textContent =
        "Note: Barangay Sta. Rita Hall is currently outside regular office hours (Mon–Fri, 8:00 AM – 5:00 PM PHT). Please keep this queue ticket and proceed to the Barangay Hall on the next working day.";
      offAlert.classList.remove("hidden");
    } else {
      offAlert.classList.add("hidden");
    }
  }

  // Staff kiosk log confirmation banner (kiosk tickets are staff-lookup only)
  const syncBanner = document.getElementById("ticketSyncBanner");
  const syncText   = document.getElementById("ticketSyncText");
  const trackBtn   = document.getElementById("trackOnlineBtn");
  if (ticket.syncedToFirestore) {
    if (syncBanner && syncText) {
      syncText.textContent = `Logged for Barangay Staff counter lookup (Queue: ${ticket.queueNumber} • Ref: ${ticket.refCode}). Present this ticket at ${ticket.windowLabel}.`;
      syncBanner.classList.remove("hidden");
    }
  } else {
    syncBanner?.classList.add("hidden");
  }
  trackBtn?.classList.add("hidden");

  // Extra document-specific details
  const extraEl = document.getElementById("ticketExtraDetails");
  if (extraEl) {
    const extras = [];
    if (ticket.applicant.claimMode === "Representative" && ticket.applicant.repName) {
      extras.push({ label: "Authorized Representative", val: ticket.applicant.repName });
    }
    if (ticket.extraData?.businessName) {
      extras.push({ label: "Business Name", val: ticket.extraData.businessName });
      extras.push({ label: "Nature of Business", val: ticket.extraData.businessNature });
      extras.push({ label: "Business Address", val: ticket.extraData.businessAddress });
    }
    if (ticket.extraData?.birthdate) {
      extras.push({ label: "Date of Birth", val: ticket.extraData.birthdate });
      extras.push({ label: "Emergency Contact", val: ticket.extraData.emergencyContact });
    }
    if (ticket.extraData?.hospital || ticket.extraData?.patientName) {
      if (ticket.extraData.patientName) extras.push({ label: "Patient Name", val: ticket.extraData.patientName });
      if (ticket.extraData.hospital) extras.push({ label: "Hospital / Clinic", val: ticket.extraData.hospital });
    }
    if (ticket.extraData?.incidentSummary) {
      extras.push({ label: "Incident Summary", val: ticket.extraData.incidentSummary });
    }

    if (extras.length) {
      extraEl.innerHTML = extras.map(item => `
        <div class="ticket-kv">
          <small>${esc(item.label)}</small>
          <p>${esc(item.val)}</p>
        </div>
      `).join("");
      extraEl.classList.remove("hidden");
    } else {
      extraEl.classList.add("hidden");
      extraEl.innerHTML = "";
    }
  }

  // Requested documents list
  const docsEl = document.getElementById("ticketDocsList");
  if (docsEl) {
    docsEl.innerHTML = ticket.documents.map(d => `
      <div class="ticket-doc-row">
        <div>
          <strong>${esc(d.name)}</strong>
          <small>${esc(d.processingLabel)} &bull; ${esc(d.windowLabel)}</small>
        </div>
        <span class="fee-badge${(Number(d.fee) || 0) <= 0 ? " free" : ""}">${formatPeso(d.fee)}</span>
      </div>
    `).join("");
  }

  // Checklist
  const checkEl = document.getElementById("ticketChecklist");
  if (checkEl) {
    checkEl.innerHTML = (ticket.requirements || [])
      .map(req => `<li><span>&#9745;</span><span>${esc(req)}</span></li>`)
      .join("");
  }
}

// ── MY RECENT TICKETS MODAL ───────────────────────────────────────────────
function openTicketsModal() {
  const modal = document.getElementById("ticketsModal");
  const body  = document.getElementById("ticketsModalBody");
  if (!modal || !body) return;

  const tickets = getSavedTickets();
  if (!tickets.length) {
    body.innerHTML = `<p class="field-hint">No kiosk queue tickets generated on this device yet.</p>`;
  } else {
    body.innerHTML = tickets.map((t, idx) => {
      const docNames = (t.documents || []).map(d => d.name).join(", ");
      const dateStr  = t.issuedAt
        ? new Date(t.issuedAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "";
      return `
        <div class="recent-ticket-item">
          <div>
            <strong>${esc(t.queueNumber)}</strong>
            <p>${esc(docNames || "Document Inquiry")}</p>
            <small>${esc(t.applicant?.fullName || "")} &bull; ${esc(dateStr)}</small>
          </div>
          <button type="button" class="btn-view-ticket" data-ticket-idx="${idx}">View Ticket</button>
        </div>`;
    }).join("");

    body.querySelectorAll("[data-ticket-idx]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.ticketIdx);
        const target = tickets[idx];
        if (target) {
          state.lastTicket = target;
          renderTicketView(target);
          closeTicketsModal();
          goToStep(3);
        }
      });
    });
  }

  modal.classList.add("open");
}

function closeTicketsModal() {
  document.getElementById("ticketsModal")?.classList.remove("open");
}

// ── RESET / START OVER ────────────────────────────────────────────────────
function resetKioskFlow() {
  state.selectedIds.clear();
  state.activeCategory = "All";
  state.quickFilter = "all";
  state.searchQuery = "";

  const searchInput = document.getElementById("docSearchInput");
  if (searchInput) searchInput.value = "";

  document.querySelectorAll(".filter-chip").forEach(c => {
    c.classList.toggle("active", c.dataset.filter === "all");
  });

  const purposeEl = document.getElementById("inquiryPurpose");
  const notesEl   = document.getElementById("inquiryNotes");
  if (purposeEl) purposeEl.value = "";
  if (notesEl) notesEl.value = "";
  setFormError("");

  renderCategories();
  renderDocsGrid();
  renderTrayBar();
  goToStep(1);
}

// ── BOOTSTRAP ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  updateOfficeStatus();
  setInterval(updateOfficeStatus, 60_000);
  updateTicketCountBadge();
  initAddressHelper();
  renderCategories();
  renderDocsGrid();
  renderTrayBar();

  // Pre-select document from URL ?doc=
  const docParam = new URLSearchParams(window.location.search).get("doc");
  if (docParam) {
    const match = state.documents.find(d => d.id === docParam || d.code.toLowerCase() === docParam.toLowerCase());
    if (match) {
      state.selectedIds.add(match.id);
      renderDocsGrid();
      renderTrayBar();
      const b2 = document.getElementById("stepBtn2");
      if (b2) {
        b2.disabled = false;
        b2.classList.add("clickable");
      }
      showToast(`"${match.name}" pre-selected for your inquiry.`, "info");
    }
  }

  // Search & quick filter bindings
  document.getElementById("docSearchInput")?.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderDocsGrid();
  });

  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      state.quickFilter = chip.dataset.filter;
      document.querySelectorAll(".filter-chip").forEach(c => c.classList.toggle("active", c === chip));
      renderDocsGrid();
    });
  });

  // Tray & stepper bindings
  document.getElementById("clearTrayBtn")?.addEventListener("click", () => {
    state.selectedIds.clear();
    renderDocsGrid();
    renderTrayBar();
    const b2 = document.getElementById("stepBtn2");
    if (b2) {
      b2.disabled = true;
      b2.classList.remove("clickable");
    }
  });

  document.getElementById("proceedInfoBtn")?.addEventListener("click", () => {
    if (state.selectedIds.size > 0) goToStep(2);
  });

  document.getElementById("stepBtn1")?.addEventListener("click", () => {
    if (state.step !== 1) goToStep(1);
  });
  document.getElementById("stepBtn2")?.addEventListener("click", () => {
    if (state.selectedIds.size > 0) goToStep(2);
  });
  document.getElementById("stepBtn3")?.addEventListener("click", () => {
    if (state.lastTicket) goToStep(3);
  });

  document.getElementById("changeDocsBtn")?.addEventListener("click", () => goToStep(1));
  document.getElementById("backToDocsBtn")?.addEventListener("click", () => goToStep(1));
  document.getElementById("startOverBtn")?.addEventListener("click", () => {
    resetKioskFlow();
    showToast("Kiosk reset for a new document inquiry.", "info");
  });

  // Claim mode representative toggle
  document.getElementById("claimMode")?.addEventListener("change", (e) => {
    document.getElementById("repNameField")?.classList.toggle("hidden", e.target.value !== "Representative");
  });

  // Form submit
  document.getElementById("kioskInfoForm")?.addEventListener("submit", handleKioskSubmit);

  // Ticket actions
  document.getElementById("printTicketBtn")?.addEventListener("click", () => window.print());
  document.getElementById("copyTicketBtn")?.addEventListener("click", async () => {
    if (!state.lastTicket) return;
    const t = state.lastTicket;
    const text = [
      `BARANGAYFLOW DOCUMENT KIOSK TICKET`,
      `Queue Number: ${t.queueNumber}`,
      `Reference: ${t.refCode}`,
      `Proceed To: ${t.windowLabel} — Barangay Sta. Rita Hall, Olongapo City`,
      `Applicant: ${t.applicant.fullName}`,
      `Contact: ${t.applicant.contact}`,
      `Documents: ${t.documents.map(d => d.name).join(", ")}`,
      `Purpose: ${t.applicant.purpose}`,
      `Estimated Fee: ${formatPeso(t.totalFee)}`,
      `Bring: ${t.requirements.join("; ")}`
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      showToast("Ticket summary copied to clipboard!", "success");
    } catch {
      showToast("Could not copy automatically — please use Print Ticket or screenshot.", "warning");
    }
  });
  document.getElementById("newKioskOrderBtn")?.addEventListener("click", resetKioskFlow);

  // Modals
  document.getElementById("closeDocModalBtn")?.addEventListener("click", closeDocModal);
  document.getElementById("modalDismissBtn")?.addEventListener("click", closeDocModal);
  document.getElementById("modalToggleSelectBtn")?.addEventListener("click", () => {
    if (state.modalDocId) {
      toggleDocumentSelection(state.modalDocId);
      closeDocModal();
    }
  });
  document.getElementById("docDetailModal")?.addEventListener("click", (e) => {
    if (e.target.id === "docDetailModal") closeDocModal();
  });

  document.getElementById("myTicketsBtn")?.addEventListener("click", openTicketsModal);
  document.getElementById("closeTicketsModalBtn")?.addEventListener("click", closeTicketsModal);
  document.getElementById("dismissTicketsModalBtn")?.addEventListener("click", closeTicketsModal);
  document.getElementById("clearTicketsHistoryBtn")?.addEventListener("click", () => {
    localStorage.removeItem(LS_TICKETS_KEY);
    updateTicketCountBadge();
    closeTicketsModal();
    showToast("Saved kiosk ticket history cleared.", "info");
  });
  document.getElementById("ticketsModal")?.addEventListener("click", (e) => {
    if (e.target.id === "ticketsModal") closeTicketsModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDocModal();
      closeTicketsModal();
    }
  });

  // Optional auth listener (auto-fills profile & loads Firestore services if logged in)
  onAuthStateChanged(auth, (user) => {
    state.currentUser = user || null;
    if (user) {
      syncAuthenticatedContext(user);
    }
  });
});

