/**
 * dashboard.js — BarangayFlow Resident Dashboard
 *
 * Changes from original:
 *  ✓ Document verification badge on each request row  (docVerification field)
 *  ✓ Invalid reason shown inside the "View Details" modal so residents
 *    know exactly what to fix and re-submit
 *  ✓ Cloudinary document preview link inside details modal
 *  ✓ All other original logic preserved (pagination, history, stats,
 *    announcements, notifications, logout, back-button lock)
 */

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, query, where, onSnapshot,
  doc, getDoc, orderBy, deleteDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─────────────────────────────────────────────
//  BACK-BUTTON LOCK
// ─────────────────────────────────────────────
history.pushState(null, "", location.href);
window.addEventListener("popstate", () => {
  const uid  = localStorage.getItem("bf_resident_uid");
  const sess = sessionStorage.getItem("bf_session_active");
  if (!uid || !sess) {
    window.location.replace("login.html");
  } else {
    history.pushState(null, "", location.href);
  }
});

// ─────────────────────────────────────────────
//  GLOBAL STATE
// ─────────────────────────────────────────────
let showHistory     = false;
let cachedDocs      = [];
let cachedDocMap    = {};
let annUnsubscriber = null;

const PAGE_SIZE = 5;
let currentPage = 1;
const PROFILE_SECTORS = [
  "General Resident/Citizen",
  "Senior Citizen",
  "Person with Disability (PWD)",
  "Student",
  "Solo Parent",
  "4Ps Beneficiary",
  "Other"
];
const PROFILE_ID_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_ID_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const PROFILE_ID_UPLOAD_URL = "https://api.cloudinary.com/v1_1/dqlei56w3/auto/upload";
const PROFILE_ID_UPLOAD_PRESET = "barangayflow_docs";

async function uploadProfileId(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", PROFILE_ID_UPLOAD_PRESET);
  formData.append("folder", "barangay_resident_ids");

  const response = await fetch(PROFILE_ID_UPLOAD_URL, { method: "POST", body: formData });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The ID upload service returned an unreadable response.");
  }
  if (!response.ok) {
    throw new Error(result?.error?.message || `ID upload failed (${response.status}).`);
  }
  if (!result.secure_url || !result.public_id) {
    throw new Error("The ID upload service did not return a valid file.");
  }
  return { secureUrl: result.secure_url, publicId: result.public_id };
}

// ─────────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────────
function showToast(msg, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity   = "0";
    toast.style.transform = "translateY(20px) scale(0.95)";
    setTimeout(() => toast.remove(), 350);
  }, 4500);
}

// ─────────────────────────────────────────────
//  TAB NAVIGATION
// ─────────────────────────────────────────────
window.showTab = function (tabName) {
  const dashTab = document.getElementById("tab-dashboard");
  const annTab  = document.getElementById("tab-announcements");
  const profileTab = document.getElementById("tab-profile");
  const navDash = document.getElementById("nav-dash");
  const navAnn  = document.getElementById("nav-ann");
  const navProfile = document.getElementById("nav-profile");

  // Close hamburger on nav tap
  document.querySelector(".nav-right")?.classList.remove("open");
  document.querySelector(".nav-toggle")?.setAttribute("aria-expanded", "false");

  if (dashTab) dashTab.style.display = tabName === "dashboard" ? "block" : "none";
  if (annTab) annTab.style.display = tabName === "announcements" ? "block" : "none";
  if (profileTab) profileTab.style.display = tabName === "profile" ? "block" : "none";
  navDash?.classList.toggle("active", tabName === "dashboard");
  navAnn?.classList.toggle("active", tabName === "announcements");
  navProfile?.classList.toggle("active", tabName === "profile");
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (tabName === "dashboard") {
    return;
  }
  if (tabName === "announcements") {
    listenToAnnouncements();
    return;
  }
  if (tabName === "profile") loadProfileEditor();
};

// ─────────────────────────────────────────────
//  AUTH CHECK
// ─────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.replace("login.html"); return; }

  const residentUid   = localStorage.getItem("bf_resident_uid");
  const sessionActive = sessionStorage.getItem("bf_session_active");

  if (!residentUid || residentUid !== user.uid || !sessionActive) {
    localStorage.removeItem("bf_resident_uid");
    sessionStorage.removeItem("bf_session_active");
    window.location.replace("login.html");
    return;
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) {
      localStorage.removeItem("bf_resident_uid");
      sessionStorage.removeItem("bf_session_active");
      window.location.replace("login.html");
      return;
    }
    if (snap.data().active === false) {
      localStorage.removeItem("bf_resident_uid");
      sessionStorage.removeItem("bf_session_active");
      await signOut(auth);
      window.location.replace("login.html?disabled=1");
      return;
    }
  } catch {
    window.location.replace("login.html");
    return;
  }

  // Maintenance mode check
  const sysSnap = await getDoc(doc(db, "system", "config"));
  if (sysSnap.exists() && sysSnap.data()?.maintenance === true) {
    window.location.replace("maintenance.html");
    return;
  }

  // Live maintenance listener
  const sysUnsub = onSnapshot(doc(db, "system", "config"), (snap) => {
    if (snap.exists() && snap.data()?.maintenance === true) {
      sysUnsub();
      window.location.replace("maintenance.html");
    }
  });

  loadUser(user.uid);
  listenToRequests(user.uid);
  listenToNotifications(user.uid);
  preloadAnnBadge();
});

