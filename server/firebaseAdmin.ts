import fs from 'node:fs';
import path from 'node:path';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Auth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { Storage } from 'firebase-admin/storage';

export interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  authDomain?: string;
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export type VerifyIdTokenFn = (idToken: string) => Promise<VerifiedFirebaseUser>;

let cachedConfig: FirebaseAppletConfig | null = null;
let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;

export function getFirebaseAdminConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as FirebaseAppletConfig;
  cachedConfig = {
    projectId: (process.env.FIREBASE_PROJECT_ID || raw.projectId || '').trim(),
    firestoreDatabaseId: (
      process.env.FIREBASE_FIRESTORE_DATABASE_ID ||
      raw.firestoreDatabaseId ||
      ''
    ).trim() || undefined,
    storageBucket: (
      process.env.FIREBASE_STORAGE_BUCKET ||
      raw.storageBucket ||
      ''
    ).trim() || undefined,
    authDomain: raw.authDomain,
  };
  return cachedConfig;
}

export function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  const config = getFirebaseAdminConfig();
  if (!config.projectId) {
    throw new Error('Firebase projectId is missing in firebase-applet-config.json.');
  }

  // Uses Application Default Credentials (no service account key files).
  cachedApp = getApps().length
    ? getApp()
    : initializeApp({
        projectId: config.projectId,
        storageBucket: config.storageBucket,
      });
  return cachedApp;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminFirestore(): Firestore {
  if (cachedDb) return cachedDb;
  const config = getFirebaseAdminConfig();
  const app = getAdminApp();
  cachedDb = config.firestoreDatabaseId
    ? getFirestore(app, config.firestoreDatabaseId)
    : getFirestore(app);
  return cachedDb;
}

export function getAdminStorage(): Storage {
  return getStorage(getAdminApp());
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser> {
  const decoded = await getAdminAuth().verifyIdToken(idToken, false);
  const email = typeof decoded.email === 'string' ? decoded.email : '';
  const name =
    (typeof decoded.name === 'string' && decoded.name.trim()) ||
    email ||
    'Creator';

  return {
    uid: decoded.uid,
    email,
    name,
    emailVerified: Boolean(decoded.email_verified),
  };
}
