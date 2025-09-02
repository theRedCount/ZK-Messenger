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
import { InMemoryServer } from "../lib/server";
import { appendOutgoing, fetchInbox, sendMessage } from "../features/chat/chatSlice";

function initialsFromEmail(email) {
    const name = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, " ").trim();
    const parts = name.split(/\s+/);
    const first = parts[0]?.[0] || "?";
    const second = parts[1]?.[0] || "";
    return (first + second).toUpperCase();
}

export default function ChatPage() {
    const { rcptId } = useParams(); // /chat/:rcptId
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const { session } = useSelector((s) => s.auth);
    const threads = useSelector((s) => s.chat.threads);

    const [peer, setPeer] = useState(null);
    const [input, setInput] = useState("");
    const listRef = useRef(null);
    const [loadingPeer, setLoadingPeer] = useState(true);

    // protect route
    useEffect(() => {
        if (!session) navigate("/auth", { replace: true });
    }, [session, navigate]);

    // load peer from server by rcptId
    useEffect(() => {
        setLoadingPeer(true);
        const u = InMemoryServer.getUserByRcptId(rcptId);
        setPeer(u ? { email: u.email, rcpt_id: u.rcpt_id } : null);
        setLoadingPeer(false);
    }, [rcptId]);

    // autoscroll on new messages
    useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [threads, rcptId]);

    const myThreadKeyIncoming = useMemo(() => {
        // incoming messages are grouped by sender email in the slice
        return peer?.email || "inbox";
    }, [peer]);

    const items = useMemo(() => {
        const incoming = threads[myThreadKeyIncoming] || [];
        const outgoing = threads[rcptId] || [];
        // Merge and sort by ts (ISO)
        const merged = [...incoming, ...outgoing].sort((a, b) =>
            String(a.ts).localeCompare(String(b.ts))
        );
        return merged;
    }, [threads, myThreadKeyIncoming, rcptId]);

    const onSend = async () => {
        const text = input.trim();
        if (!text || !peer) return;
        const body = {
            v: 1,
            ts_client: new Date().toISOString(),
            msg_id: Math.random().toString(16).slice(2),
            message: text
        };
        // optimistic append
        dispatch(appendOutgoing({ toRcptId: rcptId, body }));
        setInput("");
        // real send
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
                    <IconButton onClick={() => navigate("/chats")} color="inherit">
                        <ArrowBackIcon />
                    </IconButton>
                    <Avatar sx={{ ml: 1, mr: 1, bgcolor: "primary.main", color: "#000" }}>
                        {initialsFromEmail(peer.email)}
                    </Avatar>
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle1">{peer.email}</Typography>
                        <Typography variant="caption" color="text.secondary">rcpt_id: {peer.rcpt_id}</Typography>
                    </Box>
                    <Tooltip title="Fetch inbox">
                        <IconButton onClick={onFetch} color="inherit">
                            <RefreshIcon />
                        </IconButton>
                    </Tooltip>
                </Toolbar>
            </AppBar>

            {/* messages */}
            <Box ref={listRef} sx={{ overflow: "auto", p: 2, bgcolor: "background.default" }}>
                {items.map((m) => (
                    <Box key={m.msg_id + m.ts} sx={{ display: "flex", mb: 1.2, justifyContent: m.direction === "out" ? "flex-end" : "flex-start" }}>
                        <Paper
                            sx={{
                                maxWidth: "70%",
                                p: 1.2,
                                borderRadius: 2,
                                bgcolor: m.direction === "out" ? "primary.main" : "background.paper",
                                color: m.direction === "out" ? "#000" : "text.primary",
                                boxShadow: "none"
                            }}
                        >
                            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {m.text}
                            </Typography>
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

            {/* composer */}
            <Box sx={{ p: 1.5, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <TextField
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type a message"
                    fullWidth
                    multiline
                    maxRows={4}
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton onClick={onSend} disabled={!input.trim()}>
                                    <SendIcon />
                                </IconButton>
                            </InputAdornment>
                        )
                    }}
                />
            </Box>
        </Box>
    );
}
