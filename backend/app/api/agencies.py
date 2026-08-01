from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.models.entities import Agency, RoleName, User, Zone, Counter
from app.schemas.agency import AgencyCreate, AgencyResponse, AgencyUpdate


router = APIRouter(prefix="/agencies", tags=["Agencies"])


def agency_query():
    return select(Agency).options(
        selectinload(Agency.zones),
        selectinload(Agency.counters),
        selectinload(Agency.employees),
        selectinload(Agency.devices),
        selectinload(Agency.cameras),
    )


def to_response(agency: Agency) -> AgencyResponse:
    return AgencyResponse(
        id=agency.id,
        name=agency.name,
        address=agency.address,
        phone=agency.phone,
        opening_time=agency.opening_time,
        closing_time=agency.closing_time,
        is_active=agency.is_active,
        zones=agency.zones,
        counters=agency.counters,
        employees_count=len(agency.employees),
        devices_count=len(agency.devices),
        cameras_count=len(agency.cameras),
    )


def get_accessible_agency(
    agency_id: str,
    current_user: User,
    db: Session,
) -> Agency:
    agency = db.scalar(agency_query().where(Agency.id == agency_id))
    if agency is None:
        raise HTTPException(status_code=404, detail="Agence introuvable")

    if current_user.role.name == RoleName.MANAGER and current_user.agency_id != agency.id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")
    return agency


@router.get(
    "",
    response_model=list[AgencyResponse],
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
def list_agencies(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AgencyResponse]:
    query = agency_query().order_by(Agency.name)
    if current_user.role.name == RoleName.MANAGER:
        query = query.where(Agency.id == current_user.agency_id)
    agencies = db.scalars(query).unique().all()
    return [to_response(agency) for agency in agencies]


@router.post(
    "",
    response_model=AgencyResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(RoleName.ADMIN))],
)
def create_agency(payload: AgencyCreate, db: Session = Depends(get_db)) -> AgencyResponse:
    agency = Agency(
        name=payload.name.strip(),
        address=payload.address,
        phone=payload.phone,
        opening_time=payload.opening_time,
        closing_time=payload.closing_time,
        zones=[Zone(**zone.model_dump()) for zone in payload.zones],
        counters=[Counter(**counter.model_dump()) for counter in payload.counters],
    )
    db.add(agency)
    db.commit()
    agency = db.scalar(agency_query().where(Agency.id == agency.id))
    return to_response(agency)


@router.get(
    "/{agency_id}",
    response_model=AgencyResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
def get_agency(
    agency_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AgencyResponse:
    return to_response(get_accessible_agency(agency_id, current_user, db))


@router.put(
    "/{agency_id}",
    response_model=AgencyResponse,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
def update_agency(
    agency_id: str,
    payload: AgencyUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AgencyResponse:
    agency = get_accessible_agency(agency_id, current_user, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(agency, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    agency = db.scalar(agency_query().where(Agency.id == agency.id))
    return to_response(agency)


@router.delete(
    "/{agency_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(RoleName.ADMIN))],
)
def delete_agency(agency_id: str, db: Session = Depends(get_db)) -> None:
    agency = db.get(Agency, agency_id)
    if agency is None:
        raise HTTPException(status_code=404, detail="Agence introuvable")
    db.delete(agency)
    db.commit()
