import { useState } from "react";
import {
  TextField,
  IconButton,
  InputAdornment
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";

export default function PasswordField({
  label = "Password",
  value,
  onChange,
  minLength,                    // e.g. 12 (optional)
  validateOnChange = true,      // validate while typing (or only after blur)
  helperTextMin = "Minimum length not met",
  autoComplete = "new-password",
  ...rest
}) {
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);

  const shouldValidate = validateOnChange ? true : touched;
  const tooShort = typeof minLength === "number" && (value?.length || 0) < minLength;
  const error = shouldValidate && tooShort;
  const helperText = error ? `${helperTextMin} (${minLength}+ characters)` : undefined;

  return (
    <TextField
      label={label}
      type={show ? "text" : "password"}
      value={value}
      onChange={onChange}
      onBlur={() => setTouched(true)}
      error={error}
      helperText={helperText}
      fullWidth
      required
      autoComplete={autoComplete}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              onClick={() => setShow((prev) => !prev)}
              edge="end"
              aria-label="toggle password visibility"
            >
              {show ? <VisibilityOff /> : <Visibility />}
            </IconButton>
          </InputAdornment>
        )
      }}
      {...rest}
    />
  );
}
