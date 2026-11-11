/**
 * auth.js — BarangayFlow Resident Authentication
 *
 * KEY FIX vs original:
 *   ✓ LOGIN is 24/7 — residents can always check their status/announcements
 *   ✓ REGISTRATION is still restricted to office hours (staff availability)
 *   ✓ REQUEST SUBMISSION is restricted in request.js + firestore.rules
 */

import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function setError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent   = msg;
  el.style.display = msg ? "block" : "none";
}
function setLoading(btnId, show, loadingText, defaultText) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled    = show;
  btn.textContent = show ? loadingText : defaultText;
}
function getPHT() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
}
// Registration is open 24/7 — ID validation is done by admin after submission

// ─────────────────────────────────────────────
//  CLOUDINARY CONFIG (ID upload)
// ─────────────────────────────────────────────
const CLD_CLOUD  = "dqlei56w3";
const CLD_PRESET = "barangayflow_docs";
const CLD_URL    = `https://api.cloudinary.com/v1_1/${CLD_CLOUD}/auto/upload`;

function uploadIdToCloudinary(file) {
  const fd = new FormData();
  fd.append("file",          file);
  fd.append("upload_preset", CLD_PRESET);
  fd.append("folder",        "barangay_resident_ids");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", CLD_URL);
    xhr.timeout = 120_000;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const r = JSON.parse(xhr.responseText);
        resolve({ secureUrl: r.secure_url, publicId: r.public_id });
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText)?.error?.message || msg; } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror   = () => reject(new Error("Network error during ID upload."));
    xhr.ontimeout = () => reject(new Error("ID upload timed out."));
    xhr.send(fd);
  });
}

// ─────────────────────────────────────────────
//  REGISTRATION — PIN flow
// ─────────────────────────────────────────────
let _pendingRegData = null, _pendingPin = null,
    _pinExpiry = null, _resendCooldown = null;

function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendPinEmail(toEmail, toName, pin) {
  let res;
  try {
    res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: "service_1a2x7fh", template_id: "template_pr7b3ue",
        user_id: "krigoh9n_j7c_y5T1",
        template_params: { to_name: toName, to_email: toEmail, pin_code: pin,
                           reply_to: "noreply@barangayflow.web.app" }
      })
    });
  } catch {
    throw new Error("Could not reach the email service. Check your internet connection and try again.");
  }

  if (!res.ok) {
    const responseText = (await res.text()).trim();
    const reason = responseText ? `: ${responseText.slice(0, 250)}` : "";
    throw new Error(`Email service returned HTTP ${res.status}${reason}`);
  }
}

