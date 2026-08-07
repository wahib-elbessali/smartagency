from fastapi import FastAPI

from app.api.auth import router as auth_router
from app.api.agencies import router as agencies_router
from app.api.employees import router as employees_router
from app.api.users import router as users_router
from app.api.attendance import router as attendance_router
from app.api.visitors import router as visitors_router
from app.api.tickets import router as tickets_router
from app.mqtt.attendance_consumer import attendance_consumer
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
app.include_router(attendance_websocket_router)


@app.on_event("startup")
def start_mqtt_consumer() -> None:
    attendance_consumer.start()


@app.on_event("shutdown")
def stop_mqtt_consumer() -> None:
    attendance_consumer.stop()


@app.get("/health", tags=["System"])
def health_check() -> dict[str, str]:
    """Retourne l'etat de fonctionnement de l'API."""
    return {"status": "ok"}
