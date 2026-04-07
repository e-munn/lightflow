'use client';

import { useState } from 'react';
import { LucideIcon } from 'lucide-react';

interface CarouselItem {
  id: string;
  label: string;
  icon: LucideIcon;
  render: () => React.ReactNode;
}

export function Carousel({ items }: { items: CarouselItem[] }) {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        {items[activeIndex]?.render()}
      </div>
      <div className="flex items-center justify-center gap-1 py-2 px-4">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveIndex(i)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-colors ${
                i === activeIndex
                  ? 'bg-white text-black'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Icon size={14} />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
