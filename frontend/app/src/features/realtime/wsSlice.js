// src/features/realtime/wsSlice.js
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import sodium from "libsodium-wrappers";
import { ed25519 } from "@noble/curves/ed25519";
import { connectInboxWS } from "../../services/api";
import { signJWS } from "../../lib/jws";
import { getRuntimeKeys } from "../../lib/runtime";
import { addLog } from "../logs/logSlice";
import { appendIncomingBatch, appendIncomingOne } from "../chat/chatSlice";

const te = new TextEncoder();
let socket = null;
let keepaliveId = null;
let reconnectTimer = null;
let lastParams = null;   // { email, rcpt_id }
let attempts = 0;

const b64 = (u8) => sodium.to_base64(u8);

async function decryptEnvelope(env, runtime) {
  await sodium.ready;
  const eph_pub = sodium.from_base64(env.eph_pub_b64);
  const shared = sodium.crypto_box_beforenm(eph_pub, runtime.xPriv);
  const nonce = sodium.from_base64(env.nonce_b64);
  const ct = sodium.from_base64(env.ct_b64);
  const payload = sodium.crypto_box_open_easy_afternm(ct, nonce, shared);
  if (!payload) throw new Error("Decryption failed");
  const { body_b64, sig_b64 } = JSON.parse(new TextDecoder().decode(payload));
  const bodyBytes = sodium.from_base64(body_b64);
  const sigBytes = sodium.from_base64(sig_b64);
  const bodyObj = JSON.parse(new TextDecoder().decode(bodyBytes));
  const ctxBytes = te.encode("ctx:v1|rcpt=" + b64(getRuntimeKeys().xPub) + "|eph=" + env.eph_pub_b64);
  const toVerify = new Uint8Array(bodyBytes.length + ctxBytes.length);
  toVerify.set(bodyBytes, 0); toVerify.set(ctxBytes, bodyBytes.length);
  const sender_ed_pub = sodium.from_base64(bodyObj.sender_pub_ed_b64);
  const ok = ed25519.verify(sigBytes, toVerify, sender_ed_pub);
  return {
    ok,
    from: bodyObj.sender_email || "(unknown)",
    ts: bodyObj.ts_client,
    msg_id: bodyObj.msg_id,
    text: bodyObj.message,
    direction: "in"
  };
}

function clearTimers() {
  if (keepaliveId) { clearInterval(keepaliveId); keepaliveId = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function scheduleReconnect(dispatch) {
  clearTimers();
  attempts = Math.min(attempts + 1, 6); // cap backoff
  const delay = Math.pow(2, attempts) * 500; // 0.5s,1s,2s,4s,8s,16s,...
  reconnectTimer = setTimeout(() => {
    if (lastParams) dispatch(startInboxWS(lastParams));
  }, delay);
}

export const startInboxWS = createAsyncThunk(
  "ws/startInboxWS",
  async ({ email, rcpt_id }, { dispatch, rejectWithValue }) => {
    try {
      if (!email || !rcpt_id) throw new Error("Missing email/rcpt_id");
      lastParams = { email, rcpt_id };

      // close previous
      try { socket?.close(); } catch {}
      socket = null;
      clearTimers();
      attempts = 0;

      const token = signJWS({ email, act: "ws.open", extra: { rcpt_id } });
      const runtime = getRuntimeKeys();

      socket = connectInboxWS({
        token, email,
        onInit: async (envelopes) => {
          const msgs = [];
          for (const env of envelopes) {
            try { msgs.push(await decryptEnvelope(env, runtime)); } catch {}
          }
          if (msgs.length) {
            dispatch(appendIncomingBatch(msgs));
            dispatch(addLog({ level: "info", msg: "WS init processed", data: { count: msgs.length } }));
          }
        },
        onEnvelope: async (env) => {
          try {
            const m = await decryptEnvelope(env, runtime);
            dispatch(appendIncomingOne(m));
          } catch (e) {
            dispatch(addLog({ level: "warn", msg: "WS envelope decrypt failed", data: { error: String(e) } }));
          }
        },
        onClose: () => {
          dispatch(setConnected(false));
          dispatch(addLog({ level: "info", msg: "WS closed" }));
          scheduleReconnect(dispatch);
        }
      });

      // keepalive (client → server) ogni 20s
      keepaliveId = setInterval(() => {
        try { socket?.readyState === 1 && socket.send("ping"); } catch {}
      }, 20000);

      dispatch(setConnected(true));
      dispatch(addLog({ level: "info", msg: "WS connected", data: { email, rcpt_id } }));
      return true;
    } catch (e) {
      dispatch(addLog({ level: "error", msg: "WS connect failed", data: { error: String(e) } }));
      scheduleReconnect(dispatch);
      return rejectWithValue(String(e));
    }
  }
);

export const stopInboxWS = createAsyncThunk("ws/stopInboxWS", async () => {
  try { socket?.close(); } catch {}
  socket = null;
  clearTimers();
  attempts = 0;
  lastParams = null;
  return true;
});

const wsSlice = createSlice({
  name: "ws",
  initialState: { connected: false },
  reducers: {
    setConnected(state, action) { state.connected = !!action.payload; }
  },
  extraReducers: (b) => {
    b.addCase(startInboxWS.fulfilled, (s) => { s.connected = true; });
    b.addCase(startInboxWS.rejected, (s) => { s.connected = false; });
    b.addCase(stopInboxWS.fulfilled, (s) => { s.connected = false; });
  }
});

export const { setConnected } = wsSlice.actions;
export default wsSlice.reducer;
