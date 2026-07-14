import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import styles from './Header.module.css';

export function Header() {
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const openTickerPane = useAppStore((s) => s.openTickerPane);
  const strikeCount   = useAppStore((s) => s.strikeCount);
  const setStrikeCount = useAppStore((s) => s.setStrikeCount);
  const wsConnected   = useAppStore((s) => s.wsConnected);
  const openTickers   = useAppStore((s) => s.openTickers);
  const selectedDate   = useAppStore((s) => s.selectedDate);
  const setSelectedDate = useAppStore((s) => s.setSelectedDate);
  const [tickerInput, setTickerInput] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
        return;
      }

      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTextField =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if (isTextField || isSearchOpen) return;

      event.preventDefault();
      setIsSearchOpen(true);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSearchOpen]);

  function submitTicker(value: string) {
    const next = value.trim().toUpperCase();
    if (!next) return;
    openTickerPane(next);
    setRecentSearches((current) => [next, ...current.filter((ticker) => ticker !== next)].slice(0, 8));
    setTickerInput('');
    setIsSearchOpen(false);
  }

  function clearSearchHistory() {
    setRecentSearches([]);
  }

  const searchHistory = useMemo(
    () => Array.from(new Set(recentSearches)).slice(0, 8),
    [recentSearches],
  );
  const isAtCap = openTickers.length >= 5;
  const isCurrentTickerOpen = tickerInput.trim().length > 0
    ? openTickers.includes(tickerInput.trim().toUpperCase())
    : false;
  const isBlocked = isAtCap && !isCurrentTickerOpen;

  return (
    <header className={styles.header}>
      {/* Brand */}
      <div className={styles.brand}>
        <span className={styles.brandLogo}>◈</span>
        <span className={styles.brandName}>ATLAS</span>
        <span className={styles.brandTagline}>Dealer Positioning</span>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'heatmap' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('heatmap')}
        >
          Heatmaps
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'compass' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('compass')}
        >
          Compass
        </button>
      </div>

      {/* Ticker Search */}
      <button
        className={styles.searchTrigger}
        type="button"
        onClick={() => setIsSearchOpen(true)}
        title="Open ticker search [Tab]"
        aria-label="Open ticker search, shortcut Tab"
      >
        <span className={styles.searchTriggerLabel}>Search Tickers</span>
        <span className={styles.searchShortcut}>[TAB]</span>
      </button>

      <label className={styles.strikeControl} title="Number of strike rows to render">
        <span className={styles.strikeLabel}>Strikes</span>
        <select
          className={styles.strikeSelect}
          value={strikeCount}
          onChange={(e) => setStrikeCount(Number(e.target.value))}
          aria-label="Number of strikes"
        >
          {[10, 20, 30, 40, 50, 60].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.strikeControl} title="Select historical session date">
        <span className={styles.strikeLabel}>Date</span>
        <input
          type="date"
          className={styles.strikeSelect}
          style={{ width: '120px' }}
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          aria-label="Historical date"
        />
      </label>

      {/* Connection Status */}
      <div className={styles.status}>
        <span
          className={`${styles.statusDot} ${wsConnected ? styles.statusLive : styles.statusOff}`}
        />
        <span className={styles.statusLabel}>{wsConnected ? 'LIVE' : 'OFFLINE'}</span>
      </div>

      {isSearchOpen && (
        <div className={styles.searchOverlay} role="presentation" onMouseDown={() => setIsSearchOpen(false)}>
          <section
            className={styles.searchPane}
            role="dialog"
            aria-modal="true"
            aria-label="Ticker search"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className={styles.searchHeader}>
              <span className={styles.searchTitle}>Ticker Search</span>
              <button
                className={styles.searchClose}
                type="button"
                aria-label="Close search"
                onClick={() => setIsSearchOpen(false)}
              >
                ×
              </button>
            </div>
            <form
              className={styles.searchForm}
              onSubmit={(e) => {
                e.preventDefault();
                submitTicker(tickerInput);
              }}
            >
              <input
                id="ticker-search-input"
                className={`${styles.tickerInput} ${isBlocked ? styles.tickerInputBlocked : ''}`}
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                placeholder="Search ticker"
                autoComplete="off"
                spellCheck={false}
                aria-label="Search ticker"
                autoFocus
              />
              <button
                className={`${styles.tickerSubmit} ${isBlocked ? styles.tickerSubmitBlocked : ''}`}
                type="submit"
                disabled={isBlocked}
                title={isBlocked ? 'Maximum of 5 open panes' : undefined}
              >
                Open
              </button>
            </form>
            {isBlocked && (
              <div className={styles.capHint}>Maximum of 5 open panes.</div>
            )}
            <div className={styles.historySection}>
              <div className={styles.historyHeader}>
                <div className={styles.historyLabel}>History</div>
                <button
                  type="button"
                  className={styles.historyClear}
                  onClick={clearSearchHistory}
                  disabled={recentSearches.length === 0}
                  aria-label="Clear search history"
                >
                  Clear
                </button>
              </div>
              <div className={styles.historyList}>
                {searchHistory.map((ticker) => (
                  <button
                    key={ticker}
                    type="button"
                    className={styles.historyItem}
                    onClick={() => {
                      setTickerInput(ticker);
                      submitTicker(ticker);
                    }}
                  >
                    {ticker}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </header>
  );
}
