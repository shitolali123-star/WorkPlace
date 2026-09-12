WORK PLACE - EMAIL OTP VERSION

This version uses REAL email OTP only. Phone/SMS OTP is not required.

1) Install Node.js 22 LTS or newer compatible LTS.
2) Open this folder in VS Code.
3) Run:
   npm install
4) Copy .env.example to .env.
5) Configure a real SMTP provider. Brevo is recommended for this project.
   Brevo free plan currently includes up to 300 email sends/day; limits and branding apply.
6) Example Brevo SMTP settings:
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your Brevo SMTP login email
   SMTP_PASS=your Brevo SMTP key
   MAIL_FROM=Work Place <your verified sender email>
7) Set a long random PASSWORD_PEPPER.
8) Start:
   npm start
9) Open:
   http://localhost:3000/login.html

SIGN UP FLOW
- Full name
- Email address
- Phone number (stored for account contact; NO SMS OTP)
- Password
- Account type
- One identity document number per account
- Email OTP verification

The OTP is generated on the server, stored only as a SHA-256 hash, expires after 10 minutes,
and allows at most 5 incorrect attempts. Resend cooldown is 60 seconds.

IMPORTANT
- Never put SMTP keys, passwords, or other secrets in chat or source control.
- Do not use a normal Gmail password as SMTP_PASS. If using Gmail, use an App Password.
- Brevo SMTP requires an SMTP key, not a Brevo API key.
- For production, add proper login sessions/cookies, rate limiting, HTTPS, and a production database/security review.


PROFILE PHOTO UPDATE
- Every new account must upload a profile photo during Sign Up.
- Existing accounts can add/change their photo from profile.html.
- Photos are resized in the browser before being sent to the server and stored with the user profile.
- For a production deployment, use authenticated sessions and private/object storage rather than trusting a browser-supplied user ID.


PAYMENTS
--------
1. Bank transfer works without a gateway account. Put your bank details in .env using BANK_* variables. Customers submit a transaction ID and optional proof image; the payment is stored as PENDING for admin verification.
2. E-payment is prepared for SSLCOMMERZ V4. Add SSLCZ_STORE_ID, SSLCZ_STORE_PASSWORD, SSLCZ_SANDBOX=true/false and BASE_URL in .env. For sandbox testing, use a public HTTPS BASE_URL when testing callbacks/IPN.
3. Never put SSLCOMMERZ store password in frontend code.
4. Current jobs are still a localStorage prototype; payment records are stored in SQLite. For production, jobs, users, payments, authentication sessions and admin verification should all be moved to authenticated server-side flows and a durable production database.


RENDER FREE DEPLOYMENT
- Upload this project to GitHub.
- Render -> New -> Web Service -> connect GitHub.
- Build Command: npm install
- Start Command: npm start
- Plan: Free
- Add environment variables in Render.
- For online email OTP, use BREVO_API_KEY (HTTPS API).
- BASE_URL should be the final public Render URL.
IMPORTANT: this prototype uses SQLite/local files. Render Free has ephemeral storage, so database and uploaded profile photos can be lost after restart/redeploy. Use persistent storage/database before production.
