from datetime import time

from pydantic import BaseModel, ConfigDict, Field


class ZoneCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    zone_type: str = Field(default="PUBLIC", max_length=50)
    is_private: bool = False


class ZoneResponse(ZoneCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str


class CounterCreate(BaseModel):
    number: int = Field(ge=1)
    name: str | None = Field(default=None, max_length=100)
    is_open: bool = True


class CounterResponse(CounterCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str


class AgencyCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    opening_time: time | None = None
    closing_time: time | None = None
    zones: list[ZoneCreate] = Field(default_factory=list)
    counters: list[CounterCreate] = Field(default_factory=list)


class AgencyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    address: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    opening_time: time | None = None
    closing_time: time | None = None
    is_active: bool | None = None


class AgencyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    address: str | None
    phone: str | None
    opening_time: time | None
    closing_time: time | None
    is_active: bool
    zones: list[ZoneResponse] = Field(default_factory=list)
    counters: list[CounterResponse] = Field(default_factory=list)
    employees_count: int = 0
    devices_count: int = 0
    cameras_count: int = 0
