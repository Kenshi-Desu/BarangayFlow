/**
 * review.js — BarangayFlow Staff Request Review Panel
 *
 * New features added:
 *  - Document preview panel (image inline / PDF link with size info)
 *  - "Verify Document" button → sets docVerification = "Verified"
 *  - "Mark Invalid" button → opens reason modal, stores reason in Firestore
 *    so resident can see it on their dashboard
 */

import { auth, db } from "./firebase.js";
import {
  doc, getDoc, updateDoc, deleteField, collection, query, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── Back/forward cache guard ─────────────────────────────────────────────────
// Fires when page is restored from bfcache (browser back after logout).
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    const role = localStorage.getItem("role");
    const uid  = localStorage.getItem("uid");
    if (!role || !uid) {
      window.location.replace("admin-login.html");
    }
  }
});



// ======================
// TOAST
// ======================
function showToast(msg, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const icons = { success: "✓", error: "✕", warning: "!", info: "i" };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || "i"} ${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity   = "0";
    toast.style.transform = "translateX(30px)";
    setTimeout(() => toast.remove(), 350);
  }, 4500);
}

// ======================
// TAB NAVIGATION
// ======================
window.showTab = (tabName) => {
  const reviewTab = document.getElementById("tab-review");
  const annTab    = document.getElementById("tab-announcements");
  const navAnn    = document.getElementById("nav-ann");
  if (tabName === "review") {
    reviewTab.style.display = "block";
    annTab.style.display    = "none";
    navAnn.classList.remove("active");
  } else {
    reviewTab.style.display = "none";
    annTab.style.display    = "block";
    navAnn.classList.add("active");
    listenToAnnouncements();
  }
};

// ======================
// AUTH & INIT
// ======================
onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.replace("admin-login.html"); return; }
  const storedUid  = localStorage.getItem("uid");
  const storedRole = localStorage.getItem("role");
  if (!storedUid || storedUid !== user.uid || !storedRole) {
    window.location.replace("admin-login.html");
    return;
  }
  const navEl = document.getElementById("adminNav");
  if (navEl) navEl.innerText = user.email;
  loadRequest();
  setupAutoSave();
  preloadAnnBadge();
  injectDocVerificationUI();
});

function getRequestId() {
  return new URLSearchParams(window.location.search).get("id");
}

// ======================
// LOAD REQUEST
// ======================
async function loadRequest() {
  const id = getRequestId();
  if (!id) { showToast("No request ID provided.", "error"); return; }
  try {
    const snap = await getDoc(doc(db, "requests", id));
    if (!snap.exists()) { showToast("Request not found.", "error"); return; }
    const r = snap.data();

    document.getElementById("reqId").innerText        = id;
    document.getElementById("date").innerText         = r.createdAt?.toDate()?.toLocaleString() || "—";
    document.getElementById("service").innerText      = r.serviceType || "—";
    document.getElementById("status").innerText       = r.status || "—";
    document.getElementById("statusDot").className    = `status-dot ${getStatusClass(r.status)}`;
    document.getElementById("name").innerText         = r.fullName  || "—";
    document.getElementById("contact").innerText      = r.contact   || "—";
    document.getElementById("address").innerText      = r.address   || "—";
    document.getElementById("purpose").innerText      = r.purpose   || "—";
    document.getElementById("notes").innerText        = r.notes     || "—";
    document.getElementById("adminNotes").value       = r.adminNotes || "";
    document.getElementById("sysCreated").innerText   = r.createdAt?.toDate()?.toLocaleString() || "—";
    document.getElementById("sysUpdated").innerText   = r.updatedAt?.toDate()?.toLocaleString() || "—";
    document.getElementById("sysUpdatedBy").innerText = r.updatedBy || "System";

    // ── Document section ──
    renderDocumentSection(r);

    // Pre-fill pickup schedule if already set
    if (r.pickupDate) {
      const pd = r.pickupDate.toDate ? r.pickupDate.toDate() : new Date(r.pickupDate);
      const yyyy = pd.getFullYear();
      const mm   = String(pd.getMonth()+1).padStart(2,"0");
      const dd   = String(pd.getDate()).padStart(2,"0");
      const pdInput = document.getElementById("pickupDate");
      const ptInput = document.getElementById("pickupTime");
      if (pdInput) pdInput.value = `${yyyy}-${mm}-${dd}`;
      if (ptInput) ptInput.value = r.pickupTime || "";
      const box = document.getElementById("pickupScheduleBox");
      if (box && r.status === "Ready for Pickup") box.style.display = "block";
    }

    const timelineEl = document.getElementById("timeline");
    if (timelineEl) {
      timelineEl.innerHTML = `
        <div class="timeline-item"><span class="dot"></span> Submitted: ${r.createdAt?.toDate()?.toLocaleString() || "—"}</div>
        ${r.status !== "Pending" ? `<div class="timeline-item"><span class="dot"></span> Last Updated: ${r.updatedAt?.toDate()?.toLocaleString() || "—"}</div>` : ""}
        <div class="timeline-item"><span class="dot ${getStatusClass(r.status)}"></span> Current: <b>${r.status}</b></div>`;
    }
  } catch (err) {
    showToast("Error loading request data.", "error");
    console.error(err);
  }
}

