import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import type { App, Credential, ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Auth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { Storage } from 'firebase-admin/storage';
import firebaseAppletConfig from '../firebase-applet-config.json' with { type: 'json' };

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
export type DeleteAuthUserFn = (uid: string) => Promise<void>;

let cachedConfig: FirebaseAppletConfig | null = null;
let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;

function readEnv(name: string): string {
  const netlifyEnv = (globalThis as { Netlify?: { env?: { get?: (key: string) => string | undefined } } })
    .Netlify?.env;
  const value = netlifyEnv?.get?.(name) ?? process.env[name] ?? '';
  return value.trim();
}

function normalizePrivateKey(raw: string): string {
  const trimmed = raw.trim().replace(/^"(.*)"$/, '$1');
  if (trimmed.includes('BEGIN PRIVATE KEY') || trimmed.includes('BEGIN RSA PRIVATE KEY')) {
    return trimmed.replace(/\\n/g, '\n');
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (decoded.includes('BEGIN PRIVATE KEY') || decoded.includes('BEGIN RSA PRIVATE KEY')) {
      return decoded.replace(/\\n/g, '\n');
    }
  } catch {
    // Fall through and let firebase-admin validate if malformed
  }
  return trimmed.replace(/\\n/g, '\n');
}

function resolveServiceAccountCredential(projectId: string): Credential | undefined {
  const rawJson = readEnv('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (rawJson) {
    const jsonText = rawJson.startsWith('{')
      ? rawJson
      : Buffer.from(rawJson, 'base64').toString('utf8');
    const parsed = JSON.parse(jsonText) as ServiceAccount & { private_key?: string };
    if (typeof parsed.private_key === 'string') {
      parsed.private_key = normalizePrivateKey(parsed.private_key);
    }
    return cert(parsed);
  }

  const clientEmail = readEnv('FIREBASE_CLIENT_EMAIL');
  const rawPrivateKey = readEnv('FIREBASE_PRIVATE_KEY') || readEnv('FIREBASE_PRIVATE_KEY_BASE64');
  if (clientEmail && rawPrivateKey) {
    return cert({
      projectId,
      clientEmail,
      privateKey: normalizePrivateKey(rawPrivateKey),
    });
  }

  return undefined;
}

export function getFirebaseAdminConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;

  const raw = firebaseAppletConfig as FirebaseAppletConfig;
  cachedConfig = {
    projectId: readEnv('FIREBASE_PROJECT_ID') || raw.projectId?.trim() || '',
    firestoreDatabaseId:
      readEnv('FIREBASE_FIRESTORE_DATABASE_ID') || raw.firestoreDatabaseId?.trim() || undefined,
    storageBucket:
      readEnv('FIREBASE_STORAGE_BUCKET') || raw.storageBucket?.trim() || undefined,
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

  const credential = resolveServiceAccountCredential(config.projectId);
  // Uses explicit service-account env credentials when deployed outside GCP (e.g. Netlify),
  // falling back to Application Default Credentials on Google Cloud or local gcloud setups.
  cachedApp = getApps().length
    ? getApp()
    : initializeApp(
        credential
          ? {
              credential,
              projectId: config.projectId,
              storageBucket: config.storageBucket,
            }
          : {
              projectId: config.projectId,
              storageBucket: config.storageBucket,
            }
      );
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

export async function deleteFirebaseAuthUser(uid: string): Promise<void> {
  await getAdminAuth().deleteUser(uid);
}
