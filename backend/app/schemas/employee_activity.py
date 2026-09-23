"""Payloads for workstation presence tracking."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class WorkstationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    zone: str = Field(min_length=1, max_length=120)
    employee_id: str | None = None


class WorkstationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    zone: str
    employee_id: str | None
    employee_name: str | None
    status: str
    since: float | None
    zone_known: bool
