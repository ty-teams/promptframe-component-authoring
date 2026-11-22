import { evaluatePromptFrameSchemaSource } from './schema-evaluator.js';
import type { ComponentReusabilityScore } from './index.js';

export const SCHEMA_REUSABILITY_EVIDENCE_VERSION = 'schema-reusability-evidence/v1' as const;

export interface SchemaReusabilityAssessment {
  evidenceVersion: typeof SCHEMA_REUSABILITY_EVIDENCE_VERSION;
  schemaStatus: ReturnType<typeof evaluatePromptFrameSchemaSource>['status'];
  configurableInputs: string[];
  defaultOrOptionalInputs: string[];
  previewInputs: string[];
  score: number;
  recommendation: 'allow' | 'warn';
  signals: ComponentReusabilityScore['signals'];
}

/** Static type-and-bound evidence only; consumers retain full props validation.
 * It does not prove that source code uses an
 * input, that a resource is authorized, or that a component renders correctly.
 * Names, comments and source-reading syntax are intentionally not inputs. */
export function evaluateSchemaReusability(input: {
  schemaSourceText: string;
  previewProps: unknown;
}): SchemaReusabilityAssessment {
  const schema = evaluatePromptFrameSchemaSource(input.schemaSourceText);
  const properties = Object.entries(schema.properties).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const required = new Set(schema.requiredPropKeys);
  const preview = record(input.previewProps) ?? {};
  const configurableInputs: string[] = [];
  const defaultOrOptionalInputs: string[] = [];
  const previewInputs: string[] = [];
  for (const [key, value] of properties) {
    const property = record(value);
    if (!property || !isConfigurable(property)) continue;
    configurableInputs.push(key);
    if (Object.hasOwn(property, 'default') ? compatible(property, property.default) : !required.has(key)) {
      defaultOrOptionalInputs.push(key);
    }
    if (Object.hasOwn(preview, key) && compatible(property, preview[key])) previewInputs.push(key);
  }
  const count = configurableInputs.length;
  const fraction = (value: number) => count ? value / count : 0;
  const boundedNames = (keys: string[]) => keys.slice(0, 6).map(key => key.slice(0, 40)).join(', ') || 'none';
  const signals: ComponentReusabilityScore['signals'] = [
    { id: 'propsRichness', score: count ? 1 : 0, weight: 1 / 3,
      severity: count ? 'info' : 'warning',
      reason: `${SCHEMA_REUSABILITY_EVIDENCE_VERSION}: schema declares ${count} configurable inputs: ${boundedNames(configurableInputs)}. Source usage and rendered behavior are not inferred.` },
    { id: 'emptyStateSupport', score: fraction(defaultOrOptionalInputs.length), weight: 1 / 3,
      severity: defaultOrOptionalInputs.length === count && count ? 'info' : 'warning',
      reason: `${defaultOrOptionalInputs.length}/${count} configurable inputs are optional or have a type-compatible declared default: ${boundedNames(defaultOrOptionalInputs)}.` },
    { id: 'previewCaseCoverage', score: fraction(previewInputs.length), weight: 1 / 3,
      severity: previewInputs.length === count && count ? 'info' : 'warning',
      reason: `Canonical preview contains ${previewInputs.length}/${count} type-compatible configurable inputs: ${boundedNames(previewInputs)}. Availability and authorization require their own checks.` },
  ];
  return {
    evidenceVersion: SCHEMA_REUSABILITY_EVIDENCE_VERSION,
    schemaStatus: schema.status,
    configurableInputs, defaultOrOptionalInputs, previewInputs,
    score: Math.round(signals.reduce((total, signal) => total + signal.score * signal.weight, 0) * 100) / 100,
    // This advisory is independent of the numeric coverage summary and never
    // replaces security admission or an explicit publication review.
    recommendation: schema.status === 'resolved' && count > 0 && previewInputs.length > 0 ? 'allow' : 'warn',
    signals,
  };
}

type Property = Record<string, unknown>;

function record(value: unknown): Property | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Property : undefined;
}

function declaredTypes(schema: Property): string[] {
  if (typeof schema.type === 'string') return [schema.type];
  return Array.isArray(schema.type) ? schema.type.filter((type): type is string => typeof type === 'string') : [];
}

function isConfigurable(schema: Property): boolean {
  if (Object.hasOwn(schema, 'const')) return false;
  if (Array.isArray(schema.enum)) return schema.enum.filter((value, index, values) =>
    !values.slice(0, index).some(previous => sameValue(previous, value))).length > 1;
  const types = declaredTypes(schema).filter(type => type !== 'null');
  if (!types.some(type => ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(type))) return false;
  if (types.length === 1 && ['number', 'integer'].includes(types[0]!)
    && typeof schema.minimum === 'number' && schema.minimum === schema.maximum) return false;
  if (types.length === 1 && types[0] === 'string' && schema.maxLength === 0) return false;
  if (types.length === 1 && types[0] === 'array' && schema.maxItems === 0) return false;
  if (types.length === 1 && types[0] === 'object' && schema.additionalProperties === false
    && !Object.keys(record(schema.properties) ?? {}).length) return false;
  return true;
}

function compatible(schema: Property, value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (Object.hasOwn(schema, 'const') && !sameValue(schema.const, value)) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some(candidate => sameValue(candidate, value))) return false;
  const types = declaredTypes(schema);
  if (value === null) return types.includes('null') || schema.nullable === true;
  const type = Array.isArray(value) ? 'array' : typeof value;
  if (!(types.includes(type) || type === 'number' && types.includes('integer') && Number.isInteger(value))) return false;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return false;
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return false;
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) return false;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
    // Do not execute an untrusted regular expression to manufacture evidence.
    if (schema.pattern !== undefined) return false;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return false;
    const item = record(schema.items);
    if (!item || !value.every(entry => compatible(item, entry, depth + 1))) return false;
  }
  const object = record(value);
  if (object) {
    const properties = record(schema.properties) ?? {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (required.some(key => typeof key !== 'string' || !Object.hasOwn(object, key))) return false;
    for (const [key, entry] of Object.entries(object)) {
      const property = record(properties[key]) ?? record(schema.additionalProperties);
      if (!property) { if (schema.additionalProperties === false) return false; continue; }
      if (!compatible(property, entry, depth + 1)) return false;
    }
  }
  return true;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  const a = record(left), b = record(right);
  return !!a && !!b && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}
