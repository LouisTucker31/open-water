// BUILD-12-JS-FIX: if you see this comment on GitHub, this JS file is current
(() => {
  const LAT = 50.706;
  const LON = -1.908;
  const LONDON_TZ = 'Europe/London';
  const FORECAST_DAYS = 7; // Weather API supports up to 16 days, Marine up to 8; 7 is the shared window.
  const ROW_HEIGHT_PX = 44;
  const VISIBLE_ROWS = 3;
  const PAD_ROWS = Math.floor(VISIBLE_ROWS / 2);

  const state = {
    weather: null,
    marine: null,
    extremes: [],
    times: [],
    selectedIndex: 0
  };

  const els = {
    dateHeading: document.getElementById('dateHeading'),
    verdictBadge: document.getElementById('verdictBadge'),
    verdictLabel: document.getElementById('verdictLabel'),
    lastUpdated: document.getElementById('lastUpdated'),
    refreshBtn: document.getElementById('refreshBtn'),
    loadingBanner: document.getElementById('loadingBanner'),
    errorBanner: document.getElementById('errorBanner'),
    errorText: document.getElementById('errorText'),
    retryBtn: document.getElementById('retryBtn'),
    timeWheel: document.getElementById('timeWheel'),
    water: document.getElementById('water'),
    waterComfort: document.getElementById('waterComfort'),
    waves: document.getElementById('waves'),
    chop: document.getElementById('chop'),
    wind: document.getElementById('wind'),
    gust: document.getElementById('gust'),
    air: document.getElementById('air'),
    weather: document.getElementById('weather'),
    chopDot: document.getElementById('chopDot'),
    chopText: document.getElementById('chopText'),
    tideDot: document.getElementById('tideDot'),
    currentText: document.getElementById('currentText'),
    visDot: document.getElementById('visDot'),
    sightingText: document.getElementById('sightingText'),
    tempDot: document.getElementById('tempDot'),
    temperatureText: document.getElementById('temperatureText'),
    tideNextHigh: document.getElementById('tideNextHigh'),
    tideNextLow: document.getElementById('tideNextLow'),
    tideState: document.getElementById('tideState'),
    wavePeriod: document.getElementById('wavePeriod'),
    rainChance: document.getElementById('rainChance'),
    visibilityText: document.getElementById('visibilityText'),
    windDirText: document.getElementById('windDirText'),
    verdictText: document.getElementById('verdictText')
  };

  const WEATHER_TEXT = {
    0:'Clear sky', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast',
    45:'Fog', 48:'Freezing fog',
    51:'Light drizzle', 53:'Drizzle', 55:'Dense drizzle',
    56:'Light freezing drizzle', 57:'Freezing drizzle',
    61:'Light rain', 63:'Rain', 65:'Heavy rain',
    66:'Light freezing rain', 67:'Freezing rain',
    71:'Light snow', 73:'Snow', 75:'Heavy snow', 77:'Snow grains',
    80:'Light showers', 81:'Showers', 82:'Heavy showers',
    85:'Light snow showers', 86:'Snow showers',
    95:'Thunderstorm', 96:'Thunderstorm with hail', 99:'Severe thunderstorm'
  };

  function degToCompass(deg){
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  function formatHeaderDate(dateStr){
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', timeZone:'UTC' });
  }

  function formatShortDate(dateStr){
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', timeZone:'UTC' });
  }

  function addDaysToIsoDate(dateStr, days){
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }

  function formatTimeLabel(isoTime){
    return isoTime.slice(11, 16);
  }

  function safeFixed(value, digits){
    return (value === null || value === undefined || Number.isNaN(value)) ? null : Number(value).toFixed(digits);
  }

  // Open-Meteo returns local wall-clock times when a timezone is requested,
  // so "now" needs computing in that same zone rather than the device's own,
  // or the wheel's starting point could be off by the UTC/local offset.
  function getLondonNowHourIso(){
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: LONDON_TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hour12:false
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    const hour = map.hour === '24' ? '00' : map.hour;
    return `${map.year}-${map.month}-${map.day}T${hour}:00`;
  }

  function weatherUrl(){
    const params = new URLSearchParams({
      latitude: LAT,
      longitude: LON,
      hourly: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability,visibility',
      timezone: LONDON_TZ,
      forecast_days: String(FORECAST_DAYS),
      wind_speed_unit: 'mph'
    });
    return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  }

  function marineUrl(){
    const params = new URLSearchParams({
      latitude: LAT,
      longitude: LON,
      hourly: 'wave_height,wave_period,sea_surface_temperature,sea_level_height_msl',
      timezone: LONDON_TZ,
      forecast_days: String(FORECAST_DAYS)
    });
    return `https://marine-api.open-meteo.com/v1/marine?${params.toString()}`;
  }

  // Smooths the hourly sea level series with a simple moving average so
  // small model wobbles do not get mistaken for genuine tide turning points.
  function smoothSeries(values, windowSize){
    const half = Math.floor(windowSize / 2);
    return values.map((_, i) => {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++){
        if (values[j] !== null && values[j] !== undefined){
          sum += values[j];
          count += 1;
        }
      }
      return count ? sum / count : null;
    });
  }

  // Approximates high/low tide events from Open-Meteo's modelled sea level
  // curve. A real semi-diurnal tide only has around two highs and two lows
  // a day roughly six hours apart, so turning points are found on a
  // smoothed curve and any candidates closer together than MIN_GAP_HOURS
  // are collapsed to the more extreme one, to avoid noise being read as
  // extra tide events.
  function findTideExtremes(times, heights){
    const MIN_GAP_HOURS = 3;
    const smoothed = smoothSeries(heights, 3);
    const candidates = [];

    for (let i = 1; i < smoothed.length - 1; i++){
      const prev = smoothed[i - 1];
      const cur = smoothed[i];
      const next = smoothed[i + 1];
      if (cur === null || prev === null || next === null) continue;
      if (cur > prev && cur > next) candidates.push({ type:'high', index:i, time: times[i], height: heights[i] });
      else if (cur < prev && cur < next) candidates.push({ type:'low', index:i, time: times[i], height: heights[i] });
    }

    const kept = [];
    for (const candidate of candidates){
      const last = kept[kept.length - 1];
      if (last && (candidate.index - last.index) < MIN_GAP_HOURS){
        if (candidate.type === last.type){
          const keepCandidate = candidate.type === 'high'
            ? candidate.height > last.height
            : candidate.height < last.height;
          if (keepCandidate) kept[kept.length - 1] = candidate;
        }
        // Opposite type too close together is treated as noise around the
        // same turning point, so the later candidate is skipped.
        continue;
      }
      kept.push(candidate);
    }

    return kept;
  }

  function tideNarrative(extremes, selectedIso){
    const selectedDate = new Date(selectedIso);
    const sorted = extremes
      .map(e => ({ ...e, dateObj: new Date(e.time) }))
      .sort((a, b) => a.dateObj - b.dateObj);

    let prior = null;
    for (const e of sorted){
      if (e.dateObj <= selectedDate) prior = e;
      else break;
    }

    if (!prior){
      return {
        state: 'Not enough data',
        text: 'Not enough of the tide curve is available yet to estimate the current state.',
        level: 'warning'
      };
    }

    const hoursSince = (selectedDate - prior.dateObj) / 3600000;
    const trend = prior.type === 'high' ? 'ebb' : 'flood';
    const stage = hoursSince < 1 ? 'starting' : hoursSince < 2.5 ? 'developing' : 'established';
    const stateLabel = `${trend.charAt(0).toUpperCase()}${trend.slice(1)} ${stage}`;
    const elapsed = hoursSince < 1 ? `${Math.round(hoursSince * 60)} minutes` : `${hoursSince.toFixed(1)} hours`;
    const heightText = safeFixed(prior.height, 1);
    const driftNote = trend === 'ebb' ? 'some lateral drift is possible' : 'a returning flow is likely';
    const text = `About ${elapsed} after ${prior.type} tide${heightText ? ` (${heightText} m at ${formatTimeLabel(prior.time)})` : ''}. The ${trend} is ${stage}, so ${driftNote}.`;
    return { state: stateLabel, text, level: trend === 'ebb' && stage === 'established' ? 'warning' : 'success' };
  }

  function chopDescription(height){
    if (height === null) return { label:'No data', text:'Wave data is not available for this hour.', level:'warning' };
    if (height < 0.2) return { label:'Flat', text:'Flat to almost flat water.', level:'success' };
    if (height < 0.4) return { label:'Light chop', text:`Small ${height.toFixed(1)} m waves. Expect light surface movement rather than flat water.`, level:'success' };
    if (height < 0.7) return { label:'Moderate chop', text:`Moderate ${height.toFixed(1)} m waves. Noticeable chop, manageable for most open-water swimmers.`, level:'warning' };
    if (height < 1.1) return { label:'Choppy', text:`Choppy ${height.toFixed(1)} m waves. Sighting and breathing will take more effort.`, level:'warning' };
    return { label:'Rough', text:`Rough ${height.toFixed(1)} m waves. Conditions suit experienced swimmers only.`, level:'destructive' };
  }

  function waterComfort(temp){
    if (temp === null) return 'No data';
    if (temp >= 18) return 'Comfortable';
    if (temp >= 14) return 'Cool, wetsuit recommended';
    if (temp >= 10) return 'Cold, wetsuit essential';
    return 'Very cold, limit exposure';
  }

  function visibilityCategory(metres){
    if (metres === null) return { label:'No data', level:'warning' };
    if (metres >= 10000) return { label:'Very good', level:'success' };
    if (metres >= 4000) return { label:'Good', level:'success' };
    if (metres >= 1000) return { label:'Moderate', level:'warning' };
    return { label:'Poor', level:'destructive' };
  }

  function computeVerdict({ waveHeight, gustMph, waterTemp, rainChance, weatherCode }){
    const concerns = [];
    if (waveHeight !== null && waveHeight >= 0.8) concerns.push('significant chop');
    if (gustMph !== null && gustMph >= 25) concerns.push('strong gusts');
    if (waterTemp !== null && waterTemp < 12) concerns.push('cold water');
    if (rainChance !== null && rainChance >= 60) concerns.push('a good chance of rain');
    if ([95, 96, 99].includes(weatherCode)) concerns.push('possible thunderstorms, so seek shelter if lightning is near');

    if (concerns.length === 0 && waveHeight !== null && waveHeight < 0.4 && gustMph !== null && gustMph < 15){
      return { label:'Excellent swim window', level:'success', text:'Excellent training conditions. Calm water, light wind and comfortable visibility.' };
    }
    if (concerns.length === 0){
      return { label:'Good swim window', level:'success', text:'Good training conditions overall, with nothing major to work around.' };
    }
    if (concerns.length === 1){
      return { label:'Good, check conditions', level:'warning', text:`Generally good conditions, but keep an eye on ${concerns[0]}.` };
    }
    const last = concerns[concerns.length - 1];
    const rest = concerns.slice(0, -1).join(', ');
    return { label:'Exercise caution', level:'destructive', text:`Conditions need extra care today: ${rest} and ${last}.` };
  }

  function setDot(el, level){
    el.className = `dot ${level}`;
  }

  function setBadgeLevel(level){
    els.verdictBadge.className = `badge${level === 'success' ? '' : ' ' + level}`;
  }

  function render(iso){
    const wIndex = state.weather.hourly.time.indexOf(iso);
    const mIndex = state.marine.hourly.time.indexOf(iso);

    if (wIndex === -1 || mIndex === -1){
      els.verdictText.textContent = 'No forecast data is available for this hour. Try picking a different time.';
      return;
    }

    const airTemp = state.weather.hourly.temperature_2m[wIndex];
    const weatherCode = state.weather.hourly.weather_code[wIndex];
    const windSpeed = state.weather.hourly.wind_speed_10m[wIndex];
    const windDir = state.weather.hourly.wind_direction_10m[wIndex];
    const windGust = state.weather.hourly.wind_gusts_10m[wIndex];
    const rainChance = state.weather.hourly.precipitation_probability[wIndex];
    const visibility = state.weather.hourly.visibility[wIndex];

    const waveHeight = state.marine.hourly.wave_height[mIndex];
    const wavePeriod = state.marine.hourly.wave_period[mIndex];
    const waterTemp = state.marine.hourly.sea_surface_temperature[mIndex];

    els.air.textContent = airTemp === null ? '\u2013' : `${Math.round(airTemp)}\u00b0C`;
    els.weather.textContent = WEATHER_TEXT[weatherCode] || 'Mixed conditions';

    els.water.textContent = waterTemp === null ? '\u2013' : `${Math.round(waterTemp)}\u00b0C`;
    els.waterComfort.textContent = waterComfort(waterTemp);

    els.waves.textContent = waveHeight === null ? '\u2013' : `${waveHeight.toFixed(1)} m`;
    const chop = chopDescription(waveHeight);
    els.chop.textContent = chop.label;
    els.chopText.textContent = chop.text;
    setDot(els.chopDot, chop.level);

    const compass = windDir === null ? '' : degToCompass(windDir);
    els.wind.textContent = windSpeed === null ? '\u2013' : `${compass} ${Math.round(windSpeed)}`;
    els.gust.textContent = windGust === null ? '\u2013' : `gusts ${Math.round(windGust)} mph`;
    els.windDirText.textContent = windDir === null ? '\u2013' : `${compass} \u00b7 ${Math.round(windDir)}\u00b0`;

    els.wavePeriod.textContent = wavePeriod === null ? '\u2013' : `~${wavePeriod.toFixed(1)} sec`;
    els.rainChance.textContent = rainChance === null ? '\u2013' : `${Math.round(rainChance)}%`;

    const visCat = visibilityCategory(visibility);
    els.visibilityText.textContent = visibility === null ? visCat.label : `${visCat.label} (${(visibility / 1000).toFixed(0)} km)`;
    setDot(els.visDot, visCat.level);
    els.sightingText.textContent = visibility === null
      ? 'Visibility data is not available for this hour.'
      : `${visCat.label} visibility. ${rainChance !== null && rainChance >= 50 ? 'A reasonable chance of rain may reduce it further.' : 'Bright, dry conditions may bring glare rather than poor visibility.'}`;

    const tide = tideNarrative(state.extremes, iso);
    els.tideState.textContent = tide.state;
    els.currentText.textContent = tide.text;
    setDot(els.tideDot, tide.level);
    els.tideNextHigh.textContent = formatExtreme(nextExtreme(state.extremes, iso, 'high'));
    els.tideNextLow.textContent = formatExtreme(nextExtreme(state.extremes, iso, 'low'));

    els.temperatureText.textContent = waterTemp === null
      ? 'Sea temperature data is not available for this hour.'
      : `${Math.round(waterTemp)}\u00b0C sea temperature. ${waterComfort(waterTemp)}.`;
    setDot(els.tempDot, waterTemp !== null && waterTemp < 14 ? 'warning' : 'accent');

    const verdict = computeVerdict({ waveHeight, gustMph: windGust, waterTemp, rainChance, weatherCode });
    els.verdictLabel.textContent = verdict.label;
    els.verdictText.textContent = verdict.text;
    setBadgeLevel(verdict.level);
  }

  // Finds the nearest upcoming high or low tide event after the selected
  // time, so the tide card can show what's coming next rather than every
  // event across the whole fetched forecast window.
  function nextExtreme(extremes, selectedIso, type){
    const selectedDate = new Date(selectedIso);
    const upcoming = extremes
      .filter(e => e.type === type && new Date(e.time) > selectedDate)
      .sort((a, b) => new Date(a.time) - new Date(b.time));
    return upcoming[0] || null;
  }

  function formatExtreme(extreme){
    if (!extreme) return '\u2013';
    const heightText = safeFixed(extreme.height, 1);
    return `${formatTimeLabel(extreme.time)}${heightText ? ` \u00b7 ${heightText} m` : ''}`;
  }

  function updateHeading(iso){
    const datePart = iso.slice(0, 10);
    els.dateHeading.textContent = `${formatHeaderDate(datePart)} \u00b7 ${formatTimeLabel(iso)}`;
  }

  // Builds the scrollable rows fresh each time the forecast reloads, since
  // the available hour range shifts as "now" moves forward.
  function buildWheelRows(){
    const container = els.timeWheel;
    container.textContent = '';

    const topPad = document.createElement('div');
    topPad.style.height = `${PAD_ROWS * ROW_HEIGHT_PX}px`;
    topPad.setAttribute('aria-hidden', 'true');
    container.appendChild(topPad);

    const todayIso = getLondonNowHourIso().slice(0, 10);
    const tomorrowIso = addDaysToIsoDate(todayIso, 1);

    state.times.forEach((iso, index) => {
      const datePart = iso.slice(0, 10);
      const dateLabel = datePart === todayIso ? 'Today' : datePart === tomorrowIso ? 'Tomorrow' : formatShortDate(datePart);
      const row = document.createElement('div');
      row.className = 'time-wheel-row';
      row.id = `time-opt-${index}`;
      row.setAttribute('role', 'option');
      row.dataset.index = String(index);
      row.textContent = `${dateLabel} \u00b7 ${formatTimeLabel(iso)}`;
      row.addEventListener('click', () => selectIndex(index, true));
      container.appendChild(row);
    });

    const bottomPad = document.createElement('div');
    bottomPad.style.height = `${PAD_ROWS * ROW_HEIGHT_PX}px`;
    bottomPad.setAttribute('aria-hidden', 'true');
    container.appendChild(bottomPad);
  }

  function updateWheelSelectionUi(){
    const rows = els.timeWheel.querySelectorAll('.time-wheel-row');
    rows.forEach(row => {
      row.setAttribute('aria-selected', Number(row.dataset.index) === state.selectedIndex ? 'true' : 'false');
    });
    const selectedRow = document.getElementById(`time-opt-${state.selectedIndex}`);
    if (selectedRow) els.timeWheel.setAttribute('aria-activedescendant', selectedRow.id);
  }

  function scrollWheelToIndex(index, smooth){
    els.timeWheel.scrollTo({ top: index * ROW_HEIGHT_PX, behavior: smooth ? 'smooth' : 'auto' });
  }

  function renderSelected(){
    const iso = state.times[state.selectedIndex];
    if (!iso) return;
    render(iso);
    updateHeading(iso);
  }

  function selectIndex(index, smoothScroll){
    if (!state.times.length) return;
    const clamped = Math.max(0, Math.min(state.times.length - 1, index));
    state.selectedIndex = clamped;
    updateWheelSelectionUi();
    scrollWheelToIndex(clamped, smoothScroll);
    renderSelected();
  }

  let scrollSettleTimer = null;
  els.timeWheel.addEventListener('scroll', () => {
    if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
    scrollSettleTimer = setTimeout(() => {
      if (!state.times.length) return;
      const nearestIndex = Math.round(els.timeWheel.scrollTop / ROW_HEIGHT_PX);
      if (nearestIndex !== state.selectedIndex) selectIndex(nearestIndex, false);
    }, 120);
  }, { passive: true });

  els.timeWheel.addEventListener('keydown', (event) => {
    if (!state.times.length) return;
    if (event.key === 'ArrowDown'){ event.preventDefault(); selectIndex(state.selectedIndex + 1, true); }
    else if (event.key === 'ArrowUp'){ event.preventDefault(); selectIndex(state.selectedIndex - 1, true); }
    else if (event.key === 'Home'){ event.preventDefault(); selectIndex(0, true); }
    else if (event.key === 'End'){ event.preventDefault(); selectIndex(state.times.length - 1, true); }
  });

  function setLoading(isLoading){
    els.loadingBanner.classList.toggle('visible', isLoading);
    els.refreshBtn.disabled = isLoading;
    els.refreshBtn.classList.toggle('spinning', isLoading);
    els.refreshBtn.setAttribute('aria-label', isLoading ? 'Refreshing forecast' : 'Refresh forecast');
    els.timeWheel.classList.toggle('disabled', isLoading);
    els.timeWheel.setAttribute('aria-disabled', isLoading ? 'true' : 'false');
    els.timeWheel.tabIndex = isLoading ? -1 : 0;
  }

  function showError(message){
    els.errorText.textContent = message;
    els.errorBanner.classList.add('visible');
  }

  function hideError(){
    els.errorBanner.classList.remove('visible');
  }

  // Only hours present in both APIs' responses, from the current hour
  // onward, are offered on the wheel, so every selectable time is
  // guaranteed to have both weather and marine data.
  function buildAvailableTimes(weatherJson, marineJson){
    const marineSet = new Set(marineJson.hourly.time);
    const nowIso = getLondonNowHourIso();
    const fromNow = weatherJson.hourly.time.filter(t => t >= nowIso && marineSet.has(t));
    if (fromNow.length) return fromNow;
    // Fallback for the unlikely case the clock-based filter leaves nothing
    // (e.g. right at the end of the forecast window): fall back to the full
    // overlapping range rather than showing an empty wheel.
    return weatherJson.hourly.time.filter(t => marineSet.has(t));
  }

  async function loadForecast(){
    setLoading(true);
    hideError();
    try {
      const [weatherRes, marineRes] = await Promise.all([
        fetch(weatherUrl()),
        fetch(marineUrl())
      ]);

      if (!weatherRes.ok || !marineRes.ok){
        throw new Error('The forecast service did not respond correctly. Please try again.');
      }

      const weatherJson = await weatherRes.json();
      const marineJson = await marineRes.json();

      if (weatherJson.error || marineJson.error){
        throw new Error(weatherJson.reason || marineJson.reason || 'The forecast service returned an error.');
      }

      state.weather = weatherJson;
      state.marine = marineJson;
      state.extremes = findTideExtremes(marineJson.hourly.time, marineJson.hourly.sea_level_height_msl);
      state.times = buildAvailableTimes(weatherJson, marineJson);

      if (!state.times.length){
        throw new Error('No forecast hours are available right now. Try refreshing shortly.');
      }

      state.selectedIndex = 0;
      buildWheelRows();
      updateWheelSelectionUi();
      scrollWheelToIndex(0, false);

      els.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}`;

      renderSelected();
    } catch (err){
      showError(err.message || 'Could not load the forecast. Check your connection and try again.');
      els.dateHeading.textContent = 'Forecast unavailable';
      els.timeWheel.textContent = '';
      state.times = [];
    } finally {
      setLoading(false);
    }
  }

  els.refreshBtn.addEventListener('click', loadForecast);
  els.retryBtn.addEventListener('click', loadForecast);

  loadForecast();
})();