// ======================
// DOCUMENT SECTION RENDERER
// Renders the uploaded file + verification status + action buttons
// ======================
function renderDocumentSection(r) {
  const fileContainer = document.getElementById("docSectionContainer");
  if (!fileContainer) return;

  const hasFile       = !!r.fileURL;
  const verif         = r.docVerification || "Pending";   // "Pending" | "Verified" | "Invalid"
  const invalidReason = r.docInvalidReason || "";
  const sizeKb        = r.fileSizeBytes ? `${(r.fileSizeBytes / 1024).toFixed(0)} KB` : "";
  const isPDF         = r.fileType === "application/pdf";
  const isImage       = r.fileType?.startsWith("image/");

  // ── Verification badge colors ──
  const badgeStyles = {
    Pending:  "background:#fef9c3;color:#854d0e;border:1px solid #fde68a;",
    Verified: "background:#dcfce7;color:#166534;border:1px solid #86efac;",
    Invalid:  "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;"
  };
  const badgeStyle = badgeStyles[verif] || badgeStyles.Pending;

  // ── Build inner HTML ──
  let html = "";

  if (!hasFile) {
    html = `<p style="color:#6b7280;font-style:italic;font-size:13px;">No supporting document was attached to this request.</p>`;
  } else {
    // File info row
    html += `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        <span style="padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;${badgeStyle}">
          ${verif === "Pending" ? "⏳" : verif === "Verified" ? "✓" : "✕"} ${verif}
        </span>
        ${sizeKb ? `<span style="font-size:12px;color:#6b7280;">${sizeKb}</span>` : ""}
        ${r.fileName ? `<span style="font-size:12px;color:#374151;font-weight:500;">${r.fileName}</span>` : ""}
      </div>`;

    // Invalid reason display (visible to staff; residents see it via dashboard.js)
    if (verif === "Invalid" && invalidReason) {
      html += `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:13px;color:#b91c1c;">
          <strong>Reason:</strong> ${invalidReason}
        </div>`;
    }

    // Preview or link
    if (isImage) {
      html += `
        <div style="margin-bottom:12px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;max-height:300px;display:flex;align-items:center;justify-content:center;background:#f9fafb;">
          <img src="${r.fileURL}" alt="Uploaded document"
               style="max-width:100%;max-height:300px;object-fit:contain;display:block;"
               loading="lazy"
               onerror="this.style.display='none';this.nextSibling.style.display='block';">
          <span style="display:none;padding:20px;color:#6b7280;font-size:13px;">Preview unavailable.</span>
        </div>
        <a href="${r.fileURL}" target="_blank" rel="noopener"
           style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#1a2cff;text-decoration:none;margin-bottom:12px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Open full image in new tab
        </a>`;
    } else if (isPDF) {
      html += `
        <a href="${r.fileURL}" target="_blank" rel="noopener" class="file-btn"
           style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:#1a2cff;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;margin-bottom:12px;min-height:44px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Open PDF Document
        </a>`;
    } else {
      html += `
        <a href="${r.fileURL}" target="_blank" rel="noopener" class="file-btn"
           style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:#1a2cff;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;margin-bottom:12px;min-height:44px;">
          Open / Download Document
        </a>`;
    }

    // ── Verify / Invalid action buttons ──
    if (verif !== "Verified") {
      html += `
        <button onclick="verifyDocument()" id="verifyBtn"
                style="display:inline-flex;align-items:center;gap:6px;padding:11px 20px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;margin-right:8px;min-height:44px;font-family:inherit;transition:background .15s;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Verify Document
        </button>`;
    }
    if (verif !== "Invalid") {
      html += `
        <button onclick="openInvalidModal()" id="invalidBtn"
                style="display:inline-flex;align-items:center;gap:6px;padding:11px 20px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;min-height:44px;font-family:inherit;transition:background .15s;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Mark as Invalid
        </button>`;
    }
  }

  fileContainer.innerHTML = html;
}

