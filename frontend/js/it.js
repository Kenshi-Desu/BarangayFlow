import { auth, db } from "./firebase.js";
import {
  collection, onSnapshot, doc, updateDoc,
  addDoc, getDocs, getDoc, setDoc, orderBy,
  query, limit, serverTimestamp, where, deleteDoc, writeBatch
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


// ============================================================
// GLOBAL STATE
// ============================================================
let unsubscribers   = [];
let allResidents    = [];
let allStaffAdmins  = [];
let allLogs         = [];
let disableTargetId = null;
let disableTargetCol= null;
let statusPieChart  = null;
let activityChart   = null;

// Pagination state — RBAC
const IT_PAGE_SIZE      = 8;
let itResidentPage      = 1;
let itStaffPage         = 1;
let filteredResidents   = [];
let filteredStaff       = [];


let allPending          = [];
let approveTargetUid    = null;
let rejectTargetUid     = null;
// Recovery state
let selectedRecoveryCollection = "users";
let selectedSnapshotTimestamp  = null;
let selectedSnapshotLabel      = null;

function clearListeners() {
  unsubscribers.forEach(u => u());
  unsubscribers = [];
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const icons = { success:"ok", error:"err", warning:"!", info:"i" };
  const toast  = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || "i"} ${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity   = "0";
    toast.style.transform = "translateX(30px)";
    setTimeout(() => toast.remove(), 350);
  }, 4500);
}

// ============================================================
// AUTH GUARD — IT role only
// ============================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.replace("admin-login.html"); return; }
  // Guard: verify localStorage markers set by admin-auth.js at login time.
  // Do NOT call signOut() here — it would kill the resident tab's session too.
  const storedRole = localStorage.getItem("role");
  const storedUid  = localStorage.getItem("uid");
  if (!storedRole || !storedUid || storedUid !== user.uid || storedRole !== "it") {
    window.location.replace("admin-login.html");
    return;
  }


  try {
    const snap = await getDoc(doc(db, "admins", user.uid));
    if (!snap.exists() || snap.data().role !== "it") {
      showToast("Access denied. IT role required.", "error");
      window.location.replace("admin-login.html");
      return;
    }
    const data   = snap.data();
    const nameEl = document.getElementById("adminName");
    if (nameEl) nameEl.innerText = data.username || user.email;

    await logAction("LOGIN", `IT login: ${user.email}`);
    showSection("dashboard");

  } catch (err) {
    showToast("Error verifying permissions.", "error");
    window.location.replace("admin-login.html");
  }
});

// ============================================================
// NAVIGATION
// ============================================================
window.showSection = (name) => {
  clearListeners();

  document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
  document.getElementById("section-" + name)?.classList.add("active");

  document.querySelectorAll(".nav-right a").forEach(a => a.classList.remove("active"));
  document.getElementById("nav-" + name)?.classList.add("active");

  if (name === "dashboard") loadDashboard();
  if (name === "rbac")      loadRBAC();
  if (name === "logs")      loadLogs();
  if (name === "system")    loadSystem();
};

// ============================================================
// DASHBOARD
// ============================================================
function loadDashboard() {

  const u1 = onSnapshot(collection(db, "users"), (snap) => {
    const el = document.getElementById("totalUsers");
    if (el) el.innerText = snap.size;
  });

  const u2 = onSnapshot(collection(db, "requests"), (snap) => {
    const totalEl     = document.getElementById("totalRequests");
    const completedEl = document.getElementById("totalCompleted");
    if (totalEl) totalEl.innerText = snap.size;

    let completed = 0;
    const dayCounts    = {};
    const statusCounts = {};

    snap.forEach(d => {
      const r      = d.data();
      const status = r.status || "Unknown";
      if (status === "Completed") completed++;

      if (r.createdAt?.toDate) {
        const date = r.createdAt.toDate().toLocaleDateString("en-PH", { month:"short", day:"numeric" });
        dayCounts[date] = (dayCounts[date] || 0) + 1;
      }

      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    if (completedEl) completedEl.innerText = completed;

    renderActivityChart(dayCounts);
    renderStatusPie(statusCounts);
  });

  const u3 = onSnapshot(doc(db, "system", "config"), (snap) => {
    const maintenance  = snap.exists() ? (snap.data()?.maintenance || false) : false;
    const statusEl     = document.getElementById("systemStatus");
    const labelEl      = document.getElementById("systemStatusLabel");
    const bannerEl     = document.getElementById("maintenanceBanner");

    if (statusEl)  statusEl.innerText  = maintenance ? "MAINT" : "OK";
    if (labelEl)   labelEl.innerText   = maintenance ? "Maintenance mode is ON" : "All systems operational";
    if (bannerEl)  bannerEl.style.display = maintenance ? "block" : "none";
  });

  const logsQ = query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(6));
  const u4 = onSnapshot(logsQ, (snap) => {
    const el = document.getElementById("recentLogs");
    if (!el) return;

    if (snap.empty) {
      el.innerHTML = `<p class="empty-msg">No audit events yet.</p>`;
      return;
    }

    el.innerHTML = snap.docs.map(d => {
      const l    = d.data();
      const time = l.createdAt?.toDate?.().toLocaleString("en-PH") || "";
      return `
        <div class="recent-log-item">
          <div>
            <span class="log-action ${getLogClass(l.action)}">${l.action}</span>
            <span class="log-detail-text">${l.details}</span>
            ${l.user ? `<span class="log-by">by ${l.user}</span>` : ""}
          </div>
          <small class="log-time">${time}</small>
        </div>`;
    }).join("");
  });

  unsubscribers.push(u1, u2, u3, u4);
}

function renderActivityChart(dayCounts) {
  const ctx = document.getElementById("activityChart");
  if (!ctx) return;

  const sortedKeys = Object.keys(dayCounts)
    .sort((a, b) => new Date(a) - new Date(b))
    .slice(-14);

  if (activityChart) activityChart.destroy();

  activityChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sortedKeys,
      datasets: [{
        label: "Requests",
        data: sortedKeys.map(k => dayCounts[k]),
        backgroundColor: "rgba(26,44,255,0.15)",
        borderColor:     "#1a2cff",
        borderWidth:     2,
        borderRadius:    5,
        hoverBackgroundColor: "rgba(26,44,255,0.3)"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor:"#1a2cff", titleColor:"white", bodyColor:"white", padding:10, cornerRadius:8 }
      },
      scales: {
        y: { beginAtZero:true, ticks:{ stepSize:1, color:"#6b7280" }, grid:{ color:"#f0f0f0" } },
        x: { ticks:{ color:"#6b7280" }, grid:{ display:false } }
      }
    }
  });
}

