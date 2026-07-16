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
  isMock?: boolean;
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
  isMock?: boolean;
}

export interface AvailableDatesResponse {
  ticker: string;
  dates: string[];
}

// ─── Mock Data Generators ────────────────────────────────────────────────────

const TICKER_SPOTS: Record<string, number> = {
  SPY: 548.20,
  QQQ: 711.40,
  IWM: 295.80,
  NVDA: 208.90,
  AAPL: 328.20,
  TSLA: 392.50,
  MSFT: 398.80,
};

export function generateMockGammaFlow(ticker: string): GammaFlowResponse {
  const spot = TICKER_SPOTS[ticker.toUpperCase()] || 100.0;
  const timestamp = Math.floor(Date.now() / 1000);
  const strikes: GammaStrike[] = [];

  // Generate 15 strikes around spot price
  const strikeInterval = spot > 500 ? 5 : spot > 200 ? 2.5 : 1;
  const baseStrike = Math.round(spot / strikeInterval) * strikeInterval;

  for (let i = -7; i <= 7; i++) {
    const strike = baseStrike + i * strikeInterval;
    // Positive gamma above spot (calls dominant), negative below spot (puts dominant)
    const isAboveSpot = strike > spot;
    const factor = Math.exp(-Math.abs(strike - spot) / (strikeInterval * 4));
    
    // Scale values to realistic sizes (billions for index ETFs, millions for stock options)
    const multiplier = ['SPY', 'QQQ'].includes(ticker) ? 1.5e9 : 3.5e7;
    const dealerGamma = (isAboveSpot ? 1.2 : -1.0) * factor * multiplier * (0.8 + Math.random() * 0.4);
    const callGamma = Math.max(0, dealerGamma) + Math.random() * 0.2 * multiplier;
    const putGamma = Math.min(0, dealerGamma) - Math.random() * 0.2 * multiplier;

    strikes.push({
      timestamp,
      ticker,
      strike,
      price: spot,
      dealer_gamma_vol: dealerGamma,
      call_gamma_vol: callGamma,
      put_gamma_vol: putGamma,
    });
  }

  // Generate net flow metrics
  const multiplier = ['SPY', 'QQQ'].includes(ticker) ? 1.0e9 : 1.0e7;
  const netCallPrem = (1.5 + Math.random() * 1.0) * multiplier;
  const netPutPrem = (1.0 + Math.random() * 1.0) * multiplier;

  const netFlow: NetFlowData = {
    ticker,
    price: spot,
    timestamp,
    net_call_prem: netCallPrem,
    net_put_prem: netPutPrem,
    net_premium: netCallPrem - netPutPrem,
    net_call_vol: Math.floor(netCallPrem / 100),
    net_put_vol: Math.floor(netPutPrem / 100),
    net_volume: Math.floor((netCallPrem - netPutPrem) / 100),
  };

  return {
    ticker,
    price: spot,
    timestamp,
    strikes,
    net_flow: netFlow,
    isMock: true,
  };
}

export function generateMockNetFlowHistory(ticker: string): HistoricalNetFlowResponse {
  const spot = TICKER_SPOTS[ticker.toUpperCase()] || 100.0;
  const history: NetFlowData[] = [];
  const now = Math.floor(Date.now() / 1000);
  
  // Generate 20 data points spanning a trading day
  const multiplier = ['SPY', 'QQQ'].includes(ticker) ? 1.0e9 : 1.0e7;
  let callPrem = 0.2 * multiplier;
  let putPrem = 0.1 * multiplier;

  for (let i = 0; i < 20; i++) {
    const timestamp = now - (20 - i) * 600; // 10 minutes interval
    // Simulating random walk upwards
    callPrem += (Math.random() - 0.35) * 0.25 * multiplier;
    putPrem += (Math.random() - 0.4) * 0.2 * multiplier;

    history.push({
      ticker,
      price: spot + (Math.random() - 0.5) * 2,
      timestamp,
      net_call_prem: Math.max(0, callPrem),
      net_put_prem: Math.max(0, putPrem),
      net_premium: callPrem - putPrem,
      net_call_vol: Math.floor(callPrem / 100),
      net_put_vol: Math.floor(putPrem / 100),
      net_volume: Math.floor((callPrem - putPrem) / 100),
    });
  }

  return {
    ticker,
    date: new Date().toISOString().split('T')[0],
    history,
    isMock: true,
  };
}

