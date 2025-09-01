// src/pages/Register.jsx
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { registerUser } from "../features/auth/authSlice";
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
  Alert,
  Backdrop
} from "@mui/material";

export default function Register() {
  const dispatch = useDispatch();
  const { registering, error, profile } = useSelector((s) => s.auth);

  const [email, setEmail] = useState("alice@example.com");
  const [password, setPassword] = useState("A9!xY7#kQ2@w");

  const onSubmit = (e) => {
    e.preventDefault();
    dispatch(registerUser({ email, password }));
  };

  return (
    <>
      {/* Fullscreen overlay while registering */}
      <Backdrop
        open={registering}
        sx={{ color: "#fff", zIndex: (theme) => theme.zIndex.drawer + 1 }}
      >
        <CircularProgress color="inherit" />
        <Typography variant="h6" sx={{ ml: 2 }}>
          Generating secure keys...
        </Typography>
      </Backdrop>

      <Grid container justifyContent="center" sx={{ mt: 6 }}>
        <Grid size={{ xs: 12, sm: 10, md: 8, lg: 6 }}>
          <Card elevation={2}>
            <CardHeader title="Register" subheader="Derive keys & store sealed master" />
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
                      label="Password (min 12 chars)"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      fullWidth
                      required
                    />
                  </Grid>
                  <Grid size={12}>
                    <Button
                      type="submit"
                      variant="contained"
                      size="large"
                      disabled={registering}
                      fullWidth
                    >
                      Register
                    </Button>
                  </Grid>
                  {error && (
                    <Grid size={12}>
                      <Alert severity="error">{error}</Alert>
                    </Grid>
                  )}
                </Grid>
              </Box>

              {profile && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="subtitle1" gutterBottom>
                    Public keys (on server) & sealed master
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
                    <div><strong>email:</strong> {profile.email}</div>
                    <div><strong>rcpt_id:</strong> {profile.rcpt_id}</div>
                    <div><strong>sign_pub_det (Ed25519):</strong> {profile.sign_pub_det_b64}</div>
                    <div><strong>enc_pub_rand (X25519):</strong> {profile.enc_pub_rand_b64}</div>
                    <div><strong>c_master (sealed):</strong> {profile.c_master_b64}</div>
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
