export interface NewsEvent {
  id: string;
  title: string;
  date: string; // ISO 8601 UTC
  impact: 'high' | 'medium' | 'low';
  category: 'fed' | 'inflation' | 'employment' | 'other';
  actual: number | null;
  consensus: number | null;
  previous: number | null;
  isBetterThanExpected: boolean | null;
  country: string;
  currency: string;
}
