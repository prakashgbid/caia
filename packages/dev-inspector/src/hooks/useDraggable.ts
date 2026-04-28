import { useRef, useCallback, useEffect } from 'react';

export interface Position {
  x: number;
  y: number;
}

export function useDraggable(initialPosition: Position) {
  const posRef = useRef<Position>(initialPosition);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; posX: number; posY: number } | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);

  const setElement = useCallback((el: HTMLElement | null) => {
    elementRef.current = el;
    if (el) {
      el.style.left = `${posRef.current.x}px`;
      el.style.top = `${posRef.current.y}px`;
    }
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    // Only drag on title bar direct clicks, not buttons inside
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: posRef.current.x,
      posY: posRef.current.y,
    };
    e.preventDefault();
  }, []);

  useEffect(() => {
    function onMouseMove(e: MouseEvent): void {
      if (!dragStartRef.current || !elementRef.current) return;
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      const newX = dragStartRef.current.posX + dx;
      const newY = dragStartRef.current.posY + dy;
      posRef.current = { x: newX, y: newY };
      elementRef.current.style.left = `${newX}px`;
      elementRef.current.style.top = `${newY}px`;
    }

    function onMouseUp(): void {
      dragStartRef.current = null;
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return { setElement, onMouseDown };
}
