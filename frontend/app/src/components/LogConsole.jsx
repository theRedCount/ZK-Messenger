// src/components/LogConsole.jsx
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  Box,
  Paper,
  IconButton,
  Tooltip,
  Typography,
  Divider,
  Stack
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import { clearLogs } from "../features/logs/logSlice";

const LS_HEIGHT_KEY = "logConsole.height";
const LS_OPEN_KEY = "logConsole.open";
const LS_MAX_KEY = "logConsole.maximized";

export default function LogConsole() {
  const dispatch = useDispatch();
  const items = useSelector((s) => s.logs.items);

  // ---------- panel state ----------
  const defaultHeight = Number(localStorage.getItem(LS_HEIGHT_KEY) || 240);
  const defaultOpen = localStorage.getItem(LS_OPEN_KEY) === "true";
  const defaultMax = localStorage.getItem(LS_MAX_KEY) === "true";

  const [open, setOpen] = useState(defaultOpen);
  const [height, setHeight] = useState(defaultHeight); // px
  const [maximized, setMaximized] = useState(defaultMax);
  const [isResizing, setIsResizing] = useState(false);

  const containerRef = useRef(null);

  // ---------- persist state ----------
  useEffect(() => localStorage.setItem(LS_OPEN_KEY, String(open)), [open]);
  useEffect(() => localStorage.setItem(LS_MAX_KEY, String(maximized)), [maximized]);
  useEffect(() => {
    if (!maximized) localStorage.setItem(LS_HEIGHT_KEY, String(height));
  }, [height, maximized]);

  // ---------- autoscroll when open ----------
  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, items, height, maximized]);

  // ---------- computed text dump ----------
  const textDump = useMemo(
    () =>
      items
        .map((it) =>
          JSON.stringify(
            { ts: it.ts, level: it.level, msg: it.msg, data: it.data },
            null,
            2
          )
        )
        .join("\n"),
    [items]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textDump || "");
    } catch {
      /* no-op */
    }
  };

  // ---------- resize logic ----------
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  const minH = 120;
  const maxH = Math.floor(window.innerHeight * 0.9);

  const onMouseMove = useCallback((e) => {
    // Height = distance from pointer to bottom edge
    const proposed = window.innerHeight - e.clientY;
    const next = clamp(proposed, minH, maxH);
    setHeight(next);
  }, []);

  const endResize = useCallback(() => {
    setIsResizing(false);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", endResize);
    window.removeEventListener("mouseleave", endResize);
  }, [onMouseMove]);

  const startResize = (e) => {
    e.preventDefault();
    if (maximized) return; // disable drag while maximized
    setIsResizing(true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endResize);
    window.addEventListener("mouseleave", endResize);
  };

  // Double click on handle toggles maximize
  const toggleMaximize = () => setMaximized((m) => !m);

  // Close on ESC when maximized
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && maximized) setMaximized(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);

  // computed panel styles
  const panelHeight = maximized ? Math.floor(window.innerHeight * 0.96) : height;

  return (
    <>
      {/* Handle bar (collapsed state) */}
      {!open && (
        <Paper
          elevation={6}
          onClick={() => setOpen(true)}
          sx={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: 8,
            px: 2,
            py: 0.5,
            bgcolor: "background.paper",
            borderRadius: 2,
            display: "flex",
            alignItems: "center",
            gap: 1,
            cursor: "pointer",
            userSelect: "none",
            opacity: 0.9,
            zIndex: (t) => t.zIndex.snackbar
          }}
        >
          <ExpandMoreIcon fontSize="small" />
          <Typography variant="body2">Logs</Typography>
        </Paper>
      )}

      {/* Expanded / resizable console */}
      {open && (
        <Paper
          elevation={10}
          sx={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            height: panelHeight,
            display: "flex",
            flexDirection: "column",
            bgcolor: "background.paper",
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            boxShadow: "0 -8px 24px rgba(0,0,0,0.5)",
            zIndex: (t) => t.zIndex.drawer
          }}
        >
          {/* Drag handle / title bar */}
          <Box
            onMouseDown={startResize}
            onDoubleClick={toggleMaximize}
            sx={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              px: 2,
              py: 1,
              cursor: maximized ? "default" : "ns-resize",
              "&::after": {
                content: '""',
                position: "absolute",
                top: 0,
                left: "50%",
                transform: "translate(-50%, 0)",
                width: 40,
                height: 4,
                borderRadius: 999,
                bgcolor: "action.disabledOpacity",
                opacity: 0.5
              }
            }}
            aria-label="Resize log panel"
            title={maximized ? "Double click to restore" : "Drag to resize / Double click to maximize"}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
              <Typography variant="subtitle2">Logs</Typography>
              <Typography variant="caption" color="text.secondary">
                ({items.length})
              </Typography>
              {isResizing && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  Resizing…
                </Typography>
              )}
            </Stack>

            <Stack direction="row" spacing={1}>
              <Tooltip title={maximized ? "Restore" : "Maximize"}>
                <IconButton size="small" onClick={toggleMaximize}>
                  {maximized ? <CloseFullscreenIcon fontSize="small" /> : <OpenInFullIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Tooltip title="Copy all">
                <IconButton size="small" onClick={handleCopy}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Clear">
                <IconButton size="small" onClick={() => dispatch(clearLogs())}>
                  <DeleteSweepIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Close">
                <IconButton size="small" onClick={() => setOpen(false)}>
                  <ExpandLessIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Box>

          <Divider />

          {/* body */}
          <Box
            ref={containerRef}
            sx={{
              flex: 1,
              overflow: "auto",
              px: 2,
              py: 1,
              fontFamily: "ui-monospace, Menlo, Consolas, monospace",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }}
          >
            {items.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                (No logs)
              </Typography>
            ) : (
              items.map((it) => (
                <Box key={it.id} sx={{ mb: 1.5 }}>
                  <Typography variant="caption" sx={{ opacity: 0.75 }}>
                    [{it.level.toUpperCase()}] {it.ts}
                  </Typography>
                  <Box>{it.msg}</Box>
                  {it.data && (
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        mt: 0.5,
                        p: 1,
                        bgcolor: "rgba(255,255,255,0.04)",
                        borderRadius: 1,
                        overflow: "auto"
                      }}
                    >
                      {JSON.stringify(it.data, null, 2)}
                    </Box>
                  )}
                </Box>
              ))
            )}
          </Box>
        </Paper>
      )}
    </>
  );
}
