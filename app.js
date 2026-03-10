/**
 * ICT Trading Checker — US100
 * ระบบตรวจสอบเงื่อนไข ICT Trading จากคลิป "ปลาทูดูกราฟ"
 * 
 * เงื่อนไข 4 ข้อ:
 * 1. Liquidity Sweep — ราคา Sweep High/Low ก่อนหน้า
 * 2. Market Structure Shift (MSS) — Break of Structure หลัง Sweep
 * 3. Fair Value Gap (FVG) — ช่องว่างราคา 3 แท่งเทียน
 * 4. Entry at FVG — ราคาย้อนกลับเข้า FVG
 */

// ============================================================
// Configuration
// ============================================================
const CONFIG = {
  symbol: 'NQ=F', // Nasdaq 100 Futures (Yahoo Finance)
  refreshInterval: 30000, // 30 seconds
  corsProxy: 'https://corsproxy.io/?',
  lookbackCandles: 100, // Number of candles to analyze
  swingLookback: 5, // Candles each side for swing detection
  fvgMinGapPercent: 0.02, // Minimum FVG gap as % of price
  entryFvgTolerance: 0.3, // 30% penetration into FVG counts as entry
};

// Timeframe mapping for Yahoo Finance
const TIMEFRAME_MAP = {
  '1': { interval: '1m', range: '1d' },
  '5': { interval: '5m', range: '5d' },
  '15': { interval: '15m', range: '5d' },
  '60': { interval: '60m', range: '10d' },
};

// ============================================================
// Global State
// ============================================================
let chart = null;
let candleSeries = null;
let chartMarkers = [];
let fvgBoxes = [];
let currentTimeframe = '5';
let candles = [];
let autoCheckEnabled = true;
let autoCheckTimer = null;
let countdown = 30;
let countdownTimer = null;
let soundEnabled = true;
let analysisResult = null;

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  initControls();
  fetchDataAndAnalyze();
  startAutoCheck();
  addLog('info', 'ระบบ ICT Trading Checker เริ่มทำงาน');
  addLog('info', 'อ้างอิงแผนจาก: ปลาทูดูกราฟ — ระบบเทรด ICT');
});

// ============================================================
// Chart Setup (TradingView Lightweight Charts)
// ============================================================
function initChart() {
  const container = document.getElementById('chart-container');

  chart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#9ca3af',
      fontFamily: "'Inter', 'Noto Sans Thai', sans-serif",
      fontSize: 12,
    },
    grid: {
      vertLines: { color: 'rgba(255,255,255,0.03)' },
      horzLines: { color: 'rgba(255,255,255,0.03)' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: {
        color: 'rgba(59, 130, 246, 0.3)',
        width: 1,
        style: LightweightCharts.LineStyle.Dashed,
      },
      horzLine: {
        color: 'rgba(59, 130, 246, 0.3)',
        width: 1,
        style: LightweightCharts.LineStyle.Dashed,
      },
    },
    rightPriceScale: {
      borderColor: 'rgba(255,255,255,0.08)',
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
    timeScale: {
      borderColor: 'rgba(255,255,255,0.08)',
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: { vertTouchDrag: false },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#10b981',
    downColor: '#ef4444',
    borderUpColor: '#10b981',
    borderDownColor: '#ef4444',
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
  });

  // Resize observer
  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      chart.applyOptions({ width, height });
    }
  });
  resizeObserver.observe(container);
}

// ============================================================
// Controls Setup
// ============================================================
function initControls() {
  // Timeframe buttons
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTimeframe = btn.dataset.tf;
      addLog('info', `เปลี่ยน Timeframe เป็น ${btn.textContent}`);
      fetchDataAndAnalyze();
    });
  });

  // Check now button
  document.getElementById('check-now-btn').addEventListener('click', () => {
    fetchDataAndAnalyze();
    addLog('info', 'ตรวจสอบเงื่อนไขด้วยตนเอง');
  });

  // Auto-check toggle
  document.getElementById('auto-check-toggle').addEventListener('change', (e) => {
    autoCheckEnabled = e.target.checked;
    if (autoCheckEnabled) {
      startAutoCheck();
      addLog('info', 'เปิด Auto-Check');
    } else {
      stopAutoCheck();
      addLog('info', 'ปิด Auto-Check');
    }
  });

  // Sound toggle
  document.getElementById('sound-toggle').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('sound-toggle');
    btn.textContent = soundEnabled ? '🔔' : '🔕';
    btn.classList.toggle('active', soundEnabled);
  });
}

