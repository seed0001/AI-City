from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


DecisionIntent = Literal[
    "go_home",
    "seek_food",
    "seek_social",
    "avoid_entity",
    "pursue_daily_objective",
    "wander",
    "idle",
    "start_conversation",
    "reflect",
]


class InitBrainRequest(BaseModel):
    entityId: str
    snapshot: dict[str, Any] = Field(default_factory=dict)


class UpdateBrainRequest(BaseModel):
    entityId: str
    tickContext: dict[str, Any] = Field(default_factory=dict)


class DecisionRequest(BaseModel):
    entityId: str
    decisionContext: dict[str, Any] = Field(default_factory=dict)


class ConversationContextRequest(BaseModel):
    entityId: str
    conversationContext: dict[str, Any] = Field(default_factory=dict)


class EventRecordRequest(BaseModel):
    entityId: str
    event: dict[str, Any] = Field(default_factory=dict)


class ChildBrainRequest(BaseModel):
    parentAId: str
    parentBId: str
    childSeed: dict[str, Any] = Field(default_factory=dict)
    parentASummary: dict[str, Any] | None = None
    parentBSummary: dict[str, Any] | None = None


class ContributingEngine(BaseModel):
    """One engine's vote in a decision aggregation."""
    engineKey: str
    role: str
    method: str
    intent: str | None = None
    weight: float = 0.0
    sourceBonus: float = 1.0


class DecisionResponse(BaseModel):
    intent: DecisionIntent
    confidence: float
    targetEntityId: str | None = None
    rationale: str | None = None
    emotionSummary: str | None = None
    # Phase 3 visibility — list of engines whose vote landed on the winning intent.
    contributors: list[str] = Field(default_factory=list)
    # Detailed per-engine breakdown for HUD/debug; same shape regardless of source.
    contributingEngines: list[ContributingEngine] = Field(default_factory=list)
    source: str | None = None


class ExtendedSignal(BaseModel):
    """A short summary of one engine's state, ranked by relevance to the
    conversation context. Parallel to the 7 core fields, NOT replacing them.
    """
    engineKey: str
    className: str | None = None
    role: str
    summary: str
    relevance: float = 0.0


class EngineBrainContext(BaseModel):
    emotionalState: str
    relationshipReasoning: str
    currentIntent: str
    activeGoals: str
    driveState: str
    selfNarrative: str
    recentEpisodes: list[str] = Field(default_factory=list)
    # Phase 4 expansion — kept optional so existing consumers do not break.
    extendedContext: list[ExtendedSignal] | None = None


class ContextSource(BaseModel):
    engineKey: str
    field: str
    role: str


class ConversationContextResponse(BaseModel):
    contextLines: list[str] = Field(default_factory=list)
    moodLine: str | None = None
    intentionLine: str | None = None
    memoryLine: str | None = None
    emotionSummary: str | None = None
    engineBrainContext: EngineBrainContext | None = None
    # Phase 4 visibility — parallel to engineBrainContext.extendedContext for
    # consumers (HUD) that want a flat list without unpacking the nested shape.
    extendedContext: list[ExtendedSignal] = Field(default_factory=list)
    contextSources: list[ContextSource] = Field(default_factory=list)

