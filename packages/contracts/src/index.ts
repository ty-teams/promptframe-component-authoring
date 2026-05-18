import { z } from 'zod';

export const PROMPTFRAME_CONTRACTS_VERSION = 'promptframe-contracts.v0.1.0' as const;
export const COMPONENT_MANIFEST_SCHEMA_VERSION = 'component-manifest.v0.1.0' as const;
export const COMPONENT_STANDARD_VERSION = 'component-standard.v0.1.0' as const;
export const COMPONENT_REF_VERSION = 'component-ref.v0.1.0' as const;
export const LAYOUT_CAPABILITY_VERSION = 'layout-capability.v0.1.0' as const;
export const CAPABILITY_CARD_VERSION = 'component-capability-card.v0.1.0' as const;

export const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const nonEmptyStringSchema = z.string().trim().min(1);
export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
export const componentIdSchema = z.string().regex(/^@[a-z0-9][a-z0-9-]{1,62}\/[a-z0-9][a-z0-9-]{1,62}$/);
export const componentNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);
export const relativePathSchema = z.string().regex(/^[^/\\][\w./-]*$/);

export const promptFrameComponentTypeSchema = z.enum([
  'scene_template',
  'contained_widget',
  'overlay',
  'transition_effect',
]);
export type PromptFrameComponentType = z.infer<typeof promptFrameComponentTypeSchema>;

export const promptFrameManifestLayerSchema = z.enum([
  'foundation',
  'atom',
  'motion',
  'element',
  'scene_template',
]);
export type PromptFrameManifestLayer = z.infer<typeof promptFrameManifestLayerSchema>;

export const promptFrameManifestCategorySchema = z.enum([
  'background',
  'text',
  'media',
  'shape',
  'card',
  'layout',
  'motion',
  'effect',
  'scene_template',
]);
export type PromptFrameManifestCategory = z.infer<typeof promptFrameManifestCategorySchema>;

export const componentVisibilitySchema = z.enum([
  'builtin',
  'private',
  'project_private',
  'team',
  'public',
]);
export type ComponentVisibility = z.infer<typeof componentVisibilitySchema>;

export const componentRefSchema = z.object({
  contractVersion: z.literal(COMPONENT_REF_VERSION).default(COMPONENT_REF_VERSION),
  componentId: componentIdSchema,
  version: semverSchema,
  visibility: componentVisibilitySchema,
  sourceHash: sha256Schema,
  schemaHash: sha256Schema,
  bundleHash: sha256Schema.optional(),
});
export type ComponentRef = z.infer<typeof componentRefSchema>;

export const componentDiagnosticSchema = z.object({
  code: nonEmptyStringSchema.max(160),
  severity: z.enum(['info', 'warning', 'error']),
  message: nonEmptyStringSchema.max(2000),
  stage: z.enum([
    'authoring',
    'doctor',
    'validate',
    'package',
    'upload',
    'build',
    'manifest',
    'schema',
    'policy',
    'preview',
    'probe',
    'publish',
  ]),
  repairHint: z.string().trim().max(2000).optional(),
});
export type ComponentDiagnostic = z.infer<typeof componentDiagnosticSchema>;

export const publicPolicyRuleIdSchema = z.enum([
  'manifest.identity.version',
  'manifest.component_type.supported',
  'schema.props.explicit',
  'runtime.deterministic.remotion',
  'runtime.no_global_scripts',
  'security.forbidden.browser_apis',
  'security.no_raw_remote_url_import',
  'layout.root_fills_parent',
  'layout.no_fixed_root_canvas',
  'package.no_parent_imports',
  'package.no_path_traversal',
  'evidence.schema_source_hash_present',
]);
export type PublicPolicyRuleId = z.infer<typeof publicPolicyRuleIdSchema>;

export const layoutAdaptivitySchema = z.enum(['responsive', 'scales_down', 'reflows', 'clips', 'fixed']);
export type LayoutAdaptivity = z.infer<typeof layoutAdaptivitySchema>;

export const slotRecommendationSchema = z.enum([
  'full_screen',
  'half_screen',
  'card',
  'badge',
  'text_line',
  'transition_slot',
]);
export type SlotRecommendation = z.infer<typeof slotRecommendationSchema>;

