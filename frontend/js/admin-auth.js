import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword,
  setPersistence,
  browserSessionPersistence,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, query, where, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ======================
// UI HELPERS
// ======================
function setError(msg) {
  const el = document.getElementById("loginError");
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

function setLoading(show) {
  const btn = document.getElementById("loginBtn");
  if (!btn) return;
  btn.disabled = show;
  btn.textContent = show ? "Signing in..." : "Login";
}

// ======================
// LOGIN
// ======================
window.login = async function(e) {
  e.preventDefault();
  setError("");

  const username = document.getElementById("login-username")?.value.trim();
  const password = document.getElementById("login-password")?.value;
  const ndaChecked = document.getElementById("ndaCheck")?.checked;

  if (!username || !password) {
    setError("Please enter your username and password.");
    return;
  }

  // NDA must be acknowledged
  if (!ndaChecked) {
    const ndaErr = document.getElementById("ndaError");
    if (ndaErr) { ndaErr.style.display = "block"; ndaErr.scrollIntoView({ behavior: "smooth", block: "center" }); }
    return;
  }

  setLoading(true);

  try {
    let email = username;

    // Resolve username → email from admins collection
    if (!username.includes("@")) {
      const q = query(collection(db, "admins"), where("username", "==", username));
      const snapshot = await getDocs(q);
      if (snapshot.empty) { setError("Username not found."); setLoading(false); return; }
      email = snapshot.docs[0].data().email;
    }

    // Always use session persistence — no persistent login for security
    await setPersistence(auth, browserSessionPersistence);

    const cred = await signInWithEmailAndPassword(auth, email, password);
    const user = cred.user;

    // ── RBAC GATE: Check pendingAdmins first ────────────────────────────────
    // If the user registered but IT has NOT yet approved them, block login.
    const pendingSnap = await getDoc(doc(db, "pendingAdmins", user.uid));
    if (pendingSnap.exists()) {
      const pData = pendingSnap.data();
      if (pData.status === "pending" || !pData.role) {
        setError("Your registration is pending IT approval. You will be notified once a role has been assigned.");
        await signOut(auth);
        setLoading(false);
        return;
      }
      if (pData.status === "rejected") {
        setError("Your registration request was rejected. Please contact IT Personnel for assistance.");
        await signOut(auth);
        setLoading(false);
        return;
      }
    }
    // ── END RBAC GATE ────────────────────────────────────────────────────────

    // Resolve role
    let role = null;
    let data = null;

    const adminSnap = await getDoc(doc(db, "admins", user.uid));
    if (adminSnap.exists()) {
      data = adminSnap.data();
      role = data.role;
    } else {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (userSnap.exists()) { data = userSnap.data(); role = data.role; }
    }

    if (!role) {
      setError("Account has no assigned role. Contact IT.");
      await signOut(auth);
      setLoading(false);
      return;
    }

    if (data?.active === false) {
      setError("This account has been disabled. Contact your administrator.");
      await signOut(auth);
      setLoading(false);
      return;
    }

    // Save session
    localStorage.setItem("adminUsername", username);
    localStorage.setItem("role", role);
    localStorage.setItem("uid", user.uid);

    // Redirect by role
    const routes = {
      admin: "/barangay-administrator.html",
      it:    "/it.html",
      staff: "/admin.html"
    };

    if (routes[role]) {
      window.location.href = routes[role];
    } else {
      setError("Unknown role. Contact IT.");
      await signOut(auth);
    }

  } catch (error) {
    const errMap = {
      "auth/user-not-found":  "No account found with this email.",
      "auth/wrong-password":  "Incorrect password. Please try again.",
      "auth/invalid-email":   "Invalid email address.",
      "auth/too-many-requests": "Too many attempts. Please wait before trying again.",
      "auth/invalid-credential": "Invalid credentials. Please check your username and password."
    };
    setError(errMap[error.code] || "Login failed. Please try again.");
  } finally {
    setLoading(false);
  }
};
