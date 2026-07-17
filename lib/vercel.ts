import "server-only";

// API de Vercel para gestionar los dominios propios de cada salón.
const BASE = "https://api.vercel.com";

function url(path: string) {
  return `${BASE}${path}?teamId=${process.env.VERCEL_TEAM_ID}`;
}

async function vfetch(path: string, init?: RequestInit) {
  const res = await fetch(url(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

export async function addDomainToProject(domain: string) {
  const r = await vfetch(`/v10/projects/${process.env.VERCEL_PROJECT_ID}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
  // 409 = ya estaba añadido a este proyecto: para nosotros es éxito
  if (!r.ok && r.status !== 409) {
    throw new Error(r.body?.error?.code ?? `vercel_${r.status}`);
  }
}

export async function removeDomainFromProject(domain: string) {
  await vfetch(`/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains/${domain}`, {
    method: "DELETE",
  });
}

// verified = Vercel aceptó el dominio; configured = el DNS ya apunta bien.
export async function domainStatus(domain: string) {
  const [d, cfg] = await Promise.all([
    vfetch(`/v9/projects/${process.env.VERCEL_PROJECT_ID}/domains/${domain}`),
    vfetch(`/v6/domains/${domain}/config`),
  ]);
  return {
    exists: d.ok,
    verified: d.ok && d.body?.verified === true,
    configured: cfg.ok && cfg.body?.misconfigured === false,
    // TXT u otros retos que Vercel pida (dominio usado en otra cuenta, etc.)
    verification: (d.body?.verification ?? []) as { type: string; domain: string; value: string }[],
  };
}
