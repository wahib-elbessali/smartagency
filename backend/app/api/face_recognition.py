"""Secure backend gateway for employee face recognition and capture."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.database.connection import get_db
from app.integrations.ai_client import AIClientError, ai_client
from app.models.entities import AuditLog, Camera, Employee, RoleName, User
from app.schemas.face_recognition import (
    EmployeeFaceResponse,
    FaceCaptureResponse,
    FaceScanRequest,
    FaceScanResponse,
)


employee_router = APIRouter(prefix="/employees", tags=["Face recognition"])
ai_router = APIRouter(prefix="/ai/face", tags=["Face recognition"])

ENROLL_ROLES = [Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))]
FACE_READ_ROLES = [Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))]
SCAN_ROLES = [Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.SECURITY))]
CAPTURE_ROLES = [Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER, RoleName.AGENT))]

MAX_FACE_IMAGE_BYTES = 10 * 1024 * 1024


def _ensure_employee_access(
    employee_id: str,
    current_user: User,
    db: Session,
) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employe introuvable")
    if current_user.role.name != RoleName.ADMIN and employee.agency_id != current_user.agency_id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")
    return employee


def _ensure_camera_access(camera_id: str, current_user: User, db: Session) -> Camera:
    camera = db.get(Camera, camera_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="Camera introuvable")
    if current_user.role.name != RoleName.ADMIN and camera.agency_id != current_user.agency_id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")
    if not camera.stream_url:
        raise HTTPException(status_code=422, detail="Le flux de la camera est obligatoire")
    return camera


def _audit(
    db: Session,
    *,
    user: User,
    agency_id: str | None,
    action: str,
    entity_id: str | None,
    details: dict[str, Any] | None = None,
) -> None:
    """Record metadata only; never put images or embeddings in audit_logs."""
    db.add(
        AuditLog(
            user_id=user.id,
            agency_id=agency_id,
            action=action,
            entity_type="FaceRecognition",
            entity_id=entity_id,
            details=details,
        )
    )
    db.commit()


def _read_face_image(image: UploadFile) -> tuple[bytes, str, str]:
    content_type = image.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="Le fichier doit etre une image")
    content = image.file.read(MAX_FACE_IMAGE_BYTES + 1)
    if len(content) > MAX_FACE_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image trop volumineuse")
    if not content:
        raise HTTPException(status_code=422, detail="Image vide")
    return content, image.filename or "face-image", content_type


def _employee_display(employee: Employee) -> str:
    return f"{employee.first_name} {employee.last_name}"


@employee_router.post(
    "/{employee_id}/face",
    status_code=status.HTTP_201_CREATED,
    dependencies=ENROLL_ROLES,
)
def enroll_employee_face(
    employee_id: str,
    image: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    employee = _ensure_employee_access(employee_id, current_user, db)
    if not employee.is_active:
        raise HTTPException(status_code=422, detail="Impossible d'enroler un employe inactif")
    content, filename, content_type = _read_face_image(image)
    ai_result = ai_client.enroll_face(
        employee.id,
        filename=filename,
        content=content,
        content_type=content_type,
    )
    _audit(
        db,
        user=current_user,
        agency_id=employee.agency_id,
        action="FACE_ENROLL",
        entity_id=employee.id,
        details={"embeddings_count": ai_result.get("embeddings_count", 0)},
    )
    return {
        "employee_id": employee.id,
        "employee_name": _employee_display(employee),
        "enrolled": True,
        "embeddings_count": int(ai_result.get("embeddings_count", 0)),
    }


@employee_router.get(
    "/faces",
    response_model=list[EmployeeFaceResponse],
    dependencies=FACE_READ_ROLES,
)
def list_employee_faces(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[EmployeeFaceResponse]:
    gallery = ai_client.list_faces()
    if not isinstance(gallery, list):
        raise HTTPException(status_code=502, detail="Reponse invalide du service AI")
    employees = list(db.scalars(select(Employee).order_by(Employee.last_name, Employee.first_name)).all())
    if current_user.role.name == RoleName.MANAGER:
        employees = [employee for employee in employees if employee.agency_id == current_user.agency_id]
    by_id = {employee.id: employee for employee in employees}
    response: list[EmployeeFaceResponse] = []
    for face in gallery:
        if not isinstance(face, dict):
            continue
        stable_name = str(face.get("name", ""))
        employee = by_id.get(stable_name)
        if employee is None:
            continue
        embeddings = face.get("embeddings")
        count = len(embeddings) if isinstance(embeddings, list) else 0
        response.append(
            EmployeeFaceResponse(
                employee_id=employee.id,
                employee_name=_employee_display(employee),
                agency_id=employee.agency_id,
                embeddings_count=count,
            )
        )
    _audit(
        db,
        user=current_user,
        agency_id=current_user.agency_id if current_user.role.name != RoleName.ADMIN else None,
        action="FACE_LIST",
        entity_id=None,
        details={"employees_returned": len(response)},
    )
    return response


@employee_router.delete(
    "/{employee_id}/face",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=ENROLL_ROLES,
)
def delete_employee_face(
    employee_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    employee = _ensure_employee_access(employee_id, current_user, db)
    ai_result = ai_client.delete_face(employee.id)
    _audit(
        db,
        user=current_user,
        agency_id=employee.agency_id,
        action="FACE_DELETE",
        entity_id=employee.id,
        details={"embeddings_removed": ai_result.get("embeddings_removed", 0)},
    )


def _face_camera_request(
    payload: FaceScanRequest,
    current_user: User,
    db: Session,
) -> Camera:
    return _ensure_camera_access(payload.camera_id, current_user, db)


def _scan_response(
    ai_result: object,
    *,
    camera: Camera,
    current_user: User,
    db: Session,
) -> FaceScanResponse:
    if not isinstance(ai_result, dict):
        raise HTTPException(status_code=502, detail="Reponse invalide du service AI")
    stable_name = ai_result.get("name")
    employee = db.get(Employee, stable_name) if stable_name else None
    if employee is not None and employee.agency_id != camera.agency_id:
        employee = None
    recognized = employee is not None and employee.is_active
    _audit(
        db,
        user=current_user,
        agency_id=camera.agency_id,
        action="FACE_SCAN",
        entity_id=employee.id if recognized else None,
        details={
            "camera_id": camera.id,
            "recognized": recognized,
            "timed_out": bool(ai_result.get("timed_out", False)),
            "error": ai_result.get("error"),
        },
    )
    return FaceScanResponse(
        recognized=recognized,
        employee_id=employee.id if recognized else None,
        employee_name=_employee_display(employee) if recognized else None,
        score=ai_result.get("score"),
        timed_out=bool(ai_result.get("timed_out", False)),
        error=ai_result.get("error"),
    )


@ai_router.post("/scan", response_model=FaceScanResponse, dependencies=SCAN_ROLES)
def scan_face(
    payload: FaceScanRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FaceScanResponse:
    camera = _face_camera_request(payload, current_user, db)
    return _scan_response(
        ai_client.scan_face(source=camera.stream_url, timeout_seconds=payload.timeout_seconds),
        camera=camera,
        current_user=current_user,
        db=db,
    )


@ai_router.post("/capture", response_model=FaceCaptureResponse, dependencies=CAPTURE_ROLES)
def capture_face(
    payload: FaceScanRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FaceCaptureResponse:
    camera = _face_camera_request(payload, current_user, db)
    result = ai_client.capture_face(
        source=camera.stream_url,
        timeout_seconds=payload.timeout_seconds,
    )
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Reponse invalide du service AI")
    _audit(
        db,
        user=current_user,
        agency_id=camera.agency_id,
        action="FACE_CAPTURE",
        entity_id=None,
        details={
            "camera_id": camera.id,
            "timed_out": bool(result.get("timed_out", False)),
            "error": result.get("error"),
        },
    )
    return FaceCaptureResponse(
        image=result.get("image"),
        bbox=result.get("bbox"),
        det_score=result.get("det_score"),
        embedding=result.get("embedding"),
        timed_out=bool(result.get("timed_out", False)),
        error=result.get("error"),
    )
