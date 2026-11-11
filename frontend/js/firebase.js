// js/firebase.js
// BarangayFlow — Firebase initialisation
// Storage: Cloudinary (no Firebase Storage SDK needed)

import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDBCjZRktFMz_SqNSZ_KuLAl_eCwgKME9c",
  authDomain:        "barangayflow.firebaseapp.com",
  projectId:         "barangayflow",
  storageBucket:     "barangayflow.firebasestorage.app",
  messagingSenderId: "212844211614",
  appId:             "1:212844211614:web:c15e372ebb71d3d2867a8f"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
// NOTE: No getStorage() export — document uploads now go to Cloudinary.
