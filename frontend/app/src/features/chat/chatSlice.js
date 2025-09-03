// src/features/chat/chatSlice.js
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { InMemoryServer } from "../../lib/server";
import { addLog } from "../logs/logSlice";
import sodium from "libsodium-wrappers";
import { ed25519 } from "@noble/curves/ed25519";
import { getRuntimeKeys } from "../../lib/runtime";
import { hkdf32 } from "../../lib/crypto"; // deve esistere (come in auth)

const te = new TextEncoder();

// --- helpers ---
const b64 = (u8) => sodium.to_base64(u8);
const fromB64 = (s) => sodium.from_base64(s);
const truncate = (s, max = 64) =>
  typeof s === "string" && s.length > max ? s.slice(0, max) + `…(${s.length})` : s;

// derive conversation root & token
async function deriveConvRootAndToken(myXPriv, peerXPub_b64) {
  const peerPub = fromB64(peerXPub_b64);
  const sharedStatic = sodium.crypto_scalarmult(myXPriv, peerPub); // 32B
  const R = await hkdf32(sharedStatic, "conv-root:v1");           // 32B
  const tokenBytes = await hkdf32(R, "conv-id:v1");               // 32B
  return { R, conv_token_b64: b64(tokenBytes) };
}

// deterministic ephemeral (sender-side) from msg_id
async function deriveDeterministicEphemeral(R, dirLabel, msgId) {
  const seed = await hkdf32(R, `dedk:${dirLabel}|sk|${msgId}`); // 32B
  const sk = seed;                                              // libsodium clampa internamente
  const pk = sodium.crypto_scalarmult_base(sk);
  return { sk, pk };
}

// derive aead key from shared and msg_id
async function deriveMessageKey(shared, msgId) {
  return await hkdf32(shared, `mk|${msgId}`); // 32B
}

// ---------------- SEND (DEDK) ----------------
export const sendMessage = createAsyncThunk(
  "chat/sendMessage",
  async ({ toRcptId, text }, { getState, dispatch, rejectWithValue }) => {
    try {
      await sodium.ready;
      const { auth } = getState();
      if (!auth.session) throw new Error("Not logged in");

      const senderEmail = auth.session.email;
      const rec = InMemoryServer.getUserByRcptId(toRcptId);
      if (!rec) throw new Error("Recipient not found");

      const runtime = getRuntimeKeys(); // { edPriv, edPub, xPriv, xPub }

      // conversation root & token
      const { R, conv_token_b64 } = await deriveConvRootAndToken(runtime.xPriv, rec.enc_pub_rand_b64);

      // per-message id (in chiaro)
      const msg_id = sodium.to_hex(sodium.randombytes_buf(16));

      // deterministic ephemeral from (R, msg_id)
      const { sk: a_sk, pk: a_pk } = await deriveDeterministicEphemeral(R, "A->B", msg_id);
      const s = sodium.crypto_scalarmult(a_sk, fromB64(rec.enc_pub_rand_b64)); // 32B
      const mk = await deriveMessageKey(s, msg_id);

      // build body
      const ts = new Date().toISOString();
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

      // sign with Ed25519 binding rcpt pub + a_pk + msg_id
      const ctxBytes = te.encode(
        "ctx:v1|rcpt=" + rec.enc_pub_rand_b64 + "|eph=" + b64(a_pk) + "|msg_id=" + msg_id
      );
      const toSign = new Uint8Array(bodyBytes.length + ctxBytes.length);
      toSign.set(bodyBytes, 0);
      toSign.set(ctxBytes, bodyBytes.length);
      const sig = ed25519.sign(toSign, runtime.edPriv);

      // AEAD (XSalsa20-Poly1305) with mk
      const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
      const payload = JSON.stringify({ body_b64: b64(bodyBytes), sig_b64: b64(sig) });
      const ct = sodium.crypto_secretbox_easy(te.encode(payload), nonce, mk);

      // envelope (sealed sender, + conv token opaco)
      const envelope = {
        v: 1,
        rcpt_id: rec.rcpt_id,
        conv_token_b64,
        ts_client: ts,
        msg_id,
        eph_pub_b64: b64(a_pk),
        nonce_b64: b64(nonce),
        ct_b64: b64(ct),
        alg: "dedk-v1"
      };

      InMemoryServer.putMessage(rec.rcpt_id, envelope, conv_token_b64);

      dispatch(
        addLog({
          level: "info",
          msg: "Message sent (DEDK sealed sender)",
          data: {
            msg_id,
            rcpt_id: rec.rcpt_id,
            conv_token_b64: truncate(conv_token_b64),
            eph_pub_b64: truncate(b64(a_pk)),
            ct_len: ct.length
          }
        })
      );

      // optimistic UI
      return { toRcptId, msg_id, body: { ...bodyObj } };
    } catch (e) {
      dispatch(addLog({ level: "error", msg: "Send failed", data: { toRcptId, error: String(e) } }));
      return rejectWithValue(String(e));
    }
  }
);

