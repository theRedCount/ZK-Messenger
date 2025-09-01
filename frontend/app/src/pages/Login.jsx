// src/pages/Login.jsx
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { loginUser } from "../features/auth/authSlice";
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Grid,
  TextField,
  Typography,
  Alert
} from "@mui/material";

export default function Login() {
  const dispatch = useDispatch();
  const { loggingIn, error, session } = useSelector((s) => s.auth);

  const [email, setEmail] = useState("alice@example.com");
  const [password, setPassword] = useState("A9!xY7#kQ2@w");

  const onSubmit = (e) => {
    e.preventDefault();
    dispatch(loginUser({ email, password }));
  };

  return (
    <Grid container justifyContent="center" sx={{ mt: 6 }}>
      <Grid size={{ xs: 12, sm: 10, md: 8, lg: 6 }}>
        <Card elevation={2}>
          <CardHeader title="Login" subheader="Re-derive keys & open sealed master" />
          <CardContent>
            <Box component="form" onSubmit={onSubmit} noValidate>
              <Grid container spacing={2}>
                <Grid size={12}>
                  <TextField
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    fullWidth
                    required
                  />
                </Grid>
                <Grid size={12}>
                  <TextField
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    fullWidth
                    required
                  />
                </Grid>
                <Grid size={12}>
                  <Button type="submit" variant="contained" size="large" disabled={loggingIn} fullWidth>
                    {loggingIn ? <CircularProgress size={24} /> : "Login"}
                  </Button>
                </Grid>
                {error && (
                  <Grid size={12}>
                    <Alert severity="error">{error}</Alert>
                  </Grid>
                )}
              </Grid>
            </Box>

            {session && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle1" gutterBottom>
                  Session
                </Typography>
                <Box
                  sx={{
                    fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                    bgcolor: "#f6f6f6",
                    borderRadius: 1,
                    p: 2,
                    wordBreak: "break-all"
                  }}
                >
                  <div><strong>email:</strong> {session.email}</div>
                  <div><strong>rcpt_id:</strong> {session.rcpt_id}</div>
                  <div><strong>runtime_pub_ed (Ed25519):</strong> {session.runtime_pub_ed_b64}</div>
                  <div><strong>runtime_pub_x (X25519):</strong> {session.runtime_pub_x_b64}</div>
                </Box>
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}
