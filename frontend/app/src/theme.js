// src/theme.js
import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#25D366"
    },
    secondary: {
      main: "#128C7E"
    },
    background: {
      default: "#121212",
      paper: "#1E1E1E"
    },
    text: {
      primary: "#E0E0E0",
      secondary: "#B0B0B0"
    }
  },
  shape: {
    borderRadius: 12
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: "bold",
          borderRadius: 10
        }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)"
        }
      }
    }
  }
});

export default theme;
