import threading
from typing import Dict, List, Optional
from datetime import datetime, timezone
from uuid import uuid4
from .models import UserRecord, EnvelopeStored, RegisterIn, EnvelopeIn

class MemoryStore:
    def __init__(self):
        self._users: Dict[str, UserRecord] = {}
        self._by_rcpt: Dict[str, str] = {}
        self._inboxes: Dict[str, List[EnvelopeStored]] = {}
        self._lock = threading.RLock()

    # Users
    def get_user_by_email(self, email: str) -> Optional[UserRecord]:
        with self._lock:
            return self._users.get(email)

    def get_user_by_rcpt(self, rcpt_id: str) -> Optional[UserRecord]:
        with self._lock:
            email = self._by_rcpt.get(rcpt_id)
            return self._users.get(email) if email else None

    def list_users(self) -> List[UserRecord]:
        with self._lock:
            return list(self._users.values())

    def create_user(self, payload: RegisterIn) -> UserRecord:
        with self._lock:
            if payload.email in self._users:
                raise ValueError("duplicate-email")
            rcpt_id = str(uuid4())
            rec = UserRecord(
                email=payload.email,
                sign_pub_det_b64=payload.sign_pub_det_b64,
                enc_pub_rand_b64=payload.enc_pub_rand_b64,
                c_master_b64=payload.c_master_b64,
                rcpt_id=rcpt_id,
            )
            self._users[payload.email] = rec
            self._by_rcpt[rcpt_id] = payload.email
            self._inboxes.setdefault(rcpt_id, [])
            return rec

    # Messages
    def put_message(self, env: EnvelopeIn) -> None:
        with self._lock:
            if env.rcpt_id not in self._inboxes:
                self._inboxes[env.rcpt_id] = []
            stored = EnvelopeStored(**env.dict(), ts_server=datetime.now(timezone.utc))
            self._inboxes[env.rcpt_id].append(stored)

    def fetch_inbox(self, rcpt_id: str) -> List[EnvelopeStored]:
        with self._lock:
            arr = self._inboxes.get(rcpt_id, [])
            self._inboxes[rcpt_id] = []
            return arr

store = MemoryStore()
