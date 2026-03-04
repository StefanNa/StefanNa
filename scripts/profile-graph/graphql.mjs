const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

function assertEnv(value, name) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

export function parseTargetRepo(targetRepo) {
  const [owner, name] = (targetRepo || '').split('/');
  if (!owner || !name) {
    throw new Error('TARGET_REPO must be in format "owner/name"');
  }
  return { owner, name };
}

function isoDate(input) {
  return input.toISOString().slice(0, 10);
}

function startDateFromWindow(daysBack = 364) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysBack);
  return date;
}

function endDateFromNow() {
  const date = new Date();
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

async function requestGraphQL({ token, query, variables }) {
  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'profile-purple-graph-generator',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub GraphQL request failed (${response.status}): ${body}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    const message = payload.errors.map((item) => item.message).join(' | ');
    throw new Error(`GitHub GraphQL error: ${message}`);
  }

  return payload.data;
}

const CALENDAR_QUERY = `
query CalendarAndContribs(
  $username: String!
  $from: DateTime!
  $to: DateTime!
  $after: String
) {
  user(login: $username) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        months {
          name
          year
          firstDay
          totalWeeks
        }
        weeks {
          contributionDays {
            contributionCount
            contributionLevel
            date
            weekday
          }
          firstDay
        }
      }
      commitContributionsByRepository(maxRepositories: 100) {
        repository {
          nameWithOwner
          isPrivate
        }
        contributions(first: 100, after: $after) {
          totalCount
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            occurredAt
            commitCount
          }
        }
      }
    }
  }
}
`;

function buildTargetContributionMap(contribRepoNode, fromDateKey, toDateKey) {
  const map = new Map();
  if (!contribRepoNode?.contributions?.nodes) {
    return map;
  }

  for (const node of contribRepoNode.contributions.nodes) {
    const occurredAt = node?.occurredAt;
    if (!occurredAt) {
      continue;
    }
    const day = occurredAt.slice(0, 10);
    if (day < fromDateKey || day > toDateKey) {
      continue;
    }
    const increment = Number(node.commitCount ?? 1);
    map.set(day, (map.get(day) ?? 0) + increment);
  }

  return map;
}

function normalizeCalendar({ contributionCalendar, targetMap }) {
  const weeks = contributionCalendar.weeks.map((week) => ({
    firstDay: week.firstDay,
    contributionDays: week.contributionDays.map((day) => {
      const targetRepoContributionCount = targetMap.get(day.date) ?? 0;
      return {
        date: day.date,
        weekday: day.weekday,
        totalContributionCount: day.contributionCount,
        targetRepoContributionCount,
        contributionLevel: day.contributionLevel,
      };
    }),
  }));

  const dailyIndex = {};
  let maxGreen = 0;
  let maxPurple = 0;

  for (const week of weeks) {
    for (const day of week.contributionDays) {
      dailyIndex[day.date] = {
        totalContributionCount: day.totalContributionCount,
        targetRepoContributionCount: day.targetRepoContributionCount,
      };

      if (day.targetRepoContributionCount > 0) {
        maxPurple = Math.max(maxPurple, day.targetRepoContributionCount);
      } else {
        maxGreen = Math.max(maxGreen, day.totalContributionCount);
      }
    }
  }

  return {
    totalContributions: contributionCalendar.totalContributions,
    months: contributionCalendar.months,
    weeks,
    dailyIndex,
    maxGreen,
    maxPurple,
  };
}

export async function fetchContributionData({ username, targetRepo, token }) {
  assertEnv(username, 'GITHUB_USERNAME');
  assertEnv(targetRepo, 'TARGET_REPO');
  assertEnv(token, 'GITHUB_TOKEN or GH_PAT');

  const { owner, name } = parseTargetRepo(targetRepo);

  const fromDate = startDateFromWindow(364);
  const toDate = endDateFromNow();
  const fromDateKey = isoDate(fromDate);
  const toDateKey = isoDate(toDate);

  const data = await requestGraphQL({
    token,
    query: CALENDAR_QUERY,
    variables: {
      username,
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      after: null,
    },
  });

  const collection = data?.user?.contributionsCollection;
  if (!collection?.contributionCalendar) {
    throw new Error('Missing contribution calendar in API response.');
  }

  const targetNameWithOwner = `${owner}/${name}`.toLowerCase();
  const targetRepoNode = (collection.commitContributionsByRepository || []).find((entry) => {
    const repoName = entry?.repository?.nameWithOwner?.toLowerCase();
    return repoName === targetNameWithOwner;
  });

  const targetMap = buildTargetContributionMap(targetRepoNode, fromDateKey, toDateKey);
  const normalized = normalizeCalendar({
    contributionCalendar: collection.contributionCalendar,
    targetMap,
  });

  normalized.meta = {
    username,
    targetRepo,
    from: fromDateKey,
    to: toDateKey,
    generatedAt: new Date().toISOString(),
    isTargetRepoVisibleInContributionData: Boolean(targetRepoNode),
  };

  return normalized;
}
