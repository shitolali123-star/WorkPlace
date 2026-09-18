const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 3000);
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

app.use(cors());
app.use(express.json({ limit: '3mb' }));
app.use(express.static(__dirname));

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'workplace.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 profile_id TEXT UNIQUE,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 phone TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 account_type TEXT NOT NULL,
 document_type TEXT NOT NULL,
 document_number TEXT NOT NULL UNIQUE,
 identity_status TEXT NOT NULL DEFAULT 'Pending',
 email_verified INTEGER NOT NULL DEFAULT 1,
 phone_verified INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS otp_challenges (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT NOT NULL,
 phone TEXT NOT NULL,
 email_hash TEXT NOT NULL,
 phone_hash TEXT NOT NULL,
 email_verified INTEGER NOT NULL DEFAULT 0,
 phone_verified INTEGER NOT NULL DEFAULT 1,
 email_otp_hash TEXT,
 phone_otp_hash TEXT,
 email_expires_at INTEGER,
 phone_expires_at INTEGER,
 email_attempts INTEGER NOT NULL DEFAULT 0,
 phone_attempts INTEGER NOT NULL DEFAULT 0,
 email_last_sent INTEGER,
 phone_last_sent INTEGER,
 verification_token_hash TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_challenges(email);
CREATE TABLE IF NOT EXISTS pending_signups (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 challenge_id INTEGER NOT NULL UNIQUE,
 name TEXT NOT NULL,
 email TEXT NOT NULL,
 phone TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 account_type TEXT NOT NULL,
 country TEXT NOT NULL,
 dob TEXT NOT NULL,
 document_type TEXT NOT NULL,
 document_number TEXT NOT NULL,
 photo_data TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 email TEXT NOT NULL,
 otp_hash TEXT,
 expires_at INTEGER,
 attempts INTEGER NOT NULL DEFAULT 0,
 last_sent INTEGER,
 verified INTEGER NOT NULL DEFAULT 0,
 reset_token_hash TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);
CREATE TABLE IF NOT EXISTS payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 receiver_user_id INTEGER,
 receiver_profile_id TEXT,
 job_id TEXT,
 job_title TEXT NOT NULL,
 amount REAL NOT NULL,
 method TEXT NOT NULL,
 gateway TEXT,
 transaction_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'PENDING',
 proof_data TEXT,
 gateway_session TEXT,
 gateway_val_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 verified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE TABLE IF NOT EXISTS friendships (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 friend_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 requested_by INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_id);
CREATE TABLE IF NOT EXISTS messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender_id INTEGER NOT NULL,
 receiver_id INTEGER NOT NULL,
 body TEXT NOT NULL,
 message_type TEXT NOT NULL DEFAULT 'text',
 job_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 delivered_at TEXT,
 seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id, id);