// ============================================================
// Data Fetching (Yahoo Finance via CORS Proxy)
// ============================================================
async function fetchDataAndAnalyze() {
  const loading = document.getElementById('chart-loading');
  loading.classList.remove('hidden');

  try {
    const tf = TIMEFRAME_MAP[currentTimeframe];
    const url = `${CONFIG.corsProxy}https://query1.finance.yahoo.com/v8/finance/chart/${CONFIG.symbol}?interval=${tf.interval}&range=${tf.range}&includePrePost=true`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const result = data.chart.result[0];

    if (!result || !result.timestamp) {
      throw new Error('ไม่พบข้อมูล');
    }

    candles = parseYahooData(result);

    if (candles.length === 0) {
      throw new Error('ไม่มีข้อมูลแท่งเทียน');
    }

    // Update chart
    candleSeries.setData(candles);
    chart.timeScale().fitContent();

    // Update price display
    updatePriceDisplay(candles);

    // Clear previous markers and drawings
    clearChartDrawings();

    // Run ICT analysis
    analysisResult = analyzeICT(candles);

    // Update UI with results
    updateConditionsUI(analysisResult);
    drawAnalysisOnChart(analysisResult);

    addLog('success', `โหลดข้อมูลสำเร็จ — ${candles.length} แท่งเทียน (${tf.interval})`);

  } catch (error) {
    console.error('Fetch error:', error);
    addLog('error', `โหลดข้อมูลล้มเหลว: ${error.message}`);

    // Try fallback with demo data
    if (candles.length === 0) {
      generateDemoData();
    }
  } finally {
    loading.classList.add('hidden');
  }
}

function parseYahooData(result) {
  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];
  const parsed = [];

  for (let i = 0; i < timestamps.length; i++) {
    if (quote.open[i] != null && quote.close[i] != null &&
      quote.high[i] != null && quote.low[i] != null) {
      parsed.push({
        time: timestamps[i],
        open: parseFloat(quote.open[i].toFixed(2)),
        high: parseFloat(quote.high[i].toFixed(2)),
        low: parseFloat(quote.low[i].toFixed(2)),
        close: parseFloat(quote.close[i].toFixed(2)),
        volume: quote.volume[i] || 0,
      });
    }
  }

  return parsed;
}