function showPinOverlay(email) {
  const overlay = document.getElementById("pinOverlay");
  if (!overlay) return;
  document.getElementById("pinEmailHint").textContent = email;
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
  setTimeout(() => document.querySelector(".pin-digit")?.focus(), 200);
}
function hidePinOverlay() {
  const overlay = document.getElementById("pinOverlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  document.body.style.overflow = "";
}
function startResendCooldown() {
  let secs = 60;
  const btn = document.getElementById("pinResendBtn");
  const timer = document.getElementById("pinResendTimer");
  if (!btn || !timer) return;
  btn.disabled = true;
  timer.textContent = `Resend in ${secs}s`;
  clearInterval(_resendCooldown);
  _resendCooldown = setInterval(() => {
    secs--;
    timer.textContent = secs > 0 ? `Resend in ${secs}s` : "";
    if (secs <= 0) { clearInterval(_resendCooldown); btn.disabled = false; }
  }, 1000);
}

const registerForm = document.getElementById("registerForm");
if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("registerError", "");
    const firstName = document.getElementById("firstName")?.value.trim() || "";
    const middleName = document.getElementById("middleName")?.value.trim() || "";
    const lastName  = document.getElementById("lastName")?.value.trim()  || "";
    const gender = document.getElementById("gender")?.value || "";
    const civilStatus = document.getElementById("civilStatus")?.value || "";
    const birthDate = document.getElementById("birthDate")?.value || "";
    const placeOfBirth = document.getElementById("placeOfBirth")?.value.trim() || "";
    const sector = Array.from(document.querySelectorAll('input[name="sector"]:checked'))
      .map(input => input.value);
    const email     = document.getElementById("email")?.value.trim()     || "";
    const phone     = document.getElementById("phone")?.value.trim()     || "";
    const landline  = document.getElementById("landline")?.value.trim()  || "";
    const address   = document.getElementById("address")?.value.trim()   || "";
    const password  = document.getElementById("password")?.value         || "";
    const confirm   = document.getElementById("confirmPassword")?.value  || "";

    const pwErrors = [];
    if (password.length < 8)            pwErrors.push("at least 8 characters");
    if (!/[A-Z]/.test(password))        pwErrors.push("one uppercase letter");
    if (!/[a-z]/.test(password))        pwErrors.push("one lowercase letter");
    if (!/[0-9]/.test(password))        pwErrors.push("one number");
    if (!/[^A-Za-z0-9]/.test(password)) pwErrors.push("one special character");
    if (pwErrors.length) {
      setError("registerError", "Password must contain: " + pwErrors.join(", ") + "."); return;
    }
    if (password !== confirm) { setError("registerError", "Passwords do not match."); return; }
    if (!sector.length) {
      setError("registerError", "Please select at least one resident sector.");
      document.querySelector('input[name="sector"]')?.focus(); return;
    }
    if (!address) {
      setError("registerError", "Please select your Purok and Street to complete your address.");
      document.getElementById("addrPurok")?.focus(); return;
    }
    if (!/sta\.?\s*rita/i.test(address) || !/olongapo/i.test(address)) {
      setError("registerError", "Address must be within Barangay Sta. Rita, Olongapo City only."); return;
    }
    // Validate ID file is selected
    const idFile = window._selectedIdFile;
    if (!idFile) {
      setError("registerError", "Please upload a valid government-issued ID to continue.");
      const idBox = document.getElementById("idUploadBox");
      if (idBox) { idBox.classList.add("id-upload-box--error"); idBox.scrollIntoView({ behavior: "smooth", block: "center" }); }
      return;
    }

    setLoading("registerBtn", true, "Sending PIN…", "Create Account");
    try {
      const pin = generatePin();
      _pendingPin = pin; _pinExpiry = Date.now() + 10 * 60 * 1000;
      _pendingRegData = {
        firstName, middleName, lastName, gender, civilStatus, birthDate,
        placeOfBirth, sector, email, phone, landline, address, password
      };
      await sendPinEmail(email, firstName, pin);
      showPinOverlay(email); startResendCooldown();
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown email service error.";
      setError("registerError", `Could not send verification PIN. ${detail}`);
      console.error(err);
    } finally {
      setLoading("registerBtn", false, "", "Create Account");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const digits = document.querySelectorAll(".pin-digit");
  digits.forEach((input, i) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(-1);
      if (input.value && i < digits.length - 1) digits[i + 1].focus();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && i > 0) digits[i - 1].focus();
    });
    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
      digits.forEach((d, j) => { if (text[j]) d.value = text[j]; });
      const last = Math.min(text.length, digits.length) - 1;
      if (last >= 0) digits[last].focus();
    });
  });

  const verifyBtn = document.getElementById("pinVerifyBtn");
  if (verifyBtn) {
    verifyBtn.addEventListener("click", async () => {
      const entered  = Array.from(digits).map(d => d.value).join("");
      const pinError = document.getElementById("pinError");
      if (entered.length < 6) {
        if (pinError) { pinError.textContent = "Please enter the full 6-digit PIN."; pinError.style.display = "block"; }
        return;
      }
      if (Date.now() > _pinExpiry) {
        if (pinError) { pinError.textContent = "PIN has expired. Please request a new one."; pinError.style.display = "block"; }
        return;
      }
      if (entered !== _pendingPin) {
        if (pinError) { pinError.textContent = "Incorrect PIN. Please try again."; pinError.style.display = "block"; }
        const box = document.getElementById("pinInputRow");
        if (box) { box.classList.add("pin-shake"); setTimeout(() => box.classList.remove("pin-shake"), 500); }
        digits.forEach(d => d.value = ""); digits[0].focus(); return;
      }
      if (pinError) pinError.style.display = "none";
      verifyBtn.disabled = true; verifyBtn.textContent = "Creating account…";
      const {
        firstName, middleName, lastName, gender, civilStatus, birthDate,
        placeOfBirth, sector, email, phone, landline, address, password
      } = _pendingRegData;
      let registrationStep = "ID upload";
      try {
        verifyBtn.textContent = "Uploading ID…";
        // Upload ID to Cloudinary first
        const idFile = window._selectedIdFile;
        let idUrl = "", idPublicId = "";
        if (idFile) {
          const cloud = await uploadIdToCloudinary(idFile);
          idUrl = cloud.secureUrl;
          idPublicId = cloud.publicId;
        }

        registrationStep = "Firebase account creation";
        verifyBtn.textContent = "Creating account…";
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        registrationStep = "saving your profile to Firestore";
        await setDoc(doc(db, "users", userCred.user.uid), {
          firstName, middleName, lastName, gender, civilStatus, birthDate,
          placeOfBirth, sector, email, phone, landline, address,
          emailVerified: true,
          active: false,
          accountStatus: "pending_verification",
          idPhotoUrl: idUrl,
          idPhotoPublicId: idPublicId,
          idFileName: idFile ? idFile.name : "",
          createdAt: serverTimestamp()
        });
        hidePinOverlay();
        const errorEl = document.getElementById("registerError");
        if (errorEl) {
          errorEl.textContent = "Account created! Your ID is now under review. The barangay admin will activate your account once verified. Redirecting to login…";
          errorEl.style.display = "block"; errorEl.style.color = "#16a34a";
          errorEl.style.background = "#f0fff4"; errorEl.style.border = "1px solid #bbf7d0";
          errorEl.style.borderRadius = "8px"; errorEl.style.padding = "12px 14px";
        }
        setTimeout(() => { window.location.href = "login.html"; }, 3000);
      } catch (err) {
        hidePinOverlay();
        const errMap = {
          "auth/email-already-in-use": "An account with this email already exists. Try signing in instead.",
          "auth/invalid-email": "Please enter a valid email address.",
          "auth/weak-password": "Password is too weak. Use at least 6 characters.",
          "auth/operation-not-allowed": "Email/password sign-in is not enabled for this Firebase project.",
          "auth/network-request-failed": "Network error connecting to Firebase. Check your connection and try again.",
          "permission-denied": "Firestore denied permission to save the profile. Check the deployed Firestore rules.",
          "unavailable": "Firestore is temporarily unavailable. Check your connection and try again."
        };
        const code = err?.code || "";
        const message = errMap[code] || (err instanceof Error ? err.message : "Unknown error.");
        setError("registerError", `Registration failed while ${registrationStep}: ${message}`);
        console.error("Registration failed:", { step: registrationStep, code, error: err });
        verifyBtn.disabled = false; verifyBtn.textContent = "Verify PIN";
      }
    });
  }

  document.getElementById("pinResendBtn")?.addEventListener("click", async () => {
    if (!_pendingRegData) return;
    const pin = generatePin(); _pendingPin = pin; _pinExpiry = Date.now() + 10 * 60 * 1000;
    const pinError = document.getElementById("pinError");
    try {
      await sendPinEmail(_pendingRegData.email, _pendingRegData.firstName, pin);
      startResendCooldown();
      if (pinError) { pinError.textContent = "New PIN sent! Check your inbox."; pinError.style.display = "block"; pinError.style.color = "#16a34a"; pinError.style.background = "#f0fff4"; }
      document.querySelectorAll(".pin-digit").forEach(d => d.value = "");
      document.querySelector(".pin-digit")?.focus();
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown email service error.";
      if (pinError) { pinError.textContent = `Failed to resend PIN. ${detail}`; pinError.style.display = "block"; pinError.style.color = "#dc2626"; pinError.style.background = "#fee2e2"; }
    }
  });

  document.getElementById("pinCancelBtn")?.addEventListener("click", () => {
    hidePinOverlay(); _pendingPin = null; _pinExpiry = null; _pendingRegData = null;
  });
});

