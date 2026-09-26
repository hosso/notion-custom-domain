import { mkdir, writeFile } from 'node:fs/promises';
import process from 'node:process';

const siteUrl = process.env.SITE_URL;
const artifactDir = process.env.MONITOR_ARTIFACT_DIR || 'monitor-artifacts';
const timeoutMs = Number(process.env.MONITOR_TIMEOUT_MS || '20000');

if (!siteUrl) {
  console.error('SITE_URL is required');
  process.exit(1);
}

await mkdir(artifactDir, { recursive: true });

const response = await fetch(siteUrl, {
  headers: {
    'user-agent': 'notion-custom-domain-monitor/1.0',
  },
  redirect: 'follow',
  signal: AbortSignal.timeout(timeoutMs),
});

const html = await response.text();
const headers = [...response.headers.entries()]
  .map(([key, value]) => `${key}: ${value}`)
  .join('\n');

const checks = [
  {
    name: 'returns success status',
    pass: response.ok,
    details: `status=${response.status}`,
  },
  {
    name: 'returns HTML content',
    pass: (response.headers.get('content-type') || '').includes('text/html'),
    details: response.headers.get('content-type') || 'missing content-type',
  },
  {
    name: 'injects location proxy script',
    pass: /window\.ncd\s*=/.test(html),
    details: 'Expected injected location proxy assignment',
  },
  {
    name: 'injects custom style overrides',
    pass: html.includes('.notion-topbar'),
    details: 'Expected injected CSS selector `.notion-topbar`',
  },
];

const failedChecks = checks.filter((check) => !check.pass);
const summary = {
  checkedAt: new Date().toISOString(),
  siteUrl,
  finalUrl: response.url,
  status: response.status,
  ok: response.ok,
  checks,
};

await writeFile(
  `${artifactDir}/summary.json`,
  JSON.stringify(summary, null, 2),
);
await writeFile(`${artifactDir}/response.html`, html);
await writeFile(`${artifactDir}/headers.txt`, headers);

if (failedChecks.length > 0) {
  console.error('Smoke monitor failed');
  for (const check of failedChecks) {
    console.error(`- ${check.name}: ${check.details}`);
  }
  process.exit(1);
}

console.log(`Smoke monitor passed for ${siteUrl}`);
