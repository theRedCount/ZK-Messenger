// src/store.js
import { configureStore } from "@reduxjs/toolkit";
import auth from "../features/auth/authSlice";
import chat from "../features/chat/chatSlice";
import users from "../features/users/usersSlice";
import logs from "../features/logs/logSlice";
import ws from "../features/realtime/wsSlice";

export const store = configureStore({
  reducer: { auth, chat, users, logs, ws },
  middleware: (getDefault) => getDefault({ serializableCheck: false })
});
