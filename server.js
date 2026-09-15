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

const db = new Database(path.join(__dirname, 'workplace.db'));
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
`);

try { db.exec('ALTER TABLE users ADD COLUMN photo_data TEXT'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec("ALTER TABLE users ADD COLUMN country TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec("ALTER TABLE users ADD COLUMN dob TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }

try { db.exec('ALTER TABLE users ADD COLUMN profile_id TEXT'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec('ALTER TABLE payments ADD COLUMN receiver_user_id INTEGER'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec('ALTER TABLE payments ADD COLUMN receiver_profile_id TEXT'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }
try { db.exec('ALTER TABLE payments ADD COLUMN payment_channel TEXT'); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; }

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

app.get('/api/health',(req,res)=>res.json({ok:true,service:'Work Place email auth'}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log(`Work Place running at http://localhost:${PORT}`));
