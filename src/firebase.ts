import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

if (!firebaseConfig || !firebaseConfig.apiKey) {
  throw new Error('Firebase configuration is missing or invalid. Please ensure firebase-applet-config.json is present and correctly configured.');
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
