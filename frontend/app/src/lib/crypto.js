// src/lib/crypto.js
import sodium from "libsodium-wrappers";
import { ed25519, x25519 } from "@noble/curves/ed25519";

const te = new TextEncoder();

const toUint8 = (buf) => (buf instanceof Uint8Array ? buf : new Uint8Array(buf));

export async function readySodium() {
  if (!sodium.ready) {
    await sodium.ready;
  }
}

export async function sha256Bytes(text) {
  const buf = await crypto.subtle.digest("SHA-256", te.encode(text));
  return new Uint8Array(buf);
}

export async function emailToSalt(email) {
  const norm = email.trim().toLowerCase();
  const h = await sha256Bytes(norm);
  return h.slice(0, 16);
}

export async function hkdf32(ikmBytes, infoLabel, saltStr = "hkdf-salt:v1") {
  const key = await crypto.subtle.importKey("raw", toUint8(ikmBytes), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: te.encode(saltStr), info: te.encode(infoLabel) },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function deriveDeterministic(
  email,
  password,
  { time = 3, memMiB = 64, parallelism = Math.min(4, navigator.hardwareConcurrency || 2) } = {}
) {
  if (!password || password.length < 12) throw new Error("Password must be at least 12 characters.");
  const salt = await emailToSalt(email);
  const { hash } = await window.argon2.hash({
    pass: password,
    salt,
    type: window.argon2.ArgonType.Argon2id,
    time,
    mem: memMiB * 1024,
    parallelism,
    hashLen: 32
  });

  const master = new Uint8Array(hash);
  const edSeed = await hkdf32(master, "ed25519-seed:v1");
  const xSeed = await hkdf32(master, "x25519-seed:v1");

  const edPriv = edSeed;
  const edPub = ed25519.getPublicKey(edPriv);

  const xPriv = xSeed;
  const xPub = x25519.getPublicKey(xPriv);

  return { edPriv, edPub, xPriv, xPub, detSalt: salt, master };
}

export async function deriveRegistrationRandom(
  { time = 3, memMiB = 64, parallelism = Math.min(4, navigator.hardwareConcurrency || 2) } = {}
) {
  const ikm = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const { hash } = await window.argon2.hash({
    pass: ikm,
    salt,
    type: window.argon2.ArgonType.Argon2id,
    time,
    mem: memMiB * 1024,
    parallelism,
    hashLen: 32
  });

  const master = new Uint8Array(hash);
  const edSeed = await hkdf32(master, "ed25519-seed:rand:v1");
  const xSeed = await hkdf32(master, "x25519-seed:rand:v1");

  const edPriv = edSeed;
  const edPub = ed25519.getPublicKey(edPriv);

  const xPriv = xSeed;
  const xPub = x25519.getPublicKey(xPriv);

  return { master, ikm, salt, edPriv, edPub, xPriv, xPub };
}

export function toBase64(u8) {
  return sodium.to_base64(u8);
}

export function fromBase64(b64) {
  return sodium.from_base64(b64);
}

export function sealToX25519Pub(plaintextU8, x25519Pub32) {
  const c = sodium.crypto_box_seal(plaintextU8, x25519Pub32);
  return c;
}

// NEW: open sealed master with deterministic X25519 keypair
export function unsealMasterWithDet(c_master_b64, det) {
  const c = fromBase64(c_master_b64);
  const opened = sodium.crypto_box_seal_open(c, det.xPub, det.xPriv);
  if (!opened) throw new Error("Failed to open c_master (wrong credentials).");
  return opened;
}

// NEW: derive runtime messaging keys from master_random
export async function deriveRuntimeFromMaster(master_random) {
  const edSeed = await hkdf32(master_random, "ed25519-seed:rand:v1");
  const xSeed = await hkdf32(master_random, "x25519-seed:rand:v1");
  const edPriv = edSeed;
  const edPub = ed25519.getPublicKey(edPriv);
  const xPriv = xSeed;
  const xPub = x25519.getPublicKey(xPriv);
  return { edPriv, edPub, xPriv, xPub };
}
