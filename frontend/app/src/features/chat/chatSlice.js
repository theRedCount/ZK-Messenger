// src/features/chat/chatSlice.js
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { InMemoryServer } from "../../lib/server";
import { addLog } from "../logs/logSlice";
import sodium from "libsodium-wrappers";
import { ed25519 } from "@noble/curves/ed25519";
import { getRuntimeKeys } from "../../lib/runtime";

const te = new TextEncoder();

// ----------------------- Helpers for verbose logs -----------------------
const VERBOSE_LOGS = true;
const truncate = (s, max = 64) =>
  typeof s === "string" && s.length > max ? s.slice(0, max) + `…(${s.length})` : s;
const b64 = (u8) => sodium.to_base64(u8);

// ----------------------- Thunks -----------------------

// Send message (sealed sender) with detailed logs
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

      // 0) Context
      if (VERBOSE_LOGS) {
        dispatch(
          addLog({
            level: "debug",
            msg: "Preparing sealed sender",
            data: {
              from_email: senderEmail,
              to_rcpt_id: rec.rcpt_id,
              to_enc_pub_rand_b64: truncate(rec.enc_pub_rand_b64, 86),
              my_pub_ed_b64: truncate(b64(runtime.edPub)),
              my_pub_x_b64: truncate(b64(runtime.xPub))
            }
          })
        );
      }

      // 1) Ephemeral X25519 for this message (sender)
      const eph = sodium.crypto_box_keypair(); // { publicKey, privateKey }
      if (VERBOSE_LOGS) {
        dispatch(
          addLog({
            level: "debug",
            msg: "Ephemeral keypair generated",
            data: {
              eph_pub_b64: truncate(b64(eph.publicKey)),
              eph_priv_len: eph.privateKey?.length || 0
            }
          })
        );
      }

      // 2) Precompute shared key (sender eph_priv ↔ recipient static pub)
      const rcpt_pub = sodium.from_base64(rec.enc_pub_rand_b64);
      const shared = sodium.crypto_box_beforenm(rcpt_pub, eph.privateKey);
      if (VERBOSE_LOGS) {
        dispatch(
          addLog({
            level: "debug",
            msg: "Shared secret computed (crypto_box_beforenm)",
            data: { shared_len: shared.length }
          })
        );
      }

      // 3) Build plaintext body (with sender identity inside)
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
      if (VERBOSE_LOGS) {
        dispatch(
          addLog({
            level: "debug",
            msg: "Plaintext body prepared",
            data: {
              json_preview: truncate(JSON.stringify(bodyObj), 200),
              body_len: bodyBytes.length
            }
          })
        );
      }

      // 4) Bind context and sign with Ed25519
      const ctxBytes = te.encode(
        "ctx:v1|rcpt=" + rec.enc_pub_rand_b64 + "|eph=" + b64(eph.publicKey)
      );
      const toSign = new Uint8Array(bodyBytes.length + ctxBytes.length);
      toSign.set(bodyBytes, 0);
      toSign.set(ctxBytes, bodyBytes.length);
      const sig = ed25519.sign(toSign, runtime.edPriv);
      if (VERBOSE_LOGS) {
        dispatch(
          addLog({
            level: "debug",
            msg: "Body signed (Ed25519)",
            data: {
              ctx_preview: truncate(new TextDecoder().decode(ctxBytes), 120),
              sig_b64: truncate(b64(sig)),
              sig_len: sig.length
            }
          })
        );
      }

      // 5) AEAD encrypt (XSalsa20-Poly1305 via crypto_box_easy_afternm)
      const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
      const payload = JSON.stringify({
        body_b64: b64(bodyBytes),
        sig_b64: b64(sig)
      });
      const ct = sodium.crypto_box_easy_afternm(te.encode(payload), nonce, shared);
      if (VERBOSE_LOGS) {
        dispatch(
          addLog({
            level: "debug",
            msg: "Payload encrypted (XSalsa20-Poly1305)",
            data: {
              nonce_b64: b64(nonce),
              payload_len: payload.length,
              ct_len: ct.length
            }
          })
        );
      }

      // 6) Envelope to server (no sender leakage)
      const envelope = {
        v: 1,
        rcpt_id: rec.rcpt_id,
        ts_client: ts,
        eph_pub_b64: b64(eph.publicKey),
        nonce_b64: b64(nonce),
        ct_b64: b64(ct)
      };
      InMemoryServer.putMessage(rec.rcpt_id, envelope);

      dispatch(
        addLog({
          level: "info",
          msg: "Message sent (sealed sender)",
          data: {
            msg_id,
            rcpt_id: rec.rcpt_id,
            eph_pub_b64: truncate(envelope.eph_pub_b64),
            nonce_b64: truncate(envelope.nonce_b64),
            ct_b64_preview: truncate(envelope.ct_b64, 140)
          }
        })
      );

      return { toRcptId, msg_id, body: bodyObj };
    } catch (e) {
      dispatch(
        addLog({
          level: "error",
          msg: "Send failed",
          data: { toRcptId, error: String(e) }
        })
      );
      return rejectWithValue(String(e));
    }
  }
);

