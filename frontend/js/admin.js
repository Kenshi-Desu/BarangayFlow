import { auth, db } from "./firebase.js";
import {
  collection, onSnapshot, query, orderBy, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  isKioskRequest,
  subscribeKioskCollection,
  mergeAndSortKioskRequests,
  renderKioskTableView,
  bindDoneRequestHandler
} from "./kiosk-view.js";

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
// GLOBAL STATE
// ======================
let allRequests = [];
let kioskCollectionRequests = [];
let legacyKioskRequests = [];
let currentPage = 1;
const rowsPerPage = 5;
let kioskCurrentPage = 1;
let completedKioskPage = 1;
const kioskRowsPerPage = 10;
let kioskUnsub = null;

// ======================
// TOAST
// ======================
function showToast(msg, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const icons = { success:"ok", error:"err", warning:"!", info:"i" };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || "i"} ${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(30px)";
    setTimeout(() => toast.remove(), 350);
  }, 4500);
}

// ======================
// TAB NAVIGATION
// ======================
window.showTab = (tabName) => {
  const dashTab  = document.getElementById("tab-dashboard");
  const kioskTab = document.getElementById("tab-kiosk");
  const annTab   = document.getElementById("tab-announcements");
  const navDash  = document.getElementById("nav-dash");
  const navKiosk = document.getElementById("nav-kiosk");
  const navAnn   = document.getElementById("nav-ann");

  if (dashTab)  dashTab.style.display  = tabName === "dashboard" ? "block" : "none";
  if (kioskTab) kioskTab.style.display = tabName === "kiosk" ? "block" : "none";
  if (annTab)   annTab.style.display   = tabName === "announcements" ? "block" : "none";

  navDash?.classList.toggle("active", tabName === "dashboard");
  navKiosk?.classList.toggle("active", tabName === "kiosk");
  navAnn?.classList.toggle("active", tabName === "announcements");

  document.querySelector(".nav-right")?.classList.remove("open");
  document.querySelector(".nav-toggle")?.setAttribute("aria-expanded", "false");

  if (tabName === "kiosk") {
    renderKioskTable();
  } else if (tabName === "announcements") {
    listenToAnnouncements();
  }
};

// ======================
// AUTH & INIT
// ======================
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.replace("admin-login.html"); return; }

  // Guard: use the localStorage markers written by admin-auth.js at login time.
  // We intentionally do NOT call signOut() here — that would kill the resident
  // panel session running in a different tab on the same browser.
  const storedRole = localStorage.getItem("role");
  const storedUid  = localStorage.getItem("uid");

  if (!storedRole || !storedUid || storedUid !== user.uid || storedRole !== "staff") {
    // No valid staff marker for this user — redirect without signing out.
    window.location.replace("admin-login.html");
    return;
  }

  // Firestore verification (role + active check) only on hard reload / cold start.
  try {
    const adminSnap = await getDoc(doc(db, "admins", user.uid));
    if (!adminSnap.exists() || adminSnap.data().role !== "staff") {
      localStorage.removeItem("role");
      localStorage.removeItem("uid");
      localStorage.removeItem("adminUsername");
      window.location.replace("admin-login.html");
      return;
    }
    const data = adminSnap.data();
    if (data.active === false) {
      localStorage.removeItem("role");
      localStorage.removeItem("uid");
      localStorage.removeItem("adminUsername");
      window.location.replace("admin-login.html");
      return;
    }
    const nameEl = document.getElementById("adminName");
    if (nameEl) nameEl.innerText = data.username || user.email;
    const navEl = document.getElementById("adminNav");
    if (navEl) navEl.innerText = data.username || user.email;
  } catch (err) {
    // Network error — don't kick them out, just proceed with stored credentials.
    const username = localStorage.getItem("adminUsername") || user.email;
    const nameEl = document.getElementById("adminName");
    if (nameEl) nameEl.innerText = username;
  }

  loadServiceFilterOptions();
  loadRequests();
  loadKioskRequests();
  preloadAnnBadge();
});

// ======================
// DYNAMIC SERVICE FILTER
// ======================
async function loadServiceFilterOptions() {
  const serviceFilter = document.getElementById("serviceFilter");
  if (!serviceFilter) return;
  try {
    const snap = await getDocs(collection(db, "services"));
    serviceFilter.innerHTML = '<option value="all">Filter: Service Type</option>';
    snap.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d.data().name;
      opt.textContent = d.data().name;
      serviceFilter.appendChild(opt);
    });
  } catch (err) { /* silent */ }
}

// ======================
// REAL-TIME REQUESTS
// ======================
function loadRequests() {
  const q = query(collection(db, "requests"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    legacyKioskRequests = docs.filter(isKioskRequest);
    allRequests = docs.filter(r => !isKioskRequest(r));
    currentPage = 1;
    renderTable();
    updateStats();
    renderKioskTable();
    renderCompletedKioskSection();
  }, () => {
    showToast("Failed to load requests. Check your connection.", "error");
  });
}

