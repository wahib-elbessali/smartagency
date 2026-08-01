from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class EmployeeCreate(BaseModel):
    first_name: str = Field(min_length=2, max_length=100)
    last_name: str = Field(min_length=2, max_length=100)
    email: str | None = Field(default=None, min_length=5, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    position: str | None = Field(default=None, max_length=100)
    agency_id: str | None = None
    rfid_uid: str | None = Field(default=None, max_length=100)
    status: str = Field(default="ACTIVE", max_length=20)
    hire_date: date | None = None


class EmployeeUpdate(BaseModel):
    first_name: str | None = Field(default=None, min_length=2, max_length=100)
    last_name: str | None = Field(default=None, min_length=2, max_length=100)
    email: str | None = Field(default=None, min_length=5, max_length=255)
    phone: str | None = Field(default=None, max_length=30)
    position: str | None = Field(default=None, max_length=100)
    agency_id: str | None = None
    rfid_uid: str | None = Field(default=None, max_length=100)
    status: str | None = Field(default=None, max_length=20)
    hire_date: date | None = None


class EmployeeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    agency_id: str
    first_name: str
    last_name: str
    email: str | None
    phone: str | None
    position: str | None
    rfid_uid: str | None
    status: str
    hire_date: date | None
    is_active: bool
