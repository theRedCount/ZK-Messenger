// src/components/LogConsole.jsx
import { useMemo, useRef, useState, useEffect } from "react";
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
import { clearLogs } from "../features/logs/logSlice";

export default function LogConsole() {
  const dispatch = useDispatch();
  const items = useSelector((s) => s.logs.items);

  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // autoscroll to bottom when open
  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, items]);

  const textDump = useMemo(() => {
    return items
      .map((it) =>
        JSON.stringify(
          {
            ts: it.ts,
            level: it.level,
            msg: it.msg,
            data: it.data
          },
          null,
          2
        )
      )
      .join("\n");
  }, [items]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(textDump);
    } catch {
      // ignore
    }
  };

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
            opacity: 0.9
          }}
        >
          <ExpandMoreIcon fontSize="small" />
          <Typography variant="body2">Logs</Typography>
        </Paper>
      )}

      {/* Expanded console */}
      {open && (
        <Paper
          elevation={10}
          sx={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: "background.paper",
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            boxShadow: "0 -8px 24px rgba(0,0,0,0.5)"
          }}
        >
          {/* header */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              px: 2,
              py: 1
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
              <Typography variant="subtitle2">Logs</Typography>
              <Typography variant="caption" color="text.secondary">
                ({items.length})
              </Typography>
            </Stack>

            <Stack direction="row" spacing={1}>
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
              maxHeight: 260,
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
