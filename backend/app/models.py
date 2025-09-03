from pydantic import BaseModel, EmailStr, Field
from typing import List
from datetime import datetime

# ---------- Users ----------
class RegisterIn(BaseModel):
    email: EmailStr
    sign_pub_det_b64: str  # Ed25519 public (deterministic)
    enc_pub_rand_b64: str  # X25519 public (random)
    c_master_b64: str      # sealed master (sealed to deterministic X25519)

class UserRecord(BaseModel):
    email: EmailStr
    sign_pub_det_b64: str
    enc_pub_rand_b64: str
    c_master_b64: str
    version: str = "v1;a2id:t=3,m=64;hkdf:v1"
    rcpt_id: str

class UserOut(BaseModel):
    email: EmailStr
    rcpt_id: str
    enc_pub_rand_b64: str
    sign_pub_det_b64: str

# ---------- Envelopes ----------
class EnvelopeIn(BaseModel):
    v: int = 1
    rcpt_id: str
    ts_client: datetime
    eph_pub_b64: str
    nonce_b64: str
    ct_b64: str

class EnvelopeStored(EnvelopeIn):
    ts_server: datetime
