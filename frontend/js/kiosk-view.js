import { db } from "./firebase.js";
import {
  collection, doc, onSnapshot, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/** Escapes HTML special characters to prevent XSS in rendered kiosk cells. */
export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Returns true when a request record originated from the self-service kiosk. */
export function isKioskRequest(record) {
  return record?.source === "kiosk"
    || Boolean(record?.queueNumber)
    || Boolean(record?.kioskReference);
}

/** Returns true when a kiosk record has been marked as Completed. */
export function isKioskCompleted(record) {
  return String(record?.status || "").trim().toLowerCase() === "completed";
}

/** Subscribes to live kiosk submissions in the `kioskRequests` collection. */
export function subscribeKioskCollection({ onData, onError }) {
  return onSnapshot(collection(db, "kioskRequests"), (snapshot) => {
    const docs = snapshot.docs.map(d => ({
      id: d.id,
      _collection: "kioskRequests",
      ...d.data()
    }));
    onData?.(docs);
  }, (err) => {
    onError?.(err);
  });
}

function getTimestampMs(ts) {
  if (ts === null) return Date.now();
  if (ts?.toMillis) return ts.toMillis();
  if (ts) {
    const ms = new Date(ts).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

function formatDisplayDate(ts, fallback = "—") {
  if (ts === null) return "Just now";
  const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
  if (!d || Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/** Merges `kioskRequests` and any legacy kiosk records, newest first. */
export function mergeAndSortKioskRequests(primaryList, legacyList = []) {
  const seen = new Set();
  const merged = [];
  const normalize = (item, defaultCollection) => ({
    _collection: item._collection || defaultCollection,
    ...item
  });

  [
    ...(primaryList || []).map(item => normalize(item, "kioskRequests")),
    ...(legacyList || []).map(item => normalize(item, "requests"))
  ].forEach(item => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    merged.push(item);
  });

  return merged.sort((a, b) => {
    const aMs = getTimestampMs(isKioskCompleted(a) ? (a.completedAt || a.updatedAt || a.createdAt) : a.createdAt);
    const bMs = getTimestampMs(isKioskCompleted(b) ? (b.completedAt || b.updatedAt || b.createdAt) : b.createdAt);
    return bMs - aMs;
  });
}

/** Formats a PHP fee amount for kiosk display. */
export function formatKioskFee(amount) {
  const num = Number(amount) || 0;
  if (num <= 0) return "Free";
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Collects readable purpose, extra form fields, and notes for a kiosk ticket. */
export function formatKioskDetails(r) {
  const parts = [];
  if (r.purpose) parts.push(`Purpose: ${r.purpose}`);
  const extra = r.extraData || {};
  const businessName = r.businessName || extra.businessName;
  const businessNature = r.businessNature || extra.businessNature;
  const businessAddress = r.businessAddress || extra.businessAddress;
  if (businessName) {
    parts.push(`Business: ${businessName}${businessNature ? ` (${businessNature})` : ""}`);
  }
  if (businessAddress) parts.push(`Business Addr: ${businessAddress}`);
  if (extra.ftjEducation) parts.push(`Education: ${extra.ftjEducation}`);
  if (extra.ftjResidencyLength) parts.push(`Residency: ${extra.ftjResidencyLength}`);
  if (extra.birthdate) {
    parts.push(`DOB: ${extra.birthdate}${extra.bloodType ? ` • Blood: ${extra.bloodType}` : ""}`);
  }
  if (extra.patientName) parts.push(`Patient: ${extra.patientName}`);
  if (extra.hospital) parts.push(`Hospital: ${extra.hospital}`);
  if (extra.emergencyContact) parts.push(`Emergency: ${extra.emergencyContact}`);
  if (extra.respondent) parts.push(`Respondent: ${extra.respondent}`);
  if (extra.incidentSummary) {
    parts.push(`Incident${extra.incidentDate ? ` (${extra.incidentDate})` : ""}: ${extra.incidentSummary}`);
  }
  if (r.notes) parts.push(`Notes: ${r.notes}`);
  return parts;
}

/** Filters kiosk records by free-text search across all visible fields. */
export function filterKioskRequests(items, searchQuery) {
  const search = (searchQuery || "").trim().toLowerCase();
  if (!search) return items;

  return items.filter(r => {
    const docNames = Array.isArray(r.documents) ? r.documents.map(d => d.name).join(" ") : "";
    const extraVals = r.extraData ? Object.values(r.extraData).join(" ") : "";
    const haystack = [
      r.queueNumber,
      r.kioskReference,
      r.id,
      r.fullName,
      r.contact,
      r.address,
      r.age,
      r.civilStatus,
      r.claimMode,
      r.representativeName,
      r.serviceType,
      docNames,
      r.windowLabel,
      r.purpose,
      r.notes,
      r.businessName,
      r.businessNature,
      r.businessAddress,
      r.completedBy,
      extraVals
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(search);
  });
}

/** Marks a kiosk request as Completed so it moves to Completed Requests (Category: Kiosk). */
export async function markKioskRequestCompleted({ id, sourceCollection = "kioskRequests", completedBy = "staff" }) {
  const targetCol = sourceCollection === "requests" ? "requests" : "kioskRequests";
  await updateDoc(doc(db, targetCol, id), {
    status: "Completed",
    completedAt: serverTimestamp(),
    completedBy: completedBy || "staff",
    updatedAt: serverTimestamp()
  });
}

/** Attaches a delegated click handler on `tableEl` for `.done-request-btn` buttons. */
export function bindDoneRequestHandler({ tableEl, getUserEmail, onSuccess, onError }) {
  if (!tableEl || tableEl.dataset.doneBound === "1") return;
  tableEl.dataset.doneBound = "1";

  tableEl.addEventListener("click", async (e) => {
    const btn = e.target.closest(".done-request-btn");
    if (!btn || btn.disabled) return;

    const id = btn.dataset.kioskId;
    const sourceCollection = btn.dataset.kioskCol || "kioskRequests";
    const queueLabel = btn.dataset.queue || "Kiosk Request";
    if (!id) return;

    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Completing...";

    try {
      await markKioskRequestCompleted({
        id,
        sourceCollection,
        completedBy: getUserEmail?.() || "staff"
      });
      onSuccess?.(queueLabel);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = prevText;
      onError?.(err);
    }
  });
}

/**
 * Renders either active kiosk queue rows (with a Done Request button)
 * or completed kiosk rows (read-only, under Category: Kiosk).
 */
export function renderKioskTableView({
  tableEl,
  countPillEl,
  items,
  search = "",
  page = 1,
  pageSize = 10,
  mode = "active",
  countUnit = "Kiosk Request"
}) {
  if (!tableEl) return { totalPages: 1, clampedPage: 1, totalMatchingMode: 0 };

  const scoped = mode === "completed"
    ? items.filter(isKioskCompleted)
    : (mode === "active" ? items.filter(r => !isKioskCompleted(r)) : items);

  const filtered = filterKioskRequests(scoped, search);
  const hasSearch = Boolean((search || "").trim());

  if (countPillEl) {
    const total = scoped.length;
    const plural = (n) => `${countUnit}${n === 1 ? "" : "s"}`;
    countPillEl.textContent = hasSearch
      ? `${filtered.length} of ${total} ${plural(total)}`
      : `${total} ${plural(total)}`;
  }

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  if (!paginated.length) {
    const emptyMsg = hasSearch
      ? `No ${mode === "completed" ? "completed kiosk" : "kiosk"} requests match your search.`
      : (mode === "completed"
        ? "No completed kiosk requests yet."
        : "No pending kiosk requests right now.");
    tableEl.innerHTML = `<div class="empty-row empty-state">${emptyMsg}</div>`;
    return { totalPages: 1, clampedPage: 1, totalMatchingMode: scoped.length };
  }

  const isActiveMode = mode === "active";

  tableEl.innerHTML = paginated.map(r => {
    const submitted = formatDisplayDate(r.createdAt);
    const completedDate = formatDisplayDate(r.completedAt || r.updatedAt || r.createdAt);
    const docSummary = Array.isArray(r.documents) && r.documents.length
      ? r.documents.map(d => d.name).join(", ")
      : (r.serviceType || "—");
    const applicantMeta = [
      r.age ? `Age ${r.age}` : "",
      r.civilStatus || ""
    ].filter(Boolean).join(" • ");
    const repText = r.claimMode === "Representative" && r.representativeName
      ? `Rep: ${r.representativeName}`
      : (r.claimMode || "");
    const detailLines = formatKioskDetails(r);
    const feeLabel = r.totalFee !== undefined ? formatKioskFee(r.totalFee) : "";
    const rowCol = r._collection || "kioskRequests";

    return `<div class="row kiosk-row${isActiveMode ? " has-action" : ""}">
      <span data-label="Queue / Ref">
        <strong class="kiosk-queue-badge">${escapeHtml(r.queueNumber || "KIOSK")}</strong>
        ${r.kioskReference ? `<small class="kiosk-sub mono">${escapeHtml(r.kioskReference)}</small>` : ""}
        ${feeLabel ? `<small class="kiosk-fee-pill">${escapeHtml(feeLabel)}</small>` : ""}
      </span>
      <span data-label="Applicant">
        <strong>${escapeHtml(r.fullName || "N/A")}</strong>
        ${applicantMeta ? `<small class="kiosk-sub">${escapeHtml(applicantMeta)}</small>` : ""}
        ${repText ? `<small class="kiosk-sub">${escapeHtml(repText)}</small>` : ""}
      </span>
      <span data-label="Contact &amp; Address">
        <strong>${escapeHtml(r.contact || "—")}</strong>
        <small class="kiosk-sub">${escapeHtml(r.address || "—")}</small>
      </span>
      <span data-label="Requested Document(s)">
        <strong>${escapeHtml(docSummary)}</strong>
        ${r.windowLabel ? `<small class="kiosk-sub">${escapeHtml(r.windowLabel)}</small>` : ""}
      </span>
      <span data-label="Purpose &amp; Details">
        ${detailLines.length
          ? detailLines.map(line => `<small class="kiosk-sub">${escapeHtml(line)}</small>`).join("")
          : `<small class="kiosk-sub">—</small>`}
      </span>
      ${isActiveMode
        ? `<span data-label="Submitted">
             <span>${escapeHtml(submitted)}</span>
           </span>
           <span data-label="Action" class="kiosk-action-cell">
             <button type="button"
                     class="done-request-btn"
                     data-kiosk-id="${escapeHtml(r.id)}"
                     data-kiosk-col="${escapeHtml(rowCol)}"
                     data-queue="${escapeHtml(r.queueNumber || r.fullName || "Kiosk Request")}">
               Done Request
             </button>
           </span>`
        : `<span data-label="Completed">
             <span class="kiosk-done-badge">Completed</span>
             <span class="kiosk-cat-chip">Kiosk</span>
             <small class="kiosk-sub">${escapeHtml(completedDate)}</small>
             ${r.completedBy ? `<small class="kiosk-sub">By: ${escapeHtml(r.completedBy)}</small>` : ""}
           </span>`}
    </div>`;
  }).join("");

  return { totalPages, clampedPage, totalMatchingMode: scoped.length };
}
