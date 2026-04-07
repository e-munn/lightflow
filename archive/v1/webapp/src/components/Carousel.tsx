'use client';

import { useState, ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

interface CarouselItem {
  id: string;
  label: string;
  icon: LucideIcon;
  render: () => ReactNode;
}

interface CarouselProps {
  items: CarouselItem[];
}

export function Carousel({ items }: CarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const activeItem = items[activeIndex];

  return (
    <div className="flex flex-col h-full relative">
      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        <div key={activeItem.id} className="h-full">
          {activeItem.render()}
        </div>
      </div>

      {/* Navigation bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-gray-900/90 backdrop-blur-sm rounded-full px-2 py-1.5 border border-gray-700">
        {items.map((item, index) => {
          const Icon = item.icon;
          const isActive = activeIndex === index;
          return (
            <button
              key={item.id}
              onClick={() => setActiveIndex(index)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all ${
                isActive
                  ? 'bg-white text-black'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
              title={item.label}
            >
              <Icon className="w-4 h-4" />
              {isActive && (
                <span className="text-xs font-medium">{item.label}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