function renderStatusPie(counts) {
  const ctx = document.getElementById("statusPieChart");
  if (!ctx) return;
  if (statusPieChart) statusPieChart.destroy();

  const colorMap = {
    "Pending":"#f59e0b", "In Progress":"#3b82f6",
    "Ready for Pickup":"#10b981", "Completed":"#6b7280", "Rejected":"#ef4444"
  };

  statusPieChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: Object.keys(counts).map(k => colorMap[k] || "#8b5cf6"),
        borderWidth: 2,
        borderColor: "white"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position:"bottom", labels:{ font:{ size:11 }, padding:14 } }
      }
    }
  });
}

// ============================================================
// RBAC
// ============================================================
function loadRBAC() {
  let residents = [], staffAdmins = [], resolved = 0;

  function tryRender() {
    resolved++;
    if (resolved < 2) return;
    allResidents   = residents;
    allStaffAdmins = staffAdmins;
    renderResidents(residents);
    renderStaffAdmins(staffAdmins);
  }

  const u1 = onSnapshot(collection(db, "users"), (snap) => {
    residents = snap.docs.map(d => ({ id:d.id, col:"users", ...d.data() }));
    tryRender();
  });

  const u2 = onSnapshot(collection(db, "admins"), (snap) => {
    staffAdmins = snap.docs.map(d => ({ id:d.id, col:"admins", ...d.data() }));
    tryRender();
  });

  // Live listener for pending registrations
  const u3 = onSnapshot(
    query(collection(db, "pendingAdmins"), orderBy("createdAt", "desc")),
    (snap) => {
      allPending = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderPendingAdmins(allPending);
    }
  );

  unsubscribers.push(u1, u2, u3);
}

// ============================================================
// RENDER PENDING REGISTRATIONS
// ============================================================
function renderPendingAdmins(list) {
  const el      = document.getElementById("pendingList");
  const countEl = document.getElementById("pendingCount");
  if (!el) return;

  const pending  = list.filter(u => u.status === "pending");
  const others   = list.filter(u => u.status !== "pending");
  if (countEl) countEl.textContent = pending.length;

  if (!list.length) {
    el.innerHTML = `<div class="empty-msg">No pending registrations.</div>`;
    return;
  }

  const statusBadge = (s) => {
    if (s === "approved") return `<span class="role-badge role-staff" style="background:rgba(34,197,94,0.15);color:#15803d;border:1px solid rgba(34,197,94,0.3);">Approved</span>`;
    if (s === "rejected") return `<span class="role-badge" style="background:rgba(239,68,68,0.12);color:#dc2626;border:1px solid rgba(239,68,68,0.25);">Rejected</span>`;
    return `<span class="role-badge" style="background:rgba(245,158,11,0.15);color:#b45309;border:1px solid rgba(245,158,11,0.3);">Pending</span>`;
  };

  el.innerHTML = list.map(u => {
    const name = u.fullName || `${u.firstName||""} ${u.lastName||""}`.trim() || u.email || u.id;
    const isPending = u.status === "pending";
    return `
      <div class="user-card ${!isPending ? "user-disabled" : ""}">
        <div class="user-info">
          <strong>${name}</strong>
          <small>${u.email || u.id}</small>
          ${u.position ? `<small style="color:#6b7280;">${u.position}</small>` : ""}
          <small style="color:#9ca3af;">Applied: ${u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString("en-PH") : "—"}</small>
        </div>
        <div class="user-actions">
          ${statusBadge(u.status)}
          ${isPending ? `
            <button class="btn-enable" onclick="openApproveModal('${u.id}','${name.replace(/'/g,"\'")}','${u.email||""}')" style="background:#22c55e;color:white;border-color:#22c55e;">Approve</button>
            <button class="btn-disable" onclick="openRejectModal('${u.id}','${name.replace(/'/g,"\'")}')">Reject</button>
          ` : u.role ? `<span class="role-badge role-${u.role}">${u.role}</span>` : ""}
        </div>
      </div>`;
  }).join("");
}

// ============================================================
// APPROVE MODAL
// ============================================================
window.openApproveModal = (uid, name, email) => {
  approveTargetUid = uid;
  const nameEl  = document.getElementById("approveTargetName");
  const emailEl = document.getElementById("approveTargetEmail");
  if (nameEl)  nameEl.textContent  = name;
  if (emailEl) emailEl.textContent = email;
  document.getElementById("approveRoleSelect").value = "staff";
  document.getElementById("approveModal")?.classList.add("open");
};

