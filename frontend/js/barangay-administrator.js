import { auth, db } from "./firebase.js";
import {
  collection, onSnapshot, addDoc, doc,
  deleteDoc, getDoc, updateDoc, deleteField, query,
  orderBy, serverTimestamp, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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


// =====================================================================
// GLOBAL STATE
// =====================================================================
let unsubscribers = [];
let editingServiceId = null;
let editingAnnouncementId = null;

// Pagination for requests table
const REQ_PAGE_SIZE = 8;
let reqCurrentPage = 1;
let reqFilteredData = [];

// Pagination for users section
const USERS_PAGE_SIZE = 8;
let usersResidentPage = 1;
let usersStaffPage = 1;
let usersAdminPage = 1;
let usersItPage = 1;
let usersAllResidents = [];
let usersAllStaff = [];
let usersAllAdmins = [];
let usersAllIt = [];

function clearListeners() {
  unsubscribers.forEach(u => u());
  unsubscribers = [];
}

// =====================================================================
// TOAST NOTIFICATION SYSTEM
// =====================================================================
function showToast(msg, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const icons = { success: "ok", error: "err", warning: "!", info: "i" };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || "i"} ${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(30px)";
    setTimeout(() => toast.remove(), 350);
  }, 4000);
}

// =====================================================================
// AUTH GUARD
// =====================================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.replace("admin-login.html"); return; }
  const storedRole = localStorage.getItem("role");
  const storedUid  = localStorage.getItem("uid");
  if (!storedRole || !storedUid || storedUid !== user.uid || storedRole !== "admin") {
    window.location.replace("admin-login.html");
    return;
  }

  try {
    const adminSnap = await getDoc(doc(db, "admins", user.uid));
    if (!adminSnap.exists() || adminSnap.data().role !== "admin") {
      window.location.replace("admin-login.html");
      return;
    }
    const data = adminSnap.data();
    const nameEl = document.getElementById("adminName");
    if (nameEl) nameEl.innerText = data.username || user.email;
    showSection("dashboard");
    preloadAnnBadge();
  } catch (err) {
    window.location.replace("admin-login.html");
  }
});

// =====================================================================
// NAVIGATION
// =====================================================================
window.showSection = (name) => {
  clearListeners();
  document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
  const section = document.getElementById("section-" + name);
  if (section) section.classList.add("active");
  document.querySelectorAll(".nav-right a").forEach(a => a.classList.remove("active"));
  const navLink = document.getElementById("nav-" + name);
  if (navLink) navLink.classList.add("active");
  const loaders = {
    dashboard: loadDashboard,
    services: loadServices,
    users: loadUsers,
    announcements: loadAnnouncements,
    requests: loadAllRequests,
  };
  if (loaders[name]) loaders[name]();
};

// =====================================================================
// DASHBOARD
// =====================================================================
let statusChart = null, pieChart = null, lineChart = null;

function loadDashboard() {
  const unsub = onSnapshot(collection(db, "requests"), (snap) => {
    let total = 0, pending = 0, inProgress = 0, ready = 0, completed = 0, rejected = 0;
    let statusCounts = {}, serviceCounts = {}, monthlyCounts = {};
    snap.forEach(d => {
      const r = d.data();
      total++;
      const status = (r.status || "").trim();
      if (status === "Pending") pending++;
      else if (status === "In Progress") inProgress++;
      else if (status === "Ready for Pickup") ready++;
      else if (status === "Completed") completed++;
      else if (status === "Rejected") rejected++;
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      const svc = r.serviceType || "Other";
      serviceCounts[svc] = (serviceCounts[svc] || 0) + 1;
      if (r.createdAt?.toDate) {
        const dt = r.createdAt.toDate();
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
        monthlyCounts[key] = (monthlyCounts[key] || 0) + 1;
      }
    });
    setText("total", total); setText("pending", pending);
    setText("inprogress", inProgress); setText("ready", ready);
    setText("completed", completed); setText("rejected", rejected);
    setText("rate", total ? Math.round((completed / total) * 100) + "%" : "0%");
    renderStatusChart(statusCounts);
    renderPieChart(serviceCounts);
    renderLineChart(monthlyCounts);
  });
  unsubscribers.push(unsub);
}

function renderStatusChart(counts) {
  const ctx = document.getElementById("statusChart");
  if (!ctx) return;
  if (statusChart) statusChart.destroy();
  const colors = { "Pending":"#f59e0b","In Progress":"#3b82f6","Ready for Pickup":"#10b981","Completed":"#6b7280","Rejected":"#ef4444" };
  statusChart = new Chart(ctx, {
    type: "bar",
    data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts), backgroundColor: Object.keys(counts).map(k => colors[k] || "#1a2cff"), borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
  });
}

function renderPieChart(counts) {
  const ctx = document.getElementById("serviceChart");
  if (!ctx) return;
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(ctx, {
    type: "doughnut",
    data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts), backgroundColor: ["#1a2cff","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#06b6d4","#84cc16"] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { font: { size: 11 } } } } }
  });
}

