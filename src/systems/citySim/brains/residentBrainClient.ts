type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export type BrainDecision =
  | "go_home"
  | "seek_food"
  | "seek_social"
  | "avoid_entity"
  | "pursue_daily_objective"
  | "wander"
  | "idle"
  | "start_conversation"
  | "reflect";

export type ContributingEngine = {
  engineKey: string;
  role: string;
  method: string;
  intent?: string | null;
  weight: number;
  sourceBonus?: number;
};

export type BrainServiceDecisionResponse = {
  intent: BrainDecision;
  confidence: number;
  targetEntityId?: string | null;
  rationale?: string;
  emotionSummary?: string;
  /** Phase 3 expansion — engine keys whose vote landed on the winning intent. */
  contributors?: string[];
  /** Phase 3 expansion — full per-engine breakdown for HUD/debug. */
  contributingEngines?: ContributingEngine[];
  source?: string;
};

export type ExtendedSignal = {
  engineKey: string;
  className?: string | null;
  role: string;
  summary: string;
  relevance: number;
};

export type EngineBrainContext = {
  emotionalState: string;
  relationshipReasoning: string;
  currentIntent: string;
  activeGoals: string;
  driveState: string;
  selfNarrative: string;
  recentEpisodes: string[];
  /** Phase 4 expansion — parallel multi-engine signals. Optional so existing
   * consumers do not break. The 7 fields above remain the LLM prompt spine. */
  extendedContext?: ExtendedSignal[] | null;
};

export type ContextSource = {
  engineKey: string;
  field: string;
  role: string;
};

export type BrainConversationContextResponse = {
  contextLines: string[];
  moodLine?: string;
  intentionLine?: string;
  memoryLine?: string;
  emotionSummary?: string;
  engineBrainContext?: EngineBrainContext;
  /** Phase 4 expansion — same content as engineBrainContext.extendedContext but flat. */
  extendedContext?: ExtendedSignal[];
  contextSources?: ContextSource[];
};

function brainServiceBaseUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_RESIDENT_BRAIN_BASE?.trim() || "http://127.0.0.1:8787";
}

async function postJson<T>(
  path: string,
  body: Record<string, JsonValue>
): Promise<T> {
  const res = await fetch(`${brainServiceBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`brain service ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function checkResidentBrainHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${brainServiceBaseUrl()}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function initializeResidentBrain(payload: {
  entityId: string;
  snapshot: Record<string, JsonValue>;
}): Promise<{ ok: boolean; emotionSummary?: string; brainKind?: string }> {
  return postJson("/brains/init", payload);
}

export async function updateResidentBrain(payload: {
  entityId: string;
  tickContext: Record<string, JsonValue>;
}): Promise<{ ok: boolean; emotionSummary?: string; summary?: string }> {
  return postJson("/brains/update", payload);
}

export async function getResidentDecision(payload: {
  entityId: string;
  decisionContext: Record<string, JsonValue>;
}): Promise<BrainServiceDecisionResponse> {
  return postJson("/brains/decision", payload);
}

export async function getConversationContext(payload: {
  entityId: string;
  conversationContext: Record<string, JsonValue>;
}): Promise<BrainConversationContextResponse> {
  return postJson("/brains/conversation-context", payload);
}

export async function recordResidentEvent(payload: {
  entityId: string;
  event: Record<string, JsonValue>;
}): Promise<{ ok: boolean }> {
  return postJson("/brains/event", payload);
}

export async function createChildBrain(payload: {
  parentAId: string;
  parentBId: string;
  childSeed: Record<string, JsonValue>;
  parentASummary?: Record<string, JsonValue>;
  parentBSummary?: Record<string, JsonValue>;
}): Promise<{
  childBrainSummary: string;
  inheritedTraitSuggestions: string[];
  defaults: Record<string, JsonValue>;
}> {
  return postJson("/brains/child", payload);
}

export type BrainInventoryRow = {
  key: string;
  package: string;
  module: string;
  class: string;
  runtimeRole: string;
  status: "active" | "disabled" | "excluded";
  reason?: string | null;
  composite?: boolean;
};

export type EngineCapabilitySummary = {
  engineKey: string;
  class: string;
  role: string;
  decisionMethods: string[];
  stateMethods: string[];
  eventMethods: string[];
  expressionMethods: string[];
};

export type DecisionBreakdownEntry = {
  engineKey: string;
  role: string;
  method: string;
  intent: string;
  weight: number;
  sourceBonus?: number;
};

export type BrainDebugResponse = {
  entityId: string;
  displayName: string;
  totalClassesDiscovered: number;
  totalEnginesDiscovered: number;
  totalEnginesInstantiated: number;
  totalExcludedDataContainers: number;
  totalCompositesWired: number;
  activeEnginesByRole: Record<string, string[]>;
  activeEngines: Record<string, { class: string; module: string; runtimeRole: string }>;
  disabledEngines: Record<string, string>;
  inventory: BrainInventoryRow[];
  excludedClasses: BrainInventoryRow[];
  typedAdaptersAvailable: string[];
  lastOutputByEngine: Record<string, JsonValue>;
  lastInputEvent: Record<string, JsonValue> | null;
  lastDecisionOutput: Record<string, JsonValue> | null;
  lastDecisionSource: string;
  lastEmotionSummary?: string | null;
  lastPersonalitySummary?: string | null;
  lastMemorySummary?: string | null;
  /** Phase 7 visibility upgrades. All optional so older brain services degrade. */
  capabilities?: Record<string, EngineCapabilitySummary>;
  contributingEngines?: string[];
  silentEngines?: string[];
  decisionBreakdown?: DecisionBreakdownEntry[];
  contextSources?: ContextSource[];
  lastEventTags?: string[];
  contributionCounters?: Record<string, number>;
};

export async function getResidentBrainDebug(entityId: string): Promise<BrainDebugResponse | null> {
  try {
    const res = await fetch(`${brainServiceBaseUrl()}/brains/${encodeURIComponent(entityId)}/debug`, {
      method: "GET",
    });
    if (!res.ok) return null;
    return (await res.json()) as BrainDebugResponse;
  } catch {
    return null;
  }
}

