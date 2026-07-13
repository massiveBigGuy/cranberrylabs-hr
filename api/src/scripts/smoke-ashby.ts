/**
 * Smoke test for the Ashby adapter — runs entirely in-process, no queue,
 * no DB. Useful for verifying the adapter works against a live company
 * slug before wiring it into a scrape run.
 *
 *   tsx src/scripts/smoke-ashby.ts <company_slug> [company]
 *
 *   tsx src/scripts/smoke-ashby.ts linear "Linear"
 *
 * Output: probe result, then the listing (Ashby is one-phase — full
 * description is already present, unlike Workday/Greenhouse). If any
 * step fails, the error is logged and the script exits non-zero.
 */
import { loadConfig } from '../config';
import { createAshbyAdapter } from '../modules/scraper/adapters/ashby';

async function main() {
  const slug = process.argv[2];
  const company = process.argv[3] ?? 'Smoke Test Co';
  if (!slug) {
    console.error('usage: smoke-ashby.ts <company_slug> [company]');
    process.exit(1);
  }

  const config = loadConfig();
  const adapter = createAshbyAdapter(config);

  const source = {
    id: 0,
    company_name: company,
    platform: 'ashby',
    tenant_url: slug,
    search_params: null,
  };

  console.log('\n=== probe ===');
  const probe = await adapter.probe(source);
  console.log({ status: probe.status, total: probe.total, message: probe.message });

  if (probe.status !== 'ok') {
    console.error('probe failed — stopping');
    process.exit(2);
  }

  console.log('\n=== listing scrape ===');
  const result = await adapter.scrapeListings(source, {});
  console.log(`first 5 of ${result.jobs.length} jobs:`);
  for (const j of result.jobs.slice(0, 5)) {
    console.log(
      `  - [${j.external_id}] ${j.title} (${j.location ?? 'no location'}) ${j.remote_type ?? ''} — description: ${j.description.length} chars`,
    );
  }

  console.log('\n=== done ===');
}

main().catch((err) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
