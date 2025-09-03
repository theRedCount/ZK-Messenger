// src/lib/jws.js
import { ed25519 } from "@noble/curves/ed25519";
import { getDeterministicKeys } from "./runtime";

const te = new TextEncoder();

function base64UrlFromBytes(u8) {
  const b64 = btoa(String.fromCharCode(...u8));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlFromString(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function uuid4() {
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  rnd[6] = (rnd[6] & 0x0f) | 0x40;
  rnd[8] = (rnd[8] & 0x3f) | 0x80;
  const hex = [...rnd].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/**
 * Create EdDSA (Ed25519) compact JWS.
 * Header: { alg:"EdDSA", kid: email, typ:"JWT" }
 * Payload: { sub, act, iat, exp, jti, ...extra }
 */
export function signJWS({ email, act, extra = {}, ttlSec = 300 }) {
  const { edPriv } = getDeterministicKeys();
  const header = { alg: "EdDSA", kid: email, typ: "JWT" };
  const iat = nowSec();
  const exp = iat + ttlSec;
  const payload = { sub: email, act, iat, exp, jti: uuid4(), ...extra };

  const headerB64 = base64UrlFromString(JSON.stringify(header));
  const payloadB64 = base64UrlFromString(JSON.stringify(payload));
  const signingInput = te.encode(`${headerB64}.${payloadB64}`);

  const sig = ed25519.sign(signingInput, edPriv);           // Uint8Array(64)
  const sigB64 = base64UrlFromBytes(sig);                   // <-- NO doppia base64

  return `${headerB64}.${payloadB64}.${sigB64}`;
}
