// src/features/auth/authSlice.js
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { v4 as uuidv4 } from "uuid";
import { InMemoryServer } from "../../lib/server";
import {
  readySodium,
  deriveDeterministic,
  deriveRegistrationRandom,
  sealToX25519Pub,
  toBase64,
  unsealMasterWithDet,
  deriveRuntimeFromMaster
} from "../../lib/crypto";
import { addLog } from "../logs/logSlice";


// ---------------- REGISTER ----------------
export const registerUser = createAsyncThunk(
  "auth/registerUser",
  async ({ email, password }, { dispatch, rejectWithValue }) => {
    try {
      dispatch(addLog({ level: "info", msg: "Registration started", data: { email } }));
      await readySodium();

      const det = await deriveDeterministic(email, password);
      dispatch(addLog({ level: "debug", msg: "Deterministic keys derived" }));

      const reg = await deriveRegistrationRandom();
      dispatch(addLog({ level: "debug", msg: "Random registration keys derived" }));

      const c_master = sealToX25519Pub(reg.master, det.xPub);
      const c_master_b64 = toBase64(c_master);

      const record = {
        email,
        sign_pub_det_b64: toBase64(det.edPub),
        enc_pub_rand_b64: toBase64(reg.xPub),
        c_master_b64,
        version: "v1;a2id:t=3,m=64;hkdf:v1",
        rcpt_id: uuidv4()
      };
      InMemoryServer.upsertUser(record);

      dispatch(
        addLog({
          level: "info",
          msg: "User registered",
          data: {
            email,
            rcpt_id: record.rcpt_id,
            sign_pub_det_b64: record.sign_pub_det_b64,
            enc_pub_rand_b64: record.enc_pub_rand_b64,
            c_master_b64: record.c_master_b64
          }
        })
      );

      return {
        email,
        rcpt_id: record.rcpt_id,
        sign_pub_det_b64: record.sign_pub_det_b64,
        enc_pub_rand_b64: record.enc_pub_rand_b64,
        c_master_b64: record.c_master_b64
      };
    } catch (err) {
      dispatch(addLog({ level: "error", msg: "Registration failed", data: { email, error: String(err?.message || err) } }));
      return rejectWithValue(err?.message || "Registration failed");
    }
  }
);

// ---------------- LOGIN ----------------
export const loginUser = createAsyncThunk(
  "auth/loginUser",
  async ({ email, password }, { dispatch, rejectWithValue }) => {
    try {
      dispatch(addLog({ level: "info", msg: "Login started", data: { email } }));
      await readySodium();

      const rec = InMemoryServer.getUser(email);
      if (!rec) throw new Error("User not found");

      const det = await deriveDeterministic(email, password);
      dispatch(addLog({ level: "debug", msg: "Deterministic keys re-derived" }));

      const master_random = unsealMasterWithDet(rec.c_master_b64, det);
      dispatch(addLog({ level: "debug", msg: "Sealed master opened" }));

      const runtime = await deriveRuntimeFromMaster(master_random);
      dispatch(
        addLog({
          level: "info",
          msg: "Login success",
          data: {
            email,
            rcpt_id: rec.rcpt_id,
            runtime_pub_ed_b64: toBase64(runtime.edPub),
            runtime_pub_x_b64: toBase64(runtime.xPub)
          }
        })
      );

      return {
        email,
        rcpt_id: rec.rcpt_id,
        sign_pub_det_b64: rec.sign_pub_det_b64,
        enc_pub_rand_b64: rec.enc_pub_rand_b64,
        runtime_pub_ed_b64: toBase64(runtime.edPub),
        runtime_pub_x_b64: toBase64(runtime.xPub)
      };
    } catch (err) {
      dispatch(addLog({ level: "error", msg: "Login failed", data: { email, error: String(err?.message || err) } }));
      return rejectWithValue(err?.message || "Login failed");
    }
  }
);


// ---------------- SLICE ----------------
const initialState = {
  registering: false,
  loggingIn: false,
  error: null,
  profile: null, // register result
  session: null  // login result
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    resetAuth(state) {
      state.registering = false;
      state.loggingIn = false;
      state.error = null;
      state.profile = null;
      state.session = null;
    }
  },
  extraReducers: (builder) => {
    builder
      // Register
      .addCase(registerUser.pending, (state) => {
        state.registering = true;
        state.error = null;
      })
      .addCase(registerUser.fulfilled, (state, action) => {
        state.registering = false;
        state.profile = action.payload;
      })
      .addCase(registerUser.rejected, (state, action) => {
        state.registering = false;
        state.error = action.payload || "Registration failed";
      })
      // Login
      .addCase(loginUser.pending, (state) => {
        state.loggingIn = true;
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.loggingIn = false;
        state.session = action.payload;
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.loggingIn = false;
        state.error = action.payload || "Login failed";
      });
  }
});

export const { resetAuth } = authSlice.actions;
export default authSlice.reducer;
