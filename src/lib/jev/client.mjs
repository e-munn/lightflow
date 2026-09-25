import {z} from 'zod';
import {describeSnapshot, JEV_OPTIONS} from '../../../public/jev-context.mjs';

const unit = z.number().finite().min(0).max(1);
const summary = z.object({
  duration: z.number().finite().positive().max(10.1), rms: z.number().finite().min(0).max(8),
  variation: z.number().finite().min(0).max(10), attacksPerSecond: z.number().finite().min(0).max(51),
  low: unit, mid: unit, high: unit, texture: unit, flatness: unit, build: unit,
}).strict();
export const snapshotSchema = z.object({at: z.number().finite().min(0), current: summary, previous: summary.nullable()}).strict();
const distribution = z.object(Object.fromEntries(JEV_OPTIONS.map(k => [k, unit]))).strict();
const answerSchema = z.object({
  type: z.literal('choice'), choice: z.enum(JEV_OPTIONS), confidence: unit, probabilities: distribution,
}).refine(a => Math.abs(Object.values(a.probabilities).reduce((sum, v) => sum + v, 0) - 1) < .025,
  'Invalid probability sum').refine(a => a.probabilities[a.choice] >= Math.max(...Object.values(a.probabilities)) - .001,
  'Choice does not match distribution');
const resultSchema = z.object({
  model: z.string().max(80), answers: z.object({response: answerSchema}),
  usage: z.object({input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative()}),
});

export const JEV_MODEL = 'jev-1.13.0';
export const JEV_QUESTIONS = {
  response: {
    type: 'choice',
    instructions: 'Choose the single brightness response that best expresses the current passage described in `current`. Prefer faithful musical detail and contrast. Use only these observations; there is no raw audio or knowledge of what happens next. This is a stylistic judgment, not a mathematical calculation or prediction of a future beat.',
    criteria: {
      circle: 'Detailed direct stereo-scope response. Choose when the passage is mixed or changing and no more specialized response clearly fits.',
      grain: 'Fine restless variations reveal rough or broadband texture. Suits relatively restrained passages with ongoing texture and few dominant sharp attacks.',
      snap: 'Short bright accents with quick falls emphasize distinct sharp attacks. Suits energetic, punctuated activity, especially after a quieter passage.',
      sustain: 'Connected midrange body holds the light with a longer tail. Suits smooth, sustained energy with few distinct attacks.',
      uncertain: 'The observations are insufficient or contradictory, or the recording is effectively silent.',
    },
  },
};

export class JevError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

/** Official fixed endpoint only. No raw upstream errors or credentials are logged.
 * @param {unknown} snapshot
 * @param {{key?: string, signal?: AbortSignal, timeoutMs?: number}} [options]
 */
export async function requestJev(snapshot, {key, signal = undefined, timeoutMs = 1800} = {}) {
  if (!key) throw new JevError('TYPESAFE_API_KEY is not configured on the server.', 503);
  const parsed = snapshotSchema.parse(snapshot);
  const started = performance.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', redirect: 'error', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key}`},
      body: JSON.stringify({model: JEV_MODEL, state: describeSnapshot(parsed), questions: JEV_QUESTIONS}),
    });
  } catch {
    throw new JevError('Jev did not respond in time. Circle remains available.', 504);
  }
  if (!response.ok) {
    throw new JevError(response.status === 401 ? 'TypeSafe rejected the configured API key.' :
      response.status === 429 || response.status === 529 ? 'TypeSafe is busy. Requests are paused briefly.' :
      'TypeSafe could not complete this decision.', response.status === 401 ? 503 : response.status === 429 ? 429 : 502);
  }
  const parsedResponse = resultSchema.safeParse(await response.json().catch(() => null));
  if (!parsedResponse.success) throw new JevError('TypeSafe returned an unexpected decision format.');
  return {
    ...parsedResponse.data.answers.response, model: parsedResponse.data.model,
    usage: parsedResponse.data.usage, capturedAt: parsed.at,
    roundTripMs: Math.round(performance.now() - started),
  };
}
