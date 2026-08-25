from datetime import datetime
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import (
    Alert,
    AlertSeverity,
    AlertStatus,
    Device,
    DeviceStatus,
    SensorReading,
    SensorThreshold,
)
from app.schemas.sensor import SensorPayload


PublishCommand = Callable[[str, dict], None]


def command_topic(agency_id: str, device_id: str, command: str) -> str:
    return f"agency/{agency_id}/device/{device_id}/{command}"


def severity_for(value: float, threshold: SensorThreshold) -> AlertSeverity | None:
    if threshold.critical_max is not None and value >= threshold.critical_max:
        return AlertSeverity.CRITICAL
    if threshold.warning_max is not None and value >= threshold.warning_max:
        return AlertSeverity.HIGH
    return None


def process_sensor_payload(
    db: Session,
    agency_id: str,
    device_id: str,
    payload: SensorPayload,
) -> list[tuple[str, dict]]:
    device = db.scalar(
        select(Device).where(
            Device.agency_id == agency_id,
            Device.mqtt_client_id == device_id,
        )
    )
    if device is None:
        raise ValueError("Unregistered MQTT device")

    thresholds = {
        threshold.sensor_type: threshold
        for threshold in db.scalars(
            select(SensorThreshold).where(
                SensorThreshold.device_id == device.id,
                SensorThreshold.is_active.is_(True),
            )
        ).all()
    }
    commands: list[tuple[str, dict]] = []
    recorded_at = payload.timestamp

    device.status = DeviceStatus.ONLINE
    device.last_seen_at = recorded_at

    for item in payload.readings:
        sensor_type = item.sensor_type.strip().lower()
        threshold = thresholds.get(sensor_type)
        unit = item.unit or (threshold.unit if threshold else None)
        db.add(
            SensorReading(
                device_id=device.id,
                sensor_type=sensor_type,
                value=item.value,
                unit=unit,
                recorded_at=recorded_at,
            )
        )

        if threshold is None:
            continue

        alert_type = sensor_type
        active_alert = db.scalar(
            select(Alert).where(
                Alert.device_id == device.id,
                Alert.alert_type == alert_type,
                Alert.status.in_([AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED]),
            )
        )
        severity = severity_for(item.value, threshold)
        value_text = f"{item.value:g} {unit or ''}".strip()

        if severity is not None:
            changed = active_alert is None or active_alert.severity != severity
            if active_alert is None:
                active_alert = Alert(
                    agency_id=agency_id,
                    device_id=device.id,
                    alert_type=alert_type,
                    title=f"Alerte {sensor_type}",
                    message=f"Valeur depassee: {value_text}",
                    severity=severity,
                    status=AlertStatus.OPEN,
                )
                db.add(active_alert)
            else:
                active_alert.severity = severity
                active_alert.message = f"Valeur depassee: {value_text}"
            if changed:
                commands.append(
                    (
                        command_topic(agency_id, device_id, "alert"),
                        {
                            "alert_type": alert_type,
                            "active": True,
                            "severity": severity.value,
                        },
                    )
                )
        elif active_alert is not None:
            active_alert.status = AlertStatus.RESOLVED
            active_alert.resolved_at = recorded_at
            commands.append(
                (
                    command_topic(agency_id, device_id, "alert"),
                    {
                        "alert_type": alert_type,
                        "active": False,
                        "severity": "LOW",
                    },
                )
            )

        # The climate actuator follows the configured temperature warning limit.
        # Publishing the current state on every reading keeps the actuator safe
        # after a backend or broker restart.
        if sensor_type == "temperature" and threshold.warning_max is not None:
            commands.append(
                (
                    command_topic(agency_id, device_id, "climate"),
                    {"active": item.value >= threshold.warning_max},
                )
            )

    db.commit()
    return commands