// Fetch & decrypt inbox for current user (with logs)
export const fetchInbox = createAsyncThunk(
  "chat/fetchInbox",
  async (_, { getState, dispatch, rejectWithValue }) => {
    try {
      await sodium.ready;
      const { auth } = getState();
      if (!auth.session) throw new Error("Not logged in");
      const rcpt_id = auth.session.rcpt_id;

      const runtime = getRuntimeKeys();

      const envs = InMemoryServer.fetchMessages(rcpt_id);
      const messages = [];

      if (VERBOSE_LOGS) {
        dispatch(
          addLog({
            level: "debug",
            msg: "Fetched envelopes",
            data: { count: envs.length }
          })
        );
      }

      for (const env of envs) {
        try {
          const eph_pub = sodium.from_base64(env.eph_pub_b64);
          const shared = sodium.crypto_box_beforenm(eph_pub, runtime.xPriv);

          const nonce = sodium.from_base64(env.nonce_b64);
          const ct = sodium.from_base64(env.ct_b64);
          const payload = sodium.crypto_box_open_easy_afternm(ct, nonce, shared);
          if (!payload) throw new Error("Decryption failed");

          const { body_b64, sig_b64 } = JSON.parse(
            new TextDecoder().decode(payload)
          );

          const bodyBytes = sodium.from_base64(body_b64);
          const sigBytes = sodium.from_base64(sig_b64);
          const bodyObj = JSON.parse(new TextDecoder().decode(bodyBytes));

          const ctxBytes = te.encode(
            "ctx:v1|rcpt=" + b64(runtime.xPub) + "|eph=" + env.eph_pub_b64
          );
          const toVerify = new Uint8Array(bodyBytes.length + ctxBytes.length);
          toVerify.set(bodyBytes, 0);
          toVerify.set(ctxBytes, bodyBytes.length);
          const sender_ed_pub = sodium.from_base64(bodyObj.sender_pub_ed_b64);
          const ok = ed25519.verify(sigBytes, toVerify, sender_ed_pub);

          messages.push({
            ok,
            from: bodyObj.sender_email || "(unknown)",
            ts: bodyObj.ts_client,
            msg_id: bodyObj.msg_id,
            text: bodyObj.message
          });

          if (VERBOSE_LOGS) {
            dispatch(
              addLog({
                level: ok ? "debug" : "warn",
                msg: ok ? "Message verified" : "Signature invalid",
                data: {
                  from: bodyObj.sender_email || "(unknown)",
                  msg_id: bodyObj.msg_id
                }
              })
            );
          }
        } catch (err) {
          messages.push({ ok: false, error: String(err) });
          dispatch(
            addLog({
              level: "warn",
              msg: "Envelope decode failed",
              data: { error: String(err) }
            })
          );
        }
      }

      if (messages.length) {
        dispatch(
          addLog({
            level: "info",
            msg: "Inbox processed",
            data: { count: messages.length }
          })
        );
      }
      return messages;
    } catch (e) {
      dispatch(
        addLog({ level: "error", msg: "Fetch inbox failed", data: { error: String(e) } })
      );
      return rejectWithValue(String(e));
    }
  }
);

// ----------------------- Slice -----------------------
const chatSlice = createSlice({
  name: "chat",
  initialState: {
    // messages per peer rcpt_id or sender email key:
    // { [key]: [{ direction:"in"|"out", text, ts, from, ok, msg_id }] }
    threads: {}
  },
  reducers: {
    // Optimistic append for outgoing messages (before crypto/send completes)
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
    b.addCase(sendMessage.fulfilled, (s, _a) => {
      // No-op: optimistic UI already appended
    });
    b.addCase(fetchInbox.fulfilled, (s, a) => {
      const arr = a.payload || [];
      for (const m of arr) {
        const key = m.from || "inbox"; // group incoming by sender email
        if (!s.threads[key]) s.threads[key] = [];
        s.threads[key].push({ direction: "in", ...m });
      }
    });
  }
});

export const { appendOutgoing } = chatSlice.actions;
export default chatSlice.reducer;
