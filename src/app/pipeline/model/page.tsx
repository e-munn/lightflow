import { redirect } from 'next/navigation';

// The current research view is recorded movement with source audio.
export default function ModelPage() { redirect('/pipeline/live'); }
