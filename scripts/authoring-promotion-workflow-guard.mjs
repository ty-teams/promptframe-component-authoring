import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertPromotionModeAllowed,
  readAuthoringPromotionReceipt,
  validateReceiptAgainstRepository,
} from './authoring-promotion-receipt.mjs';

export async function validateAuthoringPromotionWorkflowContext(input) {
  if (input.eventName !== 'workflow_dispatch') throw new Error('promotion_workflow.event_not_trusted');
  if (input.ref !== 'refs/heads/main') throw new Error('promotion_workflow.ref_not_main');
  if (input.repository !== 'ty-teams/promptframe-component-authoring') {
    throw new Error('promotion_workflow.repository_not_trusted');
  }
  if (!/^[a-f0-9]{40}$/.test(String(input.githubSha ?? ''))) {
    throw new Error('promotion_workflow.sha_invalid');
  }
  if (input.githubSha !== input.checkoutSha) throw new Error('promotion_workflow.checkout_sha_mismatch');

  const receipt = await readAuthoringPromotionReceipt(undefined, {
    root: input.root,
    now: input.now,
  });
  assertPromotionModeAllowed(receipt, input.mode);
  await validateReceiptAgainstRepository(receipt, {
    root: input.root,
    sourceCommitVerifier: input.sourceCommitVerifier,
  });
  return {
    schemaVersion: 'promptframe-authoring-promotion-workflow-guard/v1',
    status: 'trusted',
    mode: input.mode,
    checkoutSha: input.checkoutSha,
    operationId: receipt.operationId,
    receiptDigest: receipt.receiptDigest,
    releaseId: receipt.releaseId,
    sanitized: true,
  };
}

async function runCli() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const result = await validateAuthoringPromotionWorkflowContext({
    root,
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY,
    githubSha: process.env.GITHUB_SHA,
    checkoutSha,
    mode: process.env.PROMPTFRAME_AUTHORING_PROMOTION_MODE,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runCli();
  } catch (error) {
    const code = error instanceof Error && /^[a-z0-9_.-]{3,160}$/i.test(error.message)
      ? error.message
      : 'promotion_workflow.guard_failed';
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'promptframe-authoring-promotion-workflow-guard/v1',
      status: 'blocked',
      failure: { code },
      sanitized: true,
    })}\n`);
    process.exitCode = 1;
  }
}
