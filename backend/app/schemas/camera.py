from pydantic import BaseModel, ConfigDict, Field

from app.models.entities import DeviceStatus


class CameraCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    stream_url: str = Field(min_length=1, max_length=500)


class CameraUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    stream_url: str | None = Field(default=None, min_length=1, max_length=500)


class CameraResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    agency_id: str
    name: str
    stream_url: str | None
    status: DeviceStatus


class AIWeaponThresholdRequest(BaseModel):
    confidence: float = Field(gt=0, le=1)


class AIWeaponThresholdResponse(BaseModel):
    confidence: float
