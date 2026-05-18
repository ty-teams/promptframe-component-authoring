import { z } from 'zod';

export const PROMPTFRAME_CONTRACTS_VERSION = 'promptframe-contracts.v0.1.0' as const;
export const COMPONENT_MANIFEST_SCHEMA_VERSION = 'component-manifest.v0.1.0' as const;
export const COMPONENT_STANDARD_VERSION = 'component-standard.v0.1.0' as const;
export const COMPONENT_STANDARD_SOURCE_HASH = 'sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52' as const;
export const COMPONENT_REF_VERSION = 'component-ref.v0.1.0' as const;
export const LAYOUT_CAPABILITY_VERSION = 'layout-capability.v0.1.0' as const;
export const CAPABILITY_CARD_VERSION = 'component-capability-card.v0.1.0' as const;
export const COMPONENT_STANDARD_POLICY_VERSION = 'component-standard-policy.v0.1.0' as const;
export const COMPONENT_SECURITY_POLICY_VERSION = 'component-security-policy.v0.1.0' as const;

export const PROMPTFRAME_PUBLIC_STANDARD_POLICY = {
  policyVersion: COMPONENT_STANDARD_POLICY_VERSION,
  sourceVersion: COMPONENT_STANDARD_VERSION,
  sourceHash: COMPONENT_STANDARD_SOURCE_HASH,
  manifestSchemaVersion: COMPONENT_MANIFEST_SCHEMA_VERSION,
  requiredFiles: [
    'manifest.json',
    'package.json',
    'src/Component.tsx',
    'src/schema.ts',
    'src/index.ts',
    'src/preview-props.json',
  ],
  ignoredPackageDirectories: [
    'node_modules',
    'dist',
    '.git',
    '.component-packages',
    '.promptframe',
  ],
  previewLimits: {
    maxDurationFrames: 180,
    maxWidth: 1280,
    maxHeight: 720,
    allowedFps: [30],
  },
  sourceSafetyRules: [
    {
      id: 'component_standard.source.no_math_random',
      stage: 'build',
      severity: 'error',
      pattern: 'Math\\.random\\s*\\(',
      message: 'Math.random() is not allowed in PromptFrame components; use Remotion random(seed).',
      repairHint: 'Derive random-looking values from props, frame, or a stable seed.',
    },
    {
      id: 'component_standard.source.no_date_now',
      stage: 'build',
      severity: 'error',
      pattern: 'Date\\.now\\s*\\(',
      message: 'Date.now() is not allowed because renders must be deterministic.',
      repairHint: 'Use useCurrentFrame(), useVideoConfig(), and props-derived timing.',
    },
    {
      id: 'component_standard.source.no_native_img',
      stage: 'build',
      severity: 'error',
      pattern: '<img\\b',
      message: 'Native <img> is not allowed; use Remotion <Img>.',
      repairHint: 'Import Img from remotion and replace native img tags.',
    },
    {
      id: 'component_standard.source.no_native_video',
      stage: 'build',
      severity: 'error',
      pattern: '<video\\b',
      message: 'Native <video> is not allowed; use Remotion <Video>.',
      repairHint: 'Import Video from remotion and replace native video tags.',
    },
    {
      id: 'component_standard.source.no_css_transition',
      stage: 'build',
      severity: 'error',
      pattern: 'transition\\s*:',
      message: 'CSS transition is not allowed; animation must be frame-driven.',
      repairHint: 'Use interpolate(), spring(), or frame-derived styles.',
    },
    {
      id: 'component_standard.source.no_css_keyframes',
      stage: 'build',
      severity: 'error',
      pattern: '@keyframes',
      message: 'CSS keyframes are not allowed; animation must be frame-driven.',
      repairHint: 'Replace keyframes with Remotion frame-driven animation.',
    },
  ],
} as const;

