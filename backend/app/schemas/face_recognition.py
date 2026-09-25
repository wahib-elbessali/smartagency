"""Backend-facing payloads for protected face-recognition operations."""

from __future__ import annotations

from pydantic import BaseModel, Field


class FaceScanRequest(BaseModel):
    camera_id: str = Field(min_length=1)
    timeout_seconds: float = Field(default=15.0, gt=0, le=60)


class EmployeeFaceResponse(BaseModel):
    employee_id: str
    employee_name: str
    agency_id: str
    enrolled: bool = True
    embeddings_count: int = Field(ge=0)


class FaceScanResponse(BaseModel):
    recognized: bool
    employee_id: str | None
    employee_name: str | None
    score: float | None
    timed_out: bool
    error: str | None


class FaceCaptureResponse(BaseModel):
    image: str | None
    bbox: list[float] | None
    det_score: float | None
    embedding: list[float] | None
    timed_out: bool
    error: str | None
