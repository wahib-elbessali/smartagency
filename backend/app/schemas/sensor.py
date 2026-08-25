from datetime import datetime

from pydantic import BaseModel, Field


class SensorReadingPayload(BaseModel):
    sensor_type: str = Field(min_length=1, max_length=80)
    value: float
    unit: str | None = Field(default=None, max_length=20)


class SensorPayload(BaseModel):
    readings: list[SensorReadingPayload] = Field(min_length=1, max_length=50)
    timestamp: datetime
