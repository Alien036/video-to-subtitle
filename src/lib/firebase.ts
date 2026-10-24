import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBjPiZE2oVtpdTUZcpPR7iNozv45dkdiLM",
  authDomain: "video-to-subtitle-d2684.firebaseapp.com",
  projectId: "video-to-subtitle-d2684",
  storageBucket: "video-to-subtitle-d2684.firebasestorage.app",
  messagingSenderId: "15256782301",
  appId: "1:15256782301:web:9ae8a734d34c105d032234",
  measurementId: "G-EK73MWNKKX",
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);

export { app, auth, googleProvider, db };
