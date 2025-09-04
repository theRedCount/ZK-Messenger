# backend/app/websocket.py
from typing import Dict, Set
from fastapi import WebSocket
from asyncio import Lock

class WSManager:
    def __init__(self) -> None:
        self._by_rcpt: Dict[str, Set[WebSocket]] = {}
        self._lock = Lock()

    async def connect(self, rcpt_id: str, ws: WebSocket) -> None:
        # DO NOT call ws.accept() here; it's done in main.ws_inbox
        async with self._lock:
            self._by_rcpt.setdefault(rcpt_id, set()).add(ws)

    async def disconnect(self, rcpt_id: str, ws: WebSocket) -> None:
        async with self._lock:
            conns = self._by_rcpt.get(rcpt_id)
            if conns and ws in conns:
                conns.remove(ws)
            if conns and len(conns) == 0:
                self._by_rcpt.pop(rcpt_id, None)

    async def send_json(self, rcpt_id: str, data) -> None:
        # best-effort broadcast to all sockets of that rcpt_id
        conns = self._by_rcpt.get(rcpt_id, set()).copy()
        for ws in list(conns):
            try:
                await ws.send_json(data)
            except Exception:
                # drop dead connection
                await self.disconnect(rcpt_id, ws)

manager = WSManager()
