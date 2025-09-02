// src/store/index.js
import { configureStore } from "@reduxjs/toolkit";
import authReducer from "../features/auth/authSlice";
import logsReducer from "../features/logs/logSlice";
import usersReducer from "../features/users/usersSlice";
import chatReducer from "../features/chat/chatSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    logs: logsReducer,
    users: usersReducer,
    chat: chatReducer

  }
});
