from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.auth import router as auth_router
from app.api.agencies import router as agencies_router
from app.api.employees import router as employees_router
from app.api.users import router as users_router
from app.api.attendance import router as attendance_router
from app.api.visitors import router as visitors_router
from app.api.tickets import router as tickets_router
from app.api.services import router as services_router
from app.api.devices import router as devices_router
from app.api.cameras import router as cameras_router
from app.api.ai_alerts import router as ai_alerts_router
from app.api.assignments import router as assignments_router
from app.api.internal import router as internal_router
from app.api.ticket_templates import router as ticket_templates_router
from app.api.thresholds import router as thresholds_router
from app.api.ai_calibration import router as ai_calibration_router
from app.api.ai_people import router as ai_people_router
from app.api.ai_zoning import router as ai_zoning_router
from app.api.employee_activity import router as employee_activity_router
from app.api.face_recognition import ai_router as ai_face_router
from app.api.face_recognition import employee_router as employee_face_router
from app.api.wanted import router as wanted_router
from app.mqtt.attendance_consumer import attendance_consumer
from app.mqtt.sensor_consumer import sensor_consumer
from app.ai_alerts.consumer import ai_alert_consumers
from app.integrations.ai_client import AIClientError
from app.services.ai_camera_sync import ai_camera_sync
from app.websocket.attendance import router as attendance_websocket_router
from app.websocket.ai_proxy import router as ai_websocket_router


app = FastAPI(
    title="Systeme de Gestion des Agences & IoT",
    version="0.1.0",
    description="API backend pour la gestion des agences, des visiteurs et des appareils IoT.",
)


@app.exception_handler(AIClientError)
async def handle_ai_client_error(_request: Request, exc: AIClientError) -> JSONResponse:
    """Expose AI failures as controlled JSON responses to backend clients."""
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

app.include_router(auth_router, prefix="/api")
app.include_router(agencies_router, prefix="/api")
app.include_router(employee_face_router, prefix="/api")
app.include_router(employees_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(attendance_router, prefix="/api")
app.include_router(visitors_router, prefix="/api")
app.include_router(tickets_router, prefix="/api")
app.include_router(services_router, prefix="/api")
app.include_router(devices_router, prefix="/api")
app.include_router(cameras_router, prefix="/api")
app.include_router(ai_alerts_router, prefix="/api")
app.include_router(assignments_router, prefix="/api")
app.include_router(internal_router)
app.include_router(ticket_templates_router, prefix="/api")
app.include_router(thresholds_router, prefix="/api")
app.include_router(ai_calibration_router, prefix="/api")
app.include_router(ai_people_router, prefix="/api")
app.include_router(ai_zoning_router, prefix="/api")
app.include_router(employee_activity_router)
app.include_router(ai_face_router, prefix="/api")
app.include_router(wanted_router, prefix="/api")
app.include_router(attendance_websocket_router)
app.include_router(ai_websocket_router)


@app.on_event("startup")
def start_mqtt_consumer() -> None:
    attendance_consumer.start()
    sensor_consumer.start()
    ai_camera_sync.start()
    ai_alert_consumers.start()


@app.on_event("shutdown")
def stop_mqtt_consumer() -> None:
    attendance_consumer.stop()
    sensor_consumer.stop()
    ai_alert_consumers.stop()
    ai_camera_sync.stop()


@app.get("/health", tags=["System"])
def health_check() -> dict[str, str]:
    """Retourne l'etat de fonctionnement de l'API."""
    return {"status": "ok"}
