import fs from 'node:fs';
import path from 'node:path';
import type { LLMAdapter } from '../../services/llm';
import type { MasterResumeRow, WritingSampleRow } from '../resume/repo';

interface JobInput {
  id: number;
  title: string;
  company: string;
  description: string;
}

export interface GenerationOutput {
  coverPath: string;   // relative to storage root, e.g. "42/cover_letter.txt"
  resumePath: string;  // relative to storage root, e.g. "42/resume.json"
  diff: string;        // JSON-serialised array of { key, from, to } entries
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
}

function computeDiff(
  original: Record<string, unknown>,
  tailored: Record<string, unknown>,
): string {
  const changes: Array<{ key: string; from: unknown; to: unknown }> = [];
  const allKeys = new Set([...Object.keys(original), ...Object.keys(tailored)]);
  for (const key of allKeys) {
    const from = JSON.stringify(original[key] ?? null);
    const to = JSON.stringify(tailored[key] ?? null);
    if (from !== to) {
      changes.push({ key, from: original[key] ?? null, to: tailored[key] ?? null });
    }
  }
  return JSON.stringify(changes);
}

export async function generateApplication(
  appId: number,
  job: JobInput,
  resume: MasterResumeRow,
  samples: WritingSampleRow[],
  adapter: LLMAdapter,
  storageRoot: string,
): Promise<GenerationOutput> {
  let masterResumeObj: Record<string, unknown>;
  try {
    masterResumeObj = JSON.parse(resume.content);
  } catch {
    throw new Error('Master resume content is not valid JSON');
  }

  const activeSamples = samples.filter((s) => s.active);

  const result = await adapter.generate({
    jobTitle: job.title,
    company: job.company,
    jobDescription: job.description,
    masterResume: masterResumeObj,
    writingSamples: activeSamples.map((s) => ({
      kind: s.kind,
      label: s.label,
      content: s.content,
    })),
  });

  const dir = path.join(storageRoot, String(appId));
  fs.mkdirSync(dir, { recursive: true });

  const coverFilename = 'cover_letter.txt';
  const resumeFilename = 'resume.json';

  fs.writeFileSync(path.join(dir, coverFilename), result.coverLetter, 'utf8');
  fs.writeFileSync(
    path.join(dir, resumeFilename),
    JSON.stringify(result.tailoredResume, null, 2),
    'utf8',
  );

  return {
    coverPath: `${appId}/${coverFilename}`,
    resumePath: `${appId}/${resumeFilename}`,
    diff: computeDiff(masterResumeObj, result.tailoredResume),
    modelUsed: result.modelUsed,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
