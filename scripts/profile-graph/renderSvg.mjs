const DEFAULT_THEME = {
  background: '#0d1117',
  text: '#c9d1d9',
  subtleText: '#8b949e',
  empty: '#161b22',
  greenRamp: ['#0e4429', '#006d32', '#26a641', '#39d353'],
  purpleRamp: ['#5b1178', '#7b1fa2', '#a21caf', '#d946ef'],
};

const CELL_SIZE = 10;
const CELL_GAP = 3;
const GRID_LEFT = 40;
const HEADER_Y = 18;
const MONTH_LABEL_Y = 34;
const GRID_TOP = 44;
const WEEKDAY_LABEL_WIDTH = 28;
const RIGHT_PADDING = 22;
const BOTTOM_PADDING = 46;

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function clampRampIndex(count, maxCount, rampLength) {
  if (count <= 0 || maxCount <= 0) {
    return -1;
  }

  const normalized = count / maxCount;
  const index = Math.ceil(normalized * rampLength) - 1;
  return Math.max(0, Math.min(rampLength - 1, index));
}

function dayColor(day, theme, maxGreen, maxPurple) {
  if (day.totalContributionCount <= 0) {
    return theme.empty;
  }

  if (day.targetRepoContributionCount > 0) {
    const idx = clampRampIndex(day.targetRepoContributionCount, maxPurple || 1, theme.purpleRamp.length);
    return theme.purpleRamp[idx];
  }

  const idx = clampRampIndex(day.totalContributionCount, maxGreen || 1, theme.greenRamp.length);
  return theme.greenRamp[idx];
}

function monthKey(dateString) {
  if (typeof dateString !== 'string' || dateString.length < 7) {
    return '';
  }
  return dateString.slice(0, 7);
}

function buildMonthLabels(months, weeks) {
  const visibleColumnByMonth = new Map();

  for (let col = 0; col < weeks.length; col += 1) {
    const week = weeks[col];
    for (const day of week.contributionDays || []) {
      const key = monthKey(day.date);
      if (key && !visibleColumnByMonth.has(key)) {
        visibleColumnByMonth.set(key, col);
      }
    }
  }

  const labels = [];
  let lastX = Number.NEGATIVE_INFINITY;
  const minGap = CELL_SIZE + CELL_GAP + 2;

  for (const month of months || []) {
    const key = monthKey(month.firstDay);
    const column = visibleColumnByMonth.get(key);
    if (column === undefined) {
      continue;
    }

    const x = GRID_LEFT + WEEKDAY_LABEL_WIDTH + column * (CELL_SIZE + CELL_GAP);
    if (x - lastX < minGap) {
      continue;
    }

    labels.push({
      text: month.name.slice(0, 3),
      x,
    });
    lastX = x;
  }

  return labels;
}

export function renderContributionSvg(data, options = {}) {
  const theme = { ...DEFAULT_THEME, ...(options.theme || {}) };
  const targetRepoLabel = options.targetRepoLabel || 'target repo';
  const anyRepoLabel = options.anyRepoLabel || 'Other repos';
  const weeks = data.weeks || [];
  const weekCount = weeks.length;

  const gridWidth = weekCount * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const gridHeight = 7 * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const svgWidth = GRID_LEFT + WEEKDAY_LABEL_WIDTH + gridWidth + RIGHT_PADDING;
  const svgHeight = GRID_TOP + gridHeight + BOTTOM_PADDING;

  const monthLabels = buildMonthLabels(data.months, weeks);

  const weekdayLabels = [
    { text: 'Mon', row: 1 },
    { text: 'Wed', row: 3 },
    { text: 'Fri', row: 5 },
  ];

  const cells = [];
  for (let col = 0; col < weekCount; col += 1) {
    const week = weeks[col];
    for (let row = 0; row < week.contributionDays.length; row += 1) {
      const day = week.contributionDays[row];
      const x = GRID_LEFT + WEEKDAY_LABEL_WIDTH + col * (CELL_SIZE + CELL_GAP);
      const y = GRID_TOP + row * (CELL_SIZE + CELL_GAP);
      const fill = dayColor(day, theme, data.maxGreen, data.maxPurple);
      const title = `${day.date}: ${day.totalContributionCount} total, ${day.targetRepoContributionCount} target-repo`;

      cells.push(
        `<rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" rx="2" ry="2" fill="${fill}"><title>${escapeXml(title)}</title></rect>`
      );
    }
  }

  const legendRight = GRID_LEFT + WEEKDAY_LABEL_WIDTH + gridWidth;
  const legendX = Math.max(GRID_LEFT + 2, legendRight - 210);
  const legendY = GRID_TOP + gridHeight + 24;

  const greenLegend = theme.greenRamp
    .map((color, i) => `<rect x="${legendX + 58 + i * 13}" y="${legendY - 8}" width="10" height="10" rx="2" fill="${color}" />`)
    .join('');

  const purpleLegend = theme.purpleRamp
    .map((color, i) => `<rect x="${legendX + 158 + i * 13}" y="${legendY - 8}" width="10" height="10" rx="2" fill="${color}" />`)
    .join('');

  const header = `${data.meta?.username || 'user'} · ${data.meta?.targetRepo || 'owner/repo'}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-labelledby="title desc">
  <title id="title">Workout contribution graph</title>
  <desc id="desc">GitHub-style contribution calendar. Green cells are activity in other repositories, purple cells highlight ${escapeXml(targetRepoLabel)}.</desc>
  <rect width="100%" height="100%" fill="${theme.background}" rx="8" />
  <text x="16" y="${HEADER_Y}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif" font-size="11" fill="${theme.text}">${escapeXml(header)}</text>

  ${monthLabels
    .map(
      (label) =>
        `<text x="${label.x}" y="${MONTH_LABEL_Y}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif" font-size="9" fill="${theme.subtleText}">${escapeXml(label.text)}</text>`
    )
    .join('\n  ')}

  ${weekdayLabels
    .map((label) => {
      const y = GRID_TOP + label.row * (CELL_SIZE + CELL_GAP) + 8;
      return `<text x="${GRID_LEFT}" y="${y}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif" font-size="9" fill="${theme.subtleText}">${label.text}</text>`;
    })
    .join('\n  ')}

  ${cells.join('\n  ')}

  <text x="${legendX}" y="${legendY}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif" font-size="9" fill="${theme.subtleText}">${escapeXml(anyRepoLabel)}</text>
  ${greenLegend}
  ${purpleLegend}
  <text x="${legendX + 114}" y="${legendY}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif" font-size="9" fill="${theme.subtleText}">${escapeXml(targetRepoLabel)}</text>
</svg>`;
}
