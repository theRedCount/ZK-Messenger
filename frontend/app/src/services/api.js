// src/services/api.js
const BASE = "http://localhost:8000";

function authHeaders({ token, email }) {
  return {
    "Authorization": `Bearer ${token}`,
    "X-User-Email": email
  };
}

// -------- HTTP --------
export async function apiRegister({ email, sign_pub_det_b64, enc_pub_rand_b64, c_master_b64 }) {
  const res = await fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, sign_pub_det_b64, enc_pub_rand_b64, c_master_b64 })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { email, rcpt_id, enc_pub_rand_b64, sign_pub_det_b64 }
}

export async function apiLogin({ token, email }) {
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { ...authHeaders({ token, email }) }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // UserRecord (includes c_master_b64)
}

export async function apiListUsers({ token, email }) {
  const res = await fetch(`${BASE}/users`, { headers: { ...authHeaders({ token, email }) } });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // UserOut[]
}

export async function apiPostMessage({ token, email, envelope }) {
  const res = await fetch(`${BASE}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders({ token, email }) },
    body: JSON.stringify(envelope)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiFetchInbox({ token, email, rcpt_id }) {
  const url = new URL(`${BASE}/inbox`);
  url.searchParams.set("rcpt_id", rcpt_id);
  const res = await fetch(url.toString(), { headers: { ...authHeaders({ token, email }) } });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // EnvelopeStored[]
}

// -------- WebSocket --------
export function connectInboxWS({ token, email, onInit, onEnvelope, onClose }) {
  const wsUrl = `${BASE.replace("http", "ws")}/ws/inbox?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === "inbox.init") onInit?.(msg.data);
    else if (msg.type === "envelope") onEnvelope?.(msg.data);
  };
  ws.onclose = () => onClose?.();
  ws.onopen = () => ws.send("ping");
  ws.onerror = () => {};
  return ws;
}