// ---------------- FETCH CONVERSATION (decrypt both directions) ----------------
export const fetchConversation = createAsyncThunk(
  "chat/fetchConversation",
  async ({ peerRcptId }, { getState, dispatch, rejectWithValue }) => {
    try {
      await sodium.ready;
      const { auth } = getState();
      if (!auth.session) throw new Error("Not logged in");

      const me = auth.session;
      const peer = InMemoryServer.getUserByRcptId(peerRcptId);
      if (!peer) throw new Error("Peer not found");

      const runtime = getRuntimeKeys();

      // conv token
      const { R, conv_token_b64 } = await deriveConvRootAndToken(runtime.xPriv, peer.enc_pub_rand_b64);
      const envs = InMemoryServer.fetchConversation(conv_token_b64);

      const out = [];
      for (const env of envs) {
        try {
          const nonce = fromB64(env.nonce_b64);
          const ct = fromB64(env.ct_b64);
          const eph_pub = fromB64(env.eph_pub_b64);
          const msg_id = env.msg_id;

          // 1) try as incoming: s = X25519(my xPriv, eph_pub)
          let s_in = sodium.crypto_scalarmult(runtime.xPriv, eph_pub);
          let mk_in = await deriveMessageKey(s_in, msg_id);
          let payloadU8 = sodium.crypto_secretbox_open_easy(ct, nonce, mk_in);

          let direction = "in";
          if (!payloadU8) {
            // 2) try as outgoing (DEDK recomputed): a_sk from (R, msg_id), s = X25519(a_sk, peer.xPub)
            const { sk: my_det_sk } = await deriveDeterministicEphemeral(R, "A->B", msg_id);
            const s_out = sodium.crypto_scalarmult(my_det_sk, fromB64(peer.enc_pub_rand_b64));
            const mk_out = await deriveMessageKey(s_out, msg_id);
            payloadU8 = sodium.crypto_secretbox_open_easy(ct, nonce, mk_out);
            direction = "out";
          }

          if (!payloadU8) throw new Error("Decryption failed");

          const { body_b64, sig_b64 } = JSON.parse(new TextDecoder().decode(payloadU8));
          const bodyBytes = fromB64(body_b64);
          const sigBytes = fromB64(sig_b64);
          const bodyObj = JSON.parse(new TextDecoder().decode(bodyBytes));

          // verify signature
          const ctxBytes = te.encode(
            "ctx:v1|rcpt=" +
              (direction === "in" ? b64(runtime.xPub) : peer.enc_pub_rand_b64) +
              "|eph=" +
              env.eph_pub_b64 +
              "|msg_id=" +
              msg_id
          );
          const toVerify = new Uint8Array(bodyBytes.length + ctxBytes.length);
          toVerify.set(bodyBytes, 0);
          toVerify.set(ctxBytes, bodyBytes.length);
          const sender_ed_pub = fromB64(bodyObj.sender_pub_ed_b64);
          const ok = ed25519.verify(sigBytes, toVerify, sender_ed_pub);

          out.push({
            direction,
            ok,
            from: bodyObj.sender_email || "(unknown)",
            ts: bodyObj.ts_client,
            msg_id: bodyObj.msg_id,
            text: bodyObj.message
          });
        } catch (err) {
          out.push({ direction: "in", ok: false, error: String(err) });
        }
      }

      dispatch(
        addLog({
          level: "info",
          msg: "Conversation fetched",
          data: { conv_token_b64: truncate(conv_token_b64), count: out.length }
        })
      );

      return { peerKey: peerRcptId, items: out };
    } catch (e) {
      dispatch(addLog({ level: "error", msg: "Fetch conversation failed", data: { error: String(e) } }));
      return rejectWithValue(String(e));
    }
  }
);

// ---------------- SLICE ----------------
const chatSlice = createSlice({
  name: "chat",
  initialState: {
    // threads keyed by: peer rcpt_id
    threads: {} // { [peerRcptId]: Array<Message> }
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
    }
  },
  extraReducers: (b) => {
    b.addCase(sendMessage.fulfilled, (s) => {
      // optimistic già fatto
    });
    b.addCase(fetchConversation.fulfilled, (s, a) => {
      const { peerKey, items } = a.payload;
      s.threads[peerKey] = items;
    });
  }
});

export const { appendOutgoing } = chatSlice.actions;
export default chatSlice.reducer;
