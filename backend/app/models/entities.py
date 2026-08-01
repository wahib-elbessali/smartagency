import enum
import uuid
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, JSON, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


def new_uuid() -> str:
    return str(uuid.uuid4())


class RoleName(str, enum.Enum):
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    AGENT = "AGENT"
    SECURITY = "SECURITY"
    TECHNICIAN = "TECHNICIAN"


class DeviceStatus(str, enum.Enum):
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    ERROR = "ERROR"
    MAINTENANCE = "MAINTENANCE"


class EmployeeStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    ON_LEAVE = "ON_LEAVE"


class TicketStatus(str, enum.Enum):
    WAITING = "WAITING"
    CALLED = "CALLED"
    IN_SERVICE = "IN_SERVICE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class AttendanceMethod(str, enum.Enum):
    RFID = "RFID"
    FACE_RECOGNITION = "FACE_RECOGNITION"
    MANUAL = "MANUAL"


class AlertSeverity(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class AlertStatus(str, enum.Enum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[RoleName] = mapped_column(Enum(RoleName), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))

    users: Mapped[list["User"]] = relationship(back_populates="role")


class Agency(Base):
    __tablename__ = "agencies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    address: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(30))
    opening_time: Mapped[time | None] = mapped_column(Time)
    closing_time: Mapped[time | None] = mapped_column(Time)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    users: Mapped[list["User"]] = relationship(back_populates="agency")
    employees: Mapped[list["Employee"]] = relationship(back_populates="agency", cascade="all, delete-orphan")
    visitors: Mapped[list["Visitor"]] = relationship(back_populates="agency", cascade="all, delete-orphan")
    devices: Mapped[list["Device"]] = relationship(back_populates="agency", cascade="all, delete-orphan")
    cameras: Mapped[list["Camera"]] = relationship(back_populates="agency", cascade="all, delete-orphan")
    alerts: Mapped[list["Alert"]] = relationship(back_populates="agency", cascade="all, delete-orphan")
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="agency")
    zones: Mapped[list["Zone"]] = relationship(back_populates="agency", cascade="all, delete-orphan")
    counters: Mapped[list["Counter"]] = relationship(back_populates="agency", cascade="all, delete-orphan")


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    agency_id: Mapped[str] = mapped_column(ForeignKey("agencies.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    zone_type: Mapped[str] = mapped_column(String(50), default="PUBLIC", nullable=False)
    is_private: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    agency: Mapped["Agency"] = relationship(back_populates="zones")


class Counter(Base):
    __tablename__ = "counters"
    __table_args__ = (UniqueConstraint("agency_id", "number", name="uq_counter_agency_number"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    agency_id: Mapped[str] = mapped_column(ForeignKey("agencies.id"), nullable=False, index=True)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str | None] = mapped_column(String(100))
    is_open: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    agency: Mapped["Agency"] = relationship(back_populates="counters")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    role_id: Mapped[str] = mapped_column(ForeignKey("roles.id"), nullable=False)
    agency_id: Mapped[str | None] = mapped_column(ForeignKey("agencies.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    role: Mapped["Role"] = relationship(back_populates="users")
    agency: Mapped["Agency | None"] = relationship(back_populates="users")
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="user")
    employee: Mapped["Employee | None"] = relationship(back_populates="user", uselist=False)


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    agency_id: Mapped[str] = mapped_column(ForeignKey("agencies.id"), nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    position: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(30))
    rfid_uid: Mapped[str | None] = mapped_column(String(100), unique=True)
    status: Mapped[EmployeeStatus] = mapped_column(
        Enum(EmployeeStatus),
        default=EmployeeStatus.ACTIVE,
        server_default=EmployeeStatus.ACTIVE.value,
        nullable=False,
    )
    hire_date: Mapped[date | None] = mapped_column()
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    agency: Mapped["Agency"] = relationship(back_populates="employees")
    attendance: Mapped[list["Attendance"]] = relationship(back_populates="employee", cascade="all, delete-orphan")
    user: Mapped["User | None"] = relationship(back_populates="employee")


class Visitor(Base):
    __tablename__ = "visitors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    agency_id: Mapped[str] = mapped_column(ForeignKey("agencies.id"), nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30))
    identity_reference: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    agency: Mapped["Agency"] = relationship(back_populates="visitors")
    tickets: Mapped[list["Ticket"]] = relationship(back_populates="visitor", cascade="all, delete-orphan")


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    visitor_id: Mapped[str] = mapped_column(ForeignKey("visitors.id"), nullable=False, index=True)
    ticket_number: Mapped[str] = mapped_column(String(30), nullable=False)
    service_type: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[TicketStatus] = mapped_column(Enum(TicketStatus), default=TicketStatus.WAITING, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    called_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    visitor: Mapped["Visitor"] = relationship(back_populates="tickets")


class Attendance(Base):
    __tablename__ = "attendance"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False, index=True)
    check_in: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    check_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    method: Mapped[AttendanceMethod] = mapped_column(Enum(AttendanceMethod), nullable=False)

    employee: Mapped["Employee"] = relationship(back_populates="attendance")


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    agency_id: Mapped[str] = mapped_column(ForeignKey("agencies.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    device_type: Mapped[str] = mapped_column(String(80), nullable=False)
    mqtt_client_id: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    mqtt_topic: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[DeviceStatus] = mapped_column(Enum(DeviceStatus), default=DeviceStatus.OFFLINE, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    agency: Mapped["Agency"] = relationship(back_populates="devices")
    sensor_readings: Mapped[list["SensorReading"]] = relationship(back_populates="device", cascade="all, delete-orphan")


class SensorReading(Base):
    __tablename__ = "sensor_readings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), nullable=False, index=True)
    sensor_type: Mapped[str] = mapped_column(String(80), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(20))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)

    device: Mapped["Device"] = relationship(back_populates="sensor_readings")


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    agency_id: Mapped[str] = mapped_column(ForeignKey("agencies.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    stream_url: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[DeviceStatus] = mapped_column(Enum(DeviceStatus), default=DeviceStatus.OFFLINE, nullable=False)

    agency: Mapped["Agency"] = relationship(back_populates="cameras")
    alerts: Mapped[list["Alert"]] = relationship(back_populates="camera")


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    agency_id: Mapped[str] = mapped_column(ForeignKey("agencies.id"), nullable=False, index=True)
    camera_id: Mapped[str | None] = mapped_column(ForeignKey("cameras.id"))
    device_id: Mapped[str | None] = mapped_column(ForeignKey("devices.id"))
    alert_type: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[AlertSeverity] = mapped_column(Enum(AlertSeverity), default=AlertSeverity.MEDIUM, nullable=False)
    status: Mapped[AlertStatus] = mapped_column(Enum(AlertStatus), default=AlertStatus.OPEN, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    agency: Mapped["Agency"] = relationship(back_populates="alerts")
    camera: Mapped["Camera | None"] = relationship(back_populates="alerts")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    agency_id: Mapped[str | None] = mapped_column(ForeignKey("agencies.id"))
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(80))
    entity_id: Mapped[str | None] = mapped_column(String(36))
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)

    user: Mapped["User | None"] = relationship(back_populates="audit_logs")
    agency: Mapped["Agency | None"] = relationship(back_populates="audit_logs")
