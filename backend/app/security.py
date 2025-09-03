import base64, json, time
from typing import Tuple, Dict, Any
from fastapi import HTTPException

from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError

# ---- base64url helpers ----
def b64url_decode_to_bytes(s: str) -> bytes:
    pad = '=' * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)

def parse_jws_compact(jws: str) -> Tuple[Dict[str, Any], Dict[str, Any], bytes, bytes]:
    try:
        header_b64, payload_b64, sig_b64 = jws.split(".")
        header = json.loads(b64url_decode_to_bytes(header_b64))
        payload_bytes = b64url_decode_to_bytes(payload_b64)
        payload = json.loads(payload_bytes)
        sig = b64url_decode_to_bytes(sig_b64)
        signing_input = (header_b64 + "." + payload_b64).encode("ascii")
        return header, payload, sig, signing_input
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JWS format")

# ---- anti-replay cache (in-memory) ----
_JTI_CACHE: Dict[str, int] = {}  # jti -> exp_ts
_JTI_TTL_SEC = 600               # 10 minutes

def replay_check(jti: str, now: int, exp: int):
    if not jti:
        raise HTTPException(status_code=400, detail="Missing jti")
    # sweep
    for k, v in list(_JTI_CACHE.items()):
        if v < now:
            _JTI_CACHE.pop(k, None)
    if jti in _JTI_CACHE:
        raise HTTPException(status_code=401, detail="Replay detected")
    _JTI_CACHE[jti] = max(exp, now + _JTI_TTL_SEC)

def verify_times(iat: int, exp: int, leeway: int = 60) -> int:
    now = int(time.time())
    if not iat or not exp:
        raise HTTPException(status_code=400, detail="Missing iat/exp")
    if iat > now + leeway:
        raise HTTPException(status_code=401, detail="iat in the future")
    if exp < now - leeway:
        raise HTTPException(status_code=401, detail="Token expired")
    return now


def _b64_any_to_bytes(s: str) -> bytes:
    s = s.strip()
    # try standard base64 first
    try:
        return base64.b64decode(s, validate=False)
    except Exception:
        pass
    # try urlsafe base64 (add padding if missing)
    try:
        pad = '=' * (-len(s) % 4)
        return base64.urlsafe_b64decode(s + pad)
    except Exception:
        raise HTTPException(status_code=500, detail="Server key decode error")

        
def verify_eddsa_with_pub_b64(pub_b64_std_or_url: str, signing_input: bytes, signature: bytes):
    try:
        pub_bytes = _b64_any_to_bytes(pub_b64_std_or_url)
    except HTTPException:
        # re-raise same error
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Server key decode error")
    try:
        VerifyKey(pub_bytes).verify(signing_input, signature)
    except BadSignatureError:
        raise HTTPException(status_code=401, detail="Bad JWS signature")

# ---- Authorization: Bearer <compact> ----
def extract_bearer(authorization: str) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    return authorization.split(" ", 1)[1].strip()
