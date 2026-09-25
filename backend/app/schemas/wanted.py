"""Payloads for the protected AI wanted-list gateway."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class WantedPersonResponse(BaseModel):
    id: str
    agency_id: str
    name: str
    embeddings_count: int = Field(ge=0)
    created_at: datetime

    model_config = {"from_attributes": True}


class WantedDeleteResponse(BaseModel):
    name: str
    agency_id: str
    embeddings_removed: int = Field(ge=0)


class WantedThresholdUpdate(BaseModel):
    threshold: float | None = Field(default=None, ge=0.25, le=1.0)
    min_face_px: int | None = Field(default=None, ge=16, le=1000)

    @model_validator(mode="after")
    def validate_at_least_one_value(self) -> "WantedThresholdUpdate":
        if self.threshold is None and self.min_face_px is None:
            raise ValueError("threshold ou min_face_px est obligatoire")
        return self


class WantedThresholdResponse(BaseModel):
    threshold: float
    min_face_px: int
    startup_default: dict[str, float | int]
    floor: float
    watchlist_size: int = Field(ge=0)
    embeddings_total: int = Field(ge=0)
    applies_within_seconds: float = Field(ge=0)
    previous: dict[str, float | int] | None = None
    warnings: list[str] = Field(default_factory=list)
