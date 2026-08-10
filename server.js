/**
 * FindAJob.qa — Backend Server
 * Express.js + Supabase
 *
 * Required environment variables:
 *   SUPABASE_URL       — Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase secret/service-role key (Render only)
 *   SUPABASE_KEY       — Optional fallback key
 *   ADMIN_PASSWORD     — Password to access admin endpoints
 *   PORT               — Port to listen on (default: 3000)
 *
 * Run:
 *   npm install
 *   node server.js
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Supabase client ────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!SUPABASE_URL || !SUPABASE_KEY || !ADMIN_PASSWORD) {
  throw new Error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY), and ADMIN_PASSWORD');
}
// Chat payloads are encrypted in the browser before they reach this server.
// Use the managed session secret when available; otherwise use an ephemeral
// process key so an unconfigured local copy never pretends to provide durable
// encryption.
const CHAT_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

// File upload (memory storage — upload to Supabase Storage)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Helpers ─────────────────────────────────────────────────────────────────
function generateTrackingNumber() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[bytes[i] % chars.length];
  return `FJQ-${new Date().getFullYear()}-${code}`;
}

function adminAuth(req, res, next) {
  const session = req.headers['x-admin-session'] || req.headers['x-admin-token'];
  if (session && adminFromToken(String(session))) {
    req.admin = { authenticated: true };
    return next();
  }
  const pw = req.headers['x-admin-password'] || req.query.adminPw;
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  req.admin = { authenticated: true };
  next();
}

function cleanEmail(value) {
  return value ? String(value).toLowerCase().trim() : '';
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPin(pin, stored) {
  if (!pin || !stored || !String(stored).includes(':')) return false;
  const [salt, expected] = String(stored).split(':');
  try {
    const actual = crypto.scryptSync(String(pin), salt, 64).toString('hex');
    return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  } catch {
    return false;
  }
}

function createEmployerToken(email) {
  const payload = Buffer.from(JSON.stringify({ email: cleanEmail(email), exp: Date.now() + 1000 * 60 * 60 * 24 })).toString('base64url');
  const signature = crypto.createHmac('sha256', CHAT_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function employerFromToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', CHAT_SECRET).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.email || !parsed.exp || parsed.exp < Date.now()) return null;
    return { email: cleanEmail(parsed.email) };
  } catch {
    return null;
  }
}

function createAdminToken() {
  const payload = Buffer.from(JSON.stringify({
    role: 'admin',
    exp: Date.now() + 1000 * 60 * 60 * 24,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', CHAT_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function adminFromToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = String(token).split('.');
  const expected = crypto.createHmac('sha256', CHAT_SECRET).update(payload).digest('base64url');
  try {
    if (signature.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.role === 'admin' && parsed.exp > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}

app.post('/api/admin/login', (req, res) => {
  const password = String(req.body?.password || '');
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password.' });
  }
  return res.json({
    success: true,
    token: createAdminToken(),
    expiresIn: 24 * 60 * 60,
  });
});

async function requireEmployer(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const identity = employerFromToken(token);
  if (!identity) return res.status(401).json({ error: 'Employer login required.' });
  const { data: profile, error } = await supabase
    .from('employer_profiles')
    .select('*')
    .eq('email', identity.email)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!profile) return res.status(404).json({ error: 'Employer profile not found.' });
  if (profile.status === 'suspended') {
    return res.status(403).json({
      error: 'Your employer account has been suspended. You have been logged out.',
      status: 'suspended',
      suspended: true,
    });
  }
  if (profile.status !== 'approved') return res.status(403).json({ error: 'Your employer account is pending admin approval.', status: profile.status || 'pending' });
  // Keep the admin presence view accurate while the employer is using the portal.
  await supabase.from('employer_profiles')
    .update({ online: true, last_seen_at: new Date().toISOString() })
    .eq('id', profile.id);
  req.employer = profile;
  next();
}

function employerEmailFromRequest(req) {
  return cleanEmail(req.employer?.email || req.body?.email || req.query?.email);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function safeFileName(value) {
  return String(value || 'file').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120);
}

function filesFromRequest(req) {
  if (!req.files) return [];
  if (Array.isArray(req.files)) return req.files;
  return Object.values(req.files).flat();
}

async function uploadFiles(files, folder, bucket = 'application-documents') {
  const rows = [];
  for (const file of files) {
    const storagePath = `${folder}/${Date.now()}-${safeFileName(file.originalname)}`;
    const { error } = await supabase.storage
      .from(bucket)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (error) throw new Error(`Storage upload failed for ${file.originalname}: ${error.message}`);
    rows.push({
      document_type: String(file.fieldname || 'document').replace(/^doc-/, ''),
      file_name: file.originalname,
      storage_path: storagePath,
      file_url: null,
      bucket,
      content_type: file.mimetype,
      file_size: file.size,
    });
  }
  return rows;
}

async function addSignedDocumentUrls(documents) {
  return Promise.all((documents || []).map(async document => {
    if (!document.storage_path || !document.bucket) return document;
    const { data } = await supabase.storage
      .from(document.bucket)
      .createSignedUrl(document.storage_path, 60 * 60);
    return { ...document, file_url: data?.signedUrl || document.file_url || null };
  }));
}

async function addSignedChatUrls(messages) {
  return Promise.all((messages || []).map(async message => {
    if (!message.attachment_path || !message.attachment_bucket) return message;
    const { data } = await supabase.storage
      .from(message.attachment_bucket)
      .createSignedUrl(message.attachment_path, 60 * 60);
    return { ...message, attachment_url: data?.signedUrl || null };
  }));
}

function linkDetails(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return {
      url: parsed.toString(),
      title: parsed.hostname.replace(/^www\./, ''),
      description: `Open shared link from ${parsed.hostname.replace(/^www\./, '')}`,
    };
  } catch {
    return null;
  }
}

function chatMessageData(applicationId, body, defaults) {
  const encrypted = body.isEncrypted === true || body.isEncrypted === 'true';
  const link = linkDetails(body.linkUrl || body.link_url);
  const faqKey = String(body.faqKey || '').trim().toLowerCase();
  return {
    application_id: applicationId,
    sender_role: defaults.senderRole,
    sender_name: String(body.senderName || defaults.senderName || 'FindAJob.qa').trim().slice(0, 120),
    sender_email: cleanEmail(body.senderEmail || defaults.senderEmail) || null,
    body: encrypted ? null : String(body.message || '').trim().slice(0, 4000),
    body_ciphertext: encrypted ? String(body.encryptedBody || '').trim().slice(0, 12000) : null,
    encryption_iv: encrypted ? String(body.iv || '').trim().slice(0, 200) : null,
    is_encrypted: encrypted,
    message_type: faqKey ? 'faq' : link ? 'link' : 'text',
    faq_key: faqKey || null,
    link_url: link?.url || null,
    link_title: String(body.linkTitle || link?.title || '').slice(0, 240) || null,
    link_description: String(body.linkDescription || link?.description || '').slice(0, 500) || null,
  };
}

const FAQ_REPLIES = {
  track: 'Please enter your reference number above to see the latest application and visa progress. Your recruiter will update each step here.',
  documents: 'Your passport copy, passport photo, and CV are required first. Your recruiter may request certificates, police clearance, or medical documents later.',
  help: 'I can help you track your application, explain document requests, and share messages from the employer. A recruiter usually replies within 24 hours.',
};

const DEFAULT_FAQS = [
  { faq_key: 'track', question: 'Track my job application', answer: FAQ_REPLIES.track, featured: true, active: true, sort_order: 1 },
  { faq_key: 'agent', question: 'Talk to an agent', answer: 'Please share your name and email address and a FindAJob.qa agent will contact you.', featured: true, active: true, sort_order: 2 },
  { faq_key: 'documents', question: 'Which documents do I need?', answer: FAQ_REPLIES.documents, featured: true, active: true, sort_order: 3 },
  { faq_key: 'employer', question: 'Who is reviewing my application?', answer: 'Your application is reviewed by the employer connected to the job you selected and the FindAJob.qa recruitment team.', featured: false, active: true, sort_order: 4 },
  { faq_key: 'timeline', question: 'What do the progress steps mean?', answer: 'Each step shows where your application is in the review, interview, offer, visa, and arrival process.', featured: false, active: true, sort_order: 5 },
  { faq_key: 'interview', question: 'When will my interview be?', answer: 'The employer will send an interview update in this chat once your application has been selected.', featured: false, active: true, sort_order: 6 },
  { faq_key: 'visa', question: 'How does the Qatar work visa work?', answer: 'The employer sponsors the work visa and will request any additional documents needed for processing. Never pay for a job or visa.', featured: false, active: true, sort_order: 7 },
  { faq_key: 'fees', question: 'Do I need to pay a recruitment fee?', answer: 'No. Never send money to anyone promising a job or visa. Report suspicious requests to FindAJob.qa.', featured: false, active: true, sort_order: 8 },
  { faq_key: 'contact', question: 'How quickly will someone reply?', answer: 'A recruiter usually replies within 24 hours during working days.', featured: false, active: true, sort_order: 9 },
];

async function findApplicationByRef(trackingNumber) {
  const { data, error } = await supabase
    .from('applications')
    .select('id,tracking_number,full_name,email,status,status_step,employer_email,employer_company')
    .eq('tracking_number', String(trackingNumber || '').toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function touchPresence(applicationId, participantKey, role, displayName, online = true, typing = false) {
  const { error } = await supabase.from('chat_presence').upsert({
    application_id: applicationId,
    participant_key: participantKey,
    role,
    display_name: displayName || role,
    online: !!online,
    typing: !!typing,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'application_id,participant_key' });
  if (error) throw error;
}

// ─── APPLICATIONS ────────────────────────────────────────────────────────────

/**
 * POST /api/applications
 * Submit a new job application
 */
