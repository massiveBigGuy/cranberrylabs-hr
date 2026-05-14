/**
 * Smoke test for the Workday adapter — runs entirely in-process, no queue,
 * no DB. Useful for verifying the adapter works against a live tenant
 * before wiring it into a scrape run.
 *
 *   tsx src/scripts/smoke-workday.ts <tenant_url> [company]
 *
 *   tsx src/scripts/smoke-workday.ts \
 *     https://generalmotors.wd5.myworkdayjobs.com/Careers_GM \
 *     "General Motors"
 *
 * Output: probe result, then first page of listings, then detail for the
 * first listing. If any step fails, the error is logged and the script
 * exits non-zero.
 */
import { loadConfig } from '../config';
import { createWorkdayAdapter } from '../modules/scraper/adapters/workday';

async function main() {
  const tenantUrl = process.argv[2];
  const company = process.argv[3] ?? 'Smoke Test Co';
  if (!tenantUrl) {
    console.error('usage: smoke-workday.ts <tenant_url> [company]');
    process.exit(1);
  }

  const config = loadConfig();
  const adapter = createWorkdayAdapter(config);

  const source = {
    id: 0,
    company_name: company,
    platform: 'workday',
    tenant_url: tenantUrl,
    search_params: null,
  };

  console.log('\n=== probe ===');
  const probe = await adapter.probe(source);
  console.log({
    status: probe.status,
    total: probe.total,
    facet_count: probe.facets.length,
    sample_facets: probe.facets.slice(0, 5).map((f) => `${f.parameter}/${f.descriptor} (${f.count})`),
    message: probe.message,
  });

  if (probe.status !== 'ok') {
    console.error('probe failed — stopping');
    process.exit(2);
  }

  console.log('\n=== listing scrape (first page) ===');
  // For smoke testing, we only want page 1; pass a small request_delay so it
  // returns fast. Real scrapes use config.scraper.request_delay_ms.
  let pagesSeen = 0;
  const result = await adapter.scrapeListings(source, {}, (p) => {
    pagesSeen = p.page;
    if (p.page === 1) {
      console.log(`page 1: ${p.jobs_seen} jobs seen so far (of ${p.pages_total} pages total)`);
    }
  });
  console.log(`first 5 of ${result.jobs.length} jobs:`);
  for (const j of result.jobs.slice(0, 5)) {
    console.log(`  - [${j.external_id}] ${j.title} (${j.location ?? 'no location'}) ${j.remote_type ?? ''}`);
  }

  if (result.jobs.length === 0) {
    console.error('no jobs returned — stopping before detail fetch');
    process.exit(3);
  }

  console.log('\n=== detail fetch (first job) ===');
  const first = result.jobs[0]!;
  const detail = await adapter.fetchDetail(source, first.url);
  console.log({
    job: first.title,
    description_length: detail.description.length,
    description_preview: detail.description.slice(0, 200) + (detail.description.length > 200 ? '…' : ''),
    description_hash: detail.description_hash.slice(0, 16),
    hiring_manager: detail.hiring_manager,
  });

  console.log('\n=== done ===');
}

main().catch((err) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
