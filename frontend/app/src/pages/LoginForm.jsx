// src/pages/LoginForm.jsx
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { loginUser } from "../features/auth/authSlice";
import {
    Box,
    Button,
    CircularProgress,
    Grid,
    TextField,
    Alert,
    Typography
} from "@mui/material";
import PasswordField from "../components/PasswordField";


export default function LoginForm() {
    const dispatch = useDispatch();
    const { loggingIn, error, session } = useSelector((s) => s.auth);

    const [email, setEmail] = useState("alice@example.com");
    const [password, setPassword] = useState("A9!xY7#kQ2@w");

    const onSubmit = (e) => {
        e.preventDefault();
        dispatch(loginUser({ email, password }));
    };

    return (
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
                    />
                </Grid>
                <Grid size={12}>
                    <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        disabled={loggingIn}
                        fullWidth
                    >
                        {loggingIn ? <CircularProgress size={24} /> : "Login"}
                    </Button>
                </Grid>
                {error && (
                    <Grid size={12}>
                        <Alert severity="error">{error}</Alert>
                    </Grid>
                )}
            </Grid>

            {session && (
                <Box sx={{ mt: 3 }}>
                    <Typography variant="subtitle1" gutterBottom>
                        Logged in as {session.email}
                    </Typography>
                </Box>
            )}
        </Box>
    );
}
