"""Payloads accepted by the backend zoning gateway."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ZoneCreateRequest(BaseModel):
    """Complete zone definition sent to the AI zoning service."""

    name: str = Field(min_length=1, max_length=120)
    camera: str = Field(min_length=1, max_length=150)
    polygon: list[list[float]] = Field(min_length=3)
    sources: dict[str, str] = Field(min_length=1)
