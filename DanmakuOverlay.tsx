import React, { useEffect, useState, useRef } from "react";

// Local minimal comment shape to avoid missing external types
type Comment = {
  id: string;
  content: string;
  color?: string;
  isDanmaku?: boolean;
};

interface DanmakuOverlayProps {
  comments: Comment[];
  containerRef: React.RefObject<HTMLDivElement>;
}

interface ActiveDanmaku {
  id: string;
  text: string;
  top: number; // Percentage from top
  duration: number; // Animation duration
  color: string;
  startDelay: number;
}

const DanmakuOverlay: React.FC<DanmakuOverlayProps> = ({ comments, containerRef }) => {
  const [activeItems, setActiveItems] = useState<ActiveDanmaku[]>([]);
  const processedCommentIds = useRef<Set<string>>(new Set());
  const tracksRef = useRef<number[]>([]); // Keep track of occupied vertical tracks to avoid overlapping

  useEffect(() => {
    // Check for new comments that are marked as danmaku
    const newDanmaku = comments.filter(c => c.isDanmaku && !processedCommentIds.current.has(c.id));
    
    if (newDanmaku.length === 0) return;

    const itemsToAdd: ActiveDanmaku[] = [];

    newDanmaku.forEach(comment => {
      processedCommentIds.current.add(comment.id);
      
      // Calculate a random vertical track (0-90%)
      // Simple collision avoidance: try to pick a track not recently used
      const trackHeight = 10; // Approximate height percent of a line
      const possibleTracks = [10, 20, 30, 40, 50, 60, 70];
      const randomTrackIndex = Math.floor(Math.random() * possibleTracks.length);
      const top = possibleTracks[randomTrackIndex] + (Math.random() * 5 - 2.5); // Add slight jitter

      itemsToAdd.push({
        id: comment.id,
        text: comment.content,
        top: top,
        duration: 8 + Math.random() * 4, // 8-12 seconds duration
        color: comment.color || '#ffffff',
        startDelay: Math.random() * 1 // small random start delay
      });
    });

    setActiveItems(prev => [...prev, ...itemsToAdd]);

    // Cleanup old items periodically
    const cleanup = setTimeout(() => {
        setActiveItems(prev => prev.slice(-30)); // Only keep last 30 to prevent DOM overload
    }, 10000);

    return () => clearTimeout(cleanup);

  }, [comments]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-10 select-none">
      {activeItems.map(item => (
        <div
          key={item.id}
          className="danmaku-item text-xl md:text-2xl font-bold drop-shadow-md shadow-black"
          style={{
            top: `${item.top}%`,
            color: item.color,
            textShadow: '1px 1px 2px rgba(0,0,0,0.8), 0 0 5px rgba(0,0,0,0.5)',
            animationDuration: `${item.duration}s`,
            animationDelay: `${item.startDelay}s`,
            left: '100%', // Start off-screen right
          }}
        >
          {item.text}
        </div>
      ))}
    </div>
  );
};

export default DanmakuOverlay;