CREATE TABLE IF NOT EXISTS user_blocks (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 blocker_id INTEGER NOT NULL,
 blocked_id INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS user_mutes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 muter_id INTEGER NOT NULL,
 muted_id INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(muter_id, muted_id)
);
CREATE TABLE IF NOT EXISTS jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 poster_id INTEGER,
 title TEXT NOT NULL,
 category TEXT NOT NULL,
 description TEXT NOT NULL,
 price REAL NOT NULL DEFAULT 0,
 location TEXT NOT NULL,
 deadline TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Posted',
 accepted_worker_id INTEGER,
 admin_hold INTEGER NOT NULL DEFAULT 0,
 admin_note TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 reporter_id INTEGER,
 target_user_id INTEGER,
 target_type TEXT NOT NULL DEFAULT 'user',
 reason TEXT NOT NULL,
 details TEXT,
 status TEXT NOT NULL DEFAULT 'Pending',
 admin_note TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS advertisements (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 advertiser_id INTEGER,
 package_name TEXT NOT NULL,
 price REAL NOT NULL DEFAULT 0,
 impressions INTEGER NOT NULL DEFAULT 0,
 duration_days INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'Pending',
 admin_hold INTEGER NOT NULL DEFAULT 0,
 admin_note TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS videos (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 creator_id INTEGER,
 title TEXT NOT NULL,
 media_type TEXT NOT NULL DEFAULT 'video',
 status TEXT NOT NULL DEFAULT 'Pending',
 admin_hold INTEGER NOT NULL DEFAULT 0,
 admin_note TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS coin_transactions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 amount INTEGER NOT NULL DEFAULT 0,
 type TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Completed',
 admin_hold INTEGER NOT NULL DEFAULT 0,
 admin_note TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS monetisation_applications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 creator_id INTEGER,
 status TEXT NOT NULL DEFAULT 'Pending',
 target TEXT,
 admin_note TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admin_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 admin_id TEXT NOT NULL DEFAULT 'MAIN-SUPER-ADMIN',
 action TEXT NOT NULL,
 target_type TEXT,
 target_id TEXT,
 details TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 type TEXT NOT NULL,
 title TEXT NOT NULL,
 message TEXT NOT NULL,
 link TEXT,
 related_id TEXT,
 read_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);
CREATE TABLE IF NOT EXISTS profile_reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 reviewer_id INTEGER NOT NULL,
 target_user_id INTEGER NOT NULL,
 job_id INTEGER NOT NULL,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT NOT NULL,
 proof_data TEXT,
 status TEXT NOT NULL DEFAULT 'Published',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(reviewer_id, target_user_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_profile_reviews_target ON profile_reviews(target_user_id, id);
CREATE TABLE IF NOT EXISTS admin_settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
);
`);

try { db.exec('ALTER TABLE users ADD COLUMN photo_data TEXT'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec("ALTER TABLE users ADD COLUMN country TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec("ALTER TABLE users ADD COLUMN dob TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }

try { db.exec('ALTER TABLE users ADD COLUMN profile_id TEXT'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec('ALTER TABLE payments ADD COLUMN receiver_user_id INTEGER'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec('ALTER TABLE payments ADD COLUMN receiver_profile_id TEXT'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec('ALTER TABLE payments ADD COLUMN payment_channel TEXT'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'Active'"); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec('ALTER TABLE users ADD COLUMN admin_hold_reason TEXT'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec('ALTER TABLE users ADD COLUMN admin_note TEXT'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec("ALTER TABLE users ADD COLUMN profession TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec("ALTER TABLE users ADD COLUMN sector TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec("ALTER TABLE users ADD COLUMN location TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec("ALTER TABLE users ADD COLUMN availability TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec("ALTER TABLE messages ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'Visible'"); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec('ALTER TABLE messages ADD COLUMN admin_note TEXT'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }

function generateProfileId() {
  let id;
  do { id = String(crypto.randomInt(10000000, 100000000)); }
  while (db.prepare('SELECT 1 FROM users WHERE profile_id=?').get(id));
  return id;
}

// Ensure every account has an 8-digit public numeric Work Place ID.
// If an older account has a 10-digit ID from an earlier build, migrate it once
// and keep any existing payment history linked to the new ID.
for (const u of db.prepare("SELECT id, profile_id FROM users").all()) {
  if (!/^\d{8}$/.test(String(u.profile_id || ''))) {
    const oldId = String(u.profile_id || '');
    const newId = generateProfileId();
    db.prepare('UPDATE users SET profile_id=? WHERE id=?').run(newId, u.id);
    if (oldId) db.prepare('UPDATE payments SET receiver_profile_id=? WHERE receiver_user_id=? OR receiver_profile_id=?').run(newId, u.id, oldId);
  }
}

const emailTransport = (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;
const brevoApiEnabled = Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM);

function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }
function normalizePhone(v) { return String(v || '').replace(/[^\d+]/g, ''); }
function normalizeDocument(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function validPhone(v) { return /^\+\d{7,15}$/.test(v); }
function validDob(v) { if(!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d=new Date(v+'T00:00:00Z'); if(Number.isNaN(d.getTime())) return false; const now=new Date(); const today=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())); if(d>today) return false; let age=today.getUTCFullYear()-d.getUTCFullYear(); const m=today.getUTCMonth()-d.getUTCMonth(); if(m<0 || (m===0 && today.getUTCDate()<d.getUTCDate())) age--; return age>=18; }
function otp() { return String(crypto.randomInt(100000, 1000000)); }
function sha(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function hashPassword(password) {
  const pepper = process.env.PASSWORD_PEPPER;
  if (!pepper) throw new Error('PASSWORD_PEPPER is not configured.');
  return crypto.scryptSync(password, pepper, 64).toString('hex');
}
function makeToken() { return crypto.randomBytes(32).toString('hex'); }
function authError(res, message, code=400) { return res.status(code).json({ ok:false, message }); }

async function sendEmailCode(email, code) {
  const subject = 'Work Place email verification code';
  const text = `Your Work Place email verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px"><h2>Work Place</h2><p>Your email verification code is:</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 0">${code}</div><p>This code expires in 10 minutes.</p><p>If you did not request this, you can ignore this email.</p></div>`;
  if (brevoApiEnabled) {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:'POST',
      headers:{accept:'application/json','api-key':process.env.BREVO_API_KEY,'content-type':'application/json'},
      body:JSON.stringify({sender:{name:'Work Place',email:String(process.env.MAIL_FROM).replace(/^.*<([^>]+)>.*$/,'$1').trim()},to:[{email}],subject,textContent:text,htmlContent:html})
    });
    if (!r.ok) { const body=await r.text(); throw new Error(`Brevo API email failed: ${r.status} ${body}`); }
    return;
  }
  if (!emailTransport) throw new Error('Email is not configured.');
  await emailTransport.sendMail({from:process.env.MAIL_FROM || process.env.SMTP_USER,to:email,subject,text,html});
}

function getChallengeById(id) { return db.prepare('SELECT * FROM otp_challenges WHERE id=?').get(id); }
function createOrReuseChallenge(email, phone) {
  const now = Date.now();
  let c = db.prepare('SELECT * FROM otp_challenges WHERE email=? ORDER BY id DESC LIMIT 1').get(email);
  if (!c) {
    const r = db.prepare(`INSERT INTO otp_challenges(email,phone,email_hash,phone_hash,phone_verified,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`).run(email, phone, sha(email), sha(phone), now, now);
    c = getChallengeById(r.lastInsertRowid);
  } else {
    db.prepare('UPDATE otp_challenges SET phone=?,phone_hash=?,phone_verified=1,updated_at=? WHERE id=?').run(phone, sha(phone), now, c.id);
    c = getChallengeById(c.id);
  }
  return c;
}

app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const phone = normalizePhone(req.body.phone);
    if (!validEmail(email)) return authError(res, 'Please enter a valid email address.');
    if (!validPhone(phone)) return authError(res, 'Please enter a valid phone number with country code.');
    if (!emailTransport && !brevoApiEnabled) return authError(res, 'Email service is not configured yet.');
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return authError(res, 'This email is already registered.');
    if (db.prepare('SELECT id FROM users WHERE phone=?').get(phone)) return authError(res, 'This phone number is already registered.');

    const c = createOrReuseChallenge(email, phone);
    const now = Date.now();
    if (c.email_verified) return res.json({ok:true, challengeId:c.id, message:'Email is already verified for this signup.'});
    if (c.email_last_sent && now - c.email_last_sent < RESEND_COOLDOWN_MS) {
      return authError(res, `Please wait ${Math.ceil((RESEND_COOLDOWN_MS-(now-c.email_last_sent))/1000)} seconds before requesting another code.`);
    }

    const code = otp();
    await sendEmailCode(email, code);
    db.prepare(`UPDATE otp_challenges SET email_otp_hash=?,email_expires_at=?,email_attempts=0,email_last_sent=?,updated_at=? WHERE id=?`)
      .run(sha(code), now+OTP_TTL_MS, now, now, c.id);

    res.json({ok:true, challengeId:c.id, sent:{email:true}, message:'Email verification code sent.'});
  } catch (e) {
    console.error(e);
    authError(res, e.message || 'Could not send verification email.', 500);
  }
});

app.post('/api/auth/start-signup', async (req,res) => {
  try {
    const name=String(req.body.name||'').trim();
    const email=normalizeEmail(req.body.email);
    const phone=normalizePhone(req.body.phone);
    const password=String(req.body.password||'');
    const accountType=String(req.body.type||'Customer');
    const country=String(req.body.country||'').trim();
    const dob=String(req.body.dob||'').trim();
    const documentType=String(req.body.documentType||'NID');
    const documentNumber=normalizeDocument(req.body.documentNumber);
    const photoData=String(req.body.photoData||'').trim();
    if(!name||!validEmail(email)||!validPhone(phone)||password.length<8||!country||!validDob(dob)||!documentNumber||!photoData) return authError(res,'Please complete all required fields. You must be 18 or older.');
    if(!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(photoData) || photoData.length>900000) return authError(res,'Please upload a JPG, PNG, or WebP profile photo smaller than about 650 KB.');
    if(!['Customer','Worker'].includes(accountType)) return authError(res,'Invalid account type.');
    if(db.prepare('SELECT id FROM users WHERE email=?').get(email)) return authError(res,'This email is already registered.');
    if(db.prepare('SELECT id FROM users WHERE phone=?').get(phone)) return authError(res,'This phone number is already registered.');
    if(db.prepare('SELECT id FROM users WHERE document_number=?').get(documentNumber)) return authError(res,'This identity document number is already linked to another account.');
    const pendingHash=hashPassword(password);
    const c=createOrReuseChallenge(email,phone);
    const now=Date.now();
    db.prepare(`INSERT INTO pending_signups(challenge_id,name,email,phone,password_hash,account_type,country,dob,document_type,document_number,photo_data,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(challenge_id) DO UPDATE SET name=excluded.name,email=excluded.email,phone=excluded.phone,password_hash=excluded.password_hash,account_type=excluded.account_type,country=excluded.country,dob=excluded.dob,document_type=excluded.document_type,document_number=excluded.document_number,photo_data=excluded.photo_data,created_at=excluded.created_at`)
      .run(c.id,name,email,phone,pendingHash,accountType,country,dob,documentType,documentNumber,photoData,now);
    if(!emailTransport && !brevoApiEnabled) return authError(res,'Email service is not configured yet.');
    if(c.email_last_sent && now-Number(c.email_last_sent)<RESEND_COOLDOWN_MS && !c.email_verified) {
      return res.json({ok:true,challengeId:c.id,message:'Verification code already sent. Please check your email.',cooldown:true});
    }
    const code=otp();
    await sendEmailCode(email,code);
    db.prepare(`UPDATE otp_challenges SET email_otp_hash=?,email_expires_at=?,email_attempts=0,email_last_sent=?,email_verified=0,verification_token_hash=NULL,updated_at=? WHERE id=?`)
      .run(sha(code),now+OTP_TTL_MS,now,now,c.id);
    res.json({ok:true,challengeId:c.id,email,expiresInSeconds:600,message:'Verification code sent.'});
  } catch(e) { console.error(e); authError(res,e.message||'Could not start signup.',500); }
});

app.post('/api/auth/resend-signup-otp', async (req,res) => {
  try {
    const id=Number(req.body.challengeId); if(!id) return authError(res,'Invalid verification session.');
    const c=getChallengeById(id); const p=db.prepare('SELECT * FROM pending_signups WHERE challenge_id=?').get(id);
    if(!c||!p) return authError(res,'Verification session not found. Please start Sign Up again.',404);
    if(!emailTransport && !brevoApiEnabled) return authError(res,'Email service is not configured yet.');
    const now=Date.now();
    if(c.email_last_sent && now-Number(c.email_last_sent)<RESEND_COOLDOWN_MS) return authError(res,`Please wait ${Math.ceil((RESEND_COOLDOWN_MS-(now-c.email_last_sent))/1000)} seconds before requesting another code.`);
    const code=otp(); await sendEmailCode(p.email,code);
    db.prepare('UPDATE otp_challenges SET email_otp_hash=?,email_expires_at=?,email_attempts=0,email_last_sent=?,email_verified=0,verification_token_hash=NULL,updated_at=? WHERE id=?').run(sha(code),now+OTP_TTL_MS,now,now,id);
    res.json({ok:true,message:'A new verification code has been sent.'});
  } catch(e){ console.error(e); authError(res,e.message||'Could not resend verification code.',500); }
});

app.post('/api/auth/verify-otp', (req,res) => {
  const id = Number(req.body.challengeId);
  const code = String(req.body.code || '').trim();
  if (!id || !/^\d{6}$/.test(code)) return authError(res,'Enter the 6-digit verification code.');
  const c = getChallengeById(id);
  if (!c) return authError(res,'Verification session not found. Please request a new code.',404);
  const now = Date.now();
  if (c.email_verified) return res.json({ok:true,verified:true,emailVerified:true,phoneVerified:true});
  if (!c.email_otp_hash || now > Number(c.email_expires_at || 0)) return authError(res,'This code has expired. Please request a new code.');
  if (Number(c.email_attempts) >= MAX_ATTEMPTS) return authError(res,'Too many incorrect attempts. Please request a new code.');
  if (sha(code) !== c.email_otp_hash) {
    db.prepare('UPDATE otp_challenges SET email_attempts=email_attempts+1,updated_at=? WHERE id=?').run(now,id);
    return authError(res,'Incorrect verification code.');
  }
  db.prepare('UPDATE otp_challenges SET email_verified=1,email_otp_hash=NULL,verification_token_hash=?,updated_at=? WHERE id=?')
    .run(sha(makeToken()), now, id);
  const updated = getChallengeById(id);
  const token = makeToken();
  db.prepare('UPDATE otp_challenges SET verification_token_hash=?,updated_at=? WHERE id=?').run(sha(token),now,id);
  res.json({ok:true,verified:true,emailVerified:true,phoneVerified:true,verificationToken:token});
});

app.post('/api/auth/complete-signup', (req,res) => {
  const challengeId=Number(req.body.challengeId);
  const token=String(req.body.verificationToken||'');
  if(!challengeId||!token) return authError(res,'Email verification is required before creating the account.');
  const c=db.prepare('SELECT * FROM otp_challenges WHERE id=?').get(challengeId);
  const p=db.prepare('SELECT * FROM pending_signups WHERE challenge_id=?').get(challengeId);
  if(!c||!p||!c.email_verified||!c.verification_token_hash||sha(token)!==c.verification_token_hash) return authError(res,'Email verification is required before creating the account.');
  if(db.prepare('SELECT id FROM users WHERE email=?').get(p.email)) return authError(res,'This email is already registered.');
  if(db.prepare('SELECT id FROM users WHERE phone=?').get(p.phone)) return authError(res,'This phone number is already registered.');
  if(db.prepare('SELECT id FROM users WHERE document_number=?').get(p.document_number)) return authError(res,'This identity document number is already linked to another account.');
  const profileId=generateProfileId();
  const r=db.prepare(`INSERT INTO users(profile_id,name,email,phone,password_hash,account_type,document_type,document_number,photo_data,email_verified,phone_verified,country,dob)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(profileId,p.name,p.email,p.phone,p.password_hash,p.account_type,p.document_type,p.document_number,p.photo_data,1,1,p.country,p.dob);
  db.prepare('DELETE FROM pending_signups WHERE challenge_id=?').run(challengeId);
  db.prepare('DELETE FROM otp_challenges WHERE id=?').run(challengeId);
  res.json({ok:true,user:{id:r.lastInsertRowid,profileId,name:p.name,email:p.email,phone:p.phone,type:p.account_type,country:p.country,dob:p.dob,photoData:p.photo_data,verification:{email:'Verified',phone:'Not required',identity:'Pending'}}});
});

app.post('/api/auth/forgot-password', async (req,res) => {
  try {
    const email=normalizeEmail(req.body.email);
    if(!validEmail(email)) return authError(res,'Enter a valid email address.');
    const u=db.prepare('SELECT id,email FROM users WHERE email=?').get(email);
    if(!u) return authError(res,'No account found with this email address.',404);
    if(!emailTransport && !brevoApiEnabled) return authError(res,'Email service is not configured yet.');
    const now=Date.now();
    let r=db.prepare('SELECT * FROM password_resets WHERE email=? ORDER BY id DESC LIMIT 1').get(email);
    if(!r){ const x=db.prepare('INSERT INTO password_resets(user_id,email,created_at,updated_at) VALUES(?,?,?,?)').run(u.id,email,now,now); r=db.prepare('SELECT * FROM password_resets WHERE id=?').get(x.lastInsertRowid); }
    if(r.last_sent && now-Number(r.last_sent)<RESEND_COOLDOWN_MS) return authError(res,`Please wait ${Math.ceil((RESEND_COOLDOWN_MS-(now-r.last_sent))/1000)} seconds before requesting another code.`);
    const code=otp();
    await sendEmailCode(email,code);
    db.prepare('UPDATE password_resets SET otp_hash=?,expires_at=?,attempts=0,last_sent=?,verified=0,reset_token_hash=NULL,updated_at=? WHERE id=?').run(sha(code),now+OTP_TTL_MS,now,now,r.id);
    res.json({ok:true,resetId:r.id,message:'Password reset code sent.'});
  } catch(e){ console.error(e); authError(res,e.message||'Could not send reset email.',500); }
});

app.post('/api/auth/reset-password', (req,res) => {
  const resetId=Number(req.body.resetId); const code=String(req.body.code||'').trim(); const newPassword=String(req.body.newPassword||'');
  if(!resetId||!/^[0-9]{6}$/.test(code)||newPassword.length<8) return authError(res,'Enter the 6-digit code and a password of at least 8 characters.');
  const r=db.prepare('SELECT * FROM password_resets WHERE id=?').get(resetId); if(!r) return authError(res,'Reset session not found.',404);
  const now=Date.now(); if(!r.otp_hash||now>Number(r.expires_at||0)) return authError(res,'This code has expired. Please request a new code.');
  if(Number(r.attempts)>=MAX_ATTEMPTS) return authError(res,'Too many incorrect attempts. Please request a new code.');
  if(sha(code)!==r.otp_hash){ db.prepare('UPDATE password_resets SET attempts=attempts+1,updated_at=? WHERE id=?').run(now,resetId); return authError(res,'Incorrect verification code.'); }
  const token=makeToken(); db.prepare('UPDATE password_resets SET verified=1,otp_hash=NULL,reset_token_hash=?,updated_at=? WHERE id=?').run(sha(token),now,resetId);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(newPassword),r.user_id);
  db.prepare('DELETE FROM password_resets WHERE id=?').run(resetId);
  res.json({ok:true,message:'Password reset successfully.'});
});

