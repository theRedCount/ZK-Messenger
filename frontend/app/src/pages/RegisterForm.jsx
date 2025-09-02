// src/pages/RegisterForm.jsx
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { registerUser } from "../features/auth/authSlice";
import {
    Box,
    Button,
    CircularProgress,
    Grid,
    TextField,
    Alert,
    Typography,
    Backdrop
} from "@mui/material";
import PasswordField from "../components/PasswordField";

export default function RegisterForm() {
    const dispatch = useDispatch();
    const { registering, error, profile } = useSelector((s) => s.auth);

    const [email, setEmail] = useState("bob@example.com");
    const [password, setPassword] = useState("B7$hK4!mT9^z");

    const onSubmit = (e) => {
        e.preventDefault();
        dispatch(registerUser({ email, password }));
    };

    return (
        <>
            <Backdrop
                open={registering}
                sx={{ color: "#fff", zIndex: (theme) => theme.zIndex.drawer + 1 }}
            >
                <CircularProgress color="inherit" />
                <Typography variant="h6" sx={{ ml: 2 }}>
                    Generating secure keys...
                </Typography>
            </Backdrop>

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
                        <PasswordField
                            label="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            minLength={12}
                            helperTextMin="Password too short"
                            autoComplete="new-password"
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

                {profile && (
                    <Box sx={{ mt: 3 }}>
                        <Typography variant="subtitle1" gutterBottom>
                            Registered as {profile.email}
                        </Typography>
                    </Box>
                )}
            </Box>
        </>
    );
}
