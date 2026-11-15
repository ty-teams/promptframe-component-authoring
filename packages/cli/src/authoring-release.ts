import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {authoringStandardReleaseSchema, canonicalizePromptFramePolicy} from '@promptframe/contracts';

// This CLI's published offline recommendation. The platform can advertise a
// newer compatible combination without republishing this package/contracts.
const metadata = authoringStandardReleaseSchema.parse(JSON.parse(
  readFileSync(new URL('../authoring-release.json', import.meta.url), 'utf8'),
));
const {releaseDigest, ...material} = metadata;
if ('sha256:' + createHash('sha256').update(canonicalizePromptFramePolicy(material)).digest('hex') !== releaseDigest) {
  throw new Error('authoring_release.metadata_digest_mismatch');
}
export const PROMPTFRAME_AUTHORING_STANDARD_RELEASE = metadata;
