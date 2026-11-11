// js/admin-register.js
// ============================================================
// Staff Registration
// Flow:
//   1. Client-side validation (no network needed)
//   2. createUserWithEmailAndPassword  (handles email-already-in-use)
//   3. NOW authenticated → query admins/pendingAdmins for username dupe
//   4. If dupe → delete the fresh Auth account and surface the error
//   5. setDoc(pendingAdmins, uid)  → status:"pending", role:null
//   6. signOut  → user must wait for IT approval
// ============================================================

import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, query, collection,
  where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── UI helpers ───────────────────────────────────────────────
function setError(msg) {
  const el = document.getElementById("regError");
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
  if (msg) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setLoading(show) {
  const btn = document.getElementById("regBtn");
  if (!btn) return;
  btn.disabled    = show;
  btn.textContent = show ? "Submitting…" : "Submit Application";
}

function showPending(fname, lname, email) {
  document.getElementById("step-register").style.display = "none";
  const pending = document.getElementById("step-pending");
  pending.style.display = "";
  pending.scrollIntoView({ behavior: "smooth", block: "start" });

  document.getElementById("pending-name").textContent      = `${fname} ${lname}`;
  document.getElementById("pending-email-disp").textContent = email;
  document.getElementById("pending-time").textContent      =
    new Date().toLocaleString("en-PH", { dateStyle: "long", timeStyle: "short" });
}

// ── Client-side validation (no network) ─────────────────────
function validateForm(fname, lname, username, email, emailConfirm, password, confirm) {
  if (!fname.trim() || !lname.trim())
    return "First and last name are required.";
  if (!username || username.length < 3)
    return "Username must be at least 3 characters.";
  if (!/^[a-z0-9_.\-]+$/.test(username))
    return "Username may only contain lowercase letters, numbers, underscores, dots, or hyphens.";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return "Please enter a valid email address.";
  if (!emailConfirm)
    return "Please confirm your email address.";
  if (email.toLowerCase() !== emailConfirm.toLowerCase())
    return "Email addresses do not match. Please re-enter.";
  if (!password || password.length < 8)
    return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password))
    return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(password))
    return "Password must contain at least one lowercase letter.";
  if (!/[0-9]/.test(password))
    return "Password must contain at least one number.";
  if (!/[^A-Za-z0-9]/.test(password))
    return "Password must contain at least one special character (!@#$%^&*).";
  if (password !== confirm)
    return "Passwords do not match. Please re-enter.";

  // Working hours validation (Mon-Fri 8AM-5PM, Sat 8AM-12PM, PH time)
  const now = new Date();
  const phTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const day  = phTime.getDay();
  const hour = phTime.getHours();
  const mins = phTime.getMinutes();
  const t    = hour + mins / 60;
  const isWeekday  = day >= 1 && day <= 5;
  const isSaturday = day === 6;
  const open = (isWeekday && t >= 8 && t < 17) || (isSaturday && t >= 8 && t < 12);
  if (!open)
    return "Staff registration is only allowed during Barangay Sta. Rita office hours: Mon–Fri 8:00 AM – 5:00 PM, Sat 8:00 AM – 12:00 PM (Philippine Time).";

  return null;
}

// ── Duplicate username check (runs AFTER auth, so rules allow it) ──
async function isUsernameTaken(username) {
  try {
    // Check active staff accounts
    const adminSnap = await getDocs(
      query(collection(db, "admins"), where("username", "==", username))
    );
    if (!adminSnap.empty) return true;

    // Check pending applications
    const pendingSnap = await getDocs(
      query(collection(db, "pendingAdmins"), where("username", "==", username))
    );
    return !pendingSnap.empty;
  } catch {
    // If we can't query (rules edge case), allow through — setDoc will catch real conflicts
    return false;
  }
}

// ── Firebase Auth error map ──────────────────────────────────
const AUTH_ERRORS = {
  "auth/email-already-in-use":
    "This email is already registered. If you have an account, go to Sign In.",
  "auth/invalid-email":
    "The email address format is invalid.",
  "auth/weak-password":
    "Password is too weak. Use at least 8 characters with mixed characters.",
  "auth/too-many-requests":
    "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed":
    "Network error. Please check your connection and try again.",
  "auth/operation-not-allowed":
    "Email/password accounts are not enabled. Contact your administrator."
};

