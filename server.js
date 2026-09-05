const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '.env.example'), override: false });

const port = Number(process.env.PORT || 3000);
const sessions = new Map();
const oauthStates = new Map();
const studyState = new Map();
const providers = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    userInfo: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile'
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    userInfo: 'https://api.github.com/user',
    scope: 'read:user user:email'
  },
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    userInfo: 'https://discord.com/api/users/@me',
    scope: 'identify email'
  },
  notion: {
    clientId: process.env.NOTION_CLIENT_ID,
    clientSecret: process.env.NOTION_CLIENT_SECRET,
    authorize: 'https://api.notion.com/v1/oauth/authorize',
    token: 'https://api.notion.com/v1/oauth/token',
    userInfo: 'https://api.notion.com/v1/users/me',
    scope: ''
  }
};

function redirectUri(request, provider) {
  const configured = process.env[`${provider.toUpperCase()}_REDIRECT_URI`];
  const baseUrl = process.env.APP_URL || `http://${request.headers.host}`;
  return configured || `${baseUrl.replace(/\/$/, '')}/auth/${provider}/callback`;
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  response.end(body);
}

function redirect(response, location, cookies = []) {
  response.writeHead(302, { Location: location, 'Set-Cookie': cookies });
  response.end();
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map(value => {
    const index = value.indexOf('=');
    return [value.slice(0, index).trim(), decodeURIComponent(value.slice(index + 1).trim())];
  }));
}

function getSession(request) {
  const sessionId = parseCookies(request).studypilot_session;
  return sessionId ? sessions.get(sessionId) : null;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error('Request body too large'));
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  send(response, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
}

function stateFor(session) {
  const key = session.email || session.name;
  if (!studyState.has(key)) studyState.set(key, { subjects: [], notes: [], mastery: {}, flashcards: [], sessions: [] });
  return studyState.get(key);
}

function requireSession(request, response) {
  const session = getSession(request);
  if (!session) { sendJson(response, 401, { error: 'Sign in required' }); return null; }
  return session;
}

async function generateTutorReply(prompt, context = '') {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey || apiKey.startsWith('your_')) return 'Let’s work it out together. What have you tried so far, and which part feels least clear?';
  const model = process.env.AI_MODEL || 'openai/gpt-4o-mini';
  const result = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000', 'X-Title': 'StudyPilot' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: 'You are StudyPilot, a patient tutor. Teach understanding. Ask what the learner tried, give hints before answers, identify misconceptions, and never help cheat on active exams. Keep responses concise.' }, { role: 'user', content: `Context: ${context}\nLearner: ${prompt}` }] }) });
  if (!result.ok) throw new Error('AI provider request failed');
  const data = await result.json();
  return data.choices?.[0]?.message?.content || 'I could not form a response yet. Try explaining what you understand so far.';
}

