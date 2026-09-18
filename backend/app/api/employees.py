from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.models.entities import Agency, Employee, EmployeeStatus, RoleName, User, Zone
from app.schemas.employee import EmployeeCreate, EmployeeResponse, EmployeeUpdate


router = APIRouter(prefix="/employees", tags=["Employees"])


def normalize_status(value: str) -> EmployeeStatus:
    try:
        return EmployeeStatus(value.upper())
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail="Statut invalide. Valeurs: ACTIVE, INACTIVE, ON_LEAVE",
        ) from exc


def normalize_role(value: str) -> RoleName:
    try:
        return RoleName(value.strip().upper())
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail="Role invalide. Valeurs: ADMIN, MANAGER, AGENT, SECURITY, TECHNICIAN",
        ) from exc


def zones_for_employee(agency_id: str, zone_ids: list[str], db: Session) -> list[Zone]:
    unique_zone_ids = list(dict.fromkeys(zone_ids))
    zones = [db.get(Zone, zone_id) for zone_id in unique_zone_ids]
    if any(zone is None for zone in zones):
        raise HTTPException(status_code=404, detail="Zone introuvable")
    if any(zone.agency_id != agency_id for zone in zones):
        raise HTTPException(status_code=422, detail="Une zone doit appartenir a la meme agence")
    return zones


def get_accessible_employee(employee_id: str, current_user: User, db: Session) -> Employee:
    employee = db.scalar(
        select(Employee)
        .options(selectinload(Employee.authorized_zones))
        .where(Employee.id == employee_id)
    )
    if employee is None:
        raise HTTPException(status_code=404, detail="Employe introuvable")
    if current_user.role.name == RoleName.MANAGER and employee.agency_id != current_user.agency_id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")
    return employee


def to_response(employee: Employee) -> EmployeeResponse:
    return EmployeeResponse(
        id=employee.id,
        agency_id=employee.agency_id,
        first_name=employee.first_name,
        last_name=employee.last_name,
        email=employee.email,
        phone=employee.phone,
        position=employee.position,
        rfid_uid=employee.rfid_uid,
        role=employee.role.value,
        authorized_zone_ids=employee.authorized_zone_ids,
        status=employee.status.value,
        hire_date=employee.hire_date,
        is_active=employee.is_active,
    )


@router.get(
    "",
    response_model=list[EmployeeResponse],
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
def list_employees(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[EmployeeResponse]:
    query = (
        select(Employee)
        .options(selectinload(Employee.authorized_zones))
        .order_by(Employee.last_name, Employee.first_name)
    )
    if current_user.role.name == RoleName.MANAGER:
        query = query.where(Employee.agency_id == current_user.agency_id)
    return [to_response(employee) for employee in db.scalars(query).all()]


@router.post(
    "",
    response_model=EmployeeResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
def create_employee(
    payload: EmployeeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EmployeeResponse:
    agency_id = payload.agency_id
    if current_user.role.name == RoleName.MANAGER:
        agency_id = current_user.agency_id
    if agency_id is None:
        raise HTTPException(status_code=422, detail="agency_id est obligatoire pour un ADMIN")
    if db.get(Agency, agency_id) is None:
        raise HTTPException(status_code=404, detail="Agence introuvable")

    authorized_zones = zones_for_employee(agency_id, payload.authorized_zone_ids, db)
    employee = Employee(
        agency_id=agency_id,
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        email=payload.email.strip().lower() if payload.email else None,
        phone=payload.phone,
        position=payload.position,
        rfid_uid=payload.rfid_uid,
        role=normalize_role(payload.role),
        authorized_zones=authorized_zones,
        status=normalize_status(payload.status),
        hire_date=payload.hire_date,
        is_active=payload.status.upper() == EmployeeStatus.ACTIVE.value,
    )
    db.add(employee)
    try:
        db.commit()
        db.refresh(employee)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email ou carte RFID deja utilise") from exc
    return to_response(employee)


@router.get(
    "/{employee_id}",
    response_model=EmployeeResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
def get_employee(
    employee_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EmployeeResponse:
    return to_response(get_accessible_employee(employee_id, current_user, db))


@router.put(
    "/{employee_id}",
    response_model=EmployeeResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
def update_employee(
    employee_id: str,
    payload: EmployeeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EmployeeResponse:
    employee = get_accessible_employee(employee_id, current_user, db)
    changes = payload.model_dump(exclude_unset=True)

    if current_user.role.name == RoleName.MANAGER and "agency_id" in changes:
        if changes["agency_id"] != current_user.agency_id:
            raise HTTPException(status_code=403, detail="Un manager ne peut pas changer d agence")

    if "agency_id" in changes and changes["agency_id"] is not None:
        if db.get(Agency, changes["agency_id"]) is None:
            raise HTTPException(status_code=404, detail="Agence introuvable")
    if "status" in changes and changes["status"] is not None:
        changes["status"] = normalize_status(changes["status"])
        changes["is_active"] = changes["status"] == EmployeeStatus.ACTIVE
    if "role" in changes and changes["role"] is not None:
        changes["role"] = normalize_role(changes["role"])
    authorized_zone_ids = changes.pop("authorized_zone_ids", None)
    target_agency_id = changes.get("agency_id", employee.agency_id)
    if target_agency_id is None:
        raise HTTPException(status_code=422, detail="agency_id est obligatoire")
    if authorized_zone_ids is not None:
        employee.authorized_zones = zones_for_employee(target_agency_id, authorized_zone_ids, db)
    elif "agency_id" in changes and target_agency_id != employee.agency_id:
        employee.authorized_zones = []
    if "email" in changes and changes["email"]:
        changes["email"] = changes["email"].strip().lower()

    for field, value in changes.items():
        setattr(employee, field, value.strip() if isinstance(value, str) else value)

    try:
        db.commit()
        db.refresh(employee)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email ou carte RFID deja utilise") from exc
    return to_response(employee)


@router.delete(
    "/{employee_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
def delete_employee(
    employee_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    employee = get_accessible_employee(employee_id, current_user, db)
    db.delete(employee)
    db.commit()
