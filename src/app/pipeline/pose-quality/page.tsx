import heavyStudy from '../../../../research/dance/pose-quality-study-2026-09-23.json';
import rtmwStudy from '../../../../research/dance/rtmw-quality-study-2026-09-23.json';
import PoseComparison from './PoseComparison';

export default function PoseQualityPage() {
  const passages = [
    ...rtmwStudy.rows.map(row => ({...row, candidateLabel: 'RTMW'})),
    ...heavyStudy.rows.map(row => ({...row, candidateLabel: 'Heavy'})),
  ].map(row => ({
    title: row.title,
    baseline: row.baseline,
    candidate: row.candidate,
    candidateLabel: row.candidateLabel,
    before: row.before.coverage,
    after: row.after.coverage,
  }));
  return <PoseComparison passages={passages}/>;
}
