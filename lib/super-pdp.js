const apiBaseUrl = () => String(process.env.SUPER_PDP_API_BASE_URL || 'https://api.superpdp.tech/v1.beta').replace(/\/$/, '');
const tokenUrl = () => String(process.env.SUPER_PDP_TOKEN_URL || 'https://api.superpdp.tech/oauth2/token');

let cachedToken = null;

function credentials() {
  const clientId = String(process.env.SUPER_PDP_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.SUPER_PDP_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('Configurez SUPER_PDP_CLIENT_ID et SUPER_PDP_CLIENT_SECRET dans .env.');
  return { clientId, clientSecret };
}

async function request(url, options, label) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = typeof body === 'string' ? body : body?.error_description || body?.message || body?.error;
    throw new Error(`${label} a échoué (${response.status})${detail ? ` : ${detail}` : ''}`);
  }
  return body;
}

export function superPdpConfigured() {
  return Boolean(String(process.env.SUPER_PDP_CLIENT_ID || '').trim() && String(process.env.SUPER_PDP_CLIENT_SECRET || '').trim());
}

export async function superPdpAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const { clientId, clientSecret } = credentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const data = await request(tokenUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  }, 'L’authentification SUPER PDP');
  if (!data?.access_token) throw new Error('SUPER PDP n’a pas renvoyé de jeton d’accès.');
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(30, Number(data.expires_in || 300) - 30) * 1000
  };
  return cachedToken.value;
}

async function api(path, label) {
  const token = await superPdpAccessToken();
  return request(`${apiBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  }, label);
}

export async function superPdpSession() {
  return api('/oauth2_sessions/me', 'La vérification SUPER PDP');
}

export async function superPdpRecipient(siren) {
  const number = String(siren || '').replace(/\s/g, '');
  if (!/^\d{9}$/.test(number)) throw new Error('Le SIREN destinataire doit contenir 9 chiffres.');
  return api(`/french_directory/entries?number=${encodeURIComponent(number)}`, 'La recherche annuaire SUPER PDP');
}
