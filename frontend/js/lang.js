// js/lang.js — BarangayFlow Language Toggle (EN / FIL)
// Usage: add data-i18n="key" to any element, then call window.setLang("en"|"fil")

const translations = {
  en: {
    // NAVBAR
    nav_dashboard:     "Dashboard",
    nav_announcements: "Announcements",
    nav_new_request:   "New Request",
    nav_logout:        "Logout",
    nav_lang:          "Filipino",

    // DASHBOARD
    welcome_back:      "Welcome back,",
    new_request_btn:   "+ New Request",
    total_requests:    "Total Requests",
    pending:           "Pending",
    ready_pickup:      "Ready for Pickup",
    completed:         "Completed",
    my_requests:       "My Requests",
    request_history:   "Request History",
    view_history:      "View History",
    hide_history:      "Hide History",
    latest_update:     "Latest Update",
    no_updates:        "No updates yet.",

    // TABLE HEADERS
    th_id:       "Request ID",
    th_service:  "Service Type",
    th_date:     "Date Submitted",
    th_status:   "Status",
    th_updated:  "Last Updated",
    th_actions:  "Actions",

    // REQUEST PAGE
    request_title:    "New Service Request",
    select_service:   "Select Service Type",
    full_name:        "Full Name",
    contact:          "Contact Number",
    address:          "Complete Address",
    purpose:          "Purpose / Reason",
    add_notes:        "Additional Notes (optional)",
    upload_doc:       "Upload Document",
    click_drag:       "Click or drag files here",
    submit_request:   "Submit Request",

    // STATUS LABELS
    status_pending:    "Pending",
    status_progress:   "In Progress",
    status_ready:      "Ready for Pickup",
    status_completed:  "Completed",
    status_rejected:   "Rejected",

    // TRACKER
    track_title:       "Track Your Request",
    track_subtitle:    "Enter your Request ID to check your application status — no login needed.",
    track_label:       "Request ID",
    track_btn:         "Track",
    track_hint:        "Your Request ID was shown after submitting your request on your dashboard.",
    track_another:     "Track another request",
    pickup_schedule:   "Pickup Schedule",
    bring_id:          "Please bring a valid ID when claiming your document.",
    barangay_note:     "Barangay Note",
    request_progress:  "Request Progress",
    applicant:         "Applicant",
    date_submitted:    "Date Submitted",
    current_status:    "Current Status",
    last_updated:      "Last Updated",
  },

  fil: {
    // NAVBAR
    nav_dashboard:     "Dashboard",
    nav_announcements: "Mga Anunsyo",
    nav_new_request:   "Bagong Kahilingan",
    nav_logout:        "Mag-logout",
    nav_lang:          "English",

    // DASHBOARD
    welcome_back:      "Maligayang pagbabalik,",
    new_request_btn:   "+ Bagong Kahilingan",
    total_requests:    "Lahat ng Kahilingan",
    pending:           "Nakabinbin",
    ready_pickup:      "Handa na para Kunin",
    completed:         "Natapos na",
    my_requests:       "Aking mga Kahilingan",
    request_history:   "Kasaysayan ng Kahilingan",
    view_history:      "Tingnan ang Kasaysayan",
    hide_history:      "Itago ang Kasaysayan",
    latest_update:     "Pinakabagong Update",
    no_updates:        "Wala pang update.",

    // TABLE HEADERS
    th_id:       "ID ng Kahilingan",
    th_service:  "Uri ng Serbisyo",
    th_date:     "Petsa ng Pagsumite",
    th_status:   "Katayuan",
    th_updated:  "Huling Update",
    th_actions:  "Aksyon",

    // REQUEST PAGE
    request_title:    "Bagong Kahilingan sa Serbisyo",
    select_service:   "Pumili ng Uri ng Serbisyo",
    full_name:        "Buong Pangalan",
    contact:          "Numero ng Telepono",
    address:          "Kumpletong Tirahan",
    purpose:          "Layunin / Dahilan",
    add_notes:        "Karagdagang Tala (opsyonal)",
    upload_doc:       "Mag-upload ng Dokumento",
    click_drag:       "Mag-click o mag-drag ng file dito",
    submit_request:   "Isumite ang Kahilingan",

    // STATUS LABELS
    status_pending:    "Nakabinbin",
    status_progress:   "Isinasagawa",
    status_ready:      "Handa na para Kunin",
    status_completed:  "Natapos na",
    status_rejected:   "Tinanggihan",

    // TRACKER
    track_title:       "Subaybayan ang Kahilingan",
    track_subtitle:    "Ilagay ang inyong Request ID para malaman ang katayuan — hindi kailangan mag-login.",
    track_label:       "Request ID",
    track_btn:         "Subaybayan",
    track_hint:        "Ang inyong Request ID ay makikita sa dashboard pagkatapos mag-sumite.",
    track_another:     "Subaybayan ang ibang kahilingan",
    pickup_schedule:   "Iskedyul ng Pagkuha",
    bring_id:          "Mangyaring magdala ng valid ID kapag kinukuha ang dokumento.",
    barangay_note:     "Tala ng Barangay",
    request_progress:  "Progreso ng Kahilingan",
    applicant:         "Aplikante",
    date_submitted:    "Petsa ng Pagsumite",
    current_status:    "Kasalukuyang Katayuan",
    last_updated:      "Huling Update",
  }
};

let currentLang = localStorage.getItem("bf_lang") || "en";

function applyLang(lang) {
  currentLang = lang;
  localStorage.setItem("bf_lang", lang);
  const dict = translations[lang] || translations.en;
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (dict[key] !== undefined) {
      if (el.tagName === "INPUT" && el.placeholder !== undefined) {
        el.placeholder = dict[key];
      } else {
        el.textContent = dict[key];
      }
    }
  });
  // Update toggle button label
  const btn = document.getElementById("langToggleBtn");
  if (btn) btn.textContent = dict["nav_lang"] || "Filipino";
}

window.setLang = function(lang) { applyLang(lang); };

window.toggleLang = function() {
  applyLang(currentLang === "en" ? "fil" : "en");
};

// Auto-apply on load
document.addEventListener("DOMContentLoaded", () => applyLang(currentLang));

export { applyLang, currentLang };
