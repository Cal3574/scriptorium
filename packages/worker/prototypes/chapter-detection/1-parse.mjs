// THROWAWAY - step 1: parse the real book PDF via LlamaParse, cache the result.
import { PDF_PATH, LLAMA_KEY, llamaSubmit, llamaPoll, llamaResult, readCache, writeCache } from './lib.mjs';

if (!LLAMA_KEY) throw new Error('LLAMA_CLOUD_API_KEY missing (see .env.example)');

if (readCache('parse.json')) {
  console.log('parse.json already cached - delete .cache/ to re-parse. Nothing to do.');
  process.exit(0);
}

console.log('submitting', PDF_PATH);
const submit = await llamaSubmit(PDF_PATH);
console.log('submit response:', JSON.stringify(submit).slice(0, 400));
const jobId = submit.id ?? submit.job_id ?? submit.job?.id;
if (!jobId) throw new Error(`no job id in ${JSON.stringify(submit)}`);
console.log('job', jobId, '- polling...');

const job = await llamaPoll(jobId);
console.log('done. fetching result...');
const result = await llamaResult(jobId);

writeCache('job.json', job);
writeCache('parse.json', result);
console.log('cached .cache/parse.json  keys:', Object.keys(result));
