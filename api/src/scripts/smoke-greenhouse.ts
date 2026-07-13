/**
 * Smoke test for the Greenhouse adapter — runs entirely in-process, no
 * queue, no DB. Useful for verifying the adapter works against a live
 * board token before wiring it into a scrape run.
 *
 *   tsx src/scripts/smoke-greenhouse.ts <board_token> [company]
 *
 *   tsx src/scripts/smoke-greenhouse.ts stripe "Stripe"
 *
 * Output: probe result, then the listing, then detail for the first
 * listing (two-phase, like Workday — description is empty until this
 * step). If any step fails, the error is logged and the script exits
 * non-zero.
 */
import { loadConfig } from '../config';
import { createGreenhouseAdapter } from '../modules/scraper/adapters/greenhouse';

async function main() {
  const boardToken = process.argv[2];
  const company = process.argv[3] ?? 'Smoke Test Co';
  if (!boardToken) {
    console.error('usage: smoke-greenhouse.ts <board_token> [company]');
    process.exit(1);
  }

  const config = loadConfig();
  const adapter = createGreenhouseAdapter(config);

  const source = {
    id: 0,
    company_name: company,
    platform: 'greenhouse',
    tenant_url: boardToken,
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
    console.log(`  - [${j.external_id}] ${j.title} (${j.location ?? 'no location'})`);
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
  });

  console.log('\n=== done ===');
}

main().catch((err) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