// ── Main submit handler ──────────────────────────────────────
window.submitRegistration = async function (e) {
  e.preventDefault();
  setError("");

  const fname    = (document.getElementById("reg-fname")?.value    || "").trim();
  const lname    = (document.getElementById("reg-lname")?.value    || "").trim();
  const username = (document.getElementById("reg-username")?.value || "").trim().toLowerCase();
  const email        = (document.getElementById("reg-email")?.value         || "").trim().toLowerCase();
  const emailConfirm = (document.getElementById("reg-email-confirm")?.value || "").trim().toLowerCase();
  const position = (document.getElementById("reg-position")?.value || "").trim();
  const password = document.getElementById("reg-password")?.value  || "";
  const confirm  = document.getElementById("reg-confirm")?.value   || "";

  // ── Step 1: Client-side validation ──────────────────────────
  const validErr = validateForm(fname, lname, username, email, emailConfirm, password, confirm);
  if (validErr) { setError(validErr); return; }

  // ── Step 1b: NDA must be acknowledged ────────────────────────
  const ndaCb  = document.getElementById("ndaCheck");
  const ndaErr = document.getElementById("ndaError");
  if (!ndaCb?.checked) {
    if (ndaErr) { ndaErr.style.display = "block"; ndaErr.scrollIntoView({ behavior: "smooth", block: "center" }); }
    setError("You must acknowledge the Non-Disclosure Agreement before submitting.");
    return;
  }
  if (ndaErr) ndaErr.style.display = "none";

  setLoading(true);
  let userCred = null;

  try {
    // ── Step 2: Create Firebase Auth account ─────────────────
    // This is the FIRST network call so we get a clean auth error
    // (e.g. email-already-in-use) before touching Firestore.
    try {
      userCred = await createUserWithEmailAndPassword(auth, email, password);
    } catch (authErr) {
      setError(AUTH_ERRORS[authErr.code] || `Account creation failed: ${authErr.message}`);
      setLoading(false);
      return;
    }

    const uid  = userCred.user.uid;

    // ── Step 3: Username duplicate check (now authenticated) ─
    const taken = await isUsernameTaken(username);
    if (taken) {
      // Roll back: delete the just-created Auth account
      try { await deleteUser(userCred.user); } catch (_) {}
      setError("This username is already taken. Please choose a different one.");
      setLoading(false);
      return;
    }

    // ── Step 4: Update Auth display name ─────────────────────
    await updateProfile(userCred.user, { displayName: `${fname} ${lname}` });

    // ── Step 5: Write pending record (NOT to admins) ─────────
    await setDoc(doc(db, "pendingAdmins", uid), {
      uid,
      firstName : fname,
      lastName  : lname,
      fullName  : `${fname} ${lname}`,
      username,
      email,
      position,
      status    : "pending",   // pending | approved | rejected
      active    : false,        // IT sets to true on approval
      role      : null,         // IT assigns the role
      createdAt : serverTimestamp(),
      updatedAt : serverTimestamp()
    });

    // ── Step 6: Sign out immediately ─────────────────────────
    await signOut(auth);

    // ── Step 7: Show confirmation screen ─────────────────────
    showPending(fname, lname, email);

  } catch (err) {
    // Detailed error shown in console; friendly message to user
    console.error("[admin-register] Unexpected error:", err.code, err.message, err);

    // If Auth account was created but Firestore failed, clean up
    if (userCred?.user) {
      try { await deleteUser(userCred.user); } catch (_) {}
    }

    // Surface a specific message if possible
    const friendlyMsg =
      AUTH_ERRORS[err.code] ||
      (err.code === "permission-denied"
        ? "Permission denied. Please refresh the page and try again."
        : `An error occurred (${err.code || "unknown"}). Please try again.`);

    setError(friendlyMsg);
  } finally {
    setLoading(false);
  }
};
