import { useRef, useEffect } from 'react';
import { Z } from '../../constants/layout';
import { Popover } from '../shared/Popover';
import { MenuItem } from '../shared/MenuItem';

interface Props {
  x: number;
  y: number;
  onGoTo: () => void;
  onClose: () => void;
}

const CalendarIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="16" height="16" fill="currentColor" fillRule="evenodd">
    <path d="M11 4h-1v2H7.5A2.5 2.5 0 0 0 5 8.5V13h1v-2h16v8.5c0 .83-.67 1.5-1.5 1.5H14v1h6.5a2.5 2.5 0 0 0 2.5-2.5v-11A2.5 2.5 0 0 0 20.5 6H18V4h-1v2h-6V4Zm6 4V7h-6v1h-1V7H7.5C6.67 7 6 7.67 6 8.5V10h16V8.5c0-.83-.67-1.5-1.5-1.5H18v1h-1Zm-5.15 10.15-3.5-3.5-.7.7L10.29 18H4v1h6.3l-2.65 2.65.7.7 3.5-3.5.36-.35-.36-.35Z" />
  </svg>
);

export function ChartTimeScaleContextMenu({ x, y, onGoTo, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  const adjustedX = Math.min(x, window.innerWidth - 180);
  const adjustedY = Math.min(y, window.innerHeight - 60);

  return (
    <div ref={ref} className="fixed" style={{ left: adjustedX, top: adjustedY, zIndex: Z.DROPDOWN + 10 }}>
      <Popover onClose={onClose} className=" py-1" style={{ minWidth: 160 }}>
        <MenuItem icon={<CalendarIcon />} onClick={() => { onGoTo(); onClose(); }}>
          Go to...
        </MenuItem>
      </Popover>
    </div>
  );
}