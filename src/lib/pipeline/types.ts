export type Source = { video_id: string; title: string; channel: string; duration_seconds: number; local_directory: string; url: string; available?: boolean };
export type PipelineEvent = { id: number; stage: string; message: string; t: number | null; wallTime: number; kind?: string; progress?: number; frames?: number; tracked?: number };
export type PoseFrame = { t: number; index: number; poses: number[][][]; primary: number | null; track: number | null; state: string; speed: number | null; cut: boolean; poseUsable?: boolean; wholebody?: number[][][]; topology?: 'coco-wholebody-133' };
export type Note = { id: string; t: number; text: string; createdAt: string };
export type IdentityReview = { id: string; start: number; end: number; method: 'sampled' | 'continuous'; outcome: 'clear' | 'issue'; reviewer: 'user' | 'assistant' | 'automated'; text: string; createdAt: string };
export type MovementFrame = { t: number; segment: number | null; speed: number | null; travel: number | null; extension: number | null; deceleration: number | null; flow: number | null; punctuation: number | null; holding: boolean };
export type MovementCue = { id: string; kind: 'arrival' | 'hold' | 'transition'; start: number; end: number; reason: string };
export type MovementAnalysis = {
  id: string; runId: string; version: string; createdAt: string; duration: number; aspect: number;
  status: 'draft'; sourceStart: number; poseSha256: string; implementationSha256: string; audioSha256: string;
  frames: MovementFrame[]; candidates: MovementCue[]; coverage: number;
  parameters: { torsoScale: number; speed95: number; extension05: number; extension95: number; deceleration85: number; smoothingRadiusSeconds: number; measuredFeatureLookaheadSeconds: number };
  limitations: string[];
};
export type CueReview = { id: string; analysisId: string; candidateId: string; judgment: 'keep' | 'reject'; text: string; reviewer: 'user' | 'assistant' | 'automated'; createdAt: string };
export type RunJob = { id: string; sourceId: string; title: string; start: number; duration: number; createdAt: string; sourcePath: string; trackingMode?: 'solo' };
export type RunSummary = RunJob & { state: string };
export type Snapshot = {
  job: RunJob; state: string; events: PipelineEvent[]; notes: Note[]; reviews: IdentityReview[]; chunks: number;
  preview: boolean; audio: boolean; waveform: { step: number; duration: number; peaks: number[] } | null;
  result: { frames: number; tracked: number; fps: number; duration: number; coverage: number; limitations: string[]; poseCoverage?: number; usableFrames?: number; singleBodyFrames?: number; multipleBodyFrames?: number; cutFlags?: number; reviewRequiredFrames?: number } | null;
};