function renderLineChart(counts) {
  const ctx = document.getElementById("monthlyChart");
  if (!ctx) return;
  const sortedKeys = Object.keys(counts).sort();
  if (lineChart) lineChart.destroy();
  lineChart = new Chart(ctx, {
    type: "line",
    data: { labels: sortedKeys, datasets: [{ label: "Requests", data: sortedKeys.map(k => counts[k]), fill: true, backgroundColor: "rgba(26,44,255,0.07)", borderColor: "#1a2cff", tension: 0.4, pointBackgroundColor: "#1a2cff", pointRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
  });
}

// =====================================================================
// ALL REQUESTS — admin overview + inline update
// =====================================================================
let allRequestsData = [];

function loadAllRequests() {
  const el = document.getElementById("requestsTableBody");
  if (!el) return;
  el.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading...</div>`;
  const q = query(collection(db, "requests"), orderBy("createdAt", "desc"));
  const unsub = onSnapshot(q, (snap) => {
    allRequestsData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRequestsTable(allRequestsData);
  });
  unsubscribers.push(unsub);
}

function renderRequestsTable(data) {
  reqFilteredData = data;
  reqCurrentPage = 1;
  renderRequestsPage();
}

function renderRequestsPage() {
  const el = document.getElementById("requestsTableBody");
  if (!el) return;
  if (!reqFilteredData.length) {
    el.innerHTML = `<div class="empty-state">No requests found.</div>`;
    renderReqPagination(0);
    return;
  }
  const totalPages = Math.ceil(reqFilteredData.length / REQ_PAGE_SIZE) || 1;
  if (reqCurrentPage > totalPages) reqCurrentPage = totalPages;
  const start = (reqCurrentPage - 1) * REQ_PAGE_SIZE;
  const paginated = reqFilteredData.slice(start, start + REQ_PAGE_SIZE);
  el.innerHTML = paginated.map(r => {
    const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString("en-PH") : "—";
    return `<div class="row">
      <span class="mono">${r.id.slice(0,8)}</span>
      <span>${r.fullName || "N/A"}</span>
      <span>${r.serviceType || "—"}</span>
      <span>${date}</span>
      <span class="status ${getStatusClass(r.status)}"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\" viewBox=\"0 0 8 8\" style=\"vertical-align:middle;margin-right:4px;\"><circle cx=\"4\" cy=\"4\" r=\"4\" fill=\"currentColor\"/></svg>${r.status || "—"}</span>
      <span><button class="action-btn" onclick="openRequestModal('${r.id}')">View / Update</button></span>
    </div>`;
  }).join("");
  renderReqPagination(totalPages);
}

function renderReqPagination(totalPages) {
  let pg = document.getElementById("reqPagination");
  if (!pg) {
    pg = document.createElement("div");
    pg.id = "reqPagination";
    pg.className = "pagination-bar";
    const tableEl = document.getElementById("requestsTableBody");
    if (tableEl?.parentNode) tableEl.parentNode.insertAdjacentElement("afterend", pg);
  }
  if (totalPages <= 1) { pg.innerHTML = ""; return; }
  const maxVisible = 5;
  let start = Math.max(1, reqCurrentPage - Math.floor(maxVisible / 2));
  let end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
  let html = `<button class="pg-btn pg-nav" ${reqCurrentPage===1?"disabled":""} onclick="window._reqChangePage(${reqCurrentPage-1})" aria-label="Previous">‹</button>`;
  if (start > 1) html += `<button class="pg-btn" onclick="window._reqChangePage(1)">1</button>${start > 2 ? `<span class="pg-ellipsis">…</span>` : ""}`;
  for (let i = start; i <= end; i++) {
    html += `<button class="pg-btn${i===reqCurrentPage?" pg-active":""}" onclick="window._reqChangePage(${i})">${i}</button>`;
  }
  if (end < totalPages) html += `${end < totalPages - 1 ? `<span class="pg-ellipsis">…</span>` : ""}<button class="pg-btn" onclick="window._reqChangePage(${totalPages})">${totalPages}</button>`;
  html += `<button class="pg-btn pg-nav" ${reqCurrentPage===totalPages?"disabled":""} onclick="window._reqChangePage(${reqCurrentPage+1})" aria-label="Next">›</button>`;
  html += `<span class="pg-info">${reqCurrentPage} / ${totalPages}</span>`;
  pg.innerHTML = html;
}

window._reqChangePage = (page) => { reqCurrentPage = page; renderRequestsPage(); };

window.filterRequests = () => {
  const search = (document.getElementById("reqSearch")?.value || "").toLowerCase();
  const statusF = document.getElementById("reqStatusFilter")?.value || "all";
  const filtered = allRequestsData.filter(r => {
    const matchSearch = (r.fullName || "").toLowerCase().includes(search) || (r.serviceType || "").toLowerCase().includes(search) || r.id.toLowerCase().includes(search);
    const matchStatus = statusF === "all" || r.status === statusF;
    return matchSearch && matchStatus;
  });
  reqFilteredData = filtered;
  reqCurrentPage = 1;
  renderRequestsPage();
};

window.openRequestModal = async (id) => {
  const modal = document.getElementById("requestModal");
  if (!modal) return;
  modal.classList.add("open");
  document.getElementById("modalBody").innerHTML = `<div class="spinner-center"><div class="spinner"></div></div>`;
  try {
    const snap = await getDoc(doc(db, "requests", id));
    if (!snap.exists()) { showToast("Request not found.", "error"); return; }
    const r = snap.data();
    const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : "—";
    document.getElementById("modalBody").innerHTML = `
      <div class="detail-grid">
        <div class="detail-row"><b>Request ID</b><span class="mono">${id}</span></div>
        <div class="detail-row"><b>Resident</b><span>${r.fullName || "—"}</span></div>
        <div class="detail-row"><b>Service</b><span>${r.serviceType || "—"}</span></div>
        <div class="detail-row"><b>Contact</b><span>${r.contact || "—"}</span></div>
        <div class="detail-row"><b>Address</b><span>${r.address || "—"}</span></div>
        <div class="detail-row"><b>Purpose</b><span>${r.purpose || "—"}</span></div>
        <div class="detail-row"><b>Submitted</b><span>${date}</span></div>
        <div class="detail-row"><b>Current Status</b><span class="status ${getStatusClass(r.status)}"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\" viewBox=\"0 0 8 8\" style=\"vertical-align:middle;margin-right:4px;\"><circle cx=\"4\" cy=\"4\" r=\"4\" fill=\"currentColor\"/></svg>${r.status}</span></div>
      </div>
      <div class="modal-notes">
        <label>Admin Notes</label>
        <textarea id="modalAdminNotes" rows="3" placeholder="Add internal notes...">${r.adminNotes || ""}</textarea>
      </div>
      <div class="modal-status-row">
        <label>Update Status</label>
        <select id="modalStatus">
          <option value="Pending"          ${r.status==="Pending"?"selected":""}>Pending</option>
          <option value="In Progress"      ${r.status==="In Progress"?"selected":""}>In Progress</option>
          <option value="Ready for Pickup" ${r.status==="Ready for Pickup"?"selected":""}>Ready for Pickup</option>
          <option value="Completed"        ${r.status==="Completed"?"selected":""}>Completed</option>
          <option value="Rejected"         ${r.status==="Rejected"?"selected":""}>Rejected</option>
        </select>
        <div class="modal-action-row">
          <button class="action-btn modal-save-btn" onclick="saveRequestUpdate('${id}')"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"vertical-align:-2px;margin-right:5px;\"><path d=\"M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z\"/><polyline points=\"17 21 17 13 7 13 7 21\"/><polyline points=\"7 3 7 8 15 8\"/></svg> Save Changes</button>
          <button class="action-btn modal-print-btn" onclick="printDocumentTemplate('${id}')"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"vertical-align:-2px;margin-right:5px;\"><polyline points=\"6 9 6 2 18 2 18 9\"/><path d=\"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\"/><rect x=\"6\" y=\"14\" width=\"12\" height=\"8\"/></svg> Print Document</button>
        </div>
      </div>`;
  } catch (err) {
    showToast("Failed to load request.", "error");
    modal.classList.remove("open");
  }
};

window.closeRequestModal = () => { document.getElementById("requestModal")?.classList.remove("open"); };

window.saveRequestUpdate = async (id) => {
  const status = document.getElementById("modalStatus")?.value;
  const adminNotes = document.getElementById("modalAdminNotes")?.value || "";
  try {
    const updateData = {
      status,
      adminNotes,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.email || "admin"
    };
    if (status !== "Ready for Pickup") {
      updateData.pickupDate = deleteField();
      updateData.pickupTime = deleteField();
    }
    await updateDoc(doc(db, "requests", id), updateData);
    showToast("Request updated successfully.", "success");
    closeRequestModal();
  } catch (err) {
    showToast("Failed to update request.", "error");
  }
};

// =====================================================================
// PRINT DOCUMENT TEMPLATE — Dynamic + Legacy fallback
// =====================================================================

// ── Barangay constants ───────────────────────────────────────────────
const BRGY_CONSTANTS = {
  barangay:     "Barangay Sta. Rita",
  city:         "Olongapo City",
  captain_name: "HON. ROWENA V. CEREZO",
};

// ── Available placeholder definitions (used by Template Builder UI) ──
// Grouped placeholder definitions — used to render the chip UI
const PLACEHOLDER_GROUPS = [
  {
    label: "Resident",
    chips: [
      { token: "{{resident_name}}",       hint: "Full name in UPPERCASE — e.g. JUAN DELA CRUZ" },
      { token: "{{resident_name_title}}", hint: "Full name in Title Case — e.g. Juan Dela Cruz" },
      { token: "{{age}}",                 hint: "Resident's age — e.g. 32" },
      { token: "{{civil_status}}",        hint: "Civil status — e.g. Single, Married" },
      { token: "{{address}}",             hint: "Full residential address" },
      { token: "{{contact}}",             hint: "Contact number — e.g. 09171234567" },
    ]
  },
  {
    label: "Purpose",
    chips: [
      { token: "{{purpose}}",       hint: "Purpose in UPPERCASE — e.g. EMPLOYMENT" },
      { token: "{{purpose_title}}", hint: "Purpose in Title Case — e.g. Employment" },
    ]
  },
  {
    label: "Business",
    chips: [
      { token: "{{business_name}}",    hint: "Business name (Business Permit only)" },
      { token: "{{business_address}}", hint: "Business address (Business Permit only)" },
      { token: "{{business_nature}}",  hint: "Nature of business — e.g. retail goods" },
    ]
  },
  {
    label: "Date",
    chips: [
      { token: "{{date_long}}",    hint: "Full date — e.g. May 9, 2026" },
      { token: "{{day_ordinal}}", hint: "Day with suffix — e.g. 9th" },
      { token: "{{month_long}}", hint: "Month name — e.g. May" },
      { token: "{{year}}",        hint: "4-digit year — e.g. 2026" },
    ]
  },
  {
    label: "Barangay",
    chips: [
      { token: "{{barangay}}",      hint: "Barangay name — Barangay Sta. Rita" },
      { token: "{{city}}",          hint: "City name — Olongapo City" },
      { token: "{{captain_name}}", hint: "Captain's name — HON. ROWENA V. CEREZO" },
      { token: "{{control_no}}",    hint: "Last 8 characters of the Request ID" },
    ]
  },
];
// Flat list for backward-compat with resolvePlaceholders
const PLACEHOLDERS = PLACEHOLDER_GROUPS.flatMap(g => g.chips.map(c => ({ token: c.token, label: c.token, hint: c.hint })));

// ── Default seed bodies for known service types ──────────────────────
const DEFAULT_TEMPLATES = {
  clearance: `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>{{resident_name}}</strong>{{#age}}, {{age}} years of age{{/age}}{{#civil_status}}, {{civil_status}}{{/civil_status}}{{#contact}}, with contact number <strong>{{contact}}</strong>{{/contact}}, is a <em>bonafide</em> resident of <strong>{{barangay}}, {{city}}</strong>, with residential address at <strong>{{address}}</strong>.</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;To the best of our knowledge and belief, the above-named individual is of <strong>good moral character</strong>, law-abiding, and has no derogatory record on file in this barangay.</p>
<p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This clearance is issued upon the request of the above-named person for the purpose of <strong>{{purpose}}</strong>, and for whatever legal purpose it may serve.</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>{{day_ordinal}} day of {{month_long}} {{year}}</strong> at the Office of the Punong Barangay, {{barangay}}, {{city}}.</p>`,

  residency: `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>{{resident_name}}</strong>{{#age}}, {{age}} years of age{{/age}}{{#civil_status}}, {{civil_status}}{{/civil_status}}{{#contact}}, with contact number <strong>{{contact}}</strong>{{/contact}}, is a <em>bonafide</em> resident of <strong>{{barangay}}, {{city}}</strong>, and is presently residing at <strong>{{address}}</strong>.</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This office further certifies that the above-named individual is known in the community and has been residing in this barangay for a considerable period of time.</p>
<p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This certification is being issued upon the request of the above-named person for the purpose of <strong>{{purpose}}</strong>, and to serve as proof of residency in all lawful transactions.</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>{{day_ordinal}} day of {{month_long}} {{year}}</strong> at the Office of the Punong Barangay, {{barangay}}, {{city}}.</p>`,

  indigency: `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>{{resident_name}}</strong>{{#age}}, {{age}} years of age{{/age}}{{#civil_status}}, {{civil_status}}{{/civil_status}}{{#contact}}, with contact number <strong>{{contact}}</strong>{{/contact}}, is a <em>bonafide</em> and registered resident of <strong>{{barangay}}, {{city}}</strong>, presently residing at <strong>{{address}}</strong>.</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This office further certifies that the above-named individual <strong>belongs to an indigent family</strong> of this barangay, and that they do not have the financial capacity to defray the expenses pertaining to their present needs.</p>
<p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This certification is issued upon the request of the above-named person for the purpose of <strong>{{purpose}}</strong>, and is being granted as a matter of official necessity and public service.</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>{{day_ordinal}} day of {{month_long}} {{year}}</strong> at the Office of the Punong Barangay, {{barangay}}, {{city}}.</p>`,

  business: `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>{{resident_name}}</strong>{{#contact}}, with contact number <strong>{{contact}}</strong>{{/contact}}, is a <em>bonafide</em> resident of <strong>{{barangay}}, {{city}}</strong>, with address at <strong>{{address}}</strong>.</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Further, this office certifies that the establishment known as <strong>{{business_name}}</strong>, engaged in <strong>{{business_nature}}</strong>, and located at <strong>{{business_address}}</strong>, has been <strong>granted clearance</strong> by this Barangay to operate, subject to existing laws, ordinances, and regulations.</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This barangay clearance is being issued in connection with the requirements for <strong>Business Permit</strong> application/renewal and for other lawful purposes as may be required.</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>{{day_ordinal}} day of {{month_long}} {{year}}</strong> at the Office of the Punong Barangay, {{barangay}}, {{city}}.</p>`,

  generic: `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>{{resident_name}}</strong>{{#age}}, {{age}} years of age{{/age}}{{#civil_status}}, {{civil_status}}{{/civil_status}}{{#contact}}, with contact number <strong>{{contact}}</strong>{{/contact}}, is a <em>bonafide</em> resident of <strong>{{barangay}}, {{city}}</strong>, with address at <strong>{{address}}</strong>.</p>
<p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This certification is issued upon the request of the above-named person for the purpose of <strong>{{purpose}}</strong>, and for whatever legal purpose it may serve.</p>
<p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>{{day_ordinal}} day of {{month_long}} {{year}}</strong> at the Office of the Punong Barangay, {{barangay}}, {{city}}.</p>`,
};

// ── Placeholder resolver ─────────────────────────────────────────────
function resolvePlaceholders(bodyHtml, r, reqId = "") {
  const date    = r.createdAt?.toDate ? r.createdAt.toDate() : new Date();
  const dayNum  = date.getDate();
  const ordSfx  = ["th","st","nd","rd"];
  const v = dayNum % 100;
  const dayOrd  = dayNum + (ordSfx[(v-20)%10] || ordSfx[v] || ordSfx[0]);

  const vals = {
    resident_name:        esc((r.fullName || "—").toUpperCase()),
    resident_name_title:  esc(toTitleCase(r.fullName || "—")),
    age:                  esc(String(r.age || "")),
    civil_status:         esc(r.civilStatus || ""),
    address:              esc(r.address || "—"),
    contact:              esc(r.contact || ""),
    purpose:              esc((r.purpose || "OFFICIAL USE").toUpperCase()),
    purpose_title:        esc(toTitleCase(r.purpose || "Official Use")),
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

  // 1. Conditionals: {{#field}}…{{/field}}
  let html = bodyHtml.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, inner) => {
    const fieldMap = { age:"age", civil_status:"civilStatus", contact:"contact",
                       business_name:"businessName", business_address:"businessAddress",
                       business_nature:"businessNature" };
    const raw = r[fieldMap[key] || key] || "";
    return raw ? inner : "";
  });

  // 2. Simple {{token}} substitution
  html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => vals[key] ?? `{{${key}}}`);
  return html;
}

// ── Sanitise HTML body before saving ────────────────────────────────
function sanitiseHtml(html) {
  if (typeof DOMPurify !== "undefined") {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["p","strong","em","br","span","b","i","u","ul","ol","li"],
      ALLOWED_ATTR: ["class","style"],
    });
  }
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/javascript:/gi, "");
}

// ── Fixed document shell (seals, header, OR-box, sigs, footer) ──────
function renderDocumentShell({ docTitle, bodyHtml, dateStr, controlNo, serviceType, requestId }) {
  const CITY_SEAL = "data:image/png;base64,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";
  const BRGY_SEAL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAYAAACtWK6eAADkZUlEQVR42uy9d5glVbX+/1m7qk7unNPkxOQEAwwZBBFERAS5hqty9ZoVc7yKATHniDmBqJgQyTkOaTLD5Ng594kV9v79Uae7T4dBuF/1eu+Pep5+puf0SVW1115rvetd74Lnj+eP54/nj+eP54/nj+eP54/nj+eP54/nj/8/HlL8ef74F7spzx//2AU/3cI3xZ/Jvz+TwaijvEfp+zx/PG8g/7LXUZVcT138eearbsLflRICXwuAZVvGmHCtG23Gn/+3l78qMSJT/PznjeZ5A/kf8wyji9Gf7kmnfvxUe/cNuxvzAyNNxtizfNevJ9Bz3IIfdxynzvimynM9ByGiREVFxMYgBhMYY3zAM9q4Iiawo5GCEXPEYNJO1BnCBAcjyfgRF7ezpjnW/uqr3tR/5RlX+tOYgwBWidGa543meQP5R3uIiQYhQu3CmiY/7S/QBb1Y+3qx8YIF2meW9k0LmqSMegpHoRxBOQo7YSMWiAKxBctRKFuFK9g3GF+jfYMODEEhIMhpjDbFvxmMMQTaAGZQlHQpRx20bNluxZxtKqG2xefHn+64q6NvzAuNH/bzHuZ5A/l7GgVAMG4PQvXM6oVB3j02yOv1gWuO1Z5eoANTJgJW1CKScohWO8RqIyQa4ybRENOx+oiJVUaJVkdQSomVtFBRhQhgREQJylKAwRgwxhijw9+DrI+f8Y3WGnfAxcsGeGlP8j2eyvcWJNuVI9fjUhhw8dI+gacB02fZ1lNO3HrcSjiPqHL1xNt2vG3XlXJlaeg32bs8fzxvIM/dKGYsq6ga7DXH4fNCXQhO9QvBMuNhK0eI10Qom5GkfHZKp2YmdNmMBLH6mDjljlhRJWIhoDB63CNgDGjQpbt78WHBEFrNuEFiCaqYYYgIYgsixccMRmtjglxg3EHPZDuyDO/OWsN70zJ8IEO6PYs77AN4YrPDjtn3OmXOjWWzyh45eP/BgeeN5XkDebbXwSoNnypmzKiygvQZXs67yOSDMwPXNBhjiNVGKJ+donppRVCzrMKkZiVUtCIqYosYDdoP0G5oCEabCUtNRhf+NFddRDCY8E9mOliqmLhPl0UIiBKUUwzVHAUG43u+LnR7ZnDXiAxuG7L6nxpmZF8GL+2DRZedsO+wUtYNyebk3e2PtvdNCsOC5w3leQMZzSsCgI9//OPqGz/6xlle1ntdUAhONwXTICLEG6NULyvXDcfX6upjKlWsOioSQbRn8AsB2tNjS0mkaAgycWmPA1dS8qApAakk9B5jz5fQGATEhF7FlKxXmWQ7Y1ivNqGhGRBLUI6FHbNQCuMXjMm153T3k32q+5E+NfD0CIUhF6DLSdk3OanI9csvX377PVfe45d4FfOMiNzzBvJ/8phw4+Nt8Wa7YF+Cy78HuWCl8TXxxhj1a6t108l1pnJhuYpU2WK04GV9jBcmySKCKJmyy0+8vGaaRwVjzBiMK5aMIblS+tow5gqNp8Sgxp5X8oLRPxuZ9FXCfGZsO7CjFlbcAl+bTEdOdz82QNf9vdbAU0O4aR8VVdsiCetnqtK5dmDPwKHpNpLnDeT/tscYjbNJ1FascUS/wcsGF+ucrnFSNtXLKnTLmfWmbk21itVERfsGP+uj/XCPF8VYjmAm7PuTQqFigi3F8GfCM4q7u5OwECW4aR8TmGIIZiaXSZjoZyYdpeHY5HrJNOVJY8LvJgJWTGHHbYw2Jr1/JDh0R7fqvL9HpQ/kMJhBp8z5vVPu/HDg0MADJe9r/f/JUOT/j4ZRUVNxupHgCj+nzw/yWhL1UVrPavBbz2xUZbNSyojBywZoV4dewmIaQwh3ZhmNq8aMJXyWk7SxHIVfCPCywVjebQwoSygMufTvGMQd9mk+sR4nZYdGKJP9z8TfpzWQorOZ9kVTLW3CS8eNxcKJW3gjnu55fMAcvLnD6ts0iJ8LsGLWLbFy51t9RwZuREZBa9T/HwxF/n9gGGOhQaoudZLS6oNBPjhP5wJSMxPMeklz0HJao4rURSTIBvi5IAyC1HgeMXGdFWFYwnBFa4P2dOhZRvMQBb2bB+nfNkjlgnKaTqjHzXphIq4NkTKH7kf7uPf9GwA469vrqVhYhp/zxxP5o90cM/0fJtjHdMZSGt5NQA4mehblCHbSRgQzvGdEH/prp2q/u1vyfS52wnpUlVlfGukY+XUxbBstmv6fzVGs/+OolAZMojaxKp6IfdMUzBf8EX9BsjWuF7x2ll76tgVSu7pGBYERL+1jNIhSY2GUTNq5RxefilpYtkWmPYf2NZEyB+2F+YKyBS8dcMdbHqT7yT6chEPbmU0URtxinQOUrXAHPPbfehgRYeY5LcTrYmi/6LGmS8JH7VWehdFMS3scf9Bog9FMRMUsQRVDQT8XEOS1xGqiqumkOmk5vT6w4oqRA5nWfFfh4mgqemaqLtadT7s7R1/9f9VA7P+jRh8AQbQiOivi2B/Ck9e5ad9JNEXN3Mvn6LazmyynzKYw4pHrL6AswbKkJMKfmjQbAG2w4hZDe9Ns+PRG0h1Z4jVRzvreSaiYoD2D9g3Rcoey1hQjh9IM7BrCz2ssxwoT88Bgx216t/SDNkTKHVLNCYJiOHfU+GraPWCcqyWTIqnRQMiEhcgxhE0HhkjKwXIU2jOoiCIING7aQwcGZQnKCo0pKOgwxEra1jGvn8vsF7fp/TceNgduaj852+WenEglbo+mop8Y6Bh4oGQ9+c97kH9trxEATllN4t2WOL8IhvVJTtyy5l3SFqx67zGqdk2V8vOjeYEgxV1dioG80YzVL0RGPUkxuNIGJ+XQ8WA3+/56GKMNXtpneF+auS+egZfzEQN2wqa8NcX+Ww6T7yuQ7cwx+4VtuFkPO2HjDnhs+Nxm/KzPkn9fSPP6OryMj1hSYg8T3YDIs7sAE2DjkgfGjKPMoWdjP9t+vJNdv9lP96Z+FEL5jDKcMgffDULvYoo0GKUgMHi5ACuupOGEWtV8ap1WoszInsxcd8h9XaIm3pZsTj2R688NluQn5nkD+dc6Dw2YVG3qlGgscr3Omtdq38RbX9jgr/7QEtV8Wr3yfY2b8cOimlITUCWtDeJYRFI2kaSDFbXCUCQwYym+MeDEbfo2D9D5WC/zz59DfjDPwM4hxEDLyQ24aY/ADaicX07VnAqO3N/FwM4hRg5kmH1WG2i474OPMbx/hLqV1ax93zIKI17x+8gkZzFdrPTs0sYJBmWKuU/KoXNDL/e+bwODe0bIdOcY3D3MwTvbOXx3J9FUhLLWJE7cRmzBLwRjyJ1YCrTBy/jYcVuaT6qTxvU1QWHQlaGd6dV+2n9Vqibu5rPuI0XjsP8v5Cb/FwzEBoKampoyJ2F9gUC+6w/7zVVLyoPVH1gscy5us4wF7ohfhFzVhFUUJqaKWEWEQm+Bnif66Hioh+H9aaIVDk7KQQcGUWACcJIOh+/qpHdLP0tfv5C2UxrZf+thejb3U7u4moo5KYJCgJfzqTmmgsbVtXRu6KF36wB92wc5eGs73Zv6SDUnOeULx4WxUMCEbo9RD2JKYd3n0E5ljhKNOXGHJ762jXR7lpmnN5tTPneszDirmYqZ5Rx5sIuDd7Sz/A0L6X6ynyDjUzWvHB1oAjc0FEavnzYUMh6RSke1ntkg1QvK/OFdmbJMe/7ceEXs1ERNYmN+JN/xf8Gb/G82kDHoNlUZOxXFH4KsPl8UetHlc8yKdy+0ovVRKQx6iGZsh6akWm0Cg5Oy8dMBm765g8e+sJkDt7fT+WgP7Q900fFwD/NeNgvthVCo0eDELQ7cfITBPcM0r69n1vmt5LoK9G0foOvxXmaf3YbEwsKem/FJtSWZeWYL/TuG6X6il3RHlmhlhFM+v45EYww/WwytSirxo8YgR3EeZpq/TS4yTrCnIkplOxZ7/nSQXF+BWWe3yKzzWtFiaDqhjhmnNNF8ciNWzOLW19/H3hsPke8pUN6aItWcwIjBd8c9ihJB+wY/F1A+r0y1nd1kBIL+LcNzg1zw2mR90sqP5O8repH/td7E+l9s2NoYI1/++hc/rcT+gTvo1VctKfOPvXK51XxavRSGXLRrQuRIpqbdRhvshEW+s8Bd73yYrsd7SdTFWHTpXJb8+wLqVtbg5zSNa2sxoxmvgGXb7PrtPrJdOeZfNItobYRZZ7bSt3mA/p2DDO4dYd75M/HyXohoZQOcMpuZL2jm8D1deCMe8y+azewXt5LtyWFFLCajrkdtkBJ5xiDrmRyM0WAnLXTB0P5wN/1PD1HelqJyXhnDR7JEKsPwysv5NK6pJXAN+285zN4bD5HrzFM5s4yyliSIoL1i/lZkEvjZAAPSfFKdql1ZFQztGIpkDuVOT1TGz0jWpR7JDeW6GKfZP28g/4yQqqKiYs5VX7rqt8bl3/2sz/xXzjCrP7DEssss3CEPZSlUyTZrgknrTAQliruveIT04QzzL5rNSVetoWFdLZHqCDXHVNJ6ahNGDNGySJiLmPB9dly7Bz/ns+TS+WS6cuz900F6tw2Q7y+QPpJFRGg5uR53xMOKWHi5gGh5hO7Hehk5lKF8ThkNx9aGoYsIo8X5Z5ldPPe/FKv5Xj6gflUNhSGPnk39HLyzg7LWFLVLKnHTPoEXYEUtUjOSLLhoFrZj0/5wFwO7htj1+wNkDmdJtSSJ18bQvhn7QKXC7cdNeySa42rG2U0m8IKgf9Pg7KAQvDpWE+tw0+6T/xtDrv9NBjKGUpVVll2Abf6kR4KlTrnlr/mvxdbsl7VJYdjHeGDZk1JdJTjlDmIrtK/RviZWGWXfTUfYf9Mh6lbUsP6q1RRyHu6Ih/GLlXRfU+h3OXDTEWJVYS+Hn/F5+td70Z5m/22H2fnbfXQ93kvga6rmV5LrztG7pZ/apdWUzynDzwYgEEnYdD3Sy8CuIYK8Zs6LZ4QFxskMXxmHbf+WxUwMq8xRX2BGEQYDfiFgxllNWMqm6/FeDt3dQeOaWpIt8bCWA3i5ANHC1h8+TaYjS/O6BuqX17D3lkPs+dNBKmaWUX1MBX4umECjUUrQBY3GSMvpDapsTjLofWIw7vV7F8aqY5Xuse7tHCBgnAv3vIH8vfONRHniw7ZtXeMOeMmaFRX+8VevtCsXlJHvc1GWTI3blRAUAg7e0s6W7+80M05tEhTYMZsdv9zD8IE0i14xh8pFFbgjPpajwkVrIFYZ5fEvbmXnb/ZhR21aT21k5HCWvX86gA4MtStqWPSKOSx97QIWv3Y+i145jyAb0LOpn8P3dDLrrBaspAprHzGL9JEc+f4CNUsqqV9dM8GjyTRQbWkiMTnvmGoOz2BN2mDHbJykTVAIKAy5tJ3aRO/mAdLtGYyBttOb8LJhCSNaEaHn0X62/WwXYgknfGwVC181h/oVNXgZn5ZTG3DKbHRQ8p1KeGeC4KY9KuaVqRlnNJqR/Vk9sjt9YnwwfoZUxO8OMoX+/y15if2/xDg04CQrkj+wLfs17kBez76ojaVvm2cHniE/6BV7ICZSWY022FGLwd3DPP7lrQCy+/cHWHz5PPysjzvoTqCKTyUVGlrWN3Dkng723XKYxa+fh5cNc5tIymH9J9diVyn8dEDgBmR6Miy5fD5iC4naeIg7mxBSLox4zL6gjfkvnYFEFe6IN8UokNKFX0Kwmhx+SZG5+7fdSngNkg59mwfI9+RpO6sZK6ZwB1xyvfnQIMqcCa9TluKpX+8BoPmEBqqOKWfwwAgViys4/lOrCHI+QV6HwEUQhlp2zAo9SpG7pmyLwpCLlbRk3VXLrKd+vNff86tDJzlx/YDTlLok3ZG+/39DYdH6X+DhNClqy1LJG5VRL/Fznr/sXQvVMa+fo9whLyT4WSX1A1O6HYdYftW8CvwRn75tA/Q/PUTz+gaSLQk6H+5laN8IdtRmxlkteCNeWEUuvj4oBJS1Jtn318MUBlyq5ldix2323XSIwNXMOX8G2hh0wRS9gKB9TcuJ9VQtKg+hYd+MewhtCHyDnw+mGONYoYVpEvFSSvsod+po6O+kCrwODLGKCE/9Yg9brnmaI/d2kj2cY9vPdzOwcwiAte9Zhp200b4mWubQt2mIrT9+GlHC2vcuI1odwWiDdjV+IRgzJu1pnISN5dhkDudINsYxUjzn4oZjfAhcn6ZT6lWqLe53P9xfoXPmVcma5IF8Or/xXz15t/7FjSOIV1e3xm3rZlxZpxzxjr1ymdN6VqPkevOIpcZieKOL1WJd7H8oNi5J0Ugaj63j8D2d5PvyeGmfOee2kR/yaL+vk0xnjsaVdVQuLMfP+uGOGLGIVUfJduTZf8th/FxAvt+lYW0dfdsHmHVOC/Vra8Oi4ySGiJf1wyKbGY/9wwp9cUGPomqj6YclKFtCQ7dCZCg0IBnjShkT1kvM6PmZUuOQ6blYJlykgaupnluBGKF3az9dT/SS68mTbExw3AeWU7uqCjcderRIWYSNX9vO8ME0Lcc3cMyr55IfCnlko81gowXUeG2UfK/LY5/bzKbvPEW+K0/VwgqsuCqyhGXsNe6IS/UxFarh+Grd9Uiv5fa5FyWqovlC1r3vX3kd/quyeW3Ar2qoWhIEwY1BOpgVrXX8dZ9abqfmJSn0uyh7YiXcToQ7YCRuYQA/5+O7wdiiilQ79D02yD3vewRlC2d+ez1Vx1Rw2+X3079jkGRDglVvX0LtqiosW5HtztN+fyfbfrYLPxdQt6yGWee10nJyPcpRWAkbd8hlChHejPeaiwXKsbAioWJJccmHa9fT4fMCgy6EO3NIcQm3Z6UEFRFUzEKsohqKHRqMUYIJDIGrCXyN9syY8TGho3G0TVewogonaVPod8kcyWI0lLUlsMssCsMh09hO2IzsTXPbGx/AGDj9K+uoWVEZGk9xF9C+wUna2I7NgVuO8MTXtuJlfFREoV3NolfOZfmbF5LvK0y4R+FrNZFyh8KAax772BY9tCtt2RXOV4d7hq8oQbfM8wbyLIzDSTgrk4n4LV7ar0+0xoMTvrDSciocvGEPFVFjl1Hr8IYduquDp366h+qFFTSsrqF2WRWJ5gRWRBH4IRkvVhnlkSuf5MBt7cw4o4n1n1vL0J4RHv7ERvp3DIYfHrewohaFQReAVHOSRa+cy+zzW0EM7ohfhI0NYkvROxR3dFuwIhZ21EYk3Llz3XlGDowwsn+EdHuaviMeQd4j0+WF4YpvIB+Erm9yt5MoiCkkqnBSNrHKCNFyi+pZCarnllHWECPZGCdeG4WIhTHgexo/r9GeDvtVlIx5WR2EdHYrYiESIlraDwmK2tckqmM89IknOXhnB3XLqznt6+vIDYYL3fgaI0KiOsrAU8NsueZpOh7pxooo1r57OQfvaqfzsR5O/uyx1B9XjTc8zi0rPSXtG+y4hWhjNvzXlqD3sQHbqrR+mu7LvPZf0UjkX9E4EglntRWL3Kyzpi7RFgvWf3G1pZIWXtbHKpILR7v1jIBouPGSu8LwqOSonF9O/aoaGlbVUDG3jHhjDPGFv77mXtLtGU7/yvHUHluNP+Jz4NYjdG7oYeRIFjuqqFpYQfPxDdStrMZOWuSLCb2yVLFdNly/KqKwYzbKVvhZTfpwhoFtffQ83snAtl5Gukyxq8gmmUqyeEbWOGXlMme2kCwTWlstystDD2NbIb1EazNGSc+MBHS0a4aHYXDQ5+DBAocPugwMabwihiE1UarmlNG0rIL6peVUzikjWhPFWAo/H/a4mMCEKigiYy24Y55mNPXRcNc7H2ZozwjHf2wlbS9oGjtvJ2WjRHj62n1s+/EutK9pPrGBVW87hsp5Fdz48jsZOjDCuT8/jVhDBO2aoxIsTWBQEcGO2Gz4+Cav+8F+xypXv0oPZF9VkkWZ5w1kmpzDcZwV8VTkDp0zNfGWWHDil1ZbVsoiyAYTKBljO1LRgxy+tYNHrt6EFVU0rq1DB4bODT0T5Dtrjqlk1tmtDO3LsOdP+6g+poozv3si+eECsYpIuMt6Ooy37XBX9TJhu62yBR2ElmnFLCIJBxNArqtA7+Ze2u87RP/WXjJ9gDhEZ8wjtWSVKVuyisT8FUSrZ2LK6/jCyg9zRt11QKOAW4J0mkkw1KTCSAlZaySj6OvRHDqM2fl0wPYtObZszMm2bXnaez3AJjUnwqwTamg4oZXKhRXYSYWf90MoV4c1i1L+l9GhB8SHrg3d1K6qxopZaE+TqIkxsH2Ix7+2jd6tA4gIa9+9nIWvnMVIdxavP+Dmf7+bSMrh3J+dirYMop95dRkdemA7onj041u97of7Hatcrkv3Zy/7V/Ik8q9kHKma1CKluTvI6oZ4ayxY/+XVlp2w8XI+qhjOlHKWRllVQWBINSR4/PNb2fm7fdQvr+Gs764n251lYOcQXU/20fVYHwO7hqZ88Io3L2LhZXPI9edDw1AlYVMR19c6DFUiKQdlW2QO5zlyzxEO37aPgV05fCA+cxEVq9dTc9LZxBYei1M7CxUTjMZoF8HDBAHkCxn52KL3cMmMnxjXrStu4vpZ3BJT1MIyxXxAldROLUDIZGH7dsMD9xXMH2+Nce8DacxIhySroPm0FlpfMJPaxdWIbXAzHkEhKAEEim5ZCU7CHiuUOnGLHT/bw7af7QYg0RAn252jan4Fx394OVWLK+l8pI873/4g9ctrOO3r68gPF8aaw4624Eb7a8QW7JjDho9v9rru73HsCutX6YHsK/9VjORfAT1QgE4mkw3KkttN3syINUWDk768xrLLLLxsMDGsItzpQvXA0FCUKNycR+v6Rroe66Vnaz8jhzLMuqCVaG2U5hPrmXVuG7PPbqVmURWRcofAN7jDHsnGBM3r6wlcXSw0FouNSsKd1lHEKqMIFl2P9LP565t58qtbaX+0B6thFQ2vfBuz3vNF0/aGT1J95kuIzlgiYlWhC6CzATqvxfgatBFbjDhWlFs6z8cLDOsb7hTLckAcLMuEibka/Zfiz+jvKqR0iIy1x2pt0EGA1h7gEY36tDQbjj/B5fRXrZM7199K7bEn41tl0nnPLnb/Zhvtd+xBF4SK1iSJhngo7eIG43UgA0EuKEEBw9wl25mjfk0tp169jrrl1ey7+Qg7rttL9bxKvBEvrMgfV0/LKY14WX+sO1GOYiRSRNhMYNBaM+OsJmto17A3sje7MloVneXlvD/8K0DA8i/gwaRmYU3S63HvxmW1Soh/0jfW2tG6CH7aLybCYdEsVBRUeCMeicYYXt4vwrIylmC7fR63vuF+3GGXdR9awYwXtZDtzmFFLeyIFSaIluBlAjJHMqRaEvieDlmqUlx4QTGMStn4fS4Hbz3E7t88zUCnIVo/k7oXX2bqXvByYnNXg42YPOg8GO2P8bzCJoqJBb3wTwYLQ3/B4sy635rPLn0HKbsggS7DEv8ZKSPTFjuMjLUPGgOBBtAUtOKiDQ/Sb7cRS4AZyZjBJ26Trht/afpv/4to7dJ6TgvLXtFGxbxyfD9s/hqFncfe3kCk3Clyr8IaTiTh4GcDHvv8Fg7d1U6iPvQqK950DAtfOYfcQD7c1Ma6GY+mKGHGrrk4CstWPPzBjd7ApiHHGke3/keLidb/sHEoBB3B+a0K5DSN9o+/epWdmpHAHfFLYMIQSHViNo9+bjObv7MDd8gjWRsj1ZoIPYqrCXI+ieYEibo4h+/ppHtjPy3rG8Kd0g3Fn4NcgJcJr3esOopf0OOKI77BiijilRG8/gLbf7qXez++hfaHRjDzX2COed/HZNZ7v0bV+vNEkk2is1pMLoBgVCNLIaKmsG5LusEJAyqhzAl4amSpPNh7kqyrvsNURXok0AmUmGfYw2Rqyb20BiOh1zE4RJ1+s3NoAU/2rJB4wcUnIYk5i6h70SVSd8Fl5qJ5d8r+m/ex4ecHad88SFVjjMo5KbDDxH40vBQJPYr2Q1hZkLBibgtzz2sjErc5eFcHAPMvmkWyNYEp6OkLoUc5I1ESSrIqaD29wep+pM/LdRbWRyujeTfn3vc/SUv5nzQQGwhSVamv2qJe42Zd79grVzjVqyopDLooe5zPpgNDrDLKlh/uNHv+cECCQkDvlgF2//Egw3vTxCpjVMxI4KQccn0F6pZXUeh16d3ST9/WQWaf21ZUGywuYqWKleAQ2TFBGNcnaqIEwx7bf7yb+z62hd4tA1x2cQ1v+cp6o17/BTNUdyb5bFTsvI9lPBCFUVZRNvQobeTTlMQFCIwi6QR0FGZwW+d5rKh4SJoSu/BNGUr09EbxLH2/AZRosayAv3a9nFjEEm0MJh9gMgF+tFa++u838+G3p2mbWcuW2/vZ8Kv9HNnQT2VrnIo5ZRgBv6BRJYZS+u+owVQtqGD3Hw9ifMOiV8wJRelgYn/9US6FMaZY1A3zIO0ZVFTRdFK96ri/JwjSwdmxyvjOQqaw+X/KSKz/QePwU1WpN9tKfSo/UPCWXbHIaT2rgVxfASuipnCirLhF5kBWOh7upmJOGWvftYxMR5aux3vZf8thep7ox4nbVM2rABsa19Zy5P4uBvcM4w17tJ7eFPaMq/HdNjQ+TazcwVHC3uv3c/v7NtKzqZ/XvLqWn/2ixbzlrRE5du4eubjiR7I4eh8jfjnt+ZmM+DEsURKxgmImKVMYuJM6UKasam0UMcsnHdTIXzouNm2JvSwoe1QCU1ZUN/nvhd9KDIYIzfHd3N17tvQXmnFUgFEKyxJyBczK2I0srNwsa1YneONbKpkzN2U23Tkij/5qP71bh2haWkWiKRnWarSZxiMIdtxiaHea3b/fT6Q8wsq3HYMVs8dadacPCqVYD9FYUQunLEqQDz26KhJLIxWO1K2skkO3dmjjmQsj5dG73ay7n/8BFrD1P+S1glRVar2l5Hp30DNzXtZmLXrdXMn25rEcNXW/UYL2NOUzU+z7y2HcYY81Vyxl/stmUr2wklxPnp4t/Ry6u5PODb2Ib6haWE7N4iryvQUWvGIOdsIeZ5wWC1bKERJVEfqf6OfO9z3BvtuPcN4Lq7j21y285S1RGhqyEvh5jI5g2xazynbK+U03cFLNrRK3+zmca6EnXy2WUsTU6FApKTaxj5PCJsqJlkI5xmgssZUGicjNHReKo7KsqboPiGKMVdRpewZXcRTxLG0sHDUohSBi7uo5h2REizGCJQFuIJxSdzsLy7aK60WJ2AVWrrTkjW+uorUtxb039PH4L/aCB/UrarCTIRERGWdLSzEkTTTGcYc8YuURnGSEI/d3UbekMmxTPkp8pT1NtDJC5kiO3b87QPPx9Wgv5HiJpfByAanWhJTPTHHk9i5bWfJCK2H/2s/5Q/yT+0n+2QaiAFKpVI04clsw4ldWL69g1UeWqMJwUbhgmthEgMDTxGuipA9m6Ns+SKQiQuWSCsrnJJl1dps5cNsR8UY8cr152h/qZvfvDtC4ts6seNsisaJWqJKoGAvZohU24ho2fXUHG762jdZKh+/9aBaf+XSS5qYsge+CEawishSmvgmMiUl9rIP1NbdyfuPvqXG66MjW0Z5vEs8oIgpREsgoP32KDNyEADyMzQyCwhCxhDu6X0BPodqcUvcXsZQQGKck5JJnCbOMcqAitCaOcFP7RXiSFEtAG5uBvJKllZvkuOp7QZIIhsAPcJwCa9Yo/uM/6wm0wx++c4BDf91L1ewqqhaWo32N8fUEUT0TGNrOaKZiVoo73vogXY/2UDmrgqrFFfjZyaTMsLYUrYowsi/D/R9+nCP3deIO+cw4o3lMXE9ZgpfxqV5cIUaboOehvnIrbh/v5tyf/V8OscYaniIJ5zfKZ61dbgfHf3aVJRE1fuEZX8Rj/J/i78oSnJjD/luP4I14LLpkDtlulwc+9LgM7hpi6X8sYuZZLfRuGcBO2Cx5zTzx3WCs+Deqf5usjtK3oY9b3/Uo3ZsGeNcVjVx3fT2rV3poP4fWoU6WTE6CMYgYtImgTbkk7bysqrpXLmy+ngVlT5Dx4xzJziTrR7AtkYjSxfBLcVS9xJIShBEodwIe7z9OHh84llPq/krSHiYwSZQEzykPCfMch6TdyZFsC3f0HC8RDBX2YZaUbTJn1/9FZiUPAk6YZxRpCa6vSCZ6sE96vXls8VfwtmyUbb941GQ68tK8pga7PBIqQBbzEQz4+YBohUO+38VyLOZfPAvlqCIsP+41Rze5gaeGuec9G8j15FG20Ld9AO1pWk9tGuN9iRLcjE/julo1tD/tj+zOzExWx+sKWffGf2Y+8s80EBvwyyoS77Nt+y1e2vPX/NdSu2JBCjcdTJiuhIF4VXRMqzZa4YRjyDxNsjnJoTvaGdqXpqwlxYbPbab/qUGO/cByFv3bbKoWVdC6vpHZL2olWhtBF8K+dO1r7IRFxFFs/d5OHv7SVo6ZE+P6383gP9/oEI1mw5ZTu5Sda6Zf02JQojFG0CZBRInMK9sm5zf9gRNrbseRHO25FnoK5WIrIaICQGOmDKqdCEGJEQIUZU7A3uw87u0+nbXV91IbPTwpeZdnvyVhSXP8CCkrLW+Z81n+c+43zL/N/BGzUnsEEmMh3GjoKaIQXP6072yecC5l/iWX8pIZ93Hn97fJ1j91UDc3SfUxlUVaz6iYdxgGt53WxOwXtmIlVFHXePx7BJ4mXhuj+/EB7n3/Bry0R92Kas78+gkM7h1h/82HSdTEqVtZHWqEFb2U1pqm4+tU+33dvjvorYuUR3Z7OW/TPysfkX+ipwoSFYlVjmVtcAc95r1yprXkzfMl25MbUx0cPZyUw+7f7Gf3Hw6AwLwLZzHvZTPJD+WJ18bZ/M0d7Lg2bOhxkjYnfWYN9cfVku3Nh24qZoVqOq5GLIX2AmLVUfKHszxw5Ub6dgzy9ne18NnPlJFMZPG9kOM1Fu+bZxfGlJqRNhYKg6g0kDfd+Vb+0n4Rf+n6N57OLBMlkHQMQoA2VnGCh5HpBNkN4EhA1reJSTefW/I6c1L9nQS6XpTov528T8hzBMQHSRf3qDhG26NIF6UjGib01CjP7BycIyKOmV/RIVu3Obz5jUe4/8Ehlv7bXJa+aQFuLty0lKVC0b0JJzLeuBL4mmR9nAO3tLPhqk0EbkDLyY0c/9GVSFwIhgJu+88HyPbkOOcHJxNvjhMUQp1iExiccofhp9PmgXc/bsRWGXFkzUjvyG7+CbrA1j8ptJJ58+ZFsoXMjTqrmysXl5lVH1yi3GF3TNlwFK2KlUd55NOb2HHdXtxhD3fYG+NUtaxvxMt5xKtj7PtLOLri5M8eS+OJdWS6cthOOE4gpLiH4ZT2NYm6GH2P9nHL2zZgBl1+fu1s3vfuCBE7TeAbbEumQpBHhWonPynEr5ToYvgVJTBlUuZkZVXV/fKS5utlQdljZqiQ5GB2DrnAJqJEbOWLKZLfRyvLpTCYRhGzAnzK+HPHRcStEVZV3Y8xUTGjCNek14w9IJPhVAttUhgTCQuixVDxKKXHIo3Hltp4l6mJ9YjvGRobPf79dZXkChH+8N2D9G0bYuZpjVhxmyAfIEU6/1gFvkReKVkbZ9evD7Dh6k2YwFA+s4yzrzkZN+PijnjEaiKkGpMcuPUIGGg7rQkv6xUF/sK6S/nslFgR0Z339cTsmKwu5LwfM3V2/P9KA7GBoBAUPmGJdQnK+Md/aqVtlVtFvalx2C9eG2fLNbvYfcN+ZpzZzKlfXkfD6lo6H+2l6/FeZp7VgrKFRGOCvi0DZDqyVM4tp2ZpVdgCWuyHHiv8aUOyLsa+3x3kvo8/wcIFcf56yyzOOsPF9/IICnWUqGeKGEKp6K2RElh3og8YC78QtEnhKMO81DYuaL6BY6vuwdOaQ7lZDHoJsZXgqGAi7jzBESgspXGUI3d0nyPDbpKT6m4VJRba2M+AcMk0FVmNEjPxvEQmCPqGtyI8PxGNNo4YY2NZxTxQXM5+QZJjllZy/bc72XVbB23H1xFviuNlvDF1kzEnbAxWxGL7j3ez6btPAdC6vomeLX0ox6Lp+PpQidILSDYk2HHtHkwAs1/URuDq8dDTEtysT92qajWwfchPH8zOilXG027OfeAfHWpZ/4zQqqK2YrWI+ak/5JnFb55vNayvEXfICyvlReOIVkbpeqSXx76wmYY1dZx09Ro0mpqlVXhDHt1P9tF6ajMVc5NobVBKceTeTtIHM8w8s2UsKRyTYDeQqI6x/XtP8/h3dnDm2bXc/NcmZs/K4LsBtjOpblHShTe12DdqNZNbYuUZwaVxQ4kLJiItiX1yVsOf5Kz6P1HtdNGebaI7X49GSdQKd3VT8s7j9RVDytE8MnCC7Bg5xpxSc5NE7RyBiU8qKpa80hxNCWLUOBjr4R8dBDTZZY57mmKugRD4LsuXCS96cQN/uHaEx365l6ZVNZTPLivKuo7rtFpRi/SRLA9/4kkAVrzpGE7+7BoKAx5bf/Q0lbPKqV9dQ6wyyuE7ujh8Xyex2iizzm0FFYp8B8WqvBQR9Lrl1XLotk5tPH26k4z80ct7nf9II7H+0aEVYEVizu+DdNBWv67WLHv7ApUfGO82M8VdRuc197x3A8n6BCd/7lj8IMDP+thRm+7HeundOoCTdIhXxRARKueWs+fPB/HSHrPPn4GdsKDYjioixCoibPzSVrZdt4/XvLaO31xXTTKZxXcNti3TxBVjAwEpnRo4/tg0sdeE+QhTiSWjcnVKNIjBmBjaJKmKDMjaqrvlxU2/oS2+g558NUeyM8U3ykSUiKUCjCl6w1F41Ahljs/O9GLu6zmDdbV3UhVpl8Ckjp68i0zMSUpjqFGDkOmGi04j3Vh8nhLB931aWgyv/LcKc999Hvd9f49UtZVTs7wKd8QNmdcIgRtQ1pLEeFC3spplb1rI0MERGlbXsv/mw+z9y0Ey7VmO3NfN1h/vRPuaWWe3MftFLfRuHmBgxzDVi0JAQOxQbT7RFJNI0jZH7u5xrKha4ea9n/wjc2nrHx1axcvib7fEulws/GM/vtwuUsDH4U0NkZTDAx95gsFdQzSsrmXO+W34BR/lKIK0z6Of34yfC+jbPsCePx5g718OcfiuDvxswEmfXUvFvFQYB0sYs0aTNo99ajO7bjrM297VyPe/U4WQwQRgWUfb9Ut6xEWYwqaSic+ZoMsj8jcy+9HQbxT9stEmScwKZHHFE/Ky1utZkHqUIS/Bodws0r4jUUuwlc/onJpRekrc8unxWri188UsLn9UWhNPo02qZPDT0Rf4BNs1Ez3ihHMqNfpSYxr9s7IwQQY3WcUjJ/zedOwaZMePb5eypnLqV1VRGBmHav1CQMOaGupXVZMfLGBFLNwBj12/2wdA/46hsJvTwJzzZrDuo8tov7+XBz7yOPtuOkTbGc1EKyNhGcBSeFmf2uWVamjXiJ8+kJsZr4j0FXLew/8o6PcfZSAK0InaRJOtrOu9QS+68N9nS9PpdVIY8sfkQMcWoyXku/P0bOpnaO8wPU/207S2nopZZTzwkccZ3DnM+k+speWEBtyMR7YrR1AIWPOe5bScXB9yt4rJfjQV4fGrNrHntiN87MoWvvDZJIGfKck3zFTvwSQvUqIuMmEu84SYvSRwf47gYLgTm2L4lUThyOzUU3J+0+/kxOpbCDTsT89l0E+IJQpH6SLOFGYSUaUlryvl90cuNXXRwyyueFK0iaOeSZPUPPOmwHSzSKdsBmFehPgMBRXmFffdwJ7scpnxkovEbd/FU9fcSqqxnLpV1bhpNzQSE4bQ2guFHmJVMfb9+RDtD3Yx78KZnP7V42k6qYFFl83hmFfO4amf7+WhK5/Ay/gkmxLMOCs0EF1KgFRC1YJyOXRLhzGa9VbK/sU/qsr+DzWQqBP5Ni7rymYngpXvWWy5WW+sT6D0mdo3tKyvp2F1Hb1bBujfMcihuzvo3dTP4Xs7WfWOpcy5qJWyOSlmndPCzLNbWHjpHKoWlZEv9kyjDbHqKBu/sJVdNx3ine9p5nOfSeF7WazRqVElw8dkusU9ZjQydeLspNU1hXtl5G/BXhNDsWKtfZS9G5g4mBgN8XY5o/5Gzqz7i5RZneZwrk26czVGiRJH+cV5chYxy2PEj3Js5UOsrHxEjElMzUemm004YdGbqWHYM6F5Y0Zi4UiaDYOnciQ7TxxfU3vuy/E7nzY7rrlVyptS1KyowhvxQuWZ4mkrW/BGgjAiyAesfe9ynCqbVHOCSMzmwY89yVO/2I3RhuZ19Zz25eOI10XJdhWIljvhBC4lBPmAZGtCgryvex8biNsxu8HNuTf8bzGQUB60LHaCZdlfD3J+sOI9x9ipmXH8MaRp0r0ScEc8Um0J5rywlXxfgZ7N/QztG6F8RooTProSN+9RGHDRnsFO2IiCIB8WGHWgSdTG2fatp9n+231c/sYmvv2NMnwvjSoah4z2YU9Y2PKMNY6pSFZpfjI5BDPPrrR0FGKWktIqfVKqo32sq7mLFzf9lub4ftORq+dIrkUCo0jYHjnfYl5ys3xq6TsQkxIpRajMJOOfZvKnGfvaz/C8yadVfFttFLbKy9yyHfyh/dUSETAFTcU5lzKw/zB7fnyT1M6touqY8rHBQAawI4p8d4GnfrmbttOamfuyGYjA4PZh7v3Ao3Q93gvA4lfNY+0Hl6Giinvf9yi7fr2fuRfMxKjRRisICpraZZWq88HewB30V8SqYre4GffQ3zth/0cYiAAmmor/KsgGMxuOrzULXztbFYaL2kqMt1uObS2ETTp+zgdLmHVOC6nGJF2P95LrzdPxcDd1S6pJtSYJCsXuNxMKxmkvrHPs/80Bnvj+Di57VT0//VEFgZ/Gssar4lOjC5kI4UpJ8jrFOKZJzEWmxvVTM//pjWNC/cJMW6XXOGhTJnHbl6UVD8tLW34j81MbTU++miO5uQy6wkcWvo8FZU+JnkxFEZlmqmfJ9x3lak1wjjJx+Pro66TkWsmoMWu0SVAXPciTg2vYMrAI37ck5nXKu149QG7zw3LPD/cw4/h64s0JgnzYMh0UNMmWOPGaOG1nNFLRlmTP7w7x4CefJNebJ1oZ5YT/WsX8S2aR7Qub3DIH87Q/2ImfDZhxZnNIRbEU2jdEym0ilY5pv6NbqQjHuDnvRxxdG/9fwkAsQMcr4xdYqA8YbYJV7z/GsiudIm1k3J3bCTtEYwODKWpXgWACcDMetSuqaDmhgb7tg/Q/PcTeGw+Rak1Svai82Esd8rdi1VE67+vmgU9tZP3Jlfz2N3VYkg6Ld2q6ZWomIU7TeIlJulLTL+yjhCXmb1XezTTK1DKN9zIT8hRbFPPKtsiFLdczP/UkDZFOXjX7Z4iJi5pOIaF06qhMqrOImfp9RcY9z9G+WskuoRGUuCTsEQ5lmvmP2V+TDy/8CKfX/VHOO7+FW27JseH6Qyw4txWVsEM+nB0W/WqXV2JFLR748BPs+PVeTGCoXVrNKZ8/jpql5WR7C1iOhV8IaFnfQP/WQQ7ccYTGVbWk2pJh5GALXt6nakG56t86GGQO5Wcma5Ib85n8jr+nF7H+zp4DTj3VinW3XxcMB/WtZzea2S9tVe7QeMXcmFBQbWhPGidmE0mGosp23C5qUimUY+FlPWJ1Ueac20ah12Vof5pFL58TymD6BnQ4/CZ7MMvd732UGW0Jbrm52VRVjojWBkv9rSkapmRRTMohjEyfe0z6u+HoQ26mXWWm1Es9myKfFA0l1MwKTBxFRGannpKT6m4XZeJy1FHRU+Y/TyryHK1xxTDREx3l+4XGG5U5yYNc0vZzWV75CEkHPC9BWSrHi86r4+c/6Gf/A73Mv7AN39NhAVIJQS7Acmx2/XY/+b4CCy+ezfEfX4lKKNxhD8tRBJ5BLEjURMkeydO1sXdsFqRfHBuBActRJJri5vCtnYKwxD3e/QEH/n5iD39PA7GBIDnQe4kl1lslInrV+xdbElVjG5MOTKj9unmAu97xMHtvPMjBO9rpfLib3q0DpA9kyPXk8TM+ijDxVhFF04kNNK2vo2pBGW4mKA6XFBSK+97/GP6gx01/bWPRwrz4nsa25Vl0dsvEnXUMoZJnfv50OYocJYCfPEhaeEav8bfQMKUMhtF6ShwpklWYrur/TO8/Xd0DmZam8rcq9AYRY6J4ugJDKCzheUJNtea49XV85wud5Ptc5pzdTCEzKuYgWHGLupXV1B5TxeLXzSM/4hZHaYftt/HqKDqjeeKr23jq2j0Ybcj25LEjFk0n1IVzHYvtweWzU2pw54hO7800xdOJHYVMYcvfC/b9e6q7a0ApS97vj/hmxvlNlM9JkunNYxWLgqNq4Juv2RnK6FREGOnIMrQ/Pe3aiJZHEFuY/7LZZvHr50quK49yQmZuojbG45/ZSv/uYb53zWyOO9bDdz1sJyTOyZQ4nKNUjc3UirhM2oUnzx0YnXor0+Qq08Zbf6uOZZ4Bm530NAMiGjXlNWbCd57IJTMTvWIpq7DUs8jf6OOdBogISyV5IvSOgUhWJOQQnro+wk++m+K1b9pP3aJyZr60lVyvi+UovIxHsjlG+awkmZ58qHCi9Zis6cFbO9hyzQ4ynVkA5r90Fu0Pd7P1x7toOrGeZFsiLCCqUOFm/iUz6N3Qb7QbvB+4/u9VE/l7GUjYJVgZf4nSrCKmgtkXtlpezh8vzDHeclm7uJKBHYM0HdvAmvcuYWDXIPnuAl42YPcfDtCzuY9IeaQ4vsBm1jnN4g6Eeryjw28O/bWdnX85wL+9up43/ocVwrm2mn5tjZY3dMg4FWWYtgBgpoc1JybrMqVs8mwgq2dJEZ6ENMkY3SRc4GFHIKJL1EKm58fIdFLwY8YyydilFP2aDGIc3aC1sVCSZevAAnPtwTdSFs2iizy1QFv4ro91TjNzXnotj3zh11K1tJpEa2ysnyQo6HFk0xKS1XEGtg+x+XtP07GhG4DqhZWseOsxtJ3ZyM5f7TMPf2ajPPm17Zz6pePwCdt0/YxP9bIKq/bY6qDrod6VqZrU+em+9B8ZHwv+P24gYeSqrHf4aW2az6qnbF4qHGrjjO/kSsDP+6x+1xLSR7Ls/uM+EvURlr1lEfmBApFEhO2/2E2yMcGZ3zsxfI0lWDFFkA9bPu24RaErz6Nf28asOWV882vV6GAkhHPHdk+ZeH9HQZhR1q7+G1HUs4peJxEYnzFBP5rVjtdUwvWpwt+FkDpPgIgH5EFCWUdNSnJ+lITlI2OwvxzlO5hpN4GxEGws/5rma5UaCyXFUTFTeDaexPnNkdcSd0LK1CiDXhsk6IOmD5xtOp/YxMOfeIyzfnJa8VxKGAvFRb71uv08de0egkI4Cm7xq+ez8LLZYBn6dw0x4+xm2XXDAbqe6OXgnR20vaApnPGiINCG2S9tpfuhPoyvPwT8+e+Rh1h/J++hExWJ1bayrtKBZtnbFliR6iI9oLTttKgLG/iamae30H5/FwfvbCeSjNB6ciMPXfkkHQ93c9Jn1lA+J4X2ApQVutDQBRti5REe+9QW+nYPcd11M1i6tEAQaCyL6bmDMj6fsPcw9B8xlNdISanATM+xmjamn/wEFYLyoyqHMpmgNRUwNii0UYTqWOFrldKIuIhkUTKCkhwiHhk/Rnuuia1DS7ij+zxuOPwqvrrrA/QVKuXE2tuLnYZ6+jBOeI4ea5p8anKOIhMrjmFXcUAuSHBz50USj0SI2gExSxN1jMRsTRwPE4lJ1Yo17PvRd8A3tJ7aWOwcDMckRModDt7czqbvPoUJDPUralj/qdXMOLuJ/Ig7RlhUEUWiLk7VvHJmnNVEMDZMVOG7AeVtCdW3cVDnOvJtkcrovV7O2/f/imj93XIQS+TNOuurqqXlfuXicuWmp6maF3cN7WmspGL9J9dw25vu54mvbyXIB+z54wFmvqCVxuPqSHeHIVMoEi0hpFsVpf22dg480MEb39TEOWebMO+wJxVQzcR1KjaAw28/OcRIV4H3/7kWwQct0ySsTER65Oj7iiGNMW4xL4ggxEEsDAEmbIoag2xFDCIBggviEWqhaUDh6YTpyNfLoewM9qQXmX2ZBRzKLqA9P4N+t0myOokPOArJBbAwv2uMnzWFVzXBk5TmG2aS5zNThd2E6RG+aUvx4x7FDaJ4JmVEW2LEFNuHZQyy1EMeieUnMPPy95rtP/yitJ7aQtncWNizbgnusMu8C2fQ8Ug3NQsqWXL5fHzPJ1PMOUe1BLwRj7rVVTStrw1V9ksiASlqC7ed36R7Nw8qR6u3A3f+T+cgElbNy2qUMhd5fsDM85qtUZudEOHo8Y4zZSnctE9qdoJ1H13J/R9+jI3f3k6sOsrKty4iN5gfkxsdvc4qovCHPR771tM0t8S5+qpytM4UeV1m2s1y1Et07w2DE8sL8DPaHN4Roi+tC56hZGGO9gcbTIaAAEvWIGpZ+En6KXyzRWyGjag4Iq6Aa0KBagEikvbKTXd+Jh35GTw10sKu4QYOZOfSnl2CJ60UdBn5kJNnIgosBbYF5bYOE3MJcHzFkFdpwB6fwjMdOibmKNBtyYI3k4iJ020yEwxoYkEo3ADy7E4fQ0FHSao8vrHRUoQQikCJ2BZuf0DL5Z+g55YbeOKLT3D6908JN4liq7Gb8zjxylWoqCI/XMAUZV/HOhWLG56fD/CKyfmo6ByERWN3xKfx+For1ZYw2a7cC8vbyucOHxrew/gYv3+6gViAr2z1Mu0F1YnWeNCwrtby0hNnQ2htiJQ5xcfCaUPKEnL9BVpPb2T55YvY/MMdoacAbEfhByWKh4EhVhVl45eeItuT5Vs/nUVVVQHfM9j2UcJ/E1alA23z8/8aMgNHPLLdnpicL1e9sJNFZ8R4+w/LikY0DWFJppshG0HrfoxZjGV/hby/whwe7hMlMLOiEds6APqzdGXukmG/1hzKzmRXeq45kJ0rR3LzTHdhDoN+He25KEsr4PR6WFaD7BrC3NYFngloSBgCjQQl8xZH/ZCno4z40JFrFnCMjGFyZmqeMeYpZOqFMZMr7CWTQidD0tNuFhOTk4d7jyfrARILNQRsiCiNEBAgaELBDGMnZc77vmy2vvNC2f/nQ8y+sJV8f77IpQNfa8QLUBFrahlGJgOOgrIJRzsUo0zta2I1MWk6tdbf9bP9MZOzLwc+/P9iIP+vPHoF6Iqa1APeUHDinEvagqVvnW/l+vLjhUFtiFRE6bivi4N3tFMxp4y5F87EKIP2AoyBZE2chz72JAfvbqf5xHpO+MRqfM8vKmKE3KvcgQw3Xf4g646r5P77q8FkwsRcjgKvFheGAbyCQjm2+e5/9MrQQcNbr22gvDqPsiaTD4vIkRndHcepFeHosT7gDET9yvxyx23yh72/pD/fh0JoSDTxghkv49KFF5lHu/p4y2MOOatc4pHwO0QEohZm0NXyX8coLptRME92Pkh/vldmVy4yqdgyrn4KbuzwpSZuE7EMvoGCL+QDUGCqnV7mpbayvvqvvHr2L7BH1aannL6ZCt+a6ZgEZuLg0+lSp1IvJNMwD9B05arN/lwrW4dW8ljvKezMrqDfb8EzYVgYtcCSAB342DURdrzrAkYevYlzrz8brFCYLmzKErx0EFbKnVA8XOtQMnY8WA1ZwX5B4w24VC+uBCdc/kaH04QzhzP6/nc8qYyY/Zny7GIOk38GPP0fZiChKntVcollZKN2jXXCl1dKxfxUOGdbBB1oohUR2u/t5oGPPT72wtplVZz13ZMIggATaKyowh/W3Paf9zN8IM1JVx9L4/G1+GkvHMdcHeHBD27k4H2d3Hb7PM46s4Dv+dj2VM8xFlqbIkFcwvEFyra45q0jdO8J+MjNdeggD1gYkTHUyyIIBQ7C0ChsbscGEmYob0g6p+CaH/Dxhz/Hve23SEWsDseyEQOFwGPEHWZm2Rzz/lXvpjq5hjdvKNAeKKmNCoER2jOaq5Y7nF69j3c88Cnz9NBusQ0osTil6UTeteI/zZMjM/jE5hzDJi5lEcys2EY5tvoec2zlg3JMxTYa4+3Fs0yFs9WmxRSno/TLJG4WR2f6TqejOkbvn64SH6rLh3mVbQYKdbJ9eLF5Yug4Ng6ul6dHlplBtwoNEouD1b+TjRcdw/yLZ7DiPUvJducQS7BjFkN70tz+xgfG39oKhRuOdix5zXyW/OeCcOSbJcWk32bDhzcHPY/2W1a586KR3pG//nchX/v/1UBE5GKT13bFgjK/Yn7K9krEwsLk2rD5e08hljDzjBZ6tvXTu2WAx67eSm4gh5f1aDujmQWXzGLNu5bw1K/20ryujkImnJ/kpGz6Ng1w8L5OXnhuLWedCYHvYReVNKaV+zSmSLM2aK0IjKCNjZvR+MWLraQAyi/e1JDoZ3SSvkKl6cw1sD832xxIz+FAehG7RubQECk3Xzl2Nlfc9wHZ0v+oNKRm4BsvnB0CxOwoqWgTg26fvP3ed/Pmxa8x162/nI9tgVu7tXGNkU8c4/Ci+iNcfMu7yfpD0pKoLlbGDfd3Pshj3U/KR9b8p7nhpJfwxyOPmVPr38Ix5e3GUkMS3qooxqTQRsSSYPqapClZ+Wa6YqOZHoyY0KZrjg5pm6kolzERtImNUmOkKjLM+rq7ZX3d7UDEtGeb2D60lEf6Tjab+tdyZMY6qv79o+z4ySdl1gWziTc7BHmNlwuoWlDOgktmM7R7BBMYujf1YUUVs180g2jKCbPAiM2h+zsY2DPE07/bx9yXzQzH8unxdobm0+tN98P9Roy+GPjr/0SSHoTglVzku4b69TVixSy8TBA6XmNwUg49j/czcjjL6ncsZdmbF9LxUA93vu1Bdv9539gbdT/Rx+DTQxz74eWUzy/HLfhFWXywbYsdP9+PEuG/Pl4Z1gQmoTVhC7oKf4zBtgx/uCZHLK544atABSMgtnHEl0BHyARiukca6XBnSEeulYO5WWZvsJL2kWbpcZtlxK2hoK3RJMv4HvK10+Gbm6+SJ/s20JRsxPULKKWwlEUhcBnODpP3XWzLxlY2Vz3xdbm/4xHzX+s+wqn1TXja8KKGPt58z0dxdZryaDle4I0tspp4JYEJ+PAjX5SXzNrCh459I3CG8YPviK8bQk4WXjg+YYI8UWmVrwhtGTMN1cRMZfmO4eDTWJqZlJgbc9RKu2CwZHxSVtgxWU5RvF+aEz00J27mrKa/oIMoB/PzzdaPLOQVv46x5ftPcdLn1pDNhLmIm/FZ/pZFiAjR8ij3f/BRDt7ezjGvnEuyqOSf3Z9j918OoH3DrHObiZQ7eJlRFZRwynD9cTUq0RiT3EDhvKo5VRUDeweG/jtMX/v/KfeorVhhfL3MTlqmcV2dNYoumGLuYUUsdv/xAJGKCHNeMoP+PYMkGmNYMYXlRFl/1Vp0PmDD5zaz58ZDLLxsLrH6CEE+vNhO0qZ/cz+HHurkRefVccI68P0AURa+kTHGq4iPUAAKhowrnQcSbL3XoDxjWs5YItvdpXSxgKczvzNe1x556UO30Z9pIKcTuBqMBYn9uzAL5puohUQciBMQUXA47ctXV0fZ1/dn+fWem2hONuAGHkrZpPMj5LwcbeWtrGtbx5LqxZRTjvGEQi5PX6GPHb17zMWzZwKY6/Y+xKaeTVRGy0VbxTDUaGxlM+KNUAhyJKIRfrHnWu5qf5Srjv+qrG1YbtDvwOCISLwYypQACeMFPZnoFaYZ5VbqZUzJ66cUEku9zzNRlqevMoYzUIKxvNjoCNpEAYUlmlnR3TJr3gHzxjfV8JWvHGF4xyDxWalwzJ4S3LSHCcDL+yz9j4UcuP0IT3x1G6d+5TgGd6W56+0PkuvN03Z6M8d9cDm54cIYU1wkrJvFq6OqZkVVcPDWjgYv7Z0GjFbW/X+agejAf4nJI1XLy/3UzITtjnjF4SshybDQW6DjwS7mXDATFQHlhQ0zhX6XlW9dQsNx1SDCjEeb2HHdHtxBj0RjlIBwgKXlKHb97hCgeOe7q4EstnJBldQRTIRht9wcys6mvTCDu3cuNw9/YzO1m+6hUL+AG3/9HtO34DyyVUqW55401cHTpsufJVZUSEpAytFYgwdkxhdPM+2fvplC8zForbCVojNneFFD1Kwr3ycvu/kb1CYqMBgKfp6RbIZj29Zy/uzzaM43mac27OChex5k2/at9PX3y8jICPFonEgiQl1roxx33Drz0pdcwB9eegPX7fy1uXHHjRKLxkhGkvRm+1hSvZAXz76EukQrw4VBc++Ru+SD972Ri+a/jsuXXE9UvQ1j2hGqivCoKaFWyThYMQG5MlP3SzMN2jU55pqWDTy5+hoakplkmaX4wCjULBB6PQnDyYAYYoxccUWKa77rsOXn+1j/mZXhOOniCGwUBIWAVGuceRfOZNfv9tPz6ACPfX0Lud48NUuqWPfR5eSHCxCEo+PGMYkwF6k/ococurXD4POyooGYf1aIFWAQqjlXuwENJ9SIlNQrtTZEyyMcerAD7RvmvXgmYisiCZvDGztAoO3MJtJdOWLlEQI/3GliVU44SAWw4zbZgzkO3NfFScdFzNln9FLwhC63UfZn5ps96TnszczjQHYhHe5s6S20kA1sbBvU1ZiyN50tpqyWwvkvpmZ/lgonQjzoEx1AXGfxVZzAUkS799D21bfiZAek9vOX03XFt/EXrCGf1tQ6hk8tgw8/8AWM8olKiiPDR5hXNYdPrr/SWHstfvZfP+U3f/iN9A30HaVpFdgMt9x0k3zmk1eaiy+8WD74wQ9x/rnnmivv+4xs79/OZfMvMR889mM4qlNgM2DJOTMuoz/3Bn69+y75yVO+uWTBDabC+TjwVxGqQmDBBMUFEWCMjYyGOTINVeRooRY8Q6Y+maRYHABkZMLM9+lY9VMF7cYha0uFbIq2Np9XvLKKH/ygk+yBNFZdDF0Yn46rLEVh2GXhxXPYf/Nhbn/H/RjfkGpOcvJVawkCXZztohidVjXKafJzAVXHVFjR6ogEOf+c6nnV5f27+4efa5hl/7fDq8aKWVoHy+2kRc2KKjVKOhvdpSxRHLy9HbGEfTceoiXbQMOaOo7c00XN0mqSLXGGD6dBQ+/mfhINMeKNMdysj9HgJGx233EA7XkkX/YurtjxAvZ21tHnzzQjQRVukdvlWIitIOpAPBJg/ABvwBZH++h0P3pEE4iDhY2THyaSHiaSHsCvTqJcH7dxAUfeeKWZ9Y710v+uL+DPX22svJEBV/OT9Q637PuZPNy7hZZEDUcGj/Cqla/kRYlz+fpHvsa3fvCtsTKFZVkyGjJRrK2EMLSM/fi+L9ffcD3X//56PvTuD/H1j3zV/P7QH3nj4teJI9/C05/CIlcM/+NUxxfw5mWvNBlvBbAIJb8WY76I4dNhXEglIlnSXoRUJIvWiWJnYckCncDk5RkYx5M4ZaWvLRrbKASu1AjgYHQceUZRbTPtcpTRXd4UePs7yvjRD3rY+9d2lr55AdlscS57iQOM1ceIlEfwOrLEa2Oc/MVjsVIKPxtSkcYLl2bsvQNXE6+PSdXict11f1+9DPknAjcX12/wXBb7f8dAMIE5Qbs6mpyZCFKtCQmKY7uMDmcFDu0ZovuJXkxgePp3e7nzrQ/xl1fcSfeWPqJJh0JXgYrWJO6Ay8DOoVA1MarGBtv76YB9N+4nVlFN54qPcGv7C+SQXim+UyXJuJbquC+VMV/idoAtGm0MXqAIsMKv6Pqo7IiJoshpoWfQJZ0NcPM+QwP9BkAV5537khJjg2eVY6GkI+PzsSUOZXqL+fqWn5u6SAXdQ7184azPsnjvMea0E0/jW9d8SwQRywonTAVBgO/76ECP/d/zPFzXpVAokM/n8f0w/LWUxWe/9Fl5yVkXcFH5RTh22njex3EkipJaLFWLpaIYvYPAv0KS9osl6bwDw30g70XUPSZgjdEcMtuHZ5nLHv6j2T081yg1iG8cJgwYPBptHqbhcMlUwKv4FF30HEr18vmnPmju6DzFiBokMPbRYWaOys/EUoLRAcuXwRmn1/D0H9sJhr1QALDEczkRi4evfIJMRxYnbnPyZ9eSaokzWow2poh2m/EQzxSFAw3QcEKNNtoYQZ/73ylt/Hc8yOhpvlB7hqollcaKW3h5f0z2U7sapzrKC35wEgPbB+l8rI/uJ3sZLvZ9tD/cxY2vuJOm4+vQfggHt53REg5pAZykQ+fD/Yx052i95JWmvKFCvL4C2DaGELYNd9Dx3UPGdkAFHliBi5UbpHdEs6LMNq+dCYt+/XucfE7u9Or4YkdgkpYSG1AEWKJIimd2ZI28ssXm0uZ+8/KbPyOWQC6X5pvnfo2HrnmId7z/7QJg2za+7xMEwQSeGUAQBFTX1HDOOeewZvVqlFIMDw/z1FNP8eijj7J3714AHnviMTn2lFXm9tseZtHCN5nA/6ZYVi0hPQVEElhWCshhzE8FfoHIWqP1+4BbUep6frB7AY8MrJQ3PvFLfnTsK8ys5NPi6xpscaf2fkwIs6ZDsKYPyQJtYSkfVNp8fdfHuObAB+We3h1mVfWTptLJy9RBP/KMw31Gn6O1oCyXt11Rzu0X9NL5SB9NpzdQGAyBiGhFhMe/sI3D93aiHMX6T6+lcmE5+YFCkYYyGtKZqYQBJQR5TfWSCuWU2aIL+kxejsVvnlst5LkaiDBaPTOcICLULC1XJjBjaiGjp68sIV4fJTWjmZnnteAOePRtH6L94S66H+tj+GCag3eGwx8r51ZQMafMFDKuiApjz4O3HEaAmhe+WnwXAmWhStuEpERfpBThRHAEckP9mKE+PtWGObmuWx448hfzjf7tpCKVvHPxq2V+U5l584Y8gW1RowMkq9k/mOeFK4XPLvJ5yz0fl95CF5YRvn7O17jhM781n/rip8WyQiX6UW9QahyjCvXveOc7+dCHPkRjQ8OUC5jL53jwwQf50Q9/xG+uv54jh9rlZRddYB555HYSsdsx+gCiosXLHIwRGsPk3GD0EwIXGpsTua/7Zvn4cotzWnLm80/P5aIHfseP1r6cldVPYXQtIn7o0ifkBWYqODWhxjHxbvvGwbYyZH2Hj2//Pn/pfAWtyQIHc4vkK7uu5FNL3khgGlD4EzQfmK5ZSyaibJYlGONzzgvitDZEeeqGQ7Se2Tie3CsVhk1KOOVzx9FwXA3Zvjz22OwRxqhCMoE1EOYjgatJNiakbHaCgR0jC8seKJs7wsjO50I9sf4b4ZUpryufg6c/rCJizX/lLKyYJeipF9wEBj+nx6ails1K0by+nlkvbKXl5EYqZ5fj5zWtpzZSt7pa/KyPilj4QwGbvraZxMwFtL7xM/i58Vh+4v2bSKQzBmxLGBzK0LrvAT799e9gVWyXDzz4MW7veFAG8r2yu+9pbth9G5fOWSyXzmwzjw0hI/t2E91+J69923v4wPIoH7rvI/Joz0aswPC50z9j/nDVH/jMlz4jjuOE1X9jphiHiBCLxfjVtdfynne/m1Qqhed5BFoTBAGBDtBaE4lGmTN7Di972cs4/YwzzK5du3j88Q0yPKLkvPPfbXTwQ1EqOU1sMtqXnsCyCnx/33m8e+Mp8nifYUW5LVcs8JiRqOGbu19OytrInNTjYGwRiZZE0qakJ36cycVRIi7BoFQfe9LH8PaNvzIP9L9AqmO+uNohYQdsHFjF3OQOM7/sSdGkUARHb9Kf3EdSXNRBAJGoor3D5o7f9zL7nCbsMmesRaF8RpKmY+tpPrmebE8eK6LGictjNDKZtrBpAoNTZsvw/rQ/sHnYjiSdzfl04YnRFo1/BNXEBvzy2vJLdca/rmxOMjjxK6utwNUTWpqP5tWNNmHl2RacuIUds8PxzYUAHYQcm2hFlCN39fDgxzcw5z8/QNObrsbt91CWXYKDmBIDGQ97HYG+guGM8qy5eo3Dj3f+SH665efUJKuIWjaBDlBikfdzuL5w1boPcFLr6XSlDXE7YMjfx8cf+jy7RvbguXneuPYNpH8/Yt75/nfiOI54njf9LmNZBEHA9b/5DS+/+GLyhQKObRdBi6ksWa1DI3OcCFoHfOQjH+Xqq69mw6NbzbFrvyiB/ycsq6IEsg+3d99EsFUPt3ZewBUbf2kqY0YyHoy4MD9pzOtm+5za4MjOIWOWll9LVew7gtlSvEpJQtKSGguxJgJdUuKxQplTX3zz5+6L+OrWT5CVWonbHr5xEBMSSQOUKZeDXH/8GVIVzYKxpp9dUpoLTUK5ggAsW9i4KcbqlXtY9baFzL9sDvn+UJlROQrlKNy0V0zImd5TTYGxw44tp8ym4/4e/8krt9t2ufXTob70a58L7eS/B/MavU67mvJ5KWPFrTEPMSbWV7IoJrCllRTVRgxeJsBNFwUYZJzKIEroeKATQSg74QKC3MSRwiJm2pzTVjBYMCxLBXzz+Lh87IGPmpsP3UlLRSO+DtDFLcnXPhHbwVKaDzz0SRZXX8/sijaGvDSPdD6OEBC3IrTVNZu5vXM564NnimVZU0KqycZxxXvebV5+8cWSy+eIRCJGSjWOJtXWlBU6bs8P5zJ+9rOfpaw8ZT78oY/Ibbd9HvjLlNgnMA626uWx/hPNh7Z8XypiRrQxxG1F0oHuAPnoNpvG3QEfW3aA6viZ+OaVWPIo2vwQZW4BekqQKinpSBxt+ooADoHRWFYZP9n0Nj6z543UznGwspDHQQLQtsIJIKI96fJm8NmnP80Xlr/RBKZqKgVm7MZOAgyKSXjIn9IsW2qzZGGK3bd0seDSOWPyS4GnCVw9ZhxHrcuMrTczQaQ7cA3lc1PKSdn4Bb286DSfNbP3v9NRaCLx6Ad0Qc+e8aJmU7moXAX5YGz2+ARO3LQgeXHvLwpNT1BatBSmYNjyjU04NbNoecNn0J41Lqk/BZiUsZPI+1ApHjec7PDdTV/jd/v+LK2VzQRGE+iAfOBiMEQsZyytj0didOQ6eWpwJ0cyR0g6URJ2nO6RHt5/3HvlK1d8lR27nxKlFFpPvaZKhdSW2XPmcP3114tSiiKqJVI8R3mGEQlKhZ2Inudy+mmny2OP349SbWb+ggiBfkiUJIGAwNhYaogtQyt4+5PXYlSVKDHoYuhkMNgClTFDr2ebFze8VmanPoLWm0TJLET+A+SNiDrdIEvQeo1oTkRYA7IMOB70GqAihHER0BazEkkZ+tCnJOjpEr2gjbo7fkzd7T8hNn8Gsz5xCQNrXmQilSnZ2r+UWcm9srDsMbwgRUiTMyXAxTTkyJLLEvhgO0JXt8Wtv+9jztnNWOURCEwo/DfaV3K0/rXRhWdKR8mNioRoouUROu7vlkKfW1n23fKf5kZywzxLmdLnAvMKoBsaGpJoFipHUTYrKYGnJ1CrZVLoLKakp8eY6VQwR3FE7Khi5ECWzIBP5XEnIakoJgim5c2NFZ6KrN2C6/GDdREePvJXfrbrt8yoaCHvF+jJDWApm2XVc2lO1tNbGDSFwMVSFtoEpJwENdFKyiMpLLHozfVx5rwzqO+q48Zb/oxSagJSNZ2BvPMd7yCVTBJojRobxF6U6PlbF1VCRCwIAj75yU+xddsONK9HJAHoonGkOZidwduf+IVxTQOOCtBGjUk6hO+jGXAtTqu9VU5veBAdxMWSm4HLwKwF82GMTovRrxRlvQ/Leh/I24D3gHk9mHMQdRbKbkUkhglyVFfexSVvbzBt3/+YOfE/VzD3px9i1sM/YfkbV1JxZCNBWTnGh2QEvr7nE2aI2caxA3QxsZZSsXA1XUfieGQBLi98URLQdG/qJxK3wia7krrJRIbkNN1tpbvyqMayNlgJSyrml2njE/cDf+lzSS/s52ggJuNlZhjfNDpJi0RdTEaHNY52UxyttduU8PmnVliLc0KiNj2bBzFAxdrTjWiEo4wKG/3XUtCdC/jkMocqtddcvuEr0piqpb8wREwl+OCqt7Cu7lTTn6+gIpqmM7eZLz/xIw5mD1MTr8bXPhqNJRZe4GJp4QNr3sd3r/oOBiOWsqb1HsXCH8lkkpdedFH4/S01gb80Pv1v/ByNCWNjIwZLLJSlUKIIdEBlRRWzZtbJ5k0Fs3LFSgJ/E5at6XXLzTs3/UpGghkSs30CY03ZZUJfFfD62d8ofrggkgKTApMF+RWY6zC0cuTpRqoaFhJPLUIsC1QaTC+ZgRF2b8mZZScaEdslcIdZdd4qeeBlpxgVDFNZX0Yh49G6Yg6/nHmFGZEUMS/87M6ggW//9TJzYfmPWXRiTgZ7oyBQWZ0F5eDmDZFIMDXkLLYkgGHVSkVbQ4z993Yx+4LWKXnmlK6paboeDaaoN1yixayhYl5Ko43C12uLBcNnZSDP1YMgSuaKRkWqnSBSGZFRrr4poR2YCamleQZIYFISq4W+jT2IKBILj0UXwqmrU2tQYUXXEmHYhXWVhle0uuY9D14l0aiiNzfI7LJZ/PjMr5vqsleYKzbWcNlDMV50d5JHhs7iG6f9ypzcdAbtmSP42kOJkPUyjBSyfPrEq6m2Ks0td94+tqiP5j0A1qxZY2a0tZkQAFCTRgWEDT+jHshSFrZl4zgOETuCZVn4gTZ5t0A2l8N1XVatXs7WrYcwLAMZIu1HzVuf+CV70kuIOz6+tqZsLpZo0p4yJ1bfwdqq+9E6WVRDCYq8LQVUg1QgVpJvXv4Yv3jfbxH7z1z7X5/nCy/5BplC2vziQ7fyrVfeIrlssxGrEayZJtCGVS+ay/4HdrLphvt46g8Ps+mmjfitC6iJFWipyZtYvGDee8zteJ/8otzynTQic7nq/E6+/7ZhkFl8/fVDXP9ZDSqCDvTEBV7kkfmeIRZzOeWMJF2PD+EPjw7iGV1FpUNCzXheU0KFMdPOpQ/zmLJZCZGoYHyz8rk0Tz1XD4KC+X5gSDTGjRVT+MPBhPbaCY1sHIXyM0GYrdgwaofD4wd39JBonWucpnkErmHqEMGiORZhXe37XLXc4afbr5EdQ6Eg3YVtp/LWlR8yH98S51cHoToeYVbNIZkR2Wpy7t1oHK4+8T3m2p3r5Lpd15iMN0RTvI13Hv8xOa6xg/7BJ9m960B46Y9iIKMu/7jjjgMQrXXYOmoEYwKCQBNxImPomzaafQcPsO9Ih9nx5BN0dXejlCKXy5FIJEx1TRU60OJ7rnly837+7RVnGLG+yvse/w7bhk+QyoiPN2ku4XjeL2gDr5xxTTFNNagpHKqgSKHziVrC03/u4rNn3Ge6n85JfhC+cPoPSR8pUFsdZ+djCW7+3E4IlLjuPnPWe14sNTOr6d6eJVoGPU9sZ9mV50vj/kNGvID5F50ON+wh2zkg+QHDVWcOmOyuvHS1Z7jq9BH2Ppjn2NcmTTHlnaRvX0qFCTjzBQnzy2v7GdqbkfJFFWPicGMAzWSamYyK+JWoTI6N4ZOxekiiJSGRcgc37R9jjBER+UehWGqh8T3iTdEic3e8YFc6YU+mjb9Leg1kPLHCgBVRZDsLZAZ8Gk5YIyoexc95iG1PyvzD93EEunIBb5pt4wR7zDVPXS/G+Lxp4es4deYbuPAhMMFWPrrkDjmh+lazoHwbZc7AqGKT+MEfzWULvmJePOsndOeGmJmqxrJ+hDY/Y2jwJ/T2dD6jBxl9fM3ataOiVhhj0EGA40TAgkw2w0MPPWweefhh6ejqNmawl2DT42b9Bz7MCSeuk/r6eiqrqsSyFLZlh3QUT8tXvvY98/TWnLmr9lfq1s5zTUuZj6vt8bbTErasQpMOLNZUPygn1tyDnjBPfdIuZQxiApqW15tUVTXxeFyqZgRYjsLNamlaGKBtiEXLJRGvJBoz7LzviAx1Z3DiEZyyBE5MiFXYLFxTQbk5KMMDOebNGmb/wzlTNqPa1M2pF68QSM1LQnTP+B5zTk2TqEiEieYklUqZsOEErDs+LpZAz+YBqldW4WX+hjZlifidmfTGUrQk7RucMkeiNRHcIb9txqLaJqD92RAXn4uBhF9FBy3GGJJNCTGmlK1gSuDdEksenRuoJlKwpUS+0+jiwMcDYf6RWryGIuevRDvBTLjnBQ1NEc3b5lvmA/d9h363h6vXfYZlDS/iR3uv40OLrpUz655AZJCwIzyO1lVog1iisKVbfP+lpOy1pCraDP4O8d1N2JH1uAWfIPCfMUbVOuRcLVy4oFg30ESUhaUstmzdzG9+8zu6OjvNrNkzOW7dSpavXC4NiTj3veBkWXXcKlLzlmFMAdfziUaigEUqGQHgwvNO5Yc33SPbX/QBaqK+eNoONxxTWnOTYksxBBpeO+MbKPEIdBwxfsi4FdA6dMLGaEQsgkIf//mNxTxxe0K2/LULyzEYHRCrBKI2L//whebQ5i2y+t9WmHjSkebj5hKPCcecvZI5J/mYQKMCi+rmchr/7XSCIIOXM5z8mnUyc9XLzR+/eAe6kMdSPkGgybge53zkbFpnb8B327EsGx2EUV8o6RSyv0c1yubOVbTUR+naPMiiZwA2Spn84wL24410E9pctMGO2RKvi5mRXZmygf7C7KKB/E3i4nMxEF3c/BtFQbwhWhxpUJqgmAmdnsY3WDErnA2R1yGRz5IxZmipsp+yFCMHRwCIz1kecrRkomB0+PYGR0FPxueq1Q4bjvxV/nzgRr526jWcP7OeQ+nl5lPLDgG2oOMEpjYU6xeNwmdc5iCKbcUwZgsmeFKUFUdRDXjkC+mxvGE6DzJKK6murqa5pQVtNPFonM1bNvPNb3zTpNNpXnzB+fKuK95MdWUlGpd8oYAbLcec+2I2/PJnnPKxz+HmMiSS1ezdt5s//fFPdHZ1m8aGRjnnrNNkz/4jJpvxUcoaz/AmaQYrNBnfYmn54+ak2tvFmBSW+KGeXfE5lmVP2Lxsy4DZL7Z1DF7Bw7FjaB03ge9KdX0Tj/1lDze87zrwPdHFDT+fK9bx9bjet/aKU6Oi4ERAxOHiL72aZDRJR/sQthPBGPC9BPUNOWLxDiCk0IhlFf8Nd9BReVrta6IRn8XL4tz++AhBzkescTdoJhUJTWCwHIWKKgJXo8fqJTKhYGmKqpqJppg22liWMTOAB/6eIZYAZs1qnB07g1rlWMRqomK0HiszTemLVoZYWYT0oSzuoEdqZopIuUNh2As5OJOSdzHC8P4RRCychjkYn3H6fHGoTDiJ2KIrA6fVKE6rGTGn/v7zfPbEb3D+zGpx/dNMW8rF6CrRRqNEY02oRlNy8UZp6YkSoesckMdxLETZGO1O4FhNNpCW1lYa6uoB+OjHPsqjjz7GW97yJrnggvMQDLnCiGgCFHGEADc/wOorrqB/3yH8IE00nuITn/gEf/rTn7jgwpewYsUKfN83+w8cYWZVjH3th0g1zg6VJWVcWHV0V7JEKATwmhnfwlYenh/HsYSN9xpyQx5lNY7ZuzEn81bFePKvw5x4aSVb7smaMy5dIHuf9MyKc9fL47+9jWgyKrmMy8oLj+MPH/y+kPPABieWoKylnsqZjZQ3VSBljUYHiHGzuIM5vL5usgd3MdA5QKHg8YeP/VJe/b13mc5du8XNZyikNWtecqJ56Pe7ZcVZLTz4+wNmxZlJNt6RYd35KXnytgyL1iV46vGsOeb4GHOXBgKatevi3Hz7EIXePFZ1DOOaMWrKKN1KF1kXhb4CwzvTJJrjxBti5IYKqGlmmBoNsfqoKc6hmfdsod7nZCA7+uurhUyVnVBEKiIyOhSnVE/cFIlillg88ulNHLq7k8ANSNTFWfGWRbSd2UR+sIhQlODBOjBkDg8TraojWttI4IczKCwJCLDJ+BZeAAkHMz+xg6tXLOIzD18lr130NnPJvDr84CwTsRCjy0G8Yjoo0+AVk4fi6BLUKbTufD6NCTu3phUVGk3Q58yeTf/AAK+49BUsXbaYG2/8I44dZTjdQ3mqlsBX/PGvN+P7AWefcyYVZZUMZ4aoXjCfmJPkwx/5KJ+96mouf8Mb6O3p5dDBg9LW1mbOffuLyAx2c9/+x42aNUsC10zBzoWAjG+xuHwjZ9bfhDblKBOAWGy/O8+RbQXmnxiVh36dQRHn4Z+PMP/4Wh74SZ6Vp7ps+PUWWXa2xZbfbKOsBob6oKJtMU6ijpYT21hy9mwWnBjQNF8RTxTM1bv+y9ybPlHKI+GG6AimwmRoy3XIsn0PMfyn77Hn9gfY98gR2XrjNiwN6QGIVrbJwS1HaJhdbe797qDUNqXMfdcMS9vCCm6+eoCyq+I88MM0ltgyf7kCPFaujAOakfYsNQ0JvII/of6lfUO0MsL+mw6z6bs7KAwWiKQcFl02lwWvnI2X9oqCdGOa3+jAkGyOhSFdYGb/Q9i8ft9Qma2tlFhSRGyYIgNjgnCY5mNXb2P/rUdCKoklZHtyPHTlk1TMKSPRHCMomDFJSSlSk3PdWaJ1s4jEo+QzhpyxcQOocDKsKdtgTqq9m+OqbmRpxUU8tP9s2pJrzOVLl+L7J4mtHDCRkME6GScvbR4a5b+MBa5TW0+zmWEgCB3LUUIsgIULF/GJT3yC4084jk9e+SnyhSFcN0t5qo5f/uqXfOhDHzadnZ0iopgxo9X88Mc/4JT1J0kuN0zfQC9f/vJXuerqq9m3by/f+uY3ATjzBS/gkksvlTWrVmHd+yvU6RdPVAAtBuCWQM6Hy9quIWLlxNcxRoGZyjrFlqdz7M75RPIu22/spaLc8MhPOokaV37/0U1UNbdgRVwTr7AkXhMh7xeIJm1e94OX0DBrO0odBnpDio4eIOndxLbDJ9KQ8PHCOowYSYI9j8q581jx0Zez+uW/IXngTrAsEjUOWnxEF2iaX8vtX9xOdbnwxLW9klQBD/20m4oyzeYbepCsK7GEHuMQzpkb3o/04Tx1x6qxXGVU68BOWPTvGGLD1ZuKDIywj33zNTuI18WY8cLmUNTaGu9TN4EhUh4R5QhipG0sbfg7ehAqGyprMu1py45bxo6GwsOT03grosh05Dhwx+GxEMloE8718DRH7u9i8Wvn4ecKjOqeKUvw8gH5fo/UojbTh4MquLKkagtn1f3RnF7/J5mdPCShokkzvn4DlhOYy1fGReuzsZVtICKMGsfkhp0pnsRMJ8NY9CZRsjkzhcI+3RGNRcnksubd73mnuF7WgCXJRAXvuuJd5obf3SBf+cqX5JxzzzF9vYPcdfvtvP41r+dnv/ypOfH4E6W3/wCAWbfuOD70gQ/I8qVLzPLlSznllDMEAgLPZ77jmb1dvahkrYx65jCkNeS1YlH5U+a8xj+JMWVY4of6a2F5k44tnjHDnhgF3X0+ThQOPJImEhN23uFyzMurGOnKS1AIKKRzaA9yAxnTNGcngfuwBJIKz1+iYFXKhTNu5hcdH8KyE9iMQqgaJeANBdzUHWNw2avNxU/fTmEoEKUDcsOQT2dpPGYOd//2EalstWjflMZy4OCDI0QScOCRHN1d4Bt7jDDZ2AQJ2zJDBzMymcFttMGJ2xy6M2zdtoojMZQtGA37/nKIWec2F2HfcWjLBIZIhSMqYqED3fj3NhAARgZHKsQ3WAnLqJil/HwwgUtlxCCi0J5B+2ZKeBO2QgZTCn/KgiDtE2ihuTXKG1p+wsmzfmxW1uwSUVmBGFpXo+kGPm2Uque4lo2i9UUoCkBszDhGm/ZL6yzTSc5OKdSYUfTNwg+YyiOaBuKtqqoy27ZtI5POkkwkJRpJ8N3vfRelFAcPHuTBB+/n3//9dWzdsh0rFmfPgUOcd+6LeWrHNlqaZ7B27Ro+eeUnWb1yJW9721sBJJcfwWhDIlHOeWuX8qlN91B/1stwRzQoCyFUesx6ile1fZuYNUKgK7AkCNEqrTnufMXAoXrZ+od+pODjxCQcWRcPC69OQlPR2EDPjr0kZzRTObOe/ManGe4ZEaNjiERRloUhlA/VOkpbag+LUo+yceQ0UhFdbFoLWX+WZVHmGMrTaTq27ZGK1kbmnHq8SR/ZI4OdfbSsWka0IlwldjS81NGUUMgYmo9t4KRThFWnKYwOlV6qqqC21pahQ9kpIxpkHDKaQGId3cf8XMgMlxK2nhHQgcaJ22IlFCZD7bzj5pXv3rD7b/aoP6eW20KmYGttEEfMeHGwZF4fYS9wsjlOzeKqUDLSFpQlaF9jjKHpuPriAJXRYmgIAet8AY3hpQse5R3N75NV1ZtFcAh0FVqXIaYLiwux5FIR85hofQFCFkO8OG9iXJzy6Kcrz4L5L8jfqLQWDcTMaGtj27ZtsmPHThw7Rk9PD7W1NebLX/oyn/7MZ8zVn/8S99/3IDuf3iH22lPkz/fez4oVK3jNa15nlFi8/vWvl9raWqmsrCSbzZLP51AiWJaFwXDqSSdKdO+GcdsN+/Ao+Iq5yZ2c13SDaFMW9mEU+U8Ada0Br/pMirYTkhQy47VWE4y3HZTXVzHQNcSFV11m3vv7K8zcFyyla88hI8ox4YChUVEGgzYC+HJ2/U14/sRFM8ps8BFilmHk0EHqjjudDR/9vXR/4HoTDKfRuIhjMEYXNcyKUH0OFp05j5e+u4L6Fjc0OG2IRaGpKWJGOvMGTzOBTCGCXwhoOqE+bJ/wNSgZUzJpPK4u7GkvUY+U4rk7ZTbRSgff9VO7t+5O/N170hORiI0BO2aViIGbKZoY2tMc+/6lVMwuR3s67DO3FSvfspiaZZX4ueKsulHZGCVjaiaJJBKYCtygrBhOCIpBjLXcINcAG8G8HIWLEA/HGJSyyk0pQiYT+JBMZoGVqm+MORqLkZHMs0E4RBtDJpMxN/7lJgNCMhXj4pe9XHp6OuTkk0+UP/3h9/zhDzfIuS86z3zi0gvM+SceJ3fffbesWbuG393wG/PqV7+awYEBdu/dbaLRmJQ2X7lenpY5C1igMgx39RkrEsK9tjJktPBvrd8nbg1hjDW+VxbB/8AFHYTjJ8wUYUWNFYdIPEZ+oGCS5VHBdEt5RTn5gbwYEyuZXjeuTQwJTqm/m3InY7zJIzeKLa/VQR+57i4y1U3m8U7N9qBRPDuGaAsnGRuTEC0RH0H7eQLfx/dkQnRcVWuT6yuUkGHH81Uv41G/uorlb1iI2KEwtvY1LesbWfTqOZSOHJ8cwYSPS7S5rbni2SBZzykHiaRiKT+THzeQ6d7dEvx8QLwhylnfPp6+pwYJcpryGQmSM5MUhscn3o6PgQQ/G8Y1NVU+loxSBxSIizEOYn4hsAfDRSiyxpAUwSsJoUxJajGRFSbT9F7LFL6kFBuUqujqGpqQjE9XJIzFYmTSaS644CVy8MBBMzDYR1lZinw+TVVVFaeechq5/AgnHL+Om/5yIxBINpfGsW0++5lPy5YtW4xjO/zHGy7nox/5GNddex0FN4eSsGIeBAE4FqtnNcm2g5uN3XA6JhNQCCxmxA9yftPvMaYcJf4kCLtYnygKGoyxLiiJxRMRMI5xMyMSiYULMxK1yQ8Okx3WJCvUqBorIChMGGYl97KsYgOPDJ1OytZoY41dQsuG8txhuoZc4nXNRIwiWl6ObycI8i7JmmpGDrRjRcfzujD5dsI8wh3f4EDR0hoVnRlB5zUSVeFk41Gs0VK4Ix7HvHoOrac0MrxvhEhFlNrllSHiNdZyP15RDPNgkUiFrY3BGRkZqXk2BvKcPIilrFTRCIwRmX70ZDHpDnKawGjqVlfTdFId0cYY+SF3vLYxie7spYuN+tHR7zw6NnoEI78uPv1clMkCCQkFk0sq95OT7unnimGmfcqofqkBKshkgqNeu1GjSSQSRkRx5pmnm5UrV/CnP/0Z24oWKdaagpvFUopcLm1yuSHJ57PYlsIYjevmWbZsqeTzaV5x6WWUlZfLt779TRLxcgI/XJmq+DnL5s9HuvagnFBcO+0JFzf/gDKn02gTGauqT9N8U5RjLT1VQfsQr0zheznRShMtC6XRrYRFNpMjmzEl+aspuXIKyMvJNTeL609N36IOpNIdksuCqq7G98GLKqS6weQHR0yqroYJPWej8z6MGiMalnbYVVZboP1wyI4ab5WQEqpSfsgj3hij+bRGqpdXUMiEioxSKpdakmsqW+GkHEygcTNu5O8eYmGMqNFGJ5m4T08pNajwZN0Rn8Kwhy7oMbcnpjTGKe4mxcw4EhltF1YY6Qb5ASIzwZyNIgsSB/GLC8NMUhB8pkGZZgp5evLdMqNSmcHfJnpWVVWLNoZkMimvfOWr5Ka//DWUElIWIgpVHA1m245YloNSdlH1RSGicF0XUYpcPs1Xvvxl7r7rHtPe0U40mijWksJb09rabGS4N+x5MQ7NsU4ubr0WY8ol7AGfXNspCS8Dg/EIlQfDEYf4eUjUVJEZGMbSAZG4gw5c4hVxgrTLcJcDOGPC8eNjRDUQZ33tvSSkYAJtjV3LQEPMAaenE+1CoaqJwNcUPA2JCikM9Um8ogJTKN57HdI/0GG9bGo7fEBbmyp662CstGsm3VdVHARaGHJDVcbiuhxFJc2kHhJThABFhGg8Gvv7G8hkKuk4434alfXwMWUVuwaLhZsJk8BEJpxs6E1Gv1YfwkeBk4DTEQbAJJlWWnXU6kr/HXVnItP2n0wYY158TahMWE53T/8zXILwvVKpFPFYVCKRKHNmzyYSifDoY4/iOFF0qaDU6L43rjAQXgulsG2beCxFPBYnnkjI29/29imWqSxL8pksCkh7ihc3/4LKSAfaRMdvR+lwzbGdS+Mko1AZh/I4koyhyhKYZIzquW2kMxmIWyQrbJSlqJlVi07FGBmYZsaihJCu0XFmpw4wP7mdvC9FCk+48BIRMJl+tG0RVDVCUuGVKZi7GN/LmqZlzQRJB4lHkagDUYfAtvCDUU83cXBPIhHmOdo3042oH9/y1OgaU1N0HqU0lpZxxF9EiEaiqb9nDhJCaEbnjSEc+F4aU02nfzzdR8tRSvQGlGOVrOEAY+ox1IE5FzHDICmOrjtc2uss44velBiM+Vtg1uiDLXR07H0WzE2D7USorqnGGMMll14q11xzDceuPbZIIizCdGZqn+ioh0iPZPnBD79pvvSlL0lHezsf+ehHJAgmUmNEB2BZBAaq7V4ubfkxhvKiguJ02j2jE34tTrzkVDNztSeRGOjALtZHhfLKMnwvYObCl7B/434sB6KOx6VfeDkNsyxjjBHELlLRQ5YyAoFWWFaeecmdsnFkFamIIeeFhMikBaar3Sx+2Vqp6L9XGjrvJ5K0KV+gSLaukMqWSvPCKy8AT4vWymhfy8iQYfbqhUb4Q+gwJ9hl6M11rjg9aLzzdto5PmPQzIRxcjIl/LciVpF1rZ+VB3m2BmIA3IybQQxBPhAdTOrmMkdlIY+fx6Q1XNpZpSKhM8vlwlpEiE59AJEYmERoHGbSpFU5ikVOp+x3lNnppf8P4/4G+vsffUaqO0AiHscPfFNTUyMiwnkvehE/uOYHbNy8kRXLluN54XgERrstixckLD6GN394eJitW7bIgvnzefWrX82nP/Xp4uf6uG6YtXb39BCvrSHjw8uaf0lD/ACBrscaFYabxuBDA4xwx3cfkI3XHiZVA74uDnIqrr0wkQc/H14uOwLpQYh873Sa3uiFLGilivciQjiN1wAOJzfuM787AmlXyYImoWswlLo7smWPdP76EeT6R4i44Bvwi/W/wEfs6Pg31jZEh+DJL/wA//izzNrITwlMdbGeZbCtcVrJGKw2WRmViWtQ5Gg3d0LMVLR73/m7U01czy1YKPxCgNF6CstyOlH8aRtszZSgEysWGsjQUJFyIAFCeRHq0JNElKdBBpjGIqc4mOkqTiVpkyVAkvb2I/JMTF6AyqoqIo5DxImMdRhe/h+Xmys/caX8/obfh1OtLJk6/7L4XMuyaWubwY9//GPuvOtOvv2tb5v9+/fLrt07WblyJZUV5QBs27PfMOM4SZjAXNb2KzEkS/Rwp8+5RBQYjyXn1JKoSBBNCBIU56cgWCqcwquDkP06GnakM3HKZ66Uofyxxs3Zkvcr0aaCvCsmXYiS06D9pKj8DD7e1MvWIWXuuDeQpWtTxsTjsvHFH8Bf/jIC20HrsMqujBmrahsdDr8WE5YgHWM4NP88dm0+TX61+o8mZnnoMQhZTdtly7RnPn7fTdF7yFHmmWgdQtKBeXbpxXMyEFtsfzR3UEoVK08TiX5HS5OnqPCXNroEBisSfpWBgWLiUAy1ju7PJrkpI9O2/coUyzxKCdAEoMoZHKqht7fjb3qQWDRm6hsacJzwe3u+xwUvfrFc8/3vmx/+8Ady+eX/QS6XIRJxJuAHBggCTUdnO3t27zZ33nkX1113neTyefnABz9ojlt3nKxZswZlOWjX5ZE9+8Sc93ZzYvLPzEztNIGuEku8qVfZjMuJhhSeAme9ZgheEy/ZjdSk38cBkfHfH6IzvUAe2j3f3PbkHPPA4SWyubsFLERSPsZ3QAeS8HJc9RJlfD9mfnZdgXdeAp0rz6Zj4dk41iR2T4kiiZnQPwHRLLJ7AL6667/kw8dcYTxTOzEmLc6bkZIUpVTYunR6soRhQLHGNmnBFC+PdkPDteQfoIuVrEims70ZtK9V6MafcRRqyQUyY9Xg0RZLUcURbcURZHY01GbyPWQCdjDt/PLpGhXNtNHXs+MpCwYPocn09sTo6+v8my/3fA9BJBaNjYVOWmu++a1vyfr1J5rGxkY577zzcd18uDiUNRbGjWRGuPbaa81T25+Srq4uWtva2LhxE5+48ko5ZuFCPN9FieKBe29jh11PWa0tlzR+D3DGYvOJ1710KIcZ85bay4PJTYoqzdhMEWRylGoQZWhMbuOlxwovPVZkIFPD7TuO5Qt3vdk82nsCkYoREWOTTSf57Q5XzlukefxwnN/eVeDl58HBLodkBLSaJmIYW+jFMQgIWimq44Zft1/OybW3cnLtrUDDeB9/UYPXiIyPfZfifmZDtDwyXlcz4BcC3Iw3jmhN0ngYHUjpRJzc3z0HyQf5HiNoPxMoP+MbLCl2FZaMQxu16KIjEBXiz5ZdVMkrsoADNwgpJyIYXxOpcMJej04fiE8v2z+pYejoTrcUgWE6IY0pZEajC8AMDh/K4Ps5lAppD0etCVm2jIyMjFWrlVLoQDNzxgxuuOH3/Ntll7F7zx7e+Y53hgblFcZircqKSt733veNfZXDhw/ztW983QwPDeH7vvi+j2NH+Mm1v8A662NmdfxxWVX7MNqUFyc3TboGk+7BWOXCVlOHeMLEEdcTLspoN160WHYwVCUzvHzNX7ho+e3mo39+D1c/dIWJJgsiKmx7jhljiIjsz0U4tNs3Jy2LyZ27hOpEmMJowzQjnM2ESr0mIKaEq3d+nmVlj1IR88lki8+NqvHkacw4NE7KIchq9v+lnf6dg2hPk6iOUb+ujppllbhpNwxzZbKjDcNePzDZv7HtPncP4v1/7Z13nFxl2f6/z3POmbqzs303vWdTSCOd0HtVQFQ6oiJVxcIr2Chib4AFEaSDIigqSG8hBBLSe++bbG+zO+XMOed5fn+c2dnZZAPoqz/1NefzyScaspOZM8997vu+7uu+rrSZNg3luEk36NoeZpHV5837kqI+bOhvnflbXtlOh+7WDMmGNJlmm85dXRCQTL6yFu0olBYEghIRNtm3Nwv7A3ZCc+BeesEjSeu+ufwgsdJ/XwJoidY2ME3sruvQ+Tr+PbKwEEJnMhlEweTTMCSO6zBr5kzx9ttv86UvfYmzzz6bz33+8xx/3HG5zJPF9bw8IqeBwYMH88Pv/0AAZLM24VCEe37+M17YsFsPvbqWM+Of8svX93JDO4gtYV/crbDk1O+BLKr8PEErA0+VIQ1XfPfcmykuzuivvnyzhoQISEHKleBCqNTkD8u1+GQwpc8aHRTz95gkHSgO50ZifWZ2ok9fpjAImR577RHi9g0/5EfTrqd+n18OSkP2Lcs8RaAoQPuGBO9+dxVde7r7vvmHNjPy1KFMu34CnuHlBoe9db3KeEKjyaS6k//wDDJ4THlH44aGdqV0jfaFRUTPB5emwG7P0ri4k+49Kbr3pUg1pkk2pUk3ZXDtAw/bhMtGYwR8Lo2MmUQqA9TvdXwfCqN3zVTkmxbRu/NZqFJOgZpxIcWg3x2pfh9pudefyfr1q9+TZtLz5+FQ6AC9LJ1jtjquQ1VVFY888gjz58/nwYce0g8+8IA4/4LzOf200/0vWns4ji9g57jZ/I57IBDktddf5/dPPcGgkbMYphZw/IAXtdbFwjfK1O+dPMV7VZP7t7aid+BauC9TYF8gBJiGv+PuqRpuOvEX4sWNx+j5W46gJNzFvm5TIAXCAx01uedNV5xan+ajhxvUWwHebDJxPSjyhRL7jgMKvlJHG8Qtl2cbPsrpXavxuu8ALKyQ6a9V5MorI2iQbrJZ8JV3yXY5xEcWM/SEAQQiFl37Umx/djfbX9hNqjXNUT+cQbbb8WdyUqCymmynbxPo2a7zD+9Btr67tasoHk2ojK5xEw6hsiCe4/rC0WGT+rc6WHT7ygORNVNSNChCtDpMbHCU6IAI0QFhDFPkKR7SEBRVBWjc1kUqJXVRVAjtHUyCVXNQiKMH5uwPAj3gMPUWtEKWAFNZs/r+923QAaJFRX3OUt/yy8DzXJTWHHPMMRxzzDFi0eJFPPjAgzz22OP6tNNO5SMfOVeEQz6h1M5m8kPTru5uvvGNb+gHf3MPV335e1wZv4OAzApPhXvdbfvDqvc3iz/AXerAwBKF8Hh/TrcFzb8UGtfTaJnl45OeYf7KIxlcYuu67rDwSacS6YEVt3hhu8GC7YpzJ2T0Z2YavNgeEhvbBGVFPtws+h1XaFwtiQcVP939Dd2y903M0AIhIxau51srKE9jRQMs++F6sl0Ow08azKwbJ0Mop1wSNBh1+hDevHEJDUua2fVCPSPOGESm3QZDoLTWru0JQwpileV2prvxH5pBJAIlTaPRSzlj0622jo2K5T+o5yiKRxQhpCBcHmT0OcMJV4aIDggTLgsQLA36Ag5Wru70NE7SyYuHaSkoHRlj65I2mpqUKBpRON4QB2nadb98FyFEX9tiQT9SlaIXGNcZDHO0TnSFxNKlC0UPIfG9rpKSuEBrrbUuINrrgi9fYEiZCxSYM3sOc2bPYf369eLxxx/XH//Y+XrK1CniqiuvZNCgwfnX/clPfsJZZ53JmNqJIuiltbOjSejaIoTOHtSG+YBeIrcJKfYvpQrvwQGLMQXL7v2iHXlpHR0yMhpXMK4iwbKWUo2UIv888TSBqCQtDB5Za4g3tmb56odTFFWHWdIsKQ/785ED65PcbolQdLsBsbkuSCiGr0ru5pQ3QwbJvWnq3thHtCbMjBsOw3Ec3C5fDCTj2MTHxTj88xNY8NWlbHpiO0OPr/GnBgK0o9GOFhpsW9uN/+geRKJRQoo9WmkyzbbO73RIP0DC5b5WVrA0yOSrarG7sihPoRzftNFN9k6rhOjRbvUfZcrVlI6M4eKxe7fLyBE+bo5RaHJ/4OZTH4mt/Fe836KUeC80TKJUEsM4mXcXb6WpqZGDiVUXXgHL0qZp7E+BLDiDOYqJlL7Wfi6jTJgwgdtvv13U19frX959tz777HPEEUccoc/76EfF228vZMm7S/Tjv31cKKWYPOUw8dJrCU46dQCetxUhA76sptS6T5smDpzSHsBW1qKfqa3I6Z3sv3Z5sEUxgcRhVf1YEIih8ZROO9qnIBXUw1qDqUHGBXuyAb74W5ufXZKmqyzC1nZBSWi/IMl9ZyLnd4+n8bqaiVSGMQIG2ZT/Yc2gpGVbF8pRDDluIEbUwG5xMAKGT2YMGaRaM1ROLSNcHqJzR4JUU4ZQVQDtaZyUh9PlIiyR8rJe9wcJkL/Zo1BKtiIFmeZMrwJqz85vzKJoQISuuiSJPd1ku7I4KQ/lqNwmnN90SUP2YfUK4Uu+lI6OAbBhgwEYBWWOOOgcpBfd1P0MSXS/U+a+lkoajQGcye9//zvdM8h7vyteUkJVTQ2GYbyHQrUu4Jr54nCe8r0LBwwYIL51223iT3/6E83NLeKGL39Zr1mzVv/m/vuFZVlIKTn3nFN5552shmO1YWQRGD2ghOhlvh74JM4/6vV+TwfN/mJjOX7cwaarvS/saRPL7GDzvok88O75IlCa0KPK64QlsjmzW31At+N5gpApSEcC3PqU5oKKlB4c13RlwZL7zal6yJFS4KVSpOv3Ea2J5YfEvnSPJN1kg4CigVFfoytXLehC6p0hCcTMggWA3OvarvayCpCNp847teMfT1YEPK03AST3pfv0fNrTyKCkaGgUN+WSTTgYIXO/p7c+AFXpGTx6WU2oMghGgCWLO+lxZtD9QZr9Bcv+TN3C2lr398+L3uxhHk5LyyD+8IdHBHBQNffC3qQkXiKyGVuYhilUnord+z7y1OyCskujkUL4au7KI+s4DBo0iMcff4xFixaJRx95RJTE42jlWzbMmDET14E33igCWYOnnP0EJvSBBMw+5PbC/FZAfNfiQBu2flNtrhxWBoZMsr1+qD79l/eRoETEo1kxvLxRTyhNaZH1cnpjup/zIggGJHt0kFueQlxamdZj4kq3pX3Doz5fj9ZIE9z2BpxEK7ER8b5NvdIESy3QkNiewAia/qJdj9VB7pVUVpFus7EiJlaRiXJ8yNtuzeJlPISh25588kmPD6Cs+LcESM/+4HZMQaoubahs33VIDcSHFyEMQbop4xstKl1AJ/d3pn0B494hELkMEogHiA2PsmppGq0Nv4nnYLMP+pGR50BOgngvwruBUl0IcQGPPvaSaGtrpceD8GCXUgopJeUV5ZiWeUBT23ee3x/B3v9OpBBYppHPKJ7ycFz/956ZipQGn/jEhdx22x8RYijobK+8R+Fn7Tnw/d6Qwu3s/etMfXCaQsGGJsKjKx3k7PvuZltyIiKSIeuGSLorxeXTd6E98PZHwArAA6UEwZBgQ9Lihgc98eFIF7OrPTpsMAsrZ60RFrj129F4xIbFUa7KleMCN+1SNqEEI2Sw85W9dG7tIlIdQrnK/+UoolVhdr+yj2zCoWpaOaGKAF7WN3hKNaaVdjRaiN35A/APzCAaIBB0d0tLptItjrDbslr07P/mdoJLR8XRnqZ5RRumZaBy65Ce54s7WzGLSEUI0zKw27M5K1/fEkAGDAZNK2HDRpv6epmXp+xD8DpYL9GH1b7fo0nsX22JnKehizRqSKeP0Xfd+b33VTHp+e+VVVVUVlTqWFHR+zAhdQENp++/31MVCiEwTN9KusdS2t/Q84PnU5+6XDQ1uuLFF1owzLif3frKWfZC35q+ll68F2tZHIhe9QAmBcNG3/rZZsveWr2mZaYwS1PCEAESTrFetieh54z5JRdP1WS7fCuKg2V4TwmCQcleI8R1jwlxSqhbTyjTpLL0DvOUxgpA9/YNABQNKfJFPnIZwrUV4QEhxl84mmyXw4KvLKV1RQeh4hCh0hDRigh7X21izb0bAai9YCRONreAZgi6GzK+bJApt3/QQ/83B8jxc85sFIbY6Xa5JBsy2gj02vF6WUV0aISB86qJDSvCSTkEiizC5SFCxRZOwqH+rSZW3rWBlz61kPk3LOkVnhMC1/GomlJK2nVZtsLzn/D6IK6s+xO79P4PRdG31ehzLjRoA89rQ8rL9OOPr2bHjo3v25z39CYTJ04kHAmLeI5QKEUfS58CEucBRI580dNzpvvLL72adgrLsvjO977H56/frl2n0n8dvX/f9T6x8N4V1AFZpZAYLYVC6yBjB22ltmYjbiaCZWg0hnhmw7HA0/zkrEf1mLjQWcfnOfV62PRW4UL7PUkwIOgMhPjKU1KcU5khlJuP9BSjQkLXumUEQr68ref0PtmkKci024y/dCQjTh9MV103r1y7kFc+s5DFt63k1avfZv6Ni3FSLlOvnUDFlFKcbseXL9Wa9L60L/Ag+acFiPHkk096SL1KOYrO7QklzR5hL4Fne0QHhTniO4cz4oxBaAWJzV1seHArb35xCc9dNJ+FX1/Oxt9tJ7GnG51VZNoySNN3sXXTHqXjigGDN15LaTD7pmtN36n5QUAIXchJ6m8OkrMokDJOMnku3/3ube+bPQqHhPPmzUMIQXlF5QFAgMjr3B8Mne5rQ0pBcbb/eZW5oeOHzjqF2nFniC99cQOGWYLregf2dbrAM+M9/cn3x8R7tzJ1T8QWiowL8JRJUbhFXDrlj5qM5f9hSPPa9unCc+OiMv4L7jpzJyotUbKwrDwQ3fMUhEKSnckAzy7yOGOwS1fWh0iFlHi2pmPdCuIjIgRiJtpTfVHKHNlz7remM+/W6VRMLKVtcwe7Xt5L85o2YkOKmPvNadReMJxMe9Y/W1KgHE26PiOlJZCGtfWDIFh/86CwgE+9VAsu6NqeLFiG9L9i5SiUoWhc0cGKn6+jY2si/8PhihAVE0uonFxG+ZRSIjU+D0G7PknOczTh6jDRYTHeeKlLQBGGmUZjFGyU9YgRiH4o7z1UZ9E/c1f3fmxP7cO0vqp/8ctFYtu2dXkzzvcEKDy/P5g+Y6Y2pBTRSCT3Z6Iv8ND3jO3XrIuCPKLpaxVxoG2ElALP87j/N3fqSZPeEieenOSssyK4TgqzP66Vfi/uyXs0cCIP96JUoRyVxlP+e6+ONoFCK6SQlsuWxHB2t49lROVyTj3sAU4f/S393E5XhMIGnhZ9t4FF4X0EI2rw542aY2c4VIQMsp7GCEiyzbtI7trEkI8N8fvb3PaD8jRGUCJNk8TWLlo726mYUsqwk48k2ZShq64bM2gQHRTFjBqk223f81L5awzZzqxONWQkhrBd0935zwoQjV8fL1OWIrGtW3ppz38jPbCrlGhHs/i7q0g1pigZU8yQo2uomFxGfFQRVrHlL+vbPvzbO7LIafWbgmFHlLH6d7vZtNmkdqzw5fJFn3nVgV90H0Me/R7WXQKl00hjPPv2ncf3v3/CB5p79PydcbW1DBxQQ2lZaUFPKg5a/fVLv+/n0IqDjPt77NnKy8vFE0/8jrPOOl4veXeEGDPWwXVcTFPs1/KIg3NOeg3/CgatfccfKsdqoMAB18AAIvrPW88EqdDaX55KZ8N0Zoo0RITmL1w7+yKe21Lr77f12WrSfYihAKYBXRmDLbuz1JZrFu/VlMahffG7aJWlanoVnuNrXmnlbwI6nQ6LvrWUltW9K9HxUTEmf7KWwScNwO7M4jkedqdvKtvDIDICBsldSW13OEIGxZ5R5aP2Ldu57AMFyN8K8yoAHdCrzaBoS+3LyFRDRhsBkU/xRkCSasmQakxRNa2Ck+87inGfGEXpYXG0FGQ6smTas3gZld9RLxT5crOKQXMqcbXLn/+SBILvyartGwcFQGt/ZYbQgIlSnUj5bW686V7aWhs/UHnV03+cccYZlFeUi6qq6hxsK/d76uuD4EMHUkJ6dyT2D5vePX9/kcvEcRyOOmoOP/zRPeKIeetpbCjRpiXxXN2veywHIz1z4P3q+W+e52esjjaD159zWfiKx5svKRa9aXP3r0bx8tJRiHIp/D1yv/GV0vYf8bqZucOX6YFxie0e+Il0vywfwbrdmpqgwvXAsqB90SuYBsRHFfv24jnH3EDEYvlP1tOyuo3Y0CIGH1FD2fgSOrd1seBrS6l7rcF/UOc+gyjoT6Ul6N6T1CqrEVJsXLZsmcMHdLn9ezKI7Nzd2V5cEVvhdrgnJLZ2qdiIqOFlcpCv0lhhAwSEq0IIU5BszGAEfISmR0NVK43SYIR8pE3ZCmFI3JRL6bg4gZIwv3+0gy9/aQCGkc3R+Pt6PhQCOQcNnj6DMQPPa8e0PqYXLCjhkYfvEh+ktOrZ9QgGQ1z6iU9QXVVFJBLxTWn6yRniICufffW5CrYN34Nb1lPmGKZJ1rG54tOX0NDQpGfN/LJ4d+l4qquTuFkP0xLvDYW/F/MXgef6Xht7dpjcdEkD9ZszBEN+z6A1NHU3i9HWPOrPfUi3jTxT6IxHSTBJdaw1V7LalMY2MqbE1fvqhZChHDmxF5JAiF56osJnSdR3QrH0MMwgZFxaF7xC6dgowQoLu8NGSLAiJh2bO9m3qIGycaUc9/M5SENghAy2/WkPS36wis1P7mDgvCqy+yXhnk3Rzi3dfotliVUFyUH9ozNI/me0Vm8hoG1NpxayF4nyXEWoPES0JkLTshZfRdHyl4WU55dUVsQgUh4iXBoi02CT2pfGDBqgNMoFWWQw4rgqVqxKsGKV37z1qYB0316yf6SmoPjNaeBrrUCEcbJfFdde94Uchfz9JX4Mw3e6Pf+C8/Wkww4jGAzm9spF3+mK6MWBdEEm0QdBinS/8JI4aHlsmhZZJ8s3vv4lceknvsO0qRv0tq0xzICJ43h9J+vvMfLYfwDvur4N25b1ki99pJ72nRmqq6G4CEqLobREQhiSre1adzUIaQlwDcYUbdVVRU1CqZ717joGxmyBJw7498V+0KLIbdV2pwSWpzDDkNq1lmTDDqrnDM4Z5/jwvxk22ftWI2gYf/EojLAk1ZEh1Z5hyLHVmAFJ974kXibXDxbOTqWPrnZu6hZGQCI0737Q/uPvDRD/uSDFKzIgaFubMJwuJ2/kqT2NGTIYMKOCdEuG1L400coQVtQkUhHEDBokNnez/v4tzP/8Yl64ZD5Lv78WI2igCuDiocfVoNA88lASCOQOcoG0i9gfE+3n0akLCY0WrteEYf5U3/atv+g1q5eInoP/ftlDa020qIibb765j6nn/kPBPp57fSbq7Idcif129d+Dpbsf2mUaJtlslm996yau+ewPmTR5nX7ttRBWoAhPeSiPPBTsD2YLfWIL1lVzv1zHw7RMli+EG87dh91qEysROI5vKZbFZMteRUOb1m0f+rZon/YpbWazaFvw4TGvCiGTKCVyVMMiMlljv1NV6AMj+qJsOdZM2gYRgva3/gRoauYMwLNzwug5a4xdL+/FDBmUTywh0277zlJS4KTdnJlOANEzmC7UOghI0k227q5LGcIStg7L1X9LgPwdJp5+WoqZseVJq6suVZ8e3LU7qYpHxXy195y48NATBrL1md2svW8zEy4dRbrNpmV1G3vfaqRzZ++Sixk1seIW6TabnpmKk/IoGRcnWhPht492cPPN4ymJ78377eVvbiFlW+xXV/VBrwK4Xj2WdTVvvjmK73znwg8UHD3Zw3VdbrnlFkYMH47jOBim2QeyPZAOpX0j1YMc9/cbV/QROttvnIMA0/SD5Otf/bIoKynSp5z8WX3bbVXipq/GgRTK7bFQFvS7MVawfWgGgrz5gsf3rmogJF2soly5ZUAqqdlU5+qW6sPIXHwnmeHHYyXTwlYm8UA9l818FtcJo7WHkCaZzEQ2twmNiSgE00Qf9nXBspRSxCOadhFAupr6F/6koxWWKBlVhJO2/d6jyKJzc4KuuiQjTx1K2Zg4nfXdPmVEQKbFRrmKiollSCuHcPaw/HNaB4kd7crpcg0jZmzo3Nm5K/fsUv+sANGAUV9fn4qXxxa43d75zUvaVOmEEumkXKQpyXY7VEwtZcDsKva8Wc+eN+v7vEDxiCKqJpdRPauSmlkVhCoCpFuyPqqVo8IbJRajTx/Mqvu38NQfy/QVn2zDU2nRI6WDFvn95gOmID2LhRoEFp7XhmnOpbXtK/rSy+bl6SLvV16Zponruhx33PF84QtfwHVdDNPM9wUHTsh7qrs+nOKDEEDoMxnpN5jEAe58PSW9ME2TrONwzTVXibG1o/THPvpJnnl2B7/4WS3TprvYmTS2K5GQ09Dqacd8NxqlBNLUvPB7h5//zz5KYhrT8oNDC0GiS7A9MJq6j3+BzKyr/ASRgWwkTNCDJz7+IIMq24BiwAFirN5Ty+Z2gVnk95nvyd/MHeCh5R5tlom7ay0dm1Yz7oKRGGFBNqXzMPfa+zcB0LC8hXe/s5oBR1YRGxqheHARu57ZC8CAuZU4KbfPomkPIte2tsOvroV4J5e8TQ4usva/DpDCc/CMDMgLWpa1izEXqjzSI6TAsT1mf20Ka369iY7tCQLxANXTy6mYUkp8dDGR8hCe7dH4bgsbb9mO1jDv24eTTTr+z6ddhh4/kNUPbebe33Rz6ScuICjuzolWq35oZr3QpehR9xAWnptAygHYzr364x//NLt2bv9AjXlP5qgZMIBHHnkYKQRKHmhU/76ZQbx/Mu83cHK+jYWNeq5/EHmHW2mQyWY58YSTxPoNS7jkkis5fMZfmDcrxsCAIKQdsrYfypYoRM788lNpzd7dNsUxAQa4nsZVgpQDWSdIdNIsPVS0CfHyV5Cem9vTh4Fxpfep17k7qwFbpDybsy86ST+1YxqOK0RYCNx+AQNRUIZohNCMGypZJyHx0kNao8Xg4wfjZhyff2UI7E6HosFFlDTbdGxPsP7xLax/fAtFgyIMOWYAe99sJFQapHpaBTLimzopR+dFQbyMR9vqDoEpcLV66+866H9ngOiamqLKpM0W4RGfd+c0HR4cFsr2D6jSGsMUmFELz/aQpiAQs3wvwt0p9i1sYsufd9G5vSv/oifecyTx0UW4aRetNZGyEG/duIz6hW38dvFSfdaMOwmpPwhNiW+1dkAGKRRANnDcVqzAUGz7Uf2Rj3yXv/7196InK7xfcHieR0lpqX711VfF4dOm4XouhmF8wMr1b0vISvWqF/ahhebRH5+XZvRaCe/XBXt53t0DD9zPNdf+D5l0K2NKBGMrBBGpUF5v36Hz1A+Ilsbo7OzCCvR28Dqn0iLTGsPFF1MpIBV6CjoyPodKGtDVBcaImXrFhYtE2tF5p9l+14MBQ2gyWc3UeJrzTgnzXHOG5eeOIlSc5KQHjiWbzJmn5u5AsCSAl/ZI7EjSsLiZugUNtG3qZatLU1A6Ok5saBG1F48kWhPGsz2MkIG9N6MXfH6Z0JB2pDsu057Z/UERrA/EZnyvn+3uznaHYoEj3C5vbLg66FVML5Vuys3xXXzPDy/rYUZMvLSicVEr6+7bzNIfrWXvwkbclEfRgChO0qF0dDHjLhiZd3T11bgFscooW5/bSSAUx5z7NT3WeASEKxCyYN7Rw0Xwf/c8B89LYAWPprn5+/q8876lX3jhafmBgsPMBUdJif7rc8+JWTNn4rgOpmn241TVT3ch3ruyKCzHlfIwDAMpZT+/DAwpMaREShcpNGlb05l0aelSYk+7x+42j+Yuj0xGk814pG2PeXNncO0VF5BJtus3l68T6xo9bA8iYYllaoJBSSBgkEwpasZP1d9/8k2xfNkyWnfVEYmYGFJjSt9BV4YNRNhABE10QPq/LIkRlsSKIVIksIoCZLs8th91DS1DjxGm4/UyjvsVhNAIA9yky/XHuKwoirDvxYfZ99ffMfGyCZRNKs4ZLPXCHE7SRXmKcFWI6pkVjDh5EEOOHkDxkCLQmlSLTbIhTcf2BBMuGeMDRq4mEDPZ92aTaljQIo2I8W6yLfXTvyU4/jclVgGbQjxlBORZjW+3MPKjQ/LUTK18Dn6206Hu5Xq2P7uH9hztpHh4jJFnDGHE6UNY8JUldNV1M/nKcRgRidvhU5OF9I0Zy6eUUDauhNce+6WYd/kN+oHYbXx69HXaccqEId1856q1QisXIQIY1mAMTuKFF8fqa6+5XGzfvuUDZQ7LMnEcl+qaav38c8+LadOmkXWyWKbVz8PwICGi+5/ZiT4DOQ/TMJHSJNHVxcqVK9m5c6dOpdKiuamRUDiCZVmY5YP0Jnc8DeZYUd+ObmzrFh2uELaSpB20q4QwpCBkQlD4FPq4YTOmupppJz8grpp0hX7nxbtZ/eYzbNveKYqDgmIUxWFFmYQaERI1g4bxoU9/iU//ZQGV6V5bbylz1tsCpALD8E+LyiFPCnC1QXOjraNTjxZNU2/ATHq9KMrBlD8NyHQqzp9o01Uapa7VZd8jd2CGJYOPrcZJugXelioPTGgF2W7H95eRgsjQMKPHDmP0ecNIN9s0rmghUhEiVGZhdzkg/XTZuLhVSwMQ+qW/Zf7xjwgQv4i3+KsMifbObd2lHRsTumR8sXCSvrCyERQkG9Isu2MdAAPnVjPqw0OomFZGuCrE7hf20bK2jaqpFdTMriTVkcEodM9VAk97TP3keF77n3do+st3RfojP+TZze9w5tjfaSgVvdI8xcBgYAxLlgb56U+W6t/+9rt9+on3mpILIXAcl9lz5vDAgw9SVFREd7KbUCh8oJmv7m2sxfuiVH1LDdf1sEw/MB577HF27tyua8fWigkTJoiq6mpAk0h0sWPHDt5dtpqFi37Pio4yzcTzBbXH5Hx+bGTIEj3pP4UgmQMcWpRg217FC1szYM4SA2fP0SXHtVKx5h4tfvMNce4nLtRKClY9/Zho2rWJltYWZh91LN6oOXpXZ5uwSIN286RnS2ms4lICpOho3kO3rVH4EGs663L2Zz7L+knf03aLKQKm7gfXK0B2JGTSiuk1NjOnSf6UMtFLnqJ10zrGnDOSUFWAdIu/R6SVxopavU23FAUc6dw6tuvLiIYrggw8ohph4geY8F2Y0w02nRsThq+tJV/4W+Dd/20PUliiefGK4ofdhHvJsHMGupM+N9ZMt9r+xFyDYRlsfnIng2ZXER8XQ3kKuyOLFQnw+rXv0L65k2N+PJvK6WVku5w+JL0ekbBQSYhXr3oHsdfh3vkr9A+2lelvj7iU4UWuCBdZQrk2zc1hvXS5w1N/2MaLL2z2t/yEr291MDi3ZwejJ3i+8MUv8tnPfY6dO3boCRMmiOqqqjxJscca7b3KpvcqqjTguR6WZfLMs8/y8MMPc8EF53PWmWdhWdZ79ijvzn+Jn937EL/bYmp33i0EB4zE7coKcogaosBYhp4krvGyDq4ZIpTaycwXL9LdWxeJZ7bU6d07tnPDGUeKYAh9+1MLxNx5RzL6xq16Z2CoCBoZjXZRThYlQ1jFRcg9z+M8ezP2rlUgJFopgVZcdeut7J72TZ5b7BIISR+80/2LjwkBnqepMTLc9hGT+/dZxMs0iy6eTsemNZzy0LGEqgIoW6GVIlQWZPPvdrL71b1g+IohPpde5+cjWvkAhN3m+8+c+Ot5iKDvPhAssah7rl6t/OEGacUDG8eMGDt52bJl7t8aICb/gMvV3oNGSFzSuKBZjr1gOLJADc9zPCZcNgrP9ki32WilCZUEaVrUQvvmTqqmlVM1q5x0awZpCKyYv4/tptzcOqVAKZepV03glc++xcv33M7MTz0gjrv/Rqp+e7pIZTIYpkFnhy0KM6dhSDxP5ZXUDxYYrusy8bDD+MEPvq9ra8eJDRs26LmzZ4vS0lL+8PQf9epVq8Wtt9yCUgrl81gPOP76IIyOPunWdbEsi5/ecQf3/+Z+nn32GYYNG4ZSypcxFbKXm5Xjp2mtkYbJrGNO4ZFjTuHKF/8irrvtCr2q5pMiOPci3G4HnZM0RejePTHloTV4JSGqd71A7RMXYXlt4uM33aZXrljOCSecJCpGDKRte6NobNjnB5U2hJfVZAJhoQwLWQZGul67r3xV2K/cA0ohTQvlOsTChv7Ibb9i9ZArxdtvZwkU5Ya8fcTD9xOJkBqvW/HF41P6lU31WMMni+YXH6Zt3SqGnzSU4mFR0u0pX+QiIEnuS7P2gU24SdcfIns+rUe5/T/shp08iFBlgHRrJi9p1PB2szIsQwrBH3P8qw8M7/6jAsQDRPL45Pzi14rWpRrtCfveafKGnTHIsDt8Lj6A3Zb1tZVM4SvdaVj30BYAxl84Gi/rESiyMAMGDYub2f5MHZOvriVUHsBzNHanS/nhcYYcPZD7fv0Yv7/kWl6cPQ/ij2t196WipbUNaRj5aYJSGs9TBwRFDwzteV4PhKu//KUviXPOPZc9dXtobGzk1JNPFkII0pkM3/j6N8SG9et1Z0cnP/7Jj4Uv8uZgGmafNr0wJArVA3ue7n7msLj7V/dw15136qVLl4ny8jKyjoNlmrnXKxhzCJDIvK6x43qg4chTPsSCWXO5/KKL+MPTawh+9Hs47X5N3iPzIxC4AQsMGL3we4x87SZaHPRtjz8lDp9zlPjq/3xZn3H6GdQefqT+w4rfU1pWivI80ZXxoCyIEQajazfqjYdwF/xM6M5mpGGiUCjXoXbKOD3183ezUB3LlhUpAsUhtCpwdtqvQ/UzmiCbcZg5PIix7WmxlvG6dozD0p99E2lIai8YgZN2cqr0IAxBNuHkd8mP+PrhumZepUg3ZwjETFrWdrLgxncZNK+KiZePJd2WoXRcCXaXfy9kQNK9J0XbmoQhQ1IhvD/8PeXV30s1ObDMehJPC3GvETRE3QsNGqfA0wHyTbd2IRgPUP9OM60bOqieUcHgE2p8Mtn6BAtuWMqbNyyh7s16djxThxE2/YCSAiftMPXq8djKEY/e8W2+fjh6ozhDzL7lFWpHDNLK86FOnUOyfIsBA9M080NBz/PwPI8xY8bw7e98R7/00kvimGOPZePGDYwaOUocMXeub40mBF/44hfZsH49wWBQ3HnnHeLDH/4w7e3tWKaF4zrvs8yn++yQmKbJ8hUruPnmb+oXX3pJlJWXYdu2zzpw3T6yCn0ggBz0a0iJYRpkHUcXlVaKp557icsGrMV+/HrM0gDasNChAF40gBexiHVu0DP/eJYe9/pNyPISrvnRnRSXV+mK8lISiQSpdJoJc07khjvvZO68o8Xq7UmaHaGD+/4Kz16u9c+mo579JrqzOTe4damojHHylV/Wo/7nbZ5pPFZs2W6LYHFov4Fg/2R/ITXak5xdU6effu0lPeG0o9h+33fortvFiFOHUlIbw0n3op89i3NHfP1wlKtYdtcakWrOYJVbmHGLrX/eCQKmXjuBknHFVB5ejjB8QWutwYqaNC5u9ZyEK4TJ8s6W1Iqe0eT/rznIAV1o8eDiMlJqs5f0ymbcOklXzimTTpfrQ24FUvWhWICXr1hI994Up9x3FOmODOsf3kr9oiYASkYVU3v+SKpnV+R3kYUUKFcTqQiy9hdbWPvYZv783B/1H9If5uGlmo+P3CKST1+nn33u1YN+noEDB3LcccfpM848k/Hjx5POZERHezvDhg3VE8ZPEACpdIpIOMKv772XKz/zmfwkvef32tpa7rvvPo488kgAHMfxM5egYC2qZ9AvNFoJrf3yasaMGdxy66363HPOOaAy07qXjeV5bl4F3/eDNPpMHJWnEEJiGJIPnXSUfiY1h/DxnxaiYSOlrRsoqV/M4H2vEtFdNKUk3/ndX6kePlr/7pGHxc233sZ111zD2R85VxtSMn7SJGoqKsXHLr2Kp559Ddm+pc8JMoHBY0fq8Sd9FOPwy8WqdK3eU6+EtDxMy8gFh9gvY4g++VQCdsZh2sggZ+2+nac6JdMvvlz/9ojhQppw8m+OwiozyQuA9MxaXEW0OsKG32xl1b0bKB4e47QHjqZ5XTuvXfc2I08fysyvTSbVlPLFQXrU35XGChksvH6527U9ZYqQ/HxXW9ddf0959Y/qQTRgJuoSbcUVRQ9Kw/jS9qf3eFWzy2SfOl1pgnGL3S/W076lk2h1hHe/v5qmVS1+YIyJU/uxEQw9dSDBYotst+uLfSVdlOsbvaTbbcZdOoqdr9fxxc9+Wbyw4Ej92vowv983js9c+Qz3nPeEfujun4iV63dQVVnJqJHDmT5zlp502GFiyNChWhoG3V1dNLe0MGL4cD139mwBiKzrC9xFwhGeeeYZrr3mGm0YhuiZtruuPyTctGkTxx57rL7++uv56te+JspKS/OBQk5JMW9torXwPIVlmjzy28d1LBYT555zDn997jme/uPTevuOHVRXVelTTztVXHzxxXlgwjL7Nuyep1BK+UNK/DVcvx/SPPLH55hx2Dh2ff+nKMfDAQYPgGAUlDAwHY/hY2pJpTOircMfrB02eRJvvP46t9/+bQDx1a9+jScfuYccr1GUl8epGTtOl086lui4Y0SqYg5rukqp24PGs4UVNv2dGt2fb2ChxmSOhyU1QsGnhjZw948fYvajC3jjf67EtbNMumg80cEhUq0++dAX7/B/3jAlyaY04y4bRaKumx3P7+HtW1fQU7qPu2g0TspBWr0aa9rTWEUmrcvbdWJL0pAR2eUK96k+qOu/IIP0lGo6XhUfoR1vncqo4JwfTqFkQlw4qZzFgdJYRRavXvk2HVs681pflVPKGX32MIaeOAAzatK4tIW29R3YHQ6xwRFq5lRixS2y7TYIgRUz6VzTzcuffYtrrvu0Pv8r93L0HV2CUEgfO8oSN85s09OrOlAyQnPCE22NdTh2SiMklRXlYsTw4RRFfTUS1/NQSqFRBK0gTz71lL7owgtFD6q1P1ercPNw2LBhfPGLX+Siiy6mvLys4EC7/mQ897S3LIszzzpLH3/c8XjKFTfdeNMBN+9zn/+8vvOOO0TGtvnFL36hly5ZQs2AAZx11lkcd9xxQuSCVBpG/intui4By+KZ557THzrjDIaWWGJChSZi+v2XKSXNLR43P/xnPfeEU8RNX/kf/eOf3CFee/11Vi9fok8/+QR+fs/d/PW1+WLEhMOJDZ2i1cDJ6MqJtAeGiZ1dBo0doFIacLFy/i0HYnMFIth97GI0piFIN6X41HFRIn++RD/XaTD97I+I31/8IYqHxjnx3rk+QtgD2wJWUc6QKNnLlAgWBXntmndoWedvEtZ+bBRTPzfOB3Yso5d54GmCZQGW37bWrZ/fYhpx88FEU+LyHrT1Xxkgeci3uKL4QdXtXVY1t8ydedskM92eRRoC5SlCZSGW/3AtW/+8i4Hzqhl73nDKDishWBqgbXU7K3+xkcZlLX1eNFoTZtpnJzDomBrS7TZoTaQyzNqfb2btY5t59tnHdf2gC/QVv81KwiCySl8w0RA3HtOqayszpNJBEYyU6nAg5IvCKTcH20qU8jBNC0Ma/OSnP+VLX/xiHs59L6ZvIZerZsAAzj3nHM4++2zmzJmjY7HYAff02GOP00fMO4Kf3XUX6bRPuFQ5xRLXdRk0eIjeuWO7WLpsGTNnzOiTnY+YN4+77rxLTJ9+eC5IettG5SkM0+Soo4/R6XULxJgaSSrr5TS3TJqbHU6++kZuvPW73P7t2/U3v/51XvzLU+KWXz+s1YgjSVYfJaKDZpLApCUFnWlw0oCjQHgYpp8V+5pjfoCNOjRSCjIdKY4dH+Wq0pe56NxTOe93z+sXvvAp0bl3L0d9bxY1cyuwEzYgMAK+/FHj0hakJamcWoZre3hZnzKikoqXP/MWmTab2o+PZOrnJpBqTuU8UETehCm1N8Vbn12upCmFDorZiYbEkn+XAJGALisrGucJucrtco05P5giSifHhZP0WZZGyCDTlCHdnKVyRhluxkUrTdf2JPO/4Mu1BEsCDDl2AOGqMO2bOqib3wDAvG9NZ+Ax1f6WmSEIFQV49cq3ydabbNqyWP98xSDx7VfQwfKAsDs8So0sXzm6S191pBbxiEHGtvC0iWkYvpisUoSCEVKpFNdedx0PPvBAvpnXWr/vmMN3MJJ9SI+DBw/WEyZOFJMOO4zqmgG6vLyc0aNHcdvt32Z87Vgee/RR2tvbD3jNX91zD1d+5jN0JhLMmjWL7du2IaXMgwqx4mJeeOEFjpg7F8d18uVWz9Dxkcd/p6+4+EJxzkSTTNZFa0EoIFm4QzNk6hG88/YC1i1fpFc3Gtz65l5ayo4WabOMdAp0JmdcbvjGmf4utzhAVajv6nr/DEyZmy7aGReSLufNiPCJ6kX6k+edJCJHnE5RyGDtU79l2HFDmHP7FFKtGaQUSEugbM3ib62kYYkPDNTMqWLe7dPzML0RkDS+08qbN76LMATH/XQOZZNKfFmfnNBeuDzA6h9v9HY/02AYJcaCRHPX0X/r5PyfGSD5LFJUXvQgSXVZ2dQSd873p5p2Z69AnBGQCFPidDv+bkPA4OUr3qZrdzeD5tUw4yuTCJUHUMr/u3tebODtW5cRiFmc9vAx6ADgaIywgdPs8NfLXmPSlNmsfHe+/taLWb75akAESi20BqdTMbbU5voju7lwOsTDEbQyETIECN586y0+d911rFq1ypcD9bwPtGHY30xFKXXQrCOBSz9xmf74+RdwzTXXiD179qCVYuTIkfqbN9/MxRddJOxslmAgwLXXXccvf/GLPDBgWRaO4zBk6FDWrFlDrKiod5qMj3A1NTfrESNHi2qZYPpAf2C3qlmytcWhKm7xxCsr9C8WRnhqRwRqqoV0QCg3b3R0oHNI/wNP3cdm2g8IkSunHE/jpT1QMHFQgM9MTWm57mG+/pUvic5EitJxk2nfuJpQSYhTHjgaEfGdxXyUzuT1z79N+6ZOigZHKR5SRCAW4IhvT2fvOw2opMeAo6swLMGS76xl6592UjysiJPum4dr5wIoKMi2Oiy4eqknpTQybvacdGf6T39vc/6PhHkPuJtSytuNqGG3LGuTTQtbdCBu5fSNfA1eN+mCEARiAZqWtNG1u5uS0XHm3jYdERIkmzNk2my69yYZdtoAxp0/Crsjy57XGwhGLbTWuCmX8OAQR31zFquWLOajF3+Kb5wS4+Fzuwmmszg2FFUINmejXPNMJXPuiPDTF7O6vtvTu3Zu0ldcfD7HHHUUq1atwgoEcN2/PTh6+hTXdfM7JoZhYAUCWAHfhjsSCehx1/5YP/j7F1m1bAnbt21j9erVrFm7lsXvviu2bt1GIpHANH2F8hNOPLFP/+M4PlFyz+7dPPLII/nMIoTEyWaZ/+YCKisqxPjaMexIwN6EYP1ej60tDqWjxuiR1/xOf/hPVTxVP4BgdbUIOApDqlw/I1BaFJiEibxF2QHEstxhMaUfTq7ysDNZMgmbTLdDRErOmBzgjlMc/fmSJ/nLLSfz2auvpjORwjAM2jf6i3zTPj+BYIWFsj1Ubmi88dGttG/qpKy2hBPuPoKjfjSD6TdMJN2aZtHNK1hw0xJW/HgdqX0ZZn9zGvGRxQw5biAy6N8z7SmssMmOZ/Z4TpcrPaHWpDvTf829Ze9/+8T/RweIYafs1lA0WCW1nJPY1e0NObVGKk/n6vvcGqvnN2R1r9fTtLKV2o+OpPLwUuwOx88yOT1Wz1FEqsLseHY3ylUMPXkQXsaXMXVSLmWHlWAqk9cefk0kheTLF58mThvZzoY9sKVeajOMCEcF9dkAL24yxcMrDR5fs1cv3riEaKZR2F1J7Xme/xw1TKQQfyejXfg0jNzUXHkuw+cdxYjrHmFH1ceF1+Hw0gNfp7ikVHzozDOprKjgy1/+sv7d734rbrrxRjzPR6pKSkr45S/v7sMd6xlwFhcXc+455+Apf7aybfs2Nm/ezKRJk3ji90+yc+d2agdV0FE5kdT0szA/8rjYZkwXWSMqgmFD+M7doldOpWCba38108KySQhwlMKzPdyMwtMGxUGD2kqTU8aYXDjR0edWrKNk8/384c7r+dUvfyF27NgjpOET9M2AiecqRp0xjAmfHEuqzcYwpC9U3eWx5DurQMIxP5xNqDpAutVXcNeuIlwRontvivp3mtjzaj3FQ6KMu3gUlZNLfVlSLTCCkkxjhrV3bdaGaUgt1ZezaWclvda9f/dl8o+/NCBcQ91uhsRFHZu7S/Y836CGnz1YptsyvU1m7ksww2Ye99YFdgY9D3NpCrLdrj8HqQznmNR+kSFNSaolzbhPj6S7LsmPbrlZFFUP5vKrPqn/9MkW8ce1Jtc/6+puZYlwzECUB2jJKtGip4v4hx9hwNn7GLHjGTrfeUI3Ll8gksmCNR8hEVL2PkW1po8wXI//Rw+9w/PQ/kI4g8aPZdC5X9Idwz/J8npTuHYWOe9qEdrxlP7SF64nVhRl9KhR+pe/+IU4++xz8rfNcV0G1NRw1ofO4vdPPIFl+dnSMA3cjEsymcrT4QG6u7sZUFOTf78aqY866RRRcfGDXPeswElLpM5iGCZKiYMPscQBlkIIAbar0BkXkJTHA0wbhp5QrhhsNVDUvYPU3rXsfHWJeGb5ElasWi+SGcdv5XOaVMrzfLuzjEt5bZxpXxhPpj2DkZv8WyGTlo3t2F1ZBh5ZQ/GoIlItKd/vQ2kwYOSHhzL0hEG8evXbdG5P8MYXF3Hyb46maFgYnfFFHQKxEJvu3a7chJJm3Fw7pGXY79ezXv5vSqt/ZoAowEw2Jpti8ejtgSLzJ1se3eUOmFcpZUSind6HmGd7lE8sBQ317zQx8bIx6BxVRJr+fodyIFBiMe7CUYz92AjsTt/iV7v+DZRSkOm0OfymiSTqu7n16k+TLS4X8Zmn6EmpN1n1hWPE116y+N3KNAQMghET4bkkGhWdciDh6ivFgEuv1KPPW6OtbX8V9srn2bNuBZ2tXWhPvWdpVTj9jkRNhs04ggHHX6q7R3xEbGgqEV3bHYTlIPGQFSVkBp3I4aU2w0aO0pdccgmmaWIFrPxjRUiBpxQ/u+suGurrefPNN/NzmOLiYqYdPk0/8+yzHDlvnigpKaGrq5uy8nIAikRWl2kljjvnIv27Oil0oguzsghXmXlvm/7YxYWzeykESmjstAuepqw0yBG1JkeVdRNre4c96+eLNb97S/95zRrq6hoKaxfho3um0FrloHP/T01pIiOSOTdPzT1INMLwd4WEKci0+NypUDzQ+1IFiFmyMU20Kky0OkTn9gSTrxhP6ZgY6QJJoM6NCfa8UK/NmCE9pW5dz/rsP6o6+mcESM9QRlZXJn/Z3BG7wm7Jjt/40A415YZamW6xffcUKfwSaUKc6ukVNC5rYedf9zDyvGGk2jKES4K8ef1iSsaXMPmKsRRdMQbtap+45iiMoMTNeLhpX6fW8Vzmfvtw3rhuET+8+FxufvpP4pfeQK2vuEp/83Mf44Ipp3Hn24jXtthg+DfWwMNOuGxvlwJrEvGRkxg46SuMd7doo30dqbplonvXZp1u3i0yLc246c68m0MwGidaUUlx9UjKxs3RoRFH0xCexLIWg86NCqSNETJRjotZHCb75hOcWbGBPzy5RK9cu17IHFnyqKOP7lNKaa2pqqri9Tde57XXXmfz5i0EQwGOPfY4Ro0Ywc9+/nMmTpyoS0tLxY4dO/TEiRNxXEd0NTYwYPLRunbKbF76dRriEZQWBxGo7hvoMifbZCcdMCxmDQ9w/BCb8sSbeveiP/PbV55j1aqNoq8vbo8avW8J4VN5+j6wg6Egbtplzi1TiA6NkG7N5geCRkDiZTyKBkdBQ9PKFtyUv3mqXL+EVq7CihjYrTYta9sJl4cY87FhZJI50EcpjIBk88M7PeVoA0u/2/257j9y6/++9/hnoVgHzkXKIidLab3odDvu3B9MMeOT4vgyQRK0r7dqtzq8fMVbZLsdZnxxMlVTy1n36BZ2vVhHdFCEkx84CuUovLRiza820Lmzm9LRxdSeP4rYyCh2p4+lW1ETp93htc8uwmvMcOdLL+in9sZ56YqzxIePHMWl139VO4NO4bENJs+ss0EhRFgSMCSeUrieBiXAsLCivi5UxIKwCQGVxBIZLFPnWNchUqqIRAY6uqGzE8hmwQLTNPyNQdfDiAVw177EiQ136L/88XERjMbxXI/WtjZef+01zj33HD+L6L5okRTyAHp9S2srjz/2GNdddx3btm/n5m/erB977FGxZ9c2Zk8/SV92zdVccO0NYuqPUlil4T7yn33yhu4d5gkpyKYdhJacOsXkqPJ6nNVP8dJTj7Do7SU58Td/1dcwDYHW+YB4rysUCWKnsky5cjzjPjGKZFMKwzL8z2ZKMs0ZooPCKFvx6tWL6NyeYNSHhjHrpsnYKQcv7WGEJMFogEW3rWTH83uYfOV4xl0yknRrBiEFgWKL5sVtLPnaai8Qtww3o47t7u6e/7+Ze/z/DJB8kMTKYo8KR18UHRJx5911uOlk3Dx3RnmKQCxAx4YEb31tKZk2O8/1DxRbHP3DWcRGFSGU4PXPL6J9Q0fviwcNjvrBzJzMvZub1ptkmx1e//wisg1JfvHCi/qJ0Bxe+eSHBdvf0McfOYvLrrmewOjT+NP2EvHMZnQqlREEBJZl5M6NL9islPYLRi1Bmn092JUG7fqbawJfSFr0zFEEKA8jZOHuXs74JV9g6etPE46VkXUdjNw6bc9Z1Ur10Z4WBURHpTwWLFyoTzjuePHXvz5HZVUFs2fN5qSTT9ZHHnkkN3/zm+LRhx/gi5/8pF6/fSPfWDZC/GqRJlQc6GO7fIBBML6wQTaR4fDRET42tpG613/J07/5NXv3NOSPh2EavumR+uC9bjAcIJt2qP3YCKZdP4FkSybH5NYE4gG2Pb2bdb/ZzJybpzLk+AHsfaOJ+TcsRrmKwUfWMO7CUUQHR0g1pNn42Db2zK8nPqqYE395hK9sn7tRZsDgrc8t89J1GUNb+o9d7cmP/COD45+BYvUXgMKKWW9JIS9L1aWjQqAHzKsU2W4HafSyN8MDw4w6fSjddSkSu7oJlQY56sezKBlbjPY0iR3drH9gC4OOGsBxd82lbHwpexc0sPfNBkadORxh5qjltiJQYjHkqBr2vN3Cc7+6X3zq1JmIi7/Pdgaw47n7+dOTT4oti58Rx9S06/NnljJ00CBaM6ZoaVd4toOSAsOSmIbfEBumxDA0UioMM/e75fOFpCG1NKTQPYi539BrLaUImQmyd83l1i9/Wk+fewwL335HjBw+XEshhOu5eeawkKKvl7sAT/kU+YVvL2TP7j1i6tSp3HLLrTQ0NulbbrlZ1Nc3iPt/cz9SSvG1r35NX/W5a5l8zJlc+mgSHQsLXzdMFAy/faNNnSeMaJwOmwtPjHC0+Av3f+GjvPCHP9OV6O418tHaX3vVB+aegz1cA6EAbsZl7Hl+cKTb7JyIg0/2MiyD9s2d1L1Rz+6X9xGMBRl93lCKh8RoXNJC2+ZOtv91D9uf2cOWP+wksaub2NAijv7hTGTYtzHQniZYGmT7E7v1vleatFFk2sIzzrFtu+PvpbX/qwJEA9JJOl3BkFVnRQLntSxv8yomlsjo0AhuxsvLs7gZDzNiMOCIalpWtzPrpinExxaTabcxQwZe0mPbn3Yx6oxhesBRlaJ4RJTigVHq321hxJmDMYI54WLD702CZQGGnTCAuiWtvHzvI+Jjk0opP+1aNg27mKizjbqlC8Ubr78u5j/zsKjoepezJhocf/hQwhVFdKcNkejI4tkeSpI3HRV5E5w+bh+C/cWytRKyyEK/+E3UlpcYP222+NmdP2XDunWce+45Ytfu3ZTEi7GsgN935L5PT3nIXBaShkEqleKGG27gs9ddR3FxMd/97nd58vdPiEQiwRtvvM7AAQNExraZOGkKHz77XG54KsXb9UERDMveiXevapvoYUcDuMk0nz09qq23bxM/uOZK2lo7fEG89y6hDi4dL/zM4WU8Drt8LJOvqyXdlvErBUnei9LNeFTPKKd0VJy6+Q3sfasBnVaMu3gkNXMqMSyJ3ZEl2+UQKgky/JTBzPraZAJxM9dvCqyQQaouzcofbPCsiGW62vtOV0fX0/8IWPf/d4m1f6n1NLY+O1QdcI/+5QzTy8nd9HyRSvmzEiPgk/KEKfFsD8/xCBUHefnTb5Fpy3L648eSzfoDtEybTbAsgLK9PLW+p0QzIwYiK1jw9eU0LW/i0qs+o+3T7+GPOyFY9wfEq3eIrmW9UknjJo7Rc085iyFzz6SrcpZY2Rxl416ob3HAcSFgIC2JYYi+7qwF5ZEv3yPBacf9wWjItOdP6Nr168WPfvgDLYXk3nvvFW8uWMDo0aMYMGCgzyUyjJySvQ9kn3nmWUyYMIEf/+hHaK25++67efnll7nzrrsYOmQIrueCMDClYOmONPN+rVDRiL9HIukjwisKrA2y7TYXnRiicuOd+o7PXy+kYeQD4+86RIYgYFngaA67dixjLxhJsiWTU0/UBXZzuQ1RVxOpDNGyvI23b15Opt2m9oKRTP/SBFxb4XS6vvq/CaGyANmki+coX5fLU4SKAiz6ykrVtrpTyIjcnIh1T2UXWQ5uvPhvm0H6BKIZNeebprwk05yNZjsdPfjEGuEk3TwNpceIRjkKwzKoe7WBaFUYYfozj1BxkJ3P7yE2JErFYWXYXTbh8gBW2MCKWhghEyti5V7D8wXEAoJRpw0h2+bx+uOviLKmVzju+JPZZM6ha/zFouTwKdrINqPqd4rmpjax8p13xPwnHxJta/+qB5i7mDlWMGtKBYOrY0Jqg3RGkk55eGkPz1Z4jsLL+r+UrVBpB4WB2rec8JYnGDp9LiPmHYcpBaveeYunnnyKE086SZx88smMGDFCb926TVx04YUorbn929/RY2vHCtO0OOH443lrwQL97LPPEggEhEYze9Zszj//fOLxOI7r5uY0Aifrcs5DDnXZgA5YUuj91xxzESIFOLZiaIXkY2M2cfuF5/oidEr3u5rcD9/kgNLKsAxMDMygyazbpjD89MEkWzL+Q8QQBIoDWCHTRw2DEiNgYAQlTtKleFSUIccMoHFpK3sXNJLam2HA7Eo8pRCWX3o6Sc/P2dI3ZwqVB9n+ZB07/7xXBUsC0nXV+U6js+V/y7n6V2eQXp5WSdGHTUP+yW7PulNvGm8MPX2ASLfY/tJLbkAoLYHT7fLsR16j9mMjmf6lSWipaVnexitXL2Tw8QOY882peFmF3Z5l1wt1tG3qRHuasjElDDqyitIJJdgJG8/1n5rh0iDbfreHJXetYvjwIfq0G3/JW8aZrNmHCJV5Otz0mnAXP6CzK14SdnNrnzc+qHYs4448Vo+YfbyIDJkKsaG6Ixum24ZuG2ErX+rfFOhICBEIQYwWHWlYLBq3bmTNKy+we/ECHNsGJBMnTebEk0/Sd/3kR2L0qBEsW74KO2szYfx49tTVYZo+qfLhRx7hkosvFr4ecC67+BqaPhtZCyxD608/muI3aywRipt4qj/jIPKbfdl2m+vOj7D9zkt47pFHMUwTz/375mlmwERnFcXDY8y5ZQrFo4tItWZ9d+JcSbruN5tJt2SIDYoQiFnEBhcRKA0QKLXAhXBVEInUC76yVDSuamHo8QOY/bWp2Gknz7xAk6sITLp3dPPW9ctdK2iajuvdnexMXvOPbsz/VQHSM3dxi0ojPze0ca1ylXvkndPNyMgITpeToy6Tl3xZ/tN1bH9mN0OOHcioM4ex6ffbqH+3iUmfrmXydePZ9eI+ln5/FZk2+4B/aPSHhzHluvG+eJ3j19SR8iBN77Qy/xvvYqUVH/3KN3Tn4V8RL2+IktEQqkJb9m7kzueEt+Y5vA2LyDQ098nZpmXpgWPHMGjUKCqGjCQ2YAg6GEIrhdvRRaK1jpbdO0TLjh26fvsOHCebv8exkEFVWGFpTVsX2jaFSNqa6sFDdHEsJjZt2sjll1+urUCAknhcfPe73z2A4u73KmBIPyN87ek031kodLAsmKOS0Cvs3UfpRJPNugwpM/jc3G3cdPRUXCfrl4QHh2z7bcaFFL6GmO0y9LgBTP+fSYiAL/DWM78IlQVZeed6Nj+5433ZgOHyEGhNptVGaxh97ggO/+J4Mrl9+x4tSTMgWfi55Sq5Ky0IsTNkhCc3Nzen/hml1b8qQHxvr2MQxWtjb5BW8wKVAe/In003CEi0q3L9g1/GW1GTlXdsYMvTO/MvUD6xlON/MZfObd28fOUCtKupnFzO+ItHEaoKktjSzcbfbqNje4KaGZUc+f0ZOLabm8p7BEsD2I1ZFn93DU0rmphx5GxmXPNTvdSZy9L1GQEmRrlJsAhCmTpN/btE6hch9qwQ3bs207V3N67zweg2uQKdcABGlSiGxSBg+OWOKSV7Oj12dUJzt8YtWMi69LLLeOjBB3MrvTJPaVHaz1RBQ5K2PX3VE2keXmMRKrWEl1OAOUCItUdhXUK2Pc1Nl0TZcPeV/OlXv8YwzAOGe+8XIIZlIF2BMAXjLx/NuEtGYid92R2/78mJh0vAFSz+1koal7cQLgsx/XOTUcIlsbMbN+2RakqT7cySbErjpv0FqUBxgDk3TyMyMITvCOWX3OGKEGt/uklv/2OdFywPGlpxfGdr5xv/zOzxrwiQHlKoKisrG+wJZ5nb5VWWTyvRc743VWa6c08M0dvwhooDNC5to2VNK8HSIEOOqyFcHmb+FxZTv7iJmlmVHP3DWSj8PsAKmeis5u2bl7P3rQbGnDeCw6+fSLrNx+KVozHCkkDQZOOju1h17zqCQnDqdZ/TVafewJKWQWLV1iw67UI4qI2oQcQfGopQtoOoU0c0vQV7ywJa3n2Z+jVrcbxe/pZhWXjK3x0tCSgxMKYZUgxFFriKXiMg4R/2jrSgxTbZ1pxFS8mPf/pTrv/c53A8N2cv7bNtNRDIwaWLtjl89mmHpa0BHYobeG6vQvEBaxu57GGnXMYPs7hs/Cr9jRPmCNd10b7H9gc6A8IQmNLQruOJygmlTP38BMomlZBszYDyH2ZW2MyjZJ6jUK6HtuGN6xfTtrmD4ScN4cjvTSebyuZMQ3MjJdvDc7Sv7i/9vSEnJz+qsopweZC9rzax4va1bqgsZDq2892uzuRX/7dU9n/XAMn3I9Hy+PGWwcvZlqwedu4gOfn6WlFIaOwZollFpr9aqTRO2sPpdHnxE/PxbMXJ9x5FdHiYbMLNDaMUZtREJRXPXzIfL6M47dFjseImXlblM7GQECoL0bGqk3d/tIb2rR0MGjaQoy6/UpdPv4B19hixei+0tbqQzuZwzAAyYhAKQlkchhSndTy1lK6Vz4qGhS+xd916MqksxcDIEqgqgVDQJz1qLZCi1zm8R9SuqdNhQR2Mrh3PPff8iuOPOZq07WcOKQRWAYyyYa/LHfNd7l8rcE2LYEj6hjmy74CxrwhRrvfotPnapWGeueZYVr+5wN9t9zz9vmdAQCBoaZVRwogY1F4wgtoLR6AkPi/O9Pu7xPZuGha3kNjdjTCgbGwJVbMqiA4Ikm7I8sb1i0js7mbYCYOY9c2ppNvTPlNA5nzmZd9+o0fb2QwbpOszLPzsMk8iDSV5J9GWODr34dQ/q7T6VwdIQT9SdJVlGnenWzPOxKvGWKMvHkaqKZMz09E5dUXyC/2BmEXn5i5euXohseFFnHzvkTiZHj3XHIzo+DXwwq8sZd/bTRzzo1lUTCvDyyisqIGTcvMCZIFYAOHBlid3s+o3G9Cuoqw8Ru2xxzPwyPN0cMyxtInB7GuB3fsQHR02aMcXqzUDRGIGQ6pgUo1DcXqjTu98F2Pb2+hdq0XX7u3YrW2obG5iavjatFpC2oG2JLRYYT591TX6tlu+CWaxADt3a/zP05VSvL3N048td8QfNgpSBDCKDIycXXOvGUJBjOSOvU+J0TitKT51brFOPPMV8eQPf9ATHO//FLMMpPIn4DWzKzjs2rHERxeTabP9MtgUWCGLDQ9tYf2jW9Fe37MaLg8x+cpxjDxnCJ0bu3j9C4tIt2QYeeZQZt00mVR7Jr+wtT+7GOVvZBlSsPDzy1VqT0aIkGw1tDG9vb39b1Jo/08NkN4gKY7+MBCwvpxuzziH3zTBGnLaQJItaQxL9lVU1xoZMMg02bxw6XwiNWFOffBoHLtX8Bjwm8TSIAu+tISGJc0c/b1ZDDyuisbFrex6ZS9Trx6PETbIJLI5GiqESwJ0706x6bHdbH12e/61KqpLGTljrh59xMkMGj9XuGVT2NgWZO1u9J6WjMBVvqexNgiGTCoqoLoUPaAoK4rdRoKdWzH2rUG17tLp+h2iuWEf3R0JRLhYt1fOEINOuoIzp0wh5qV0WCihDYMmW9PQKdjQqFjbDDsTBhgSGZFYUpBbX+kjztajyNijKigNsB0XUg6XnFJEeMn39a9vvBFpGOL9gsOwDExp4NmK+Kgixl8ykkHHVeM4CiflYhgSpTXBIp8ntee1fZgRk9qPjqBqegXaU9TNb2Drn3YBMO/26Qw9eQBNS9qZ/+XFuGmX0R8exuFfOoxMws5zzvIZsKe8LrFY/PU1unlhq7LipnRddWKyM/naP7vv+HcKEN/IQ+DG4kW/NQ3j/Gy348z5zmSrfHYpmZYsMtA3SJTybbleveYd2jd2cPxdR1A+tYRUcwbD8hGUYNwitS/Dy59+C+VpTn3gaIqGRXn5k2/RvqWT2OAipn/hMKpnl/sNZtY38jPCBoGISevqDrb+djd7327GcTO90WxA7dQpTD35DH3YnNNwSw5n0d6IeHGzh5t1ICQRHuhsTiPdtAhEIF4ERSEoMtBRwxV4Dl0Zqfcmg3QkEHR1+8rOwuhdZkKA5f+yLOE/LlU/9YTWffaftATHUeikQ0VZiEuOcnXj87fx+Le/LYQ0/HnHQVAraUoMJMIVhKqCjP7IMEacM9h/mHRkc1nQH/QFSwNseWInK3++nvjwGEd9ZyZFIyO+ABwQKAqw4+k9LP7uCoIlQU6690gig0Lseraexd9dgVaacReNYtJVtdjt2bzHJfj8vEhliLV3bmL7E3VOqCJoZezsZ9OJ9M//f/Qd/4pB4fvSUbKZ7NPBSGC2aZpjd79a71ROKTOKhkdxul2E2Tuj0so/yOF4iD2v7aN9SydDjhhAtCbstwnFAXRa885tK+muSzLwyGomfWoMa365iV2v7kVaErvDZudLdaTrM1RPrcSKmb5pvQIn6RAZGGboyQMoH1eM3exgN7tIbaCkpmlvA2veWiBe/d0DIrHheXFWrcvlx4zSsfJitjdKYaccTVCIYERimhrPVXR3u3R0eDS1KVHXKqjrMGnuEiLjusI0FVZREDNsYoQNzLCBGTKwggLD9E1zes60ILfhB1oKhMgV7Z7yzTi9jIOXciktknxobogTB63itW9fLF566BEhpZFf6OovY1jSABdCpSFGnTeE6f9zGNVzK8imnDwNPd9Y5zQKl3x/Ndluh7nfnEbJhDjdDWm0p1FZRabDpmZGBW0bu2jf3EFscBHFI4soGx/HSylSjWkmXVmLGTb8QikX4cpVRCqCbHl0J5sf3OmEK0KWbTt3pBPpb/3/Do5/lwDJVwhFkdifPe2caEhjyK6XG9yKKSUyNiziS9obvfZubtqlrLYE7Wn2vF7Pjuf3ILRAd2kalrew5Aerad/USbg8xFE/nEl3XZJ3vrUS7WlqPzaSI2+fQaopw86X97L7tX1UTSsnUhPCs3N7CLbCybgUj4gy7OSBVBwWx0k6pPZmEEr6AzI0+/bU89Jzz7H8lceZU9rCxbOqmDJyMAnHFHVtnvZsT2hDELAklil9GR1TYBi+d7cUMrcHDtrX2Rb+/9ZaqRz8L3IfXeSEEbIeXsYVXsbTXtYTKqdgMrTMYspwi3NmBDh56Ga977nv8fANV7Nn81bhi815B6JSARMDA1xN0YAooz86jGlfGs+g42vwlCab8EtXaRSwmLXGyJW56x/dSiBqMeFTY/GyCsOUBSr4PvvBTSr2LWrEKjIZevxAMm02FZNLGHrCQGJDozgp37pZ5BgUkaoQdc/Xs+anm91QWdDKZt0/pxKpy/8ZPKv/hBLrAPi3uLi4DEO9LDx5uIfnzv3+VLP0sGIyrdn8tB00SkOoNMC2P+5hza83ku3uO5woGRNn9k2TKZ9UxqtXv03j0maKh8c4+d55uChCsQAbH9vByp+tI1gS4OTfHIUZM1GOh1/Q5OjuwgcGpBS0rmln11/3Ub+gmVQijUAiLYHr+A+1SNjizNNP0Sd+6BIYfjyLWit4ZRtid6vj+50FBJgS0xQ9dmo9PNuCJTqBFv7ncz2Ntj2wfTp8PGYxuspkUDnUxNBlYY+I7kJ4LejEbhq3rmTDO6+Ld195ne6upH9TCxpyIf3/L5SfAQzDID4mxtDTBjL4hBqCZQGyXQ5uRvWWbVLk5hu9m8dmQJBusHnhsjcxIwanPnKsr+hfUAD2WDPve62Rt29bxtDjBzLnlmm+m7EpwPQhXJHjtXlZv6yqf6OJpbetda2IZXrafaO7I3UqvkvoP20Y+J8SIL10FIoqZLl4EYfDlVDOEd+fapVOjJNq9SkpefxcKUIlQeyWLM1r22hb34FWUDo2zoC5lYQqg2x9ahdLvr8aIQRH/2gmFdPLsNt9WKl4UBFLv7eGzX/YwaizhjHjxkk5G4b9vuyc7Ecgxyfq3p1i35uN1L3WQMfWbjzlYZgmjnLytg9jRw7VJ592OtOOOodU5Uy2ZUtZ0QibG7Vo6FZaZz0fhtJ9fb194NL3u45HpZ42NChOGI8eF0EUe7t1w+61bN68VuzavomdW7dSv7tOtzQ1ic7O7r5Pm1zW8FXthW8I6vlP93BVkKrpZQw6ppqKqWWYURO7K5s/sEiBFTHzLl/9ND6YlslLn1xAV12Sed+ZyeBja+huSGKY0v9IBkTKwyz48hL2LmxgxpcmM+LDg33pUEMUOkLjOYpoVYj6+c0suWWNG4gETEe7640i46hEXaLt/xdi9Z8QIPkgIUZ5zIi+aGhjuqc9Z+Ztk63KGaW+jqu5n7pgwMAKG/kyzHMVXtbD7Va89KkF2O02oz80jBlfmUSyJY00pb+uGTJI7cnw4qfeJFoV5uSHjkblapv+drf9XkD7PULExEu5tK9LUP9WIw1LWumqS4Hyjahd3Py9HTd2iJ4z+whqJ82hZOhkdPEwuq0akXCj2gXRrf24ipgQEVAehSFhh7hsItOwQa9Y8iYL5r/B0mWraG1PHOR7E0jT6LUh0CCU8Pf7EUQqQ1RMKaVmTgUVh5cSrgrhugo36fkMhrxGln8cG99tZe+CBqZ/8TDUfk298jSR8hDrH9jKmvs2UjQwytHfm0l8bLG/wmD6s40Vd21g0xPbiA314Xh/2anHHCLXc2R978H6N5pYeutaN+DT17d4tjo+nU7X/SuD4981QPJBEovFyrH0C1LJGU7acQ7/nwnWoNNqSDfnnvIF7157Og/OaK0JxwMs/PoK9i5sID4ixnE/m+Pj6/kvWyMsid2Y5flL5xOuCHHqQ0ejhX7/RK5z1Hzpr/maAUm2M0vrmnaa3m2jbW0nyX0ZVFrhuC4Ofcu/yoooQwYPYsTQoZSWlul4WSWRaBTHztDR1irSdoZt23ayccs2Wlo69usdZF4kuxDiRfn3wPewkZhhg3BViPJJJVTPLKdsUgmhiqAvqJdycDN+2WUEDN86wNW+P70lUY7m+QvewEm5zLxhMiM+NIR0e+8At+dfNiyD1659h44tnQRiFmPOHUGsPILjuux8ZS+t6/098qN/PIuiIRHclFcAx/sARrQqTN1LDSz/zjo3ELZMF2+Lm/FOyGQye/5/wrn/aQHSm0nilMRl7AkQJ2e7su64T40way8dSbrNp//nB4QUKHwXW+x5pZ7Ft68EYOYXJjPu8pG0b0vk7Lv8mjc2uIj1921hzX2bqJxcxrF3zibTZfuWA+8TJaJHw1zluEdmLlhMiZt06d6XpnNbF+0bOujcnCTVYJNNOGQzWdwDgZiDb+gFLKSQviC2Uj4YocnR0wUS35HJKjaJVIeIjYxSNiFOfGSM6MAwgZIA2gMn4+vcKuWvFQTjvpOXk3TwUj5bwYgaZLsczIjJpse2s/qejUSrI5zywJF4BSJyIld2GkF/ke3d766i4d3mA977kOMGMunKcYSrg2S7HIycPXSPvGukIsi23+9m7c+2uKHioOkod7Ob8U7KZDK7/x2C4989QChIrzJWEv21aZifSrdl3OEfHmRM/lytcLJeb91ccNQ0/hbg7pf3suJn60HDtGsnMOqcoWip8bKKQJFF27pO3vjiIrKdDrNvnMqwMwaRbvdFzfquQPR30/oSO3Q+i/lyNkZQYgYNpCHwUh52m02yIUNyd4ruvSncDpd0s43d5ZBNOOjcXolWOlfK+Y25MATCyq0Ah03MqIEVNQlVBInUBAmVhYgODBMdEiFYGsAIm77Dlq1QWc9nDGgfCtNKYQQNDEtS/1Yju1+pp2V9O9nOLNGBEaoPr2DYyYMonVCM0+ny8pULSdanmPSpsUz41BhSzRmkKfPlkWsrAsUmwaIA+95sIrGjm2zaoXhQEaXjiykaGsFJe3gZD2n4m5M9vUeoxGLjfdvZ9NAON1waMl3P3eDayZPTaer+XYLjPyFAeoJEAzoaC98WCAe/kWnJqKrZZcz4+mGSkK/zK0253/xMEyoN0r6hk6U/XEPbpk7KxsWp/ehIIqVh2rZ1sP6RLdgJhwFzKjnyezOwu3M7CO+FRe+XQ8hX1Dr/37Wn+7JqJUjLP5jS7NlB98l5nq1w0y5eVuEmXZSjchp1fnY0wwZGxMDo+fmQv/4rrV7VdZULLuX6WQYt8pkyX1Aqv3eym7Ms+cFqmlb6Oy/hqhCh0iCd27t8siAw/frDmHD5aNY/vI1lP16DVWRyym+Owiyx/L+jfdvtSEWIxPYk6ZYMA+dV4ab9FWqtNK7t+f1Ifi/e3wY0ggZWyGDVjzaw+9l9TrgibDmu+5rK6guSyWTTv1Nw/KcESM/7lIBXVBy+yrCsX7hdrowMDXkzvn6YUTyqiHSb3dto5h7+nqN8iBbB9md2s/rezTjJvv3A4GNqmPW1Kf4etqsPkNrp8b3QB4TJfn8PneMQgRkxcwISHj2Sq1r7Cik+pyxHtjX8QyylAKNnfqDz8GqPKxeK3Nafn13oVaD3X6dnLf4g32ZPCYijefmKhSQbUtTMrGTyFbUUDYtiWBKny2XzkztZ/+gWkHD8z4+gamoZL31iAW2bOxl5+lBmfX0yXfVJgvEAVshi3/wGlv50LemWDKfcfzThgSG8jL/63NcVWPvT97iF0+mw9Pa1um15pwqWBYxsxnk62ZW6AJ+E9m8VHP9Og8IPOnE3s7b7rhkw3zbD5sluu1u8+6V9bqQiLMsmx3FtL+9p6EOdPtbuuYqqGRWMPGMI8aExYoOLqJ5ewWGXjqX24hG4tgee7sPnygeD6F+hoJAtW3gQDUtS/24Lqfo0VtTCipp4rk8H6REuMCMmpiXzgIFWfjBBr/21l9W+PYSre1RP/X85xwLusULuWQ84aHCQs9IuC7H6lxtpWNLM4KMGcPQPZiLjhr/zbyu0JRh6/ADs1iyt6ztINWcY/eGhBGIBdr+2j84dCWpmVlExqZTEtm6W/WQda36zCTflMnBeNTWzK7GKrPxn6Pm8ucEnkcogHas7WfTVVSq5PSUDcUtmbOcHqa70Fbmg+JeiVf/pGaTwMgE3GA8ODxrBR6ViXqbL9kacPVgedtUYoQ3IJnxrrr7QpL/nbkXNfM/iZT2cbjd/cN+7pDowQPR+REGdmw88d+EbpFszhEqDnHD3EQRKc6VJTuKna0/Sh14Hhn0hNSkIFgdJN2VItfg08HB5iFBFCM/1cJJOTo9Xv+e7OqDl173acVILnr90Ppl2m5PuPpL42CIynb5QeA+4IQMSt8Pl+UvfQBiCUx48mqJBEV695h1aVrf5lt2HV7D2N5sAqJpawfhLRlI9qxI3kxNaKHjkqpwSZjBisvWJXWy4b5trWKaJRcZ1vKtSXamHCkvof9fD9p92uYBhd9o77Qn28UV7Iz8KlwY/u+vP+2hb1+lN+exYo2xaKZm2rL9XYPRkE4n2NHZHNl+e9DyBD/bs0PsdyD4mnb0y1jkNEpCWJN2c8YdrAjLtNhse3sbMr08m1ZxGWgI8WHijL5B36qPHEKkJoV1Yfsc69ry6j0y7vz4sTcGAWdWMOW8E5VNL/HVWWRgcffuefiM7RxuXAYN0g28pYYQMgqUBXFthWL0ruT4JUWHFTV9RfV8KuyVLdGiE8ReNYsGaNppWtNK0opWSMcUc9omxDDyyCqUVmXZf7M+/135Uak8TLg2Qac2y+NtrdcOCVi9UGjQ97W1yHO+ydFd6Mf8CbtV/Q4CQT8nryXaT+ly0NLooUGLdldpjly/88kp39PlDjNEXDheY4CRcn0vUU6cbvpjA/ger79HLrzX1CZPeB3Rh4OSW8pRCWgaZNhvP9giWBnFTLjtfrmPMx4YTGRhGuQo34/pOWvEAoZIAUgrevGkJTSv8prlichnhiiCphjR7325g79sNzL3lcAYfV4OdyBbwovR7Z5Ce33LrmUKK/L645yjysdEjWtcDDAiBlzOlEabASTgMmFvpq8i02Uy+ehwDjqgEQ5BO2Agt8sJwfq+hkAGDUInFvtebWPvzzV62zTFCFUHT9dSTIiqvStd1t/0nBMd/coDkRmN+855sTz4ejAcXBS3r55a0Ttv88G7q327xJl831qg4vJxMp43KqZvsd4YKjnnPE1mg94Nz866tPYftgJyS21Ux/AwCMPiIGooHF7HinnWse3ALc2+dhqMUdpvjizbXRIhUh1lz32aaVrQSrgxxxK0zKJ8U919LCFrXdbLgpiV5gxt/SC76fAK9X7lXWDjnp9WOJlwZJjowQteebhoWNzP+0tF07u7CMHvBgNigKDv+UkemzSZQbBGuCaNcjZN2mfGVwwgWBwiWBf0srHQODs/1Gp5PmQmVBsi2OCy/c72ue6nBCxYFTCNmdjhZ54buztR9tOV7X/c/4ZBJ/rMvncsmpt1pb090dJ/uKu/aQInZmamzjXduWOWu/NF6pTOKcFnQR4I8fUDzJfrMM/R+f1bwt3VPSbUfFJzbCJeG318ABEoDTPjEaCKVIererKdpeRuh0mA+gKIDIggt2PP6PoQQjDt/FNWzykm1ZMi0Z0m128RHF3HiPfOomV2Bnei7M0G/Ga3/9lJ7voje6LOHgYZ1D25m7xsNFA+KEiwJEi4LEa2KUPdaA8vuWIvWmrHnjSRY6juDKUcTqgwjLOFrJ4uCrKH9ALSiJqFiiz3P1/PmNUu8fa80iVBp0PSEeiWTtWd3d6buy5038e+GVP1fQbHeL5tIQGQz2XcDZvCPMihHmQGjtm1Vp9j7RoNrBAxROr5EGGHDR61yCoz5x2x+6Uj0HQb2cJv6WDBxAIqlNVhhk61/3EViZzcjThtC+dQSAtEAdfMbSGzvovZjI2la1sK+hY3UzKykYko5q3+9EZVVTPrMOGTAf8kezWLPUUQqg5gBmd+VKMQSxP5hIfpHXXqkXSsnl5HY2U375k52vbyX1L40dmOW5pWtrHtwC+sf2oLKKkaeMZTJ14zLlXQ56LznwWLInMyv34TLoCRcGqBzQ4IVP9igdjxZp6SQhowYXZ7jfr2rM3m1l/Vac9WK9592sP6vBAgFSIiZzWab7bT9uBUM7LSixhSdFeV75zeKpqWtbrgsKEpHFQlhGf4gq0eipqeC2m9O3jtr0LkDKApiRfRtmA3Jpse3k2mzmXDJaERAUFYbp21dJ81r2igaWEQ24dDwbjNDjh9IfGSM9Q9vQQjB6I8Mx4yavsEMAi3AMCQr79rA9j/vxioOEB9RhGerviuqouB9CA6O9+YCbOhJAwlEAyR2ddO0spV9i5toWNpC994U5eNLmXLNeMZfOopsVzavdFmAL/tonafzYg3Zlizr79mq1/5ss5dtdo1A3JKe9v6iBB/vbk/+pXCG9Z94qEz+711uT+nY1dH1UDwe/7My1I3BksD1yR2p4LvfXK0rDi/1xlwwzKic4XtxO0kPKcmpAfYtsvKxl08iuqDuLzg/psDp9rWezJBBqDyEVhrHdply3QQaP93K2vs2UTKqGIBQRRDDkgSKLLJdDqmGNEVDwrgpD8Py5UBlwKR1TRsd27uonFGODFSjlZsPaJ2zYxB5lR/dtxcpDN5c/+QkHcZeOJzhpw0isaObdLONNAVFQ6LEhkcQliTTkQuOnp5L+D2K8nzjm0BJELvVZuN92/TOP+/1nIRrBuMBUws2ep739UR78g+FkPy/K4T735ZB+ssmhm3b6Ww6+4oZNP8iLFFmha3DkrtTsu7lepXY2q1ig8MyNjQK0ucWoTnwydlTzPSion2yh1aKQNiiY2OCrX/eRbgixLgLRuC5CuUoiodE8VKKvW81kGxMoT3NqLOGUj6hhNa1HSR2dJHtyDLqjGFo4f9Mj4JL/dtNJOtTDD6qhpLaYryMlwtk9jPG6ZXNEfSX4XrV3t2UhzAF0UFhSkbHiA0vwooZuGmFl/Zy/YXIl47KU8igJBQP4nRm2fGHPXrVHZu8poUthhW0pBGWra7n3p4Idn/Sbs6u/k/sNf7bAmT/kZnhZJyGbDr7lBmwXpOWGGiFrDGJbUm556V6ldjZraKVYRkbHEEGTVxb5ZXm6QfXOlgZo9EYAZPYsCjVMytQjkIaEiftUTWtjN2v1GN3ZAGovWAURtigZGQxO56vo2t3Nx1buigbW0KoJIgVMsk022z90y6yHVkGzK2ktDbuE/+kOLAd78km4uDDzbyeXI6s7GUVXsbD62EgCHKC2OQpLWbYJFQcwG6y2frbXXrtXZu9xoWthtRCyqjRpZS6W+J8ItGR/ivdOPSuxur/CwdI8N9z9XmqxUpjZwgpbhBKH+MmPYSBLp9WooafOVBWzCgXRtjASbq+4onIDRUPGM0VIEVaIwOCQDSAZ3s4KTf/n5WnCcYsWla1s+GRrdidDvO+Mx0zKrGiFq2rOlj0rRWkW3yEK1gWxAhIUg3p/LmedGUtEy4dnVsYE70j8gOeBQXgwQFTRJEvx+jhjhW8js7JpghTYkUN0NC5OcGe5+vVvvnNyul0zECRBabo9pR6QHjyzkQisa2gnPL+rwTGf2OA7A9tKz9QIqdLaVwvkCe5KQ/lusRGFblDTqyRA4+qkpGBYTzl60EpR+elb3qPYkHfov1g6GHS5o+t8JmsVsT0LZ1tD+V4eeZvsNgi2+Gw57UGWte3+z2AISifUMKQYwfQtTdJsDxAfFTMp3P0J7bWz3RHiL4KPwfM4XP6U/6KrMAKGxgBid2WpXlFm657sV61ruoU2kFaURMtdKOn1MOOMu6xewPj/1TGOBQgfcvL/BcbK40dAfpaKeQ5OqvDbsbFKrW8ymkl1BxdKSsnl4pgWQDP8ancKuvPKYXsW3EdnJyS223XOh9gPUIN2tNIy88mPYda5FQR3YyHtAy0p3w6ueinvOqnNT/oV51nE/vUGCNoYAR8u4n29Z26fkGTalnWrtP1tilNiRE20EKvU673kHLFw8lksrHg/vXIf/6fvf6bA6T/QKmIjZXITwj0+biMcFIuGkW4OuRVzSijek6FjNcWi0BZAAG4uU29nmPi243t71R2cFJLXnZa9YpD7D/D6FG779kjKVzZ6n9IqPuUfv57E2CAGZQ5WVew27N0bOrSLUtadcuKdpXcmzHxwAwb6IDo0ugXtcf9XZO7XmZ+fvJt5u6X+m84HIcC5CA9SnV1dbQ7232WlOIyKYyjhEfUSbogNKHKgFd6WLGunFomyyfGRbgmLETItzHryS4q1+SKntmE6OUA96o09xNAeXFa+gmk/YJL90LQPeq8PX8khECaAhmQGDklGC/lktyXpn1Dl2pe0abb13eSbcsaKIERMsHEQ6h3UeIPImg81dHQsWu/kcD/uR7jUID8fYEiKeAKxePxEVjeiWh5toAjcHWJm1E+haPYIDY04haPiYn42CIRHxMTkeqwMHO0eq18Ax/laLSrcugQBYVRoROt7p3+6f0a796T38tGzhlk9hARpen7dvhqIZpsR5bkvrRObO3SnVu7VGJLN6l9GdOHcqWvZWVoW5hypdLqL56n/5JsT67tB+VU/22BcShAPti9kfvX2ZGKigEh4cxztT5dCnGkdvUYnVud1VpjRg1CFQEvMiCsi4dHKBoWk9GBYREsD4hAkYWMGPm123xJpXs2B/sZ8/nrhQW9TkFL7im8jMZNeWTbbZ1uskk3pHV3XUp37Uzq1L60zCZcqbPaV5YPGL73n8EOpfS7SvO8cLMLEwl7636f2/hvKqMOBcg/Lqv0PTTTsUp2RyZ42jhGao5EiMl4eoR2CSgvlzG0RlrCF1uIWSpYFtDhyqA2i01C5QERKgtimSZm3BQiJBFC91JetEYoyCZcnG4H5Wptt9vYna52Uy7pRptsuyOchCOdpCtUViOUL5wtLImwAEnKMMQ2hV6jlVokpF5YEq1cv2vXrsyhoDgUIP/MzAL7T4qPOcYsXr9iuFJqommYkzzljZdQq101XHuUo339KX/HvECxWei8oiE9dskFpZXWoF2Vr7h60C9h+KxaYUqExEGKJmGIBg1bldartNarHddYm+no2N1PiWTk/pFDQXEoQP6p96+wFOuXWlFcXFyWUZlq0zKHGZZRYSBGKq1KDGkOd10vYhiyCEWF53nBXMUveuYoaLSQwpOmmdDa63A9lTFM2aQcb58ZMNsdx9tpSrNBS703JEKNjU1NyYPYGxQGxL/tiuuhAPnvCBhR0Cx4H+inNLLgEBdeGtBCCFfrD3ymDfqsPB4KiEMB8p8VOIWH/29BiSQg+vnuDgXCoQD5r/8uDh38Q9eh69B16Dp0HboOXYeuQ9eh69B16Dp0HboOXYeuQ9eh69B16Dp0HboOXYeuQ9eh69B16Dp0HboOXf/i6/8BQ6vf943IsZkAAAAASUVORK5CYII=";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${docTitle}</title>
  <style>
    @page { size: A4 portrait; margin: 18mm 20mm 18mm; }
    *  { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #000; background: #fff; }
    .doc-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 10px; border-bottom: 3px double #1a5c1a; margin-bottom: 4px; }
    .seal-img   { width: 80px; height: 80px; object-fit: contain; flex-shrink: 0; }
    .header-center { flex: 1; text-align: center; padding: 0 12px; }
    .hdr-republic { font-size: 9pt; letter-spacing: 0.5px; color: #333; }
    .hdr-province { font-size: 9pt; color: #333; }
    .hdr-city     { font-size: 11pt; font-weight: bold; letter-spacing: 0.5px; }
    .hdr-brgy     { font-size: 15pt; font-weight: 900; letter-spacing: 2px; color: #1a5c1a; line-height: 1.1; }
    .hdr-office   { font-size: 9.5pt; color: #444; margin-top: 2px; }
    .hdr-contact  { font-size: 8.5pt; color: #666; }
    .header-divider { border-top: 1.5px solid #1a5c1a; margin: 3px 0 0; }
    .control-row { display: flex; justify-content: space-between; align-items: center; margin: 10px 0 4px; font-size: 9.5pt; color: #555; }
    .doc-title   { text-align: center; font-size: 15pt; font-weight: bold; letter-spacing: 3px; text-decoration: underline; text-underline-offset: 4px; margin: 14px 0 6px; text-transform: uppercase; color: #000; }
    .doc-subtitle { text-align: center; font-size: 9pt; color: #555; letter-spacing: 1px; margin-bottom: 16px; }
    .salutation   { margin-bottom: 14px; font-size: 11.5pt; }
    .body-text    { text-align: justify; line-height: 1.9; margin-bottom: 12px; font-size: 11.5pt; }
    .purpose-line { text-align: justify; line-height: 1.9; margin: 12px 0; font-size: 11.5pt; }
    .validity     { font-style: italic; font-size: 10.5pt; color: #333; margin-top: 10px; border-top: 1px dashed #aaa; padding-top: 8px; }
    .or-box { margin-top: 16px; border: 1px solid #bbb; border-radius: 4px; padding: 8px 12px; font-size: 9.5pt; background: #fafafa; }
    .or-box table { width: 100%; border-collapse: collapse; }
    .or-box td    { padding: 3px 6px; }
    .or-box td:first-child { color: #555; width: 110px; font-weight: bold; }
    .sig-section  { display: flex; justify-content: space-between; margin-top: 40px; }
    .sig-block    { text-align: center; width: 44%; }
    .sig-space    { height: 44px; }
    .sig-line     { border-top: 1px solid #000; padding-top: 5px; font-weight: bold; font-size: 10pt; text-transform: uppercase; }
    .sig-title    { font-size: 9.5pt; color: #444; margin-top: 2px; }
    .sig-punong   { font-size: 10pt; font-weight: 900; color: #1a5c1a; text-transform: uppercase; }
    .doc-footer   { margin-top: 28px; border-top: 1px solid #ccc; padding-top: 8px; display: flex; justify-content: space-between; font-size: 8.5pt; color: #777; }
    .watermark    { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-35deg); font-size: 64pt; font-weight: 900; color: rgba(26,92,26,0.04); pointer-events: none; white-space: nowrap; letter-spacing: 6px; }
    .no-print     { text-align: center; padding: 14px; background: #f0f2ff; border-top: 1px solid #dde; }
    .print-btn    { padding: 10px 28px; background: #1a5c1a; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; margin-right: 8px; font-family: inherit; }
    .close-btn    { padding: 10px 28px; background: #6b7280; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; font-family: inherit; }
    @media print  { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
<div class="watermark">BARANGAY STA. RITA</div>
<div class="no-print">
  <button class="print-btn" onclick="window.print()">&#128438; Print Document</button>
  <button class="close-btn" onclick="window.close()">Close</button>
</div>
<div style="padding:0;">
  <div class="doc-header">
    <img src="${CITY_SEAL}" class="seal-img" alt="Olongapo City Seal">
    <div class="header-center">
      <div class="hdr-republic">Republic of the Philippines</div>
      <div class="hdr-province">Province of Zambales</div>
      <div class="hdr-city">CITY OF OLONGAPO</div>
      <div class="hdr-brgy">BARANGAY STA. RITA</div>
      <div class="hdr-office">Office of the Punong Barangay</div>
      <div class="hdr-contact">Horseshoe Drive, Sta. Rita, Olongapo City &bull; Tel. (047) 222-2165</div>
    </div>
    <img src="${BRGY_SEAL}" class="seal-img" alt="Barangay Sta. Rita Seal">
  </div>
  <div class="header-divider"></div>
  <div class="control-row">
    <span>Date Issued: <strong>${dateStr}</strong></span>
    <span>Control No.: <strong>${controlNo}</strong></span>
  </div>
  <div class="doc-title">${docTitle}</div>
  <div class="doc-subtitle">Barangay Sta. Rita, Olongapo City</div>

  ${bodyHtml}

  <p class="validity">
    <strong>Note:</strong> This document is valid for <strong>thirty (30) days</strong> from the date of issuance unless sooner revoked by competent authority.
  </p>
  <div class="or-box">
    <table>
      <tr>
        <td>Service Type:</td><td><strong>${serviceType}</strong></td>
        <td style="width:120px;font-weight:bold;">Request ID:</td>
        <td style="font-size:8.5pt;">${requestId}</td>
      </tr>
      <tr>
        <td>O.R. No.:</td><td>_____________________</td>
        <td style="font-weight:bold;">Amount Paid:</td>
        <td>&#8369; _______________</td>
      </tr>
      <tr>
        <td>Received by:</td><td>_____________________</td>
        <td style="font-weight:bold;">Date Received:</td>
        <td>_______________</td>
      </tr>
    </table>
  </div>
  <div class="sig-section">
    <div class="sig-block">
      <div class="sig-space"></div>
      <div class="sig-line">________________________________</div>
      <div class="sig-title">Signature of Requesting Party</div>
      <div class="sig-title" style="margin-top:3px;">Date: _________________</div>
    </div>
    <div class="sig-block">
      <div class="sig-space"></div>
      <div class="sig-line">
        <div class="sig-punong">HON. ROWENA V. CEREZO</div>
      </div>
      <div class="sig-title">Punong Barangay</div>
      <div class="sig-title">Barangay Sta. Rita, Olongapo City</div>
    </div>
  </div>
  <div class="doc-footer">
    <span>Processed by: _________________________________ &nbsp;&nbsp; Date: _______________</span>
    <span>Documentary Stamp: [&nbsp;&nbsp;&nbsp;&nbsp;]</span>
  </div>
</div>
</body>
</html>`;
}

// ── Main print function (dynamic → legacy fallback) ──────────────────
window.printDocumentTemplate = async (id) => {
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

    // ── 1. Try dynamic template from Firestore ────────────────────────
    if (r.serviceId) {
      try {
        const svcSnap = await getDoc(doc(db, "services", r.serviceId));
        if (svcSnap.exists() && svcSnap.data().templateId) {
          const tplSnap = await getDoc(doc(db, "documentTemplates", svcSnap.data().templateId));
          if (tplSnap.exists()) {
            const tpl = tplSnap.data();
            docTitle = tpl.docTitle || docTitle;
            bodyHtml = resolvePlaceholders(tpl.bodyHtml, r, id);
          }
        }
      } catch (_) { /* silently fall through to legacy */ }
    }

    // ── 2. Legacy hardcoded fallback ──────────────────────────────────
    if (!bodyHtml) {
      const legacyResult = buildLegacyBody(serviceType, r, date, controlNo, dateStr);
      docTitle  = legacyResult.docTitle;
      bodyHtml  = legacyResult.bodyHtml;
    }

    // ── 3. Open print window ──────────────────────────────────────────
    const win = window.open("", "_blank", "width=820,height=1060");
    win.document.write(renderDocumentShell({ docTitle, bodyHtml, dateStr, controlNo, serviceType, requestId: id }));
    win.document.close();
  } catch (err) {
    showToast("Failed to generate document.", "error");
    console.error(err);
  }
};

// ── Legacy body builder (original hardcoded logic, unchanged) ─────────
function buildLegacyBody(serviceType, r, date, controlNo, dateStr) {
  const dayNum    = date.getDate();
  const ordSfx    = ["th","st","nd","rd"];
  const v = dayNum % 100;
  const dayOrd    = dayNum + (ordSfx[(v-20)%10] || ordSfx[v] || ordSfx[0]);
  const monthLong = date.toLocaleDateString("en-PH", { month:"long" });
  const yearNum   = date.getFullYear();

  const name    = (r.fullName || "—").toUpperCase();
  const address = r.address   || "—";
  const purpose = (r.purpose  || "OFFICIAL USE").toUpperCase();
  const contact = r.contact   || "";
  const age     = r.age       || "";
  const civil   = r.civilStatus || "";
  const biz     = r.businessName || "";
  const bizAddr = r.businessAddress || address;
  const bizNature = r.businessNature || r.serviceType || "business activities";

  const nameExtra = `${age ? ", " + age + " years of age":""}${civil?", "+civil:""}${contact?", with contact number <strong>"+contact+"</strong>":""}`;

  const titleMap = {
    "clearance":   "BARANGAY CLEARANCE",
    "residency":   "CERTIFICATE OF RESIDENCY",
    "indigency":   "CERTIFICATE OF INDIGENCY",
    "business":    "BARANGAY BUSINESS CLEARANCE",
    "permit":      "BARANGAY BUSINESS CLEARANCE",
    "blotter":     "BARANGAY BLOTTER REPORT",
    "moral":       "CERTIFICATE OF GOOD MORAL CHARACTER",
    "character":   "CERTIFICATE OF GOOD MORAL CHARACTER",
  };
  const svcLower = serviceType.toLowerCase();
  const docTitle = Object.entries(titleMap).find(([k]) => svcLower.includes(k))?.[1] || "BARANGAY CERTIFICATION";

  let bodyHtml = "";
  if (svcLower.includes("clearance") && !svcLower.includes("business")) {
    bodyHtml = `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>${name}</strong>${nameExtra}, is a <em>bonafide</em> resident of <strong>Barangay Sta. Rita, Olongapo City</strong>, with residential address at <strong>${address}</strong>.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;To the best of our knowledge and belief, the above-named individual is of <strong>good moral character</strong>, law-abiding, and has no derogatory record on file in this barangay.</p>
      <p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This clearance is issued upon the request of the above-named person for the purpose of <strong>${purpose}</strong>, and for whatever legal purpose it may serve.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>${dayOrd} day of ${monthLong} ${yearNum}</strong> at the Office of the Punong Barangay, Barangay Sta. Rita, Olongapo City.</p>`;
  } else if (svcLower.includes("residency")) {
    bodyHtml = `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>${name}</strong>${nameExtra}, is a <em>bonafide</em> resident of <strong>Barangay Sta. Rita, Olongapo City</strong>, and is presently residing at <strong>${address}</strong>.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This office further certifies that the above-named individual is known in the community and has been residing in this barangay for a considerable period of time.</p>
      <p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This certification is being issued upon the request of the above-named person for the purpose of <strong>${purpose}</strong>, and to serve as proof of residency in all lawful transactions.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>${dayOrd} day of ${monthLong} ${yearNum}</strong> at the Office of the Punong Barangay, Barangay Sta. Rita, Olongapo City.</p>`;
  } else if (svcLower.includes("indigency")) {
    bodyHtml = `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>${name}</strong>${nameExtra}, is a <em>bonafide</em> and registered resident of <strong>Barangay Sta. Rita, Olongapo City</strong>, presently residing at <strong>${address}</strong>.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This office further certifies that the above-named individual <strong>belongs to an indigent family</strong> of this barangay, and that they do not have the financial capacity to defray the expenses pertaining to their present needs.</p>
      <p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This certification is issued upon the request of the above-named person for the purpose of <strong>${purpose}</strong>, and is being granted as a matter of official necessity and public service.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>${dayOrd} day of ${monthLong} ${yearNum}</strong> at the Office of the Punong Barangay, Barangay Sta. Rita, Olongapo City.</p>`;
  } else if (svcLower.includes("business") || svcLower.includes("permit")) {
    bodyHtml = `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>${name}</strong>${contact?", with contact number <strong>"+contact+"</strong>":""}, is a <em>bonafide</em> resident of <strong>Barangay Sta. Rita, Olongapo City</strong>, with address at <strong>${address}</strong>.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Further, this office certifies that the establishment known as <strong>${biz||"[Business Name]"}</strong>, engaged in <strong>${bizNature}</strong>, and located at <strong>${bizAddr}</strong>, has been <strong>granted clearance</strong> by this Barangay to operate, subject to existing laws, ordinances, and regulations.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This barangay clearance is being issued in connection with the requirements for <strong>Business Permit</strong> application/renewal and for other lawful purposes as may be required.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>${dayOrd} day of ${monthLong} ${yearNum}</strong> at the Office of the Punong Barangay, Barangay Sta. Rita, Olongapo City.</p>`;
  } else if (svcLower.includes("blotter")) {
    bodyHtml = `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that a <strong>Blotter Report</strong> has been officially entered and recorded in the Barangay Blotter Book of <strong>Barangay Sta. Rita, Olongapo City</strong>, filed by or in relation to <strong>${name}</strong>, with address at <strong>${address}</strong>.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;The matter was brought to the attention of this barangay on <strong>${dateStr}</strong>. The same has been duly entered in the official Barangay Blotter under Entry No. <strong>${controlNo}</strong>.</p>
      <p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This certification is issued upon request for the purpose of <strong>${purpose}</strong>, and for such other legal purposes as may be necessary.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>${dayOrd} day of ${monthLong} ${yearNum}</strong> at the Office of the Punong Barangay, Barangay Sta. Rita, Olongapo City.</p>`;
  } else if (svcLower.includes("moral") || svcLower.includes("character")) {
    bodyHtml = `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>${name}</strong>${nameExtra}, is a <em>bonafide</em> and registered resident of <strong>Barangay Sta. Rita, Olongapo City</strong>, presently residing at <strong>${address}</strong>.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;To the best of our knowledge and information, the above-named individual is a person of <strong>good moral character</strong> — honest, trustworthy, and of reputable standing in the community. No complaint or derogatory record has been filed against said person in this office.</p>
      <p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This certification is issued upon the request of the above-named person for the purpose of <strong>${purpose}</strong>, and to serve as an attestation of their good standing in this barangay.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>${dayOrd} day of ${monthLong} ${yearNum}</strong> at the Office of the Punong Barangay, Barangay Sta. Rita, Olongapo City.</p>`;
  } else {
    bodyHtml = `<p class="salutation">TO WHOM IT MAY CONCERN:</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This is to certify that <strong>${name}</strong>${nameExtra}, is a <em>bonafide</em> resident of <strong>Barangay Sta. Rita, Olongapo City</strong>, with address at <strong>${address}</strong>.</p>
      <p class="purpose-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;This certification is issued upon the request of the above-named person for the purpose of <strong>${purpose}</strong>, and for whatever legal purpose it may serve.</p>
      <p class="body-text">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Issued this <strong>${dayOrd} day of ${monthLong} ${yearNum}</strong> at the Office of the Punong Barangay, Barangay Sta. Rita, Olongapo City.</p>`;
  }
  return { docTitle, bodyHtml };
}

// =====================================================================
// SERVICES — Full CRUD + Template Builder integration
// =====================================================================
function loadServices() {
  const el = document.getElementById("servicesList");
  if (!el) return;
  el.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading...</div>`;
  const unsub = onSnapshot(collection(db, "services"), (snap) => {
    if (snap.empty) { el.innerHTML = `<div class="empty-state">No services configured yet. Add one above.</div>`; return; }
    el.innerHTML = snap.docs.map(docSnap => {
      const s = docSnap.data();
      const docs = (s.documents || []).map(d => `<span class="doc-tag">${d}</span>`).join("");
      const statusBadge = s.active !== false
        ? `<span class="badge-active">Active</span>`
        : `<span class="badge-inactive">Disabled</span>`;
      // ── Template badge ──────────────────────────────────────────────
      const tplBadge = s.templateId
        ? `<span class="tpl-badge-set"><i class="fa-regular fa-file-lines"></i> Template set</span>`
        : `<span class="tpl-badge-none"><i class="fa-solid fa-triangle-exclamation"></i> No template</span>`;
      const svcNameSafe = s.name.replace(/'/g, "\\'");
      return `<div class="admin-card service-card">
        <div class="card-top">
          <div><h4>${s.name}</h4><p>${s.description || "No description"}</p></div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">${statusBadge}${tplBadge}</div>
        </div>
        <div class="service-meta"><span>₱${s.fee || 0} fee</span> • <span>${s.days || 0} processing day(s)</span></div>
        <div class="doc-list">${docs || "<em style='font-size:12px;color:#aaa'>No required documents listed</em>"}</div>
        <div class="card-actions">
          <button class="action-btn" onclick="openEditService('${docSnap.id}')"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
          <button class="btn-template action-btn" onclick="openTemplateEditor('${docSnap.id}','${svcNameSafe}')"><i class="fa-regular fa-file-lines"></i> Template</button>
          <button class="btn-toggle" onclick="toggleService('${docSnap.id}',${s.active !== false})">${s.active !== false ? "Disable" : "Enable"}</button>
          <button class="btn-danger" onclick="deleteService('${docSnap.id}')"><i class="fa-solid fa-trash"></i> Delete</button>
        </div>
      </div>`;
    }).join("");
  });
  unsubscribers.push(unsub);
}

window.addService = async () => {
  const name = document.getElementById("svcName")?.value.trim();
  if (!name) { showToast("Service name is required.", "warning"); return; }
  const btn = document.getElementById("addServiceBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Adding..."; }
  try {
    await addDoc(collection(db, "services"), {
      name,
      description: document.getElementById("svcDesc")?.value.trim() || "",
      days: parseInt(document.getElementById("svcDays")?.value) || 0,
      fee: parseFloat(document.getElementById("svcFee")?.value) || 0,
      documents: (document.getElementById("svcDocs")?.value || "").split("\n").map(x => x.trim()).filter(Boolean),
      templateId: null,
      active: true, createdAt: serverTimestamp()
    });
    ["svcName","svcDesc","svcDays","svcFee","svcDocs"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    showToast(`Service "${name}" added.`, "success");
  } catch (err) { showToast("Failed to add service.", "error"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "+ Add Service"; } }
};

window.openEditService = async (id) => {
  editingServiceId = id;
  const modal = document.getElementById("editServiceModal");
  if (!modal) return;
  try {
    const snap = await getDoc(doc(db, "services", id));
    if (!snap.exists()) return;
    const s = snap.data();
    document.getElementById("editSvcName").value = s.name || "";
    document.getElementById("editSvcDesc").value = s.description || "";
    document.getElementById("editSvcDays").value = s.days || "";
    document.getElementById("editSvcFee").value  = s.fee  || "";
    document.getElementById("editSvcDocs").value = (s.documents || []).join("\n");
    modal.classList.add("open");
  } catch (err) { showToast("Could not load service for editing.", "error"); }
};

window.closeEditService = () => { document.getElementById("editServiceModal")?.classList.remove("open"); editingServiceId = null; };

window.saveEditService = async () => {
  if (!editingServiceId) return;
  const name = document.getElementById("editSvcName")?.value.trim();
  if (!name) { showToast("Service name is required.", "warning"); return; }
  const btn = document.getElementById("saveEditServiceBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  try {
    await updateDoc(doc(db, "services", editingServiceId), {
      name,
      description: document.getElementById("editSvcDesc")?.value.trim() || "",
      days: parseInt(document.getElementById("editSvcDays")?.value) || 0,
      fee: parseFloat(document.getElementById("editSvcFee")?.value) || 0,
      documents: (document.getElementById("editSvcDocs")?.value || "").split("\n").map(x => x.trim()).filter(Boolean),
      updatedAt: serverTimestamp()
    });
    showToast("Service updated.", "success");
    closeEditService();
  } catch (err) { showToast("Failed to save changes.", "error"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Save Changes"; } }
};

window.toggleService = async (id, currentlyActive) => {
  try {
    await updateDoc(doc(db, "services", id), { active: !currentlyActive, updatedAt: serverTimestamp() });
    showToast(`Service ${!currentlyActive ? "enabled" : "disabled"}.`, "info");
  } catch (err) { showToast("Failed to update service status.", "error"); }
};

window.deleteService = async (id) => {
  if (!confirm("Permanently delete this service? This cannot be undone.")) return;
  try { await deleteDoc(doc(db, "services", id)); showToast("Service deleted.", "success"); }
  catch (err) { showToast("Failed to delete service.", "error"); }
};

// =====================================================================
// TEMPLATE BUILDER — state + CRUD
// =====================================================================
let tplState = { serviceId: null, serviceName: null, existingId: null, previewTimer: null };

// ── Firestore helpers ────────────────────────────────────────────────
async function getTemplateForService(serviceId) {
  const q = query(collection(db, "documentTemplates"), where("serviceId","==",serviceId), where("isActive","==",true));
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function saveTemplateToFirestore({ serviceId, serviceName, docTitle, bodyHtml, changelog, adminUid, existingId }) {
  const sanitised = sanitiseHtml(bodyHtml);
  const now = serverTimestamp();
  if (existingId) {
    const ref     = doc(db, "documentTemplates", existingId);
    const current = await getDoc(ref);
    if (!current.exists()) throw new Error("Template not found");
    const prev = current.data();
    await addDoc(collection(db, "documentTemplates", existingId, "versions"), {
      bodyHtml: prev.bodyHtml, version: prev.version,
      savedBy: prev.updatedBy || prev.createdBy,
      savedAt: prev.updatedAt || prev.createdAt, changelog: prev.changelog || "",
    });
    await updateDoc(ref, { docTitle, bodyHtml: sanitised, version: (prev.version||1)+1,
      changelog, updatedBy: adminUid, updatedAt: now });
    return existingId;
  } else {
    const existing = await getTemplateForService(serviceId);
    if (existing) await updateDoc(doc(db, "documentTemplates", existing.id), { isActive: false });
    const newRef = await addDoc(collection(db, "documentTemplates"), {
      serviceId, serviceName, docTitle, bodyHtml: sanitised,
      version: 1, isActive: true, changelog,
      createdBy: adminUid, createdAt: now, updatedAt: now,
    });
    await updateDoc(doc(db, "services", serviceId), { templateId: newRef.id, updatedAt: now });
    return newRef.id;
  }
}

// ── Open/close editor ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// RICH TEXT EDITOR — Word-like WYSIWYG for template body
// ═══════════════════════════════════════════════════════════════════════════

let _tplHtmlMode = false; // tracks HTML source view toggle

/** Get the current HTML from whichever view is active */
function tplGetHtml() {
  if (_tplHtmlMode) return document.getElementById("tplHtmlSource")?.value || "";
  return document.getElementById("tplRichEditor")?.innerHTML || "";
}

/** Set content into the rich editor and keep hidden textarea in sync */
function tplSetHtml(html) {
  const rich = document.getElementById("tplRichEditor");
  const hidden = document.getElementById("tplBodyHtml");
  const src = document.getElementById("tplHtmlSource");
  if (rich)   rich.innerHTML = html;
  if (hidden) hidden.value   = html;
  if (src)    src.value      = html;
}

/** Called whenever rich editor content changes */
window.tplOnRichInput = () => {
  const html = document.getElementById("tplRichEditor")?.innerHTML || "";
  const hidden = document.getElementById("tplBodyHtml");
  if (hidden) hidden.value = html;
  const src = document.getElementById("tplHtmlSource");
  if (src && _tplHtmlMode) src.value = html;
  updateCharCount();
  scheduleTplPreview();
};

/** Sync from HTML source textarea back to rich editor */
window.tplSyncFromSource = () => {
  const src = document.getElementById("tplHtmlSource")?.value || "";
  const rich = document.getElementById("tplRichEditor");
  const hidden = document.getElementById("tplBodyHtml");
  if (rich) rich.innerHTML = src;
  if (hidden) hidden.value = src;
  updateCharCount();
  scheduleTplPreview();
};

/** Toggle between rich editor and raw HTML source */
window.tplToggleHtmlMode = () => {
  _tplHtmlMode = !_tplHtmlMode;
  const rich   = document.getElementById("tplRichEditor");
  const src    = document.getElementById("tplHtmlSource");
  const toggle = document.getElementById("rbnHtmlToggle");
  const canvas = document.querySelector(".tpl-page-canvas");
  if (_tplHtmlMode) {
    // switch to source
    src.value = rich.innerHTML;
    rich.style.display = "none";
    src.style.display  = "block";
    if (canvas) canvas.style.paddingTop = "0";
    toggle?.classList.add("active");
  } else {
    // switch back to rich
    rich.innerHTML = src.value;
    src.style.display  = "none";
    rich.style.display = "";
    if (canvas) canvas.style.paddingTop = "";
    toggle?.classList.remove("active");
  }
  const hidden = document.getElementById("tplBodyHtml");
  if (hidden) hidden.value = _tplHtmlMode ? src.value : rich.innerHTML;
};

/** Apply execCommand format */
window.tplFmt = (cmd) => {
  document.getElementById("tplRichEditor")?.focus();
  document.execCommand(cmd, false, null);
  tplUpdateToolbarState();
  tplOnRichInput();
};

/** Apply paragraph style by wrapping/replacing selection block */
window.tplApplyStyle = (style) => {
  const rich = document.getElementById("tplRichEditor");
  if (!rich) return;
  rich.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  // Find block ancestor
  let node = range.commonAncestorContainer;
  while (node && node !== rich && node.nodeType !== 1) node = node.parentNode;
  if (!node || node === rich) {
    // No block found — wrap in a new <p>
    const p = document.createElement("p");
    p.className = style === "h2" ? "" : style;
    if (style === "h2") { const h = document.createElement("h2"); h.appendChild(range.extractContents()); p.appendChild(h); }
    else { p.appendChild(range.extractContents()); }
    range.insertNode(p);
  } else {
    if (style === "h2") { node.tagName !== "H2" && document.execCommand("formatBlock", false, "h2"); }
    else { document.execCommand("formatBlock", false, "p"); node.className = style; }
  }
  tplOnRichInput();
  tplUpdateToolbarState();
};

/** Apply text alignment */
window.tplAlign = (dir) => {
  document.getElementById("tplRichEditor")?.focus();
  const cmds = { left:"justifyLeft", center:"justifyCenter", right:"justifyRight", justify:"justifyFull" };
  document.execCommand(cmds[dir] || "justifyLeft", false, null);
  tplOnRichInput();
};

/** Insert a new paragraph at cursor */
window.tplInsertNewPara = () => {
  const rich = document.getElementById("tplRichEditor");
  if (!rich) return;
  rich.focus();
  document.execCommand("insertHTML", false, '<p class="body-text"><br></p>');
  tplOnRichInput();
};

/** Insert non-breaking indent spaces at cursor */
window.tplInsertIndent = () => {
  const rich = document.getElementById("tplRichEditor");
  if (!rich) return;
  rich.focus();
  document.execCommand("insertHTML", false, "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;");
  tplOnRichInput();
};

/** Update toolbar button active states based on current selection */
window.tplUpdateToolbarState = () => {
  try {
    const cmds = { rbnBold:"bold", rbnItalic:"italic", rbnUnder:"underline" };
    for (const [id, cmd] of Object.entries(cmds)) {
      document.getElementById(id)?.classList.toggle("active", document.queryCommandState(cmd));
    }
  } catch (_) {}
};

window.openTemplateEditor = async (serviceId, serviceName) => {
  tplState.serviceId   = serviceId;
  tplState.serviceName = serviceName;
  tplState.existingId  = null;

  document.getElementById("tplServiceLabel").textContent = serviceName;
  document.getElementById("tplChangelog").value = "";
  document.getElementById("tplSaveBtn").disabled = false;

  // Populate grouped placeholder chips
  const chipsEl = document.getElementById("tplTokenChips");
  chipsEl.innerHTML = PLACEHOLDER_GROUPS.map(group => `
    <div class="tpl-chip-group">
      <span class="tpl-chip-group-label">${group.label}</span>
      <div class="tpl-chip-group-chips">
        ${group.chips.map(c =>
          `<span class="tpl-chip" title="${c.hint}" onclick="insertPlaceholder('${c.token}')">${c.token}</span>`
        ).join("")}
      </div>
    </div>
  `).join("");
  document.getElementById("tplPhCount").textContent = PLACEHOLDERS.length;

  // Load existing or seed default
  const existing = await getTemplateForService(serviceId);
  if (existing) {
    tplState.existingId = existing.id;
    document.getElementById("tplDocTitle").value = existing.docTitle || "";
    tplSetHtml(existing.bodyHtml || "");
  } else {
    const key = guessDefaultKey(serviceName);
    document.getElementById("tplDocTitle").value = suggestDocTitle(serviceName);
    tplSetHtml(DEFAULT_TEMPLATES[key] || DEFAULT_TEMPLATES.generic);
  }

  // Reset HTML mode on open
  _tplHtmlMode = false;
  const rich = document.getElementById("tplRichEditor");
  const src  = document.getElementById("tplHtmlSource");
  if (rich) rich.style.display = "";
  if (src)  src.style.display  = "none";
  document.getElementById("rbnHtmlToggle")?.classList.remove("active");

  // Reset to editor tab on open
  tplSwitchTab("editor");
  updateCharCount();
  refreshTplPreview();
  document.getElementById("templateEditorModal").classList.add("open");
  document.getElementById("tplRichEditor")?.focus();
};

window.closeTemplateEditor = () => {
  document.getElementById("templateEditorModal").classList.remove("open");
  closeVersionHistory();
  clearTimeout(tplState.previewTimer);
};

// ── Save ─────────────────────────────────────────────────────────────
window.saveTemplateFromEditor = async () => {
  const bodyHtml  = tplGetHtml().trim();
  const docTitle  = document.getElementById("tplDocTitle").value.trim();
  const changelog = document.getElementById("tplChangelog").value.trim();
  if (!docTitle)  { showToast("Document title is required.", "warning"); return; }
  if (!bodyHtml)  { showToast("Document body cannot be empty.", "warning"); return; }
  const btn = document.getElementById("tplSaveBtn");
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const adminUid = localStorage.getItem("uid") || "unknown";
    await saveTemplateToFirestore({
      serviceId: tplState.serviceId, serviceName: tplState.serviceName,
      docTitle, bodyHtml, changelog, adminUid, existingId: tplState.existingId,
    });
    showToast(`Template for "${tplState.serviceName}" saved.`, "success");
    closeTemplateEditor();
    loadServices();
  } catch (err) {
    console.error("saveTemplateFromEditor:", err);
    showToast("Failed to save template.", "error");
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Template';
  }
};

// ── Placeholder insert at cursor ─────────────────────────────────────
window.insertPlaceholder = (token) => {
  const rich = document.getElementById("tplRichEditor");
  if (!rich) return;
  // If HTML mode, fall back to inserting into source textarea
  if (_tplHtmlMode) {
    const ta = document.getElementById("tplHtmlSource");
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + token + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + token.length;
    ta.focus();
    tplSyncFromSource();
    return;
  }
  rich.focus();
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    // Insert as a styled chip span
    const chip = document.createElement("span");
    chip.className = "ph-token";
    chip.contentEditable = "false";
    chip.textContent = token;
    range.insertNode(chip);
    // Move cursor after chip
    range.setStartAfter(chip);
    range.setEndAfter(chip);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    document.execCommand("insertHTML", false, `<span class="ph-token" contenteditable="false">${token}</span>`);
  }
  tplOnRichInput();
};

// ── Live preview ─────────────────────────────────────────────────────
window.scheduleTplPreview = () => {
  clearTimeout(tplState.previewTimer);
  tplState.previewTimer = setTimeout(refreshTplPreview, 600);
};

window.refreshTplPreview = () => {
  const bodyRaw  = tplGetHtml ? tplGetHtml() : (document.getElementById("tplBodyHtml")?.value || "");
  const docTitle = document.getElementById("tplDocTitle")?.value || "BARANGAY DOCUMENT";
  const frame    = document.getElementById("tplPreviewFrame");
  if (!frame) return;

  const sampleReq = {
    fullName: "Juan Dela Cruz", age: "35", civilStatus: "Married",
    address: "123 Rizal Street, Sta. Rita, Olongapo City",
    contact: "09171234567", purpose: "Employment",
    serviceType: tplState.serviceName || "Service",
    businessName: "Sample Store",
    businessAddress: "456 Magsaysay Drive, Olongapo City",
    businessNature: "Retail Goods",
    createdAt: { toDate: () => new Date() },
  };

  const resolvedBody = resolvePlaceholders(bodyRaw, sampleReq, "PREVIEW1");
  const dateStr = new Date().toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" });
  const shellHtml = renderDocumentShell({
    docTitle, bodyHtml: resolvedBody, dateStr,
    controlNo: "PREVIEW1", serviceType: tplState.serviceName || "",
    requestId: "preview",
  });

  const fdoc = frame.contentDocument || frame.contentWindow?.document;
  if (fdoc) { fdoc.open(); fdoc.write(shellHtml); fdoc.close(); }
};

// ── Version history ──────────────────────────────────────────────────
window.openVersionHistory = window.toggleVersionDrawer = async () => {
  const drawer = document.getElementById("tplVersionDrawer");
  if (drawer.classList.contains("open")) { drawer.classList.remove("open"); return; }
  if (!tplState.existingId) { showToast("Save the template first to see version history.", "info"); return; }
  drawer.classList.add("open");
  const list = document.getElementById("tplVersionList");
  list.innerHTML = `<div class="tpl-ver-empty">Loading…</div>`;
  try {
    const snap = await getDocs(query(
      collection(db, "documentTemplates", tplState.existingId, "versions"),
      orderBy("savedAt", "desc")
    ));
    if (snap.empty) { list.innerHTML = `<div class="tpl-ver-empty">No previous versions saved yet.<br>Each save after the first creates a snapshot here.</div>`; return; }
    list.innerHTML = snap.docs.map(d => {
      const v = d.data();
      const dateStr = v.savedAt?.toDate
        ? v.savedAt.toDate().toLocaleDateString("en-PH",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})
        : "—";
      return `<div class="tpl-version-item">
        <div class="tpl-ver-top">
          <div>
            <div class="tpl-ver-num">Version ${v.version}</div>
            <div class="tpl-ver-date">${dateStr}</div>
          </div>
          <button class="tpl-restore-btn" onclick="restoreVersion('${d.id}','${v.version}')">↩ Restore</button>
        </div>
        ${v.changelog ? `<div class="tpl-ver-note">"${v.changelog}"</div>` : ""}
      </div>`;
    }).join("");
  } catch (err) {
    list.innerHTML = `<div class="tpl-ver-empty" style="color:#ef4444">Failed to load versions.</div>`;
  }
};

window.closeVersionHistory = () => { document.getElementById("tplVersionDrawer")?.classList.remove("open"); };

// ── Tab switcher ──────────────────────────────────────────────────────────────
window.tplSwitchTab = (tab) => {
  const editorPanel  = document.getElementById("tabPanelEditor");
  const previewPanel = document.getElementById("tabPanelPreview");
  const btnEditor    = document.getElementById("tabBtnEditor");
  const btnPreview   = document.getElementById("tabBtnPreview");
  if (tab === "preview") {
    refreshTplPreview();
    editorPanel.classList.add("tpl-tab-hidden");
    previewPanel.classList.remove("tpl-tab-hidden");
    btnEditor?.classList.remove("tpl-tab-active");
    btnPreview?.classList.add("tpl-tab-active");
  } else {
    previewPanel.classList.add("tpl-tab-hidden");
    editorPanel.classList.remove("tpl-tab-hidden");
    btnPreview?.classList.remove("tpl-tab-active");
    btnEditor?.classList.add("tpl-tab-active");
  }
};

// ── Placeholder panel collapse ────────────────────────────────────────────────
window.tplTogglePh = () => {
  const body    = document.getElementById("tplPhBody");
  const chevron = document.getElementById("tplPhChevron");
  const toggle  = document.getElementById("tplPhToggle");
  const hint    = document.getElementById("tplPhHintText");
  const collapsed = body.classList.toggle("collapsed");
  chevron.classList.toggle("collapsed", collapsed);
  toggle.setAttribute("aria-expanded", String(!collapsed));
  if (hint) hint.style.opacity = collapsed ? "0" : "1";
};

// ── Char counter ──────────────────────────────────────────────────────────────
function updateCharCount() {
  const rich = document.getElementById("tplRichEditor");
  const el   = document.getElementById("tplCharCount");
  if (!el) return;
  const len = rich ? (rich.innerText || "").length : 0;
  el.textContent = len.toLocaleString() + " character" + (len !== 1 ? "s" : "");
}

// ── Quick insert snippets (kept for any legacy calls) ─────────────────────────
window.tplInsertSnippet = (type) => {
  if (type === "para")  { tplInsertNewPara(); return; }
  if (type === "nbsp")  { tplInsertIndent();  return; }
  if (type === "strong"){ tplFmt("bold");     return; }
};

window.restoreVersion = async (versionDocId, versionNum) => {
  if (!confirm(`Restore version ${versionNum}? Current content will be saved first.`)) return;
  try {
    const snap = await getDoc(doc(db, "documentTemplates", tplState.existingId, "versions", versionDocId));
    if (!snap.exists()) { showToast("Version not found.", "error"); return; }
    tplSetHtml(snap.data().bodyHtml || "");
    document.getElementById("tplChangelog").value = `Restored from v${versionNum}`;
    closeVersionHistory();
    refreshTplPreview();
    showToast(`Version ${versionNum} loaded into editor. Click Save to apply.`, "info");
  } catch (err) { showToast("Failed to restore version.", "error"); }
};

// ── Helpers ──────────────────────────────────────────────────────────
function guessDefaultKey(name) {
  const s = name.toLowerCase();
  if (s.includes("clearance") && !s.includes("business")) return "clearance";
  if (s.includes("residency"))  return "residency";
  if (s.includes("indigency"))  return "indigency";
  if (s.includes("business") || s.includes("permit")) return "business";
  return "generic";
}

function suggestDocTitle(name) {
  const map = {
    clearance: "BARANGAY CLEARANCE",
    residency: "CERTIFICATE OF RESIDENCY",
    indigency: "CERTIFICATE OF INDIGENCY",
    business:  "BARANGAY BUSINESS CLEARANCE",
    permit:    "BARANGAY BUSINESS CLEARANCE",
    blotter:   "BARANGAY BLOTTER REPORT",
    moral:     "CERTIFICATE OF GOOD MORAL CHARACTER",
  };
  const s = name.toLowerCase();
  for (const [k, v] of Object.entries(map)) if (s.includes(k)) return v;
  return name.toUpperCase();
}

function esc(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

function toTitleCase(str) {
  return str.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

// =====================================================================
// ANNOUNCEMENTS — Full CRUD
// =====================================================================
function preloadAnnBadge() {
  const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    const badge = document.getElementById("annBadge");
    if (!badge) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let recentCount = 0;
    snap.forEach(d => {
      const ts = d.data().createdAt?.toDate ? d.data().createdAt.toDate().getTime() : 0;
      if (ts > cutoff) recentCount++;
    });
    badge.textContent = recentCount > 9 ? "9+" : recentCount;
    badge.style.display = recentCount > 0 ? "inline-block" : "none";
  });
}

function loadAnnouncements() {
  const el = document.getElementById("annList");
  if (!el) return;
  el.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading...</div>`;
  const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"));
  const unsub = onSnapshot(q, (snap) => {
    const badge = document.getElementById("annBadge");
    if (snap.empty) {
      el.innerHTML = `<div class="empty-state">No announcements posted yet.</div>`;
      if (badge) badge.style.display = "none";
      return;
    }
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let recentCount = 0;
    el.innerHTML = snap.docs.map(docSnap => {
      const a = docSnap.data();
      const date = a.createdAt?.toDate ? a.createdAt.toDate().toLocaleDateString("en-PH", { year:"numeric", month:"long", day:"numeric" }) : "";
      const isNew = (a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0) > cutoff;
      if (isNew) recentCount++;
      return `<div class="announcement-card" ${isNew ? 'style="border-left:4px solid #ef4444;"' : ''}>
        <div class="ann-top">
          <div>
            <h4>${a.title}${isNew ? `<span style="font-size:10px;background:#ef4444;color:white;padding:2px 7px;border-radius:10px;font-weight:700;margin-left:8px;">NEW</span>` : ""}</h4>
            <small class="ann-date">${date}</small>
          </div>
          <div class="ann-actions">
            <button class="action-btn" onclick="openEditAnn('${docSnap.id}')"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
            <button class="btn-danger"  onclick="deleteAnnouncement('${docSnap.id}')"><i class="fa-solid fa-trash"></i> Delete</button>
          </div>
        </div>
        <p class="ann-content">${a.content}</p>
      </div>`;
    }).join("");
    if (badge) { badge.textContent = recentCount > 9 ? "9+" : recentCount; badge.style.display = recentCount > 0 ? "inline-block" : "none"; }
  });
  unsubscribers.push(unsub);
}

window.postAnnouncement = async () => {
  const title = document.getElementById("annTitle")?.value.trim();
  const content = document.getElementById("annContent")?.value.trim();
  if (!title || !content) { showToast("Title and content are required.", "warning"); return; }
  const btn = document.getElementById("postAnnBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Posting..."; }
  try {
    await addDoc(collection(db, "announcements"), { title, content, createdAt: serverTimestamp(), postedBy: auth.currentUser?.email || "admin" });
    document.getElementById("annTitle").value = "";
    document.getElementById("annContent").value = "";
    showToast("Announcement posted.", "success");
  } catch (err) { showToast("Failed to post announcement.", "error"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Post Announcement"; } }
};

window.openEditAnn = async (id) => {
  editingAnnouncementId = id;
  const modal = document.getElementById("editAnnModal");
  if (!modal) return;
  try {
    const snap = await getDoc(doc(db, "announcements", id));
    if (!snap.exists()) return;
    const a = snap.data();
    document.getElementById("editAnnTitle").value = a.title || "";
    document.getElementById("editAnnContent").value = a.content || "";
    modal.classList.add("open");
  } catch (err) { showToast("Could not load announcement.", "error"); }
};

window.closeEditAnn = () => { document.getElementById("editAnnModal")?.classList.remove("open"); editingAnnouncementId = null; };

window.saveEditAnn = async () => {
  if (!editingAnnouncementId) return;
  const title = document.getElementById("editAnnTitle")?.value.trim();
  const content = document.getElementById("editAnnContent")?.value.trim();
  if (!title || !content) { showToast("All fields required.", "warning"); return; }
  const btn = document.getElementById("saveEditAnnBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  try {
    await updateDoc(doc(db, "announcements", editingAnnouncementId), { title, content, updatedAt: serverTimestamp() });
    showToast("Announcement updated.", "success");
    closeEditAnn();
  } catch (err) { showToast("Failed to update announcement.", "error"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Save Changes"; } }
};

window.deleteAnnouncement = async (id) => {
  if (!confirm("Delete this announcement?")) return;
  try { await deleteDoc(doc(db, "announcements", id)); showToast("Announcement deleted.", "success"); }
  catch (err) { showToast("Failed to delete.", "error"); }
};

// =====================================================================
// USERS — Read-only grouped view WITH PAGINATION
// =====================================================================
function buildPagination(containerId, paginationId, currentPage, totalPages, onChangeFn) {
  const pg = document.getElementById(paginationId);
  if (!pg) return;
  if (totalPages <= 1) { pg.innerHTML = ""; return; }
  let html = `<button class="pg-btn pg-nav" ${currentPage===1?"disabled":""} onclick="${onChangeFn}(${currentPage-1})">‹</button>`;
  const maxP = Math.min(totalPages, 5);
  let s = Math.max(1, currentPage - 2), e = Math.min(totalPages, s + maxP - 1);
  if (e - s < maxP - 1) s = Math.max(1, e - maxP + 1);
  if (s > 1) html += `<button class="pg-btn" onclick="${onChangeFn}(1)">1</button>${s > 2 ? `<span class="pg-ellipsis">…</span>` : ""}`;
  for (let i = s; i <= e; i++) html += `<button class="pg-btn${i===currentPage?" pg-active":""}" onclick="${onChangeFn}(${i})">${i}</button>`;
  if (e < totalPages) html += `${e < totalPages - 1 ? `<span class="pg-ellipsis">…</span>` : ""}<button class="pg-btn" onclick="${onChangeFn}(${totalPages})">${totalPages}</button>`;
  html += `<button class="pg-btn pg-nav" ${currentPage===totalPages?"disabled":""} onclick="${onChangeFn}(${currentPage+1})">›</button>`;
  html += `<span class="pg-info">${currentPage} / ${totalPages}</span>`;
  pg.innerHTML = html;
}

function renderUserGroup(containerId, paginationId, items, page, renderFn, emptyMsg, changeFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items.length) { el.innerHTML = `<div class="empty-state">${emptyMsg}</div>`; const pg = document.getElementById(paginationId); if (pg) pg.innerHTML = ""; return; }
  const totalPages = Math.ceil(items.length / USERS_PAGE_SIZE) || 1;
  const p = Math.min(page, totalPages);
  const start = (p - 1) * USERS_PAGE_SIZE;
  el.innerHTML = items.slice(start, start + USERS_PAGE_SIZE).map(renderFn).join("");
  buildPagination(containerId, paginationId, p, totalPages, changeFn);
}

const renderResidentCard = u => {
  const isPending = u.accountStatus === "pending_verification";
  const isRejected = u.accountStatus === "rejected";
  const badge = isPending
    ? `<span class="role-badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;cursor:pointer;" onclick="openResidentReview('${u.id}')"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <span style="vertical-align:middle;">Pending — Review</span></span>`
    : isRejected
    ? `<span class="role-badge" style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> <span style="vertical-align:middle;">Rejected</span></span>`
    : `<span class="role-badge role-resident"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polyline points="20 6 9 17 4 12"/></svg> <span style="vertical-align:middle;">Verified</span></span>`;
  const reviewBtn = isPending
    ? `<button onclick="openResidentReview('${u.id}')"
              style="margin-top:8px;padding:6px 14px;background:#1a2cff;color:#fff;
                     border:none;border-radius:6px;font-size:12px;font-weight:600;
                     cursor:pointer;display:inline-flex;align-items:center;gap:5px;">
         <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> <span style="vertical-align:middle;">Review Details &amp; ID</span>
       </button>` : "";
  return `<div class="user-card" style="${isPending ? "border-left:3px solid #f59e0b;" : isRejected ? "border-left:3px solid #ef4444;opacity:.75;" : ""}">
    <div class="user-info">
      <strong>${u.firstName ? u.firstName+" "+u.lastName : (u.email||"Unknown")}</strong>
      <small>${u.email||u.id}</small>
      ${u.address ? `<small style="color:#6b7280;">${u.address}</small>` : ""}
      ${reviewBtn}
    </div>
    ${badge}
  </div>`;
};
const renderStaffCard    = u => `<div class="user-card"><div class="user-info"><strong>${u.username||u.email||"Unknown"}</strong><small>${u.email||u.id}</small></div><span class="role-badge role-${u.role||"staff"}">${u.role==="admin"?"Admin":u.role==="it"?"IT Personnel":"Barangay Staff"}</span></div>`;

window._pgResidents = p => { usersResidentPage = p; renderUserGroup("residentsList","pg-residents",usersAllResidents,p,renderResidentCard,"No residents registered.","window._pgResidents"); };
window._pgStaff     = p => { usersStaffPage    = p; renderUserGroup("staffList",    "pg-staff",    usersAllStaff,    p,renderStaffCard,   "No staff accounts found.","window._pgStaff"); };
window._pgAdmins    = p => { usersAdminPage    = p; renderUserGroup("adminList",    "pg-admins",   usersAllAdmins,   p,renderStaffCard,   "No admin accounts.",     "window._pgAdmins"); };
window._pgIt        = p => { usersItPage       = p; renderUserGroup("itList",       "pg-it",       usersAllIt,       p,renderStaffCard,   "No IT accounts.",        "window._pgIt"); };

function loadUsers() {
  const el = document.getElementById("usersList");
  if (!el) return;
  el.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading users...</div>`;
  usersResidentPage = usersStaffPage = usersAdminPage = usersItPage = 1;
  let resolved = 0;

  function renderAll() {
    if (++resolved < 2) return;
    const pendingCount = usersAllResidents.filter(u => u.accountStatus === "pending_verification").length;
    const pendingBadge = pendingCount > 0
      ? `<span class="user-count" style="background:#f59e0b;color:#fff;margin-left:6px;">${pendingCount} pending</span>`
      : "";
    el.innerHTML = `
      <div class="user-group">
        <h4 class="user-group-title">Residents <span class="user-count">${usersAllResidents.length}</span>${pendingBadge}</h4>
        ${pendingCount > 0 ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#92400e;">
          <strong><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> <span style="vertical-align:middle;">${pendingCount} resident(s) pending ID verification.</span></strong> Review and approve or reject below.
        </div>` : ""}
        <div id="residentsList"></div><div id="pg-residents" class="pagination-bar"></div>
      </div>
      <div class="user-group"><h4 class="user-group-title">Barangay Staff <span class="user-count">${usersAllStaff.length}</span></h4><div id="staffList"></div><div id="pg-staff" class="pagination-bar"></div></div>
      <div class="user-group"><h4 class="user-group-title">Administrators <span class="user-count">${usersAllAdmins.length}</span></h4><div id="adminList"></div><div id="pg-admins" class="pagination-bar"></div></div>
      <div class="user-group"><h4 class="user-group-title">IT Personnel <span class="user-count">${usersAllIt.length}</span></h4><div id="itList"></div><div id="pg-it" class="pagination-bar"></div></div>`;
    window._pgResidents(1); window._pgStaff(1); window._pgAdmins(1); window._pgIt(1);
  }

  const u1 = onSnapshot(collection(db, "users"),  snap => { usersAllResidents = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b) => (a.accountStatus==="pending_verification"?-1:1) - (b.accountStatus==="pending_verification"?-1:1)); usersResidentPage=1; renderAll(); });
  const u2 = onSnapshot(collection(db, "admins"), snap => { const all=snap.docs.map(d=>({id:d.id,...d.data()})); usersAllStaff=all.filter(u=>u.role==="staff"); usersAllAdmins=all.filter(u=>u.role==="admin"); usersAllIt=all.filter(u=>u.role==="it"); usersStaffPage=usersAdminPage=usersItPage=1; renderAll(); });
  unsubscribers.push(u1, u2);
}

// =====================================================================
// RESIDENT ID VERIFICATION MODAL
// =====================================================================
let _rrCurrentUid = null;

window.openResidentReview = function(uid) {
  const u = usersAllResidents.find(r => r.id === uid);
  if (!u) return;
  _rrCurrentUid = uid;

  const overlay = document.getElementById("residentReviewOverlay");
  const body    = document.getElementById("residentReviewBody");
  if (!overlay || !body) return;

  const registeredAt = u.createdAt?.toDate
    ? u.createdAt.toDate().toLocaleString("en-PH", { timeZone:"Asia/Manila", dateStyle:"medium", timeStyle:"short" })
    : "—";

  const row = (label, value) =>
    `<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid #f3f4f6;align-items:flex-start;">
       <span style="min-width:130px;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.3px;">${label}</span>
       <span style="font-size:13px;color:#111827;word-break:break-word;">${value || "—"}</span>
     </div>`;

  const idSection = u.idPhotoUrl
    ? `<div style="margin-top:16px;">
         <p style="font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.3px;margin:0 0 8px;">Submitted Government ID</p>
         <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;background:#f9fafb;">
           ${u.idPhotoUrl.match(/\.pdf($|\?)/i)
             ? `<div style="padding:20px;text-align:center;">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  <p style="font-size:13px;color:#374151;margin:8px 0 0;">${u.idFileName || "ID Document.pdf"}</p>
                  <a href="${u.idPhotoUrl}" target="_blank"
                     style="display:inline-block;margin-top:8px;padding:8px 16px;background:#2563eb;color:#fff;
                            border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> <span style="vertical-align:middle;">Open PDF</span>
                  </a>
                </div>`
             : `<img src="${u.idPhotoUrl}" alt="Government ID"
                     style="width:100%;max-height:280px;object-fit:contain;display:block;padding:12px;"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                <div style="display:none;padding:16px;text-align:center;color:#9ca3af;font-size:13px;">Image could not be loaded.
                  <br><a href="${u.idPhotoUrl}" target="_blank" style="color:#2563eb;"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> <span style="vertical-align:middle;">Open directly</span></a>
                </div>
                <div style="padding:8px 12px;background:#f3f4f6;border-top:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;">
                  <span style="font-size:11px;color:#6b7280;">${u.idFileName || "ID Photo"}</span>
                  <a href="${u.idPhotoUrl}" target="_blank"
                     style="font-size:11px;color:#2563eb;font-weight:600;text-decoration:none;"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> <span style="vertical-align:middle;">Open full size</span></a>
                </div>`
           }
         </div>
       </div>`
    : `<div style="margin-top:16px;padding:14px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;">
         <p style="margin:0;font-size:13px;color:#dc2626;font-weight:600;display:flex;align-items:center;gap:6px;"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> <span>No ID was submitted with this registration.</span></p>
       </div>`;

  body.innerHTML = `
    <div style="margin-bottom:4px;">
      ${row("Full Name",    (u.firstName||"") + " " + (u.lastName||""))}
      ${row("Email",        u.email)}
      ${row("Phone",        u.phone)}
      ${row("Address",      u.address)}
      ${row("Registered",   registeredAt)}
      ${row("Email Verified", u.emailVerified ? '<span style="color:#16a34a;display:inline-flex;align-items:center;gap:4px;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polyline points="20 6 9 17 4 12"/></svg> Yes</span>' : '<span style="color:#dc2626;display:inline-flex;align-items:center;gap:4px;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> No</span>')}
    </div>
    ${idSection}`;

  overlay.style.display = "flex";
  document.body.style.overflow = "hidden";
};

window.closeResidentReview = function() {
  const overlay = document.getElementById("residentReviewOverlay");
  if (overlay) overlay.style.display = "none";
  document.body.style.overflow = "";
  _rrCurrentUid = null;
};

window.rrDoApprove = async function() {
  if (!_rrCurrentUid) return;
  const btn = document.getElementById("rrApproveBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Approving…"; }
  try {
    await updateDoc(doc(db, "users", _rrCurrentUid), {
      active: true,
      accountStatus: "verified",
      verifiedAt: serverTimestamp()
    });
    closeResidentReview();
    if (typeof showToast === "function") showToast("Resident account approved. They can now log in.", "success");
  } catch (err) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polyline points="20 6 9 17 4 12"/></svg> <span style=\"vertical-align:middle;\">Approve Account</span>'; }
    alert("Failed to approve: " + err.message);
  }
};

window.rrDoReject = async function() {
  if (!_rrCurrentUid) return;
  const reason = prompt("Optional: Enter an internal note for this rejection (not shown to resident):");
  if (reason === null) return;
  const btn = document.getElementById("rrRejectBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Rejecting…"; }
  try {
    await updateDoc(doc(db, "users", _rrCurrentUid), {
      active: false,
      accountStatus: "rejected",
      rejectionReason: reason || "",
      rejectedAt: serverTimestamp()
    });
    closeResidentReview();
    if (typeof showToast === "function") showToast("Resident account rejected.", "info");
  } catch (err) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> <span style=\"vertical-align:middle;\">Reject Account</span>'; }
    alert("Failed to reject: " + err.message);
  }
};

// Close on overlay click
document.addEventListener("click", (e) => {
  if (e.target.id === "residentReviewOverlay") closeResidentReview();
});

// =====================================================================
// HELPERS
// =====================================================================
function setText(id, val) { const el = document.getElementById(id); if (el) el.innerText = val; }

function getStatusClass(status) {
  if (!status) return "";
  const s = status.toLowerCase();
  if (s.includes("pending")) return "pending";
  if (s.includes("progress")) return "progress";
  if (s.includes("pickup") || s.includes("ready")) return "ready";
  if (s.includes("completed")) return "done";
  if (s.includes("rejected")) return "rejected";
  return "";
}

window.logout = () => {
  const modal = document.getElementById("adminLogoutModal");
  if (modal) { modal.classList.add("open"); document.body.style.overflow = "hidden"; }
};

window.cancelAdminLogout = () => {
  const modal = document.getElementById("adminLogoutModal");
  if (modal) { modal.classList.remove("open"); document.body.style.overflow = ""; }
};

window.confirmAdminLogout = async () => {
  const btn = document.getElementById("confirmAdminLogoutBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Logging out…"; }
  localStorage.removeItem("adminUsername");
  localStorage.removeItem("role");
  localStorage.removeItem("uid");
  if (!localStorage.getItem("bf_resident_uid")) await signOut(auth);
  window.location.replace("admin-login.html");
};