async function loadUser(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const data   = snap.data();
      const nameEl = document.getElementById("userName");
      if (nameEl) nameEl.innerText = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(" ");
    }
  } catch (err) {
    console.error("Failed to load resident profile:", err);
    showToast("Could not load your profile information.", "error");
  }
}

window.openProfileEditor = () => window.showTab("profile");

async function loadProfileEditor() {
  const user = auth.currentUser;
  const form = document.getElementById("profileForm");
  const error = document.getElementById("profileError");
  if (!user || !form) {
    if (error) error.textContent = "Could not load your profile. Please sign in again.";
    return;
  }

  if (error) error.textContent = "";
  const saveBtn = document.getElementById("profileSaveBtn");
  const statusBox = document.getElementById("profileReviewStatus");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Loading…"; }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) throw new Error("Your resident profile could not be found.");
    const data = snap.data();
    const changeRequest = data.profileChangeRequest || null;
    const displayedProfile = changeRequest?.status === "rejected" || changeRequest?.status === "pending"
      ? changeRequest
      : data;
    const setValue = (id, value) => {
      const input = document.getElementById(id);
      if (input) input.value = value || "";
    };
    setValue("profileFirstName", displayedProfile.firstName);
    setValue("profileMiddleName", displayedProfile.middleName);
    setValue("profileLastName", displayedProfile.lastName);
    setValue("profileGender", displayedProfile.gender);
    setValue("profileCivilStatus", displayedProfile.civilStatus);
    setValue("profileBirthDate", displayedProfile.birthDate);
    setValue("profilePlaceOfBirth", displayedProfile.placeOfBirth);
    setValue("profilePhone", displayedProfile.phone);
    setValue("profileLandline", displayedProfile.landline);
    setValue("profileAddress", displayedProfile.address);
    const email = document.getElementById("profileEmail");
    if (email) email.textContent = data.email || user.email || "—";
    const sectors = Array.isArray(displayedProfile.sector) ? displayedProfile.sector : displayedProfile.sector ? [displayedProfile.sector] : [];
    document.querySelectorAll('input[name="profileSector"]').forEach(input => {
      input.checked = sectors.includes(input.value);
    });
    const birthDate = document.getElementById("profileBirthDate");
    if (birthDate) {
      const now = new Date();
      birthDate.max = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }
    const idInput = document.getElementById("profileIdFile");
    if (idInput) idInput.value = "";
    if (statusBox) {
      statusBox.className = "profile-review-status";
      statusBox.textContent = "";
      if (changeRequest?.status === "pending") {
        statusBox.classList.add("pending");
        statusBox.textContent = `Your information and replacement ID (${changeRequest.idFileName || "ID file"}) are waiting for barangay admin approval. Your current approved information remains in use.`;
      } else if (changeRequest?.status === "rejected") {
        statusBox.classList.add("rejected");
        statusBox.textContent = `Your previous update was not approved${changeRequest.rejectionReason ? `: ${changeRequest.rejectionReason}` : ""}. Correct the information and submit a new ID for review.`;
      }
    }
    const locked = changeRequest?.status === "pending";
    setProfileFormLocked(form, locked);
    if (saveBtn) saveBtn.textContent = locked ? "Waiting for Approval" : "Submit for Approval";
  } catch (err) {
    console.error("Failed to open resident profile editor:", err);
    if (error) error.textContent = err instanceof Error ? err.message : "Could not load your profile.";
  } finally {
    if (saveBtn && saveBtn.textContent === "Loading…") {
      saveBtn.disabled = false;
      saveBtn.textContent = "Submit for Approval";
    }
  }
}

function setProfileFormLocked(form, locked) {
  form.querySelectorAll("input, select, button[type='submit']").forEach(control => {
    control.disabled = locked;
  });
}

