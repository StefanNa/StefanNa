import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { fetchContributionData } from './graphql.mjs';
import { renderContributionSvg } from './renderSvg.mjs';

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function resolveToken() {
  return process.env.GH_PAT || process.env.GITHUB_TOKEN || '';
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function main() {
  const username = process.env.GITHUB_USERNAME;
  const targetRepo = process.env.TARGET_REPO;
  const targetRepoLabel = process.env.TARGET_REPO_LABEL || targetRepo?.split('/').at(-1) || 'target repo';
  const anyRepoLabel = process.env.ANY_REPO_LABEL || 'Other repos';
  const token = resolveToken();

  const rootDir = process.cwd();
  const outputPath = path.join(rootDir, 'assets', 'github-contribution-purple.svg');

  try {
    const data = await fetchContributionData({
      username,
      targetRepo,
      token,
    });

    const svg = renderContributionSvg(data, {
      targetRepoLabel,
      anyRepoLabel,
    });
    await ensureDir(outputPath);

    const oldSvg = await readIfExists(outputPath);
    if (oldSvg === svg) {
      console.log('No SVG changes detected.');
      return;
    }

    await fs.writeFile(outputPath, svg, 'utf8');
    console.log(`Wrote ${outputPath}`);
    console.log(`Window: ${data.meta.from} -> ${data.meta.to}`);

    if (!data.meta.isTargetRepoVisibleInContributionData) {
      console.warn('Target repo was not visible in contribution data for this window.');
    }

    console.log(`Legend labels: green="${anyRepoLabel}", purple="${targetRepoLabel}"`);
  } catch (error) {
    console.error('Failed to generate contribution SVG.');
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}

main();
