/**
 * request.js — BarangayFlow Resident Request Panel
 *
 * Storage  : Cloudinary (unsigned upload — no backend required)
 *            Cloud Name   : dqlel56w3
 *            Upload Preset: barangayflow_docs
 *
 * Features :
 *   ✓ Working Hours gate  Mon–Fri 08:00–17:00 PHT (client + Firestore rules backup)
 *   ✓ Supporting documents MANDATORY — cannot submit without one
 *   ✓ 2 MB hard reject gate — file rejected before any upload attempt
 *   ✓ Client-side Canvas image compression → target ≤ 500 KB
 *   ✓ XHR upload to Cloudinary with live progress bar
 *   ✓ Permanent secure_url stored in Firestore request document
 *   ✓ Mobile-first: 44 px touch targets, font-size ≥ 16 px (no iOS zoom)
 *   ✓ Drag-and-drop support
 *   ✓ Single Firestore write per submission (Spark-plan friendly)
 */

import { auth, db } from "./firebase.js";
import {
  collection, addDoc, serverTimestamp, doc, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ─────────────────────────────────────────────────────────
//  CLOUDINARY CONFIG
// ─────────────────────────────────────────────────────────
const CLOUDINARY_CLOUD_NAME    = "dqlei56w3";
const CLOUDINARY_UPLOAD_PRESET = "barangayflow_docs";
const CLOUDINARY_UPLOAD_URL    =
  `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;

// ─────────────────────────────────────────────────────────
//  WORKING HOURS  (Mon–Fri 08:00–17:00 PHT = UTC+8)
// ─────────────────────────────────────────────────────────
const WORK_DAYS  = [1, 2, 3, 4, 5]; // 0=Sun … 6=Sat
const WORK_START = 8;
const WORK_END   = 17;

// ─────────────────────────────────────────────────────────
//  FILE CONSTRAINTS
// ─────────────────────────────────────────────────────────
const MAX_FILE_BYTES        = 2 * 1024 * 1024;  // 2 MB reject gate
const COMPRESS_TARGET_BYTES = 500 * 1024;        // 500 KB target
const COMPRESS_MAX_DIM      = 1920;              // max px per side
const ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/webp", "application/pdf"
];

// ═════════════════════════════════════════════════════════
//  TIME HELPERS
// ═════════════════════════════════════════════════════════
function getPhilippineTime() {
  const now   = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  return new Date(utcMs + 8 * 3_600_000);
}

function isWithinWorkingHours() {
  const pht  = getPhilippineTime();
  return WORK_DAYS.includes(pht.getDay())
    && pht.getHours() >= WORK_START
    && pht.getHours() <  WORK_END;
}

function formatWorkingHours() {
  return "Monday – Friday, 8:00 AM – 5:00 PM (Philippine Standard Time)";
}

// ═════════════════════════════════════════════════════════
//  IMAGE COMPRESSION  (Canvas → JPEG, returns Promise<File>)
//  PDFs are passed through unchanged.
// ═════════════════════════════════════════════════════════
function compressImage(file) {
  if (file.type === "application/pdf")       return Promise.resolve(file);
  if (file.size <= COMPRESS_TARGET_BYTES)    return Promise.resolve(file);

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Scale to fit within max dimension
      let { width, height } = img;
      const scale = Math.min(1, COMPRESS_MAX_DIM / Math.max(width, height));
      width  = Math.round(width  * scale);
      height = Math.round(height * scale);

      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);

      // Try decreasing quality until under target
      const attempt = (quality) => {
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("Canvas compression failed")); return; }
          if (blob.size <= COMPRESS_TARGET_BYTES || quality <= 0.25) {
            resolve(new File(
              [blob],
              file.name.replace(/\.[^.]+$/, ".jpg"),
              { type: "image/jpeg" }
            ));
          } else {
            attempt(+(quality - 0.10).toFixed(2));
          }
        }, "image/jpeg", quality);
      };
      attempt(0.85);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });
}

// ═════════════════════════════════════════════════════════
//  CLOUDINARY UPLOAD  (XHR with progress callback)
//  Returns { secureUrl, publicId, format, bytes }
// ═════════════════════════════════════════════════════════
function uploadToCloudinary(file, onProgress) {
  const formData = new FormData();
  formData.append("file",          file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder",        "barangay_requests");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", CLOUDINARY_UPLOAD_URL);
    xhr.timeout = 120_000; // 2 min

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const res = JSON.parse(xhr.responseText);
        resolve({
          secureUrl : res.secure_url,
          publicId  : res.public_id,
          format    : res.format,
          bytes     : res.bytes
        });
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText)?.error?.message || msg; } catch {}
        reject(new Error(msg));
      }
    };

    xhr.onerror   = () => reject(new Error("Network error during upload."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Check your connection."));
    xhr.send(formData);
  });
}

// ═════════════════════════════════════════════════════════
//  MAIN — DOMContentLoaded
// ═════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  const form          = document.getElementById("requestForm");
  const uploadBox     = document.getElementById("uploadBox");
  const fileInput     = document.getElementById("fileInput");
  const serviceSelect = document.getElementById("serviceType");
  let   selectedFile  = null;
  let   servicesData  = [];

  if (fileInput)
    fileInput.setAttribute("accept", "image/jpeg,image/png,image/webp,application/pdf");

  // ── WORKING HOURS REMINDER (non-blocking) ────────────────
  function applyWorkingHoursState() {
    const banner = document.getElementById("workingHoursBanner");
    if (!banner) return;
    if (isWithinWorkingHours()) {
      banner.style.display = "none";
    } else {
      const pht     = getPhilippineTime();
      const dayName = ["Sunday","Monday","Tuesday","Wednesday",
                       "Thursday","Friday","Saturday"][pht.getDay()];
      const timeStr = pht.toLocaleTimeString("en-PH",
        { hour:"2-digit", minute:"2-digit", hour12:true });
      const msgEl = document.getElementById("offHoursMsg");
      if (msgEl) {
        msgEl.textContent =
          `It is currently ${dayName}, ${timeStr} (PHT) — outside the barangay's ` +
          `regular office hours (${formatWorkingHours()}). You may still submit your ` +
          `request, but it will be processed on the next working day.`;
      }
      banner.style.display = "flex";
    }
  }

  applyWorkingHoursState();
  setInterval(applyWorkingHoursState, 60_000);

  // ── TOAST ────────────────────────────────────────────────
  function showToast(msg, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const icons = { success:"✓", error:"✕", warning:"!", info:"i" };
    const toast  = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${icons[type] ?? "i"} ${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity   = "0";
      toast.style.transform = "translateX(30px)";
      setTimeout(() => toast.remove(), 350);
    }, 5000);
  }

  function setInlineError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent   = msg;
    el.style.display = msg ? "block" : "none";
  }

  // ── UPLOAD PROGRESS BAR ──────────────────────────────────
  function setUploadProgress(pct) {
    let wrap = document.getElementById("uploadProgressWrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "uploadProgressWrap";
      wrap.style.cssText =
        "margin-top:8px;background:#e5e7eb;border-radius:999px;height:6px;overflow:hidden;";
      const bar = document.createElement("div");
      bar.id = "uploadProgressBar";
      bar.style.cssText =
        "height:100%;background:linear-gradient(90deg,#1a2cff,#0f1fbf);" +
        "border-radius:999px;width:0%;transition:width .2s ease;";
      wrap.appendChild(bar);
      uploadBox?.parentNode?.insertBefore(wrap, uploadBox.nextSibling);
    }
    const bar = document.getElementById("uploadProgressBar");
    if (bar) bar.style.width = `${pct}%`;
    if (pct >= 100) setTimeout(() => wrap.remove(), 700);
  }

  // ── AUTH ─────────────────────────────────────────────────
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    const residentUid = localStorage.getItem("bf_resident_uid");
    if (!residentUid || residentUid !== user.uid) {
      window.location.href = "login.html";
      return;
    }
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) {
        const d   = snap.data();
        const set = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.value = val;
        };
        set("fullName", `${d.firstName || ""} ${d.lastName || ""}`.trim());
        set("contact",  d.phone   || "");
        set("address",  d.address || "");
      }
    } catch { /* non-critical */ }
    loadServices();
  });

  // ── LOAD SERVICES (single read) ──────────────────────────
  async function loadServices() {
    try {
      const snap = await getDocs(collection(db, "services"));
      if (!serviceSelect) return;
      serviceSelect.innerHTML =
        '<option value="" disabled selected hidden>Select Service Type</option>';
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.active === false) return;
        servicesData.push({ id: docSnap.id, ...data });
        const opt       = document.createElement("option");
        opt.value       = docSnap.id;
        opt.textContent = data.name;
        serviceSelect.appendChild(opt);
      });
      if (servicesData.length === 0)
        serviceSelect.innerHTML =
          '<option disabled selected>No services available right now</option>';
    } catch {
      showToast("Could not load services. Please refresh.", "error");
    }
  }

  // ── SERVICE SELECTION → requirements ────────────────────
  serviceSelect?.addEventListener("change", (e) => {
    const selected = servicesData.find(s => s.id === e.target.value);
    const box      = document.getElementById("serviceRequirementBox");
    if (!box) return;
    if (selected) {
      box.style.display = "block";
      const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
      };
      setText("svcDescText", selected.description || "No description provided.");
      setText("svcDocsText", selected.documents?.length
        ? `Required documents: ${selected.documents.join(", ")}`
        : "No specific documents required.");
      setText("svcFeeText",  selected.fee  ? `₱${selected.fee}`        : "Free");
      setText("svcDaysText", selected.days ? `${selected.days} day(s)` : "To be advised");
    } else {
      box.style.display = "none";
    }
  });

  // ── FILE VALIDATION ──────────────────────────────────────
  function validateFile(file) {
    if (!ALLOWED_MIME.includes(file.type))
      return "Only JPEG, PNG, WEBP images or PDFs are accepted.";
    if (file.size > MAX_FILE_BYTES)
      return `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — maximum allowed is 2 MB.`;
    return null;
  }

  // ── UPLOAD BOX UI ────────────────────────────────────────
  function resetUploadBox() {
    if (!uploadBox) return;
    uploadBox.classList.remove("upload-box--error");
    uploadBox.innerHTML = `
      <div style="text-align:center;pointer-events:none;">
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24"
             fill="none" stroke="#9ca3af" stroke-width="1.5"
             style="display:block;margin:0 auto 8px;">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        <span style="font-size:14px;color:#374151;font-weight:600;">Click to browse</span>
        <span style="font-size:13px;color:#6b7280;"> or drag &amp; drop here</span><br>
        <span style="font-size:12px;color:#9ca3af;margin-top:4px;display:inline-block;">
          JPEG · PNG · WEBP · PDF &nbsp;·&nbsp; Max 2 MB
        </span><br>
        <span style="display:inline-block;margin-top:8px;background:#fef2f2;color:#dc2626;
                     border:1px solid #fecaca;border-radius:6px;padding:2px 10px;
                     font-size:11px;font-weight:700;letter-spacing:.3px;">REQUIRED</span>
      </div>`;
  }
  resetUploadBox();

  function showFileInBox(file) {
    if (!uploadBox) return;
    uploadBox.classList.remove("upload-box--error");
    const isImg  = file.type.startsWith("image/");
    const sizeKb = (file.size / 1024).toFixed(0);

    uploadBox.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;width:100%;
                  flex-wrap:wrap;justify-content:center;">
        <div style="display:flex;align-items:center;gap:8px;">
          ${isImg
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"
                    viewBox="0 0 24 24" fill="none" stroke="#1a2cff" stroke-width="1.8">
                 <rect x="3" y="3" width="18" height="18" rx="2"/>
                 <circle cx="8.5" cy="8.5" r="1.5"/>
                 <polyline points="21 15 16 10 5 21"/>
               </svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"
                    viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.8">
                 <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                 <polyline points="14 2 14 8 20 8"/>
               </svg>`}
          <div style="text-align:left;">
            <div style="font-size:13px;font-weight:600;color:#1f2937;
                        word-break:break-all;max-width:200px;">${file.name}</div>
            <div style="font-size:11px;color:#6b7280;">${sizeKb} KB · ${file.type}</div>
          </div>
        </div>
        <button type="button" id="removeFileBtn"
                style="min-width:44px;min-height:44px;display:flex;align-items:center;
                       justify-content:center;background:#fee2e2;border:none;
                       border-radius:8px;cursor:pointer;color:#dc2626;
                       -webkit-tap-highlight-color:transparent;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>`;

    document.getElementById("removeFileBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      selectedFile = null;
      if (fileInput) fileInput.value = "";
      resetUploadBox();
    });
  }

  // ── FILE INPUT EVENTS ────────────────────────────────────
  uploadBox?.addEventListener("click", (e) => {
    if (e.target.id === "removeFileBtn" || e.target.closest?.("#removeFileBtn")) return;
    fileInput?.click();
  });

  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const err = validateFile(file);
    if (err) { showToast(err, "error"); fileInput.value = ""; return; }
    selectedFile = file;
    showFileInBox(file);
  });

  // Drag & drop
  uploadBox?.addEventListener("dragover",  (e) => {
    e.preventDefault();
    uploadBox.style.borderColor = "#1a2cff";
  });
  uploadBox?.addEventListener("dragleave", () => {
    uploadBox.style.borderColor = "";
  });
  uploadBox?.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadBox.style.borderColor = "";
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const err = validateFile(file);
    if (err) { showToast(err, "error"); return; }
    selectedFile = file;
    showFileInBox(file);
  });

  // ── FORM SUBMISSION ──────────────────────────────────────
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setInlineError("requestError", "");

    const user    = auth.currentUser;
    const svcId   = serviceSelect?.value;
    const purpose = document.getElementById("purpose")?.value?.trim();

    if (!svcId)   { setInlineError("requestError", "Please select a service type."); return; }
    if (!purpose) { setInlineError("requestError", "Please describe the purpose of your request."); return; }

    // Mandatory document check
    if (!selectedFile) {
      setInlineError("requestError",
        "Supporting documents are required. Please upload a photo of your " +
        "valid ID or a relevant document (JPEG, PNG, or PDF).");
      uploadBox?.classList.add("upload-box--error");
      uploadBox?.scrollIntoView({ behavior:"smooth", block:"center" });
      return;
    }
    uploadBox?.classList.remove("upload-box--error");

    const submitBtn = document.getElementById("submitBtn");
    const setBtn    = (txt, disabled) => {
      if (!submitBtn) return;
      submitBtn.textContent = txt;
      submitBtn.disabled    = disabled;
    };

    try {
      // Step 1 — compress
      setBtn("Optimizing document…", true);
      let fileToUpload = selectedFile;
      if (selectedFile.type.startsWith("image/")) {
        try {
          const before = selectedFile.size;
          fileToUpload = await compressImage(selectedFile);
          const saved  = ((before - fileToUpload.size) / 1024).toFixed(0);
          if (saved > 0)
            console.info(`[BarangayFlow] Compressed: saved ${saved} KB`);
        } catch (compErr) {
          console.warn("[BarangayFlow] Compression skipped:", compErr.message);
          fileToUpload = selectedFile;
        }
      }

      // Step 2 — upload to Cloudinary
      setBtn("Uploading… 0%", true);
      const cloud = await uploadToCloudinary(fileToUpload, (pct) => {
        setBtn(`Uploading… ${pct}%`, true);
        setUploadProgress(pct);
      });

      // Step 3 — single Firestore write
      setBtn("Submitting request…", true);
      await addDoc(collection(db, "requests"), {
        userId:           user.uid,
        serviceId:        svcId,
        serviceType:      serviceSelect.options[serviceSelect.selectedIndex]?.text || "",
        fullName:         document.getElementById("fullName")?.value  || "",
        contact:          document.getElementById("contact")?.value   || "",
        address:          document.getElementById("address")?.value   || "",
        purpose,
        notes:            document.getElementById("notes")?.value     || "",
        status:           "Pending",
        // Cloudinary document fields
        fileURL:          cloud.secureUrl,
        filePublicId:     cloud.publicId,
        fileName:         selectedFile.name,
        fileType:         fileToUpload.type,
        fileSizeBytes:    cloud.bytes,
        // Verification state (updated by staff in review.js)
        docVerification:  "Pending",
        docInvalidReason: "",
        // Timestamps
        createdAt:        serverTimestamp(),
        updatedAt:        serverTimestamp()
      });

      showToast("Request submitted successfully! Redirecting…", "success");
      setTimeout(() => { window.location.href = "dashboard.html"; }, 1600);

    } catch (err) {
      console.error("[BarangayFlow] Submission error:", err);
      const isNet = /network|timed out/i.test(err.message || "");
      setInlineError("requestError", isNet
        ? "Upload failed — please check your internet connection and try again."
        : `Submission failed: ${err.message || "Unknown error. Please try again."}`);
      setBtn("Submit Request", false);
    }
  });
});

// ═════════════════════════════════════════════════════════
//  LOGOUT
// ═════════════════════════════════════════════════════════
document.getElementById("logoutBtn")?.addEventListener("click", (e) => {
  e.preventDefault();
  const modal = document.getElementById("reqLogoutModal");
  if (modal) { modal.classList.add("open"); document.body.style.overflow = "hidden"; }
});

window.cancelReqLogout = () => {
  const modal = document.getElementById("reqLogoutModal");
  if (modal) { modal.classList.remove("open"); document.body.style.overflow = ""; }
};

window.confirmReqLogout = async () => {
  const btn = document.getElementById("confirmReqLogoutBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Logging out…"; }
  localStorage.removeItem("bf_resident_uid");
  sessionStorage.removeItem("bf_session_active");
  await signOut(auth);
  window.location.replace("login.html");
};
