export class PromptFrameCliError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode = 1,
    public readonly repairHint?: string,
  ) {
    super(message);
  }
}
