import React, { useState, useRef, useEffect, ReactNode } from 'react';

interface ResizablePaneProps {
  leftPane: ReactNode;
  rightPane: ReactNode;
  initialLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  onResize?: (leftWidth: number) => void;
}

export const ResizablePane: React.FC<ResizablePaneProps> = ({
  leftPane,
  rightPane,
  initialLeftWidth = 300,
  minLeftWidth = 200,
  maxLeftWidth = 600,
  onResize,
}) => {
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newLeftWidth = e.clientX - containerRect.left;
      const clampedWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, newLeftWidth));
      
      setLeftWidth(clampedWidth);
      onResize?.(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, minLeftWidth, maxLeftWidth, onResize]);

  return (
    <div ref={containerRef} className="resizable-pane-container">
      <div className="resizable-pane-left" style={{ width: `${leftWidth}px` }}>
        {leftPane}
      </div>
      <div
        className="resizable-pane-divider"
        onMouseDown={() => setIsResizing(true)}
      />
      <div className="resizable-pane-right">
        {rightPane}
      </div>
    </div>
  );
};