// ======================
// KIOSK REQUESTS (STAFF/ADMIN, NON-CLICKABLE ROWS + DONE REQUEST)
// ======================
function loadKioskRequests() {
  if (kioskUnsub) return;
  const noticeBox = document.getElementById("kioskNoticeBox");
  const kioskTableEl = document.getElementById("kioskTable");

  bindDoneRequestHandler({
    tableEl: kioskTableEl,
    getUserEmail: () => auth.currentUser?.email || localStorage.getItem("adminUsername") || "staff",
    onSuccess: (queueLabel) => {
      showToast(`${queueLabel} marked as Completed and moved to Completed Requests (Category: Kiosk).`, "success");
    },
    onError: (err) => {
      console.error("[Staff Kiosk] Failed to complete request:", err);
      showToast(
        err?.code === "permission-denied"
          ? "Permission denied. Please deploy the updated firestore.rules."
          : "Failed to complete kiosk request. Please try again.",
        "error"
      );
    }
  });

  kioskUnsub = subscribeKioskCollection({
    onData: (docs) => {
      if (noticeBox) {
        noticeBox.style.display = "none";
        noticeBox.textContent = "";
      }
      kioskCollectionRequests = docs;
      kioskCurrentPage = 1;
      completedKioskPage = 1;
      renderKioskTable();
      renderCompletedKioskSection();
    },
    onError: (err) => {
      console.warn("[Staff Kiosk] Failed to listen to kioskRequests:", err?.code || err);
      if (noticeBox) {
        noticeBox.style.display = "block";
        noticeBox.textContent = err?.code === "permission-denied"
          ? "Firestore rules for 'kioskRequests' are not deployed yet. Run 'firebase deploy --only firestore:rules' so new walk-in kiosk requests appear here."
          : "Unable to load live kiosk queue right now. Please check your connection.";
      }
      renderKioskTable();
      renderCompletedKioskSection();
    }
  });
}

function renderKioskTable() {
  const search = document.getElementById("kioskSearchInput")?.value || "";
  const combined = mergeAndSortKioskRequests(kioskCollectionRequests, legacyKioskRequests);
  const { totalPages, clampedPage } = renderKioskTableView({
    tableEl: document.getElementById("kioskTable"),
    countPillEl: document.getElementById("kioskCountPill"),
    items: combined,
    search,
    page: kioskCurrentPage,
    pageSize: kioskRowsPerPage,
    mode: "active",
    countUnit: "Kiosk Request"
  });
  kioskCurrentPage = clampedPage;
  renderPaginationBar(document.getElementById("kioskPagination"), kioskCurrentPage, totalPages, "changeKioskPage");
}

function renderCompletedKioskSection() {
  const section = document.getElementById("staffCompletedKioskSection");
  const onlineWrap = document.getElementById("staffOnlineRequestsWrap");
  if (!section) return;

  const categoryFilter = document.getElementById("categoryFilter")?.value || "all";
  const statusFilter = document.getElementById("statusFilter")?.value || "all";
  const search = document.getElementById("searchInput")?.value || "";

  if (onlineWrap) {
    onlineWrap.style.display = categoryFilter === "kiosk" ? "none" : "block";
  }

  const statusAllowsCompleted = statusFilter === "all" || statusFilter.toLowerCase() === "completed";
  const categoryAllowsKiosk = categoryFilter === "all" || categoryFilter === "kiosk";
  const showCompletedKiosk = statusAllowsCompleted && categoryAllowsKiosk;

  section.style.display = showCompletedKiosk ? "block" : "none";
  if (!showCompletedKiosk) return;

  const combined = mergeAndSortKioskRequests(kioskCollectionRequests, legacyKioskRequests);
  const { totalPages, clampedPage } = renderKioskTableView({
    tableEl: document.getElementById("completedKioskTable"),
    countPillEl: document.getElementById("completedKioskCountPill"),
    items: combined,
    search,
    page: completedKioskPage,
    pageSize: kioskRowsPerPage,
    mode: "completed",
    countUnit: "Completed"
  });
  completedKioskPage = clampedPage;
  renderPaginationBar(
    document.getElementById("completedKioskPagination"),
    completedKioskPage,
    totalPages,
    "changeCompletedKioskPage"
  );
}

