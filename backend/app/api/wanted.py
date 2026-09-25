"""Protected backend gateway for the AI wanted-person watchlist."""

from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.integrations.ai_client import ai_client
from app.models.entities import (
    AIAlertThreshold,
    Agency,
    AuditLog,
    RoleName,
    User,
    WantedPerson,
)
from app.schemas.wanted import (
    WantedDeleteResponse,
    WantedPersonResponse,
    WantedThresholdResponse,
    WantedThresholdUpdate,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["AI wanted detection"])

WATCHLIST_READ_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.SECURITY))
]
WATCHLIST_WRITE_ROLES = [
    Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))
]
THRESHOLD_READ_ROLES = WATCHLIST_READ_ROLES
THRESHOLD_WRITE_ROLES = WATCHLIST_WRITE_ROLES

MAX_WANTED_IMAGE_BYTES = 10 * 1024 * 1024
NAME_RE = re.compile(r"^[A-Za-z0-9 ._+-]{1,80}$")


def _audit(
    db: Session,
    *,
    user: User,
    agency_id: str | None,
    action: str,
    entity_id: str | None,
    details: dict[str, Any] | None = None,
) -> None:
    """Store metadata only; photos and embeddings never enter the audit log."""
    db.add(
        AuditLog(
            user_id=user.id,
            agency_id=agency_id,
            action=action,
            entity_type="WantedPerson",
            entity_id=entity_id,
            details=details,
        )
    )


def _validate_name(name: str) -> str:
    name = name.strip()
    if not NAME_RE.fullmatch(name):
        raise HTTPException(
            status_code=422,
            detail="name doit contenir 1 a 80 caracteres alphanumeriques ou . _ + -",
        )
    return name


def _read_image(image: UploadFile) -> tuple[bytes, str, str]:
    content_type = image.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="Le fichier doit etre une image")
    content = image.file.read(MAX_WANTED_IMAGE_BYTES + 1)
    if len(content) > MAX_WANTED_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image trop volumineuse")
    if not content:
        raise HTTPException(status_code=422, detail="Image vide")
    return content, image.filename or "wanted-image", content_type


def _agency_for_write(
    requested_agency_id: str | None,
    current_user: User,
    db: Session,
) -> Agency:
    """Resolve the ownership agency without allowing cross-agency writes."""
    if current_user.role.name == RoleName.ADMIN:
        agency_id = requested_agency_id
        if agency_id is None:
            agencies = list(db.scalars(select(Agency).order_by(Agency.name)).all())
            if len(agencies) != 1:
                raise HTTPException(
                    status_code=422,
                    detail="agency_id est obligatoire pour un ADMIN multi-agences",
                )
            agency_id = agencies[0].id
    else:
        if current_user.agency_id is None:
            raise HTTPException(status_code=403, detail="Utilisateur sans agence")
        if requested_agency_id is not None and requested_agency_id != current_user.agency_id:
            raise HTTPException(status_code=403, detail="Acces limite a votre agence")
        agency_id = current_user.agency_id

    agency = db.get(Agency, agency_id)
    if agency is None:
        raise HTTPException(status_code=404, detail="Agence introuvable")
    return agency


def _scope_query(query, current_user: User):
    if current_user.role.name != RoleName.ADMIN:
        query = query.where(WantedPerson.agency_id == current_user.agency_id)
    return query


def _threshold_response(payload: object) -> WantedThresholdResponse:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Reponse invalide du service AI")
    try:
        return WantedThresholdResponse.model_validate(payload)
    except ValidationError as exc:
        logger.error("Reponse threshold wanted invalide: %s", exc)
        raise HTTPException(status_code=502, detail="Reponse invalide du service AI") from exc


