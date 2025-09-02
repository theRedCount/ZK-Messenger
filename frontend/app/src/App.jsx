// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Auth from "./pages/Auth";
import ChatList from "./pages/ChatList";
import ChatPage from "./pages/ChatPage";
import LogConsole from "./components/LogConsole";
import { useSelector } from "react-redux";

function Protected({ children }) {
  const { session } = useSelector((s) => s.auth);
  if (!session) return <Navigate to="/auth" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route
          path="/chats"
          element={
            <Protected>
              <ChatList />
            </Protected>
          }
        />
        <Route
          path="/chat/:rcptId"
          element={
            <Protected>
              <ChatPage />
            </Protected>
          }
        />
        <Route path="/" element={<Navigate to="/auth" replace />} />
      </Routes>

      <LogConsole />
    </BrowserRouter>
  );
}
