import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PlanPatchSchema } from '@/lib/director/schema';

export async function GET() {
  const schema = (z as unknown as { toJSONSchema: (s: unknown) => unknown })
    .toJSONSchema(PlanPatchSchema);
  return NextResponse.json(schema);
}
