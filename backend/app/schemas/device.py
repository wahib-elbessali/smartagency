from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.entities import DeviceStatus


class DeviceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    device_type: str = Field(min_length=2, max_length=80)
    mqtt_client_id: str = Field(min_length=2, max_length=150)
    mqtt_topic: str | None = Field(default=None, max_length=255)


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    device_type: str | None = Field(default=None, min_length=2, max_length=80)
    mqtt_client_id: str | None = Field(default=None, min_length=2, max_length=150)
    mqtt_topic: str | None = Field(default=None, max_length=255)
    status: DeviceStatus | None = None


class DeviceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    agency_id: str
    name: str
    device_type: str
    mqtt_client_id: str
    mqtt_topic: str
    status: DeviceStatus
    last_seen_at: datetime | None


class DeviceRegistrationResponse(DeviceResponse):
    device_key: str
