from fastapi import FastAPI

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
from app.api.internal import router as internal_router
from app.api.thresholds import router as thresholds_router
from app.mqtt.attendance_consumer import attendance_consumer
from app.mqtt.sensor_consumer import sensor_consumer
from app.ai_alerts.consumer import weapon_alert_consumer
from app.websocket.attendance import router as attendance_websocket_router


app = FastAPI(
    title="Systeme de Gestion des Agences & IoT",
    version="0.1.0",
    description="API backend pour la gestion des agences, des visiteurs et des appareils IoT.",
)

app.include_router(auth_router, prefix="/api")
app.include_router(agencies_router, prefix="/api")
app.include_router(employees_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(attendance_router, prefix="/api")
app.include_router(visitors_router, prefix="/api")
app.include_router(tickets_router, prefix="/api")
app.include_router(services_router, prefix="/api")
app.include_router(devices_router, prefix="/api")
app.include_router(cameras_router, prefix="/api")
app.include_router(ai_alerts_router, prefix="/api")
app.include_router(internal_router)
app.include_router(thresholds_router, prefix="/api")
app.include_router(attendance_websocket_router)


@app.on_event("startup")
def start_mqtt_consumer() -> None:
    attendance_consumer.start()
    sensor_consumer.start()
    weapon_alert_consumer.start()


@app.on_event("shutdown")
def stop_mqtt_consumer() -> None:
    attendance_consumer.stop()
    sensor_consumer.stop()
    weapon_alert_consumer.stop()


@app.get("/health", tags=["System"])
def health_check() -> dict[str, str]:
    """Retourne l'etat de fonctionnement de l'API."""
    return {"status": "ok"}
