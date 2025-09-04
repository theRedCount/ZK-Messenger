// src/features/chat/chatSlice.js
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { addLog } from "../logs/logSlice";
import sodium from "libsodium-wrappers";
import { ed25519 } from "@noble/curves/ed25519";
import { getRuntimeKeys } from "../../lib/runtime";
import { apiPostMessage, apiFetchInbox, apiListUsers } from "../../services/api";
import { signJWS } from "../../lib/jws";

const te = new TextEncoder();
const VERBOSE_LOGS = true;
const truncate = (s, max = 64) =>
  typeof s === "string" && s.length > max ? s.slice(0, max) + `…(${s.length})` : s;
const b64 = (u8) => sodium.to_base64(u8);

async function getRecipientByRcptId({ token, email, rcptId }) {
  const users = await apiListUsers({ token, email });
  return users.find(u => u.rcpt_id === rcptId) || null;
}

// --- Send message (sealed sender) ---
export const sendMessage = createAsyncThunk(
  "chat/sendMessage",
  async ({ toRcptId, text }, { getState, dispatch, rejectWithValue }) => {
    try {
      await sodium.ready;
      const { auth } = getState();
      if (!auth.session) throw new Error("Not logged in");
      const senderEmail = auth.session.email;

      const tokenList = signJWS({ email: senderEmail, act: "users.list" });
      const rec = await getRecipientByRcptId({ token: tokenList, email: senderEmail, rcptId: toRcptId });
      if (!rec) throw new Error("Recipient not found");

      const runtime = getRuntimeKeys();

      if (VERBOSE_LOGS) {
        dispatch(addLog({
          level: "debug",
          msg: "Preparing sealed sender",
          data: {
            from_email: senderEmail,
            to_rcpt_id: rec.rcpt_id,
            to_enc_pub_rand_b64: truncate(rec.enc_pub_rand_b64, 86),
            my_pub_ed_b64: truncate(b64(runtime.edPub)),
            my_pub_x_b64: truncate(b64(runtime.xPub))
          }
        }));
      }

      const eph = sodium.crypto_box_keypair();
      const rcpt_pub = sodium.from_base64(rec.enc_pub_rand_b64);
      const shared = sodium.crypto_box_beforenm(rcpt_pub, eph.privateKey);

      const ts = new Date().toISOString();
      const msg_id = sodium.to_hex(sodium.randombytes_buf(16));
      const bodyObj = {
        v: 1,
        ts_client: ts,
        msg_id,
        sender_email: senderEmail,
        sender_pub_ed_b64: b64(runtime.edPub),
        sender_pub_x_b64: b64(runtime.xPub),
        message: text
      };
      const bodyBytes = te.encode(JSON.stringify(bodyObj));

      const ctxBytes = te.encode("ctx:v1|rcpt=" + rec.enc_pub_rand_b64 + "|eph=" + b64(eph.publicKey));
      const toSign = new Uint8Array(bodyBytes.length + ctxBytes.length);
      toSign.set(bodyBytes, 0); toSign.set(ctxBytes, bodyBytes.length);
      const sig = ed25519.sign(toSign, runtime.edPriv);

      const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
      const payload = JSON.stringify({ body_b64: b64(bodyBytes), sig_b64: b64(sig) });
      const ct = sodium.crypto_box_easy_afternm(te.encode(payload), nonce, shared);

      const envelope = {
        v: 1,
        rcpt_id: rec.rcpt_id,
        ts_client: ts,
        eph_pub_b64: b64(eph.publicKey),
        nonce_b64: b64(nonce),
        ct_b64: b64(ct)
      };

      const tokenSend = signJWS({ email: senderEmail, act: "send" });
      await apiPostMessage({ token: tokenSend, email: senderEmail, envelope });

      dispatch(addLog({
        level: "info",
        msg: "Message sent (sealed sender)",
        data: {
          msg_id,
          rcpt_id: rec.rcpt_id,
          eph_pub_b64: truncate(envelope.eph_pub_b64),
          nonce_b64: truncate(envelope.nonce_b64),
          ct_b64_preview: truncate(envelope.ct_b64, 140)
        }
      }));

      return { toRcptId, msg_id, body: bodyObj };
    } catch (e) {
      dispatch(addLog({ level: "error", msg: "Send failed", data: { toRcptId, error: String(e) } }));
      return rejectWithValue(String(e));
    }
  }
);

// --- Fetch & decrypt inbox (manual) ---
export const fetchInbox = createAsyncThunk(
  "chat/fetchInbox",
  async (_, { getState, dispatch, rejectWithValue }) => {
    try {
      await sodium.ready;
      const { auth } = getState();
      if (!auth.session) throw new Error("Not logged in");
      const rcpt_id = auth.session.rcpt_id;
      const email = auth.session.email;

      const tokenFetch = signJWS({ email, act: "fetch" });
      const envs = await apiFetchInbox({ token: tokenFetch, email, rcpt_id });

      const runtime = getRuntimeKeys();
      const messages = [];

      for (const env of envs) {
        try {
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
          const ctxBytes = new TextEncoder().encode("ctx:v1|rcpt=" + b64(runtime.xPub) + "|eph=" + env.eph_pub_b64);
          const toVerify = new Uint8Array(bodyBytes.length + ctxBytes.length);
          toVerify.set(bodyBytes, 0); toVerify.set(ctxBytes, bodyBytes.length);
          const sender_ed_pub = sodium.from_base64(bodyObj.sender_pub_ed_b64);
          const ok = ed25519.verify(sigBytes, toVerify, sender_ed_pub);

          messages.push({
            ok,
            from: bodyObj.sender_email || "(unknown)",
            ts: bodyObj.ts_client,
            msg_id: bodyObj.msg_id,
            text: bodyObj.message,
            direction: "in"
          });
        } catch (err) {
          messages.push({ ok: false, error: String(err), direction: "in" });
          // optional log here
        }
      }
      return messages;
    } catch (e) {
      return rejectWithValue(String(e));
    }
  }
);

// --- slice ---
const chatSlice = createSlice({
  name: "chat",
  initialState: {
    // threads: { key -> array of messages }
    threads: {}
  },
  reducers: {
    appendOutgoing(state, action) {
      const { toRcptId, body } = action.payload;
      if (!state.threads[toRcptId]) state.threads[toRcptId] = [];
      state.threads[toRcptId].push({
        direction: "out",
        text: body.message,
        ts: body.ts_client,
        msg_id: body.msg_id,
        ok: true
      });
    },
    appendIncomingOne(state, action) {
      const m = action.payload; // {from, ts, msg_id, text, ok, direction:"in"}
      const key = m.from || "inbox";
      if (!state.threads[key]) state.threads[key] = [];
      state.threads[key].push(m);
    },
    appendIncomingBatch(state, action) {
      const arr = action.payload || [];
      for (const m of arr) {
        const key = m.from || "inbox";
        if (!state.threads[key]) state.threads[key] = [];
        state.threads[key].push(m);
      }
    }
  },
  extraReducers: (b) => {
    b.addCase(sendMessage.fulfilled, (s, _a) => {});
    b.addCase(fetchInbox.fulfilled, (s, a) => {
      const arr = a.payload || [];
      for (const m of arr) {
        const key = m.from || "inbox";
        if (!s.threads[key]) s.threads[key] = [];
        s.threads[key].push(m);
      }
    });
  }
});

export const { appendOutgoing, appendIncomingBatch, appendIncomingOne } = chatSlice.actions;
export default chatSlice.reducer;