app.post('/api/applications', upload.fields([
  { name: 'doc-passport', maxCount: 1 },
  { name: 'doc-photo', maxCount: 1 },
  { name: 'doc-cv', maxCount: 1 },
  { name: 'doc-education', maxCount: 10 },
  { name: 'doc-experience', maxCount: 10 },
  { name: 'doc-licence', maxCount: 1 },
]), async (req, res) => {
  try {
    const body = req.body;
    const email = cleanEmail(body.email);
    if (email) {
      const { data: previous } = await supabase
        .from('applications')
        .select('tracking_number,full_name,job_title,status,submitted_at,status_step')
        .eq('email', email)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (previous) {
        return res.status(409).json({
          error: 'An application already exists for this email address.',
          alreadyApplied: true,
          application: previous,
        });
      }
    }
    const trackingNumber = generateTrackingNumber();
    const uploaded = await uploadFiles(filesFromRequest(req), `applications/${trackingNumber}`);
    let linkedJob = null;
    if (body.jobId || body.job_id) {
      const { data } = await supabase.from('jobs')
        .select('id,contact_email,company_name')
        .eq('id', body.jobId || body.job_id)
        .maybeSingle();
      linkedJob = data || null;
    } else if (body.companyName || body.company_name || body.company) {
      const companyName = body.companyName || body.company_name || body.company;
      const jobTitle = body.jobTitle || body.job_title || '';
      const { data } = await supabase.from('jobs')
        .select('id,contact_email,company_name')
        .eq('company_name', companyName)
        .eq('job_title', jobTitle)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      linkedJob = data || null;
    }

    const applicationData = {
      tracking_number: trackingNumber,
      // Step 1 — Personal
      full_name: body.fullName || '',
      gender: body.gender || '',
      dob: body.dob || null,
      nationality: body.nationality || '',
      marital_status: body.maritalStatus || '',
      religion: body.religion || '',
      country_of_residence: body.countryOfResidence || '',
      current_address: body.currentAddress || '',
      phone: body.phone || '',
       email: email || null,
      job_id: body.jobId || body.job_id || linkedJob?.id || null,
      employer_email: cleanEmail(body.employerEmail || body.employer_email || linkedJob?.contact_email) || null,
      employer_company: body.companyName || body.company_name || body.company || linkedJob?.company_name || '',
      // Step 2 — Passport
      passport_number: body.passportNumber || '',
      passport_expiry: body.passportExpiry || null,
      has_passport: body.hasPassport || '',
      worked_qatar: body.workedQatar || '',
      denied_visa: body.deniedVisa || '',
      has_qatar_visa: body.hasQatarVisa || '',
      // Step 3 — Job preferences
      job_title: body.jobTitle || '',
      job_location: body.jobLocation || '',
       industry: asArray(body.industry),
      expected_salary: body.expectedSalary || '',
      start_date: body.startDate || null,
      experience: body.experience || '',
      // Step 4 — Education & Work
      education: body.education || '',
      school_name: body.schoolName || '',
      graduation_year: body.graduationYear || null,
      field_of_study: body.fieldOfStudy || '',
      current_employer: body.currentEmployer || '',
      current_job_title: body.currentJobTitle || '',
      employment_period: body.employmentPeriod || '',
      current_country: body.currentCountry || '',
      previous_employers: body.previousEmployers || '',
      responsibilities: body.responsibilities || '',
      // Step 5 — Skills
      languages: body.languages || '',
      english_level: body.englishLevel || '',
      driving_licence: body.drivingLicence || '',
      driving_years: body.drivingYears || '',
      computer_skills: body.computerSkills || '',
      professional_certs: body.professionalCerts || '',
      trade_skills: body.tradeSkills || '',
      additional_message: body.message || '',
      // Step 7 — Emergency contact
      emergency_name: body.emergencyName || '',
      emergency_relationship: body.emergencyRelationship || '',
      emergency_phone: body.emergencyPhone || '',
      emergency_country: body.emergencyCountry || '',
      emergency_address: body.emergencyAddress || '',
      // Status
      status: 'submitted',
      status_step: 1,
      submitted_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('applications')
      .insert([applicationData])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (uploaded.length) {
      const { error: documentsError } = await supabase
        .from('application_documents')
        .insert(uploaded.map(document => ({ ...document, application_id: data.id })));
      if (documentsError) {
        return res.status(500).json({ error: documentsError.message });
      }
    }

    // Log status history
    await supabase.from('status_history').insert([{
      application_id: data.id,
      status: 'submitted',
      note: 'Application submitted successfully',
    }]);
    await supabase.from('chat_messages').insert([{
      application_id: data.id,
      sender_role: 'system',
      sender_name: 'FindAJob.qa Assistant',
      body: `Your application was submitted successfully. Your reference number is ${trackingNumber}. We will post progress updates here.`,
      is_encrypted: false,
      message_type: 'system',
    }]);

    return res.status(201).json({
      success: true,
      trackingNumber,
      applicationId: data.id,
      message: 'Application submitted successfully',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/applications/check-email?email=xxx
 * Check if an email has already applied — returns tracking number if found
 */
app.get('/api/applications/check-email', async (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email required' });

  const { data, error } = await supabase
    .from('applications')
    .select('tracking_number, full_name, job_title, status, submitted_at, status_step')
    .eq('email', email)
    .order('submitted_at', { ascending: false })
    .limit(1);

  if (error) return res.status(500).json({ error: error.message });

  if (data && data.length > 0) {
    return res.json({ exists: true, application: data[0] });
  }
  return res.json({ exists: false });
});

/**
 * GET /api/applications/track/:trackingNumber
 * Get application by tracking number (public — for applicant dashboard)
 */
app.get('/api/applications/track/:trackingNumber', async (req, res) => {
  const { data, error } = await supabase
    .from('applications')
    .select(`
      id, tracking_number, full_name, email, phone, gender, dob, nationality,
      marital_status, religion, country_of_residence, current_address,
      job_id, job_title, job_location, industry, expected_salary, start_date, experience,
      education, school_name, graduation_year, field_of_study, current_employer,
      current_job_title, employment_period, current_country, previous_employers, responsibilities,
      languages, english_level, driving_licence, driving_years, computer_skills,
      professional_certs, trade_skills, additional_message,
      status, status_step, submitted_at, updated_at, admin_notes, employer_email, employer_company,
      passport_number, has_passport, worked_qatar,
      passport_expiry, denied_visa, has_qatar_visa,
      emergency_name, emergency_relationship, emergency_phone, emergency_country, emergency_address
    `)
    .eq('tracking_number', req.params.trackingNumber.toUpperCase())
    .single();

  if (error || !data) return res.status(404).json({ error: 'Application not found' });

  // Get status history
  const { data: history } = await supabase
    .from('status_history')
    .select('status, note, created_at, changed_by')
    .eq('application_id', data.id)
    .order('created_at', { ascending: true });

  const [{ data: comments }, { data: documents }, { data: employer }] = await Promise.all([
    supabase.from('application_comments').select('*').eq('application_id', data.id).order('created_at', { ascending: true }),
    supabase.from('application_documents').select('*').eq('application_id', data.id).order('created_at', { ascending: true }),
    data.employer_email
      ? supabase.from('employer_profiles').select('name,company_name,photo_url,email,phone,job_title,location,website,about,online,last_seen_at,status').eq('email', data.employer_email).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const { data: job } = data.job_id
    ? await supabase.from('jobs').select('*').eq('id', data.job_id).maybeSingle()
    : { data: null };
  const [{ data: messages }, { data: presence }, { data: employers }] = await Promise.all([
    supabase.from('chat_messages').select('*').eq('application_id', data.id).order('created_at', { ascending: true }),
    supabase.from('chat_presence').select('*').eq('application_id', data.id).order('last_seen_at', { ascending: false }),
    supabase.from('employer_profiles').select('id,name,company_name,photo_url,email,job_title,online,last_seen_at').order('updated_at', { ascending: false }).limit(3),
  ]);

  return res.json({
    application: data,
    history: history || [],
    comments: comments || [],
    documents: await addSignedDocumentUrls(documents),
    employer: employer || null,
    job: job || null,
    messages: await addSignedChatUrls(messages),
    presence: presence || [],
    employers: employers || [],
  });
});

/**
 * GET /api/applications/track/:trackingNumber/messages
 * Return only the encrypted/support chat stream for a tracking reference.
 */
app.get('/api/applications/track/:trackingNumber/messages', async (req, res) => {
  try {
    const application = await findApplicationByRef(req.params.trackingNumber);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const [{ data: messages, error }, { data: presence }] = await Promise.all([
      supabase.from('chat_messages').select('*').eq('application_id', application.id).order('created_at', { ascending: true }),
      supabase.from('chat_presence').select('*').eq('application_id', application.id).order('last_seen_at', { ascending: false }),
    ]);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ messages: await addSignedChatUrls(messages), presence: presence || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load chat.' });
  }
});

/**
 * POST /api/applications/:trackingNumber/messages
 * Applicant and employer chat messages. Content is accepted as ciphertext from
 * the browser; the server only stores the encrypted value for encrypted chats.
 */
app.post('/api/applications/:trackingNumber/messages', upload.array('attachments', 5), async (req, res) => {
  try {
    const application = await findApplicationByRef(req.params.trackingNumber);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const role = String(req.body.senderRole || 'applicant').toLowerCase();
    const senderEmail = cleanEmail(req.body.senderEmail);
    const admin = req.headers['x-admin-password'] === ADMIN_PASSWORD;
    if (!['applicant', 'employer', 'admin', 'system'].includes(role)) {
      return res.status(400).json({ error: 'Invalid sender role' });
    }
    const employerIdentity = role === 'employer' ? employerFromToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')) : null;
    if (role === 'employer' && !admin && (!employerIdentity || employerIdentity.email !== cleanEmail(application.employer_email))) {
      return res.status(403).json({ error: 'Employer access is not allowed for this application.' });
    }
    if (role === 'employer' && employerIdentity) req.body.senderEmail = employerIdentity.email;
    const authenticatedSenderEmail = employerIdentity?.email || senderEmail;
    const files = filesFromRequest(req);
    const uploaded = files.length
      ? await uploadFiles(files, `applications/${application.tracking_number}/chat`)
      : [];
    const message = chatMessageData(application.id, req.body, {
      senderRole: role,
      senderEmail: authenticatedSenderEmail,
      senderName: role === 'applicant'
        ? application.full_name
        : role === 'admin'
          ? 'FindAJob.qa Support'
          : (req.body.senderName || 'Employer'),
    });
    if (!message.body && !message.body_ciphertext && !message.link_url && !uploaded.length) {
      return res.status(400).json({ error: 'Message, link, or attachment is required.' });
    }
    if (uploaded.length) {
      const first = uploaded[0];
      message.attachment_path = first.storage_path;
      message.attachment_bucket = first.bucket;
      message.attachment_name = first.file_name;
      message.attachment_type = first.content_type;
      message.attachment_size = first.file_size;
    }
    const { data, error } = await supabase.from('chat_messages').insert([message]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (role === 'applicant' && message.faq_key) {
      let reply = FAQ_REPLIES[message.faq_key];
      try {
        const { data: configuredFaq } = await supabase.from('chat_faqs').select('answer,active').eq('faq_key', message.faq_key).maybeSingle();
        if (configuredFaq?.active && configuredFaq.answer) reply = configuredFaq.answer;
      } catch {}
      if (message.faq_key === 'agent') reply = 'Please enter your name and email address in the form below so an agent can contact you.';
      if (reply) await supabase.from('chat_messages').insert([{
        application_id: application.id,
        sender_role: 'system',
        sender_name: 'FindAJob.qa Assistant',
        body: reply,
        is_encrypted: false,
        message_type: 'faq_reply',
        faq_key: message.faq_key,
      }]);
    }
    await touchPresence(
      application.id,
      authenticatedSenderEmail || role,
      role,
      message.sender_name,
      true,
      false,
    );
    return res.status(201).json({ message: (await addSignedChatUrls([data]))[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not send message.' });
  }
});

app.post('/api/applications/:trackingNumber/presence', async (req, res) => {
  try {
    const application = await findApplicationByRef(req.params.trackingNumber);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    const role = String(req.body.role || 'applicant').toLowerCase();
    const employerIdentity = role === 'employer' ? employerFromToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')) : null;
    if (role === 'employer' && (!employerIdentity || employerIdentity.email !== cleanEmail(application.employer_email))) {
      return res.status(403).json({ error: 'Employer access is not allowed for this application.' });
    }
    const email = employerIdentity?.email || cleanEmail(req.body.email);
    const key = email || role;
    await touchPresence(application.id, key, role, req.body.name || (role === 'applicant' ? application.full_name : 'Employer'), req.body.online !== false, req.body.typing === true);
    const { data, error } = await supabase.from('chat_presence').select('*').eq('application_id', application.id).order('last_seen_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ presence: data || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Could not update presence.' });
  }
});

// ─── ADMIN — APPLICATIONS ─────────────────────────────────────────────────────

/**
 * GET /api/admin/applications
 * Get all applications (admin only)
 */
app.get('/api/admin/applications', adminAuth, async (req, res) => {
  const { status, search, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let query = supabase
    .from('applications')
    .select('*', { count: 'exact' })
    .order('submitted_at', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);

  if (status) query = query.eq('status', status);
  if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,tracking_number.ilike.%${search}%,phone.ilike.%${search}%`);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ applications: data, total: count });
});

/**
 * GET /api/admin/applications/:id
 * Get single application detail (admin only)
 */
app.get('/api/admin/applications/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('applications')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Not found' });

  const { data: history } = await supabase
    .from('status_history')
    .select('*')
    .eq('application_id', req.params.id)
    .order('created_at', { ascending: true });

  const [{ data: comments }, { data: documents }] = await Promise.all([
    supabase.from('application_comments').select('*').eq('application_id', req.params.id).order('created_at', { ascending: true }),
    supabase.from('application_documents').select('*').eq('application_id', req.params.id).order('created_at', { ascending: true }),
  ]);

  return res.json({
    application: data,
    history: history || [],
    comments: comments || [],
    documents: await addSignedDocumentUrls(documents),
  });
});

// ─── EMPLOYER PORTAL ──────────────────────────────────────────────────────────

/**
 * POST /api/employers/profile
 * Create or update an employer profile and upload its photo to Supabase Storage.
 */
app.post('/api/employers/profile', upload.single('photo'), async (req, res) => {
  try {
    const body = req.body;
    const email = cleanEmail(body.email);
    if (!email || !body.name || !body.companyName) {
      return res.status(400).json({ error: 'Name, company name, and email are required.' });
    }
    const { data: existing } = await supabase.from('employer_profiles').select('id,status,pin_hash').eq('email', email).maybeSingle();
    if (!existing && !body.pin) return res.status(400).json({ error: 'A PIN is required when creating an employer profile.' });
    if (body.pin && !/^\d{4,12}$/.test(String(body.pin))) {
      return res.status(400).json({ error: 'PIN must contain 4 to 12 digits.' });
    }
    if (existing) {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const identity = employerFromToken(token);
      if (!identity || identity.email !== email) return res.status(401).json({ error: 'Employer login required to update this profile.' });
    }

    let photoPath = body.photoPath || null;
    let photoUrl = body.photoUrl || null;
    if (req.file) {
      const uploaded = await uploadFiles([req.file], `employers/${email}`, 'employer-photos');
      photoPath = uploaded[0].storage_path;
      const { data } = supabase.storage.from('employer-photos').getPublicUrl(photoPath);
      photoUrl = data.publicUrl;
    }

    const profile = {
      email,
      name: String(body.name).trim(),
      company_name: String(body.companyName).trim(),
      phone: body.phone || '',
      job_title: body.jobTitle || '',
      location: body.location || '',
      website: body.website || '',
      about: body.about || '',
      photo_path: photoPath,
      photo_url: photoUrl,
      updated_at: new Date().toISOString(),
    };
    if (body.pin) profile.pin_hash = hashPin(body.pin);
    if (!existing) {
      profile.status = 'pending';
      profile.online = false;
      profile.last_seen_at = null;
    }

    const { data, error } = await supabase
      .from('employer_profiles')
      .upsert(profile, { onConflict: 'email' })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    const safeProfile = { ...data };
    delete safeProfile.pin_hash;
    return res.status(200).json({ success: true, profile: safeProfile, pendingApproval: data.status !== 'approved' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Could not save employer profile.' });
  }
});

app.post('/api/employers/login', async (req, res) => {
  try {
    const email = cleanEmail(req.body?.email);
    const pin = String(req.body?.pin || '');
    if (!email || !pin) return res.status(400).json({ error: 'Email and PIN are required.' });
    const { data: profile, error } = await supabase.from('employer_profiles').select('*').eq('email', email).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!profile || !verifyPin(pin, profile.pin_hash)) return res.status(401).json({ error: 'Incorrect email or PIN.' });
    const safeProfile = { ...profile };
    delete safeProfile.pin_hash;
  if (profile.status === 'suspended') {
    return res.status(403).json({
      error: 'Your employer account has been suspended. You have been logged out.',
      status: 'suspended',
      suspended: true,
      profile: safeProfile,
    });
  }
  if (profile.status !== 'approved') {
      return res.status(403).json({ error: 'Your profile is pending admin approval.', status: profile.status || 'pending', profile: safeProfile });
    }
    await supabase.from('employer_profiles').update({ online: true, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', profile.id);
    return res.json({ success: true, token: createEmployerToken(email), profile: { ...safeProfile, online: true } });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not sign in.' });
  }
});

app.get('/api/employers/me', requireEmployer, async (req, res) => {
  const safeProfile = { ...req.employer };
  delete safeProfile.pin_hash;
  return res.json({ profile: safeProfile });
});

/**
 * GET /api/employers/access
 * Return only applications belonging to the authenticated employer.
 */
app.get('/api/employers/access', requireEmployer, async (req, res) => {
  const email = cleanEmail(req.employer.email);

  const [{ data: profile, error: profileError }, { data: applications, error: applicationsError }] = await Promise.all([
    supabase.from('employer_profiles').select('*').eq('email', email).maybeSingle(),
    supabase
      .from('applications')
       .select('id,tracking_number,full_name,email,phone,nationality,job_title,job_location,experience,education,status,status_step,submitted_at,updated_at,employer_email,employer_company,job_id')
      .eq('employer_email', email)
      .order('submitted_at', { ascending: false }),
  ]);
  if (profileError) return res.status(500).json({ error: profileError.message });
  if (applicationsError) return res.status(500).json({ error: applicationsError.message });
  const jobIds = [...new Set((applications || []).map(application => application.job_id).filter(Boolean))];
  let jobs = [];
  if (jobIds.length) {
    const { data: jobRows, error: jobsError } = await supabase
      .from('jobs')
      .select('*')
      .in('id', jobIds);
    if (jobsError) return res.status(500).json({ error: jobsError.message });
    jobs = jobRows || [];
  }
  const jobsById = Object.fromEntries(jobs.map(job => [job.id, job]));
  return res.json({
    profile: profile || null,
    applications: (applications || []).map(application => ({
      ...application,
      job: jobsById[application.job_id] || null,
    })),
  });
});

app.get('/api/employers/jobs', requireEmployer, async (req, res) => {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('contact_email', cleanEmail(req.employer.email))
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ jobs: data || [] });
});

app.get('/api/employers/applications/:id', requireEmployer, async (req, res) => {
  const email = cleanEmail(req.employer.email);
  const { data: application, error } = await supabase
    .from('applications')
    .select('*')
    .eq('id', req.params.id)
    .eq('employer_email', email)
    .single();
  if (error || !application) return res.status(404).json({ error: 'Application not found for this employer.' });

  const [{ data: comments }, { data: documents }, { data: messages }, { data: presence }, { data: job }] = await Promise.all([
    supabase.from('application_comments').select('*').eq('application_id', application.id).order('created_at', { ascending: true }),
    supabase.from('application_documents').select('*').eq('application_id', application.id).order('created_at', { ascending: true }),
    supabase.from('chat_messages').select('*').eq('application_id', application.id).order('created_at', { ascending: true }),
    supabase.from('chat_presence').select('*').eq('application_id', application.id).order('last_seen_at', { ascending: false }),
    application.job_id ? supabase.from('jobs').select('*').eq('id', application.job_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return res.json({
    application,
    job: job || null,
    comments: comments || [],
    documents: await addSignedDocumentUrls(documents),
    messages: await addSignedChatUrls(messages),
    presence: presence || [],
  });
});

app.put('/api/employers/applications/:id/decision', requireEmployer, async (req, res) => {
  const email = cleanEmail(req.employer.email);
  const decision = String(req.body.decision || '').toLowerCase();
  const comment = String(req.body.comment || '').trim();
  const employerName = String(req.body.employerName || 'Employer').trim();
  const requestedStatus = String(req.body.status || '').toLowerCase();
  const validStatuses = ['employer_review', 'interview_scheduled', 'job_offer', 'visa_processing', 'visa_approved', 'cancelled', 'rejected'];
  const status = decision === 'approved'
    ? (validStatuses.includes(requestedStatus) ? requestedStatus : 'interview_scheduled')
    : decision === 'declined' || decision === 'rejected'
      ? 'rejected'
      : requestedStatus;
  if (!email || !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Choose a valid application decision.' });
  }

  const { data: existing, error: lookupError } = await supabase
    .from('applications')
    .select('id')
    .eq('id', req.params.id)
    .eq('employer_email', email)
    .single();
  if (lookupError || !existing) return res.status(404).json({ error: 'Application not found for this employer.' });

  const statusStep = ['rejected', 'cancelled'].includes(status) ? 0 : ({ employer_review: 3, interview_scheduled: 4, job_offer: 5, visa_processing: 6, visa_approved: 7 }[status] || 3);
  const updateData = { status, status_step: statusStep, updated_at: new Date().toISOString() };
  const { data: application, error } = await supabase
    .from('applications')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  const note = comment || (status === 'rejected' ? 'The employer declined this application.' : status === 'cancelled' ? 'This application was cancelled.' : 'The employer approved this application for the next stage.');
  const [historyResult, commentResult] = await Promise.all([
    supabase.from('status_history').insert([{
      application_id: req.params.id,
      status,
      note,
      changed_by: employerName,
    }]),
    supabase.from('application_comments').insert([{
      application_id: req.params.id,
      employer_email: email,
      employer_name: employerName,
      comment: note,
    }]),
  ]);
  if (historyResult.error) return res.status(500).json({ error: historyResult.error.message });
  if (commentResult.error) return res.status(500).json({ error: commentResult.error.message });
  return res.json({ success: true, application });
});

/**
 * PUT /api/admin/applications/:id/status
 * Update application status (admin or approved agent)
 */
app.put('/api/admin/applications/:id/status', adminAuth, async (req, res) => {
  const { status, note, changedBy, statusStep } = req.body;

  const validStatuses = [
    'submitted', 'documents_review', 'employer_review',
    'interview_scheduled', 'job_offer', 'visa_processing',
    'visa_approved', 'flight_prep', 'arrived', 'employed', 'cancelled', 'rejected'
  ];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const updateData = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (note) updateData.admin_notes = note;
  if (statusStep) updateData.status_step = statusStep;

  const { data, error } = await supabase
    .from('applications')
    .update(updateData)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Log history
  await supabase.from('status_history').insert([{
    application_id: req.params.id,
    status,
    note: note || `Status updated to ${status}`,
    changed_by: changedBy || 'Admin',
  }]);

  return res.json({ success: true, application: data });
});

/**
 * DELETE /api/admin/applications/:id
 * Delete an application (admin only)
 */
app.delete('/api/admin/applications/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('applications').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

app.delete('/api/admin/agents/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('agents').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ─── AGENTS ──────────────────────────────────────────────────────────────────

/**
 * POST /api/agents/apply
 * Submit agent application
 */
app.post('/api/agents/apply', async (req, res) => {
  try {
    const body = req.body;
    const agentData = {
      name: body.name || '',
      email: body.email ? body.email.toLowerCase().trim() : '',
      phone: body.phone || '',
      whatsapp: body.whatsapp || body.phone || '',
      nationality: body.nationality || '',
      location_city: body.locationCity || '',
      location_area: body.locationArea || '',
      area_in_qatar: body.areaInQatar || '',
      spoken_languages: body.spokenLanguages || '',
      experience_years: body.experienceYears || '',
      current_occupation: body.currentOccupation || '',
      why_agent: body.whyAgent || '',
      status: 'pending',
    };

    // Check for duplicate email
    const { data: existing } = await supabase
      .from('agents')
      .select('id')
      .eq('email', agentData.email)
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'An agent application with this email already exists.' });
    }

    const { data, error } = await supabase
      .from('agents')
      .insert([agentData])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, agentId: data.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/agents
 * Get all agent applications (admin only)
 */
app.get('/api/admin/agents', adminAuth, async (req, res) => {
  const { status } = req.query;
  let query = supabase.from('agents').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ agents: data });
});

/**
 * PUT /api/admin/agents/:id/status
 * Approve / reject / activate an agent
 */
app.put('/api/admin/agents/:id/status', adminAuth, async (req, res) => {
  const { status, note } = req.body;
  const validStatuses = ['pending', 'approved', 'active', 'rejected'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const { data, error } = await supabase
    .from('agents')
    .update({ status, admin_note: note || '', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, agent: data });
});

// ─── JOBS ────────────────────────────────────────────────────────────────────

/**
 * GET /api/jobs
 * Get all active jobs (public)
 */
app.get('/api/jobs', async (req, res) => {
  const { category, location, type } = req.query;
  let query = supabase
    .from('jobs')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false });

  if (category) query = query.eq('category', category);
  if (location) query = query.ilike('location', `%${location}%`);
  if (type) query = query.eq('type', type);

  const { data, error } = await query;
  if (error) {
    const missingJobsTable = /relation .*jobs.* does not exist|could not find the table .*jobs.* in the schema cache/i.test(error.message || '');
    return res.status(missingJobsTable ? 503 : 500).json({
      error: missingJobsTable
        ? 'Jobs database table is not configured. Run the jobs schema in SUPABASE_SETUP.md.'
        : error.message,
    });
  }
  return res.json({ jobs: data });
});

/**
 * POST /api/jobs
 * Post a new job (employer — requires admin approval or can be auto-active based on config)
 */
app.post('/api/jobs', async (req, res) => {
  try {
    const body = req.body;
    const identity = employerFromToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!identity) return res.status(401).json({ error: 'Approved employer login required to post a job.' });
    const { data: employer } = await supabase.from('employer_profiles').select('name,company_name,phone,status').eq('email', identity.email).maybeSingle();
    if (!employer || employer.status !== 'approved') return res.status(403).json({ error: 'Your employer profile must be approved before posting jobs.' });
    const jobData = {
      company_name: body.companyName || body.company_name || employer.company_name || '',
      contact_name: body.contactName || body.contact_name || employer.name || '',
      contact_email: identity.email,
      contact_phone: body.contactPhone || body.contact_phone || employer.phone || '',
      job_title: body.jobTitle || body.job_title || body.title || '',
      category: body.category || '',
      location: body.location || '',
      salary_min: body.salaryMin || body.salary_min || null,
      salary_max: body.salaryMax || body.salary_max || null,
      contract_type: body.contractType || body.employmentType || body.contract_type || '',
      description: body.description || '',
      requirements: body.requirements || '',
      experience_required: body.experienceRequired || '',
      positions_available: parseInt(body.positionsAvailable || body.vacancies) || 1,
      benefits: body.benefits || '',
      visa_sponsor: body.visaSponsor !== false && body.visaSponsor !== 'false',
      accommodation: body.accommodation === 'true' || body.accommodation === true,
      transport: body.transport === 'true' || body.transport === true,
      medical: body.medical === 'true' || body.medical === true,
      active: false, // Admin must approve
    };

    const { data, error } = await supabase
      .from('jobs')
      .insert([jobData])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ success: true, jobId: data.id, job_id: data.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/jobs
 * Get all jobs including inactive (admin only)
 */
app.get('/api/admin/jobs', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ jobs: data });
});

/**
 * PUT /api/admin/jobs/:id/activate
 * Activate a job posting (admin only)
 */
app.put('/api/admin/jobs/:id/activate', adminAuth, async (req, res) => {
  const { active } = req.body;
  const { data, error } = await supabase
    .from('jobs')
    .update({ active: !!active })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, job: data });
});

app.delete('/api/admin/jobs/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('jobs').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ─── STATS (admin dashboard) ─────────────────────────────────────────────────
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const [appCount, agentCount, jobCount, recentApps] = await Promise.all([
    supabase.from('applications').select('status', { count: 'exact', head: false }),
    supabase.from('agents').select('status', { count: 'exact', head: false }),
    supabase.from('jobs').select('active', { count: 'exact', head: false }),
    supabase.from('applications').select('tracking_number,full_name,job_title,status,submitted_at').order('submitted_at', { ascending: false }).limit(5),
  ]);

  const statusCounts = {};
  (appCount.data || []).forEach(a => {
    statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
  });

  const agentStatusCounts = {};
  (agentCount.data || []).forEach(a => {
    agentStatusCounts[a.status] = (agentStatusCounts[a.status] || 0) + 1;
  });

  return res.json({
    totalApplications: appCount.count || 0,
    totalAgents: agentCount.count || 0,
    totalJobs: jobCount.count || 0,
    statusCounts,
    agentStatusCounts,
    recentApplications: recentApps.data || [],
  });
});

app.get('/api/admin/employers', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('employer_profiles')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const { data: presence } = await supabase
    .from('chat_presence')
    .select('participant_key,online,typing,last_seen_at')
    .eq('role', 'employer')
    .order('last_seen_at', { ascending: false });
  const presenceByKey = {};
  (presence || []).forEach(item => {
    if (!presenceByKey[item.participant_key]) presenceByKey[item.participant_key] = item;
  });
  return res.json({
    employers: (data || []).map(profile => {
      const safeProfile = { ...profile };
      delete safeProfile.pin_hash;
      const live = presenceByKey[cleanEmail(profile.email)];
      return {
        ...safeProfile,
        pin_set: Boolean(profile.pin_hash),
        online: Boolean(profile.online || live?.online),
        typing: Boolean(live?.typing),
        last_seen_at: live?.last_seen_at || profile.last_seen_at,
      };
    }),
  });
});

app.put('/api/admin/employers/:id/status', adminAuth, async (req, res) => {
  const status = String(req.body?.status || '').toLowerCase();
  if (!['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Invalid employer status.' });
  }
  const { data, error } = await supabase
    .from('employer_profiles')
    .update({ status, online: false, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  const safeProfile = { ...data };
  delete safeProfile.pin_hash;
  return res.json({ success: true, profile: safeProfile });
});

app.delete('/api/admin/employers/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('employer_profiles').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

// ─── BOT QUESTIONS ────────────────────────────────────────────────────────────
app.get('/api/faqs', async (req, res) => {
  const { data, error } = await supabase.from('chat_faqs').select('faq_key,question,answer,featured,active,sort_order').eq('active', true).order('featured', { ascending: false }).order('sort_order', { ascending: true });
  if (error) {
    if (/relation .*chat_faqs.* does not exist|could not find the table .*chat_faqs/i.test(error.message || '')) return res.json({ faqs: DEFAULT_FAQS });
    return res.status(500).json({ error: error.message });
  }
  return res.json({ faqs: data?.length ? data : DEFAULT_FAQS });
});

app.get('/api/admin/faqs', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('chat_faqs').select('*').order('featured', { ascending: false }).order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ faqs: data || [] });
});

app.post('/api/admin/faqs', adminAuth, async (req, res) => {
  const body = req.body || {};
  const faq = {
    faq_key: String(body.faqKey || body.faq_key || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
    question: String(body.question || '').trim(),
    answer: String(body.answer || '').trim(),
    featured: body.featured === true || body.featured === 'true',
    active: body.active !== false && body.active !== 'false',
    sort_order: Number(body.sortOrder || body.sort_order || 100),
    updated_at: new Date().toISOString(),
  };
  if (!faq.faq_key || !faq.question || !faq.answer) return res.status(400).json({ error: 'Question and answer are required.' });
  const { data, error } = await supabase.from('chat_faqs').upsert([faq], { onConflict: 'faq_key' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ success: true, faq: data });
});

app.put('/api/admin/faqs/:faqKey', adminAuth, async (req, res) => {
  const body = req.body || {};
  const update = {
    question: String(body.question || '').trim(),
    answer: String(body.answer || '').trim(),
    featured: body.featured === true || body.featured === 'true',
    active: body.active !== false && body.active !== 'false',
    sort_order: Number(body.sortOrder || body.sort_order || 100),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('chat_faqs').update(update).eq('faq_key', req.params.faqKey).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, faq: data });
});

app.delete('/api/admin/faqs/:faqKey', adminAuth, async (req, res) => {
  const { error } = await supabase.from('chat_faqs').delete().eq('faq_key', req.params.faqKey);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
});

app.post('/api/contact', async (req, res) => {
  const { name, email, subject, category, message } = req.body || {};
  if (!name || !email || !subject || !category || !message) {
    return res.status(400).json({ error: 'All contact form fields are required.' });
  }
  const { data, error } = await supabase
    .from('contact_messages')
    .insert([{ name: String(name).trim(), email: cleanEmail(email), subject: String(subject).trim(), category, message: String(message).trim() }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ success: true, messageId: data.id });
});

app.post('/api/subscribers', async (req, res) => {
  const email = cleanEmail(req.body?.email);
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email is required.' });
  const { error } = await supabase.from('job_alert_subscribers').upsert([{ email }], { onConflict: 'email' });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ success: true });
});

const pageAliases = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/employer.html': 'employer.html',
  '/dashboard.html': 'dashboard.html',
  '/apply.html': 'apply.html',
  '/admin.html': 'admin.html',
  '/apply-agent.html': 'apply-agent.html',
};

Object.entries(pageAliases).forEach(([route, file]) => {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, file)));
});

// ─── CATCH-ALL — serve index.html ─────────────────────────────────────────────
// Express 5 uses the named splat form for a catch-all route.
app.get('/{*splat}', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, pageAliases['/']));
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FindAJob.qa server running on http://localhost:${PORT}`);
});
