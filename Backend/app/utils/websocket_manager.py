import asyncio
import logging
from fastapi import WebSocket

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Maps call_id -> set of subscriber WebSockets
        self.live_analysis_subscribers: dict[str, set[WebSocket]] = {}
        # Maps user_id -> set of user signaling WebSockets
        self.user_signaling_connections: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect_user(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            if user_id not in self.user_signaling_connections:
                self.user_signaling_connections[user_id] = set()
            self.user_signaling_connections[user_id].add(websocket)
        logger.info(f"User signaling WebSocket connected for user_id: {user_id}")

    async def disconnect_user(self, user_id: str, websocket: WebSocket):
        async with self._lock:
            if user_id in self.user_signaling_connections:
                self.user_signaling_connections[user_id].discard(websocket)
                if not self.user_signaling_connections[user_id]:
                    del self.user_signaling_connections[user_id]
        logger.info(f"User signaling WebSocket disconnected for user_id: {user_id}")

    async def send_to_user(self, user_id: str, message: dict):
        sockets = set()
        async with self._lock:
            if user_id in self.user_signaling_connections:
                sockets = set(self.user_signaling_connections[user_id])

        disconnected = set()
        for ws in sockets:
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.warning(f"Error sending message to user {user_id}: {e}")
                disconnected.add(ws)

        if disconnected:
            async with self._lock:
                if user_id in self.user_signaling_connections:
                    self.user_signaling_connections[user_id].difference_update(disconnected)

    async def connect_analysis(self, call_id: str, websocket: WebSocket):
        await websocket.accept()
        async with self._lock:
            if call_id not in self.live_analysis_subscribers:
                self.live_analysis_subscribers[call_id] = set()
            self.live_analysis_subscribers[call_id].add(websocket)
        logger.info(f"WebSocket client connected for call_id: {call_id}")

    async def disconnect_analysis(self, call_id: str, websocket: WebSocket):
        async with self._lock:
            if call_id in self.live_analysis_subscribers:
                self.live_analysis_subscribers[call_id].discard(websocket)
                if not self.live_analysis_subscribers[call_id]:
                    del self.live_analysis_subscribers[call_id]
        logger.info(f"WebSocket client disconnected for call_id: {call_id}")

    async def broadcast_to_call(self, call_id: str, message: dict):
        subscribers = set()
        async with self._lock:
            if call_id in self.live_analysis_subscribers:
                subscribers = set(self.live_analysis_subscribers[call_id])

        disconnected = set()
        for websocket in subscribers:
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.warning(f"Error sending message to client on call {call_id}: {e}")
                disconnected.add(websocket)

        if disconnected:
            async with self._lock:
                if call_id in self.live_analysis_subscribers:
                    self.live_analysis_subscribers[call_id].difference_update(disconnected)

    async def emit_call_event(self, call_id: str, event: str, payload: dict):
        """
        Emits an event to the call room across both WebSocket subscribers and Socket.IO.
        """
        message = {"type": event, "event": event, **payload}
        await self.broadcast_to_call(call_id, message)
        global sio_server
        if sio_server is not None:
            try:
                await sio_server.emit(event, payload, room=call_id)
            except Exception as exc:
                logger.warning(f"Error emitting Socket.IO event {event} to call {call_id}: {exc}")

sio_server = None

def set_sio_server(server):
    global sio_server
    sio_server = server

manager = ConnectionManager()