// ======================
// INJECT DOC VERIFICATION UI
// Adds the container + the "Invalid reason" modal to the DOM if not present
// ======================
function injectDocVerificationUI() {
  // Container inside the existing #fileLink card
  if (!document.getElementById("docSectionContainer")) {
    const fl = document.getElementById("fileLink");
    if (fl) {
      // Replace the old fileLink anchor with a richer container
      const wrapper = document.createElement("div");
      wrapper.id = "docSectionContainer";
      wrapper.style.cssText = "margin-top:8px;";
      fl.parentNode.replaceChild(wrapper, fl);
    }
  }

  // Modal for "Mark as Invalid" reason entry
  if (!document.getElementById("invalidReasonModal")) {
    const modal = document.createElement("div");
    modal.id = "invalidReasonModal";
    modal.style.cssText = `
      display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;
      align-items:center;justify-content:center;padding:20px;`;
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px;width:100%;max-width:420px;padding:28px 24px;box-shadow:0 20px 60px rgba(0,0,0,0.2);animation:docPop .2s cubic-bezier(.34,1.2,.64,1);">
        <h3 style="font-size:16px;font-weight:800;color:#1f2937;margin-bottom:6px;">Mark Document as Invalid</h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:16px;">
          Provide a short reason. The resident will see this on their dashboard so they know what to fix.
        </p>
        <textarea id="invalidReasonInput"
          placeholder="e.g. ID is expired · Photo is blurry / unreadable · Wrong document submitted"
          rows="3"
          style="width:100%;padding:12px 14px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical;outline:none;color:#1f2937;"
          maxlength="300"></textarea>
        <div id="invalidReasonError" style="color:#dc2626;font-size:12px;margin-top:4px;display:none;"></div>
        <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end;">
          <button onclick="closeInvalidModal()"
                  style="padding:10px 20px;border:1.5px solid #e5e7eb;background:#fff;color:#374151;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;min-height:44px;">
            Cancel
          </button>
          <button onclick="submitInvalidReason()" id="submitInvalidBtn"
                  style="padding:10px 20px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;min-height:44px;">
            Confirm Invalid
          </button>
        </div>
      </div>
      <style>@keyframes docPop{from{transform:scale(0.95) translateY(12px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}</style>`;
    document.body.appendChild(modal);
  }
}

// ======================
// VERIFY DOCUMENT
// ======================
window.verifyDocument = async () => {
  const id  = getRequestId();
  const btn = document.getElementById("verifyBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Verifying…"; }
  try {
    await updateDoc(doc(db, "requests", id), {
      docVerification:  "Verified",
      docInvalidReason: "",
      updatedAt:        serverTimestamp(),
      updatedBy:        auth.currentUser?.email || "staff"
    });
    showToast("Document marked as Verified.", "success");
    loadRequest();
  } catch (err) {
    showToast("Failed to verify document.", "error");
    if (btn) { btn.disabled = false; btn.textContent = "Verify Document"; }
  }
};

// ======================
// MARK INVALID — modal helpers
// ======================
window.openInvalidModal = () => {
  const modal = document.getElementById("invalidReasonModal");
  const input = document.getElementById("invalidReasonInput");
  const errEl = document.getElementById("invalidReasonError");
  if (modal) { modal.style.display = "flex"; document.body.style.overflow = "hidden"; }
  if (input) { input.value = ""; input.focus(); }
  if (errEl) errEl.style.display = "none";
};

window.closeInvalidModal = () => {
  const modal = document.getElementById("invalidReasonModal");
  if (modal) { modal.style.display = "none"; document.body.style.overflow = ""; }
};

window.submitInvalidReason = async () => {
  const input  = document.getElementById("invalidReasonInput");
  const errEl  = document.getElementById("invalidReasonError");
  const reason = input?.value?.trim();

  if (!reason) {
    if (errEl) { errEl.textContent = "Please enter a reason."; errEl.style.display = "block"; }
    input?.focus();
    return;
  }
  if (errEl) errEl.style.display = "none";

  const id  = getRequestId();
  const btn = document.getElementById("submitInvalidBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    await updateDoc(doc(db, "requests", id), {
      docVerification:  "Invalid",
      docInvalidReason: reason,
      updatedAt:        serverTimestamp(),
      updatedBy:        auth.currentUser?.email || "staff"
    });
    closeInvalidModal();
    showToast("Document marked as Invalid. Resident will be notified.", "warning");
    loadRequest();
  } catch (err) {
    showToast("Failed to save invalid reason.", "error");
    if (btn) { btn.disabled = false; btn.textContent = "Confirm Invalid"; }
  }
};

// Allow closing modal by clicking outside
document.addEventListener("click", (e) => {
  const modal = document.getElementById("invalidReasonModal");
  if (modal && e.target === modal) closeInvalidModal();
});

// ======================
// ANNOUNCEMENTS
// ======================
function preloadAnnBadge() {
  const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    const badge = document.getElementById("annBadge");
    if (!badge) return;
    const read = getReadAnnouncements();
    let unread = 0;
    snapshot.forEach(d => { if (!read.includes(d.id)) unread++; });
    if (unread > 0) { badge.textContent = unread > 9 ? "9+" : unread; badge.style.display = "inline-block"; }
    else            { badge.style.display = "none"; }
  });
}

function getReadAnnouncements() {
  try { return JSON.parse(localStorage.getItem("readAnnouncementsStaff") || "[]"); } catch { return []; }
}
function markAnnouncementRead(id) {
  const read = getReadAnnouncements();
  if (!read.includes(id)) { read.push(id); localStorage.setItem("readAnnouncementsStaff", JSON.stringify(read)); }
}
window.openAnnModal = function(id, title, content, date) {
  markAnnouncementRead(id);
  const titleEl   = document.getElementById("annDetailTitle");
  const contentEl = document.getElementById("annDetailContent");
  const dateEl    = document.getElementById("annDetailDate");
  if (titleEl)   titleEl.textContent   = title;
  if (contentEl) contentEl.textContent = content;
  if (dateEl)    dateEl.textContent    = date;
  const modal = document.getElementById("annDetailModal");
  if (modal) modal.style.display = "flex";
  // Refresh badge
  const badge = document.getElementById("annBadge");
  if (badge) {
    const read = getReadAnnouncements();
    const cur  = parseInt(badge.textContent) || 0;
    const next = Math.max(0, cur - 1);
    badge.textContent    = next > 9 ? "9+" : next;
    badge.style.display  = next > 0 ? "inline-block" : "none";
  }
};
window.closeAnnModal = function() {
  const modal = document.getElementById("annDetailModal");
  if (modal) modal.style.display = "none";
};

function listenToAnnouncements() {
  const listEl = document.getElementById("annList");
  if (!listEl) return;
  const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    if (snapshot.empty) { listEl.innerHTML = "<p style='color:#6b7280;font-size:14px;'>No announcements yet.</p>"; return; }
    const read = getReadAnnouncements();
    listEl.innerHTML = "";
    snapshot.forEach(d => {
      const a    = d.data();
      const date = a.createdAt?.toDate()?.toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" }) || "—";
      const isNew = !read.includes(d.id);
      const item = document.createElement("div");
      item.className = "ann-item";
      item.style.cssText = `cursor:pointer;padding:14px 16px;border-radius:10px;border:1px solid ${isNew?"#bfdbfe":"#e5e7eb"};background:${isNew?"#eff6ff":"#fff"};margin-bottom:10px;`;
      item.innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div>
            ${isNew ? `<span style="font-size:10px;font-weight:700;color:#1d4ed8;background:#dbeafe;padding:2px 7px;border-radius:999px;margin-right:6px;">NEW</span>` : ""}
            <strong style="font-size:14px;color:#1f2937;">${a.title || "Announcement"}</strong>
          </div>
          <span style="font-size:11px;color:#9ca3af;white-space:nowrap;">${date}</span>
        </div>
        <p style="font-size:13px;color:#6b7280;margin-top:6px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${a.content || ""}</p>`;
      item.addEventListener("click", () => openAnnModal(d.id, a.title, a.content, date));
      listEl.appendChild(item);
    });
  });
}