@router.post(
    "/watchlist",
    response_model=WantedPersonResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=WATCHLIST_WRITE_ROLES,
)
def add_watchlist_entry(
    name: str = Form(...),
    image: UploadFile = File(...),
    agency_id: str | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WantedPerson:
    name = _validate_name(name)
    agency = _agency_for_write(agency_id, current_user, db)

    if db.scalar(select(WantedPerson).where(WantedPerson.name == name)) is not None:
        raise HTTPException(status_code=409, detail="Cette personne est deja dans la liste")

    # The AI gallery is global. Refuse an entry that was added outside the
    # backend, otherwise the same name could silently belong to another agency.
    current_gallery = ai_client.list_wanted_watchlist()
    if isinstance(current_gallery, list) and any(
        isinstance(item, dict) and item.get("name") == name for item in current_gallery
    ):
        raise HTTPException(status_code=409, detail="Cette personne existe deja dans le service AI")

    content, filename, content_type = _read_image(image)
    ai_result = ai_client.add_wanted_watchlist_entry(
        name,
        filename=filename,
        content=content,
        content_type=content_type,
    )
    if not isinstance(ai_result, dict):
        raise HTTPException(status_code=502, detail="Reponse invalide du service AI")

    person = WantedPerson(
        agency_id=agency.id,
        name=name,
        embeddings_count=int(ai_result.get("embeddings_count", 0)),
    )
    db.add(person)
    try:
        db.flush()
        _audit(
            db,
            user=current_user,
            agency_id=agency.id,
            action="WANTED_ENROLL",
            entity_id=person.id,
            details={"embeddings_count": person.embeddings_count},
        )
        db.commit()
        db.refresh(person)
    except IntegrityError as exc:
        db.rollback()
        logger.warning("Conflit pendant l ajout wanted %s", name)
        raise HTTPException(status_code=409, detail="Cette personne est deja dans la liste") from exc
    return person


@router.get(
    "/watchlist",
    response_model=list[WantedPersonResponse],
    dependencies=WATCHLIST_READ_ROLES,
)
def list_watchlist(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[WantedPerson]:
    gallery = ai_client.list_wanted_watchlist()
    counts = {
        str(item["name"]): int(item.get("embeddings_count", 0))
        for item in gallery
        if isinstance(item, dict) and item.get("name")
    } if isinstance(gallery, list) else {}

    people = list(
        db.scalars(
            _scope_query(select(WantedPerson).order_by(WantedPerson.name), current_user)
        ).all()
    for person in people:
        person.embeddings_count = counts.get(person.name, 0)
    _audit(
        db,
        user=current_user,
        agency_id=current_user.agency_id if current_user.role.name != RoleName.ADMIN else None,
        action="WANTED_LIST",
        entity_id=None,
        details={"entries_returned": len(people)},
    )
    db.commit()
    return people


@router.delete(
    "/watchlist/{person_name}",
    response_model=WantedDeleteResponse,
    dependencies=WATCHLIST_WRITE_ROLES,
)
def delete_watchlist_entry(
    person_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WantedDeleteResponse:
    person_name = _validate_name(person_name)
    person = db.scalar(
        _scope_query(select(WantedPerson).where(WantedPerson.name == person_name), current_user)
    )
    if person is None:
        raise HTTPException(status_code=404, detail="Personne introuvable dans votre liste")

    ai_result = ai_client.delete_wanted_watchlist_entry(person.name)
    removed = int(ai_result.get("embeddings_removed", 0)) if isinstance(ai_result, dict) else 0
    db.delete(person)
    _audit(
        db,
        user=current_user,
        agency_id=person.agency_id,
        action="WANTED_DELETE",
        entity_id=person.id,
        details={"embeddings_removed": removed},
    )
    db.commit()
    return WantedDeleteResponse(
        name=person_name,
        agency_id=person.agency_id,
        embeddings_removed=removed,
    )


@router.get(
    "/watchlist/threshold",
    response_model=WantedThresholdResponse,
    dependencies=THRESHOLD_READ_ROLES,
)
def get_watchlist_threshold(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WantedThresholdResponse:
    response = _threshold_response(ai_client.get_wanted_threshold())
    _audit(
        db,
        user=current_user,
        agency_id=current_user.agency_id if current_user.role.name != RoleName.ADMIN else None,
        action="WANTED_THRESHOLD_READ",
        entity_id=None,
        details={"threshold": response.threshold, "min_face_px": response.min_face_px},
    )
    db.commit()
    return response


@router.put(
    "/watchlist/threshold",
    response_model=WantedThresholdResponse,
    dependencies=THRESHOLD_WRITE_ROLES,
)
def update_watchlist_threshold(
    payload: WantedThresholdUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WantedThresholdResponse:
    response = _threshold_response(
        ai_client.update_wanted_threshold(payload.model_dump(exclude_none=True))
    )

    persisted = db.scalar(
        select(AIAlertThreshold).where(AIAlertThreshold.alert_type == "wanted")
    )
    if persisted is None:
        persisted = AIAlertThreshold(alert_type="wanted", confidence=response.threshold)
        db.add(persisted)
    else:
        persisted.confidence = response.threshold
    _audit(
        db,
        user=current_user,
        agency_id=current_user.agency_id if current_user.role.name != RoleName.ADMIN else None,
        action="WANTED_THRESHOLD_UPDATE",
        entity_id=persisted.id,
        details={
            "threshold": response.threshold,
            "min_face_px": response.min_face_px,
            "warnings": response.warnings,
        },
    )
    db.commit()
    return response
