// src/features/users/usersSlice.js
import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { InMemoryServer } from "../../lib/server";
import { addLog } from "../logs/logSlice";

export const loadUsers = createAsyncThunk(
  "users/loadUsers",
  async (_, { dispatch, getState, rejectWithValue }) => {
    try {
      const { auth } = getState();
      const all = InMemoryServer.listUsers();
      // exclude self if logged in
      const filtered = auth?.session?.email
        ? all.filter(u => u.email !== auth.session.email)
        : all;

      dispatch(addLog({ level: "info", msg: "Users loaded", data: { count: filtered.length } }));
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