document.getElementById("profileForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const user = auth.currentUser;
  const error = document.getElementById("profileError");
  const saveBtn = document.getElementById("profileSaveBtn");
  if (error) error.textContent = "";
  if (!user) {
    if (error) error.textContent = "Your session has expired. Please sign in again.";
    return;
  }
  const idFile = document.getElementById("profileIdFile")?.files?.[0];
  if (!idFile) {
    if (error) error.textContent = "Upload a new government-issued ID to submit your information for approval.";
    document.getElementById("profileIdFile")?.focus();
    return;
  }
  if (!PROFILE_ID_TYPES.includes(idFile.type)) {
    if (error) error.textContent = "ID must be a JPG, PNG, WEBP, or PDF file.";
    return;
  }
  if (idFile.size > PROFILE_ID_MAX_BYTES) {
    if (error) error.textContent = "ID file must be 2 MB or smaller.";
    return;
  }

  const sector = Array.from(document.querySelectorAll('input[name="profileSector"]:checked'))
    .map(input => input.value);
  if (!sector.length || sector.some(value => !PROFILE_SECTORS.includes(value))) {
    if (error) error.textContent = "Select at least one resident sector.";
    document.querySelector('input[name="profileSector"]')?.focus();
    return;
  }

  const address = document.getElementById("profileAddress")?.value.trim() || "";
  if (!/sta\.?\s*rita/i.test(address) || !/olongapo/i.test(address)) {
    if (error) error.textContent = "Address must be within Barangay Sta. Rita, Olongapo City.";
    document.getElementById("profileAddress")?.focus();
    return;
  }

  const profile = {
    firstName: document.getElementById("profileFirstName")?.value.trim() || "",
    middleName: document.getElementById("profileMiddleName")?.value.trim() || "",
    lastName: document.getElementById("profileLastName")?.value.trim() || "",
    gender: document.getElementById("profileGender")?.value || "",
    civilStatus: document.getElementById("profileCivilStatus")?.value || "",
    birthDate: document.getElementById("profileBirthDate")?.value || "",
    placeOfBirth: document.getElementById("profilePlaceOfBirth")?.value.trim() || "",
    phone: document.getElementById("profilePhone")?.value.trim() || "",
    landline: document.getElementById("profileLandline")?.value.trim() || "",
    address,
    sector,
  };

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
  try {
    const uploadedId = await uploadProfileId(idFile);
    await updateDoc(doc(db, "users", user.uid), {
      profileChangeRequest: {
        ...profile,
        idPhotoUrl: uploadedId.secureUrl,
        idPhotoPublicId: uploadedId.publicId,
        idFileName: idFile.name,
        status: "pending",
        submittedAt: serverTimestamp()
      }
    });
    const statusBox = document.getElementById("profileReviewStatus");
    if (statusBox) {
      statusBox.className = "profile-review-status pending";
      statusBox.textContent = "Your information and replacement ID were submitted successfully and are waiting for barangay admin approval. Your current approved information remains active until the review is complete.";
    }
    setProfileFormLocked(document.getElementById("profileForm"), true);
    if (saveBtn) saveBtn.textContent = "Waiting for Approval";
    showToast("Your information update was submitted for approval.", "success");
  } catch (err) {
    console.error("Failed to update resident profile:", err);
    if (error) {
      error.textContent = err?.code === "permission-denied"
        ? "Your update was not submitted because Firestore denied the request. Ask the project administrator to deploy the latest root firestore.rules file, then try again."
        : err instanceof Error ? err.message : "Could not submit your information. Please try again.";
    }
  } finally {
    if (saveBtn && saveBtn.textContent !== "Waiting for Approval") {
      saveBtn.disabled = false;
      saveBtn.textContent = "Submit for Approval";
    }
  }
});

// ─────────────────────────────────────────────
//  DELETE REQUEST
// ─────────────────────────────────────────────
window.deleteRequest = async (id) => {
  if (!confirm("Delete this request? This cannot be undone.")) return;
  try {
    await deleteDoc(doc(db, "requests", id));
    showToast("Request deleted successfully.", "success");
  } catch {
    showToast("Failed to delete request. Please try again.", "error");
  }
};

// ─────────────────────────────────────────────
//  REQUESTS LISTENER  (onSnapshot — real-time, one read per change)
// ─────────────────────────────────────────────
function listenToRequests(uid) {
  const q = query(collection(db, "requests"), where("userId", "==", uid));
  onSnapshot(q, (snapshot) => {
    cachedDocs  = snapshot.docs;
    currentPage = 1;
    renderTable();
  }, () => {
    showToast("Could not load requests. Check your connection.", "error");
  });
}

