'use client';

import { SectionPlan, EffectInstance } from '@/types/v3';

interface EffectListProps {
  currentSection: SectionPlan | null;
  allSections: SectionPlan[];
}

const BLEND_BADGES: Record<string, string> = {
  max: 'bg-gray-700',
  add: 'bg-blue-900',
  replace: 'bg-red-900',
};

function EffectCard({ effect, index }: { effect: EffectInstance; index: number }) {
  return (
    <div className="bg-gray-900 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">{effect.effect}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${BLEND_BADGES[effect.blend_mode] || 'bg-gray-700'} text-gray-300`}>
          {effect.blend_mode}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>src: {effect.intensity_source}</span>
        <span>·</span>
        <span>spd: {effect.speed.toFixed(1)}</span>
        <span>·</span>
        <span>int: {(effect.intensity * 100).toFixed(0)}%</span>
      </div>

      <div className="flex items-center gap-2">
        <div
          className="w-4 h-4 rounded-sm border border-gray-700"
          style={{
            backgroundColor: `rgb(${Math.round(effect.color.r * 255)}, ${Math.round(effect.color.g * 255)}, ${Math.round(effect.color.b * 255)})`,
          }}
        />
        <span className="text-xs text-gray-600">
          {effect.region.preset || 'custom'}
          {effect.pan_follow && ' · pan'}
          {effect.onset_mode && ' · onset'}
        </span>
      </div>
    </div>
  );
}

export function EffectList({ currentSection, allSections }: EffectListProps) {
  if (!currentSection) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">
        No show loaded
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs text-gray-500 uppercase tracking-wide">
          Active Effects — {currentSection.section_label}
        </h3>
        <span className="text-xs text-gray-600">
          {currentSection.effects.length} layers
        </span>
      </div>

      <div className="space-y-2">
        {currentSection.effects.map((effect, i) => (
          <EffectCard key={i} effect={effect} index={i} />
        ))}
      </div>
    </div>
  );
}
