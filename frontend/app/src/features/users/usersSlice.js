// src/features/users/usersSlice.js
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { addLog } from "../logs/logSlice";
import { apiListUsers } from "../../services/api";
import { signJWS } from "../../lib/jws";

export const loadUsers = createAsyncThunk(
  "users/loadUsers",
  async (_, { dispatch, getState, rejectWithValue }) => {
    try {
      const { auth } = getState();
      const email = auth?.session?.email;
      if (!email) throw new Error("Not logged in");

      // JWS for users.list
      const token = signJWS({ email, act: "users.list" });
      const all = await apiListUsers({ token, email });

      // Exclude self
      const filtered = all.filter((u) => u.email !== email);

      dispatch(addLog({ level: "info", msg: "Users loaded (backend)", data: { count: filtered.length } }));
      return filtered;
    } catch (e) {
      dispatch(addLog({ level: "error", msg: "Users load failed", data: { error: String(e) } }));
      return rejectWithValue("Failed to load users");
    }
  }
);

const usersSlice = createSlice({
  name: "users",
  initialState: { loading: false, error: null, items: [] },
  reducers: {},
  extraReducers: (b) => {
    b.addCase(loadUsers.pending, (s) => { s.loading = true; s.error = null; });
    b.addCase(loadUsers.fulfilled, (s, a) => { s.loading = false; s.items = a.payload; });
    b.addCase(loadUsers.rejected, (s, a) => { s.loading = false; s.error = a.payload || "Failed"; });
  }
});

export default usersSlice.reducer;
