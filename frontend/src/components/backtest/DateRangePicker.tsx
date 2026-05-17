import { DatePickerModal } from '../shared/DatePickerModal';

interface Props {
  from: string;
  to: string;
  minDate?: string;
  maxDate?: string;
  onChange: (from: string, to: string) => void;
  onClose: () => void;
}

export function DateRangePicker({ from, to, minDate, maxDate, onChange, onClose }: Props) {
  return (
    <DatePickerModal
      mode="range"
      title="Date Range"
      from={from}
      to={to}
      minDate={minDate}
      maxDate={maxDate}
      onChange={onChange}
      onClose={onClose}
    />
  );
}
