// BUILD-23-LOCAL-SPOTS: if you see this comment on GitHub, this JS file is current
(() => {
  // Used only if geolocation is unavailable/declined, or as the anchor
  // point for finding the nearest known swim spot (see resolveStartingLocation).
  const DEFAULT_LAT = 50.706;
  const DEFAULT_LON = -1.908;
  const DEFAULT_LOCATION_LABEL = 'Bournemouth, England, United Kingdom';
  const SEARCH_COUNTRY_CODE = 'GB'; // Search results are filtered to this ISO country code.
  const LONDON_TZ = 'Europe/London';
  const FORECAST_DAYS = 7; // Weather API supports up to 16 days, Marine up to 8; 7 is the shared window.
  const ITEM_WIDTH_PX = 92; // Must match the .time-item flex-basis in styles.css.

  const state = {
    location: { lat: DEFAULT_LAT, lon: DEFAULT_LON, label: DEFAULT_LOCATION_LABEL },
    weather: null,
    marine: null,
    extremes: [],
    times: [],
    selectedIndex: 0
  };

  const els = {
    dateHeading: document.getElementById('dateHeading'),
    placeDropdown: document.getElementById('placeDropdown'),
    placeSearchInput: document.getElementById('placeSearchInput'),
    placeSearchStatus: document.getElementById('placeSearchStatus'),
    placeResults: document.getElementById('placeResults'),
    verdictCard: document.getElementById('verdictCard'),
    verdictLabel: document.getElementById('verdictLabel'),
    lastUpdated: document.getElementById('lastUpdated'),
    loadingBanner: document.getElementById('loadingBanner'),
    loadingText: document.getElementById('loadingText'),
    errorBanner: document.getElementById('errorBanner'),
    errorText: document.getElementById('errorText'),
    retryBtn: document.getElementById('retryBtn'),
    timeScroller: document.getElementById('timeScroller'),
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

  // Wave and tide heights arrive from the marine API in metres; displayed
  // in feet throughout, per swimmer preference.
  function metersToFeet(meters){
    return (meters === null || meters === undefined || Number.isNaN(meters)) ? null : meters * 3.28084;
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

  function weatherUrl(lat, lon){
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      hourly: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability,visibility',
      timezone: LONDON_TZ,
      forecast_days: String(FORECAST_DAYS),
      wind_speed_unit: 'mph'
    });
    return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  }

  function marineUrl(lat, lon){
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
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
    const heightText = safeFixed(metersToFeet(prior.height), 1);
    const driftNote = trend === 'ebb' ? 'some lateral drift is possible' : 'a returning flow is likely';
    const text = `About ${elapsed} after ${prior.type} tide${heightText ? ` (${heightText} ft at ${formatTimeLabel(prior.time)})` : ''}. The ${trend} is ${stage}, so ${driftNote}.`;
    return { state: stateLabel, text, level: trend === 'ebb' && stage === 'established' ? 'warning' : 'success' };
  }

  function chopDescription(height){
    if (height === null) return { label:'No data', text:'Wave data is not available for this hour.', level:'warning' };
    const heightFeet = metersToFeet(height).toFixed(1);
    if (height < 0.2) return { label:'Flat', text:'Flat to almost flat water.', level:'success' };
    if (height < 0.4) return { label:'Light chop', text:`Small ${heightFeet} ft waves. Expect light surface movement rather than flat water.`, level:'success' };
    if (height < 0.7) return { label:'Moderate chop', text:`Moderate ${heightFeet} ft waves. Noticeable chop, manageable for most open-water swimmers.`, level:'warning' };
    if (height < 1.1) return { label:'Choppy', text:`Choppy ${heightFeet} ft waves. Sighting and breathing will take more effort.`, level:'warning' };
    return { label:'Rough', text:`Rough ${heightFeet} ft waves. Conditions suit experienced swimmers only.`, level:'destructive' };
  }

  // Wetsuit guidance follows Ironman's age-group wetsuit rules (thresholds
  // confirmed September 2026): mandatory below 16°C, legal up to and
  // including 24.5°C, optional without award eligibility up to 28.8°C,
  // banned above that. Professional-athlete and other federations'
  // thresholds differ; see the note in Sources and data notes.
  function wetsuitGuidance(temp){
    if (temp === null) return 'No data';
    if (temp < 16) return 'Wetsuit mandatory';
    if (temp <= 24.5) return 'Wetsuit legal';
    if (temp <= 28.8) return 'Wetsuit optional, no awards';
    return 'Wetsuit banned';
  }

  // Same bands as wetsuitGuidance: cold and hot ends both warrant attention
  // (hypothermia risk vs overheating/no-award zone), the legal range is the
  // straightforwardly comfortable one.
  function wetsuitDotLevel(temp){
    if (temp === null) return 'warning';
    if (temp < 16) return 'warning';
    if (temp <= 24.5) return 'success';
    if (temp <= 28.8) return 'warning';
    return 'destructive';
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

  function setVerdictLevel(level){
    els.verdictCard.className = `verdict-card${level === 'success' ? '' : ' ' + level}`;
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
    els.waterComfort.textContent = wetsuitGuidance(waterTemp);

    els.waves.textContent = waveHeight === null ? '\u2013' : `${metersToFeet(waveHeight).toFixed(1)} ft`;
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
      : `${Math.round(waterTemp)}\u00b0C sea temperature. ${wetsuitGuidance(waterTemp)}.`;
    setDot(els.tempDot, wetsuitDotLevel(waterTemp));

    const verdict = computeVerdict({ waveHeight, gustMph: windGust, waterTemp, rainChance, weatherCode });
    els.verdictLabel.textContent = verdict.label;
    els.verdictText.textContent = verdict.text;
    setVerdictLevel(verdict.level);
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
    const heightText = safeFixed(metersToFeet(extreme.height), 1);
    return `${formatTimeLabel(extreme.time)}${heightText ? ` \u00b7 ${heightText} ft` : ''}`;
  }

  function updateHeading(iso){
    const datePart = iso.slice(0, 10);
    els.dateHeading.textContent = `${formatHeaderDate(datePart)} \u00b7 ${formatTimeLabel(iso)}`;
  }

  function renderSelected(){
    const iso = state.times[state.selectedIndex];
    if (!iso) return;
    render(iso);
    updateHeading(iso);
  }

  // The container's viewport width is responsive (unlike a fixed-height
  // vertical wheel), so the leading/trailing spacers are sized in JS rather
  // than fixed in CSS, letting the first and last hour still reach centre.
  function computeSidePadding(){
    return Math.max(0, (els.timeScroller.clientWidth - ITEM_WIDTH_PX) / 2);
  }

  // Builds the scrollable columns fresh each time the forecast reloads,
  // since the available hour range shifts as "now" moves forward.
  function buildScrollerItems(){
    const container = els.timeScroller;
    container.textContent = '';

    const sidePad = computeSidePadding();
    const leadSpacer = document.createElement('div');
    leadSpacer.className = 'time-scroller-spacer';
    leadSpacer.style.flex = `0 0 ${sidePad}px`;
    leadSpacer.setAttribute('aria-hidden', 'true');
    container.appendChild(leadSpacer);

    const todayIso = getLondonNowHourIso().slice(0, 10);
    const tomorrowIso = addDaysToIsoDate(todayIso, 1);

    state.times.forEach((iso, index) => {
      const datePart = iso.slice(0, 10);
      const dateLabel = datePart === todayIso ? 'Today' : datePart === tomorrowIso ? 'Tomorrow' : formatShortDate(datePart);
      const item = document.createElement('div');
      item.className = 'time-item';
      item.id = `time-opt-${index}`;
      item.setAttribute('role', 'option');
      item.dataset.index = String(index);

      const dateEl = document.createElement('span');
      dateEl.className = 'time-item-date';
      dateEl.textContent = dateLabel;

      const timeEl = document.createElement('span');
      timeEl.className = 'time-item-time';
      timeEl.textContent = formatTimeLabel(iso);

      item.appendChild(dateEl);
      item.appendChild(timeEl);
      item.addEventListener('click', () => selectIndex(index, true));
      container.appendChild(item);
    });

    const trailSpacer = document.createElement('div');
    trailSpacer.className = 'time-scroller-spacer';
    trailSpacer.style.flex = `0 0 ${sidePad}px`;
    trailSpacer.setAttribute('aria-hidden', 'true');
    container.appendChild(trailSpacer);
  }

  function updateScrollerSelectionUi(){
    const items = els.timeScroller.querySelectorAll('.time-item');
    items.forEach(item => {
      item.setAttribute('aria-selected', Number(item.dataset.index) === state.selectedIndex ? 'true' : 'false');
    });
    const selectedItem = document.getElementById(`time-opt-${state.selectedIndex}`);
    if (selectedItem) els.timeScroller.setAttribute('aria-activedescendant', selectedItem.id);
  }

  function scrollToIndex(index, smooth){
    els.timeScroller.scrollTo({ left: index * ITEM_WIDTH_PX, behavior: smooth ? 'smooth' : 'auto' });
  }

  function selectIndex(index, smoothScroll){
    if (!state.times.length) return;
    const clamped = Math.max(0, Math.min(state.times.length - 1, index));
    state.selectedIndex = clamped;
    updateScrollerSelectionUi();
    scrollToIndex(clamped, smoothScroll);
    renderSelected();
  }

  let scrollSettleTimer = null;
  els.timeScroller.addEventListener('scroll', () => {
    if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
    scrollSettleTimer = setTimeout(() => {
      if (!state.times.length) return;
      const nearestIndex = Math.round(els.timeScroller.scrollLeft / ITEM_WIDTH_PX);
      if (nearestIndex !== state.selectedIndex) selectIndex(nearestIndex, false);
    }, 120);
  }, { passive: true });

  els.timeScroller.addEventListener('keydown', (event) => {
    if (!state.times.length) return;
    if (event.key === 'ArrowRight'){ event.preventDefault(); selectIndex(state.selectedIndex + 1, true); }
    else if (event.key === 'ArrowLeft'){ event.preventDefault(); selectIndex(state.selectedIndex - 1, true); }
    else if (event.key === 'Home'){ event.preventDefault(); selectIndex(0, true); }
    else if (event.key === 'End'){ event.preventDefault(); selectIndex(state.times.length - 1, true); }
  });

  // A rotation or the browser toolbar showing/hiding changes the viewport
  // width, so the spacers need recalculating to keep the centre snap point
  // aligned; re-centre on the currently selected hour afterwards.
  window.addEventListener('resize', () => {
    if (!state.times.length) return;
    const sidePad = computeSidePadding();
    els.timeScroller.querySelectorAll('.time-scroller-spacer').forEach(el => {
      el.style.flex = `0 0 ${sidePad}px`;
    });
    scrollToIndex(state.selectedIndex, false);
  });

  function setLoading(isLoading){
    els.loadingBanner.classList.toggle('visible', isLoading);
    els.timeScroller.classList.toggle('disabled', isLoading);
    els.timeScroller.setAttribute('aria-disabled', isLoading ? 'true' : 'false');
    els.timeScroller.tabIndex = isLoading ? -1 : 0;
  }

  function showError(message){
    els.errorText.textContent = message;
    els.errorBanner.classList.add('visible');
  }

  function hideError(){
    els.errorBanner.classList.remove('visible');
  }

  // The search bar itself is the only display of the current location now
  // (no separate coordinates/name line), so this just keeps its value in
  // sync whenever the location changes from any source.
  function updateLocationDisplay(){
    els.placeSearchInput.value = state.location.label.split(',')[0];
  }

  // Straight-line distance in km, used only to sort search results by
  // proximity to whatever location is currently active (the default, or a
  // previously searched place) - not for any forecast calculation.
  function haversineKm(lat1, lon1, lat2, lon2){
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Builds "England, United Kingdom" from a geocoding result, omitting
  // admin1 when it duplicates the place name (e.g. Singapore, Singapore).
  function placeDetail(result){
    const parts = [];
    if (result.admin1 && result.admin1 !== result.name) parts.push(result.admin1);
    if (result.country) parts.push(result.country);
    return parts.join(', ');
  }

  function placeLabel(result){
    const detail = placeDetail(result);
    return detail ? `${result.name}, ${detail}` : result.name;
  }

  // A curated set of swim spots used to seed "nearby" suggestions before
  // the person types anything, and to backstop free-text search for names
  // too local to appear in Open-Meteo's geocoding data (beach sections,
  // piers, parks). Coordinates for the Poole Harbour/Bournemouth entries
  // are estimated from general knowledge of the area, not surveyed - worth
  // checking against a map and adjusting if any look off. Live search below
  // isn't limited to this list; it also queries the full Geocoding API.
  const NEARBY_SUGGESTIONS = [
    { name: 'Sandbanks', admin1: 'England', country: 'United Kingdom', latitude: 50.6885, longitude: -1.9506 },
    { name: 'Branksome Chine', admin1: 'England', country: 'United Kingdom', latitude: 50.7080, longitude: -1.9270 },
    { name: 'Alum Chine', admin1: 'England', country: 'United Kingdom', latitude: 50.7205, longitude: -1.8968 },
    { name: 'Bournemouth', admin1: 'England', country: 'United Kingdom', latitude: 50.7192, longitude: -1.8808 },
    { name: 'Boscombe Pier', admin1: 'England', country: 'United Kingdom', latitude: 50.7188, longitude: -1.8382 },
    { name: 'Southbourne', admin1: 'England', country: 'United Kingdom', latitude: 50.7175, longitude: -1.8080 },
    { name: 'Hamworthy Park', admin1: 'England', country: 'United Kingdom', latitude: 50.7115, longitude: -1.9945 },
    { name: 'Baiter Park', admin1: 'England', country: 'United Kingdom', latitude: 50.7113, longitude: -1.9825 },
    { name: 'Whitecliff', admin1: 'England', country: 'United Kingdom', latitude: 50.7057, longitude: -1.9975 },
    { name: 'Lake Pier', admin1: 'England', country: 'United Kingdom', latitude: 50.7040, longitude: -2.0025 },
    { name: 'Studland Bay', admin1: 'England', country: 'United Kingdom', latitude: 50.6485, longitude: -1.9520 },
    { name: 'Swanage', admin1: 'England', country: 'United Kingdom', latitude: 50.6062, longitude: -1.9593 },
    { name: 'Weymouth', admin1: 'England', country: 'United Kingdom', latitude: 50.6146, longitude: -2.4590 },
    { name: 'Brighton', admin1: 'England', country: 'United Kingdom', latitude: 50.8225, longitude: -0.1372 },
    { name: 'Torquay', admin1: 'England', country: 'United Kingdom', latitude: 50.4619, longitude: -3.5253 },
    { name: 'Newquay', admin1: 'England', country: 'United Kingdom', latitude: 50.4155, longitude: -5.0870 },
    { name: 'St Ives', admin1: 'England', country: 'United Kingdom', latitude: 50.2115, longitude: -5.4809 },
    { name: 'Ilfracombe', admin1: 'England', country: 'United Kingdom', latitude: 51.2100, longitude: -4.1136 },
    { name: 'Whitstable', admin1: 'England', country: 'United Kingdom', latitude: 51.3617, longitude: 1.0281 },
    { name: 'Southend-on-Sea', admin1: 'England', country: 'United Kingdom', latitude: 51.5459, longitude: 0.7077 },
    { name: 'Scarborough', admin1: 'England', country: 'United Kingdom', latitude: 54.2833, longitude: -0.4000 },
    { name: 'Blackpool', admin1: 'England', country: 'United Kingdom', latitude: 53.8175, longitude: -3.0357 },
    { name: 'Tenby', admin1: 'Wales', country: 'United Kingdom', latitude: 51.6725, longitude: -4.7003 },
    { name: 'Aberystwyth', admin1: 'Wales', country: 'United Kingdom', latitude: 52.4140, longitude: -4.0810 },
    { name: 'Portobello', admin1: 'Scotland', country: 'United Kingdom', latitude: 55.9520, longitude: -3.1180 },
    { name: 'St Andrews', admin1: 'Scotland', country: 'United Kingdom', latitude: 56.3398, longitude: -2.7967 },
    { name: 'Portrush', admin1: 'Northern Ireland', country: 'United Kingdom', latitude: 55.2038, longitude: -6.6567 }
  ];

  // Uses the device's approximate position only to pick the closest entry
  // from the curated list above - never as the forecast location itself,
  // since raw GPS position could easily be somewhere inland with no open
  // water at all. Falls back to the default location if geolocation is
  // unsupported, declined, or times out.
  function nearestKnownSpot(lat, lon){
    return NEARBY_SUGGESTIONS.reduce((closest, spot) => {
      const distanceKm = haversineKm(lat, lon, spot.latitude, spot.longitude);
      return (!closest || distanceKm < closest.distanceKm) ? { spot, distanceKm } : closest;
    }, null).spot;
  }

  function resolveStartingLocation(){
    const fallback = { lat: DEFAULT_LAT, lon: DEFAULT_LON, label: DEFAULT_LOCATION_LABEL };
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)){
        resolve(fallback);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const nearest = nearestKnownSpot(position.coords.latitude, position.coords.longitude);
          resolve({ lat: nearest.latitude, lon: nearest.longitude, label: placeLabel(nearest) });
        },
        () => resolve(fallback),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
      );
    });
  }

  let searchResults = [];
  let activeResultIndex = -1;
  let searchRequestId = 0;
  let searchDebounceTimer = null;
  let blurHideTimer = null;

  function updateActiveResultUi(){
    const rows = els.placeResults.querySelectorAll('.place-option');
    rows.forEach(row => {
      row.setAttribute('aria-selected', Number(row.dataset.index) === activeResultIndex ? 'true' : 'false');
    });
    const activeRow = document.getElementById(`place-opt-${activeResultIndex}`);
    if (activeRow){
      els.placeSearchInput.setAttribute('aria-activedescendant', activeRow.id);
      activeRow.scrollIntoView({ block: 'nearest' });
    } else {
      els.placeSearchInput.removeAttribute('aria-activedescendant');
    }
  }

  function showDropdown(){
    if (blurHideTimer){ clearTimeout(blurHideTimer); blurHideTimer = null; }
    els.placeDropdown.hidden = false;
    els.placeSearchInput.setAttribute('aria-expanded', 'true');
  }

  function hideDropdown(){
    els.placeDropdown.hidden = true;
    els.placeSearchInput.setAttribute('aria-expanded', 'false');
  }

  function selectPlace(result){
    state.location = { lat: result.latitude, lon: result.longitude, label: placeLabel(result) };
    updateLocationDisplay();
    hideDropdown();
    els.placeSearchInput.blur();
    loadForecast();
  }

  // headingText labels the list when it's showing (e.g. "Nearby locations"
  // for suggestions); live search results are shown with no heading.
  function renderPlaceResults(results, headingText){
    // Sorted closest-first from whatever location is currently active.
    searchResults = results
      .map(result => ({
        ...result,
        distanceKm: haversineKm(state.location.lat, state.location.lon, result.latitude, result.longitude)
      }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 8);

    activeResultIndex = -1;
    els.placeResults.textContent = '';

    if (!searchResults.length){
      els.placeSearchStatus.textContent = els.placeSearchInput.value.trim().length >= 2 ? 'No matches found.' : '';
      return;
    }

    els.placeSearchStatus.textContent = headingText || '';

    searchResults.forEach((result, index) => {
      const row = document.createElement('div');
      row.className = 'place-option';
      row.id = `place-opt-${index}`;
      row.setAttribute('role', 'option');
      row.dataset.index = String(index);

      const main = document.createElement('div');
      main.className = 'place-option-main';

      const nameEl = document.createElement('span');
      nameEl.className = 'place-option-name';
      nameEl.textContent = result.name;

      const detailEl = document.createElement('span');
      detailEl.className = 'place-option-detail';
      detailEl.textContent = placeDetail(result);

      main.appendChild(nameEl);
      main.appendChild(detailEl);

      const distanceEl = document.createElement('span');
      distanceEl.className = 'place-option-distance';
      distanceEl.textContent = `${Math.round(result.distanceKm)} km`;

      row.appendChild(main);
      row.appendChild(distanceEl);
      row.addEventListener('click', () => selectPlace(result));
      els.placeResults.appendChild(row);
    });
  }

  function showNearbySuggestions(){
    renderPlaceResults(NEARBY_SUGGESTIONS, 'Nearby locations');
  }

  function matchingLocalSpots(query){
    const lower = query.toLowerCase();
    return NEARBY_SUGGESTIONS.filter(spot => spot.name.toLowerCase().includes(lower));
  }

  async function searchPlaces(query){
    const requestId = ++searchRequestId;
    els.placeSearchStatus.textContent = 'Searching\u2026';
    try {
      // Requesting more than the 8 we display leaves enough headroom after
      // filtering down to UK-only results.
      const params = new URLSearchParams({ name: query, count: '20', language: 'en', format: 'json' });
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`);
      if (requestId !== searchRequestId) return; // superseded by a later keystroke
      if (!res.ok) throw new Error('Search request failed');
      const json = await res.json();
      if (requestId !== searchRequestId) return;
      const ukResults = (json.results || []).filter(result => result.country_code === SEARCH_COUNTRY_CODE);
      // Local beach sections, piers and parks (e.g. "Sandbanks", "Branksome
      // Chine") generally aren't in Open-Meteo's place-name data, so the
      // curated list backstops the live search for those; curated entries
      // win over a live result with the same name.
      const localMatches = matchingLocalSpots(query);
      const localNames = new Set(localMatches.map(spot => spot.name.toLowerCase()));
      const combined = [...localMatches, ...ukResults.filter(result => !localNames.has(result.name.toLowerCase()))];
      renderPlaceResults(combined);
    } catch (err){
      if (requestId !== searchRequestId) return;
      els.placeSearchStatus.textContent = 'Could not search right now. Check your connection.';
      renderPlaceResults([]);
    }
  }

  els.placeSearchInput.addEventListener('focus', () => {
    showDropdown();
    if (els.placeSearchInput.value.trim().length < 2) showNearbySuggestions();
  });

  // Delayed so a tap on a result row still gets to register its click
  // before the dropdown disappears out from under it.
  els.placeSearchInput.addEventListener('blur', () => {
    blurHideTimer = setTimeout(hideDropdown, 150);
  });

  els.placeSearchInput.addEventListener('input', () => {
    const query = els.placeSearchInput.value.trim();
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    activeResultIndex = -1;

    if (query.length < 2){
      searchRequestId += 1; // invalidate any in-flight search
      showNearbySuggestions();
      return;
    }

    searchDebounceTimer = setTimeout(() => searchPlaces(query), 300);
  });

  els.placeSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape'){
      event.preventDefault();
      els.placeSearchInput.blur();
      return;
    }
    if (!searchResults.length) return;
    if (event.key === 'ArrowDown'){
      event.preventDefault();
      activeResultIndex = Math.min(activeResultIndex + 1, searchResults.length - 1);
      updateActiveResultUi();
    } else if (event.key === 'ArrowUp'){
      event.preventDefault();
      activeResultIndex = Math.max(activeResultIndex - 1, 0);
      updateActiveResultUi();
    } else if (event.key === 'Enter'){
      event.preventDefault();
      const index = activeResultIndex === -1 ? 0 : activeResultIndex;
      if (searchResults[index]) selectPlace(searchResults[index]);
    }
  });

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
    els.loadingText.textContent = 'Fetching the latest forecast from Open-Meteo\u2026';
    hideError();
    try {
      const { lat, lon } = state.location;
      const [weatherRes, marineRes] = await Promise.all([
        fetch(weatherUrl(lat, lon)),
        fetch(marineUrl(lat, lon))
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
      buildScrollerItems();
      updateScrollerSelectionUi();
      scrollToIndex(0, false);

      els.lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}`;

      renderSelected();
    } catch (err){
      showError(err.message || 'Could not load the forecast. Check your connection and try again.');
      els.dateHeading.textContent = 'Forecast unavailable';
      els.timeScroller.textContent = '';
      state.times = [];
    } finally {
      setLoading(false);
    }
  }

  els.retryBtn.addEventListener('click', loadForecast);

  (async function init(){
    state.location = await resolveStartingLocation();
    updateLocationDisplay();
    loadForecast();
  })();
})();