// ─────────────────────────────────────────────
//  DOC VERIFICATION BADGE HELPER
//  Only shown when:
//   1. The request actually has a fileURL (document was uploaded)
//   2. The request is NOT Completed or Rejected (no longer relevant)
//   3. docVerification is "Invalid" — always shown so resident knows to act
// ─────────────────────────────────────────────
function docVerifBadge(verif, reason, fileURL, status) {
  // No document uploaded — show nothing
  if (!fileURL) return "";

  // Request is fully closed — hide the badge (staff already processed it)
  const closedStatuses = ["Completed", "Rejected"];
  if (closedStatuses.includes(status) && verif !== "Invalid") return "";

  if (!verif || verif === "Pending") {
    return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;
                         font-weight:700;padding:2px 7px;border-radius:5px;
                         background:#fef9c3;color:#854d0e;border:1px solid #fde68a;
                         vertical-align:middle;">
              ⏳ Doc: Under Review
            </span>`;
  }
  if (verif === "Verified") {
    return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;
                         font-weight:700;padding:2px 7px;border-radius:5px;
                         background:#dcfce7;color:#166534;border:1px solid #86efac;
                         vertical-align:middle;">
              ✓ Doc: Verified
            </span>`;
  }
  if (verif === "Invalid") {
    return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;
                         font-weight:700;padding:2px 7px;border-radius:5px;
                         background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;
                         vertical-align:middle;">
              ✕ Doc: Action Needed
            </span>`;
  }
  return "";
}

// ─────────────────────────────────────────────
//  RENDER TABLE + PAGINATION
// ─────────────────────────────────────────────
function renderTable() {
  const table      = document.getElementById("requestTable");
  const historyBox = document.getElementById("historyBox");
  if (!table) return;

  table.innerHTML = "";
  if (historyBox) historyBox.innerHTML = "";

  // Sort newest first
  const sorted = [...cachedDocs].sort((a, b) => {
    const at = a.data().updatedAt || a.data().createdAt;
    const bt = b.data().updatedAt || b.data().createdAt;
    return (bt?.seconds || 0) - (at?.seconds || 0);
  });

  // Count statuses
  let pending = 0, inProgress = 0, pickup = 0, completed = 0;
  cachedDocs.forEach((docSnap) => {
    const s = (docSnap.data().status || "").toLowerCase();
    if (s === "pending")          pending++;
    if (s === "in progress")      inProgress++;
    if (s === "ready for pickup") pickup++;
    if (s === "completed")        completed++;
  });

  // Empty state
  if (sorted.length === 0) {
    table.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </span>
        <p>No requests submitted yet</p>
        <small>Tap <strong>+ New Request</strong> to get started</small>
      </div>`;
    renderPagination(0);
    updateStats(pending, inProgress, pickup, completed, sorted.length);
    return;
  }

  // Pagination slice
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const end   = Math.min(start + PAGE_SIZE, sorted.length);
  const paged = sorted.slice(start, end);

  // Render rows
  paged.forEach((docSnap, i) => {
    const r           = docSnap.data();
    const date        = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString("en-PH") : "—";
    const updated     = r.updatedAt?.toDate ? r.updatedAt.toDate().toLocaleDateString("en-PH") : date;
    const statusClass = getStatusClass(r.status);
    const verif       = r.docVerification || "Pending";
    cachedDocMap[docSnap.id] = r;

    const row = document.createElement("div");
    row.className = "table-row";
    row.style.animationDelay = `${i * 0.04}s`;
    row.innerHTML = `
      <span class="mono"
            style="font-size:11px;max-width:90px;overflow:hidden;text-overflow:ellipsis;
                   display:inline-block;vertical-align:middle;text-align:center;"
            title="${docSnap.id}">
        ${docSnap.id.slice(0, 8).toUpperCase()}…
      </span>
      <span style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;white-space:normal;overflow:visible;">
        <span>${r.serviceType || "—"}</span>
        ${docVerifBadge(verif, r.docInvalidReason, r.fileURL, r.status)}
      </span>
      <span>${date}</span>
      <span>
        <span class="status ${statusClass}">
          <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"
               style="vertical-align:middle;margin-right:4px;">
            <circle cx="4" cy="4" r="4" fill="currentColor"/>
          </svg>
          ${r.status || "—"}
        </span>
      </span>
      <span>${updated}</span>
      <span class="row-actions">
        <button class="view-btn" onclick="viewRequestDetails('${docSnap.id}')">
          View Details
        </button>
        ${r.status === "Pending"
          ? `<button class="delete-btn" onclick="deleteRequest('${docSnap.id}')">Delete</button>`
          : ""}
      </span>`;
    table.appendChild(row);
  });

  renderPagination(sorted.length);
  updateStats(pending, inProgress, pickup, completed, sorted.length);

  // History section
  if (historyBox && showHistory) {
    const histFiltered = sorted.filter(d =>
      ["Completed", "Rejected"].includes(d.data().status));
    if (histFiltered.length === 0) {
      historyBox.innerHTML =
        `<p style="color:var(--muted);font-size:14px;padding:16px 0;">
           No completed or rejected requests yet.
         </p>`;
    } else {
      histFiltered.forEach((docSnap, i) => {
        const r    = docSnap.data();
        const time = r.updatedAt || r.createdAt;
        const dateText = time?.toDate ? time.toDate().toLocaleString("en-PH") : "";
        const item = document.createElement("div");
        item.className = "history-item";
        item.style.animationDelay = `${i * 0.04}s`;
        item.innerHTML = `
          <div class="history-left">
            <b>${r.serviceType || "—"}</b>
            <span class="history-status ${r.status === "Rejected" ? "rejected" : "completed"}">
              ${r.status}
            </span>
          </div>
          <div class="history-date">${dateText}</div>`;
        historyBox.appendChild(item);
      });
    }
  }
}