// ═════════════════════════════════════════════
//  LOGIN — 24 / 7, no working-hours gate
// ═════════════════════════════════════════════
window.login = async function (event) {
  event.preventDefault();
  setError("loginError", "");

  const email    = document.getElementById("login-email")?.value.trim() || "";
  const password = document.getElementById("login-password")?.value     || "";

  if (!email || !password) { setError("loginError", "Please fill in all fields."); return; }

  // ── NO time gate here ──────────────────────────────────────
  // Residents log in 24/7 to check status & announcements.
  // Only submitting NEW requests is time-restricted (request.js).

  setLoading("loginBtn", true, "Signing in…", "Login");
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const userSnap = await getDoc(doc(db, "users", cred.user.uid));
    if (userSnap.exists()) {
      const ud = userSnap.data();
      if (ud.accountStatus === "pending_verification") {
        setError("loginError", "Your account is pending verification. The barangay admin is reviewing your submitted ID. You will be notified once your account is activated.");
        await signOut(auth); setLoading("loginBtn", false, "", "Login"); return;
      }
      if (ud.accountStatus === "rejected") {
        setError("loginError", "Your account registration was rejected. Please contact the barangay office for assistance.");
        await signOut(auth); setLoading("loginBtn", false, "", "Login"); return;
      }
      if (ud.active === false) {
        setError("loginError", "This account has been disabled. Please contact the barangay office.");
        await signOut(auth); setLoading("loginBtn", false, "", "Login"); return;
      }
    }
    localStorage.setItem("bf_resident_uid", cred.user.uid);
    sessionStorage.setItem("bf_session_active", "1");
    window.location.href = "/dashboard.html";
  } catch (error) {
    const errMap = {
      "auth/user-not-found":     "No account found with this email.",
      "auth/wrong-password":     "Incorrect password.",
      "auth/invalid-email":      "Invalid email address.",
      "auth/too-many-requests":  "Too many attempts. Please wait before trying again.",
      "auth/invalid-credential": "Incorrect email or password."
    };
    setError("loginError", errMap[error.code] || "Login failed. Please try again.");
  } finally {
    setLoading("loginBtn", false, "", "Login");
  }
};

