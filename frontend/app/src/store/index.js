// src/store/index.js
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "../features/auth/authSlice";
import logsReducer from "../features/logs/logSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    logs: logsReducer
  }
});