app.post('/api/auth/login', (req,res) => {
  const identity=String(req.body.identity||'').trim();
  const password=String(req.body.password||'');
  const email=normalizeEmail(identity);
  const phone=normalizePhone(identity);
  const u=db.prepare('SELECT * FROM users WHERE email=? OR phone=?').get(email,phone);
  if(!u) return authError(res,'No account found with this email or phone number.',404);
  if(u.password_hash!==hashPassword(password)) return authError(res,'Incorrect password.',401);
  res.json({ok:true,user:{id:u.id,profileId:u.profile_id,name:u.name,email:u.email,phone:u.phone,type:u.account_type,photoData:u.photo_data||'',verification:{email:u.email_verified?'Verified':'Pending',phone:'Not required',identity:u.identity_status}}});
});

function publicUserById(id){
  return db.prepare('SELECT id,profile_id,name,email,phone,account_type,country,dob,photo_data FROM users WHERE id=?').get(Number(id));
}
function notifyUser(userId,type,title,message,link='',relatedId=''){
  if(!Number(userId)||!title||!message)return;
  db.prepare('INSERT INTO notifications(user_id,type,title,message,link,related_id) VALUES(?,?,?,?,?,?)').run(Number(userId),String(type||'system'),String(title).slice(0,200),String(message).slice(0,1000),link?String(link):null,relatedId!==''?String(relatedId):null);
}

function relationBetween(a,b){
  return db.prepare('SELECT * FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?) ORDER BY id DESC LIMIT 1').get(a,b,b,a);
}
function isBlocked(a,b){ return !!db.prepare('SELECT 1 FROM user_blocks WHERE blocker_id=? AND blocked_id=?').get(a,b); }
function friendshipStatusFor(a,b){
  const r=relationBetween(a,b); if(!r) return 'none';
  if(r.status==='accepted') return 'friends';
  if(r.status==='rejected') return 'rejected';
  return Number(r.requested_by)===Number(a) ? 'outgoing' : 'incoming';
}
function messagingUser(u, me){
  const rel=relationBetween(me,u.id);
  return {id:u.id,profileId:u.profile_id,name:u.name,type:u.account_type,photoData:u.photo_data||'',country:u.country||'',status:friendshipStatusFor(me,u.id),blockedByMe:isBlocked(me,u.id),blockedMe:isBlocked(u.id,me),muted:!!db.prepare('SELECT 1 FROM user_mutes WHERE muter_id=? AND muted_id=?').get(me,u.id),relationId:rel?.id||null};
}

app.get('/api/messaging/search', (req,res)=>{
  const me=Number(req.query.me);
  const q=String(req.query.profileId||'').trim();
  if(!me || !/^\d{8}$/.test(q)) return authError(res,'Enter a valid 8-digit Work Place ID.');
  const u=db.prepare('SELECT id,profile_id,name,account_type,photo_data,country FROM users WHERE profile_id=?').get(q);
  if(!u) return authError(res,'No user found with this Work Place ID.',404);
  if(u.id===me) return authError(res,'You cannot add yourself.');
  res.json({ok:true,user:messagingUser(u,me)});
});