// ======================
// UPDATE STATUS
// ======================
window.updateStatus = async () => {
  const id     = getRequestId();
  const newSt  = document.getElementById("newStatus")?.value;
  if (!newSt)  { showToast("Please select a new status.", "warning"); return; }

  const updateData = {
    status:    newSt,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.email || "staff"
  };

  if (newSt === "Ready for Pickup") {
    const pickupDate = document.getElementById("pickupDate")?.value;
    const pickupTime = document.getElementById("pickupTime")?.value;
    if (!pickupDate) { showToast("Please set a pickup date.", "warning"); return; }
    updateData.pickupDate = new Date(pickupDate);
    updateData.pickupTime = pickupTime || "";
  } else {
    updateData.pickupDate = deleteField();
    updateData.pickupTime = deleteField();
  }

  const btn = document.getElementById("updateBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }

  try {
    await updateDoc(doc(db, "requests", id), updateData);
    showToast("Request status updated successfully.", "success");
    loadRequest();
  } catch (err) {
    showToast("Failed to update request.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Update Status"; }
  }
};

// ======================
// REJECT
// ======================
window.rejectRequest = async () => {
  if (!confirm("Reject this request? The resident will be notified.")) return;
  const id = getRequestId();
  try {
    await updateDoc(doc(db, "requests", id), {
      status:    "Rejected",
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.email || "staff",
      pickupDate: deleteField(),
      pickupTime: deleteField()
    });
    showToast("Request rejected.", "warning");
    loadRequest();
  } catch (err) {
    showToast("Failed to reject request.", "error");
  }
};

// ======================
// PICKUP TOGGLE
// ======================
window.togglePickupFields = (val) => {
  const box = document.getElementById("pickupScheduleBox");
  if (box) box.style.display = val === "Ready for Pickup" ? "block" : "none";
};

// ======================
// AUTO-SAVE NOTES
// ======================
function setupAutoSave() {
  const notes = document.getElementById("adminNotes");
  if (!notes) return;
  let timer;
  notes.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const id = getRequestId();
      if (!id) return;
      try {
        await updateDoc(doc(db, "requests", id), {
          adminNotes: notes.value,
          updatedAt:  serverTimestamp(),
          updatedBy:  auth.currentUser?.email || "staff"
        });
      } catch { /* silent auto-save failure */ }
    }, 1500);
  });
}