export const layoutCapabilitySchema = z.object({
  contractVersion: z.literal(LAYOUT_CAPABILITY_VERSION).default(LAYOUT_CAPABILITY_VERSION),
  recommendedSlot: slotRecommendationSchema,
  minReadableSize: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  supportedAspectRatios: z.array(z.enum(['16:9', '9:16', '1:1', '4:5', 'auto'])).min(1).max(8),
  layoutAdaptivity: layoutAdaptivitySchema,
  overflowPolicy: z.enum(['fit', 'scroll_forbidden', 'clip_with_warning', 'unknown']).default('unknown'),
  safeAreaPolicy: z.enum(['required', 'recommended', 'none']).default('recommended'),
  confidence: z.number().min(0).max(1).default(0),
  lastVerifiedAt: z.string().datetime().optional(),
  diagnostics: z.array(componentDiagnosticSchema).default([]),
});
export type LayoutCapability = z.infer<typeof layoutCapabilitySchema>;

export const componentManifestAuthorSchema = z.object({
  id: nonEmptyStringSchema.max(128),
  name: nonEmptyStringSchema.max(128),
});

export const componentManifestEntrySchema = z.object({
  sourcePath: relativePathSchema,
  componentExport: nonEmptyStringSchema.max(128).default('default'),
  propsSchemaPath: relativePathSchema,
  sourceHash: sha256Schema,
  schemaHash: sha256Schema,
  bundleHash: sha256Schema.optional(),
});

export const componentManifestSchema = z
  .object({
    schemaVersion: z.literal(COMPONENT_MANIFEST_SCHEMA_VERSION),
    standardVersion: z.literal(COMPONENT_STANDARD_VERSION),
    standardSourceHash: sha256Schema.optional(),
    id: componentIdSchema,
    name: componentNameSchema,
    displayName: nonEmptyStringSchema.max(80),
    version: semverSchema,
    componentType: promptFrameComponentTypeSchema.optional(),
    layer: promptFrameManifestLayerSchema.optional(),
    category: promptFrameManifestCategorySchema.optional(),
    trustLevel: z.enum(['trusted_builtin', 'trusted_private', 'trusted_marketplace', 'untrusted_temporary']).optional(),
    author: componentManifestAuthorSchema,
    description: z.string().trim().min(8).max(600),
    tags: z.array(nonEmptyStringSchema.max(40)).min(1).max(16),
    designedDurationRange: z.object({
      min: z.number().int().positive(),
      max: z.number().int().positive(),
    }).refine((value) => value.max >= value.min, 'duration max must be greater than or equal to min'),
    layout: layoutCapabilitySchema.partial().optional(),
    entry: componentManifestEntrySchema,
    dependencies: z.record(z.string()).default({}),
    peerDependencies: z.record(z.string()).default({}),
    assets: z.record(z.unknown()).default({}),
    capabilityHints: z.array(nonEmptyStringSchema.max(80)).max(24).default([]),
    reviewStatus: z.enum(['draft', 'pending_review', 'approved', 'rejected', 'archived']).optional(),
    license: nonEmptyStringSchema.max(80),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (!manifest.componentType && !manifest.layer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['componentType'],
        message: 'componentType or platform layer is required',
      });
    }
    if (manifest.layer && !manifest.category) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['category'],
        message: 'category is required when layer is present',
      });
    }
  });
export type ComponentManifest = z.infer<typeof componentManifestSchema>;

export const componentCapabilityCardSchema = z.object({
  contractVersion: z.literal(CAPABILITY_CARD_VERSION).default(CAPABILITY_CARD_VERSION),
  componentRef: componentRefSchema,
  componentType: promptFrameComponentTypeSchema,
  displayName: nonEmptyStringSchema.max(80),
  summary: nonEmptyStringSchema.max(500),
  layoutCapability: layoutCapabilitySchema,
  policyRuleIds: z.array(publicPolicyRuleIdSchema).default([]),
  diagnostics: z.array(componentDiagnosticSchema).default([]),
});
export type ComponentCapabilityCard = z.infer<typeof componentCapabilityCardSchema>;

export function parseComponentManifest(input: unknown): ComponentManifest {
  return componentManifestSchema.parse(input);
}

export function parseComponentRef(input: unknown): ComponentRef {
  return componentRefSchema.parse(input);
}
