from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


PointType = Literal["COUNTER", "OFFICE"]


class ServiceCreate(BaseModel):
    code: str = Field(min_length=2, max_length=50, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=500)
    point_type: PointType = "COUNTER"
    min_points: int = Field(default=1, ge=1, le=100)
    is_active: bool = True


class ServiceUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=2, max_length=50, pattern=r"^[A-Za-z0-9_-]+$")
    name: str | None = Field(default=None, min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=500)
    point_type: PointType | None = None
    min_points: int | None = Field(default=None, ge=1, le=100)
    is_active: bool | None = None


class ServiceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    agency_id: str
    code: str
    name: str
    description: str | None
    point_type: PointType
    min_points: int
    is_active: bool


class ServicePointResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    agency_id: str
    service_id: str | None
    number: int
    name: str | None
    point_type: PointType
    is_open: bool


class CounterServiceAssignment(BaseModel):
    service_id: str | None = None