function updatePriceDisplay(data) {
  if (data.length < 2) return;
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const change = last.close - prev.close;
  const changePct = ((change / prev.close) * 100).toFixed(2);

  document.getElementById('current-price').textContent = last.close.toFixed(2);
  const changeEl = document.getElementById('price-change');
  changeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct}%)`;
  changeEl.className = `price-change ${change >= 0 ? 'up' : 'down'}`;
}

// ============================================================
// Demo Data Fallback
// ============================================================
function generateDemoData() {
  addLog('warning', 'ใช้ข้อมูลตัวอย่าง — ไม่สามารถเชื่อมต่อ API ได้');
  const now = Math.floor(Date.now() / 1000);
  const interval = currentTimeframe === '1' ? 60 : currentTimeframe === '5' ? 300 : currentTimeframe === '15' ? 900 : 3600;

  candles = [];
  let price = 21500;
  for (let i = 200; i >= 0; i--) {
    const time = now - i * interval;
    const volatility = 15 + Math.random() * 30;
    const direction = Math.random() > 0.5 ? 1 : -1;
    const open = price;
    const close = open + direction * volatility * (0.5 + Math.random());
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    price = close;

    candles.push({
      time,
      open: parseFloat(open.toFixed(2)),
      high: parseFloat(high.toFixed(2)),
      low: parseFloat(low.toFixed(2)),
      close: parseFloat(close.toFixed(2)),
    });
  }

  candleSeries.setData(candles);
  chart.timeScale().fitContent();
  updatePriceDisplay(candles);

  analysisResult = analyzeICT(candles);
  updateConditionsUI(analysisResult);
  drawAnalysisOnChart(analysisResult);
}

// ============================================================
// ICT Analysis Engine
// ============================================================
function analyzeICT(data) {
  if (data.length < CONFIG.lookbackCandles) {
    // Use all available data if less than lookback
  }

  const result = {
    direction: null, // 'buy' or 'sell'
    conditions: {
      liquiditySweep: { passed: false, detail: '', level: null, index: null },
      mss: { passed: false, detail: '', level: null, index: null },
      fvg: { passed: false, detail: '', high: null, low: null, index: null },
      entry: { passed: false, detail: '', price: null },
    },
    sl: null,
    tp2: null, // 1:2 RR TP
    tp3: null, // 1:3 RR TP
    entryPrice: null,
    passedCount: 0,
  };

  // Step 1: Find swing highs and swing lows
  const swings = findSwings(data);

  // Step 2: Check for Liquidity Sweep
  const sweepResult = detectLiquiditySweep(data, swings);
  if (sweepResult) {
    result.conditions.liquiditySweep = {
      passed: true,
      detail: sweepResult.detail,
      level: sweepResult.level,
      index: sweepResult.index,
    };
    result.direction = sweepResult.direction;

    // Step 3: Check for MSS after sweep
    const mssResult = detectMSS(data, sweepResult);
    if (mssResult) {
      result.conditions.mss = {
        passed: true,
        detail: mssResult.detail,
        level: mssResult.level,
        index: mssResult.index,
      };

      // Step 4: Check for FVG after MSS
      const fvgResult = detectFVG(data, mssResult, sweepResult.direction);
      if (fvgResult) {
        result.conditions.fvg = {
          passed: true,
          detail: fvgResult.detail,
          high: fvgResult.high,
          low: fvgResult.low,
          index: fvgResult.index,
        };

        // Step 5: Check for Entry at FVG
        const entryResult = detectEntry(data, fvgResult, sweepResult.direction);
        if (entryResult) {
          result.conditions.entry = {
            passed: true,
            detail: entryResult.detail,
            price: entryResult.price,
          };
          result.entryPrice = entryResult.price;
        }
      }
    }

    // Calculate SL/TP
    if (result.entryPrice || result.conditions.fvg.passed) {
      const entry = result.entryPrice || (result.direction === 'sell'
        ? result.conditions.fvg.high
        : result.conditions.fvg.low);
      result.entryPrice = entry;
      result.sl = sweepResult.level;

      const risk = Math.abs(entry - result.sl);
      if (result.direction === 'sell') {
        result.tp2 = entry - risk * 2;
        result.tp3 = entry - risk * 3;
      } else {
        result.tp2 = entry + risk * 2;
        result.tp3 = entry + risk * 3;
      }
    }
  }

  // Count passed conditions
  result.passedCount = Object.values(result.conditions).filter(c => c.passed).length;

  return result;
}

// ============================================================
// Swing Detection
// ============================================================
function findSwings(data) {
  const swingHighs = [];
  const swingLows = [];
  const n = CONFIG.swingLookback;

  for (let i = n; i < data.length - n; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= n; j++) {
      if (data[i].high <= data[i - j].high || data[i].high <= data[i + j].high) {
        isHigh = false;
      }
      if (data[i].low >= data[i - j].low || data[i].low >= data[i + j].low) {
        isLow = false;
      }
    }

    if (isHigh) {
      swingHighs.push({ index: i, price: data[i].high, time: data[i].time });
    }
    if (isLow) {
      swingLows.push({ index: i, price: data[i].low, time: data[i].time });
    }
  }

  return { highs: swingHighs, lows: swingLows };
}

// ============================================================
// Liquidity Sweep Detection
// ============================================================
function detectLiquiditySweep(data, swings) {
  const recentCount = 30; // Look at last 30 candles
  const startIdx = Math.max(0, data.length - recentCount);

  // Check for sweep of recent swing high (bearish setup)
  for (let i = swings.highs.length - 1; i >= 0; i--) {
    const swingH = swings.highs[i];
    if (swingH.index < startIdx) continue;

    // Look for candles after this swing that go above then close below
    for (let j = swingH.index + 1; j < data.length; j++) {
      if (data[j].high > swingH.price && data[j].close < swingH.price) {
        return {
          direction: 'sell',
          level: data[j].high,
          index: j,
          detail: `ราคา Sweep Swing High ที่ ${swingH.price.toFixed(2)} (แท่งเทียน ${j})`,
        };
      }
    }
  }

  // Check for sweep of recent swing low (bullish setup)
  for (let i = swings.lows.length - 1; i >= 0; i--) {
    const swingL = swings.lows[i];
    if (swingL.index < startIdx) continue;

    for (let j = swingL.index + 1; j < data.length; j++) {
      if (data[j].low < swingL.price && data[j].close > swingL.price) {
        return {
          direction: 'buy',
          level: data[j].low,
          index: j,
          detail: `ราคา Sweep Swing Low ที่ ${swingL.price.toFixed(2)} (แท่งเทียน ${j})`,
        };
      }
    }
  }

  return null;
}

// ============================================================
// Market Structure Shift (MSS) Detection
// ============================================================
function detectMSS(data, sweep) {
  const startIdx = sweep.index;

  if (sweep.direction === 'sell') {
    // After sweeping high, look for break below recent swing low
    let recentLow = Infinity;
    let recentLowIdx = startIdx;

    // Find the recent swing low before/at the sweep
    for (let i = Math.max(0, startIdx - 10); i <= startIdx; i++) {
      if (data[i].low < recentLow) {
        recentLow = data[i].low;
        recentLowIdx = i;
      }
    }

    // Check if price breaks below this low
    for (let i = startIdx + 1; i < data.length; i++) {
      if (data[i].close < recentLow) {
        return {
          level: recentLow,
          index: i,
          detail: `MSS: Break below ${recentLow.toFixed(2)} หลัง Sweep High`,
        };
      }
    }
  } else {
    // After sweeping low, look for break above recent swing high
    let recentHigh = -Infinity;
    let recentHighIdx = startIdx;

    for (let i = Math.max(0, startIdx - 10); i <= startIdx; i++) {
      if (data[i].high > recentHigh) {
        recentHigh = data[i].high;
        recentHighIdx = i;
      }
    }

    for (let i = startIdx + 1; i < data.length; i++) {
      if (data[i].close > recentHigh) {
        return {
          level: recentHigh,
          index: i,
          detail: `MSS: Break above ${recentHigh.toFixed(2)} หลัง Sweep Low`,
        };
      }
    }
  }

  return null;
}

// ============================================================
// Fair Value Gap (FVG) Detection
// ============================================================
function detectFVG(data, mss, direction) {
  // Look for FVGs around the MSS area (from sweep area to MSS)
  const searchStart = Math.max(0, mss.index - 15);
  const searchEnd = Math.min(data.length - 1, mss.index + 5);

  const fvgs = [];

  for (let i = searchStart + 1; i < searchEnd - 1 && i < data.length - 1; i++) {
    if (direction === 'sell') {
      // Bearish FVG: candle1 low > candle3 high (gap down)
      const gap = data[i - 1].low - data[i + 1].high;
      const gapPct = gap / data[i].close;

      if (gap > 0 && gapPct >= CONFIG.fvgMinGapPercent / 100) {
        fvgs.push({
          high: data[i - 1].low,
          low: data[i + 1].high,
          index: i,
          gap: gap,
          detail: `Bearish FVG: ${data[i + 1].high.toFixed(2)} — ${data[i - 1].low.toFixed(2)}`,
        });
      }
    } else {
      // Bullish FVG: candle1 high < candle3 low (gap up)
      const gap = data[i + 1].low - data[i - 1].high;
      const gapPct = gap / data[i].close;

      if (gap > 0 && gapPct >= CONFIG.fvgMinGapPercent / 100) {
        fvgs.push({
          high: data[i + 1].low,
          low: data[i - 1].high,
          index: i,
          gap: gap,
          detail: `Bullish FVG: ${data[i - 1].high.toFixed(2)} — ${data[i + 1].low.toFixed(2)}`,
        });
      }
    }
  }

  // Return the most recent FVG closest to MSS
  if (fvgs.length > 0) {
    // Sort by proximity to MSS
    fvgs.sort((a, b) => Math.abs(b.index - mss.index) - Math.abs(a.index - mss.index));
    return fvgs[0];
  }

  // Relax the gap percentage requirement and try again
  for (let i = searchStart + 1; i < searchEnd - 1 && i < data.length - 1; i++) {
    if (direction === 'sell') {
      const gap = data[i - 1].low - data[i + 1].high;
      if (gap > 0) {
        return {
          high: data[i - 1].low,
          low: data[i + 1].high,
          index: i,
          gap: gap,
          detail: `Bearish FVG: ${data[i + 1].high.toFixed(2)} — ${data[i - 1].low.toFixed(2)}`,
        };
      }
    } else {
      const gap = data[i + 1].low - data[i - 1].high;
      if (gap > 0) {
        return {
          high: data[i + 1].low,
          low: data[i - 1].high,
          index: i,
          gap: gap,
          detail: `Bullish FVG: ${data[i - 1].high.toFixed(2)} — ${data[i + 1].low.toFixed(2)}`,
        };
      }
    }
  }

  return null;
}

// ============================================================
// Entry Detection (Price retracing into FVG)
// ============================================================
function detectEntry(data, fvg, direction) {
  // Check if any candle after the FVG has retraced into it
  for (let i = fvg.index + 2; i < data.length; i++) {
    const mid = (fvg.high + fvg.low) / 2;

    if (direction === 'sell') {
      // Price should retrace up into the bearish FVG
      if (data[i].high >= fvg.low + (fvg.high - fvg.low) * CONFIG.entryFvgTolerance) {
        return {
          price: mid,
          detail: `ราคาย้อนเข้า FVG ที่ ${mid.toFixed(2)} — พร้อม Sell`,
        };
      }
    } else {
      // Price should retrace down into the bullish FVG
      if (data[i].low <= fvg.high - (fvg.high - fvg.low) * CONFIG.entryFvgTolerance) {
        return {
          price: mid,
          detail: `ราคาย้อนเข้า FVG ที่ ${mid.toFixed(2)} — พร้อม Buy`,
        };
      }
    }
  }

  return null;
}

// ============================================================
// Chart Drawings
// ============================================================
function clearChartDrawings() {
  chartMarkers = [];
  candleSeries.setMarkers([]);
  fvgBoxes.forEach(box => {
    try { candleSeries.removePriceLine(box); } catch (e) { }
  });
  fvgBoxes = [];
}

function drawAnalysisOnChart(result) {
  const markers = [];
  const conds = result.conditions;

  // Mark liquidity sweep
  if (conds.liquiditySweep.passed && conds.liquiditySweep.index != null) {
    const idx = conds.liquiditySweep.index;
    if (idx < candles.length) {
      markers.push({
        time: candles[idx].time,
        position: result.direction === 'sell' ? 'aboveBar' : 'belowBar',
        color: '#f59e0b',
        shape: result.direction === 'sell' ? 'arrowDown' : 'arrowUp',
        text: 'Sweep',
      });
    }
  }

  // Mark MSS
  if (conds.mss.passed && conds.mss.index != null) {
    const idx = conds.mss.index;
    if (idx < candles.length) {
      markers.push({
        time: candles[idx].time,
        position: result.direction === 'sell' ? 'belowBar' : 'aboveBar',
        color: '#3b82f6',
        shape: 'circle',
        text: 'MSS',
      });
    }
  }

  // Mark FVG
  if (conds.fvg.passed && conds.fvg.index != null) {
    const idx = conds.fvg.index;
    if (idx < candles.length) {
      markers.push({
        time: candles[idx].time,
        position: 'inBar',
        color: '#8b5cf6',
        shape: 'square',
        text: 'FVG',
      });

      // Draw FVG levels as price lines
      const fvgHighLine = candleSeries.createPriceLine({
        price: conds.fvg.high,
        color: 'rgba(139, 92, 246, 0.5)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'FVG High',
      });
      fvgBoxes.push(fvgHighLine);

      const fvgLowLine = candleSeries.createPriceLine({
        price: conds.fvg.low,
        color: 'rgba(139, 92, 246, 0.5)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'FVG Low',
      });
      fvgBoxes.push(fvgLowLine);
    }
  }

  // Draw SL/TP lines
  if (result.sl) {
    const slLine = candleSeries.createPriceLine({
      price: result.sl,
      color: '#ef4444',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true,
      title: 'SL',
    });
    fvgBoxes.push(slLine);
  }

  if (result.tp2) {
    const tp2Line = candleSeries.createPriceLine({
      price: result.tp2,
      color: '#10b981',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true,
      title: 'TP 1:2',
    });
    fvgBoxes.push(tp2Line);
  }

  if (result.tp3) {
    const tp3Line = candleSeries.createPriceLine({
      price: result.tp3,
      color: '#059669',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'TP 1:3',
    });
    fvgBoxes.push(tp3Line);
  }

  if (result.entryPrice) {
    const entryLine = candleSeries.createPriceLine({
      price: result.entryPrice,
      color: '#8b5cf6',
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dotted,
      axisLabelVisible: true,
      title: 'Entry',
    });
    fvgBoxes.push(entryLine);
  }

  // Sort markers by time and set
  markers.sort((a, b) => a.time - b.time);
  candleSeries.setMarkers(markers);
}

// ============================================================
// UI Updates
// ============================================================
function updateConditionsUI(result) {
  const conditions = [
    { id: 'cond-1', data: result.conditions.liquiditySweep },
    { id: 'cond-2', data: result.conditions.mss },
    { id: 'cond-3', data: result.conditions.fvg },
    { id: 'cond-4', data: result.conditions.entry },
  ];

  conditions.forEach(({ id, data }) => {
    const el = document.getElementById(id);
    el.classList.remove('pending', 'passed', 'failed');
    el.classList.add(data.passed ? 'passed' : 'pending');

    const statusEl = el.querySelector('.condition-status');
    statusEl.textContent = data.passed ? '✓' : statusEl.textContent.replace('✓', '');

    if (data.detail) {
      el.querySelector('.condition-desc').textContent = data.detail;
    }
  });

  // Progress bar
  const pct = (result.passedCount / 4) * 100;
  document.getElementById('progress-fill').style.width = `${pct}%`;
  document.getElementById('progress-count').textContent = result.passedCount;

  // Direction badge
  const badge = document.getElementById('direction-badge');
  badge.className = 'direction-badge';
  if (result.direction === 'buy') {
    badge.classList.add('buy');
    badge.textContent = '🟢 BUY';
  } else if (result.direction === 'sell') {
    badge.classList.add('sell');
    badge.textContent = '🔴 SELL';
  } else {
    badge.classList.add('none');
    badge.textContent = 'รอสัญญาณ';
  }

  // Alert card
  const alertCard = document.getElementById('alert-card');
  const alertContent = document.getElementById('alert-content');

  if (result.passedCount === 4) {
    alertCard.classList.add('active');
    alertContent.innerHTML = `
      <div class="alert-icon">🎯</div>
      <div class="alert-title">🚨 ครบทุกเงื่อนไข! พร้อมเปิดออเดอร์</div>
      <div class="alert-subtitle">
        ${result.direction === 'buy' ? '🟢 แนะนำ BUY' : '🔴 แนะนำ SELL'} US100<br>
        Entry: ${result.entryPrice?.toFixed(2) || '—'} | SL: ${result.sl?.toFixed(2) || '—'} | TP: ${result.tp2?.toFixed(2) || '—'}
      </div>
    `;

    // Trigger notification
    triggerAlert(result);

  } else if (result.passedCount >= 2) {
    alertCard.classList.remove('active');
    alertContent.innerHTML = `
      <div class="alert-icon">⏳</div>
      <div class="alert-title">กำลังเข้าใกล้...</div>
      <div class="alert-subtitle">ผ่านแล้ว ${result.passedCount}/4 เงื่อนไข — รอเงื่อนไขที่เหลือ</div>
    `;
  } else {
    alertCard.classList.remove('active');
    alertContent.innerHTML = `
      <div class="alert-icon">⏳</div>
      <div class="alert-title">รอเงื่อนไขครบ</div>
      <div class="alert-subtitle">ระบบกำลังตรวจสอบเงื่อนไข ICT ทั้ง 4 ข้อ</div>
    `;
  }

  // SL/TP display
  updateSLTPDisplay(result);
}

function updateSLTPDisplay(result) {
  const slVal = document.getElementById('sl-value');
  const tpVal = document.getElementById('tp-value');
  const tp3Val = document.getElementById('tp3-value');
  const entryVal = document.getElementById('entry-value');
  const slPips = document.getElementById('sl-pips');
  const tpPips = document.getElementById('tp-pips');
  const tp3Pips = document.getElementById('tp3-pips');
  const entryPips = document.getElementById('entry-pips');

  if (result.sl) {
    slVal.textContent = result.sl.toFixed(2);
    const slDist = Math.abs(result.entryPrice - result.sl).toFixed(1);
    slPips.textContent = `${slDist} จุด`;
  } else {
    slVal.textContent = '—';
    slPips.textContent = '';
  }

  if (result.tp2) {
    tpVal.textContent = result.tp2.toFixed(2);
    const tpDist = Math.abs(result.entryPrice - result.tp2).toFixed(1);
    tpPips.textContent = `${tpDist} จุด`;
  } else {
    tpVal.textContent = '—';
    tpPips.textContent = '';
  }

  if (result.tp3) {
    tp3Val.textContent = result.tp3.toFixed(2);
    const tp3Dist = Math.abs(result.entryPrice - result.tp3).toFixed(1);
    tp3Pips.textContent = `${tp3Dist} จุด`;
  } else {
    tp3Val.textContent = '—';
    tp3Pips.textContent = '';
  }

  if (result.entryPrice) {
    entryVal.textContent = result.entryPrice.toFixed(2);
    entryPips.textContent = result.direction === 'buy' ? 'Buy Entry' : 'Sell Entry';
  } else {
    entryVal.textContent = '—';
    entryPips.textContent = '';
  }
}

// ============================================================
// Alert System
// ============================================================
let lastAlertTime = 0;

function triggerAlert(result) {
  const now = Date.now();
  if (now - lastAlertTime < 60000) return; // Throttle: 1 alert per minute
  lastAlertTime = now;

  const direction = result.direction === 'buy' ? 'BUY 🟢' : 'SELL 🔴';

  // Toast notification
  showToast(
    'success',
    `🎯 สัญญาณ ${direction} US100! Entry: ${result.entryPrice?.toFixed(2)} | SL: ${result.sl?.toFixed(2)} | TP: ${result.tp2?.toFixed(2)}`
  );

  // Sound
  if (soundEnabled) {
    playAlertSound();
  }

  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('ICT Trading Checker — US100', {
      body: `สัญญาณ ${direction}! Entry: ${result.entryPrice?.toFixed(2)} | SL: ${result.sl?.toFixed(2)} | TP: ${result.tp2?.toFixed(2)}`,
      icon: '🎯',
    });
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    Notification.requestPermission();
  }

  addLog('success', `🎯 สัญญาณ ${direction} — ครบทุกเงื่อนไข ICT!`);
}

function playAlertSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5

    notes.forEach((freq, i) => {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, audioContext.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + i * 0.15 + 0.4);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(audioContext.currentTime + i * 0.15);
      osc.stop(audioContext.currentTime + i * 0.15 + 0.4);
    });
  } catch (e) {
    // Audio not supported
  }
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(type, message) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? '✅' : type === 'alert' ? '⚠️' : 'ℹ️';

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-text">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
  `;

  container.appendChild(toast);

  // Auto-remove after 8 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100px)';
    setTimeout(() => toast.remove(), 300);
  }, 8000);
}