export function generateMockGammaHistory(ticker: string): HistoricalGammaResponse {
  const spot = TICKER_SPOTS[ticker.toUpperCase()] || 100.0;
  const history: GammaStrike[] = [];
  const now = Math.floor(Date.now() / 1000);

  const strikeInterval = spot > 500 ? 5 : spot > 200 ? 2.5 : 1;
  const baseStrike = Math.round(spot / strikeInterval) * strikeInterval;

  // Let the spot price drift dynamically over 20 timestamps
  let currentSpot = spot;

  for (let tIdx = 0; tIdx < 20; tIdx++) {
    const timestamp = now - (20 - tIdx) * 600; // 10 min intervals
    // Random walk drift for price line
    currentSpot += (Math.random() - 0.5) * 1.5;

    for (let i = -7; i <= 7; i++) {
      const strike = baseStrike + i * strikeInterval;
      const isAboveSpot = strike > currentSpot;
      const factor = Math.exp(-Math.abs(strike - currentSpot) / (strikeInterval * 4));
      
      const multiplier = ['SPY', 'QQQ'].includes(ticker) ? 1.5e9 : 3.5e7;
      const dealerGamma = (isAboveSpot ? 1.2 : -1.0) * factor * multiplier * (0.8 + Math.random() * 0.4);
      const callGamma = Math.max(0, dealerGamma) + Math.random() * 0.2 * multiplier;
      const putGamma = Math.min(0, dealerGamma) - Math.random() * 0.2 * multiplier;

      history.push({
        timestamp,
        ticker,
        strike,
        price: currentSpot,
        dealer_gamma_vol: dealerGamma,
        call_gamma_vol: callGamma,
        put_gamma_vol: putGamma,
      });
    }
  }

  return {
    ticker,
    date: new Date().toISOString().split('T')[0],
    history,
  };
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
  getCurrentGamma: async (ticker: string): Promise<GammaFlowResponse> => {
    try {
      return await get<GammaFlowResponse>(`/current/${ticker}`);
    } catch (e) {
      console.warn(`GammaFlow API offline, returning mock data for ${ticker}`);
      return generateMockGammaFlow(ticker);
    }
  },

  getHistoricalGamma: async (
    ticker: string,
    opts: { date?: string; limit?: number } = {}
  ): Promise<HistoricalGammaResponse> => {
    try {
      const params = new URLSearchParams();
      if (opts.date) params.set('date', opts.date);
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      return await get<HistoricalGammaResponse>(`/historical/${ticker}${qs}`);
    } catch (e) {
      return generateMockGammaHistory(ticker);
    }
  },

  getCurrentNetFlow: async (ticker: string): Promise<NetFlowData> => {
    try {
      return await get<NetFlowData>(`/net-flow/current/${ticker}`);
    } catch (e) {
      return generateMockGammaFlow(ticker).net_flow!;
    }
  },

  getHistoricalNetFlow: async (
    ticker: string,
    opts: { date?: string; limit?: number } = {}
  ): Promise<HistoricalNetFlowResponse> => {
    try {
      const params = new URLSearchParams();
      if (opts.date) params.set('date', opts.date);
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      const qs = params.toString() ? `?${params.toString()}` : '';
      return await get<HistoricalNetFlowResponse>(`/net-flow/historical/${ticker}${qs}`);
    } catch (e) {
      return generateMockNetFlowHistory(ticker);
    }
  },

  getAvailableDates: (ticker: string): Promise<AvailableDatesResponse> =>
    get<AvailableDatesResponse>(`/dates/${ticker}`),
};