// ─────────────────────────────────────────────
//  PAGINATION
// ─────────────────────────────────────────────
function renderPagination(total) {
  let wrapper = document.getElementById("paginationWrapper");
  if (!wrapper) {
    wrapper = document.createElement("div");
    wrapper.id = "paginationWrapper";
    wrapper.className = "pagination-wrapper";
    const tableEl = document.getElementById("requestTable");
    tableEl?.parentNode?.insertBefore(wrapper, tableEl.nextSibling);
  }
  wrapper.innerHTML = "";
  if (total <= PAGE_SIZE) return;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end   = Math.min(currentPage * PAGE_SIZE, total);

  const info = document.createElement("div");
  info.className   = "pagination-info";
  info.textContent = `Showing ${start}–${end} of ${total} requests`;
  wrapper.appendChild(info);

  const nav  = document.createElement("div");
  nav.className = "pagination";

  const prev = document.createElement("button");
  prev.className = "page-btn nav-page";
  prev.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <polyline points="15 18 9 12 15 6"/></svg>`;
  prev.disabled  = currentPage === 1;
  prev.setAttribute("aria-label", "Previous page");
  prev.onclick   = () => { currentPage--; renderTable(); scrollToTable(); };
  nav.appendChild(prev);

  getPageRange(currentPage, totalPages).forEach(p => {
    if (p === "…") {
      const ellipsis = document.createElement("span");
      ellipsis.textContent = "…";
      ellipsis.style.cssText =
        "display:flex;align-items:center;padding:0 4px;color:var(--muted);font-size:13px;";
      nav.appendChild(ellipsis);
    } else {
      const btn = document.createElement("button");
      btn.className   = `page-btn${p === currentPage ? " active" : ""}`;
      btn.textContent = p;
      btn.setAttribute("aria-label", `Page ${p}`);
      if (p === currentPage) btn.setAttribute("aria-current", "page");
      btn.onclick = () => { currentPage = p; renderTable(); scrollToTable(); };
      nav.appendChild(btn);
    }
  });

  const next = document.createElement("button");
  next.className = "page-btn nav-page";
  next.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <polyline points="9 18 15 12 9 6"/></svg>`;
  next.disabled  = currentPage === totalPages;
  next.setAttribute("aria-label", "Next page");
  next.onclick   = () => { currentPage++; renderTable(); scrollToTable(); };
  nav.appendChild(next);

  wrapper.appendChild(nav);
}

function getPageRange(current, total) {
  if (total <= 3) return Array.from({ length: total }, (_, i) => i + 1);
  if (current === 1)     return [1, 2, "…"];
  if (current === total) return ["…", total - 1, total];
  return ["…", current, "…"];
}

function scrollToTable() {
  document.querySelector(".table-header")?.scrollIntoView({ behavior:"smooth", block:"start" });
}

function updateStats(pending, inProgress, pickup, completed, total) {
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  setText("total",      total);
  setText("pending",    pending);
  setText("inprogress", inProgress);
  setText("pickup",     pickup);
  setText("completed",  completed);
}

