from pydantic import BaseModel
from typing import Optional


class AnalyzeResponse(BaseModel):
    verdict: str
    score: float
    reasons: list[str]
