from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ai_alerts.consumer import weapon_alert_consumer
from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.models.entities import Agency, Camera, RoleName, User
from app.schemas.camera import CameraCreate, CameraResponse, CameraUpdate


router = APIRouter(tags=["Cameras"])
CAMERA_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.SECURITY))
]


def ensure_agency_scope(agency_id: str, current_user: User) -> None:
    if current_user.role.name != RoleName.ADMIN and current_user.agency_id != agency_id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")


def get_agency_or_404(agency_id: str, db: Session) -> Agency:
    agency = db.get(Agency, agency_id)
    if agency is None:
        raise HTTPException(status_code=404, detail="Agence introuvable")
    return agency


def get_camera_or_404(camera_id: str, db: Session) -> Camera:
    camera = db.get(Camera, camera_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="Camera introuvable")
    return camera


def ensure_unique_name(name: str, db: Session, camera_id: str | None = None) -> None:
    query = select(Camera).where(Camera.name == name)
    if camera_id is not None:
        query = query.where(Camera.id != camera_id)
    if db.scalar(query) is not None:
        raise HTTPException(
            status_code=409,
            detail="Le nom de la camera doit etre unique et correspondre au nom de la source IA",
        )


@router.get(
    "/agencies/{agency_id}/cameras",
    response_model=list[CameraResponse],
    dependencies=CAMERA_ROLES,
)
def list_cameras(
    agency_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CameraResponse]:
    get_agency_or_404(agency_id, db)
    ensure_agency_scope(agency_id, current_user)
    return list(
        db.scalars(select(Camera).where(Camera.agency_id == agency_id).order_by(Camera.name)).all()
    )


@router.post(
    "/agencies/{agency_id}/cameras",
    response_model=CameraResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=CAMERA_ROLES,
)
def create_camera(
    agency_id: str,
    payload: CameraCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CameraResponse:
    agency = get_agency_or_404(agency_id, db)
    ensure_agency_scope(agency.id, current_user)
    name = payload.name.strip()
    stream_url = payload.stream_url.strip()
    if not name or not stream_url:
        raise HTTPException(status_code=422, detail="Le nom et le flux de la camera sont obligatoires")
    ensure_unique_name(name, db)

    camera = Camera(agency_id=agency.id, name=name, stream_url=stream_url)
    db.add(camera)
    try:
        db.commit()
        db.refresh(camera)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Le nom de la camera est deja utilise") from exc
    weapon_alert_consumer.request_sync()
    return camera


@router.put(
    "/cameras/{camera_id}",
    response_model=CameraResponse,
    dependencies=CAMERA_ROLES,
)
def update_camera(
    camera_id: str,
    payload: CameraUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CameraResponse:
    camera = get_camera_or_404(camera_id, db)
    ensure_agency_scope(camera.agency_id, current_user)
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        changes["name"] = changes["name"].strip()
        if not changes["name"]:
            raise HTTPException(status_code=422, detail="Le nom de la camera est obligatoire")
        ensure_unique_name(changes["name"], db, camera.id)
    if "stream_url" in changes:
        changes["stream_url"] = changes["stream_url"].strip()
        if not changes["stream_url"]:
            raise HTTPException(status_code=422, detail="Le flux de la camera est obligatoire")
    for field, value in changes.items():
        setattr(camera, field, value)

    try:
        db.commit()
        db.refresh(camera)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Le nom de la camera est deja utilise") from exc
    weapon_alert_consumer.request_sync()
    return camera


@router.delete(
    "/cameras/{camera_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
def delete_camera(
    camera_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    camera = get_camera_or_404(camera_id, db)
    ensure_agency_scope(camera.agency_id, current_user)
    for alert in camera.alerts:
        alert.camera_id = None
    db.delete(camera)
    db.commit()
    weapon_alert_consumer.request_sync()
