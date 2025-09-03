# backend/app/main.py
from datetime import datetime
from typing import List, Tuple, Dict, Any

from fastapi import (
    FastAPI,
    HTTPException,
    status,
    Header,
    WebSocket,
    WebSocketDisconnect,
    Query,
    Depends,
)
from .models import RegisterIn, UserOut, UserRecord, EnvelopeIn, EnvelopeStored
from .storage import store
from .deps import setup_cors
from .security import (
    extract_bearer,
    parse_jws_compact,
    verify_times,
    replay_check,
    verify_eddsa_with_pub_b64,
)
from .websocket import manager


app = FastAPI(title="Uncontrollable Backend", version="1.2.0")
setup_cors(app)


@app.get("/health")
def health():
    return {"status": "ok", "ts": datetime.utcnow().isoformat() + "Z"}


# -------------------- Auth helper (Authorization + X-User-Email) --------------------
def auth_from_headers(
    Authorization: str = Header(None),
    X_User_Email: str = Header(None),
) -> Tuple[UserRecord, Dict[str, Any], Dict[str, Any]]:
    compact = extract_bearer(Authorization)
    header, payload, sig, signing_input = parse_jws_compact(compact)

    if header.get("alg") != "EdDSA":
        raise HTTPException(status_code=400, detail="alg must be EdDSA")

    email_hdr = (X_User_Email or "").strip()
    email_tok = (header.get("kid") or payload.get("sub") or "").strip()
    if not email_hdr or not email_tok:
        raise HTTPException(status_code=400, detail="Missing user identity")

    if email_hdr.lower() != email_tok.lower():
        raise HTTPException(status_code=401, detail="Email mismatch")

    user = store.get_user_by_email(email_hdr)
    if not user:
        raise HTTPException(status_code=401, detail="Unknown user")

    now = verify_times(int(payload.get("iat", 0)), int(payload.get("exp", 0)))
    replay_check(str(payload.get("jti", "")), now, int(payload.get("exp", now + 600)))
    verify_eddsa_with_pub_b64(user.sign_pub_det_b64, signing_input, sig)

    return user, header, payload


# -------------------- Public: Register --------------------
@app.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn):
    try:
        rec = store.create_user(payload)
    except ValueError as e:
        if str(e) == "duplicate-email":
            raise HTTPException(status_code=409, detail="Email is already registered")
        raise
    return UserOut(
        email=rec.email,
        rcpt_id=rec.rcpt_id,
        enc_pub_rand_b64=rec.enc_pub_rand_b64,
        sign_pub_det_b64=rec.sign_pub_det_b64,
    )


# -------------------- Protected: Login --------------------
@app.post("/login", response_model=UserRecord)
def login(auth=Depends(auth_from_headers)):
    user, _hdr, payload = auth
    if payload.get("act") not in ("login",):
        raise HTTPException(status_code=400, detail="Invalid act for login")
    return user


# -------------------- Protected: Users list --------------------
@app.get("/users", response_model=List[UserOut])
def users_list(auth=Depends(auth_from_headers)):
    _user, _hdr, _payload = auth
    users = store.list_users()
    return [
        UserOut(
            email=u.email,
            rcpt_id=u.rcpt_id,
            enc_pub_rand_b64=u.enc_pub_rand_b64,
            sign_pub_det_b64=u.sign_pub_det_b64,
        )
        for u in users
    ]


# -------------------- Protected: Send message --------------------
@app.post("/messages", status_code=status.HTTP_202_ACCEPTED)
async def post_message(envelope: EnvelopeIn, auth=Depends(auth_from_headers)):
    _user, _hdr, payload = auth
    if payload.get("act") not in ("send", "messages.send"):
        raise HTTPException(status_code=400, detail="Invalid act for messages")

    if not store.get_user_by_rcpt(envelope.rcpt_id):
        raise HTTPException(status_code=404, detail="Recipient not found")

    store.put_message(envelope)
    await manager.send_json(
        envelope.rcpt_id, {"type": "envelope", "data": {**envelope.dict()}}
    )
    return {"accepted": True}


# -------------------- Protected: Fetch inbox --------------------
@app.get("/inbox", response_model=List[EnvelopeStored])
def fetch_inbox(rcpt_id: str, auth=Depends(auth_from_headers)):
    user, _hdr, payload = auth
    if payload.get("act") not in ("fetch", "inbox.fetch"):
        raise HTTPException(status_code=400, detail="Invalid act for inbox")
    if user.rcpt_id != rcpt_id:
        raise HTTPException(status_code=403, detail="Forbidden for rcpt_id")
    return store.fetch_inbox(rcpt_id)


# -------------------- WebSocket: /ws/inbox?token=<JWS>&email=<user> --------------------
@app.websocket("/ws/inbox")
async def ws_inbox(
    ws: WebSocket,
    token: str = Query(..., description="JWS compact"),
    email: str = Query(..., description="User email"),
):
    await ws.accept()
    rcpt_id = None
    try:
        header, payload, sig, signing_input = parse_jws_compact(token)
        if header.get("alg") != "EdDSA":
            await ws.close(code=4400)
            return
        email_tok = (header.get("kid") or payload.get("sub") or "").strip()
        if not email or not email_tok or email.strip().lower() != email_tok.lower():
            await ws.close(code=4401)
            return

        user = store.get_user_by_email(email)
        if not user:
            await ws.close(code=4401)
            return

        _now = verify_times(int(payload.get("iat", 0)), int(payload.get("exp", 0)))
        # Optionally call replay_check here as well.
        verify_eddsa_with_pub_b64(user.sign_pub_det_b64, signing_input, sig)

        if payload.get("act") not in ("ws.open", "inbox.open"):
            await ws.close(code=4400)
            return

        rcpt_id = payload.get("rcpt_id")
        if not rcpt_id or rcpt_id != user.rcpt_id:
            await ws.close(code=4403)
            return

        await manager.connect(rcpt_id, ws)

        # Send pending (fetch & clear)
        pending = store.fetch_inbox(rcpt_id)
        if pending:
            await ws.send_json(
                {"type": "inbox.init", "data": [e.dict() for e in pending]}
            )

        # Keepalive loop; client may send "ping" messages
        while True:
            _ = await ws.receive_text()

    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await ws.close(code=1011)
        except Exception:
            pass
    finally:
        if rcpt_id:
            try:
                await manager.disconnect(rcpt_id, ws)
            except Exception:
                pass