app.get('/api/messaging/requests', (req,res)=>{
  const me=Number(req.query.me); if(!me) return authError(res,'Login required.',401);
  const rows=db.prepare(`SELECT f.*,u.id uid,u.profile_id,u.name,u.account_type,u.photo_data,u.country
    FROM friendships f JOIN users u ON u.id=f.requested_by
    WHERE f.friend_id=? AND f.status='pending' ORDER BY f.id DESC`).all(me);
  res.json({ok:true,requests:rows.map(r=>messagingUser({...r,id:r.uid,profile_id:r.profile_id,name:r.name,account_type:r.account_type,photo_data:r.photo_data,country:r.country},me))});
});

app.get('/api/messaging/friends', (req,res)=>{
  const me=Number(req.query.me); if(!me) return authError(res,'Login required.',401);
  const rows=db.prepare(`SELECT CASE WHEN f.user_id=? THEN f.friend_id ELSE f.user_id END friend_id
    FROM friendships f WHERE (f.user_id=? OR f.friend_id=?) AND f.status='accepted' ORDER BY f.updated_at DESC`).all(me,me,me);
  const friends=rows.map(r=>publicUserById(r.friend_id)).filter(Boolean).map(u=>messagingUser(u,me));
  res.json({ok:true,friends});
});

app.post('/api/messaging/friend-request',(req,res)=>{
  const me=Number(req.body.me), target=Number(req.body.target);
  if(!me||!target||me===target) return authError(res,'Invalid user.');
  if(!publicUserById(me)||!publicUserById(target)) return authError(res,'User not found.',404);
  if(isBlocked(me,target)||isBlocked(target,me)) return authError(res,'Friend request cannot be sent because blocking is active.');
  const rel=relationBetween(me,target);
  if(rel?.status==='accepted') return authError(res,'You are already friends.');
  if(rel?.status==='pending') return authError(res,Number(rel.requested_by)===me?'Friend request already sent.':'This user already sent you a request.');
  if(rel) db.prepare('DELETE FROM friendships WHERE id=?').run(rel.id);
  const r=db.prepare('INSERT INTO friendships(user_id,friend_id,status,requested_by) VALUES(?,?,\'pending\',?)').run(me,target,me);
  const sender=publicUserById(me);
  notifyUser(target,'friend_request','New friend request',`${sender?.name||'A user'} sent you a friend request.`, 'messaging.html', r.lastInsertRowid);
  res.json({ok:true,requestId:r.lastInsertRowid,message:'Friend request sent.'});
});

