/**
 * ICT Trading Checker — US100
 * ระบบตรวจสอบเงื่อนไข ICT Trading จากคลิป "ปลาทูดูกราฟ"
 * 
 * เงื่อนไข 4 ข้อ:
 * 1. Liquidity Sweep — ราคา Sweep High/Low ก่อนหน้า
 * 2. Market Structure Shift (MSS) — Break of Structure หลัง Sweep
 * 3. Fair Value Gap (FVG) — ช่องว่างราคา 3 แท่งเทียน
 * 4. Entry at FVG — ราคาย้อนกลับเข้า FVG (ข้ามได้ถ้าเปิดโหมด "3 เงื่อนไขพอ")
 */

// ============================================================
// Configuration
// ============================================================
const CONFIG = {
  symbol: 'NQ=F', // Nasdaq 100 Futures (Yahoo Finance)
  tvSymbol: 'OANDA:NAS100USD', // TradingView symbol
  refreshInterval: 30000, // 30 seconds
  lookbackCandles: 100,
  swingLookback: 5,
  fvgMinGapPercent: 0.02,
  entryFvgTolerance: 0.3,
};

// Timeframe mapping for Yahoo Finance
const TIMEFRAME_MAP = {
  '1': { interval: '1m', range: '1d' },
  '5': { interval: '5m', range: '5d' },
  '15': { interval: '15m', range: '5d' },
  '60': { interval: '60m', range: '10d' },
  '240': { interval: '60m', range: '30d' },
  'D': { interval: '1d', range: '6mo' },
};

// TradingView timeframe mapping
const TV_INTERVAL_MAP = {
  '1': '1',
  '5': '5',
  '15': '15',
  '60': '60',
  '240': '240',
  'D': 'D',
};

// ============================================================
// Global State
// ============================================================
let tvWidget = null;
let currentTimeframe = '5';
let candles = [];
let autoCheckEnabled = true;
let countdownTimer = null;
let countdown = 30;
let soundEnabled = true;
let earlyEntryMode = false;
let analysisResult = null;

// ============================================================
// Initialization
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initTradingViewWidget();
  initControls();
  fetchDataAndAnalyze();
  startAutoCheck();
  addLog('info', 'ระบบ ICT Trading Checker เริ่มทำงาน');
  addLog('info', 'อ้างอิงแผนจาก: ปลาทูดูกราฟ — ระบบเทรด ICT');
});

// ============================================================
// TradingView Widget Setup
// ============================================================
function initTradingViewWidget() {
  createWidget(TV_INTERVAL_MAP[currentTimeframe]);
}

