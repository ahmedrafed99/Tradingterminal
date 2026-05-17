import { useState } from 'react';
import { DatePickerModal } from '../shared/DatePickerModal';

const NY_TZ = 'America/New_York';

function nyNow() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return { year: parseInt(parts.year), month: parseInt(parts.month), day: parseInt(parts.day) };
}

function nyLocalToUtcSeconds(dateStr: string, timeStr: string): number {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, m);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(asUtc)).map(p => [p.type, p.value]));
  const nyUtc = Date.UTC(parseInt(parts.year), parseInt(parts.month) - 1, parseInt(parts.day), parseInt(parts.hour) % 24, parseInt(parts.minute));
  return Math.floor((asUtc + (asUtc - nyUtc)) / 1000);
}

function pad(n: number) { return String(n).padStart(2, '0'); }

interface Props {
  onClose: () => void;
  onGoTo: (utcSeconds: number) => void;
}

export function GoToModal({ onClose, onGoTo }: Props) {
  const today = nyNow();
  const [dateStr, setDateStr] = useState(`${today.year}-${pad(today.month)}-${pad(today.day)}`);
  const [timeStr, setTimeStr] = useState('09:30');

  function handleGoTo() {
    onGoTo(nyLocalToUtcSeconds(dateStr, timeStr));
    onClose();
  }

  return (
    <DatePickerModal
      mode="single"
      title="Go to"
      date={dateStr}
      time={timeStr}
      confirmLabel="Go to"
      today={today}
      onDateChange={setDateStr}
      onTimeChange={setTimeStr}
      onConfirm={handleGoTo}
      onClose={onClose}
    />
  );
}