// ======================
// HELPERS
// ======================
function getStatusClass(status) {
  const map = {
    "Pending":         "pending",
    "In Progress":     "in-progress",
    "Ready for Pickup":"ready",
    "Completed":       "completed",
    "Rejected":        "rejected"
  };
  return map[status] || "";
}

// ======================
// LOGOUT
// ======================
window.logout = async () => {
  localStorage.removeItem("uid");
  localStorage.removeItem("role");
  await signOut(auth);
  window.location.replace("admin-login.html");
};

// ======================
// DOCUMENT PRINT / GENERATE
// (Preserved from original — unchanged)
// ======================
// ======================
// DOCUMENT PRINT — Dynamic template system
// Tries Firestore template first; falls back to the original
// hardcoded renderer so old services keep working unchanged.
// ======================

const BRGY_CONSTANTS = {
  barangay:     "Barangay Sta. Rita",
  city:         "Olongapo City",
  captain_name: "HON. ROWENA V. CEREZO",
};

function resolvePlaceholders(bodyHtml, r, reqId) {
  const date    = r.createdAt?.toDate ? r.createdAt.toDate() : new Date();
  const dayNum  = date.getDate();
  const ordSfx  = ["th","st","nd","rd"];
  const v = dayNum % 100;
  const dayOrd  = dayNum + (ordSfx[(v-20)%10] || ordSfx[v] || ordSfx[0]);
  const esc = str => String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  const toTitle = s => s.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());

  const vals = {
    resident_name:        esc((r.fullName || "—").toUpperCase()),
    resident_name_title:  esc(toTitle(r.fullName || "—")),
    age:                  esc(String(r.age || "")),
    civil_status:         esc(r.civilStatus || ""),
    address:              esc(r.address || "—"),
    contact:              esc(r.contact || ""),
    purpose:              esc((r.purpose || "OFFICIAL USE").toUpperCase()),
    purpose_title:        esc(toTitle(r.purpose || "Official Use")),
    business_name:        esc(r.businessName || "[Business Name]"),
    business_address:     esc(r.businessAddress || r.address || "—"),
    business_nature:      esc(r.businessNature || "business activities"),
    date_long:            date.toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" }),
    day_ordinal:          dayOrd,
    month_long:           date.toLocaleDateString("en-PH", { month:"long" }),
    year:                 String(date.getFullYear()),
    control_no:           (reqId || "").slice(-8).toUpperCase() || "—",
    barangay:             BRGY_CONSTANTS.barangay,
    city:                 BRGY_CONSTANTS.city,
    captain_name:         BRGY_CONSTANTS.captain_name,
  };

  let html = bodyHtml.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, inner) => {
    const fm = { age:"age", civil_status:"civilStatus", contact:"contact",
                 business_name:"businessName", business_address:"businessAddress",
                 business_nature:"businessNature" };
    return (r[fm[key]||key] || "") ? inner : "";
  });
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => vals[k] ?? `{{${k}}}`);
}

