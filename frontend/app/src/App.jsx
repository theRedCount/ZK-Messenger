// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Auth from "./pages/Auth";
import LogConsole from "./components/LogConsole";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/" element={<Navigate to="/auth" replace />} />
      </Routes>

      {/* global bottom log console */}
      <LogConsole />
    </BrowserRouter>
  );
}