// ============================================================
// Activity Log
// ============================================================
function addLog(type, message) {
  const logContainer = document.getElementById('log-entries');

  // Clear empty state
  const emptyState = logContainer.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const now = new Date();
  const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `
    <span class="log-time">${timeStr}</span>
    <span class="log-message">${message}</span>
  `;

  // Insert at top
  logContainer.insertBefore(entry, logContainer.firstChild);

  // Keep only last 50 entries
  while (logContainer.children.length > 50) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

// ============================================================
// Auto-Check Timer
// ============================================================
function startAutoCheck() {
  stopAutoCheck();
  countdown = CONFIG.refreshInterval / 1000;
  updateCountdownDisplay();

  countdownTimer = setInterval(() => {
    countdown--;
    updateCountdownDisplay();

    if (countdown <= 0) {
      countdown = CONFIG.refreshInterval / 1000;
      fetchDataAndAnalyze();
      addLog('info', 'Auto-Check: ตรวจสอบเงื่อนไขอัตโนมัติ');
    }
  }, 1000);
}

function stopAutoCheck() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  document.getElementById('countdown').textContent = '—';
}

function updateCountdownDisplay() {
  document.getElementById('countdown').textContent = `${countdown}s`;
}

// ============================================================
// Request notification permission on load
// ============================================================
if ('Notification' in window && Notification.permission === 'default') {
  // Will request when user interacts
  document.addEventListener('click', () => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, { once: true });
}
