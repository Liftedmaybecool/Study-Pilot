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

async function exchangeCode(providerName, code, request) {
  const provider = providers[providerName];
  const body = new URLSearchParams({ client_id: provider.clientId, client_secret: provider.clientSecret, code, redirect_uri: redirectUri(request, providerName), grant_type: 'authorization_code' });
  const isNotion = providerName === 'notion';
  const tokenResponse = await fetch(provider.token, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': isNotion ? 'application/json' : 'application/x-www-form-urlencoded', ...(isNotion ? { Authorization: `Basic ${Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString('base64')}` } : {}) }, body: isNotion ? JSON.stringify(Object.fromEntries(body)) : body });
  if (!tokenResponse.ok) throw new Error('OAuth token exchange failed');
  const token = await tokenResponse.json();
  const userResponse = await fetch(provider.userInfo, { headers: { Accept: 'application/json', Authorization: `Bearer ${token.access_token}`, 'User-Agent': 'StudyPilot OAuth', ...(isNotion ? { 'Notion-Version': '2022-06-28' } : {}) } });
  if (!userResponse.ok) throw new Error('OAuth profile request failed');
  return userResponse.json();
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
    const profile = await exchangeCode(providerName, query.get('code'), request);
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionId, { provider: providerName, name: userLabel(providerName, profile), email: profile.email || '', createdAt: Date.now() });
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
  return serveFile(request, response);
});

server.listen(port, () => console.log(`StudyPilot running at http://localhost:${port}`));