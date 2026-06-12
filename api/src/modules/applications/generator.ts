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

export interface GenerationOptions {
  versionNo?: number;
  previousOutput?: {
    coverLetter: string;
    tailoredResume: Record<string, unknown>;
  };
  accumulatedFeedback?: string[];
}

export async function generateApplication(
  appId: number,
  job: JobInput,
  resume: MasterResumeRow,
  samples: WritingSampleRow[],
  adapter: LLMAdapter,
  storageRoot: string,
  options: GenerationOptions = {},
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
    previousOutput: options.previousOutput,
    accumulatedFeedback: options.accumulatedFeedback,
  });

  // Versioned path: {appId}/v{n}/ when versionNo supplied, legacy {appId}/ otherwise.
  const subdir = options.versionNo != null
    ? path.join(storageRoot, String(appId), `v${options.versionNo}`)
    : path.join(storageRoot, String(appId));
  fs.mkdirSync(subdir, { recursive: true });

  const coverFilename = 'cover_letter.txt';
  const resumeFilename = 'resume.json';

  fs.writeFileSync(path.join(subdir, coverFilename), result.coverLetter, 'utf8');
  fs.writeFileSync(
    path.join(subdir, resumeFilename),
    JSON.stringify(result.tailoredResume, null, 2),
    'utf8',
  );

  const pathPrefix = options.versionNo != null
    ? `${appId}/v${options.versionNo}`
    : `${appId}`;

  return {
    coverPath: `${pathPrefix}/${coverFilename}`,
    resumePath: `${pathPrefix}/${resumeFilename}`,
    diff: computeDiff(masterResumeObj, result.tailoredResume),
    modelUsed: result.modelUsed,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