export const PROMPTFRAME_PUBLIC_SECURITY_POLICY = {
  policyVersion: COMPONENT_SECURITY_POLICY_VERSION,
  forbiddenApis: [
    {
      id: 'code.eval',
      label: 'Dynamic code execution',
      patterns: ['\\beval\\s*\\('],
      action: 'reject',
      category: 'dynamic_code_execution',
      severity: 'high',
      reason: 'Third-party components cannot execute string code.',
      recommendation: 'Remove eval and use deterministic props/frame-driven logic.',
    },
    {
      id: 'code.new_function',
      label: 'new Function dynamic execution',
      patterns: ['\\bnew\\s+Function\\s*\\('],
      action: 'reject',
      category: 'dynamic_code_execution',
      severity: 'high',
      reason: 'Third-party components cannot build and run arbitrary code strings.',
      recommendation: 'Remove new Function.',
    },
    {
      id: 'code.string_timer',
      label: 'String timer execution',
      patterns: ['\\bset(?:Timeout|Interval)\\s*\\(\\s*[\'"`]'],
      action: 'reject',
      category: 'dynamic_code_execution',
      severity: 'high',
      reason: 'String timers are equivalent to dynamic code execution.',
      recommendation: 'Do not pass strings to setTimeout or setInterval.',
    },
    {
      id: 'host.fs_process_env',
      label: 'Host filesystem, process, or env access',
      patterns: ['\\b(node:fs|fs\\/promises|child_process|process\\.env|Bun\\.|Deno\\.)\\b'],
      action: 'reject',
      category: 'filesystem_process_env_access',
      severity: 'critical',
      reason: 'Components must not read host files, spawn processes, or access environment variables.',
      recommendation: 'Use only platform-provided props and trusted artifacts.',
    },
  ],
  mediatedApis: [
    {
      id: 'network.raw_fetch',
      label: 'Raw network access',
      rawApis: ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon'],
      defaultAction: 'manual_review',
      category: 'network_exfiltration',
      severity: 'high',
      reason: 'Marketplace components must not self-network; assets should be injected by the platform.',
      recommendation: 'Remove raw network access or use an audited platform wrapper with an allowlist.',
    },
    {
      id: 'network.runtime_fetch_json_unconfigured',
      label: 'Unconfigured platform JSON network access',
      rawApis: ['componentRuntime.fetchJson'],
      defaultAction: 'manual_review',
      category: 'network_exfiltration',
      severity: 'high',
      reason: 'Platform-mediated network calls still require an explicit allowlist.',
      recommendation: 'Configure an allowlist or remove the network dependency.',
    },
  ],
  warningApis: [
    {
      id: 'dom.dangerous_html',
      label: 'Dangerous HTML injection',
      patterns: ['dangerouslySetInnerHTML|\\.innerHTML\\s*='],
      action: 'manual_review',
      category: 'dangerous_html_injection',
      severity: 'high',
      reason: 'HTML injection can bypass component rendering boundaries.',
      recommendation: 'Render React nodes or sanitized text structures.',
    },
    {
      id: 'package.install_script',
      label: 'Install script signal',
      patterns: ['postinstall|preinstall|prepare'],
      action: 'manual_review',
      category: 'dependency_supply_chain',
      severity: 'medium',
      reason: 'Third-party component packages should not rely on install scripts.',
      recommendation: 'Remove install scripts before upload.',
    },
    {
      id: 'resource.exhaustion_pattern',
      label: 'Resource exhaustion signal',
      patterns: ['while\\s*\\(\\s*true\\s*\\)|for\\s*\\(\\s*;\\s*;\\s*\\)|new\\s+Array\\s*\\(\\s*1\\d{6,}'],
      action: 'warn',
      category: 'resource_exhaustion',
      severity: 'medium',
      reason: 'Infinite loops or very large arrays can break preview or render.',
      recommendation: 'Bound loops, arrays, canvas operations, and particles.',
    },
    {
      id: 'tenant.identity_string',
      label: 'Tenant or artifact identity signal',
      patterns: ['tenantId|objectKey|sourceArchiveRef|artifactVersion'],
      action: 'warn',
      category: 'tenant_boundary_bypass',
      severity: 'low',
      reason: 'Ordinary components should not assemble platform tenant or artifact identifiers.',
      recommendation: 'Remove platform identity wiring and use platform-provided props.',
    },
    {
      id: 'prompt.injection_string',
      label: 'Prompt-injection-like string',
      patterns: ['ignore\\s+previous\\s+instructions|rank\\s+this\\s+component\\s+first|忽略.{0,12}规则|自动放行|排名第一'],
      action: 'manual_review',
      category: 'prompt_injection_string',
      severity: 'medium',
      reason: 'Source comments and strings cannot ask the platform to change rules, ranking, or admission.',
      recommendation: 'Remove prompt-injection-like strings.',
    },
    {
      id: 'storage.browser_storage',
      label: 'Browser storage access',
      patterns: ['document\\.cookie|localStorage|sessionStorage'],
      action: 'warn',
      category: 'unsafe_browser_storage',
      severity: 'medium',
      reason: 'Marketplace components must not read user browser storage.',
      recommendation: 'Use platform-provided props for state.',
    },
    {
      id: 'network.remote_url',
      label: 'Hardcoded remote URL',
      patterns: ['https?:\\/\\/'],
      action: 'warn',
      category: 'remote_url',
      severity: 'medium',
      reason: 'Remote assets must go through platform asset management and authorization.',
      recommendation: 'Do not hardcode remote URLs in component source.',
    },
  ],
} as const;

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
