from pydantic import BaseModel


class AgentAssignmentResponse(BaseModel):
    counter_id: str
    counter_name: str | None
    service_id: str
    service_name: str


class AgentSummaryResponse(BaseModel):
    user_id: str
    full_name: str
    assignment: AgentAssignmentResponse | None


class AgentAssignmentUpdate(BaseModel):
    counter_id: str | None
