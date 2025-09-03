// src/features/chat/chatSlice.js
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { InMemoryServer } from "../../lib/server";
import { addLog } from "../logs/logSlice";
import sodium from "libsodium-wrappers";
import { getRuntimeKeys } from "../../lib/runtime";
import { hkdf32 } from "../../lib/crypto";

const te = new TextEncoder();

// ---------- Base64 helpers (URLSAFE_NO_PADDING everywhere) ----------
const B64V = () => sodium.base64_variants.URLSAFE_NO_PADDING;
const b64 = (u8) => sodium.to_base64(u8, B64V());
const fromB64 = (s) => sodium.from_base64(s, B64V());
const truncate = (s, max = 64) =>
  typeof s === "string" && s.length > max ? s.slice(0, max) + `…(${s.length})` : s;

function safeIso(tsCandidate) {
  const t = Date.parse(tsCandidate);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

// ---------- Clamp helper for X25519 private scalars ----------
function clampScalar(sk) {
  const out = new Uint8Array(sk); // copy
  out[0] &= 248;
  out[31] &= 127;
  out[31] |= 64;
  return out;
}

// ---------- Conversation root & token (static-static DH) ----------
async function deriveConvRootAndToken(myXPrivRaw, peerXPub_b64) {
  const peerPub = fromB64(peerXPub_b64);
  const myXPriv = clampScalar(myXPrivRaw);
  const sharedStatic = sodium.crypto_scalarmult(myXPriv, peerPub); // 32B
  const R = await hkdf32(sharedStatic, "conv-root:v1");           // 32B
  const tokenBytes = await hkdf32(R, "conv-id:v1");               // 32B
  return { R, conv_token_b64: b64(tokenBytes) };
}

// ---------- Deterministic ephemeral (only sender can rebuild) ----------
async function deriveDeterministicEphemeral(R, senderPubXB64, msgId) {
  const seed = await hkdf32(R, `dedk:sk|${msgId}|${senderPubXB64}`); // 32B
  const sk = clampScalar(seed);
  const pk = sodium.crypto_scalarmult_base(sk);
  return { sk, pk };
}

async function deriveMessageKey(shared, msgId) {
  return await hkdf32(shared, `mk|${msgId}`); // 32B
}

// ---------------- SEND (DEDK + ctx inside payload; Ed25519 via sodium) ----------------
export const sendMessage = createAsyncThunk(
  "chat/sendMessage",
  async ({ toRcptId, text }, { getState, dispatch, rejectWithValue }) => {
    try {
      await sodium.ready;
      if (sodium.base64_variants.URLSAFE_NO_PADDING !== B64V()) {
        throw new Error("B64 variant mismatch");
      }
      const { auth } = getState();
      if (!auth.session) throw new Error("Not logged in");

      const senderEmail = auth.session.email;
      const rec = InMemoryServer.getUserByRcptId(toRcptId);
      if (!rec) throw new Error("Recipient not found");

      const runtime = getRuntimeKeys(); // { edPriv(32), edPub(32) from noble, xPriv, xPub }
      const myPubXB64 = b64(runtime.xPub);

      // conversation root & token
      const { R, conv_token_b64 } = await deriveConvRootAndToken(
        runtime.xPriv,
        rec.enc_pub_rand_b64
      );

      // per-message id (in chiaro)
      const msg_id = sodium.to_hex(sodium.randombytes_buf(16));

      // deterministic ephemeral from (R, msg_id, myPubXB64)
      const { sk: a_sk, pk: a_pk } = await deriveDeterministicEphemeral(
        R,
        myPubXB64,
        msg_id
      );
      if (a_pk.length !== 32) throw new Error("ephemeral pubkey len invalid");

      // shared & AEAD key
      const rcptPub = fromB64(rec.enc_pub_rand_b64);
      const s = sodium.crypto_scalarmult(a_sk, rcptPub); // 32B
      const mk = await deriveMessageKey(s, msg_id);
      if (mk.length !== 32) throw new Error("mk derivation failed");

      // Generate sodium keypair for signing
      const signKeyPair = sodium.crypto_sign_seed_keypair(runtime.edPriv); // {publicKey:32, privateKey:64}

      // body - use sodium's public key for consistency with signing
      const ts = new Date().toISOString();
      const bodyObj = {
        v: 1,
        ts_client: ts,
        msg_id,
        sender_email: senderEmail,
        sender_pub_ed_b64: b64(signKeyPair.publicKey), // use sodium's pub key for consistency
        sender_pub_x_b64: myPubXB64,
        message: text
      };
      const bodyBytes = te.encode(JSON.stringify(bodyObj));

      // exact ctx used for signature (store inside payload)
      const ctxStr =
        "ctx:v1|rcpt=" + rec.enc_pub_rand_b64 + "|eph=" + b64(a_pk) + "|msg_id=" + msg_id;
      const ctxBytes = te.encode(ctxStr);

      // sign (sodium)
      const toSign = new Uint8Array(bodyBytes.length + ctxBytes.length);
      toSign.set(bodyBytes, 0);
      toSign.set(ctxBytes, bodyBytes.length);
      const sig = sodium.crypto_sign_detached(toSign, signKeyPair.privateKey); // 64B

      // AEAD (XSalsa20-Poly1305) with mk
      const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES); // 24B
      const payloadObj = {
        body_b64: b64(bodyBytes),
        sig_b64: b64(sig),
        ctx_b64: b64(ctxBytes)
      };
      const ct = sodium.crypto_secretbox_easy(
        te.encode(JSON.stringify(payloadObj)),
        nonce,
        mk
      );

      // envelope
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

// ---------------- FETCH CONVERSATION (verify with sodium + embedded ctx) ----------------
export const fetchConversation = createAsyncThunk(
  "chat/fetchConversation",
  async ({ peerRcptId, offset=0, limit=200 }, { getState, dispatch, rejectWithValue }) => {
    try {
      await sodium.ready;
      if (sodium.base64_variants.URLSAFE_NO_PADDING !== B64V()) {
        throw new Error("B64 variant mismatch");
      }
      const { auth } = getState();
      if (!auth.session) throw new Error("Not logged in");

      const meEmail = auth.session.email;
      const peer = InMemoryServer.getUserByRcptId(peerRcptId);
      if (!peer) throw new Error("Peer not found");

      const meRec = InMemoryServer.getUser(meEmail);
      if (!meRec) throw new Error("Self record not found");

      const runtime = getRuntimeKeys();
      const myXPriv = clampScalar(runtime.xPriv);
      const myPubXB64_runtime = b64(runtime.xPub); // only for deterministic ephemeral

      // conv token
      const { R, conv_token_b64 } = await deriveConvRootAndToken(
        myXPriv,
        peer.enc_pub_rand_b64
      );
      
      const envs = InMemoryServer.fetchConversation(conv_token_b64, { offset, limit });

      const out = [];
      for (const env of envs) {
        if (!env?.nonce_b64 || !env?.ct_b64 || !env?.eph_pub_b64 || !env?.msg_id) {
          dispatch(addLog({ level:"warn", msg:"Skipping malformed envelope", data:{ env } }));
          continue;
        }
        const fallbackTs = env?.ts_client || new Date().toISOString();
        
        dispatch(addLog({
          level: "debug",
          msg: "Processing envelope",
          data: {
            msg_id: env?.msg_id,
            alg: env?.alg,
            has_nonce: !!env?.nonce_b64,
            has_ct: !!env?.ct_b64,
            has_eph_pub: !!env?.eph_pub_b64
          }
        }));
        
        try {
          const { msg_id } = env;
          const nonce = fromB64(env.nonce_b64);
          const ct = fromB64(env.ct_b64);
          const eph_pub = fromB64(env.eph_pub_b64);

          // try INCOMING (my xPriv, eph_pub)
          let payloadU8 = null;
          try {
            dispatch(addLog({
              level: "debug", 
              msg: "Trying INCOMING decryption",
              data: { msg_id }
            }));
            
            const s_in = sodium.crypto_scalarmult(myXPriv, eph_pub);
            const mk_in = await deriveMessageKey(s_in, msg_id);
            if (mk_in.length !== 32) throw new Error("mk_in derivation failed");
            payloadU8 = sodium.crypto_secretbox_open_easy(ct, nonce, mk_in);
            
            if (payloadU8) {
              dispatch(addLog({
                level: "debug",
                msg: "INCOMING decryption SUCCESS",
                data: { msg_id }
              }));
              
              const parsed = JSON.parse(new TextDecoder().decode(payloadU8));
              const bodyBytes = fromB64(parsed.body_b64);
              const sigBytes = fromB64(parsed.sig_b64);
              const ctxFromPayload = fromB64(parsed.ctx_b64);
              const bodyObj = JSON.parse(new TextDecoder().decode(bodyBytes));

              const direction = bodyObj.sender_email === meEmail ? "out" : "in";

              // verify with sodium against embedded ctx
              const toVerify = new Uint8Array(bodyBytes.length + ctxFromPayload.length);
              toVerify.set(bodyBytes, 0);
              toVerify.set(ctxFromPayload, bodyBytes.length);
              const sender_ed_pub = fromB64(bodyObj.sender_pub_ed_b64);
              const ok = sodium.crypto_sign_verify_detached(sigBytes, toVerify, sender_ed_pub);

              // Debug verification for incoming messages
              dispatch(addLog({
                level: "debug",
                msg: `Signature verification (INCOMING): ${ok ? "SUCCESS" : "FAILED"}`,
                data: {
                  msg_id,
                  sender_email: bodyObj.sender_email,
                  direction,
                  ok,
                  sender_pub_ed_b64: truncate(bodyObj.sender_pub_ed_b64, 40),
                  sig_length: sigBytes.length,
                  body_length: bodyBytes.length,
                  ctx_length: ctxFromPayload.length
                }
              }));

              // optional: compare with locally rebuilt ctx (diagnostic only)
              const localCtxStr =
                "ctx:v1|rcpt=" +
                (direction === "in" ? meRec.enc_pub_rand_b64 : peer.enc_pub_rand_b64) +
                "|eph=" +
                env.eph_pub_b64 +
                "|msg_id=" +
                msg_id;
              const localCtxBytes = te.encode(localCtxStr);
              if (ok && b64(localCtxBytes) !== b64(ctxFromPayload)) {
                dispatch(
                  addLog({
                    level: "warn",
                    msg: "CTX mismatch (verify ok with embedded ctx)",
                    data: {
                      msg_id,
                      local_ctx_b64: truncate(b64(localCtxBytes), 120),
                      embedded_ctx_b64: truncate(b64(ctxFromPayload), 120)
                    }
                  })
                );
              }

              out.push({
                direction,
                ok,
                from: bodyObj.sender_email || "(unknown)",
                ts: safeIso(bodyObj.ts_client || fallbackTs),
                msg_id: bodyObj.msg_id,
                text: bodyObj.message
              });
              continue;
            }
          } catch (incomingError) {
            dispatch(addLog({
              level: "debug",
              msg: "INCOMING decryption FAILED",
              data: { msg_id, error: String(incomingError) }
            }));
            // payloadU8 remains null, will try OUTGOING
          }

          // try OUTGOING (rebuild my deterministic ephemeral)
          {
            dispatch(addLog({
              level: "debug",
              msg: "Trying OUTGOING decryption",
              data: { msg_id }
            }));
            
            const { sk: my_det_sk } = await deriveDeterministicEphemeral(
              R,
              myPubXB64_runtime,
              msg_id
            );
            const peerPub = fromB64(peer.enc_pub_rand_b64);
            const s_out = sodium.crypto_scalarmult(my_det_sk, peerPub);
            const mk_out = await deriveMessageKey(s_out, msg_id);
            if (mk_out.length !== 32) throw new Error("mk_out derivation failed");
            const payloadU8b = sodium.crypto_secretbox_open_easy(ct, nonce, mk_out);
            if (!payloadU8b) {
              dispatch(addLog({
                level: "debug",
                msg: "OUTGOING decryption FAILED",
                data: { msg_id }
              }));
              throw new Error("Decryption failed");
            }

            dispatch(addLog({
              level: "debug",
              msg: "OUTGOING decryption SUCCESS",
              data: { msg_id }
            }));

            const parsed = JSON.parse(new TextDecoder().decode(payloadU8b));
            const bodyBytes = fromB64(parsed.body_b64);
            const sigBytes = fromB64(parsed.sig_b64);
            const ctxFromPayload = fromB64(parsed.ctx_b64);
            const bodyObj = JSON.parse(new TextDecoder().decode(bodyBytes));

            const direction = bodyObj.sender_email === meEmail ? "out" : "in";

            const toVerify = new Uint8Array(bodyBytes.length + ctxFromPayload.length);
            toVerify.set(bodyBytes, 0);
            toVerify.set(ctxFromPayload, bodyBytes.length);
            const sender_ed_pub = fromB64(bodyObj.sender_pub_ed_b64);
            const ok = sodium.crypto_sign_verify_detached(sigBytes, toVerify, sender_ed_pub);

            // Debug verification for outgoing messages
            dispatch(addLog({
              level: "debug",
              msg: `Signature verification (OUTGOING): ${ok ? "SUCCESS" : "FAILED"}`,
              data: {
                msg_id,
                sender_email: bodyObj.sender_email,
                direction,
                ok,
                sender_pub_ed_b64: truncate(bodyObj.sender_pub_ed_b64, 40),
                sig_length: sigBytes.length,
                body_length: bodyBytes.length,
                ctx_length: ctxFromPayload.length,
                my_email: meEmail
              }
            }));

            const localCtxStr =
              "ctx:v1|rcpt=" +
              (direction === "in" ? meRec.enc_pub_rand_b64 : peer.enc_pub_rand_b64) +
              "|eph=" +
              env.eph_pub_b64 +
              "|msg_id=" +
              msg_id;
            const localCtxBytes = te.encode(localCtxStr);
            if (ok && b64(localCtxBytes) !== b64(ctxFromPayload)) {
              dispatch(
                addLog({
                  level: "warn",
                  msg: "CTX mismatch (verify ok with embedded ctx)",
                  data: {
                    msg_id,
                    local_ctx_b64: truncate(b64(localCtxBytes), 120),
                    embedded_ctx_b64: truncate(b64(ctxFromPayload), 120)
                  }
                })
              );
            }

            out.push({
              direction,
              ok,
              from: bodyObj.sender_email || "(unknown)",
              ts: safeIso(bodyObj.ts_client || fallbackTs),
              msg_id: bodyObj.msg_id,
              text: bodyObj.message
            });
          }
        } catch (err) {
          dispatch(addLog({
            level: "debug",
            msg: "Message processing ERROR",
            data: {
              msg_id: env?.msg_id,
              error: String(err),
              stack: err.stack?.split('\n').slice(0, 3).join(' | ') || 'no stack'
            }
          }));
          
          out.push({
            direction: "in",
            ok: false,
            error: String(err),
            ts: safeIso(fallbackTs),
            msg_id: env?.msg_id || Math.random().toString(16).slice(2)
          });
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
      dispatch(
        addLog({ level: "error", msg: "Fetch conversation failed", data: { error: String(e) } })
      );
      return rejectWithValue(String(e));
    }
  }
);

// ---------------- SLICE ----------------
const chatSlice = createSlice({
  name: "chat",
  initialState: {
    threads: {} // { [peerRcptId]: Array<Message> }
  },
  reducers: {
    // Optimistic append for outgoing
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
      // optimistic already appended
    });
    b.addCase(fetchConversation.fulfilled, (s, a) => {
      const { peerKey, items } = a.payload;
      s.threads[peerKey] = items;
    });
  }
});

export const { appendOutgoing } = chatSlice.actions;
export default chatSlice.reducer;
