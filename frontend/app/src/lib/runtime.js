// src/lib/runtime.js
// Non-serializable runtime keys kept in module memory.
let runtime = null; // { edPriv, edPub, xPriv, xPub }

export function setRuntimeKeys(k) {
  runtime = k;
}
export function getRuntimeKeys() {
  if (!runtime) throw new Error("Runtime keys not available. Login first.");
  return runtime;
}
export function clearRuntimeKeys() {
  runtime = null;
}