// ======================
// RENDER TABLE (PAGINATED)
// ======================
function renderTable() {
  const table = document.getElementById("adminTable");
  if (!table) return;

  const search       = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const statusFilter = document.getElementById("statusFilter")?.value || "all";
  const serviceFilter= document.getElementById("serviceFilter")?.value || "all";

  const filtered = allRequests.filter(r => {
    const matchSearch  = (r.fullName||"").toLowerCase().includes(search) || (r.serviceType||"").toLowerCase().includes(search) || (r.id||"").toLowerCase().includes(search);
    const matchStatus  = statusFilter  === "all" || (r.status||"").toLowerCase() === statusFilter.toLowerCase();
    const matchService = serviceFilter === "all" || (r.serviceType||"").toLowerCase() === serviceFilter.toLowerCase();
    return matchSearch && matchStatus && matchService;
  });

  const totalPages = Math.ceil(filtered.length / rowsPerPage) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  const start     = (currentPage - 1) * rowsPerPage;
  const paginated = filtered.slice(start, start + rowsPerPage);

  if (!paginated.length) {
    table.innerHTML = `<div class="empty-row">No requests match the current filters.</div>`;
    renderPagination(1);
    return;
  }

  table.innerHTML = paginated.map(r => {
    const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString("en-PH") : "—";
    return `<div class="row">
      <span class="mono">${r.id.slice(0,8)}</span>
      <span>${r.fullName || "N/A"}</span>
      <span>${r.serviceType || "—"}</span>
      <span>${date}</span>
      <span class="priority normal">Normal</span>
      <span class="status ${getStatusClass(r.status)}"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\" viewBox=\"0 0 8 8\" style=\"vertical-align:middle;margin-right:4px;\"><circle cx=\"4\" cy=\"4\" r=\"4\" fill=\"currentColor\"/></svg>${r.status || "—"}</span>
      <span>—</span>
      <span><button class="action-btn" onclick="reviewRequest('${r.id}')">Review</button></span>
    </div>`;
  }).join("");

  renderPagination(totalPages);
}

// ======================
// PAGINATION
// ======================
function renderPaginationBar(container, activePage, totalPages, handlerName) {
  if (!container) return;

  const chevLeft  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  const chevRight = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

  let pageNums = [];
  if (totalPages <= 3) {
    pageNums = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else if (activePage === 1) {
    pageNums = [1, 2, "…"];
  } else if (activePage === totalPages) {
    pageNums = ["…", totalPages - 1, totalPages];
  } else {
    pageNums = ["…", activePage, "…"];
  }

  let html = `<button class="pg-btn pg-nav" ${activePage === 1 ? "disabled" : ""} onclick="${handlerName}(${activePage - 1})" aria-label="Previous">${chevLeft}</button>`;
  pageNums.forEach(p => {
    if (p === "…") {
      html += `<span class="pg-ellipsis">…</span>`;
    } else {
      html += `<button class="pg-btn${p === activePage ? " active-page" : ""}" onclick="${handlerName}(${p})" aria-label="Page ${p}">${p}</button>`;
    }
  });
  html += `<button class="pg-btn pg-nav" ${activePage === totalPages ? "disabled" : ""} onclick="${handlerName}(${activePage + 1})" aria-label="Next">${chevRight}</button>`;
  container.innerHTML = html;
}

function renderPagination(totalPages) {
  renderPaginationBar(document.getElementById("pagination"), currentPage, totalPages, "changePage");
}

window.changePage = (page) => { currentPage = page; renderTable(); };
window.changeKioskPage = (page) => { kioskCurrentPage = page; renderKioskTable(); };
window.changeCompletedKioskPage = (page) => { completedKioskPage = page; renderCompletedKioskSection(); };

// ======================
// STATS
// ======================
function updateStats() {
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  setText("total",     allRequests.length);
  setText("pending",   allRequests.filter(r => r.status === "Pending").length);
  setText("progress",  allRequests.filter(r => r.status === "In Progress").length);
  setText("pickup",    allRequests.filter(r => r.status === "Ready for Pickup").length);
  setText("completed", allRequests.filter(r => r.status === "Completed").length);
  const rejEl = document.getElementById("rejected");
  if (rejEl) rejEl.innerText = allRequests.filter(r => r.status === "Rejected").length;
}

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
    else { badge.style.display = "none"; }
  });
}