// ─────────────────────────────────────────────
//  VIEW DETAILS MODAL
//  Enhanced: shows doc verification status, Cloudinary link,
//  and the invalid reason so resident knows what to fix
// ─────────────────────────────────────────────
window.viewRequestDetails = function (id) {
  const r = cachedDocMap[id];
  if (!r) return;

  const modal = document.getElementById("detailsModal");
  const body  = document.getElementById("detailsBody");
  if (!modal || !body) return;

  const statusClass = getStatusClass(r.status);
  const submitted   = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString("en-PH") : "—";
  const updated     = r.updatedAt?.toDate ? r.updatedAt.toDate().toLocaleString("en-PH") : submitted;
  const verif       = r.docVerification  || "Pending";
  const reason      = r.docInvalidReason || "";

  // ── Doc verification block ──
  let docSection = "";
  if (r.fileURL) {
    const isPDF  = r.fileType === "application/pdf";
    const isImg  = r.fileType?.startsWith("image/");
    const sizeKb = r.fileSizeBytes ? ` · ${(r.fileSizeBytes / 1024).toFixed(0)} KB` : "";

    // Status-specific messaging
    // For closed requests (Completed/Rejected) skip the "Under Review" message
    const isClosed = ["Completed", "Rejected"].includes(r.status);
    let verifBlock = "";
    if (isClosed && verif !== "Invalid") {
      verifBlock = ""; // no doc status message for closed requests
    } else if (verif === "Verified") {
      verifBlock = `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;
                    background:#dcfce7;border-radius:10px;border:1px solid #86efac;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
               fill="none" stroke="#16a34a" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span style="font-size:13px;font-weight:700;color:#166534;">
            Your document has been verified by staff.
          </span>
        </div>`;
    } else if (verif === "Invalid") {
      verifBlock = `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;
                    padding:14px 16px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                 fill="none" stroke="#dc2626" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span style="font-size:13px;font-weight:800;color:#991b1b;">
              Document Needs Correction
            </span>
          </div>
          ${reason
            ? `<div style="font-size:13px;color:#b91c1c;line-height:1.55;margin-bottom:8px;">
                 <strong>Reason from staff:</strong> ${reason}
               </div>`
            : ""}
          <div style="font-size:12px;color:#7f1d1d;padding-top:8px;
                      border-top:1px solid #fecaca;line-height:1.55;">
            Please submit a new request with a valid, readable document to continue processing.
          </div>
        </div>`;
    } else {
      verifBlock = `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;
                    background:#fef9c3;border-radius:10px;border:1px solid #fde68a;">
          <span style="font-size:15px;">⏳</span>
          <span style="font-size:13px;font-weight:600;color:#854d0e;">
            Your document is being reviewed by staff.
          </span>
        </div>`;
    }

    docSection = `
      <div class="detail-section">
        <h4 class="detail-label">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2"
               style="vertical-align:middle;margin-right:4px;">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          Supporting Document
        </h4>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">
          ${verifBlock}
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <a href="${r.fileURL}" target="_blank" rel="noopener noreferrer"
               style="display:inline-flex;align-items:center;gap:6px;padding:9px 16px;
                      background:#1a2cff;color:#fff;border-radius:8px;text-decoration:none;
                      font-size:12px;font-weight:600;min-height:40px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              ${isPDF ? "Open PDF" : "View Image"}
            </a>
            <span style="font-size:11px;color:#9ca3af;">
              ${r.fileName || "document"}${sizeKb}
            </span>
          </div>
        </div>
      </div>`;
  }

  // ── Pickup schedule block ──
  let pickupSection = "";
  if (r.pickupDate) {
    const pd    = r.pickupDate.toDate ? r.pickupDate.toDate() : new Date(r.pickupDate);
    const fmtd  = pd.toLocaleDateString("en-PH",
      { weekday:"long", year:"numeric", month:"long", day:"numeric" });
    let timeFmt = "";
    if (r.pickupTime) {
      const [hStr, mStr] = r.pickupTime.split(":");
      const h     = parseInt(hStr, 10);
      const m     = mStr || "00";
      const h12   = h % 12 === 0 ? 12 : h % 12;
      timeFmt     = ` at ${h12}:${m} ${h >= 12 ? "PM" : "AM"}`;
    }
    pickupSection = `
      <div class="detail-section"
           style="background:#d1fae5;border-radius:10px;padding:14px;
                  border-left:4px solid #10b981;margin-top:4px;">
        <h4 class="detail-label" style="color:#047857;">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2"
               style="vertical-align:middle;margin-right:4px;">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8"  y1="2" x2="8"  y2="6"/>
            <line x1="3"  y1="10" x2="21" y2="10"/>
          </svg>
          Pickup Schedule
        </h4>
        <p class="detail-value" style="color:#065f46;font-weight:600;">
          ${fmtd}${timeFmt}
        </p>
        <p style="font-size:12px;color:#065f46;margin-top:4px;">
          Please bring a valid ID when claiming your document.
        </p>
      </div>`;
  }

  body.innerHTML = `
    <!-- STATUS BADGE -->
    <div class="detail-section">
      <div class="detail-badge">
        <span class="status ${statusClass}">
          <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"
               style="vertical-align:middle;margin-right:4px;">
            <circle cx="4" cy="4" r="4" fill="currentColor"/>
          </svg>
          ${r.status || "—"}
        </span>
      </div>
    </div>

    <!-- REQUEST ID -->
    <div class="detail-section">
      <h4 class="detail-label">Request ID</h4>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;
                  background:#f0f2ff;border-radius:8px;padding:10px 12px;">
        <span style="font-family:monospace;font-size:13px;color:#1a2cff;
                     word-break:break-all;flex:1;">${id}</span>
        <button onclick="(function(){
            navigator.clipboard.writeText('${id}').then(()=>{
              const b=document.getElementById('copyIdBtn');
              b.textContent='Copied!';b.style.color='#22c55e';
              setTimeout(()=>{b.textContent='Copy';b.style.color='';},1800);
            });
          })()" id="copyIdBtn"
          style="background:#1a2cff;color:#fff;border:none;border-radius:6px;
                 padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;
                 white-space:nowrap;font-family:inherit;min-height:34px;flex-shrink:0;">
          Copy
        </button>
      </div>
      <p style="font-size:11px;color:#6b7280;margin-top:6px;">
        Use this ID on the
        <a href="/track.html" style="color:#1a2cff;font-weight:600;">Track Request</a>
        page to check your status without logging in.
      </p>
    </div>

    <!-- SERVICE -->
    <div class="detail-section">
      <h4 class="detail-label">Service Requested</h4>
      <p class="detail-value highlight-value">${r.serviceType || "—"}</p>
    </div>

    <!-- NAME + CONTACT -->
    <div class="detail-row-2">
      <div class="detail-section">
        <h4 class="detail-label">Full Name</h4>
        <p class="detail-value">${r.fullName || "—"}</p>
      </div>
      <div class="detail-section">
        <h4 class="detail-label">Contact Number</h4>
        <p class="detail-value">${r.contact || "—"}</p>
      </div>
    </div>

    <!-- ADDRESS -->
    <div class="detail-section">
      <h4 class="detail-label">Address</h4>
      <p class="detail-value">${r.address || "—"}</p>
    </div>

    <!-- PURPOSE -->
    <div class="detail-section">
      <h4 class="detail-label">Purpose / Reason</h4>
      <p class="detail-value">${r.purpose || "—"}</p>
    </div>

    ${r.notes ? `
    <div class="detail-section">
      <h4 class="detail-label">Additional Notes</h4>
      <p class="detail-value">${r.notes}</p>
    </div>` : ""}

    <!-- DOCUMENT SECTION (NEW) -->
    ${docSection}

    <!-- DATES -->
    <div class="detail-row-2">
      <div class="detail-section">
        <h4 class="detail-label">Date Submitted</h4>
        <p class="detail-value muted">${submitted}</p>
      </div>
      <div class="detail-section">
        <h4 class="detail-label">Last Updated</h4>
        <p class="detail-value muted">${updated}</p>
      </div>
    </div>

    ${r.updatedBy ? `
    <div class="detail-section">
      <h4 class="detail-label">Modified By</h4>
      <p class="detail-value muted">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2"
             style="vertical-align:middle;margin-right:3px;">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        ${r.updatedBy}
      </p>
    </div>` : ""}

    ${r.staffNote ? `
    <div class="detail-section staff-note-box">
      <h4 class="detail-label">Staff Note</h4>
      <p class="detail-value">${r.staffNote}</p>
    </div>` : ""}

    ${r.adminNotes ? `
    <div class="detail-section internal-note-box">
      <h4 class="detail-label">Internal Notes</h4>
      <p class="detail-value">${r.adminNotes}</p>
    </div>` : ""}

    <!-- PICKUP SECTION -->
    ${pickupSection}
  `;

  modal.classList.add("open");
  document.body.style.overflow = "hidden";
};