app.post('/api/messaging/request-action',(req,res)=>{
  const me=Number(req.body.me), requestId=Number(req.body.requestId), action=String(req.body.action||'');
  const f=db.prepare('SELECT * FROM friendships WHERE id=?').get(requestId);
  if(!f || Number(f.friend_id)!==me || f.status!=='pending') return authError(res,'Friend request not found.',404);
  if(action==='accept') { db.prepare("UPDATE friendships SET status='accepted',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(requestId); const sender=publicUserById(f.requested_by); notifyUser(f.requested_by,'friend_accept','Friend request accepted',`${publicUserById(me)?.name||'A user'} accepted your friend request.`,'messaging.html',requestId); return res.json({ok:true,message:'Friend request accepted.'}); }
  if(action==='reject') { db.prepare("UPDATE friendships SET status='rejected',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(requestId); return res.json({ok:true,message:'Friend request rejected.'}); }
  return authError(res,'Invalid request action.');
});

app.post('/api/messaging/friend-action',(req,res)=>{
  const me=Number(req.body.me), target=Number(req.body.target), action=String(req.body.action||'');
  if(!me||!target) return authError(res,'Invalid user.');
  const f=relationBetween(me,target);
  if(action==='remove') { if(f) db.prepare('DELETE FROM friendships WHERE id=?').run(f.id); return res.json({ok:true,message:'Friend removed.'}); }
  if(action==='block') { db.prepare('INSERT OR IGNORE INTO user_blocks(blocker_id,blocked_id) VALUES(?,?)').run(me,target); if(f) db.prepare('DELETE FROM friendships WHERE id=?').run(f.id); return res.json({ok:true,message:'User blocked.'}); }
  if(action==='unblock') { db.prepare('DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?').run(me,target); return res.json({ok:true,message:'User unblocked.'}); }
  if(action==='mute') { db.prepare('INSERT OR IGNORE INTO user_mutes(muter_id,muted_id) VALUES(?,?)').run(me,target); return res.json({ok:true,message:'User muted.'}); }
  if(action==='unmute') { db.prepare('DELETE FROM user_mutes WHERE muter_id=? AND muted_id=?').run(me,target); return res.json({ok:true,message:'User unmuted.'}); }
  return authError(res,'Invalid friend action.');
});

app.get('/api/messaging/messages', (req,res)=>{
  const me=Number(req.query.me), target=Number(req.query.target); if(!me||!target) return authError(res,'Login required.',401);
  if(!publicUserById(target)) return authError(res,'User not found.',404);
  const rel=relationBetween(me,target);
  const allowed=rel?.status==='accepted';
  const rows=db.prepare(`SELECT id,sender_id,receiver_id,body,message_type,job_id,created_at,delivered_at,seen_at FROM messages
    WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY id ASC LIMIT 200`).all(me,target,target,me);
  db.prepare('UPDATE messages SET delivered_at=COALESCE(delivered_at,CURRENT_TIMESTAMP) WHERE sender_id=? AND receiver_id=?').run(target,me);
  res.json({ok:true,allowed,messages:rows});
});

app.post('/api/messaging/send',(req,res)=>{
  const me=Number(req.body.me), target=Number(req.body.target), body=String(req.body.body||'').trim();
  if(!me||!target||!body) return authError(res,'Message cannot be empty.');
  if(body.length>2000) return authError(res,'Message is too long.');
  if(!publicUserById(me)||!publicUserById(target)) return authError(res,'User not found.',404);
  if(isBlocked(me,target)||isBlocked(target,me)) return authError(res,'Messaging is blocked for this user.');
  const rel=relationBetween(me,target); const friends=rel?.status==='accepted';
  if(!friends){
    const count=db.prepare("SELECT COUNT(*) c FROM messages WHERE sender_id=? AND receiver_id=? AND message_type='text'").get(me,target).c;
    if(Number(count)>=3) return authError(res,'Message request limit reached. Accept the friend/message request for more messages.');
  }
  const r=db.prepare('INSERT INTO messages(sender_id,receiver_id,body,message_type,job_id) VALUES(?,?,?,\'text\',?)').run(me,target,body,req.body.jobId?String(req.body.jobId):null);
  const msg=db.prepare('SELECT * FROM messages WHERE id=?').get(r.lastInsertRowid);
  res.json({ok:true,message:msg,friendStatus:friends?'friends':friendshipStatusFor(me,target)});
});

app.get('/api/profile/:id', (req,res) => {
  const id=Number(req.params.id);
  const u=db.prepare('SELECT id,profile_id,name,email,phone,account_type,country,dob,document_type,identity_status,photo_data FROM users WHERE id=?').get(id);
  if(!u) return authError(res,'Profile not found.',404);
  res.json({ok:true,user:{id:u.id,profileId:u.profile_id,name:u.name,email:u.email,phone:u.phone,type:u.account_type,country:u.country||'',dob:u.dob||'',documentType:u.document_type,identityStatus:u.identity_status,photoData:u.photo_data||''}});
});

app.post('/api/profile/photo', (req,res) => {
  const id=Number(req.body.userId);
  const photoData=String(req.body.photoData||'').trim();
  if(!id) return authError(res,'Invalid user.');
  if(!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(photoData) || photoData.length>900000) return authError(res,'Please upload a JPG, PNG, or WebP photo smaller than about 650 KB.');
  const result=db.prepare('UPDATE users SET photo_data=? WHERE id=?').run(photoData,id);
  if(!result.changes) return authError(res,'Profile not found.',404);
  res.json({ok:true,photoData});
});

function getPaymentByTransaction(transactionId){
  return db.prepare('SELECT * FROM payments WHERE transaction_id=?').get(transactionId);
}
function getUserByProfileId(profileId){
  return db.prepare('SELECT id,profile_id,name,email,phone,account_type,photo_data FROM users WHERE profile_id=?').get(String(profileId||'').trim());
}

app.get('/api/payment/config',(req,res)=>{
  res.json({
    ok:true,
    bank:{
      configured:Boolean(process.env.BANK_ACCOUNT_NUMBER),
      name:process.env.BANK_NAME||'Not configured',
      accountName:process.env.BANK_ACCOUNT_NAME||'Work Place',
      accountNumber:process.env.BANK_ACCOUNT_NUMBER||'Not configured',
      branch:process.env.BANK_BRANCH||'Not configured',
      routing:process.env.BANK_ROUTING||'Not configured'
    },
    sslcommerz:{configured:Boolean(process.env.SSLCZ_STORE_ID&&process.env.SSLCZ_STORE_PASSWORD),sandbox:String(process.env.SSLCZ_SANDBOX||'true')==='true'}
  });
});

app.get('/api/profile/by-profile-id/:profileId',(req,res)=>{
  const u=getUserByProfileId(req.params.profileId);
  if(!u) return authError(res,'No Work Place profile found with this Profile ID.',404);
  res.json({ok:true,user:{profileId:u.profile_id,name:u.name,type:u.account_type,photoData:u.photo_data||''}});
});

app.post('/api/payments/bank-transfer',(req,res)=>{
  try{
    const userId=Number(req.body.userId)||null;
    const receiverProfileId=String(req.body.receiverProfileId||'').trim();
    const receiver=getUserByProfileId(receiverProfileId);
    const amount=Number(req.body.amount);
    const transactionId=String(req.body.transactionId||'').trim();
    const proofData=String(req.body.proofData||'').trim();
    if(!userId||!receiver) return authError(res,'Please enter a valid Receiver Profile ID.');
    if(!Number.isFinite(amount)||amount<=0) return authError(res,'Please enter a valid amount.');
    if(receiver.id===userId) return authError(res,'You cannot make a payment to your own profile.');
    if(!transactionId) return authError(res,'Bank transaction ID is required.');
    if(!process.env.BANK_ACCOUNT_NUMBER) return authError(res,'Bank Transfer is not available yet. Work Place bank details are not configured.');
    if(proofData && (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(proofData) || proofData.length>1200000)) return authError(res,'Payment proof must be a JPG, PNG, or WebP image under about 900 KB.');
    if(getPaymentByTransaction(transactionId)) return authError(res,'This transaction ID has already been submitted.');
    const r=db.prepare(`INSERT INTO payments(user_id,receiver_user_id,receiver_profile_id,job_id,job_title,amount,method,gateway,transaction_id,status,proof_data) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(userId,receiver.id,receiver.profile_id,null,'Payment to '+receiver.name,amount,'BANK_TRANSFER','MANUAL_BANK',transactionId,'PENDING',proofData||null);
    res.json({ok:true,payment:{id:r.lastInsertRowid,status:'PENDING',transactionId,receiverProfileId:receiver.profile_id,receiverName:receiver.name,amount,method:'BANK_TRANSFER',message:'Bank transfer submitted for verification.'}});
  }catch(e){
    console.error(e);authError(res,'Could not submit bank payment.',500);
  }
});

app.get('/api/payments/:userId',(req,res)=>{
  const userId=Number(req.params.userId);
  if(!userId) return authError(res,'Invalid user.');
  const rows=db.prepare('SELECT id,receiver_profile_id,job_title,amount,method,gateway,transaction_id,status,payment_channel,created_at,verified_at FROM payments WHERE user_id=? ORDER BY id DESC').all(userId);
  res.json({ok:true,payments:rows});
});

function paymentBaseUrl(req){
  return String(process.env.BASE_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
}

app.post('/api/payments/ssl/initiate',async(req,res)=>{
  try{
    if(!process.env.SSLCZ_STORE_ID||!process.env.SSLCZ_STORE_PASSWORD) return authError(res,'SSLCOMMERZ is not configured yet. Add SSLCZ_STORE_ID and SSLCZ_STORE_PASSWORD to Render Environment.');
    const userId=Number(req.body.userId)||null;
    const receiverProfileId=String(req.body.receiverProfileId||'').trim();
    const receiver=getUserByProfileId(receiverProfileId);
    const amount=Number(req.body.amount);
    const paymentChannel=String(req.body.paymentChannel||'E_PAYMENT').trim();
    const selectedChannel=String(req.body.selectedChannel||'').trim();
    const customerName=String(req.body.customerName||'Work Place Customer').trim();
    const customerEmail=normalizeEmail(req.body.customerEmail);
    const customerPhone=normalizePhone(req.body.customerPhone);
    if(!userId||!receiver) return authError(res,'Please enter a valid Receiver Profile ID.');
    if(receiver.id===userId) return authError(res,'You cannot make a payment to your own profile.');
    if(!Number.isFinite(amount)||amount<10||amount>500000||!validEmail(customerEmail)||!validPhone(customerPhone)) return authError(res,'Please provide a valid Profile ID, amount (৳10–৳500,000), email and phone.');
    const transactionId=`WP_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const base=paymentBaseUrl(req);
    db.prepare(`INSERT INTO payments(user_id,receiver_user_id,receiver_profile_id,job_id,job_title,amount,method,gateway,transaction_id,status,payment_channel) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(userId,receiver.id,receiver.profile_id,null,'Payment to '+receiver.name,amount,'E_PAYMENT','SSLCOMMERZ',transactionId,'PENDING',paymentChannel+(selectedChannel?':'+selectedChannel:''));
    const endpoint=String(process.env.SSLCZ_SANDBOX||'true')==='true' ? 'https://sandbox-gw.sslcommerz.com/gwprocess/v4/api.php' : 'https://securepay.sslcommerz.com/gwprocess/v4/api.php';
    const body=new URLSearchParams({
      store_id:process.env.SSLCZ_STORE_ID,
      store_passwd:process.env.SSLCZ_STORE_PASSWORD,
      total_amount:amount.toFixed(2),currency:'BDT',tran_id:transactionId,
      product_category:'Work Place Payment',success_url:`${base}/api/payments/ssl/success`,fail_url:`${base}/api/payments/ssl/fail`,cancel_url:`${base}/api/payments/ssl/cancel`,ipn_url:`${base}/api/payments/ssl/ipn`,
      cus_name:customerName,cus_email:customerEmail,cus_add1:'Bangladesh',cus_city:'Bangladesh',cus_postcode:'1000',cus_country:'Bangladesh',cus_phone:customerPhone,
      shipping_method:'NO',product_name:'Payment to '+receiver.name,product_profile:'general'
    });
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    const data=await response.json();
    if(data.status!=='SUCCESS'||!data.GatewayPageURL){db.prepare('UPDATE payments SET status=? WHERE transaction_id=?').run('FAILED',transactionId);return authError(res,data.failedreason||'Could not start SSLCOMMERZ payment.',502);}
    db.prepare('UPDATE payments SET gateway_session=? WHERE transaction_id=?').run(data.sessionkey||null,transactionId);
    res.json({ok:true,redirectUrl:data.GatewayPageURL,transactionId,receiver:{profileId:receiver.profile_id,name:receiver.name}});
  }catch(e){console.error(e);authError(res,e.message||'E-payment initiation failed.',500)}
});

async function validateSslPayment(valId){
  const sandbox=String(process.env.SSLCZ_SANDBOX||'true')==='true';
  const endpoint=sandbox?'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php':'https://securepay.sslcommerz.com/validator/api/validationserverAPI.php';
  const u=new URL(endpoint);u.searchParams.set('val_id',valId);u.searchParams.set('store_id',process.env.SSLCZ_STORE_ID);u.searchParams.set('store_passwd',process.env.SSLCZ_STORE_PASSWORD);u.searchParams.set('format','json');
  const r=await fetch(u);return r.json();
}

async function handleSslCallback(req,res,type){
  try{
    const data=Object.assign({},req.body||{},req.query||{});
    const tranId=String(data.tran_id||'');
    const payment=getPaymentByTransaction(tranId);
    if(!payment) return res.status(404).send('Payment transaction not found.');
    if(type==='fail'){db.prepare('UPDATE payments SET status=? WHERE transaction_id=?').run('FAILED',tranId);return res.redirect('/payments.html?status=failed&transaction='+encodeURIComponent(tranId));}
    if(type==='cancel'){db.prepare('UPDATE payments SET status=? WHERE transaction_id=?').run('CANCELLED',tranId);return res.redirect('/payments.html?status=cancelled&transaction='+encodeURIComponent(tranId));}
    const valId=String(data.val_id||'');
    if(!valId) return res.redirect('/payments.html?status=pending&transaction='+encodeURIComponent(tranId));
    const validated=await validateSslPayment(valId);
    const validStatus=['VALID','VALIDATED'].includes(String(validated.status||''));
    const amountOk=Number(validated.amount)===Number(payment.amount);
    const currencyOk=String(validated.currency||'')==='BDT';
    if(validStatus&&amountOk&&currencyOk){db.prepare('UPDATE payments SET status=?,gateway_val_id=?,verified_at=CURRENT_TIMESTAMP WHERE transaction_id=?').run('PAID',valId,tranId);return res.redirect('/payments.html?status=success&transaction='+encodeURIComponent(tranId));}
    db.prepare('UPDATE payments SET status=?,gateway_val_id=? WHERE transaction_id=?').run('FAILED',valId,tranId);
    return res.redirect('/payments.html?status=failed&transaction='+encodeURIComponent(tranId));
  }catch(e){console.error(e);return res.redirect('/payments.html?status=pending');}
}
app.post('/api/payments/ssl/success',(req,res)=>handleSslCallback(req,res,'success'));
app.get('/api/payments/ssl/success',(req,res)=>handleSslCallback(req,res,'success'));
app.post('/api/payments/ssl/fail',(req,res)=>handleSslCallback(req,res,'fail'));
app.get('/api/payments/ssl/fail',(req,res)=>handleSslCallback(req,res,'fail'));
app.post('/api/payments/ssl/cancel',(req,res)=>handleSslCallback(req,res,'cancel'));
app.get('/api/payments/ssl/cancel',(req,res)=>handleSslCallback(req,res,'cancel'));
app.post('/api/payments/ssl/ipn',async(req,res)=>{try{const data=req.body||{};const payment=getPaymentByTransaction(String(data.tran_id||''));if(!payment)return res.status(404).send('NOT_FOUND');if(data.status==='VALID'&&data.val_id){const validated=await validateSslPayment(data.val_id);if(['VALID','VALIDATED'].includes(String(validated.status||''))&&Number(validated.amount)===Number(payment.amount)&&String(validated.currency||'')==='BDT'){db.prepare('UPDATE payments SET status=?,gateway_val_id=?,verified_at=CURRENT_TIMESTAMP WHERE transaction_id=?').run('PAID',data.val_id,payment.transaction_id);}}res.send('OK')}catch(e){console.error(e);res.status(500).send('ERROR')}});

function adminLog(action,targetType,targetId,details=''){
  db.prepare('INSERT INTO admin_logs(admin_id,action,target_type,target_id,details) VALUES(?,?,?,?,?)').run('MAIN-SUPER-ADMIN',action,targetType,String(targetId||''),details);
}
function adminList(req,res,kind){
  const q=String(req.query.q||'').trim();
  const like='%'+q+'%';
  if(kind==='users'||kind==='workers'){
    const worker=kind==='workers';
    const rows=db.prepare(`SELECT id,profile_id,name,email,phone,account_type,identity_status,account_status,admin_hold_reason,admin_note,profession,sector,location,availability,created_at FROM users WHERE (?='' OR profile_id LIKE ? OR name LIKE ? OR email LIKE ? OR phone LIKE ?) AND (?=0 OR LOWER(account_type)='worker') ORDER BY id DESC LIMIT 200`).all(q,like,like,like,like,worker?1:0);
    return res.json({ok:true,rows});
  }
  if(kind==='payments'){
    const rows=db.prepare(`SELECT p.id,p.user_id,p.receiver_user_id,p.receiver_profile_id,p.amount,p.method,p.gateway,p.transaction_id,p.status,p.payment_channel,p.created_at,s.name sender_name,r.name receiver_name FROM payments p LEFT JOIN users s ON s.id=p.user_id LEFT JOIN users r ON r.id=p.receiver_user_id WHERE (?='' OR CAST(p.id AS TEXT)=? OR p.transaction_id LIKE ? OR s.profile_id LIKE ? OR r.profile_id LIKE ? OR p.receiver_profile_id LIKE ?) ORDER BY p.id DESC LIMIT 200`).all(q,q,like,like,like,like);
    return res.json({ok:true,rows});
  }
  if(kind==='messages'){
    const rows=db.prepare(`SELECT m.id,m.body,m.message_type,m.created_at,m.moderation_status,m.admin_note,s.profile_id sender_profile_id,s.name sender_name,r.profile_id receiver_profile_id,r.name receiver_name FROM messages m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.receiver_id WHERE (?='' OR CAST(m.id AS TEXT)=? OR s.profile_id LIKE ? OR r.profile_id LIKE ?) ORDER BY m.id DESC LIMIT 300`).all(q,q,like,like);
    return res.json({ok:true,rows});
  }
  if(kind==='jobs'){
    const rows=db.prepare(`SELECT j.*,u.profile_id poster_profile_id,u.name poster_name,w.profile_id worker_profile_id,w.name worker_name FROM jobs j LEFT JOIN users u ON u.id=j.poster_id LEFT JOIN users w ON w.id=j.accepted_worker_id WHERE (?='' OR CAST(j.id AS TEXT)=? OR j.title LIKE ? OR u.profile_id LIKE ? OR w.profile_id LIKE ?) ORDER BY j.id DESC LIMIT 200`).all(q,q,like,like,like);
    return res.json({ok:true,rows});
  }
  if(kind==='reports'){
    const rows=db.prepare(`SELECT x.*,a.profile_id reporter_profile_id,a.name reporter_name,b.profile_id target_profile_id,b.name target_name FROM reports x LEFT JOIN users a ON a.id=x.reporter_id LEFT JOIN users b ON b.id=x.target_user_id WHERE (?='' OR CAST(x.id AS TEXT)=? OR a.profile_id LIKE ? OR b.profile_id LIKE ?) ORDER BY x.id DESC LIMIT 200`).all(q,q,like,like);
    return res.json({ok:true,rows});
  }
  if(kind==='ads'){
    const rows=db.prepare(`SELECT a.*,u.profile_id advertiser_profile_id,u.name advertiser_name FROM advertisements a LEFT JOIN users u ON u.id=a.advertiser_id WHERE (?='' OR CAST(a.id AS TEXT)=? OR u.profile_id LIKE ?) ORDER BY a.id DESC LIMIT 200`).all(q,q,like);
    return res.json({ok:true,rows});
  }
  if(kind==='videos'){
    const rows=db.prepare(`SELECT v.*,u.profile_id creator_profile_id,u.name creator_name FROM videos v LEFT JOIN users u ON u.id=v.creator_id WHERE (?='' OR CAST(v.id AS TEXT)=? OR v.title LIKE ? OR u.profile_id LIKE ?) ORDER BY v.id DESC LIMIT 200`).all(q,q,like,like);
    return res.json({ok:true,rows});
  }
  if(kind==='coins'){
    const rows=db.prepare(`SELECT c.*,u.profile_id,u.name FROM coin_transactions c LEFT JOIN users u ON u.id=c.user_id WHERE (?='' OR CAST(c.id AS TEXT)=? OR u.profile_id LIKE ?) ORDER BY c.id DESC LIMIT 200`).all(q,q,like);
    return res.json({ok:true,rows});
  }
  if(kind==='monetisation'){
    const rows=db.prepare(`SELECT m.*,u.profile_id creator_profile_id,u.name creator_name FROM monetisation_applications m LEFT JOIN users u ON u.id=m.creator_id WHERE (?='' OR CAST(m.id AS TEXT)=? OR u.profile_id LIKE ?) ORDER BY m.id DESC LIMIT 200`).all(q,q,like);
    return res.json({ok:true,rows});
  }
  return res.status(404).json({ok:false,message:'Unknown admin section.'});
}

app.get('/api/admin/summary',(req,res)=>{
  const n=t=>Number(db.prepare(t).get().c||0);
  const income=Number(db.prepare("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status='PAID'").get().v||0);
  const pending=Number(db.prepare("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE status IN ('PENDING','PAID','HELD')").get().v||0);
  res.json({ok:true,summary:{users:n('SELECT COUNT(*) c FROM users'),workers:n("SELECT COUNT(*) c FROM users WHERE LOWER(account_type)='worker'"),jobs:n("SELECT COUNT(*) c FROM jobs WHERE status NOT IN ('Completed','Cancelled','Expired')"),reports:n("SELECT COUNT(*) c FROM reports WHERE status='Pending'"),messages:n('SELECT COUNT(*) c FROM messages'),income,pending}});
});
for(const k of ['users','workers','payments','messages','jobs','reports','ads','videos','coins','monetisation']) app.get('/api/admin/'+k,(req,res)=>adminList(req,res,k));

app.patch('/api/admin/users/:id',(req,res)=>{
  const id=Number(req.params.id); const u=db.prepare('SELECT id,profile_id FROM users WHERE id=?').get(id); if(!u)return authError(res,'User not found.',404);
  const allowed=['Active','Hold','Blocked','Suspended']; const status=String(req.body.status||'').trim();
  if(status && !allowed.includes(status)) return authError(res,'Invalid account status.');
  const holdReason=String(req.body.holdReason||'').trim().slice(0,500); const note=String(req.body.note||'').trim().slice(0,1000);
  const name=req.body.name===undefined?null:String(req.body.name||'').trim().slice(0,120);
  const phone=req.body.phone===undefined?null:normalizePhone(req.body.phone);
  const profession=req.body.profession===undefined?null:String(req.body.profession||'').trim().slice(0,120);
  const sector=req.body.sector===undefined?null:String(req.body.sector||'').trim().slice(0,120);
  const location=req.body.location===undefined?null:String(req.body.location||'').trim().slice(0,200);
  const availability=req.body.availability===undefined?null:String(req.body.availability||'').trim().slice(0,120);
  try{
    if(phone!==null && !validPhone(phone)) return authError(res,'Invalid phone number.');
    if(name!==null && !name) return authError(res,'Name cannot be empty.');
    if(name!==null)db.prepare('UPDATE users SET name=? WHERE id=?').run(name,id);
    if(phone!==null){const dup=db.prepare('SELECT id FROM users WHERE phone=? AND id<>?').get(phone,id);if(dup)return authError(res,'That phone number is already used by another account.');db.prepare('UPDATE users SET phone=? WHERE id=?').run(phone,id);}
    if(profession!==null)db.prepare('UPDATE users SET profession=? WHERE id=?').run(profession,id);
    if(sector!==null)db.prepare('UPDATE users SET sector=? WHERE id=?').run(sector,id);
    if(location!==null)db.prepare('UPDATE users SET location=? WHERE id=?').run(location,id);
    if(availability!==null)db.prepare('UPDATE users SET availability=? WHERE id=?').run(availability,id);
    if(status) db.prepare('UPDATE users SET account_status=?,admin_hold_reason=?,admin_note=? WHERE id=?').run(status,status==='Hold'?holdReason:null,note,id);
    else if(note) db.prepare('UPDATE users SET admin_note=? WHERE id=?').run(note,id);
    adminLog('UPDATE_USER','user',u.profile_id,JSON.stringify({status,name,phone,profession,sector,location,availability})); res.json({ok:true,message:'User controls updated.'});
  }catch(e){console.error(e);return authError(res,e.message||'Could not update user.',500)}
});

app.patch('/api/admin/messages/:id',(req,res)=>{
  const id=Number(req.params.id); if(!db.prepare('SELECT id FROM messages WHERE id=?').get(id))return authError(res,'Message not found.',404);
  const status=String(req.body.status||'Visible'); if(!['Visible','Hidden','Removed','Under Review'].includes(status))return authError(res,'Invalid moderation status.');
  const note=String(req.body.note||'').trim().slice(0,1000); db.prepare('UPDATE messages SET moderation_status=?,admin_note=? WHERE id=?').run(status,note,id); adminLog('MODERATE_MESSAGE','message',id,status); res.json({ok:true,message:'Message moderation updated.'});
});

app.patch('/api/admin/payments/:id',(req,res)=>{
  const id=Number(req.params.id); const p=db.prepare('SELECT id,transaction_id FROM payments WHERE id=?').get(id); if(!p)return authError(res,'Payment not found.',404);
  const status=String(req.body.status||'').trim(); if(!['PENDING','HELD','PAID','FAILED','CANCELLED','REFUND_REQUESTED','REFUNDED'].includes(status))return authError(res,'Invalid payment status.');
  db.prepare('UPDATE payments SET status=?,verified_at=CASE WHEN ? IN (\'PAID\',\'REFUNDED\') THEN CURRENT_TIMESTAMP ELSE verified_at END WHERE id=?').run(status,status,id); adminLog('UPDATE_PAYMENT','payment',p.transaction_id,status); res.json({ok:true,message:'Payment status updated.'});
});

app.patch('/api/admin/jobs/:id',(req,res)=>{
  const id=Number(req.params.id); const j=db.prepare('SELECT id FROM jobs WHERE id=?').get(id); if(!j)return authError(res,'Job not found.',404);
  const price=req.body.price===undefined?null:Number(req.body.price); const status=req.body.status===undefined?null:String(req.body.status); const hold=req.body.hold===undefined?null:(req.body.hold?1:0); const note=String(req.body.note||'').trim().slice(0,1000);
  if(price!==null && (!Number.isFinite(price)||price<0))return authError(res,'Invalid price.');
  if(price!==null)db.prepare('UPDATE jobs SET price=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(price,id);
  if(status)db.prepare('UPDATE jobs SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,id);
  if(hold!==null)db.prepare('UPDATE jobs SET admin_hold=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hold,note,id); else if(note)db.prepare('UPDATE jobs SET admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(note,id);
  adminLog('UPDATE_JOB','job',id,JSON.stringify({price,status,hold})); res.json({ok:true,message:'Job controls updated.'});
});

app.patch('/api/admin/records/:kind/:id',(req,res)=>{
  const kind=String(req.params.kind),id=Number(req.params.id); const map={reports:'reports',ads:'advertisements',videos:'videos',coins:'coin_transactions',monetisation:'monetisation_applications'}; const table=map[kind]; if(!table)return authError(res,'Unsupported record type.');
  if(!db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id))return authError(res,'Record not found.',404);
  const status=req.body.status===undefined?null:String(req.body.status); const note=String(req.body.note||'').trim().slice(0,1000);
  if(status)db.prepare(`UPDATE ${table} SET status=?,admin_note=?${table!=='coin_transactions'?',updated_at=CURRENT_TIMESTAMP':''} WHERE id=?`).run(status,note,id); else if(note)db.prepare(`UPDATE ${table} SET admin_note=? WHERE id=?`).run(note,id);
  adminLog('UPDATE_RECORD',kind,id,JSON.stringify({status,note:!!note})); res.json({ok:true,message:'Record updated.'});
});

app.post('/api/admin/advertisement-packages',(req,res)=>{
  const values={basic:Number(req.body.basic),standard:Number(req.body.standard),premium:Number(req.body.premium)}; if(Object.values(values).some(v=>!Number.isFinite(v)||v<0))return authError(res,'Invalid package price.');
  for(const [k,v] of Object.entries(values))db.prepare('INSERT INTO admin_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('ad_price_'+k,String(v));
  adminLog('UPDATE_AD_PRICES','settings','advertisement',JSON.stringify(values)); res.json({ok:true,message:'Advertisement package prices saved.',values});
});
app.get('/api/admin/advertisement-packages',(req,res)=>{const out={basic:499,standard:1499,premium:4999};for(const k of Object.keys(out)){const r=db.prepare('SELECT value FROM admin_settings WHERE key=?').get('ad_price_'+k);if(r)out[k]=Number(r.value)}res.json({ok:true,values:out})});
app.get('/api/admin/coin-daily-rewards',(req,res)=>{let values=Array.from({length:30},(_,i)=>i===0?5:0);const r=db.prepare("SELECT value FROM admin_settings WHERE key='coin_daily_rewards'").get();if(r){try{const a=JSON.parse(r.value);if(Array.isArray(a)&&a.length===30)values=a.map(v=>Math.max(0,Number(v)||0))}catch{}}res.json({ok:true,values})});
app.post('/api/admin/coin-daily-rewards',(req,res)=>{const a=req.body.values;if(!Array.isArray(a)||a.length!==30||a.some(v=>!Number.isFinite(Number(v))||Number(v)<0))return authError(res,'Exactly 30 valid daily rewards are required.');const values=a.map(v=>Math.floor(Number(v)||0));db.prepare("INSERT INTO admin_settings(key,value) VALUES('coin_daily_rewards',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(values));adminLog('UPDATE_DAILY_COIN_REWARDS','settings','coin_daily_rewards',JSON.stringify(values));res.json({ok:true,message:'30-day daily sign-in rewards saved.',values})});


app.get('/api/admin/logs',(req,res)=>{const q='%'+String(req.query.q||'').trim()+'%';const rows=db.prepare('SELECT * FROM admin_logs WHERE (?=\'%%\' OR action LIKE ? OR target_id LIKE ? OR details LIKE ?) ORDER BY id DESC LIMIT 300').all(q,q,q,q);res.json({ok:true,rows})});

app.post('/api/jobs',(req,res)=>{
  const posterId=Number(req.body.posterId)||null; const title=String(req.body.title||'').trim(); const category=String(req.body.category||'').trim(); const description=String(req.body.description||'').trim(); const price=Number(req.body.price); const location=String(req.body.location||'').trim(); const deadline=String(req.body.deadline||'').trim();
  if(!posterId||!title||!category||!description||!Number.isFinite(price)||price<=0||!location||!deadline)return authError(res,'Please fill all required job fields.');
  const r=db.prepare('INSERT INTO jobs(poster_id,title,category,description,price,location,deadline,status) VALUES(?,?,?,?,?,?,?,\'Posted\')').run(posterId,title,category,description,price,location,deadline);
  const poster=publicUserById(posterId);
  const friends=db.prepare("SELECT CASE WHEN user_id=? THEN friend_id ELSE user_id END friend_id FROM friendships WHERE (user_id=? OR friend_id=?) AND status='accepted'").all(posterId,posterId,posterId);
  for(const f of friends){ notifyUser(f.friend_id,'friend_job','Friend posted a new job',`${poster?.name||'Your friend'} posted “${title}”.`,'find-jobs.html',r.lastInsertRowid); }
  res.json({ok:true,jobId:r.lastInsertRowid});
});
app.get('/api/jobs',(req,res)=>{const rows=db.prepare('SELECT j.*,u.profile_id poster_profile_id,u.name poster_name,u.photo_data poster_photo,w.profile_id worker_profile_id,w.name worker_name FROM jobs j LEFT JOIN users u ON u.id=j.poster_id LEFT JOIN users w ON w.id=j.accepted_worker_id WHERE j.admin_hold=0 ORDER BY j.id DESC').all();res.json({ok:true,jobs:rows});});

// Job acceptance / client confirmation flow. The current prototype passes actor IDs
// from the logged-in browser; production should replace this with authenticated sessions.
app.post('/api/jobs/:id/accept',(req,res)=>{
  const id=Number(req.params.id), workerId=Number(req.body.workerId);
  const j=db.prepare('SELECT * FROM jobs WHERE id=? AND admin_hold=0').get(id);
  const w=db.prepare('SELECT id,profile_id,name,account_type FROM users WHERE id=?').get(workerId);
  if(!j||!w)return authError(res,'Job or worker not found.',404);
  if(String(j.status)!=='Posted')return authError(res,'This job is no longer available.');
  if(String(w.account_type||'').toLowerCase()!=='worker')return authError(res,'Only worker accounts can accept jobs.');
  db.prepare("UPDATE jobs SET status='Pending Client Confirmation',accepted_worker_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(workerId,id);
  notifyUser(j.poster_id,'job_accept','Worker accepted your job',`${w.name} accepted “${j.title}”. Please review the worker and confirm or reject.`,'current-situation.html',id);
  adminLog('WORKER_ACCEPT_JOB','job',id,JSON.stringify({workerId,workerProfileId:w.profile_id}));
  res.json({ok:true,message:'Job accepted. Waiting for client confirmation.',job:{id,status:'Pending Client Confirmation',workerId:w.id,workerProfileId:w.profile_id,workerName:w.name}});
});

app.post('/api/jobs/:id/confirm',(req,res)=>{
  const id=Number(req.params.id), clientId=Number(req.body.clientId);
  const j=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  if(!j)return authError(res,'Job not found.',404);
  if(Number(j.poster_id)!==clientId)return authError(res,'Only the job client can confirm this worker.',403);
  if(String(j.status)!=='Pending Client Confirmation' || !j.accepted_worker_id)return authError(res,'This job is not waiting for confirmation.');
  db.prepare("UPDATE jobs SET status='Confirmed',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  adminLog('CLIENT_CONFIRM_WORKER','job',id,JSON.stringify({clientId,workerId:j.accepted_worker_id}));
  res.json({ok:true,message:'Worker confirmed. Job is now confirmed.',jobId:id,status:'Confirmed',workerId:j.accepted_worker_id});
});

app.post('/api/jobs/:id/reject-worker',(req,res)=>{
  const id=Number(req.params.id), clientId=Number(req.body.clientId);
  const j=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  if(!j)return authError(res,'Job not found.',404);
  if(Number(j.poster_id)!==clientId)return authError(res,'Only the job client can reject this worker.',403);
  if(String(j.status)!=='Pending Client Confirmation')return authError(res,'This job is not waiting for confirmation.');
  db.prepare("UPDATE jobs SET status='Posted',accepted_worker_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  adminLog('CLIENT_REJECT_WORKER','job',id,JSON.stringify({clientId}));
  res.json({ok:true,message:'Worker rejected. Job is available again.',jobId:id,status:'Posted'});
});

app.get('/api/public-profile/:profileId',(req,res)=>{
  const profileId=String(req.params.profileId||'').trim();
  const u=db.prepare(`SELECT id,profile_id,name,email,phone,account_type,country,dob,photo_data,profession,sector,location,availability,identity_status,account_status FROM users WHERE profile_id=?`).get(profileId);
  if(!u)return authError(res,'Profile not found.',404);
  const posted=db.prepare(`SELECT id,title,category,description,price,location,deadline,status,accepted_worker_id,created_at,updated_at FROM jobs WHERE poster_id=? ORDER BY id DESC`).all(u.id);
  const counts={posted:posted.length,completed:posted.filter(x=>x.status==='Completed').length,inProgress:posted.filter(x=>['Confirmed','In Progress'].includes(x.status)).length,pending:posted.filter(x=>['Posted','Pending Client Confirmation','Accepted'].includes(x.status)).length,cancelled:posted.filter(x=>['Cancelled','Expired','Uncompleted'].includes(x.status)).length};
  const available=posted.filter(x=>x.status==='Posted' && Number(x.accepted_worker_id||0)===0);
  res.json({ok:true,user:{id:u.id,profileId:u.profile_id,name:u.name,type:u.account_type,country:u.country||'',dob:u.dob||'',photoData:u.photo_data||'',profession:u.profession||'',sector:u.sector||'',location:u.location||'',availability:u.availability||'',accountStatus:u.account_status||'Active'},stats:counts,postedJobs:available});
});

app.get('/api/notifications',(req,res)=>{
  const userId=Number(req.query.userId); if(!userId)return authError(res,'Login required.',401);
  const rows=db.prepare('SELECT id,type,title,message,link,related_id,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(userId);
  res.json({ok:true,notifications:rows,unread:rows.filter(x=>!x.read_at).length});
});
app.post('/api/notifications/:id/read',(req,res)=>{
  const id=Number(req.params.id),userId=Number(req.body.userId); if(!id||!userId)return authError(res,'Invalid notification.');
  db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=? AND user_id=?').run(id,userId); res.json({ok:true});
});
app.post('/api/notifications/read-all',(req,res)=>{
  const userId=Number(req.body.userId); if(!userId)return authError(res,'Login required.',401);
  db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE user_id=?').run(userId); res.json({ok:true});
});

app.get('/api/public-profile/:profileId/reviews',(req,res)=>{
  const profileId=String(req.params.profileId||'').trim();
  const u=db.prepare('SELECT id,profile_id FROM users WHERE profile_id=?').get(profileId); if(!u)return authError(res,'Profile not found.',404);
  const rows=db.prepare(`SELECT r.id,r.rating,r.comment,r.proof_data,r.status,r.created_at,u.profile_id reviewer_profile_id,u.name reviewer_name,u.photo_data reviewer_photo
    FROM profile_reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.target_user_id=? AND r.status='Published' ORDER BY r.id DESC LIMIT 100`).all(u.id);
  const summary=db.prepare(`SELECT COUNT(*) c,COALESCE(AVG(rating),0) avg FROM profile_reviews WHERE target_user_id=? AND status='Published'`).get(u.id);
  res.json({ok:true,reviews:rows,summary:{count:Number(summary.c||0),average:Number(summary.avg||0)}});
});
app.post('/api/public-profile/:profileId/reviews',(req,res)=>{
  const target=db.prepare('SELECT id,profile_id,name FROM users WHERE profile_id=?').get(String(req.params.profileId||'').trim());
  const reviewerId=Number(req.body.reviewerId),jobId=Number(req.body.jobId),rating=Number(req.body.rating),comment=String(req.body.comment||'').trim(),proof=String(req.body.proofData||'').trim();
  if(!target||!reviewerId||!jobId||rating<1||rating>5||!comment)return authError(res,'Please complete the review fields.',400);
  if(reviewerId===target.id)return authError(res,'You cannot review your own profile.');
  const job=db.prepare('SELECT id,poster_id,accepted_worker_id,status FROM jobs WHERE id=?').get(jobId);
  if(!job||job.status!=='Completed')return authError(res,'A review is available only after a completed job.',400);
  const valid=(Number(job.poster_id)===reviewerId&&Number(job.accepted_worker_id)===target.id)||(Number(job.accepted_worker_id)===reviewerId&&Number(job.poster_id)===target.id);
  if(!valid)return authError(res,'This completed job is not connected to this profile.',403);
  if(proof && !/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(proof))return authError(res,'Proof must be a JPG, PNG, or WebP image.');
  if(proof.length>900000)return authError(res,'Proof image is too large.');
  try{const r=db.prepare('INSERT INTO profile_reviews(reviewer_id,target_user_id,job_id,rating,comment,proof_data) VALUES(?,?,?,?,?,?)').run(reviewerId,target.id,jobId,rating,comment,proof||null); res.json({ok:true,reviewId:r.lastInsertRowid,message:'Review published.'});}
  catch(e){if(String(e.message).includes('UNIQUE'))return authError(res,'You already reviewed this completed job.'); throw e;}
});

app.get('/api/health',(req,res)=>res.json({ok:true,service:'Work Place email auth'}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`Work Place running at http://localhost:${PORT}`));
