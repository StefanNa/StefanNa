import { createCanvas } from '@napi-rs/canvas';
import GIFEncoder from 'gif-encoder-2';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { fetchContributionData } from './graphql.mjs';

// Theme + layout constants (mirror renderSvg.mjs)
const THEME = {
  background: '#0d1117',
  empty: '#161b22',
  greenRamp: ['#0e4429', '#006d32', '#26a641', '#39d353'],
  purpleRamp: ['#5b1178', '#7b1fa2', '#a21caf', '#d946ef'],
};

const CELL_SIZE = 10;
const CELL_GAP = 3;
const GRID_LEFT = 40;
const GRID_TOP = 44;
const WEEKDAY_LABEL_WIDTH = 28;
const RIGHT_PADDING = 22;
const BOTTOM_PADDING = 46;

// Wave config
const WAVE_WIDTH = 5;   // columns on each side that glow
const WAVE_BOOST = 0.4; // max brightening factor (0–1)
const FRAME_DELAY = 60; // ms per frame

function clampRampIndex(count, maxCount, rampLength) {
  if (count <= 0 || maxCount <= 0) return -1;
  const normalized = count / maxCount;
  const index = Math.ceil(normalized * rampLength) - 1;
  return Math.max(0, Math.min(rampLength - 1, index));
}

function dayColor(day, maxGreen, maxPurple) {
  if (day.totalContributionCount <= 0) return THEME.empty;
  if (day.targetRepoContributionCount > 0) {
    const idx = clampRampIndex(day.targetRepoContributionCount, maxPurple || 1, THEME.purpleRamp.length);
    return THEME.purpleRamp[idx];
  }
  const idx = clampRampIndex(day.totalContributionCount, maxGreen || 1, THEME.greenRamp.length);
  return THEME.greenRamp[idx];
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function brightenHex(hex, intensity) {
  if (intensity <= 0) return hex;
  const [r, g, b] = hexToRgb(hex);
  const f = intensity * WAVE_BOOST;
  const nr = Math.min(255, Math.round(r + (255 - r) * f));
  const ng = Math.min(255, Math.round(g + (255 - g) * f));
  const nb = Math.min(255, Math.round(b + (255 - b) * f));
  return `rgb(${nr},${ng},${nb})`;
}

function waveIntensity(col, waveCol) {
  return Math.max(0, 1 - Math.abs(col - waveCol) / WAVE_WIDTH);
}

function renderFrame(ctx, data, waveCol, width, height) {
  const { weeks, maxGreen, maxPurple } = data;

  // Background
  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, width, height);

  // Cells
  for (let col = 0; col < weeks.length; col++) {
    const week = weeks[col];
    const intensity = waveIntensity(col, waveCol);
    for (let row = 0; row < week.contributionDays.length; row++) {
      const day = week.contributionDays[row];
      const x = GRID_LEFT + WEEKDAY_LABEL_WIDTH + col * (CELL_SIZE + CELL_GAP);
      const y = GRID_TOP + row * (CELL_SIZE + CELL_GAP);
      const baseColor = dayColor(day, maxGreen, maxPurple);
      ctx.fillStyle = intensity > 0 ? brightenHex(baseColor, intensity) : baseColor;
      ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
    }
  }
}

async function main() {
  const username = process.env.GITHUB_USERNAME;
  const targetRepo = process.env.TARGET_REPO;
  const token = process.env.GH_PAT || process.env.GITHUB_TOKEN || '';

  console.log('Fetching contribution data…');
  const data = await fetchContributionData({ username, targetRepo, token });

  const weeks = data.weeks || [];
  const weekCount = weeks.length;
  const gridWidth = weekCount * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const gridHeight = 7 * (CELL_SIZE + CELL_GAP) - CELL_GAP;
  const width = GRID_LEFT + WEEKDAY_LABEL_WIDTH + gridWidth + RIGHT_PADDING;
  const height = GRID_TOP + gridHeight + BOTTOM_PADDING;

  console.log(`Encoding ${weekCount} frames at ${width}×${height}…`);

  const encoder = new GIFEncoder(width, height);
  encoder.start();
  encoder.setRepeat(0);       // loop forever
  encoder.setDelay(FRAME_DELAY);
  encoder.setQuality(10);

  for (let waveCol = 0; waveCol < weekCount; waveCol++) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    renderFrame(ctx, data, waveCol, width, height);
    encoder.addFrame(ctx);
  }

  encoder.finish();
  const buffer = encoder.out.getData();

  const outputPath = path.join(process.cwd(), 'assets', 'github-contribution-purple.gif');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);
  console.log(`Wrote ${outputPath}`);
}

main().catch((err) => {
  console.error('Failed to generate GIF:', err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