async function handleApi(request, response, url) {
  if (request.method === 'POST' && url.pathname === '/api/session/demo') {
    try {
      const body = await readBody(request);
      if (!body.name || typeof body.name !== 'string') return sendJson(response, 400, { error: 'A display name is required' });
      const sessionId = crypto.randomBytes(32).toString('hex');
      sessions.set(sessionId, { provider: body.provider || 'email-demo', name: body.name.slice(0, 80), email: String(body.email || '').slice(0, 160), createdAt: Date.now(), demo: true });
      return redirect(response, '/', [`studypilot_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`]);
    } catch { return sendJson(response, 400, { error: 'Could not create demo session' }); }
  }
  const session = requireSession(request, response);
  if (!session) return;
  const state = stateFor(session);
  try {
    if (request.method === 'GET' && url.pathname === '/api/me') return sendJson(response, 200, { user: session, state });
    if (request.method === 'POST' && url.pathname === '/api/tutor') {
      const body = await readBody(request);
      if (!body.prompt || typeof body.prompt !== 'string') return sendJson(response, 400, { error: 'A prompt is required' });
      return sendJson(response, 200, { reply: await generateTutorReply(body.prompt, body.context || '') });
    }
    if (request.method === 'POST' && url.pathname === '/api/materials/analyze') {
      const body = await readBody(request);
      const text = String(body.text || '').trim();
      if (!text) return sendJson(response, 400, { error: 'Material text is required' });
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const topics = lines.slice(0, 20).map(line => line.replace(/^[-*\d.)\s]+/, '').slice(0, 120));
      const note = { id: crypto.randomUUID(), title: body.title || 'Analyzed material', body: text, topics, createdAt: new Date().toISOString() };
      state.notes.push(note);
      return sendJson(response, 201, { note, concepts: topics.slice(0, 8), questions: topics.slice(0, 5).map(topic => `What is the key idea behind ${topic}?`) });
    }
    if (request.method === 'POST' && url.pathname === '/api/notes') {
      const body = await readBody(request);
      if (!body.title || typeof body.title !== 'string') return sendJson(response, 400, { error: 'A note title is required' });
      const note = { id: crypto.randomUUID(), title: body.title.slice(0, 160), body: String(body.body || '').slice(0, 100000), subject: String(body.subject || 'General'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      state.notes.push(note);
      return sendJson(response, 201, { note });
    }
    if (request.method === 'GET' && url.pathname === '/api/notes') return sendJson(response, 200, { notes: state.notes });
    if (request.method === 'POST' && url.pathname === '/api/flashcards/generate') {
      const body = await readBody(request);
      const topics = Array.isArray(body.topics) ? body.topics.filter(topic => typeof topic === 'string').slice(0, 20) : [];
      const flashcards = topics.map(topic => ({ id: crypto.randomUUID(), front: `What is the key idea behind ${topic}?`, back: `Explain ${topic} in your own words, then check your course material for missing details.`, dueAt: new Date().toISOString(), intervalDays: 1 }));
      state.flashcards.push(...flashcards);
      return sendJson(response, 201, { flashcards });
    }
    if (request.method === 'POST' && url.pathname === '/api/sessions') {
      const body = await readBody(request);
      const sessionRecord = { id: crypto.randomUUID(), topic: String(body.topic || 'Focused study'), plannedMinutes: Math.max(5, Number(body.plannedMinutes || 20)), completedMinutes: Math.max(0, Number(body.completedMinutes || 0)), completedAt: body.completed ? new Date().toISOString() : null };
      state.sessions.push(sessionRecord);
      return sendJson(response, 201, { session: sessionRecord });
    }
    if (request.method === 'GET' && url.pathname === '/api/progress') return sendJson(response, 200, { mastery: state.mastery, notes: state.notes.length, flashcards: state.flashcards.length, sessions: state.sessions });
    if (request.method === 'GET' && url.pathname === '/api/notion/pages') {
      if (session.provider !== 'notion' || !session.accessToken) return sendJson(response, 403, { error: 'Connect Notion before requesting workspace pages' });
      const result = await fetch('https://api.notion.com/v1/search', { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' }, body: JSON.stringify({ page_size: 50 }) });
      if (!result.ok) return sendJson(response, 502, { error: 'Notion pages could not be loaded' });
      const data = await result.json();
      return sendJson(response, 200, { pages: (data.results || []).map(page => ({ id: page.id, title: page.properties?.title?.title?.[0]?.plain_text || page.properties?.Name?.title?.[0]?.plain_text || 'Untitled page' })) });
    }
    if (request.method === 'POST' && url.pathname === '/api/quiz/evaluate') {
      const body = await readBody(request);
      const correct = Boolean(body.correct);
      const topic = String(body.topic || 'General practice');
      const previous = state.mastery[topic] || { mastery: 40, attempts: 0, correct: 0 };
      const attempts = previous.attempts + 1;
      const correctAttempts = previous.correct + (correct ? 1 : 0);
      const mastery = Math.max(0, Math.min(100, Math.round(previous.mastery + (correct ? 8 : -6))));
      state.mastery[topic] = { mastery, attempts, correct: correctAttempts, nextReviewAt: new Date(Date.now() + (correct ? 3 : 1) * 86400000).toISOString() };
      return sendJson(response, 200, { correct, topic, mastery: state.mastery[topic], explanation: correct ? 'Good work. Explain why that answer is correct to strengthen recall.' : 'Not quite. Review the underlying idea, then try a similar question with a hint.' });
    }
    if (request.method === 'POST' && url.pathname === '/api/flashcards/review') {
      const body = await readBody(request);
      const rating = Math.max(1, Math.min(5, Number(body.rating || 3)));
      const intervalDays = rating >= 4 ? Math.min(30, Number(body.intervalDays || 1) * 2) : 1;
      return sendJson(response, 200, { rating, intervalDays, dueAt: new Date(Date.now() + intervalDays * 86400000).toISOString() });
    }
    if (request.method === 'POST' && url.pathname === '/api/plan/generate') {
      const body = await readBody(request);
      const days = Math.max(1, Math.min(90, Number(body.days || 12)));
      const minutes = Math.max(10, Math.min(240, Number(body.minutesPerDay || 45)));
      const weakTopics = Object.entries(state.mastery).filter(([, value]) => value.mastery < 65).map(([topic]) => topic);
      const sessions = Array.from({ length: days }, (_, index) => ({ day: index + 1, minutes, topic: weakTopics[index % Math.max(weakTopics.length, 1)] || 'Review your latest material', activity: index % 2 ? 'active recall' : 'guided practice', reason: weakTopics.length ? 'Prioritizes a topic that needs practice.' : 'Builds a consistent study rhythm.' }));
      return sendJson(response, 200, { sessions, weakTopics });
    }
    return sendJson(response, 404, { error: 'API route not found' });
  } catch (error) {
    console.error('API request failed:', error.message);
    return sendJson(response, 500, { error: 'The request could not be completed safely.' });
  }
}

async function exchangeCode(providerName, code, request) {
  const provider = providers[providerName];
  const body = new URLSearchParams({ client_id: provider.clientId, client_secret: provider.clientSecret, code, redirect_uri: redirectUri(request, providerName), grant_type: 'authorization_code' });
  const isNotion = providerName === 'notion';
  const tokenResponse = await fetch(provider.token, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': isNotion ? 'application/json' : 'application/x-www-form-urlencoded', ...(isNotion ? { Authorization: `Basic ${Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString('base64')}` } : {}) }, body: isNotion ? JSON.stringify(Object.fromEntries(body)) : body });
  if (!tokenResponse.ok) throw new Error('OAuth token exchange failed');
  const token = await tokenResponse.json();
  const userResponse = await fetch(provider.userInfo, { headers: { Accept: 'application/json', Authorization: `Bearer ${token.access_token}`, 'User-Agent': 'StudyPilot OAuth', ...(isNotion ? { 'Notion-Version': '2022-06-28' } : {}) } });
  if (!userResponse.ok) throw new Error('OAuth profile request failed');
  return { profile: await userResponse.json(), accessToken: token.access_token };
}

function userLabel(providerName, profile) {
  return profile.name || profile.login || profile.username || profile.person?.email || profile.email || `${providerName} learner`;
}

function handleOAuthStart(request, response, providerName) {
  const provider = providers[providerName];
  if (!provider.clientId || !provider.clientSecret || provider.clientId.startsWith('your_')) return send(response, 503, `${providerName} OAuth is not configured on the server yet.`);
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, { provider: providerName, createdAt: Date.now() });
  const authorization = new URL(provider.authorize);
  authorization.search = new URLSearchParams({ client_id: provider.clientId, redirect_uri: redirectUri(request, providerName), response_type: 'code', ...(provider.scope ? { scope: provider.scope } : {}), ...(providerName === 'notion' ? { owner: 'user' } : {}), state, ...(providerName === 'google' ? { access_type: 'offline', prompt: 'select_account' } : {}) });
  redirect(response, authorization.toString());
}

async function handleOAuthCallback(request, response, providerName, query) {
  const state = oauthStates.get(query.get('state'));
  oauthStates.delete(query.get('state'));
  if (!state || state.provider !== providerName || Date.now() - state.createdAt > 10 * 60 * 1000) return send(response, 400, 'OAuth session expired. Start sign-in again.');
  if (query.get('error')) return redirect(response, `/?auth_error=${encodeURIComponent(query.get('error_description') || query.get('error'))}`);
  try {
    const identity = await exchangeCode(providerName, query.get('code'), request);
    const profile = identity.profile;
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionId, { provider: providerName, name: userLabel(providerName, profile), email: profile.email || profile.person?.email || '', accessToken: identity.accessToken, createdAt: Date.now() });
    redirect(response, `/?oauth=success&provider=${providerName}`, [`studypilot_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`]);
  } catch (error) {
    console.error(`${providerName} OAuth callback failed`, error.message);
    redirect(response, `/?auth_error=oauth_callback_failed`);
  }
}

function serveFile(request, response) {
  const requested = new URL(request.url, `http://${request.headers.host}`).pathname;
  const filePath = path.join(__dirname, requested === '/' ? 'index.html' : requested);
  if (!filePath.startsWith(__dirname) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(response, 404, 'Not found');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const start = url.pathname.match(/^\/auth\/(google|github|discord|notion)$/);
  const callback = url.pathname.match(/^\/auth\/(google|github|discord|notion)\/callback$/);
  if (request.method === 'GET' && start) return handleOAuthStart(request, response, start[1]);
  if (request.method === 'GET' && callback) return handleOAuthCallback(request, response, callback[1], url.searchParams);
  if (url.pathname.startsWith('/api/')) return handleApi(request, response, url);
  return serveFile(request, response);
});

server.listen(port, () => console.log(`StudyPilot running at http://localhost:${port}`));