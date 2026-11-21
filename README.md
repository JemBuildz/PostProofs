# PostProofs

Clean client proof and approval links for social media calendars.

## Run Locally with npm

**Prerequisites:** Node.js (v20+) and npm (v10+)

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env` and fill in your **Stripe TEST mode** environment variables (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_SOLO`, `STRIPE_PRICE_ID_STUDIO`, `APP_URL`):
   `cp .env.example .env`
3. Start the app:
   `npm run dev`
4. Run verification checks:
   - `npm test`
   - `npm run lint`
   - `npm run build`

## Deploy to Netlify (GitHub CD + Custom Domain)

- Build configuration and SPA redirects live in [`netlify.toml`](netlify.toml).
- Backend Express routes (`/api/*`) run through [`netlify/functions/api.mts`](netlify/functions/api.mts).
- Configure these environment variables in Netlify (**Project configuration -> Environment variables**, scope **Functions**):
  - `APP_URL` (`https://your-custom-domain.com`)
  - `STRIPE_SECRET_KEY` (`sk_test_...`)
  - `STRIPE_WEBHOOK_SECRET` (`whsec_...` from Stripe Dashboard webhook `https://your-custom-domain.com/api/webhooks/stripe`)
  - `STRIPE_PRICE_ID_SOLO` (`price_...`)
  - `STRIPE_PRICE_ID_STUDIO` (`price_...`)
  - `FIREBASE_CLIENT_EMAIL` & `FIREBASE_PRIVATE_KEY` (Firebase Admin service account credentials for non-GCP hosting; kept under Netlify's ~4 KB combined function env cap)
- Add your `.netlify.app` subdomain and custom domain to **Firebase Console -> Authentication -> Settings -> Authorized domains**.