function createWidget(interval) {
  // Clear old widget
  const container = document.getElementById('tradingview-widget');
  container.innerHTML = '';

  tvWidget = new TradingView.widget({
    container_id: 'tradingview-widget',
    symbol: CONFIG.tvSymbol,
    interval: interval,
    timezone: 'Asia/Bangkok',
    theme: 'dark',
    style: '1', // Candlestick
    locale: 'th_TH',
    toolbar_bg: '#0a0e17',
    enable_publishing: false,
    hide_top_toolbar: false,
    hide_legend: false,
    save_image: false,
    allow_symbol_change: true,
    withdateranges: true,
    details: false,
    hotlist: false,
    calendar: false,
    studies: [],
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(10, 14, 23, 1)',
    gridColor: 'rgba(255, 255, 255, 0.03)',
    overrides: {
      'paneProperties.background': '#0a0e17',
      'paneProperties.backgroundType': 'solid',
      'mainSeriesProperties.candleStyle.upColor': '#10b981',
      'mainSeriesProperties.candleStyle.downColor': '#ef4444',
      'mainSeriesProperties.candleStyle.borderUpColor': '#10b981',
      'mainSeriesProperties.candleStyle.borderDownColor': '#ef4444',
      'mainSeriesProperties.candleStyle.wickUpColor': '#10b981',
      'mainSeriesProperties.candleStyle.wickDownColor': '#ef4444',
    },
  });
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

      // Update TradingView widget
      createWidget(TV_INTERVAL_MAP[currentTimeframe]);

      // Re-run ICT analysis
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

  // Early entry toggle (3 เงื่อนไขพอ)
  document.getElementById('early-entry-toggle').addEventListener('change', (e) => {
    earlyEntryMode = e.target.checked;
    if (earlyEntryMode) {
      addLog('warning', 'เปิดโหมด "3 เงื่อนไขพอ" — แจ้งเตือนเมื่อครบ 3/4 เงื่อนไข');
      showToast('alert', '⚡ เปิดโหมด 3 เงื่อนไขพอ — จะแจ้งเตือนเมื่อผ่าน 3/4 เงื่อนไข');
    } else {
      addLog('info', 'ปิดโหมด "3 เงื่อนไขพอ" — แจ้งเตือนเมื่อครบ 4/4 เงื่อนไข');
    }
    // Re-evaluate with current analysis
    if (analysisResult) {
      updateConditionsUI(analysisResult);
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
// Data Fetching (Yahoo Finance via Vercel API or CORS Proxy)
// ============================================================
async function fetchDataAndAnalyze() {
  try {
    const tf = TIMEFRAME_MAP[currentTimeframe];

    // Try Vercel serverless API first, then fall back to CORS proxy
    let data = null;
    try {
      const apiUrl = `/api/yahoo?symbol=${CONFIG.symbol}&interval=${tf.interval}&range=${tf.range}`;
      const response = await fetch(apiUrl);
      if (response.ok) {
        data = await response.json();
      }
    } catch (e) {
      // Vercel API not available (local dev)
    }

    if (!data) {
      // Fallback: CORS proxy
      const corsUrl = `https://corsproxy.io/?https://query1.finance.yahoo.com/v8/finance/chart/${CONFIG.symbol}?interval=${tf.interval}&range=${tf.range}&includePrePost=true`;
      const response = await fetch(corsUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    }

    const result = data.chart.result[0];
    if (!result || !result.timestamp) {
      throw new Error('ไม่พบข้อมูล');
    }

    candles = parseYahooData(result);
    if (candles.length === 0) {
      throw new Error('ไม่มีข้อมูลแท่งเทียน');
    }

    // Update price display
    updatePriceDisplay(candles);

    // Run ICT analysis
    analysisResult = analyzeICT(candles);

    // Update UI with results
    updateConditionsUI(analysisResult);

    addLog('success', `โหลดข้อมูลสำเร็จ — ${candles.length} แท่งเทียน (${tf.interval})`);

  } catch (error) {
    console.error('Fetch error:', error);
    addLog('error', `โหลดข้อมูลวิเคราะห์ล้มเหลว: ${error.message}`);

    // Fallback: demo data for analysis only
    if (candles.length === 0) {
      generateDemoData();
    }
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
// Demo Data Fallback (Analysis Only — chart is TradingView)
// ============================================================
function generateDemoData() {
  addLog('warning', 'ใช้ข้อมูลตัวอย่างสำหรับวิเคราะห์ — กราฟ TradingView ยัง real-time');
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

  updatePriceDisplay(candles);
  analysisResult = analyzeICT(candles);
  updateConditionsUI(analysisResult);
}

// ============================================================
// ICT Analysis Engine
// ============================================================
function analyzeICT(data) {
  const result = {
    direction: null,
    conditions: {
      liquiditySweep: { passed: false, detail: '', level: null, index: null },
      mss: { passed: false, detail: '', level: null, index: null },
      fvg: { passed: false, detail: '', high: null, low: null, index: null },
      entry: { passed: false, detail: '', price: null },
    },
    sl: null,
    tp2: null,
    tp3: null,
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
  const recentCount = 30;
  const startIdx = Math.max(0, data.length - recentCount);

  // Check for sweep of recent swing high (bearish setup)
  for (let i = swings.highs.length - 1; i >= 0; i--) {
    const swingH = swings.highs[i];
    if (swingH.index < startIdx) continue;

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
    let recentLow = Infinity;
    for (let i = Math.max(0, startIdx - 10); i <= startIdx; i++) {
      if (data[i].low < recentLow) {
        recentLow = data[i].low;
      }
    }

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
    let recentHigh = -Infinity;
    for (let i = Math.max(0, startIdx - 10); i <= startIdx; i++) {
      if (data[i].high > recentHigh) {
        recentHigh = data[i].high;
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
  const searchStart = Math.max(0, mss.index - 15);
  const searchEnd = Math.min(data.length - 1, mss.index + 5);

  const fvgs = [];

  for (let i = searchStart + 1; i < searchEnd - 1 && i < data.length - 1; i++) {
    if (direction === 'sell') {
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

  if (fvgs.length > 0) {
    fvgs.sort((a, b) => Math.abs(b.index - mss.index) - Math.abs(a.index - mss.index));
    return fvgs[0];
  }

  // Relaxed search
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
  for (let i = fvg.index + 2; i < data.length; i++) {
    const mid = (fvg.high + fvg.low) / 2;

    if (direction === 'sell') {
      if (data[i].high >= fvg.low + (fvg.high - fvg.low) * CONFIG.entryFvgTolerance) {
        return {
          price: mid,
          detail: `ราคาย้อนเข้า FVG ที่ ${mid.toFixed(2)} — พร้อม Sell`,
        };
      }
    } else {
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

  // Determine required condition count
  const requiredCount = earlyEntryMode ? 3 : 4;

  // Alert card
  const alertCard = document.getElementById('alert-card');
  const alertContent = document.getElementById('alert-content');

  if (result.passedCount >= requiredCount && result.direction) {
    alertCard.classList.add('active');

    const modeLabel = earlyEntryMode && result.passedCount === 3
      ? ' <span class="early-badge">⚡ 3 เงื่อนไขพอ</span>'
      : '';

    alertContent.innerHTML = `
      <div class="alert-icon">🎯</div>
      <div class="alert-title">🚨 ครบเงื่อนไข! พร้อมเปิดออเดอร์ ${modeLabel}</div>
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
      <div class="alert-subtitle">ผ่านแล้ว ${result.passedCount}/${requiredCount} เงื่อนไข — รอเงื่อนไขที่เหลือ</div>
    `;
  } else {
    alertCard.classList.remove('active');
    alertContent.innerHTML = `
      <div class="alert-icon">⏳</div>
      <div class="alert-title">รอเงื่อนไขครบ</div>
      <div class="alert-subtitle">ระบบกำลังตรวจสอบเงื่อนไข ICT (ต้องการ ${requiredCount}/4 ข้อ)</div>
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
  if (now - lastAlertTime < 60000) return;
  lastAlertTime = now;

  const direction = result.direction === 'buy' ? 'BUY 🟢' : 'SELL 🔴';
  const modeText = earlyEntryMode && result.passedCount === 3 ? ' (3 เงื่อนไขพอ)' : '';

  showToast(
    'success',
    `🎯 สัญญาณ ${direction} US100!${modeText} Entry: ${result.entryPrice?.toFixed(2)} | SL: ${result.sl?.toFixed(2)} | TP: ${result.tp2?.toFixed(2)}`
  );

  if (soundEnabled) {
    playAlertSound();
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('ICT Trading Checker — US100', {
      body: `สัญญาณ ${direction}!${modeText} Entry: ${result.entryPrice?.toFixed(2)} | SL: ${result.sl?.toFixed(2)} | TP: ${result.tp2?.toFixed(2)}`,
      icon: '🎯',
    });
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    Notification.requestPermission();
  }

  addLog('success', `🎯 สัญญาณ ${direction}${modeText} — ครบเงื่อนไข ICT!`);
}

function playAlertSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99];

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

  logContainer.insertBefore(entry, logContainer.firstChild);

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
  document.addEventListener('click', () => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, { once: true });
}
