const crypto = require('crypto');

const SESSION_COOKIE = 'postopz_console_access';
const securityHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
};

function textResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8', ...headers },
    body
  };
}

function unauthorized() {
  return textResponse(401, 'Authentication is required.', {
    'WWW-Authenticate': 'Basic realm="PostOpz Console", charset="UTF-8"'
  });
}

function credentialsMatch(value, expected) {
  const received = Buffer.from(value, 'utf8');
  const required = Buffer.from(expected, 'utf8');
  return received.length === required.length && crypto.timingSafeEqual(received, required);
}

function getAuthorization(headers) {
  return headers.authorization || headers.Authorization || '';
}

function readCookies(headers) {
  return (headers.cookie || headers.Cookie || '').split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return cookies;
    cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
    return cookies;
  }, {});
}

function parseForm(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  return Object.fromEntries(new URLSearchParams(raw));
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function supabaseRequest(config, path, options = {}) {
  const headers = {
    apikey: config.key,
    ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${config.url}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  return { ok: response.ok, status: response.status, data };
}

async function signIn(config, email, password) {
  try {
    const result = await supabaseRequest(config, '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    return result.ok && result.data && result.data.access_token ? result.data : null;
  } catch (_) {
    return null;
  }
}

async function currentUser(config, accessToken) {
  if (!accessToken) return null;
  try {
    const result = await supabaseRequest(config, '/auth/v1/user', { accessToken });
    return result.ok && result.data && result.data.id ? result.data : null;
  } catch (_) {
    return null;
  }
}

async function dashboardData(config, accessToken) {
  try {
    const requests = await Promise.all([
      supabaseRequest(config, '/rest/v1/organizations?select=id,name,slug&order=name', { accessToken }),
      supabaseRequest(config, '/rest/v1/productions?select=id,name,status&order=updated_at.desc&limit=8', { accessToken }),
      supabaseRequest(config, '/rest/v1/integration_connections?select=id,provider,status&order=provider', { accessToken }),
      supabaseRequest(config, '/rest/v1/activity_items?select=id,title,detail,severity,occurred_at&order=occurred_at.desc&limit=8', { accessToken }),
      supabaseRequest(config, '/rest/v1/archive_recommendations?select=id,status,estimated_bytes,confidence&order=created_at.desc&limit=8', { accessToken })
    ]);

    return {
      organizations: requests[0].ok ? requests[0].data : [],
      productions: requests[1].ok ? requests[1].data : [],
      integrations: requests[2].ok ? requests[2].data : [],
      activity: requests[3].ok ? requests[3].data : [],
      recommendations: requests[4].ok ? requests[4].data : []
    };
  } catch (_) {
    return { organizations: [], productions: [], integrations: [], activity: [], recommendations: [] };
  }
}

function loginPage(notice = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><title>PostOpz Console — Sign in</title><style>
  :root{color-scheme:dark;--bg:#05070b;--panel:#111827;--line:rgba(255,255,255,.12);--text:#f7f9fe;--muted:#a7afbe;--cyan:#00d9ff;--blue:#1976ff;--danger:#ff8d8d}*{box-sizing:border-box}body{margin:0;min-width:320px;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 84% 0,rgba(25,118,255,.2),transparent 30rem),var(--bg);color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(440px,calc(100% - 32px));padding:32px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(180deg,rgba(23,31,47,.96),rgba(10,13,20,.98));box-shadow:0 24px 80px rgba(0,0,0,.35)}.brand{display:flex;align-items:center;gap:11px;font-weight:800}.mark{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;background:linear-gradient(135deg,var(--blue),#7c3cff);font-size:.76rem}.badge{margin-left:auto;padding:4px 8px;border:1px solid rgba(0,217,255,.4);border-radius:999px;color:var(--cyan);font-size:.67rem;font-weight:800;letter-spacing:.08em}h1{margin:30px 0 8px;font-size:1.8rem;letter-spacing:-.04em}p{color:var(--muted)}label{display:block;margin:18px 0 6px;font-size:.84rem;font-weight:700}input{width:100%;border:1px solid var(--line);border-radius:10px;padding:12px;background:#090d15;color:var(--text);font:inherit}button{width:100%;margin-top:24px;padding:12px;border:0;border-radius:10px;background:linear-gradient(135deg,var(--blue),#7c3cff);color:white;font:700 15px inherit;cursor:pointer}.notice{margin:16px 0 0;padding:10px 12px;border:1px solid rgba(255,141,141,.35);border-radius:10px;background:rgba(255,141,141,.08);color:var(--danger);font-size:.88rem}.foot{margin-top:22px;font-size:.8rem}.foot b{color:var(--cyan)}</style></head>
<body><main class="card"><div class="brand"><span class="mark">PZ</span><span>PostOpz Console</span><span class="badge">INTERNAL ALPHA</span></div><h1>Operator sign in</h1><p>Use your Console account. This is a second, organization-level check behind the private access gate.</p><form method="post" action="/console"><input type="hidden" name="action" value="sign_in"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Sign in to Console</button></form>${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}<p class="foot"><b>Access is invite-only.</b> Ask a Console administrator to create your account and workspace role.</p></main></body></html>`;
}

function dashboardPage(user, dashboard) {
  const healthy = dashboard.integrations.filter((item) => item.status === 'healthy').length;
  const ready = dashboard.recommendations.filter((item) => item.status === 'ready_for_review').length;
  const activity = dashboard.activity.length
    ? dashboard.activity.map((item) => `<li><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.detail || item.severity)} · ${new Date(item.occurred_at).toLocaleString()}</span></li>`).join('')
    : '<div class="empty"><strong>No operational events yet</strong>Connect a read-only provider after setup is complete.</div>';
  const workspaceMessage = dashboard.organizations.length
    ? escapeHtml(dashboard.organizations.map((organization) => organization.name).join(', '))
    : 'No workspace is assigned to this account yet.';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><title>PostOpz Console — Internal Alpha</title><style>
  :root{color-scheme:dark;--bg:#05070b;--panel:#111827;--line:rgba(255,255,255,.1);--text:#f7f9fe;--muted:#a7afbe;--cyan:#00d9ff;--blue:#1976ff;--green:#59ffb2;--amber:#ffbf4a}*{box-sizing:border-box}body{margin:0;min-width:320px;background:radial-gradient(circle at 84% 0,rgba(25,118,255,.18),transparent 30rem),var(--bg);color:var(--text);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shell{width:min(1440px,calc(100% - 40px));margin:0 auto;padding:28px 0 54px}header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:26px;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:1.16rem}.mark{width:31px;height:31px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(135deg,var(--blue),#7c3cff);font-size:.8rem}.badge{padding:5px 9px;border:1px solid rgba(0,217,255,.4);border-radius:999px;color:var(--cyan);background:rgba(0,217,255,.08);font-size:.7rem;font-weight:800;letter-spacing:.08em}.account{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:.82rem}.account form{margin:0}.account button{border:1px solid var(--line);border-radius:8px;padding:7px 10px;background:transparent;color:var(--text);font:inherit;cursor:pointer}main{padding-top:42px}h1{max-width:790px;margin:0;font-size:clamp(2rem,4vw,3.7rem);line-height:1.04;letter-spacing:-.055em}.lead{max-width:760px;margin:18px 0 36px;color:var(--muted);font-size:1.05rem}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.card,.panel{border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,rgba(23,31,47,.95),rgba(12,16,25,.96));box-shadow:0 18px 60px rgba(0,0,0,.2)}.card{min-height:145px;padding:20px}.eyebrow{color:var(--muted);font-size:.72rem;font-weight:750;letter-spacing:.09em;text-transform:uppercase}.metric{margin:14px 0 5px;font-size:1.45rem;font-weight:800;letter-spacing:-.04em}.detail{margin:0;color:var(--muted);font-size:.88rem}.status{display:inline-flex;align-items:center;gap:7px;color:var(--amber);font-size:.88rem;font-weight:700}.dot{width:7px;height:7px;border-radius:50%;background:currentColor}.columns{display:grid;grid-template-columns:1.35fr .85fr;gap:16px;margin-top:16px}.panel{padding:24px}h2{margin:0 0 4px;font-size:1.1rem;letter-spacing:-.025em}.subhead{margin:0 0 20px;color:var(--muted);font-size:.88rem}.empty{display:grid;place-items:center;min-height:220px;border:1px dashed rgba(255,255,255,.18);border-radius:13px;color:var(--muted);text-align:center;padding:28px}.empty strong{display:block;margin-bottom:5px;color:var(--text)}ul{list-style:none;padding:0;margin:0}li{display:grid;gap:3px;padding:14px 0;border-top:1px solid var(--line)}li:first-child{border-top:0}li b{font-size:.92rem}li span{color:var(--muted);font-size:.83rem}.guard{display:flex;gap:11px;margin-top:16px;padding:15px;border:1px solid rgba(89,255,178,.26);border-radius:13px;background:rgba(89,255,178,.06);color:var(--muted);font-size:.86rem}.guard b{color:var(--green)}@media(max-width:960px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.columns{grid-template-columns:1fr}}@media(max-width:560px){.shell{width:min(100% - 28px,1440px);padding-top:20px}.account{align-items:flex-end;flex-direction:column}.grid{grid-template-columns:1fr}}</style></head>
<body><div class="shell"><header><div class="brand"><span class="mark">PZ</span><span>PostOpz Console</span><span class="badge">INTERNAL ALPHA</span></div><div class="account"><span>${escapeHtml(user.email || 'Console operator')}</span><form method="post" action="/console"><input type="hidden" name="action" value="sign_out"><button type="submit">Sign out</button></form></div></header><main><h1>Operational visibility, safely staged.</h1><p class="lead">Workspace: ${workspaceMessage}</p><section class="grid"><article class="card"><p class="eyebrow">Integrations</p><p class="metric">${healthy} of 8 healthy</p><p class="detail">Read-only source setup is pending.</p></article><article class="card"><p class="eyebrow">Productions</p><p class="metric">${dashboard.productions.length}</p><p class="detail">Visible through organization access rules.</p></article><article class="card"><p class="eyebrow">Archive candidates</p><p class="metric">${ready}</p><p class="detail">Ready for operator review.</p></article><article class="card"><p class="eyebrow">Migration execution</p><p class="metric"><span class="status"><span class="dot"></span>Disabled</span></p><p class="detail">No job can delete source media.</p></article></section><section class="columns"><article class="panel"><h2>Activity</h2><p class="subhead">Normalized events from authorized sources.</p>${dashboard.activity.length ? `<ul>${activity}</ul>` : activity}</article><article class="panel"><h2>Alpha safeguards</h2><p class="subhead">Every future action is constrained by the data model and role policy.</p><ul><li><b>Read-only integrations first</b><span>Credentials are referenced outside the database, never stored in event data.</span></li><li><b>Approval before execution</b><span>Only approvers can authorize a migration proposal.</span></li><li><b>Verification and hold</b><span>Jobs are limited to copy → verify → register → hold.</span></li></ul></article></section><aside class="guard"><div><b>Source-media safeguard:</b> this alpha has no source-deletion capability in its interface, data model, or job state machine.</div></aside></main></div></body></html>`;
}

function responsePage(body, headers = {}) {
  return { statusCode: 200, headers: { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8', ...headers }, body };
}

exports.handler = async (event) => {
  const expectedPassword = process.env.POSTOPZ_CONSOLE_ALPHA_PASSWORD;
  if (!expectedPassword) return textResponse(503, 'PostOpz Console has not been configured.');

  const authorization = getAuthorization(event.headers || {});
  if (!authorization.startsWith('Basic ')) return unauthorized();

  let decoded;
  try { decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8'); } catch (_) { return unauthorized(); }
  const separator = decoded.indexOf(':');
  if (separator < 0) return unauthorized();
  if (!credentialsMatch(decoded.slice(0, separator), 'operator') || !credentialsMatch(decoded.slice(separator + 1), expectedPassword)) return unauthorized();

  const config = supabaseConfig();
  if (!config) return responsePage(loginPage('Console is waiting for its Supabase connection values.'));

  if (event.httpMethod === 'POST') {
    const form = parseForm(event);
    if (form.action === 'sign_out') {
      return { statusCode: 303, headers: { ...securityHeaders, Location: '/console', 'Set-Cookie': `${SESSION_COOKIE}=; Path=/console; HttpOnly; Secure; SameSite=Lax; Max-Age=0` }, body: '' };
    }
    if (form.action === 'sign_in') {
      const session = await signIn(config, String(form.email || '').trim(), String(form.password || ''));
      if (!session) return responsePage(loginPage('We could not sign in with those details.'));
      return { statusCode: 303, headers: { ...securityHeaders, Location: '/console', 'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(session.access_token)}; Path=/console; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(60, Number(session.expires_in || 3600))}` }, body: '' };
    }
    return textResponse(400, 'Unsupported Console action.');
  }

  const accessToken = readCookies(event.headers || {})[SESSION_COOKIE];
  const user = await currentUser(config, accessToken);
  if (!user) return responsePage(loginPage());

  const dashboard = await dashboardData(config, accessToken);
  return responsePage(dashboardPage(user, dashboard));
};