// ═════════════════════════════════════════════
//  FORGOT PASSWORD
// ═════════════════════════════════════════════
document.getElementById("forgotBtn")?.addEventListener("click", async (e) => {
  e.preventDefault();
  const emailInput = document.getElementById("login-email");
  const email = emailInput?.value.trim().toLowerCase() || "";
  setError("loginError", "");
  if (!email) {
    setError("loginError", "Enter your email address first, then click Forgot Password.");
    emailInput?.focus(); return;
  }
  const forgotBtn = document.getElementById("forgotBtn");
  if (forgotBtn) { forgotBtn.disabled = true; forgotBtn.textContent = "Sending…"; forgotBtn.style.opacity = "0.6"; forgotBtn.style.pointerEvents = "none"; }
  try {
    await sendPasswordResetEmail(auth, email, { url: "https://barangayflow.web.app/reset.html", handleCodeInApp: false });
    const el = document.getElementById("loginError");
    if (el) { el.textContent = `Reset link sent to ${email}. Check your inbox and spam folder.`; el.style.display = "block"; el.style.background = "#f0fff4"; el.style.color = "#16a34a"; el.style.borderColor = "#bbf7d0"; }
  } catch (err) {
    const map = { "auth/invalid-email": "That email is not valid.", "auth/too-many-requests": "Too many attempts.", "auth/user-not-found": "No account found with that email." };
    const el = document.getElementById("loginError");
    if (el) { el.style.background = ""; el.style.color = ""; el.style.borderColor = ""; }
    setError("loginError", map[err.code] || `Error: ${err.message}`);
  } finally {
    if (forgotBtn) { forgotBtn.disabled = false; forgotBtn.textContent = "Forgot Password?"; forgotBtn.style.opacity = ""; forgotBtn.style.pointerEvents = ""; }
  }
});

// ═════════════════════════════════════════════
//  REAL-TIME PASSWORD STRENGTH
// ═════════════════════════════════════════════
document.getElementById("password")?.addEventListener("input", function () {
  const val = this.value;
  if (!val) { setError("registerError", ""); return; }
  const missing = [];
  if (val.length < 8)            missing.push("8+ characters");
  if (!/[A-Z]/.test(val))        missing.push("uppercase letter");
  if (!/[a-z]/.test(val))        missing.push("lowercase letter");
  if (!/[0-9]/.test(val))        missing.push("number");
  if (!/[^A-Za-z0-9]/.test(val)) missing.push("special character");
  missing.length
    ? setError("registerError", "Password still needs: " + missing.join(", ") + ".")
    : setError("registerError", "");
});
