// src/pages/ChatList.jsx
import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { loadUsers } from "../features/users/usersSlice";
import {
    AppBar,
    Toolbar,
    Typography,
    Box,
    TextField,
    InputAdornment,
    List,
    ListItemButton,
    ListItemAvatar,
    Avatar,
    ListItemText,
    CircularProgress,
    IconButton,
    Tooltip
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import LogoutIcon from "@mui/icons-material/Logout";
import { useNavigate } from "react-router-dom";
import { resetAuth } from "../features/auth/authSlice";

function initialsFromEmail(email) {
    const name = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, " ").trim();
    const parts = name.split(/\s+/);
    const first = parts[0]?.[0] || "?";
    const second = parts[1]?.[0] || "";
    return (first + second).toUpperCase();
}

export default function ChatList() {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { session } = useSelector((s) => s.auth);
    const { loading, items } = useSelector((s) => s.users);

    const [q, setQ] = useState("");

    // protect route
    useEffect(() => {
        if (!session) navigate("/auth", { replace: true });
    }, [session, navigate]);

    useEffect(() => {
        if (session) dispatch(loadUsers());
    }, [dispatch, session]);

    const filtered = useMemo(() => {
        const qq = q.trim().toLowerCase();
        if (!qq) return items;
        return items.filter(u => u.email.toLowerCase().includes(qq));
    }, [items, q]);

    const onOpenChat = (user) => {
        navigate(`/chat/${user.rcpt_id}`);
    };

    const onLogout = () => {
        dispatch(resetAuth());
        navigate("/auth", { replace: true });
    };

    return (
        <Box sx={{ height: "100vh", display: "grid", gridTemplateRows: "auto 56px 1fr" }}>
            <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <Toolbar>
                    <Typography variant="h6" sx={{ flex: 1, fontWeight: 700 }}>
                        Uncontrollable
                    </Typography>
                    <Tooltip title={`Logged as ${session?.email || ""}`}>
                        <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                            {session?.email}
                        </Typography>
                    </Tooltip>
                    <Tooltip title="Logout">
                        <IconButton onClick={onLogout} color="inherit" size="small">
                            <LogoutIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Toolbar>
            </AppBar>

            <Box sx={{ p: 1.5 }}>
                <TextField
                    placeholder="Search users"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    fullWidth
                    size="small"
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon fontSize="small" />
                            </InputAdornment>
                        )
                    }}
                />
            </Box>

            <Box sx={{ overflow: "auto" }}>
                {loading ? (
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                        <CircularProgress />
                    </Box>
                ) : (
                    <List disablePadding>
                        {filtered.map((u) => (
                            <ListItemButton
                                key={u.rcpt_id}
                                onClick={() => onOpenChat(u)}
                                sx={{
                                    px: 2,
                                    py: 1.2,
                                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                                    "&:hover": { bgcolor: "rgba(255,255,255,0.04)" }
                                }}
                            >
                                <ListItemAvatar>
                                    <Avatar sx={{ bgcolor: "primary.main", color: "#000" }}>
                                        {initialsFromEmail(u.email)}
                                    </Avatar>
                                </ListItemAvatar>
                                <ListItemText
                                    primary={u.email}
                                    secondary={`rcpt_id: ${u.rcpt_id}`}
                                    secondaryTypographyProps={{ noWrap: true }}
                                />
                            </ListItemButton>
                        ))}
                        {filtered.length === 0 && (
                            <Box sx={{ p: 3, textAlign: "center", color: "text.secondary" }}>
                                <Typography variant="body2">No users found</Typography>
                            </Box>
                        )}
                    </List>
                )}
            </Box>
        </Box>
    );
}
