// src/features/auth/authSlice.js
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { addLog } from "../logs/logSlice";
import {
  readySodium,
  deriveDeterministic,
  deriveRegistrationRandom,
  sealToX25519Pub,
  toBase64,
  unsealMasterWithDet,
  deriveRuntimeFromMaster
} from "../../lib/crypto";
import { setRuntimeKeys, clearRuntimeKeys, setDeterministicKeys } from "../../lib/runtime";
import { apiRegister, apiLogin } from "../../services/api";
import { signJWS } from "../../lib/jws";
import { startInboxWS, stopInboxWS } from "../realtime/wsSlice";

export const registerUser = createAsyncThunk(
  "auth/registerUser",
  async ({ email, password }, { dispatch, rejectWithValue }) => {
    try {
      dispatch(addLog({ level: "info", msg: "Registration started", data: { email } }));
      await readySodium();

      const det = await deriveDeterministic(email, password);
      const reg = await deriveRegistrationRandom();
      const c_master_b64 = toBase64(sealToX25519Pub(reg.master, det.xPub));

      const resp = await apiRegister({
        email,
        sign_pub_det_b64: toBase64(det.edPub),
        enc_pub_rand_b64: toBase64(reg.xPub),
        c_master_b64
      });

      dispatch(addLog({ level: "info", msg: "User registered (backend)", data: { email, rcpt_id: resp.rcpt_id } }));
      return {
        email,
        rcpt_id: resp.rcpt_id,
        sign_pub_det_b64: resp.sign_pub_det_b64,
        enc_pub_rand_b64: resp.enc_pub_rand_b64,
        c_master_b64
      };
    } catch (err) {
      dispatch(addLog({ level: "error", msg: "Registration failed", data: { email, error: String(err?.message || err) } }));
      return rejectWithValue(err?.message || "Registration failed");
    }
  }
);

export const loginUser = createAsyncThunk(
  "auth/loginUser",
  async ({ email, password }, { dispatch, rejectWithValue }) => {
    try {
      dispatch(addLog({ level: "info", msg: "Login started", data: { email } }));
      await readySodium();

      const det = await deriveDeterministic(email, password);
      setDeterministicKeys(det);

      const token = signJWS({ email, act: "login" });
      const rec = await apiLogin({ token, email }); // UserRecord (has rcpt_id, c_master_b64)

      const master_random = unsealMasterWithDet(rec.c_master_b64, det);
      const runtime = await deriveRuntimeFromMaster(master_random);
      setRuntimeKeys(runtime);

      dispatch(addLog({ level: "info", msg: "Login success", data: { email, rcpt_id: rec.rcpt_id } }));

      // ✅ start WS with explicit params
      await dispatch(startInboxWS({ email, rcpt_id: rec.rcpt_id }));

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

export const logout = createAsyncThunk("auth/logout", async (_, { dispatch }) => {
  await dispatch(stopInboxWS());
  dispatch(resetAuth());
});

const initialState = {
  registering: false,
  loggingIn: false,
  error: null,
  profile: null,
  session: null
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
      try { clearRuntimeKeys(); } catch {}
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(registerUser.pending, (state) => { state.registering = true; state.error = null; })
      .addCase(registerUser.fulfilled, (state, action) => { state.registering = false; state.profile = action.payload; })
      .addCase(registerUser.rejected, (state, action) => { state.registering = false; state.error = action.payload || "Registration failed"; })
      .addCase(loginUser.pending, (state) => { state.loggingIn = true; state.error = null; })
      .addCase(loginUser.fulfilled, (state, action) => { state.loggingIn = false; state.session = action.payload; })
      .addCase(loginUser.rejected, (state, action) => { state.loggingIn = false; state.error = action.payload || "Login failed"; });
  }
});

export const { resetAuth } = authSlice.actions;
export default authSlice.reducer;
