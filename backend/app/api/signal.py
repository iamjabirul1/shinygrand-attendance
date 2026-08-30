from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from ..core.security import decode_token
import asyncio

router = APIRouter()

# In-memory signaling rooms per station_id: set of websockets
rooms: dict[str, set[WebSocket]] = {}

@router.websocket("/ws/signal")
async def signal_ws(websocket: WebSocket, station_id: str = Query(...), token: str = Query("")):
    # validate token (station scope)
    try:
        payload = decode_token(token)
        if payload.get("scope") != "station" or payload.get("station_id") != station_id:
            await websocket.close(code=4001)
            return
    except:
        await websocket.close(code=4001)
        return

    await websocket.accept()
    rooms.setdefault(station_id, set()).add(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # broadcast to others in same room
            for ws in list(rooms.get(station_id, [])):
                if ws is not websocket:
                    try:
                        await ws.send_text(data)
                    except:
                        pass
    except WebSocketDisconnect:
        pass
    finally:
        rooms.get(station_id, set()).discard(websocket)