window.confirmApprove = async () => {
  if (!approveTargetUid) return;
  const role    = document.getElementById("approveRoleSelect")?.value || "staff";
  const btn     = document.getElementById("confirmApproveBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Approving…"; }

  try {
    // 1. Get pending doc data
    const pendingRef  = doc(db, "pendingAdmins", approveTargetUid);
    const pendingSnap = await getDoc(pendingRef);
    if (!pendingSnap.exists()) { showToast("Pending record not found.", "error"); return; }
    const data = pendingSnap.data();

    // 2. Write to admins collection (grants access)
    await setDoc(doc(db, "admins", approveTargetUid), {
      uid:        approveTargetUid,
      firstName:  data.firstName  || "",
      lastName:   data.lastName   || "",
      fullName:   data.fullName   || "",
      username:   data.username   || data.email,
      email:      data.email,
      position:   data.position   || "",
      role,
      active:     true,
      createdAt:  data.createdAt  || serverTimestamp(),
      updatedAt:  serverTimestamp()
    });

    // 3. Mark pending doc as approved
    await updateDoc(pendingRef, {
      status:    "approved",
      role,
      active:    true,
      updatedAt: serverTimestamp()
    });

    await logAction("RBAC APPROVE", `Approved registration for ${data.email} — role: ${role}`);
    showToast(`${data.fullName || data.email} approved as ${role}.`, "success");
    closeModal("approveModal");
  } catch (err) {
    console.error(err);
    showToast("Failed to approve registration.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><polyline points="20 6 9 17 4 12"/></svg> Approve &amp; Assign Role'; }
    approveTargetUid = null;
  }
};

// ============================================================
// REJECT MODAL
// ============================================================
window.openRejectModal = (uid, name) => {
  rejectTargetUid = uid;
  const nameEl = document.getElementById("rejectTargetName");
  if (nameEl) nameEl.textContent = name;
  document.getElementById("rejectModal")?.classList.add("open");
};

window.confirmReject = async () => {
  if (!rejectTargetUid) return;
  const btn = document.getElementById("confirmRejectBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Rejecting…"; }

  try {
    const pendingRef  = doc(db, "pendingAdmins", rejectTargetUid);
    const pendingSnap = await getDoc(pendingRef);
    const data = pendingSnap.exists() ? pendingSnap.data() : {};

    await updateDoc(pendingRef, {
      status:    "rejected",
      updatedAt: serverTimestamp()
    });

    await logAction("RBAC REJECT", `Rejected registration for ${data.email || rejectTargetUid}`);
    showToast(`Application rejected.`, "success");
    closeModal("rejectModal");
  } catch (err) {
    console.error(err);
    showToast("Failed to reject application.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Reject Application'; }
    rejectTargetUid = null;
  }
};

function buildItPagination(containerId, currentPage, totalPages, onChangeFn) {
  const pg = document.getElementById(containerId);
  if (!pg) return;
  if (totalPages <= 1) { pg.innerHTML = ""; return; }

  let pageNums = [];
  if (totalPages <= 3) {
    pageNums = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else if (currentPage === 1) {
    pageNums = [1, 2, "…"];
  } else if (currentPage === totalPages) {
    pageNums = ["…", totalPages - 1, totalPages];
  } else {
    pageNums = ["…", currentPage, "…"];
  }

  const chevLeft  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  const chevRight = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

  let html = `<button class="pg-btn pg-nav" ${currentPage===1?"disabled":""} onclick="${onChangeFn}(${currentPage-1})" aria-label="Previous">${chevLeft}</button>`;
  pageNums.forEach(p => {
    if (p === "…") {
      html += `<span class="pg-ellipsis">…</span>`;
    } else {
      html += `<button class="pg-btn${p===currentPage?" pg-active":""}" onclick="${onChangeFn}(${p})" aria-label="Page ${p}">${p}</button>`;
    }
  });
  html += `<button class="pg-btn pg-nav" ${currentPage===totalPages?"disabled":""} onclick="${onChangeFn}(${currentPage+1})" aria-label="Next">${chevRight}</button>`;
  html += `<span class="pg-info">${currentPage} / ${totalPages}</span>`;
  pg.innerHTML = html;
}

function renderResidents(list) {
  const el      = document.getElementById("residentsList");
  const countEl = document.getElementById("residentCount");
  if (!el) return;
  if (countEl) countEl.innerText = list.length;
  filteredResidents = list;

  const totalPages  = Math.ceil(list.length / IT_PAGE_SIZE) || 1;
  if (itResidentPage > totalPages) itResidentPage = totalPages;
  const start       = (itResidentPage - 1) * IT_PAGE_SIZE;
  const pageItems   = list.slice(start, start + IT_PAGE_SIZE);

  if (!list.length) {
    el.innerHTML = `<div class="empty-msg">No residents registered yet.</div>`;
    const pg = document.getElementById("pg-it-residents");
    if (pg) pg.innerHTML = "";
    return;
  }

  el.innerHTML = pageItems.map(u => {
    const name = u.firstName
      ? `${u.firstName} ${u.lastName || ""}`.trim()
      : (u.email || "Unknown");
    return `
      <div class="user-card ${u.active === false ? "user-disabled" : ""}">
        <div class="user-info">
          <strong>${name}</strong>
          <small>${u.email || u.id}</small>
        </div>
        <div class="user-actions">
          <span class="role-badge role-resident">Resident</span>
          ${u.active === false
            ? `<button class="btn-enable" onclick="enableAccount('${u.id}','users')">Enable</button>`
            : `<button class="btn-disable" onclick="openDisableModal('${u.id}','users','${name}')">Disable</button>`}
        </div>
      </div>`;
  }).join("");

  buildItPagination("pg-it-residents", itResidentPage, totalPages, "window._itResidentPage");
}

window._itResidentPage = (p) => { itResidentPage = p; renderResidents(filteredResidents); };

function renderStaffAdmins(list) {
  const el      = document.getElementById("staffList");
  const countEl = document.getElementById("staffCount");
  if (!el) return;
  if (countEl) countEl.innerText = list.length;
  filteredStaff = list;

  const totalPages = Math.ceil(list.length / IT_PAGE_SIZE) || 1;
  if (itStaffPage > totalPages) itStaffPage = totalPages;
  const start      = (itStaffPage - 1) * IT_PAGE_SIZE;
  const pageItems  = list.slice(start, start + IT_PAGE_SIZE);

  if (!list.length) {
    el.innerHTML = `<div class="empty-msg">No staff accounts yet.</div>`;
    const pg = document.getElementById("pg-it-staff");
    if (pg) pg.innerHTML = "";
    return;
  }

  const roleLabels = { staff:"Barangay Staff", admin:"Administrator", it:"IT Personnel" };
  const roleCss    = { staff:"role-staff", admin:"role-admin", it:"role-it" };

  el.innerHTML = pageItems.map(u => {
    const displayName = u.username || u.email || "Unknown";
    const roleLabel   = roleLabels[u.role] || u.role || "Staff";
    const roleCls     = roleCss[u.role]    || "role-staff";

    return `
      <div class="user-card ${u.active === false ? "user-disabled" : ""}">
        <div class="user-info">
          <strong>${displayName}</strong>
          <small>${u.email || u.id}</small>
          ${u.active === false ? `<span class="disabled-label">Disabled</span>` : ""}
        </div>
        <div class="user-actions">
          <span class="role-badge ${roleCls}">${roleLabel}</span>
          <select class="user-role-select" onchange="updateRole('${u.id}','admins',this.value)">
            <option value="staff" ${u.role==="staff" ?"selected":""}>Staff</option>
            <option value="admin" ${u.role==="admin" ?"selected":""}>Admin</option>
            <option value="it"    ${u.role==="it"    ?"selected":""}>IT</option>
          </select>
          ${u.active === false
            ? `<button class="btn-enable" onclick="enableAccount('${u.id}','admins')">Enable</button>`
            : `<button class="btn-disable" onclick="openDisableModal('${u.id}','admins','${displayName}')">Disable</button>`}
        </div>
      </div>`;
  }).join("");

  buildItPagination("pg-it-staff", itStaffPage, totalPages, "window._itStaffPage");
}

window._itStaffPage = (p) => { itStaffPage = p; renderStaffAdmins(filteredStaff); };

window.filterUsers = () => {
  const search = (document.getElementById("userSearch")?.value || "").toLowerCase();
  const roleF  = document.getElementById("roleFilter")?.value || "";

  const filteredResidentsList = allResidents.filter(u => {
    const name = `${u.firstName||""} ${u.lastName||""} ${u.email||""} ${u.id}`.toLowerCase();
    const matchRole = !roleF || roleF === "resident";
    return name.includes(search) && matchRole;
  });

  const filteredStaffList = allStaffAdmins.filter(u => {
    const text = `${u.username||""} ${u.email||""} ${u.id}`.toLowerCase();
    const matchRole = !roleF || u.role === roleF;
    return text.includes(search) && matchRole;
  });

  itResidentPage = 1;
  itStaffPage    = 1;
  renderResidents(filteredResidentsList);
  renderStaffAdmins(filteredStaffList);
};

// ============================================================
// UPDATE ROLE
// ============================================================
window.updateRole = async (userId, col, role) => {
  try {
    await updateDoc(doc(db, col, userId), { role, updatedAt: serverTimestamp() });
    await logAction("RBAC UPDATE", `User ${userId} in "${col}" — role changed to ${role}`);
    showToast(`Role updated to "${role}".`, "success");
  } catch (err) {
    showToast("Failed to update role.", "error");
  }
};

// ============================================================
// DISABLE / ENABLE ACCOUNTS
// ============================================================
window.openDisableModal = (id, col, name) => {
  disableTargetId  = id;
  disableTargetCol = col;
  const nameEl = document.getElementById("disableTargetName");
  if (nameEl) nameEl.textContent = name;
  document.getElementById("disableModal")?.classList.add("open");
};

window.closeDisableModal = () => {
  document.getElementById("disableModal")?.classList.remove("open");
  disableTargetId  = null;
  disableTargetCol = null;
};

window.confirmDisable = async () => {
  if (!disableTargetId || !disableTargetCol) return;

  const btn = document.getElementById("confirmDisableBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Disabling..."; }

  try {
    await updateDoc(doc(db, disableTargetCol, disableTargetId), {
      active:    false,
      updatedAt: serverTimestamp()
    });
    await logAction("ACCOUNT DISABLED", `Account ${disableTargetId} in "${disableTargetCol}" disabled`);
    showToast("Account disabled successfully.", "warning");
    closeDisableModal();
  } catch (err) {
    showToast("Failed to disable account.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Disable Account"; }
  }
};

window.enableAccount = async (id, col) => {
  try {
    await updateDoc(doc(db, col, id), { active: true, updatedAt: serverTimestamp() });
    await logAction("ACCOUNT ENABLED", `Account ${id} in "${col}" re-enabled`);
    showToast("Account re-enabled.", "success");
  } catch (err) {
    showToast("Failed to enable account.", "error");
  }
};

// ============================================================
// AUDIT LOGS
// ============================================================
function loadLogs() {
  const logsQ = query(collection(db, "logs"), orderBy("createdAt", "desc"));
  const unsub = onSnapshot(logsQ, (snap) => {
    allLogs = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderLogs(allLogs);
  });
  unsubscribers.push(unsub);
}

function renderLogs(logs) {
  const el = document.getElementById("logsList");
  if (!el) return;

  if (!logs.length) {
    el.innerHTML = `<div class="empty-msg">No logs found matching the current filter.</div>`;
    return;
  }

  el.innerHTML = logs.map(l => {
    const time = l.createdAt?.toDate?.().toLocaleString("en-PH") || "—";
    return `
      <div class="log-card">
        <div class="log-left">
          <span class="log-action ${getLogClass(l.action)}">${l.action}</span>
          <div class="log-details">${l.details}</div>
          ${l.user ? `<small class="log-by">By: ${l.user}</small>` : ""}
        </div>
        <div class="log-time">${time}</div>
      </div>`;
  }).join("");
}

window.filterLogs = () => {
  const search = (document.getElementById("logSearch")?.value  || "").toLowerCase();
  const action = document.getElementById("logFilter")?.value   || "";
  const filtered = allLogs.filter(l => {
    const matchSearch = !search ||
      (l.action||"").toLowerCase().includes(search) ||
      (l.details||"").toLowerCase().includes(search) ||
      (l.user||"").toLowerCase().includes(search);
    const matchAction = !action || l.action === action;
    return matchSearch && matchAction;
  });
  renderLogs(filtered);
};

window.exportLogs = () => {
  if (!allLogs.length) { showToast("No logs to export.", "warning"); return; }

  const rows = [
    ["Action","Details","User","Timestamp"],
    ...allLogs.map(l => [
      l.action,
      l.details,
      l.user || "",
      l.createdAt?.toDate?.().toLocaleString("en-PH") || ""
    ])
  ];

  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type:"text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), {
    href:     url,
    download: `audit-logs-${new Date().toISOString().slice(0,10)}.csv`
  });
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${allLogs.length} log entries.`, "success");
};

// ============================================================
// SYSTEM — LOAD
// ============================================================
function loadSystem() {
  const ref   = doc(db, "system", "config");
  const unsub = onSnapshot(ref, (snap) => {
    const data        = snap.exists() ? snap.data() : {};
    const maintenance = data.maintenance || false;
    const lastBackup  = data.lastBackup?.toDate?.().toLocaleString("en-PH") || "Never";
    const lastRestore = data.lastRestore?.toDate?.().toLocaleString("en-PH") || "Never";
    const lastBackupDocs = data.lastBackupDocs || "—";

    // Maintenance status
    const statusEl = document.getElementById("maintenanceStatus");
    if (statusEl) {
      statusEl.innerText = maintenance ? "ON" : "OFF";
      statusEl.className = `badge ${maintenance ? "badge-on" : "badge-off"}`;
    }

    const mainBtn = document.getElementById("maintenanceBtn");
    if (mainBtn) mainBtn.innerHTML = maintenance ? '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="#22c55e" stroke="#22c55e" stroke-width="2" style="vertical-align:middle;margin-right:5px;"><circle cx="12" cy="12" r="10"/></svg> Turn OFF Maintenance' : '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="#ef4444" stroke="#ef4444" stroke-width="2" style="vertical-align:middle;margin-right:5px;"><circle cx="12" cy="12" r="10"/></svg> Turn ON Maintenance';

    // Maintenance info (who/when turned on)
    const infoEl = document.getElementById("maintenanceInfo");
    const byEl   = document.getElementById("maintenanceEnabledBy");
    const atEl   = document.getElementById("maintenanceEnabledAt");
    if (infoEl && maintenance && data.maintenanceBy) {
      infoEl.style.display = "block";
      if (byEl) byEl.textContent = `Enabled by: ${data.maintenanceBy}`;
      if (atEl) atEl.textContent = `Since: ${data.maintenanceAt?.toDate?.().toLocaleString("en-PH") || "—"}`;
    } else if (infoEl) {
      infoEl.style.display = "none";
    }

    const backupEl = document.getElementById("lastBackupTime");
    if (backupEl) backupEl.innerText = lastBackup;

    const backupDocsEl = document.getElementById("lastBackupDocs");
    if (backupDocsEl) backupDocsEl.innerText = lastBackupDocs;

    const restoreEl = document.getElementById("lastRestoredTime");
    if (restoreEl) restoreEl.innerText = lastRestore;

    const bannerEl = document.getElementById("maintenanceBanner");
    if (bannerEl) bannerEl.style.display = maintenance ? "block" : "none";
  });

  // Load snapshot count
  loadSnapshotCount();

  unsubscribers.push(unsub);
}

async function loadSnapshotCount() {
  try {
    const snap = await getDocs(collection(db, "backupMeta"));
    const el   = document.getElementById("snapshotCount");
    if (el) el.innerText = snap.size > 0 ? `${snap.size} snapshot(s)` : "None yet";
  } catch (err) {
    const el = document.getElementById("snapshotCount");
    if (el) el.innerText = "—";
  }
}

// ============================================================
// MAINTENANCE MODE — FIXED
// ============================================================
window.toggleMaintenance = async () => {
  const mainBtn = document.getElementById("maintenanceBtn");
  if (mainBtn) { mainBtn.disabled = true; mainBtn.textContent = "Updating..."; }

  try {
    const ref  = doc(db, "system", "config");
    const snap = await getDoc(ref);
    const curr = snap.exists() ? (snap.data()?.maintenance || false) : false;
    const next = !curr;

    const updateData = {
      maintenance: next,
      maintenanceUpdatedAt: serverTimestamp()
    };

    if (next) {
      // Turning ON — record who and when
      updateData.maintenanceBy = auth.currentUser?.email || "unknown";
      updateData.maintenanceAt = serverTimestamp();
    } else {
      // Turning OFF — clear the info
      updateData.maintenanceBy = null;
      updateData.maintenanceAt = null;
    }

    // Use setDoc with merge to create the doc if it doesn't exist
    await setDoc(ref, updateData, { merge: true });
    await logAction("SYSTEM", `Maintenance mode turned ${next ? "ON" : "OFF"} by ${auth.currentUser?.email || "unknown"}`);
    showToast(`Maintenance mode is now ${next ? "ON" : "OFF"}.`, next ? "warning" : "success");
  } catch (err) {
    console.error("Maintenance toggle error:", err);
    showToast("Failed to toggle maintenance mode: " + err.message, "error");
  } finally {
    if (mainBtn) mainBtn.disabled = false;
  }
};

// ============================================================
// DATA BACKUP — FIXED WITH PROGRESS
// ============================================================
window.backupData = async () => {
  const btn         = document.getElementById("backupBtn");
  const progressWrap = document.getElementById("backupProgressWrap");
  const progressBar  = document.getElementById("backupProgressBar");
  const progressLabel= document.getElementById("backupProgressLabel");

  if (btn) { btn.disabled = true; btn.textContent = "Backing up..."; }
  if (progressWrap) progressWrap.style.display = "block";

  const cols = ["users", "requests", "services", "announcements"];
  let totalDocs = 0;
  let processedDocs = 0;

  try {
    // First pass — count total docs
    if (progressLabel) progressLabel.textContent = "Counting documents...";
    if (progressBar)   progressBar.style.width   = "5%";

    const counts = {};
    for (const col of cols) {
      const snap = await getDocs(collection(db, col));
      counts[col] = snap.size;
      totalDocs += snap.size;
    }

    // Generate snapshot timestamp key
    const snapshotId = `snapshot_${Date.now()}`;
    const snapshotTs = new Date();

    // Second pass — write backup docs
    for (let ci = 0; ci < cols.length; ci++) {
      const col  = cols[ci];
      const snap = await getDocs(collection(db, col));

      if (progressLabel) progressLabel.textContent = `Backing up "${col}" (${ci + 1}/${cols.length})...`;

      for (const docSnap of snap.docs) {
        await setDoc(doc(db, "backups", `${snapshotId}_${col}_${docSnap.id}`), {
          ...docSnap.data(),
          _snapshotId:        snapshotId,
          _backedUpAt:        snapshotTs,
          _sourceCollection:  col,
          _sourceId:          docSnap.id
        });
        processedDocs++;
        const pct = Math.round((processedDocs / totalDocs) * 90) + 5;
        if (progressBar) progressBar.style.width = `${pct}%`;
      }
    }

    // Save snapshot metadata
    await setDoc(doc(db, "backupMeta", snapshotId), {
      snapshotId,
      createdAt:     snapshotTs,
      createdBy:     auth.currentUser?.email || "unknown",
      totalDocs,
      collections:   cols,
      label:         snapshotTs.toLocaleString("en-PH")
    });

    // Update system config
    await setDoc(doc(db, "system", "config"), {
      lastBackup:     snapshotTs,
      lastBackupDocs: totalDocs,
      lastSnapshotId: snapshotId
    }, { merge: true });

    if (progressBar)   progressBar.style.width   = "100%";
    if (progressLabel) progressLabel.textContent = `Backup complete! ${totalDocs} docs saved.`;

    await logAction("BACKUP", `Manual backup — snapshot: ${snapshotId}, ${totalDocs} docs from: ${cols.join(", ")}`);
    showToast(`Backup complete — ${totalDocs} documents saved.`, "success");

    loadSnapshotCount();

    setTimeout(() => {
      if (progressWrap) progressWrap.style.display = "none";
      if (progressBar)  progressBar.style.width    = "0%";
    }, 3000);

  } catch (err) {
    console.error("Backup error:", err);
    if (progressLabel) progressLabel.textContent = "Backup failed.";
    showToast("Backup failed: " + err.message, "error");
    setTimeout(() => {
      if (progressWrap) progressWrap.style.display = "none";
    }, 3000);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg> Backup Now'; }
  }
};

// ============================================================
// BACKUP HISTORY MODAL
// ============================================================
window.showBackupList = async () => {
  document.getElementById("backupListModal")?.classList.add("open");
  const el = document.getElementById("backupListContent");
  if (el) el.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading...</div>`;

  try {
    const q    = query(collection(db, "backupMeta"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      if (el) el.innerHTML = `<div class="empty-msg">No backups found. Run a backup first.</div>`;
      return;
    }

    if (el) {
      el.innerHTML = snap.docs.map(d => {
        const b = d.data();
        const t = b.createdAt?.toDate?.().toLocaleString("en-PH") || "—";
        return `
          <div class="backup-history-item">
            <div>
              <strong>${t}</strong>
              <small>By: ${b.createdBy || "—"} &nbsp;|&nbsp; ${b.totalDocs || 0} docs &nbsp;|&nbsp; Collections: ${(b.collections||[]).join(", ")}</small>
            </div>
            <span class="snapshot-id-badge">${b.snapshotId}</span>
          </div>`;
      }).join("");
    }
  } catch (err) {
    if (el) el.innerHTML = `<div class="empty-msg" style="color:var(--danger);">Failed to load backups: ${err.message}</div>`;
  }
};

// ============================================================
// DATA RECOVERY PANEL
// ============================================================
window.showRecoveryPanel = async () => {
  resetRecoveryPanel();
  document.getElementById("recoveryModal")?.classList.add("open");
  await loadSnapshotList();
};

async function loadSnapshotList() {
  const el = document.getElementById("snapshotList");
  if (el) el.innerHTML = `<div class="loading-row"><div class="spinner"></div> Loading snapshots...</div>`;

  try {
    const q    = query(collection(db, "backupMeta"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) {
      if (el) el.innerHTML = `<div class="empty-msg">No backup snapshots found. Please run a backup first.</div>`;
      return;
    }

    if (el) {
      el.innerHTML = snap.docs.map(d => {
        const b = d.data();
        const t = b.createdAt?.toDate?.().toLocaleString("en-PH") || "—";
        return `
          <div class="snapshot-item" data-sid="${b.snapshotId}" data-label="${t}" onclick="selectSnapshot('${b.snapshotId}','${t}',this)">
            <div class="snapshot-radio"></div>
            <div>
              <strong>${t}</strong>
              <small>${b.totalDocs || 0} documents — by ${b.createdBy || "—"}</small>
            </div>
          </div>`;
      }).join("");
    }

    // Auto-select the most recent
    const first = el?.querySelector(".snapshot-item");
    if (first) {
      const sid   = first.dataset.sid;
      const label = first.dataset.label;
      selectSnapshot(sid, label, first);
    }

  } catch (err) {
    if (el) el.innerHTML = `<div class="empty-msg" style="color:var(--danger);">Failed to load snapshots: ${err.message}</div>`;
  }
}

window.selectRecoveryCollection = (col, btn) => {
  selectedRecoveryCollection = col;
  document.querySelectorAll(".rec-col-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
};

window.selectSnapshot = (snapshotId, label, el) => {
  selectedSnapshotTimestamp = snapshotId;
  selectedSnapshotLabel     = label;
  document.querySelectorAll(".snapshot-item").forEach(s => s.classList.remove("selected"));
  if (el) el.classList.add("selected");
};

window.cancelRestore = () => {
  document.getElementById("recoveryStep2").style.display = "block";
  document.getElementById("recoveryStep1").style.display = "block";
  document.getElementById("recoveryStep2").style.display = "none";
};

// Proceed to confirm step
window.proceedToConfirm = () => {
  if (!selectedSnapshotTimestamp) {
    showToast("Please select a backup snapshot first.", "warning");
    return;
  }

  const colLabel = selectedRecoveryCollection === "all"
    ? "all collections (users, requests, services, announcements)"
    : `"${selectedRecoveryCollection}"`;

  const confirmText = document.getElementById("confirmRestoreText");
  if (confirmText) {
    confirmText.innerHTML = `Restore <strong>${colLabel}</strong> from snapshot:<br><em>${selectedSnapshotLabel}</em>`;
  }

  document.getElementById("recoveryStep1").style.display = "none";
  document.getElementById("recoveryStep2").style.display = "block";
};

window.cancelRestore = () => {
  document.getElementById("recoveryStep1").style.display = "block";
  document.getElementById("recoveryStep2").style.display = "none";
};

// Execute the actual restore
window.executeRestore = async () => {
  if (!selectedSnapshotTimestamp) {
    showToast("No snapshot selected.", "error");
    return;
  }

  const confirmBtn = document.getElementById("confirmRestoreBtn");
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = "Restoring..."; }

  const progressWrap  = document.getElementById("recoveryProgressWrap");
  const progressBar   = document.getElementById("recoveryProgressBar");
  const progressLabel = document.getElementById("recoveryProgressLabel");
  if (progressWrap) progressWrap.style.display = "block";

  const colsToRestore = selectedRecoveryCollection === "all"
    ? ["users", "requests", "services", "announcements"]
    : [selectedRecoveryCollection];

  let restoredDocs = 0;
  let totalToRestore = 0;

  try {
    // Fetch all backup docs for this snapshot
    const backupSnap = await getDocs(query(
      collection(db, "backups"),
      where("_snapshotId", "==", selectedSnapshotTimestamp)
    ));

    // Filter by target collection(s)
    const docsToRestore = backupSnap.docs.filter(d =>
      colsToRestore.includes(d.data()._sourceCollection)
    );

    totalToRestore = docsToRestore.length;

    if (totalToRestore === 0) {
      showToast("No documents found in this snapshot for the selected collection.", "warning");
      return;
    }

    if (progressLabel) progressLabel.textContent = `Restoring ${totalToRestore} documents...`;
    if (progressBar)   progressBar.style.width   = "5%";

    for (const backupDoc of docsToRestore) {
      const data = backupDoc.data();
      const { _snapshotId, _backedUpAt, _sourceCollection, _sourceId, ...originalData } = data;

      // Write back to original collection with original ID
      await setDoc(doc(db, _sourceCollection, _sourceId), {
        ...originalData,
        _restoredAt:       new Date(),
        _restoredFrom:     _snapshotId,
        _restoredBy:       auth.currentUser?.email || "unknown"
      }, { merge: false }); // Full overwrite

      restoredDocs++;
      const pct = Math.round((restoredDocs / totalToRestore) * 90) + 5;
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (progressLabel) progressLabel.textContent = `Restoring... ${restoredDocs}/${totalToRestore}`;
    }

    if (progressBar)   progressBar.style.width   = "100%";
    if (progressLabel) progressLabel.textContent = "Restore complete!";

    // Update system config
    await setDoc(doc(db, "system", "config"), {
      lastRestore:      new Date(),
      lastRestoreSnap:  selectedSnapshotTimestamp,
      lastRestoreBy:    auth.currentUser?.email || "unknown",
      lastRestoreDocs:  restoredDocs
    }, { merge: true });

    await logAction("RECOVERY", `Data restored from snapshot "${selectedSnapshotTimestamp}" — ${restoredDocs} docs in [${colsToRestore.join(", ")}]`);

    // Show result
    document.getElementById("recoveryStep2").style.display = "none";
    document.getElementById("recoveryStep3").style.display = "block";
    document.getElementById("recoveryResultIcon").innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    document.getElementById("recoveryResultTitle").textContent = "Restore Complete";
    document.getElementById("recoveryResultText").innerHTML =
      `Successfully restored <strong>${restoredDocs}</strong> documents from snapshot <em>${selectedSnapshotLabel}</em>.`;

    showToast(`Restore complete — ${restoredDocs} documents restored.`, "success");

    setTimeout(() => {
      if (progressWrap) progressWrap.style.display = "none";
    }, 3000);

  } catch (err) {
    console.error("Restore error:", err);

    document.getElementById("recoveryStep2").style.display = "none";
    document.getElementById("recoveryStep3").style.display = "block";
    document.getElementById("recoveryResultIcon").innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    document.getElementById("recoveryResultTitle").textContent = "Restore Failed";
    document.getElementById("recoveryResultText").innerHTML =
      `Error during restore: ${err.message}<br>Partially restored ${restoredDocs} of ${totalToRestore} documents.`;

    showToast("Restore failed: " + err.message, "error");

    await logAction("RECOVERY", `Restore FAILED from snapshot "${selectedSnapshotTimestamp}" — error: ${err.message}`);
  } finally {
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3"/></svg> Yes, Restore Now'; }
  }
};

window.resetRecoveryPanel = () => {
  selectedSnapshotTimestamp = null;
  selectedSnapshotLabel     = null;
  selectedRecoveryCollection = "users";

  document.getElementById("recoveryStep1").style.display = "block";
  document.getElementById("recoveryStep2").style.display = "none";
  document.getElementById("recoveryStep3").style.display = "none";

  document.getElementById("recoveryProgressWrap").style.display = "none";
  document.getElementById("recoveryProgressBar").style.width     = "0%";

  document.querySelectorAll(".rec-col-btn").forEach(b => b.classList.remove("active"));
  const usersBtn = document.querySelector(".rec-col-btn[data-col='users']");
  if (usersBtn) usersBtn.classList.add("active");

  closeModal("recoveryModal");
};

// Add confirm button to the HTML step 1 (appended dynamically)
window.showRecoveryPanel = async () => {
  // Reset first
  selectedSnapshotTimestamp = null;
  selectedSnapshotLabel     = null;
  selectedRecoveryCollection = "users";
  document.getElementById("recoveryStep1").style.display = "block";
  document.getElementById("recoveryStep2").style.display = "none";
  document.getElementById("recoveryStep3").style.display = "none";

  document.getElementById("recoveryProgressWrap").style.display = "none";
  document.getElementById("recoveryProgressBar").style.width     = "0%";
  document.querySelectorAll(".rec-col-btn").forEach(b => b.classList.remove("active"));
  const usersBtn = document.querySelector(".rec-col-btn[data-col='users']");
  if (usersBtn) usersBtn.classList.add("active");

  document.getElementById("recoveryModal")?.classList.add("open");
  await loadSnapshotList();

  // Add a "Continue" button below snapshot list if not already present
  const step1 = document.getElementById("recoveryStep1");
  if (step1 && !step1.querySelector(".recovery-proceed-btn")) {
    const btn = document.createElement("button");
    btn.className = "action-btn full-btn recovery-proceed-btn";
    btn.style.marginTop = "14px";
    btn.innerHTML = "Continue <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"vertical-align:-2px;margin-left:4px;\"><polyline points=\"9 18 15 12 9 6\"/></svg>";
    btn.onclick = proceedToConfirm;
    step1.appendChild(btn);
  }
};

// ============================================================
// MODALS — GENERIC
// ============================================================
window.closeModal = (id) => {
  document.getElementById(id)?.classList.remove("open");
};

window.handleOverlayClick = (e, modalId) => {
  if (e.target.id === modalId) {
    document.getElementById(modalId)?.classList.remove("open");
    if (modalId === "disableModal") closeDisableModal();
    if (modalId === "recoveryModal") resetRecoveryPanel();
  }
};

// ============================================================
// HELPERS
// ============================================================
async function logAction(action, details) {
  try {
    await addDoc(collection(db, "logs"), {
      action,
      details,
      createdAt: serverTimestamp(),
      user: auth.currentUser?.email || auth.currentUser?.uid || "unknown"
    });
  } catch (err) { /* silent */ }
}

function getLogClass(action = "") {
  const a = action.toUpperCase();
  if (a.includes("RBAC") || a.includes("ROLE"))         return "rbac";
  if (a.includes("SYSTEM") || a.includes("MAINT"))      return "system";
  if (a.includes("BACKUP"))                             return "backup";
  if (a.includes("RECOVERY") || a.includes("RESTORE"))  return "backup";
  if (a.includes("ACCOUNT"))                            return "account";
  if (a.includes("LOGIN") || a.includes("LOGOUT"))      return "login";
  return "other";
}

window.logout = () => {
  const modal = document.getElementById("itLogoutModal");
  if (modal) {
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }
};

window.cancelItLogout = () => {
  const modal = document.getElementById("itLogoutModal");
  if (modal) {
    modal.classList.remove("open");
    document.body.style.overflow = "";
  }
};

window.confirmItLogout = async () => {
  const btn = document.getElementById("confirmItLogoutBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Logging out…"; }
  await logAction("LOGOUT", `IT logout: ${auth.currentUser?.email || "unknown"}`);
  localStorage.removeItem("adminUsername");
  localStorage.removeItem("role");
  localStorage.removeItem("uid");
  if (!localStorage.getItem("bf_resident_uid")) {
    await signOut(auth);
  }
  window.location.replace("admin-login.html");
};