window.closeDetailsModal = function () {
  document.getElementById("detailsModal")?.classList.remove("open");
  document.body.style.overflow = "";
};

// Click outside modal to close
document.getElementById("detailsModal")?.addEventListener("click", (e) => {
  if (e.target.id === "detailsModal") window.closeDetailsModal();
});

// Escape key to close
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") window.closeDetailsModal();
});

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function getStatusClass(status) {
  if (!status) return "";
  const s = status.toLowerCase();
  if (s === "pending")          return "yellow";
  if (s === "in progress")      return "blue";
  if (s === "ready for pickup") return "green";
  if (s === "completed")        return "blue";
  if (s === "rejected")         return "red";
  return "gray";
}

// ─────────────────────────────────────────────
//  ACTIONS
// ─────────────────────────────────────────────
window.toggleHistory = () => { showHistory = !showHistory; renderTable(); };

// ─────────────────────────────────────────────
//  ANNOUNCEMENTS
// ─────────────────────────────────────────────
function preloadAnnBadge() {
  const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    const badge = document.getElementById("annBadge");
    if (!badge) return;
    const read   = getReadAnnouncements();
    let   unread = 0;
    snapshot.forEach(d => { if (!read.includes(d.id)) unread++; });
    badge.textContent   = unread > 9 ? "9+" : unread;
    badge.style.display = unread > 0 ? "inline-block" : "none";
  });
}

function getAnnKey() {
  const uid = localStorage.getItem("bf_resident_uid") || "guest";
  return `readAnnouncements_${uid}`;
}
function getReadAnnouncements() {
  try { return JSON.parse(localStorage.getItem(getAnnKey()) || "[]"); }
  catch { return []; }
}
function markAnnouncementRead(id) {
  const read = getReadAnnouncements();
  if (!read.includes(id)) {
    read.push(id);
    localStorage.setItem(getAnnKey(), JSON.stringify(read));
  }
}

window.openAnnModal = function (id, title, content, date) {
  markAnnouncementRead(id);
  document.getElementById("annDetailTitle").textContent   = title;
  document.getElementById("annDetailContent").textContent = content;
  document.getElementById("annDetailDate").textContent    = date;
  document.getElementById("annDetailModal")?.classList.add("open");
  document.body.style.overflow = "hidden";
  const card = document.querySelector(`[data-ann-id="${id}"]`);
  if (card) applyReadStyle(card, true);
  updateAnnBadge();
};
window.closeAnnModal = function () {
  document.getElementById("annDetailModal")?.classList.remove("open");
  document.body.style.overflow = "";
};

function applyReadStyle(card, isRead) {
  card.style.opacity         = isRead ? "0.7" : "1";
  card.style.borderLeftColor = isRead ? "#d1d5db" : "var(--primary, #1a2cff)";
  if (isRead) card.querySelector(".ann-unread-dot")?.remove();
}

function updateAnnBadge() {
  const badge = document.getElementById("annBadge");
  if (!badge) return;
  const read    = getReadAnnouncements();
  let   unread  = 0;
  document.querySelectorAll("[data-ann-id]").forEach(c => {
    if (!read.includes(c.dataset.annId)) unread++;
  });
  badge.textContent   = unread > 9 ? "9+" : unread;
  badge.style.display = unread > 0 ? "inline-block" : "none";
}

