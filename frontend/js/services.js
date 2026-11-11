import { auth, db } from "./firebase.js";

import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  deleteDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ======================
// AUTH
// ======================
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  loadServices();
});

// ======================
// LOAD SERVICES
// ======================
function loadServices() {
  onSnapshot(collection(db, "services"), (snapshot) => {
    const table = document.getElementById("serviceTable");
    table.innerHTML = "";

    if (snapshot.empty) {
      table.innerHTML = "<p style='padding:20px;'>No services found.</p>";
      return;
    }

    snapshot.forEach((docSnap) => {
      const s = docSnap.data();

      table.innerHTML += `
        <div class="row">
          <span>${s.name}</span>
          <span>${s.code}</span>
          <span>${s.processingDays || 0} days</span>

          <span class="status ${s.active ? "ready" : "rejected"}">
            <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\" viewBox=\"0 0 8 8\" style=\"vertical-align:middle;margin-right:4px;\"><circle cx=\"4\" cy=\"4\" r=\"4\" fill=\"currentColor\"/></svg>${s.active ? "Active" : "Disabled"}
          </span>

          <span>
            <button class="action-btn" onclick="toggleService('${docSnap.id}', ${s.active})">
              ${s.active ? "Disable" : "Enable"}
            </button>
          </span>

          <span>
            <button class="action-btn" onclick="deleteService('${docSnap.id}')">
              Delete
            </button>
          </span>

          <!-- Fill remaining columns to match grid -->
          <span></span>
          <span></span>
        </div>
      `;
    });
  });
}

// ======================
// ADD SERVICE
// ======================
window.addService = async () => {
  const name = document.getElementById("serviceName").value.trim();
  const code = document.getElementById("serviceCode").value.trim();
  const days = document.getElementById("processingDays").value;
  const reqs = document.getElementById("requirements").value;

  if (!name || !code) {
    alert("Please fill required fields");
    return;
  }

  try {
    await addDoc(collection(db, "services"), {
      name,
      code,
      processingDays: Number(days) || 0,
      requirements: reqs
        ? reqs.split(",").map(r => r.trim())
        : [],
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    alert("Service added successfully");

    // RESET FORM
    document.getElementById("serviceName").value = "";
    document.getElementById("serviceCode").value = "";
    document.getElementById("processingDays").value = "";
    document.getElementById("requirements").value = "";

  } catch (err) {
    alert("Failed to add service");
  }
};

// ======================
// TOGGLE SERVICE
// ======================
window.toggleService = async (id, currentState) => {
  try {
    await updateDoc(doc(db, "services", id), {
      active: !currentState,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    alert("Failed to update service");
  }
};

// ======================
// DELETE SERVICE
// ======================
window.deleteService = async (id) => {
  if (!confirm("Delete this service?")) return;

  try {
    await deleteDoc(doc(db, "services", id));
    alert("Deleted successfully");
  } catch (err) {
    alert("Delete failed");
  }
};

// ======================
// LOGOUT
// ======================
window.logout = () => {
  // services.js logout — delegate to page-level confirmation if available
  const modal = document.getElementById("logoutModal") ||
                document.getElementById("staffLogoutModal") ||
                document.getElementById("adminLogoutModal");
  if (modal) {
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }
};