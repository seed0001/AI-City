/**
 * Microsoft Edge online neural voices (en-US) — short names match `edge-tts` / Azure Speech.
 * Used by the per-profile voice selector.
 */
export const EDGE_TTS_VOICE_OPTIONS: readonly { id: string; label: string }[] = [
  { id: "en-US-AvaNeural", label: "Ava" },
  { id: "en-US-AvaMultilingualNeural", label: "Ava Multilingual" },
  { id: "en-US-AriaNeural", label: "Aria" },
  { id: "en-US-JennyNeural", label: "Jenny" },
  { id: "en-US-GuyNeural", label: "Guy" },
  { id: "en-US-JaneNeural", label: "Jane" },
  { id: "en-US-EricNeural", label: "Eric" },
  { id: "en-US-MichelleNeural", label: "Michelle" },
  { id: "en-US-RogerNeural", label: "Roger" },
  { id: "en-US-SteffanNeural", label: "Steffan" },
  { id: "en-US-EmmaNeural", label: "Emma" },
  { id: "en-US-BrianNeural", label: "Brian" },
  { id: "en-US-ChristopherNeural", label: "Christopher" },
  { id: "en-US-CoraNeural", label: "Cora" },
  { id: "en-US-ElizabethNeural", label: "Elizabeth" },
  { id: "en-US-JacobNeural", label: "Jacob" },
  { id: "en-US-SaraNeural", label: "Sara" },
  { id: "en-US-TonyNeural", label: "Tony" },
  { id: "en-US-NancyNeural", label: "Nancy" },
  { id: "en-US-DavisNeural", label: "Davis" },
  { id: "en-US-AmberNeural", label: "Amber" },
  { id: "en-US-AnaNeural", label: "Ana" },
  { id: "en-US-AshleyNeural", label: "Ashley" },
  { id: "en-US-BrandonNeural", label: "Brandon" },
  { id: "en-US-JoannaNeural", label: "Joanna" },
  { id: "en-US-MatthewNeural", label: "Matthew" },
] as const;

export const DEFAULT_NPC_TTS_VOICE = "en-US-GuyNeural";