function listenToAnnouncements() {
  if (annUnsubscriber) annUnsubscriber();
  const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
  annUnsubscriber = onSnapshot(q, (snapshot) => {
    const list = document.getElementById("announcementList");
    if (!list) return;
    if (snapshot.empty) {
      list.innerHTML = "<p style='color:var(--muted);'>No announcements at this time.</p>";
      document.getElementById("annBadge") &&
        (document.getElementById("annBadge").style.display = "none");
      return;
    }
    const read = getReadAnnouncements();
    list.innerHTML = "";
    snapshot.docs.forEach((docSnap) => {
      const a      = docSnap.data();
      const annId  = docSnap.id;
      const isRead = read.includes(annId);
      const date   = a.createdAt?.toDate
        ? a.createdAt.toDate().toLocaleDateString("en-PH",
            { year:"numeric", month:"long", day:"numeric" })
        : "";
      const card = document.createElement("div");
      card.dataset.annId = annId;
      card.style.cssText = `
        background:white;padding:18px 20px;border-radius:14px;margin-bottom:14px;
        border-left:4px solid ${isRead ? "#d1d5db" : "var(--primary,#1a2cff)"};
        box-shadow:var(--shadow,0 2px 8px rgba(0,0,0,.07));
        opacity:${isRead ? "0.7" : "1"};cursor:pointer;
        transition:box-shadow .15s,transform .12s;`;
      card.onmouseenter = () => {
        card.style.boxShadow = "0 4px 18px rgba(0,0,0,.13)";
        card.style.transform = "translateY(-1px)";
      };
      card.onmouseleave = () => {
        card.style.boxShadow = "var(--shadow,0 2px 8px rgba(0,0,0,.07))";
        card.style.transform = "";
      };
      card.onclick = () => window.openAnnModal(annId, a.title, a.content, date);
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;
                    margin-bottom:8px;gap:12px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:8px;flex:1;">
            ${!isRead
              ? `<span class="ann-unread-dot"
                       style="width:8px;height:8px;border-radius:50%;
                              background:#ef4444;flex-shrink:0;"></span>`
              : ""}
            <b style="font-size:15px;font-weight:700;color:${isRead ? "#6b7280" : "#111827"};">
              ${a.title}
            </b>
          </div>
          <small style="color:var(--muted,#6b7280);font-size:12px;white-space:nowrap;">
            📅 ${date}
          </small>
        </div>
        <p style="font-size:14px;color:${isRead ? "#9ca3af" : "#4b5563"};line-height:1.65;
                  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
                  overflow:hidden;">
          ${a.content}
        </p>
        <p style="font-size:12px;color:var(--primary,#1a2cff);margin-top:8px;font-weight:600;">
          ${isRead ? "✓ Read" : "Click to read more →"}
        </p>`;
      list.appendChild(card);
    });
    updateAnnBadge();
  });
}

// ─────────────────────────────────────────────
//  NOTIFICATIONS  (onSnapshot — efficient, single listener)
// ─────────────────────────────────────────────
function listenToNotifications(uid) {
  const q = query(
    collection(db, "requests"),
    where("userId", "==", uid),
    orderBy("updatedAt", "desc")
  );
  let lastShown = null;
  onSnapshot(q, (snapshot) => {
    if (snapshot.empty) return;
    const docSnap = snapshot.docs[0];
    const latest  = docSnap.data();
    const key     = docSnap.id + latest.status;
    if (key === lastShown) return;
    lastShown = key;

    const time     = latest.updatedAt || latest.createdAt;
    const dateText = time?.toDate ? time.toDate().toLocaleString("en-PH") : "";

    const latestEl = document.getElementById("latestUpdate");
    const timeEl   = document.getElementById("updateTime");
    if (latestEl) latestEl.innerHTML =
      `<b>${latest.serviceType || "Request"}</b> is now <b>${latest.status}</b>`;
    if (timeEl) timeEl.innerText = dateText;

    showToast(
      `${latest.serviceType || "Request"} is now <b>${latest.status}</b>`,
      "info"
    );
  });
}

// ─────────────────────────────────────────────
//  LOGOUT
// ─────────────────────────────────────────────
window.logout = () => {
  const modal = document.getElementById("logoutModal");
  if (modal) { modal.classList.add("open"); document.body.style.overflow = "hidden"; }
};

window.cancelLogout = () => {
  const modal = document.getElementById("logoutModal");
  if (modal) { modal.classList.remove("open"); document.body.style.overflow = ""; }
};

window.confirmLogout = async () => {
  const btn = document.getElementById("confirmLogoutBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Logging out…"; }
  localStorage.removeItem("bf_resident_uid");
  sessionStorage.removeItem("bf_session_active");
  await signOut(auth);
  window.location.replace("login.html");
};
