// src/pages/Auth.jsx
import { useState } from "react";
import { Tabs, Tab, Box, Card, CardContent, Typography } from "@mui/material";
import LoginForm from "./LoginForm";
import RegisterForm from "./RegisterForm";
import { motion, AnimatePresence } from "framer-motion";

export default function Auth() {
  const [tab, setTab] = useState(0);

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        bgcolor: "background.default"
      }}
    >
      <Card
        sx={{
          width: 420,
          borderRadius: 4
        }}
      >
        <Box sx={{ p: 3, textAlign: "center", bgcolor: "background.paper" }}>
          <Typography variant="h5" fontWeight="bold" color="primary">
            ZK Messenger
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Zero Knowledge Messaging
          </Typography>
        </Box>

        <CardContent sx={{ p: 4 }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            centered
            variant="fullWidth"
            sx={{
              mb: 3,
              "& .MuiTab-root": {
                fontWeight: "bold"
              },
              "& .Mui-selected": {
                color: "primary.main !important"
              },
              "& .MuiTabs-indicator": {
                backgroundColor: "primary.main"
              }
            }}
          >
            <Tab label="Login" />
            <Tab label="Register" />
          </Tabs>

          <AnimatePresence mode="wait">
            {tab === 0 && (
              <motion.div
                key="login"
                initial={{ opacity: 0, x: -40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 40 }}
                transition={{ duration: 0.3 }}
              >
                <LoginForm />
              </motion.div>
            )}
            {tab === 1 && (
              <motion.div
                key="register"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.3 }}
              >
                <RegisterForm />
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </Box>
  );
}
