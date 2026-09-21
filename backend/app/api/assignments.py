from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.security import require_roles
from app.database.connection import get_db
from app.models.entities import Agency, Counter, Role, RoleName, User
from app.schemas.assignment import (
    AgentAssignmentResponse,
    AgentAssignmentUpdate,
    AgentSummaryResponse,
)


router = APIRouter(tags=["Agent assignments"])


def assignment_query():
    return selectinload(User.assigned_counter).selectinload(Counter.service)


def to_assignment(user: User) -> AgentAssignmentResponse | None:
    counter = user.assigned_counter
    service = counter.service if counter is not None else None
    if counter is None or service is None:
        return None
    return AgentAssignmentResponse(
        counter_id=counter.id,
        counter_name=counter.name,
        service_id=service.id,
        service_name=service.name,
    )


def get_agent_or_404(user_id: str, db: Session) -> User:
    user = db.scalar(
        select(User)
        .options(
            selectinload(User.role),
            assignment_query(),
        )
        .where(User.id == user_id)
    )
    if user is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if user.role.name != RoleName.AGENT:
        raise HTTPException(status_code=422, detail="L utilisateur doit avoir le role AGENT")
    return user


def ensure_manager_scope(agency_id: str, current_user: User) -> None:
    if current_user.role.name == RoleName.MANAGER and current_user.agency_id != agency_id:
        raise HTTPException(status_code=403, detail="Acces limite a votre agence")


@router.get(
    "/agents/me/assignment",
    response_model=AgentAssignmentResponse | None,
    dependencies=[Depends(require_roles(RoleName.AGENT))],
)
def get_my_assignment(
    current_user: User = Depends(require_roles(RoleName.AGENT)),
    db: Session = Depends(get_db),
) -> AgentAssignmentResponse | None:
    user = get_agent_or_404(current_user.id, db)
    return to_assignment(user)


@router.get(
    "/agencies/{agency_id}/agents",
    response_model=list[AgentSummaryResponse],
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
def list_agency_agents(
    agency_id: str,
    current_user: User = Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER)),
    db: Session = Depends(get_db),
) -> list[AgentSummaryResponse]:
    if db.get(Agency, agency_id) is None:
        raise HTTPException(status_code=404, detail="Agence introuvable")
    ensure_manager_scope(agency_id, current_user)

    agents = db.scalars(
        select(User)
        .join(User.role)
        .options(assignment_query())
        .where(
            User.agency_id == agency_id,
            Role.name == RoleName.AGENT,
        )
        .order_by(User.full_name)
    ).unique().all()
    return [
        AgentSummaryResponse(
            user_id=agent.id,
            full_name=agent.full_name,
            assignment=to_assignment(agent),
        )
        for agent in agents
    ]


@router.patch(
    "/agents/{user_id}/assignment",
    response_model=AgentAssignmentResponse | None,
    dependencies=[Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER))],
)
def update_agent_assignment(
    user_id: str,
    payload: AgentAssignmentUpdate,
    current_user: User = Depends(require_roles(RoleName.ADMIN, RoleName.MANAGER)),
    db: Session = Depends(get_db),
) -> AgentAssignmentResponse | None:
    agent = get_agent_or_404(user_id, db)
    ensure_manager_scope(agent.agency_id, current_user)

    if payload.counter_id is None:
        agent.counter_id = None
        db.commit()
        return None

    counter = db.scalar(
        select(Counter)
        .options(selectinload(Counter.service))
        .where(Counter.id == payload.counter_id)
    )
    if counter is None:
        raise HTTPException(status_code=404, detail="Guichet ou bureau introuvable")
    if counter.agency_id != agent.agency_id:
        raise HTTPException(
            status_code=422,
            detail="L agent et le guichet doivent appartenir a la meme agence",
        )
    if counter.service is None:
        raise HTTPException(status_code=409, detail="Ce guichet n est affecte a aucun service")
    if not counter.service.is_active:
        raise HTTPException(status_code=409, detail="Le service du guichet est inactif")

    agent.counter_id = counter.id
    db.commit()
    return AgentAssignmentResponse(
        counter_id=counter.id,
        counter_name=counter.name,
        service_id=counter.service.id,
        service_name=counter.service.name,
    )
