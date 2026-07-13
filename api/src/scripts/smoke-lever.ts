/**
 * Smoke test for the Lever adapter — runs entirely in-process, no queue,
 * no DB. Useful for verifying the adapter works against a live company
 * slug before wiring it into a scrape run.
 *
 *   tsx src/scripts/smoke-lever.ts <company_slug> [company] [eu]
 *
 *   tsx src/scripts/smoke-lever.ts netflix "Netflix"
 *   tsx src/scripts/smoke-lever.ts some-eu-tenant "EU Co" eu
 *
 * Output: probe result, then the listing (Lever is one-phase — full
 * description is already present, unlike Workday/Greenhouse). If any
 * step fails, the error is logged and the script exits non-zero.
 */
import { loadConfig } from '../config';
import { createLeverAdapter } from '../modules/scraper/adapters/lever';

async function main() {
  const slug = process.argv[2];
  const company = process.argv[3] ?? 'Smoke Test Co';
  const eu = process.argv[4] === 'eu';
  if (!slug) {
    console.error('usage: smoke-lever.ts <company_slug> [company] [eu]');
    process.exit(1);
  }

  const config = loadConfig();
  const adapter = createLeverAdapter(config);

  const source = {
    id: 0,
    company_name: company,
    platform: 'lever',
    tenant_url: slug,
    search_params: eu ? JSON.stringify({ region: 'eu' }) : null,
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
