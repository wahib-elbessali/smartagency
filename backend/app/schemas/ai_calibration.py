from pydantic import BaseModel, Field


class CalibrationRectRequest(BaseModel):
    camera: str = Field(min_length=1)
    points: list[list[float]] = Field(min_length=4, max_length=4)
    img_w: float = Field(gt=0)
    img_h: float = Field(gt=0)


class CalibrationAlignRequest(BaseModel):
    points: list[dict[str, list[float]]] = Field(min_length=1)


class CalibrationCrossCheckRequest(BaseModel):
    points: dict[str, list[float]] = Field(min_length=2)


class CalibrationGate(BaseModel):
    camera: str = Field(min_length=1)
    points: list[list[float]] = Field(min_length=1)


class CalibrationGatesRequest(BaseModel):
    gates: list[CalibrationGate]
