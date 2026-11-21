import type { Config, Context } from '@netlify/functions';
import type { Express } from 'express';
import { createApp } from '../../server/app.ts';
import { handleExpressWebRequest } from '../../server/netlifyBridge.ts';

let cachedExpressApp: Express | null = null;

function syncNetlifyEnvToProcess(): void {
  const keys = [
    'APP_URL',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_ID_SOLO',
    'STRIPE_PRICE_ID_STUDIO',
    'BILLING_STRICT_GATE',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_FIRESTORE_DATABASE_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_PRIVATE_KEY_BASE64',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
  ];
  for (const key of keys) {
    if (!process.env[key]) {
      const val = Netlify.env.get(key);
      if (val) {
        process.env[key] = val;
      }
    }
  }
}

function getExpressApp(): Express {
  if (cachedExpressApp) return cachedExpressApp;
  syncNetlifyEnvToProcess();
  cachedExpressApp = createApp().app;
  return cachedExpressApp;
}

export default async (req: Request, context: Context): Promise<Response> => {
  return handleExpressWebRequest(getExpressApp(), req, {
    ip: context.ip,
  });
};

export const config: Config = {
  path: ['/api', '/api/*'],
};