// ── Announcement read-state helpers ──
function getReadAnnouncements() {
  try { return JSON.parse(localStorage.getItem("readAnnouncementsStaff") || "[]"); } catch { return []; }
}
function markAnnouncementRead(id) {
  const read = getReadAnnouncements();
  if (!read.includes(id)) { read.push(id); localStorage.setItem("readAnnouncementsStaff", JSON.stringify(read)); }
}
window.openAnnModal = function(id, title, content, date) {
  markAnnouncementRead(id);
  document.getElementById("annDetailTitle").textContent  = title;
  document.getElementById("annDetailContent").textContent = content;
  document.getElementById("annDetailDate").textContent   = date;
  document.getElementById("annDetailModal")?.classList.add("open");
  document.body.style.overflow = "hidden";
  const card = document.querySelector(`[data-ann-id="${id}"]`);
  if (card) { card.style.opacity="0.7"; card.style.borderLeftColor="#d1d5db"; card.querySelector(".ann-unread-dot")?.remove(); }
  updateAnnBadge();
};
window.closeAnnModal = function() {
  document.getElementById("annDetailModal")?.classList.remove("open");
  document.body.style.overflow = "";
};
function updateAnnBadge() {
  const badge = document.getElementById("annBadge");
  if (!badge) return;
  const read = getReadAnnouncements();
  const allCards = document.querySelectorAll("[data-ann-id]");
  let unread = 0;
  allCards.forEach(c => { if (!read.includes(c.dataset.annId)) unread++; });
  if (unread > 0) { badge.textContent = unread > 9 ? "9+" : unread; badge.style.display = "inline-block"; }
  else { badge.style.display = "none"; }
}

function listenToAnnouncements() {
  const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    const list = document.getElementById("staffAnnList");
    if (!list) return;
    if (snapshot.empty) {
      list.innerHTML = "<p>No announcements found.</p>";
      document.getElementById("annBadge") && (document.getElementById("annBadge").style.display = "none");
      return;
    }
    const read = getReadAnnouncements();
    list.innerHTML = "";
    snapshot.docs.forEach(docSnap => {
      const a = docSnap.data();
      const annId  = docSnap.id;
      const isRead = read.includes(annId);
      const date = a.createdAt?.toDate ? a.createdAt.toDate().toLocaleDateString("en-PH", {year:"numeric",month:"long",day:"numeric"}) : "";
      const card = document.createElement("div");
      card.dataset.annId = annId;
      card.className = "ann-staff-card";
      card.style.cssText = `opacity:${isRead?"0.7":"1"};border-left-color:${isRead?"#d1d5db":"#1a2cff"};cursor:pointer;transition:box-shadow .15s,transform .12s;`;
      card.onmouseenter = () => { card.style.boxShadow="0 4px 18px rgba(0,0,0,0.13)"; card.style.transform="translateY(-1px)"; };
      card.onmouseleave = () => { card.style.boxShadow=""; card.style.transform=""; };
      card.onclick = () => window.openAnnModal(annId, a.title, a.content, date);
      card.innerHTML = `
        <div class="ann-staff-top">
          <div style="display:flex;align-items:center;gap:8px;">
            ${!isRead ? `<span class="ann-unread-dot" style="width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0;"></span>` : ""}
            <b style="color:${isRead?"#6b7280":"#111827"};">${a.title}</b>
          </div>
          <small>${date}</small>
        </div>
        <p style="color:${isRead?"#9ca3af":"#4b5563"};display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${a.content}</p>
        <p style="font-size:12px;color:#1a2cff;margin-top:8px;font-weight:600;">${isRead ? "✓ Read" : "Click to read more →"}</p>`;
      list.appendChild(card);
    });
    updateAnnBadge();
  });
}

// ======================
// FILTER EVENTS
// ======================
["searchInput","statusFilter","categoryFilter","serviceFilter"].forEach(id => {
  document.getElementById(id)?.addEventListener(id==="searchInput"?"input":"change", () => {
    currentPage = 1;
    completedKioskPage = 1;
    renderTable();
    renderCompletedKioskSection();
  });
});

["input", "search"].forEach(evtName => {
  document.getElementById("kioskSearchInput")?.addEventListener(evtName, () => {
    kioskCurrentPage = 1;
    renderKioskTable();
  });
});

// ======================
// HELPERS
// ======================
window.reviewRequest = (id) => { window.location.href = `review.html?id=${id}`; };

function getStatusClass(status) {
  if (!status) return "";
  const s = status.toLowerCase();
  if (s.includes("pending"))  return "pending";
  if (s.includes("progress")) return "progress";
  if (s.includes("pickup")||s.includes("ready")) return "ready";
  if (s.includes("completed")||s.includes("done")) return "done";
  if (s.includes("rejected")) return "rejected";
  return "";
}

window.logout = () => {
  const modal = document.getElementById("staffLogoutModal");
  if (modal) {
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }
};

window.cancelStaffLogout = () => {
  const modal = document.getElementById("staffLogoutModal");
  if (modal) {
    modal.classList.remove("open");
    document.body.style.overflow = "";
  }
};

window.confirmStaffLogout = async () => {
  const btn = document.getElementById("confirmStaffLogoutBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Logging out…"; }
  localStorage.removeItem("adminUsername");
  localStorage.removeItem("role");
  localStorage.removeItem("uid");
  if (!localStorage.getItem("bf_resident_uid")) {
    await signOut(auth);
  }
  window.location.replace("admin-login.html");
};
