// src/pages/ChatPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import {
  AppBar, Toolbar, IconButton, Typography, Box, TextField, InputAdornment, Paper, Avatar, CircularProgress, Tooltip, Button
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SendIcon from "@mui/icons-material/Send";
import RefreshIcon from "@mui/icons-material/Refresh";
import { appendOutgoing, fetchInbox, sendMessage } from "../features/chat/chatSlice";
import { apiListUsers } from "../services/api";
import { signJWS } from "../lib/jws";

const LS_HEIGHT_KEY = "logConsole.height";
const LS_OPEN_KEY = "logConsole.open";
const LS_MAX_KEY = "logConsole.maximized";

function initialsFromEmail(email) {
  const name = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, " ").trim();
  const parts = name.split(/\s+/);
  const first = parts[0]?.[0] || "?";
  const second = parts[1]?.[0] || "";
  return (first + second).toUpperCase();
}

export default function ChatPage() {
  const { rcptId } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { session } = useSelector((s) => s.auth);
  const threads = useSelector((s) => s.chat.threads);

  const [peer, setPeer] = useState(null);
  const [input, setInput] = useState("");
  const listRef = useRef(null);
  const [loadingPeer, setLoadingPeer] = useState(true);

  const [reservedBottom, setReservedBottom] = useState(0);
  useEffect(() => {
    const readPanel = () => {
      const open = localStorage.getItem(LS_OPEN_KEY) === "true";
      const maximized = localStorage.getItem(LS_MAX_KEY) === "true";
      const h = Number(localStorage.getItem(LS_HEIGHT_KEY) || 240);
      const height = maximized ? Math.floor(window.innerHeight * 0.96) : h;
      setReservedBottom(open ? height : 0);
    };
    readPanel();
    const id = setInterval(readPanel, 200);
    const onResize = () => readPanel();
    window.addEventListener("resize", onResize);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (!session) navigate("/auth", { replace: true });
  }, [session, navigate]);

  // Resolve peer via backend /users
  useEffect(() => {
    (async () => {
      setLoadingPeer(true);
      try {
        const token = signJWS({ email: session.email, act: "users.list" });
        const users = await apiListUsers({ token, email: session.email });
        const u = users.find(x => x.rcpt_id === rcptId);
        setPeer(u ? { email: u.email, rcpt_id: u.rcpt_id } : null);
      } catch {
        setPeer(null);
      } finally {
        setLoadingPeer(false);
      }
    })();
  }, [rcptId, session?.email]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [threads, rcptId, reservedBottom]);

  const myThreadKeyIncoming = useMemo(() => peer?.email || "inbox", [peer]);

  const items = useMemo(() => {
    const incoming = threads[myThreadKeyIncoming] || [];
    const outgoing = threads[rcptId] || [];
    return [...incoming, ...outgoing].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  }, [threads, myThreadKeyIncoming, rcptId]);

  const onSend = async () => {
    const text = input.trim();
    if (!text || !peer) return;
    const body = { v: 1, ts_client: new Date().toISOString(), msg_id: Math.random().toString(16).slice(2), message: text };
    dispatch(appendOutgoing({ toRcptId: rcptId, body }));
    setInput("");
    await dispatch(sendMessage({ toRcptId: rcptId, text }));
  };

  const onFetch = async () => {
    await dispatch(fetchInbox());
  };

  if (loadingPeer) {
    return (
      <Box sx={{ height: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!peer) {
    return (
      <Box sx={{ height: "100vh", display: "grid", placeItems: "center" }}>
        <Typography variant="body1">Recipient not found</Typography>
        <Button sx={{ mt: 2 }} onClick={() => navigate("/chats")}>Back to chats</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ height: "100vh", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
      <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <Toolbar>
          <IconButton onClick={() => navigate("/chats")} color="inherit"><ArrowBackIcon /></IconButton>
          <Avatar sx={{ ml: 1, mr: 1, bgcolor: "primary.main", color: "#000" }}>{initialsFromEmail(peer.email)}</Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1">{peer.email}</Typography>
            <Typography variant="caption" color="text.secondary">rcpt_id: {peer.rcpt_id}</Typography>
          </Box>
          <Tooltip title="Fetch inbox">
            <IconButton onClick={onFetch} color="inherit"><RefreshIcon /></IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box ref={listRef} sx={{ overflow: "auto", p: 2, bgcolor: "background.default", paddingBottom: 2 }}>
        {items.map((m) => (
          <Box key={m.msg_id + m.ts} sx={{ display: "flex", mb: 1.2, justifyContent: m.direction === "out" ? "flex-end" : "flex-start" }}>
            <Paper sx={{ maxWidth: "70%", p: 1.2, borderRadius: 2, bgcolor: m.direction === "out" ? "primary.main" : "background.paper", color: m.direction === "out" ? "#000" : "text.primary", boxShadow: "none" }}>
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</Typography>
              <Box sx={{ textAlign: "right", mt: 0.5 }}>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  {new Date(m.ts).toLocaleTimeString()}
                  {m.direction === "in" && m.ok === false ? " • (bad sig)" : ""}
                </Typography>
              </Box>
            </Paper>
          </Box>
        ))}
      </Box>

      <Box sx={{ p: 1.5, borderTop: "1px solid rgba(255,255,255,0.08)", position: "sticky", bottom: reservedBottom, bgcolor: "background.default", zIndex: (t) => t.zIndex.appBar }}>
        <TextField
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message"
          fullWidth
          multiline
          maxRows={4}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          InputProps={{ endAdornment: (<InputAdornment position="end"><IconButton onClick={onSend} disabled={!input.trim()} aria-label="Send"><SendIcon /></IconButton></InputAdornment>) }}
        />
      </Box>
    </Box>
  );
}
