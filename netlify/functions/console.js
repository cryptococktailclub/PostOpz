const crypto = require('crypto');

const securityHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive'
};

function unauthorized() {
  return {
    statusCode: 401,
    headers: {
      ...securityHeaders,
      'Content-Type': 'text/plain; charset=utf-8',
      'WWW-Authenticate': 'Basic realm="PostOpz Console", charset="UTF-8"'
    },
    body: 'Authentication is required.'
  };
}

function credentialsMatch(value, expected) {
  const received = Buffer.from(value, 'utf8');
  const required = Buffer.from(expected, 'utf8');

  if (received.length !== required.length) return false;
  return crypto.timingSafeEqual(received, required);
}

function getAuthorization(headers) {
  return headers.authorization || headers.Authorization || '';
}

function page() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow, noarchive">
    <title>PostOpz Console — Internal Alpha</title>
    <style>
      :root { color-scheme: dark; --bg:#05070b; --panel:#111827; --panel-2:#171f2f; --line:rgba(255,255,255,.11); --text:#f7f9fe; --muted:#a7afbe; --cyan:#00d9ff; --blue:#1976ff; --green:#59ffb2; --amber:#ffbf4a; }
      * { box-sizing:border-box; }
      body { margin:0; min-width:320px; background:radial-gradient(circle at 84% 0,rgba(25,118,255,.18),transparent 30rem),var(--bg); color:var(--text); font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
      .shell { width:min(1440px,calc(100% - 40px)); margin:0 auto; padding:28px 0 54px; }
      header { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:0 0 26px; border-bottom:1px solid var(--line); }
      .brand { display:flex; align-items:center; gap:12px; font-weight:800; font-size:1.16rem; letter-spacing:-.02em; }
      .mark { width:31px; height:31px; border-radius:9px; display:grid; place-items:center; background:linear-gradient(135deg,var(--blue),#7c3cff); color:white; font-size:.8rem; }
      .badge { display:inline-flex; padding:5px 9px; border:1px solid rgba(0,217,255,.4); border-radius:999px; color:var(--cyan); background:rgba(0,217,255,.08); font-size:.7rem; font-weight:800; letter-spacing:.08em; }
      .version { color:var(--muted); font-size:.82rem; }
      main { padding-top:42px; }
      h1 { max-width:790px; margin:0; font-size:clamp(2rem,4vw,3.7rem); line-height:1.04; letter-spacing:-.055em; }
      .lead { max-width:720px; margin:18px 0 36px; color:var(--muted); font-size:1.05rem; }
      .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; }
      .card, .panel { border:1px solid var(--line); border-radius:18px; background:linear-gradient(180deg,rgba(23,31,47,.95),rgba(12,16,25,.96)); box-shadow:0 18px 60px rgba(0,0,0,.2); }
      .card { min-height:150px; padding:20px; }
      .eyebrow { color:var(--muted); font-size:.72rem; font-weight:750; letter-spacing:.09em; text-transform:uppercase; }
      .metric { margin:14px 0 5px; font-size:1.4rem; font-weight:800; letter-spacing:-.04em; }
      .detail { margin:0; color:var(--muted); font-size:.88rem; }
      .status { display:inline-flex; align-items:center; gap:7px; color:var(--amber); font-size:.82rem; font-weight:700; }
      .dot { width:7px; height:7px; border-radius:50%; background:currentColor; }
      .columns { display:grid; grid-template-columns:1.35fr .85fr; gap:16px; margin-top:16px; }
      .panel { padding:24px; }
      h2 { margin:0 0 4px; font-size:1.1rem; letter-spacing:-.025em; }
      .subhead { margin:0 0 20px; color:var(--muted); font-size:.88rem; }
      .empty { display:grid; place-items:center; min-height:248px; border:1px dashed rgba(255,255,255,.18); border-radius:13px; color:var(--muted); text-align:center; padding:28px; }
      .empty strong { display:block; margin-bottom:5px; color:var(--text); }
      .steps { list-style:none; padding:0; margin:0; }
      .steps li { display:flex; gap:12px; padding:15px 0; border-top:1px solid var(--line); }
      .steps li:first-child { border-top:0; }
      .number { flex:0 0 auto; width:25px; height:25px; border-radius:50%; display:grid; place-items:center; background:rgba(25,118,255,.16); color:var(--cyan); font-size:.75rem; font-weight:800; }
      .steps strong { display:block; font-size:.9rem; }
      .steps span { color:var(--muted); font-size:.84rem; }
      .guard { display:flex; align-items:flex-start; gap:11px; margin-top:16px; padding:15px; border:1px solid rgba(89,255,178,.26); border-radius:13px; background:rgba(89,255,178,.06); color:var(--muted); font-size:.86rem; }
      .guard b { color:var(--green); }
      @media (max-width:960px) { .grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .columns { grid-template-columns:1fr; } }
      @media (max-width:560px) { .shell { width:min(100% - 28px,1440px); padding-top:20px; } header { align-items:flex-start; } .version { display:none; } .grid { grid-template-columns:1fr; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <div class="brand"><span class="mark">PZ</span><span>PostOpz Console</span><span class="badge">Internal Alpha</span></div>
        <span class="version">Foundation v0.1</span>
      </header>
      <main>
        <h1>Operational visibility, safely staged.</h1>
        <p class="lead">Console is ready for its secure data layer. This private foundation exposes no production data until authenticated integrations and Supabase are configured.</p>
        <section class="grid" aria-label="Console readiness">
          <article class="card"><p class="eyebrow">Integrations</p><p class="metric">0 of 8 connected</p><p class="detail">Read-only source setup is pending.</p></article>
          <article class="card"><p class="eyebrow">Production signals</p><p class="metric">Awaiting data model</p><p class="detail">Supabase has not been connected.</p></article>
          <article class="card"><p class="eyebrow">Storage intelligence</p><p class="metric">No inventory yet</p><p class="detail">No cloud storage is being read.</p></article>
          <article class="card"><p class="eyebrow">Migration execution</p><p class="metric"><span class="status"><span class="dot"></span>Disabled</span></p><p class="detail">Approval jobs are unavailable by design.</p></article>
        </section>
        <section class="columns">
          <article class="panel"><h2>Activity</h2><p class="subhead">Normalized events will appear here once a source is connected.</p><div class="empty"><div><strong>No operational events yet</strong>Connect a read-only provider after Supabase and access controls are in place.</div></div></article>
          <article class="panel"><h2>Safe alpha sequence</h2><p class="subhead">The Console will only gain capability after each safeguard is verified.</p><ol class="steps"><li><span class="number">1</span><div><strong>Provision identity and data</strong><span>Supabase Auth, organization-scoped RLS, audit history.</span></div></li><li><span class="number">2</span><div><strong>Connect read-only sources</strong><span>Index events and storage inventory without mutation permissions.</span></div></li><li><span class="number">3</span><div><strong>Validate recommendations</strong><span>Show evidence and versioned cost assumptions before approval workflows.</span></div></li></ol></article>
        </section>
        <aside class="guard"><div><b>Source-media safeguard:</b> this alpha has no source-deletion capability. The eventual execution flow is copy → verify → register → hold; deletion remains disabled.</div></aside>
      </main>
    </div>
  </body>
</html>`;
}

exports.handler = async (event) => {
  const expectedPassword = process.env.POSTOPZ_CONSOLE_ALPHA_PASSWORD;

  // Do not accidentally publish an unprotected Console while Netlify has not
  // received the secret yet.
  if (!expectedPassword) {
    return {
      statusCode: 503,
      headers: { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'PostOpz Console has not been configured.'
    };
  }

  const authorization = getAuthorization(event.headers || {});
  if (!authorization.startsWith('Basic ')) return unauthorized();

  let decoded;
  try {
    decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  } catch (_) {
    return unauthorized();
  }

  const separator = decoded.indexOf(':');
  if (separator < 0) return unauthorized();

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  if (!credentialsMatch(username, 'operator') || !credentialsMatch(password, expectedPassword)) {
    return unauthorized();
  }

  return {
    statusCode: 200,
    headers: { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    body: page()
  };
};