function buildPrintShell({ docTitle, bodyHtml, dateStr, controlNo, serviceType, requestId }) {
  const BRGY_SEAL = "../images/barangay-seal-generated.png";
  const CITY_SEAL = "../images/olongapo-city-seal.png";
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${docTitle}</title>
<style>
  @page{size:A4 portrait;margin:18mm 20mm 18mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:"Times New Roman",Times,serif;font-size:12pt;color:#000;background:#fff}
  .doc-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:3px double #1a5c1a;margin-bottom:4px}
  .seal-img{width:80px;height:80px;object-fit:contain;flex-shrink:0}
  .header-center{flex:1;text-align:center;padding:0 12px}
  .hdr-republic{font-size:9pt;letter-spacing:.5px;color:#333}
  .hdr-province{font-size:9pt;color:#333}
  .hdr-city{font-size:11pt;font-weight:bold;letter-spacing:.5px}
  .hdr-brgy{font-size:15pt;font-weight:900;letter-spacing:2px;color:#1a5c1a;line-height:1.1}
  .hdr-office{font-size:9.5pt;color:#444;margin-top:2px}
  .hdr-contact{font-size:8.5pt;color:#666}
  .header-divider{border-top:1.5px solid #1a5c1a;margin:3px 0 0}
  .control-row{display:flex;justify-content:space-between;align-items:center;margin:10px 0 4px;font-size:9.5pt;color:#555}
  .doc-title{text-align:center;font-size:15pt;font-weight:bold;letter-spacing:3px;text-decoration:underline;text-underline-offset:4px;margin:14px 0 6px;text-transform:uppercase;color:#000}
  .doc-subtitle{text-align:center;font-size:9pt;color:#555;letter-spacing:1px;margin-bottom:16px}
  .salutation{margin-bottom:14px;font-size:11.5pt}
  .body-text,.purpose-line{text-align:justify;line-height:1.9;margin-bottom:12px;font-size:11.5pt}
  .validity{font-style:italic;font-size:10.5pt;color:#333;margin-top:10px;border-top:1px dashed #aaa;padding-top:8px}
  .or-box{margin-top:16px;border:1px solid #bbb;border-radius:4px;padding:8px 12px;font-size:9.5pt;background:#fafafa}
  .or-box table{width:100%;border-collapse:collapse}
  .or-box td{padding:3px 6px}
  .or-box td:first-child{color:#555;width:110px;font-weight:bold}
  .sig-section{display:flex;justify-content:space-between;margin-top:40px}
  .sig-block{text-align:center;width:44%}
  .sig-space{height:44px}
  .sig-line{border-top:1px solid #000;padding-top:5px;font-weight:bold;font-size:10pt;text-transform:uppercase}
  .sig-title{font-size:9.5pt;color:#444;margin-top:2px}
  .sig-punong{font-size:10pt;font-weight:900;color:#1a5c1a;text-transform:uppercase}
  .doc-footer{margin-top:28px;border-top:1px solid #ccc;padding-top:8px;display:flex;justify-content:space-between;font-size:8.5pt;color:#777}
  .watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:64pt;font-weight:900;color:rgba(26,92,26,.04);pointer-events:none;white-space:nowrap;letter-spacing:6px}
  .no-print{text-align:center;padding:14px;background:#f0f2ff;border-top:1px solid #dde}
  .print-btn{padding:10px 28px;background:#1a5c1a;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;margin-right:8px;font-family:inherit}
  .close-btn{padding:10px 28px;background:#6b7280;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-family:inherit}
  @media print{.no-print{display:none!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="watermark">BARANGAY STA. RITA</div>
<div class="no-print">
  <button class="print-btn" onclick="window.print()">&#128438; Print Document</button>
  <button class="close-btn" onclick="window.close()">Close</button>
</div>
<div>
  <div class="doc-header">
    <img src="${CITY_SEAL}" class="seal-img" alt="City Seal">
    <div class="header-center">
      <div class="hdr-republic">Republic of the Philippines</div>
      <div class="hdr-province">Province of Zambales</div>
      <div class="hdr-city">CITY OF OLONGAPO</div>
      <div class="hdr-brgy">BARANGAY STA. RITA</div>
      <div class="hdr-office">Office of the Punong Barangay</div>
      <div class="hdr-contact">Horseshoe Drive, Sta. Rita, Olongapo City &bull; Tel. (047) 222-2165</div>
    </div>
    <img src="${BRGY_SEAL}" class="seal-img" alt="Barangay Seal">
  </div>
  <div class="header-divider"></div>
  <div class="control-row">
    <span>Date Issued: <strong>${dateStr}</strong></span>
    <span>Control No.: <strong>${controlNo}</strong></span>
  </div>
  <div class="doc-title">${docTitle}</div>
  <div class="doc-subtitle">Barangay Sta. Rita, Olongapo City</div>
  ${bodyHtml}
  <p class="validity"><strong>Note:</strong> This document is valid for <strong>thirty (30) days</strong> from the date of issuance unless sooner revoked by competent authority.</p>
  <div class="or-box">
    <table>
      <tr><td>Service Type:</td><td><strong>${serviceType}</strong></td><td style="width:120px;font-weight:bold;">Request ID:</td><td style="font-size:8.5pt;">${requestId}</td></tr>
      <tr><td>O.R. No.:</td><td>_____________________</td><td style="font-weight:bold;">Amount Paid:</td><td>&#8369; _______________</td></tr>
      <tr><td>Received by:</td><td>_____________________</td><td style="font-weight:bold;">Date Received:</td><td>_______________</td></tr>
    </table>
  </div>
  <div class="sig-section">
    <div class="sig-block"><div class="sig-space"></div><div class="sig-line">________________________________</div><div class="sig-title">Signature of Requesting Party</div><div class="sig-title" style="margin-top:3px;">Date: _________________</div></div>
    <div class="sig-block"><div class="sig-space"></div><div class="sig-line"><div class="sig-punong">HON. ROWENA V. CEREZO</div></div><div class="sig-title">Punong Barangay</div><div class="sig-title">Barangay Sta. Rita, Olongapo City</div></div>
  </div>
  <div class="doc-footer">
    <span>Processed by: _________________________________ &nbsp;&nbsp; Date: _______________</span>
    <span>Documentary Stamp: [&nbsp;&nbsp;&nbsp;&nbsp;]</span>
  </div>
</div>
</body></html>`;
}

window.generateDocument = async () => {
  const id = getRequestId();
  if (!id) { showToast("No request ID.", "error"); return; }
  try {
    const reqSnap = await getDoc(doc(db, "requests", id));
    if (!reqSnap.exists()) { showToast("Request not found.", "error"); return; }
    const r = reqSnap.data();

    const date       = r.createdAt?.toDate ? r.createdAt.toDate() : new Date();
    const dateStr    = date.toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" });
    const controlNo  = id.slice(-8).toUpperCase();
    const serviceType = r.serviceType || "—";

    let bodyHtml = null;
    let docTitle = "BARANGAY CERTIFICATION";

    // ── 1. Try Firestore dynamic template ─────────────────────────
    if (r.serviceId) {
      try {
        const { getDoc: gd, doc: dc, collection: col, query: q, where: w, getDocs: gds } =
          await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const svcSnap = await getDoc(doc(db, "services", r.serviceId));
        if (svcSnap.exists() && svcSnap.data().templateId) {
          const tplSnap = await getDoc(doc(db, "documentTemplates", svcSnap.data().templateId));
          if (tplSnap.exists()) {
            const tpl = tplSnap.data();
            docTitle = tpl.docTitle || docTitle;
            bodyHtml = resolvePlaceholders(tpl.bodyHtml, r, id);
          }
        }
      } catch (_) { /* fall through to legacy */ }
    }

    // ── 2. Legacy fallback (original hardcoded logic) ──────────────
    if (!bodyHtml) {
      const dayNum    = date.getDate();
      const ordSfx    = ["th","st","nd","rd"];
      const v = dayNum % 100;
      const dayOrd    = dayNum + (ordSfx[(v-20)%10] || ordSfx[v] || ordSfx[0]);
      const monthLong = date.toLocaleDateString("en-PH", { month:"long" });
      const yearNum   = date.getFullYear();
      const name      = (r.fullName || "—").toUpperCase();
      const address   = r.address   || "—";
      const purpose   = (r.purpose  || "OFFICIAL USE").toUpperCase();
      const contact   = r.contact   || "";
      const age       = r.age       || "";
      const civil     = r.civilStatus || "";
      const biz       = r.businessName || "";
      const bizAddr   = r.businessAddress || address;
      const bizNature = r.businessNature || serviceType || "business activities";
      const nameExtra = `${age?", "+age+" years of age":""}${civil?", "+civil:""}${contact?", with contact number <strong>"+contact+"</strong>":""}`;
      const svcL = serviceType.toLowerCase();
      const titleMap = {
        "clearance":"BARANGAY CLEARANCE","residency":"CERTIFICATE OF RESIDENCY",
        "indigency":"CERTIFICATE OF INDIGENCY","business":"BARANGAY BUSINESS CLEARANCE",
        "permit":"BARANGAY BUSINESS CLEARANCE","blotter":"BARANGAY BLOTTER REPORT",
        "moral":"CERTIFICATE OF GOOD MORAL CHARACTER","character":"CERTIFICATE OF GOOD MORAL CHARACTER",
      };
      docTitle = Object.entries(titleMap).find(([k]) => svcL.includes(k))?.[1] || "BARANGAY CERTIFICATION";
      if (svcL.includes("clearance") && !svcL.includes("business")) {
        bodyHtml = `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
          <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>${name}</strong>${nameExtra}, is a <em>bonafide</em> resident of <strong>Barangay Sta. Rita, Olongapo City</strong>, with residential address at <strong>${address}</strong>.</p>
          <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;To the best of our knowledge, the above-named individual is of <strong>good moral character</strong>, law-abiding, and has no derogatory record on file in this barangay.</p>
          <p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This clearance is issued upon the request of the above-named person for the purpose of <strong>${purpose}</strong>.</p>
          <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>${dayOrd} day of ${monthLong} ${yearNum}</strong> at the Office of the Punong Barangay, Barangay Sta. Rita, Olongapo City.</p>`;
      } else if (svcL.includes("residency")) {
        bodyHtml = `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
          <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>${name}</strong>${nameExtra}, is a <em>bonafide</em> resident of <strong>Barangay Sta. Rita, Olongapo City</strong>, and is presently residing at <strong>${address}</strong>.</p>
          <p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This certification is issued upon the request of the above-named person for the purpose of <strong>${purpose}</strong>.</p>
          <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>${dayOrd} day of ${monthLong} ${yearNum}</strong> at the Office of the Punong Barangay, Barangay Sta. Rita, Olongapo City.</p>`;
      } else if (svcL.includes("indigency")) {
        bodyHtml = `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
          <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>${name}</strong>${nameExtra}, is a <em>bonafide</em> resident of <strong>Barangay Sta. Rita, Olongapo City</strong>, residing at <strong>${address}</strong>, and <strong>belongs to an indigent family</strong> of this barangay.</p>
          <p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This certification is issued for the purpose of <strong>${purpose}</strong>.</p>
          <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>${dayOrd} day of ${monthLong} ${yearNum}</strong> at the Office of the Punong Barangay, Barangay Sta. Rita, Olongapo City.</p>`;
      } else if (svcL.includes("business") || svcL.includes("permit")) {
        bodyHtml = `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
          <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>${name}</strong>, the owner of <strong>${biz||"[Business Name]"}</strong>, engaged in <strong>${bizNature}</strong>, located at <strong>${bizAddr}</strong>, is a <em>bonafide</em> resident of <strong>Barangay Sta. Rita, Olongapo City</strong>, and has been granted clearance to operate.</p>
          <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>${dayOrd} day of ${monthLong} ${yearNum}</strong> at the Office of the Punong Barangay, Barangay Sta. Rita, Olongapo City.</p>`;
      } else {
        bodyHtml = `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
          <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>${name}</strong>${nameExtra}, is a <em>bonafide</em> resident of <strong>Barangay Sta. Rita, Olongapo City</strong>, with address at <strong>${address}</strong>.</p>
          <p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This certification is issued for the purpose of <strong>${purpose}</strong>.</p>
          <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>${dayOrd} day of ${monthLong} ${yearNum}</strong> at the Office of the Punong Barangay, Barangay Sta. Rita, Olongapo City.</p>`;
      }
    }

    // ── 3. Open print window with full official shell ──────────────
    const win = window.open("", "_blank", "width=820,height=1060");
    win.document.write(buildPrintShell({ docTitle, bodyHtml, dateStr, controlNo, serviceType, requestId: id }));
    win.document.close();

  } catch (err) {
    showToast("Failed to generate document.", "error");
    console.error(err);
  }
};;
