const VITE_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const BASE = `${VITE_API_BASE_URL}/api/v1/gamma-flow`;

export interface GammaStrike {
  timestamp: number;
  ticker: string;
  strike: number;
  price: number;
  dealer_gamma_vol: number;
  dealer_gamma_oi?: number;
  dealer_gamma_vol_change?: number;
  call_gamma_vol: number;
  put_gamma_vol: number;
  dealer_delta_vol?: number;
  call_delta_vol?: number;
  put_delta_vol?: number;
}

export interface NetFlowData {
  ticker: string;
  price: number;
  timestamp: number;
  net_call_prem: number;
  net_call_vol: number;
  net_put_prem: number;
  net_put_vol: number;
  net_premium: number;
  net_volume: number;
}

export interface GammaFlowResponse {
  ticker: string;
  price: number;
  timestamp: number;
  strikes: GammaStrike[];
  net_flow: NetFlowData | null;
}

export interface HistoricalGammaResponse {
  ticker: string;
  date: string;
  history: GammaStrike[];
}

export interface HistoricalNetFlowResponse {
  ticker: string;
  date: string;
  history: NetFlowData[];
}

export interface AvailableDatesResponse {
  ticker: string;
  dates: string[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText} on ${path}`);
  }
  return res.json() as Promise<T>;
}

export const gammaFlowApi = {
  getCurrentGamma: (ticker: string): Promise<GammaFlowResponse> =>
    get<GammaFlowResponse>(`/current/${ticker}`),

  getHistoricalGamma: (
    ticker: string,
    opts: { date?: string; limit?: number } = {}
  ): Promise<HistoricalGammaResponse> => {
    const params = new URLSearchParams();
    if (opts.date) params.set('date', opts.date);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return get<HistoricalGammaResponse>(`/historical/${ticker}${qs}`);
  },

  getCurrentNetFlow: (ticker: string): Promise<NetFlowData> =>
    get<NetFlowData>(`/net-flow/current/${ticker}`),

  getHistoricalNetFlow: (
    ticker: string,
    opts: { date?: string; limit?: number } = {}
  ): Promise<HistoricalNetFlowResponse> => {
    const params = new URLSearchParams();
    if (opts.date) params.set('date', opts.date);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return get<HistoricalNetFlowResponse>(`/net-flow/historical/${ticker}${qs}`);
  },

  getAvailableDates: (ticker: string): Promise<AvailableDatesResponse> =>
    get<AvailableDatesResponse>(`/dates/${ticker}`),
};
