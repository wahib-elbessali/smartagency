from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import decode_token
from app.websocket.manager import attendance_manager


router = APIRouter(tags=["Attendance WebSocket"])


@router.websocket("/ws/attendance")
async def attendance_websocket(websocket: WebSocket, token: str) -> None:
    try:
        decode_token(token)
    except Exception:
        await websocket.close(code=1008)
        return

    await attendance_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        attendance_manager.disconnect(websocket)
