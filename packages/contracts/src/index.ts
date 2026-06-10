import { z } from 'zod';
import { createPromptFramePublicSecurityPolicyDigest } from './security-policy-fingerprint.js';

export {
  COMPONENT_SECURITY_POLICY_DIGEST_VERSION,
  canonicalizePromptFramePolicy,
  createPromptFramePublicSecurityPolicyDigest,
} from './security-policy-fingerprint.js';

export const PROMPTFRAME_CONTRACTS_VERSION = 'promptframe-contracts.v0.1.0' as const;
export const COMPONENT_MANIFEST_SCHEMA_VERSION = 'component-manifest.v0.1.0' as const;
export const COMPONENT_STANDARD_VERSION = 'component-standard.v0.1.0' as const;
export const COMPONENT_STANDARD_SOURCE_HASH = 'sha256:8c1e01c36155b4b646981064d24df9bd8cda501fd9cd9da93e5b62f40db22d52' as const;
export const COMPONENT_REF_VERSION = 'component-ref.v0.1.0' as const;
export const LAYOUT_CAPABILITY_VERSION = 'layout-capability.v0.1.0' as const;
export const CAPABILITY_CARD_VERSION = 'component-capability-card.v0.1.0' as const;
export const COMPONENT_STANDARD_POLICY_VERSION = 'component-standard-policy.v0.1.0' as const;
export const COMPONENT_SECURITY_POLICY_VERSION = 'component-security-policy.v0.1.0' as const;
export const PROMPTFRAME_STYLE_CONTRACT_VERSION = 'promptframe-style.v0.1.0' as const;
export const AUTHORING_STANDARD_RELEASE_VERSION = 'authoring-standard-release.v0.1.0' as const;
export const COMPONENT_REUSABILITY_CONTRACT_VERSION = 'component-reusability.v0.1.0' as const;
export const COMPONENT_DEPENDENCY_POLICY_VERSION = 'component-dependency-policy.v0.1.0' as const;

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
      astMatchers: {
        globals: ['eval'],
      },
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
      astMatchers: {
        globals: ['Function'],
      },
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
      astMatchers: {
        stringTimer: true,
      },
      action: 'reject',
      category: 'dynamic_code_execution',
      severity: 'high',
      reason: 'String timers are equivalent to dynamic code execution.',
      recommendation: 'Do not pass strings to setTimeout or setInterval.',
    },
    {
      id: 'code.dynamic_import',
      label: 'Dynamic import loading',
      patterns: ['\\bimport\\s*\\('],
      astMatchers: {
        dynamicImport: true,
      },
      action: 'reject',
      category: 'dynamic_code_execution',
      severity: 'high',
      reason: 'Third-party components cannot dynamically load code at preview or render time.',
      recommendation: 'Use static imports that are visible to the authoring build and security checks.',
      docsPath: '/docs/component-authoring/security#code-dynamic-import',
    },
    {
      id: 'host.fs_process_env',
      label: 'Host filesystem, process, or env access',
      patterns: ['\\b(node:fs|fs\\/promises|child_process|process\\.env|Bun\\.|Deno\\.)\\b'],
      astMatchers: {
        globals: ['Bun', 'Deno'],
        memberPaths: ['process.env', 'Bun', 'Deno'],
      },
      action: 'reject',
      category: 'filesystem_process_env_access',
      severity: 'critical',
      reason: 'Components must not read host files, spawn processes, or access environment variables.',
      recommendation: 'Use only platform-provided props and trusted artifacts.',
    },
    {
      id: 'browser.broadcast_channel',
      label: 'BroadcastChannel cross-context messaging',
      patterns: ['\\bnew\\s+BroadcastChannel\\b|\\bBroadcastChannel\\s*\\('],
      astMatchers: {
        globals: ['BroadcastChannel'],
        memberPaths: ['window.BroadcastChannel', 'globalThis.BroadcastChannel'],
      },
      action: 'reject',
      category: 'browser_capability',
      severity: 'high',
      reason: 'Third-party components cannot open cross-tab or cross-context messaging channels.',
      recommendation: 'Remove BroadcastChannel. Use explicit component props or platform-provided data instead.',
      docsPath: '/docs/component-authoring/security#browser-broadcast-channel',
    },
    {
      id: 'browser.webrtc',
      label: 'WebRTC / RTCPeerConnection access',
      patterns: ['\\bnew\\s+RTCPeerConnection\\b|\\bRTCPeerConnection\\s*\\(|navigator\\.mediaDevices\\.getUserMedia\\s*\\('],
      astMatchers: {
        globals: ['RTCPeerConnection'],
        memberPaths: ['navigator.mediaDevices.getUserMedia'],
      },
      action: 'reject',
      category: 'browser_capability',
      severity: 'high',
      reason: 'Third-party components cannot open peer connections or capture local media devices.',
      recommendation: 'Remove WebRTC and media device access. Use platform-provided assets or props.',
      docsPath: '/docs/component-authoring/security#browser-webrtc',
    },
    {
      id: 'browser.notification',
      label: 'Notification permission or display',
      patterns: ['\\bnew\\s+Notification\\b|\\bNotification\\s*\\(|Notification\\.requestPermission\\s*\\('],
      astMatchers: {
        globals: ['Notification'],
        memberPaths: ['Notification.requestPermission', 'window.Notification', 'globalThis.Notification'],
      },
      action: 'reject',
      category: 'browser_capability',
      severity: 'high',
      reason: 'Third-party components cannot request browser notification permissions or show notifications.',
      recommendation: 'Remove Notification usage and express state inside the rendered component.',
      docsPath: '/docs/component-authoring/security#browser-notification',
    },
    {
      id: 'browser.service_worker',
      label: 'Service Worker registration',
      patterns: ['navigator\\.serviceWorker\\b|\\bServiceWorker(?:Registration|Container)?\\b'],
      astMatchers: {
        memberPaths: ['navigator.serviceWorker'],
      },
      action: 'reject',
      category: 'browser_capability',
      severity: 'high',
      reason: 'Third-party components cannot register or control Service Worker lifecycle.',
      recommendation: 'Remove Service Worker usage. Component code must stay inside the platform render boundary.',
      docsPath: '/docs/component-authoring/security#browser-service-worker',
    },
    {
      id: 'browser.clipboard',
      label: 'Clipboard access',
      patterns: ['navigator\\.clipboard\\b|document\\.execCommand\\s*\\(\\s*[\'"`](?:copy|cut|paste)[\'"`]'],
      astMatchers: {
        memberPaths: ['navigator.clipboard', 'document.execCommand'],
      },
      action: 'reject',
      category: 'browser_capability',
      severity: 'high',
      reason: 'Third-party components cannot read from or write to the user clipboard.',
      recommendation: 'Remove clipboard calls and use explicit props or platform actions outside the component.',
      docsPath: '/docs/component-authoring/security#browser-clipboard',
    },
    {
      id: 'browser.navigator_locks',
      label: 'Navigator locks API',
      patterns: ['navigator\\.locks\\b'],
      astMatchers: {
        memberPaths: ['navigator.locks'],
      },
      action: 'reject',
      category: 'browser_capability',
      severity: 'high',
      reason: 'Third-party components cannot acquire browser-level execution locks.',
      recommendation: 'Remove navigator.locks usage and keep component logic frame-driven and deterministic.',
      docsPath: '/docs/component-authoring/security#browser-navigator-locks',
    },
    {
      id: 'browser.audio_context',
      label: 'AudioContext / AudioWorklet access',
      patterns: ['\\bnew\\s+(?:AudioContext|webkitAudioContext)\\b|\\b(?:AudioContext|webkitAudioContext)\\s*\\(|\\bAudioWorklet\\b|\\.audioWorklet\\b'],
      astMatchers: {
        globals: ['AudioContext', 'webkitAudioContext', 'AudioWorklet'],
        memberPaths: ['window.AudioContext', 'window.webkitAudioContext', 'globalThis.AudioContext', 'globalThis.webkitAudioContext'],
      },
      action: 'reject',
      category: 'browser_capability',
      severity: 'high',
      reason: 'Third-party components cannot create browser audio processing contexts or AudioWorklet code.',
      recommendation: 'Use platform-provided audio assets and frame-driven visualizers instead.',
      docsPath: '/docs/component-authoring/security#browser-audio-context',
    },
    {
      id: 'browser.css_register_property',
      label: 'CSS.registerProperty / CSS Houdini access',
      patterns: ['CSS\\.registerProperty\\s*\\('],
      astMatchers: {
        memberPaths: ['CSS.registerProperty'],
      },
      action: 'reject',
      category: 'browser_capability',
      severity: 'high',
      reason: 'Third-party components cannot register global CSS Houdini properties.',
      recommendation: 'Use component-local style props and ordinary frame-driven React styles.',
      docsPath: '/docs/component-authoring/security#browser-css-register-property',
    },
    {
      id: 'browser.observer_abuse',
      label: 'DOM Observer capability',
      patterns: ['\\bnew\\s+(?:MutationObserver|ResizeObserver|IntersectionObserver)\\b|\\b(?:MutationObserver|ResizeObserver|IntersectionObserver)\\s*\\('],
      astMatchers: {
        globals: ['MutationObserver', 'ResizeObserver', 'IntersectionObserver'],
      },
      action: 'reject',
      category: 'browser_capability',
      severity: 'high',
      reason: 'Third-party components cannot observe host DOM or runtime boundaries.',
      recommendation: 'Use explicit props, layout inputs, and deterministic frame data instead of Observer APIs.',
      docsPath: '/docs/component-authoring/security#browser-observer-abuse',
    },
    {
      id: 'remotion.delay_render',
      label: 'Remotion delayRender lifecycle control',
      patterns: ['\\bdelayRender\\s*\\('],
      astMatchers: {
        globals: ['delayRender'],
      },
      action: 'reject',
      category: 'remotion_lifecycle',
      severity: 'high',
      reason: 'Third-party components cannot delay platform preview or render lifecycle from component code.',
      recommendation: 'Resolve assets before rendering and pass ready data through component props.',
      docsPath: '/docs/component-authoring/security#remotion-delay-render',
    },
  ],
  mediatedApis: [
    {
      id: 'network.raw_fetch',
      label: 'Raw network access',
      rawApis: ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator.sendBeacon'],
      astMatchers: {
        globals: ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
        memberPaths: ['navigator.sendBeacon', 'window.fetch', 'globalThis.fetch'],
      },
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

export const PROMPTFRAME_PUBLIC_SECURITY_POLICY_DIGEST =
  createPromptFramePublicSecurityPolicyDigest(PROMPTFRAME_PUBLIC_SECURITY_POLICY);

export const PROMPTFRAME_PUBLIC_DEPENDENCY_POLICY = {
  policyVersion: COMPONENT_DEPENDENCY_POLICY_VERSION,
  lanes: [
    'platform_core',
    'reviewed_visual',
    'requested_dependency',
    'native_or_scripted',
    'unknown_unlocked',
  ],
  catalog: {
    platformCore: [
      '@promptframe/cli',
      '@promptframe/component-kit',
      '@promptframe/contracts',
      'react',
      'react-dom',
      'remotion',
      'zod',
    ],
    reviewedVisual: [
      'lucide-react',
      'three',
    ],
  },
  forbiddenLifecycleScripts: ['preinstall', 'install', 'postinstall', 'prepare'],
  nativeOrPrebuildPackageSignals: [
    'node-gyp',
    'node-pre-gyp',
    'prebuild',
    'prebuild-install',
    'node-addon-api',
    'nan',
  ],
  forbiddenVersionSpecifiers: [
    'latest',
    '*',
    'workspace:',
    'file:',
    'link:',
    'git+',
    'http:',
    'https:',
  ],
  sandboxInstall: {
    required: true,
    requiredFlags: ['--ignore-scripts', '--frozen-lockfile'],
    runInMainService: false,
  },
} as const;

export type PromptFrameDependencyLane =
  | 'platform_core'
  | 'reviewed_visual'
  | 'requested_dependency'
  | 'native_or_scripted'
  | 'unknown_unlocked';

export type PromptFrameDependencyPolicyStatus = 'allow' | 'manual_review' | 'reject';

export interface EvaluatePromptFrameDependencyPolicyInput {
  packageJson: unknown;
  lockfilePresent: boolean;
  catalog?: {
    platformCore: readonly string[];
    reviewedVisual: readonly string[];
  };
}

export interface PromptFrameDependencyPolicyReceipt {
  policyVersion: typeof COMPONENT_DEPENDENCY_POLICY_VERSION;
  status: PromptFrameDependencyPolicyStatus;
  lane: PromptFrameDependencyLane;
  quarantine: boolean;
  publicSearchableAllowed: boolean;
  dependencies: Array<{
    name: string;
    version: string;
    dependencySet: string;
    lane: PromptFrameDependencyLane;
  }>;
  sandboxInstall: {
    required: true;
    requiredFlags: ['--ignore-scripts', '--frozen-lockfile'];
    runInMainService: false;
  };
  diagnostics: ComponentDiagnostic[];
}

export function evaluatePromptFrameDependencyPolicy(
  input: EvaluatePromptFrameDependencyPolicyInput,
): PromptFrameDependencyPolicyReceipt {
  const catalog = input.catalog ?? PROMPTFRAME_PUBLIC_DEPENDENCY_POLICY.catalog;
  const packageJson = asRecord(input.packageJson);
  const scripts = asStringRecord(packageJson.scripts);
  const dependencies = collectDependencyRows(packageJson).map((dependency) => ({
    ...dependency,
    lane: dependencyLane(dependency.name, catalog),
  }));
  const diagnostics: ComponentDiagnostic[] = [];

  for (const scriptName of Object.keys(scripts)) {
    if ((PROMPTFRAME_PUBLIC_DEPENDENCY_POLICY.forbiddenLifecycleScripts as readonly string[]).includes(scriptName)) {
      diagnostics.push(dependencyDiagnostic(
        'dependency.install.script_forbidden',
        `package.json scripts.${scriptName} is forbidden for PromptFrame component packages.`,
        'Remove install lifecycle scripts. Platform installs always use --ignore-scripts inside a sandbox worker.',
      ));
    }
  }

  if (Object.values(scripts).some((script) => /(?:^|\s)(node-gyp|prebuild-install|node-pre-gyp|cmake-js)(?:\s|$)/i.test(script))) {
    diagnostics.push(dependencyDiagnostic(
      'dependency.install.native_forbidden',
      'package.json scripts contain native build or prebuild indicators.',
      'Remove native addon / prebuild flows; marketplace components must stay browser-renderable and auditable.',
    ));
  }

  for (const dependency of dependencies) {
    if ((PROMPTFRAME_PUBLIC_DEPENDENCY_POLICY.nativeOrPrebuildPackageSignals as readonly string[]).includes(dependency.name)) {
      diagnostics.push(dependencyDiagnostic(
        'dependency.install.native_forbidden',
        `Dependency ${dependency.name} is treated as native/prebuild and is forbidden.`,
        'Remove native addon / prebuild dependencies or request manual platform security review.',
      ));
    }
    if (isForbiddenVersionSpecifier(dependency.version)) {
      diagnostics.push(dependencyDiagnostic(
        'dependency.install.unlocked_version',
        `Dependency ${dependency.name}@${dependency.version} is not acceptable for PromptFrame component packages.`,
        'Use registry semver ranges backed by a lockfile; latest, wildcard, workspace/file/link/git/http specs are forbidden.',
      ));
    }
  }

  if (!input.lockfilePresent && dependencies.length > 0) {
    diagnostics.push(dependencyDiagnostic(
      'dependency.install.lockfile_required',
      'Component dependency install requires a package manager lockfile.',
      'Commit pnpm-lock.yaml / package-lock.json / yarn.lock / bun.lock and use frozen lockfile installs.',
    ));
  }

  for (const dependency of dependencies) {
    if (dependency.lane === 'requested_dependency') {
      diagnostics.push(dependencyDiagnostic(
        'dependency.catalog.unknown_dependency',
        `Dependency ${dependency.name} is not in the reviewed PromptFrame dependency catalog.`,
        'Unknown dependencies enter manual_review / quarantine and cannot become public searchable until reviewed.',
        'warning',
      ));
    }
  }

  const lane = aggregateDependencyLane(dependencies.map((dependency) => dependency.lane), diagnostics);
  const status = dependencyPolicyStatus(diagnostics);
  return {
    policyVersion: COMPONENT_DEPENDENCY_POLICY_VERSION,
    status,
    lane,
    quarantine: status === 'manual_review',
    publicSearchableAllowed: status === 'allow',
    dependencies,
    sandboxInstall: {
      required: true,
      requiredFlags: ['--ignore-scripts', '--frozen-lockfile'],
      runInMainService: false,
    },
    diagnostics,
  };
}

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

export const promptFrameToneSchema = z.enum([
  'business',
  'tech',
  'minimal',
  'warm',
  'playful',
  'luxury',
  'documentary',
]);
export type PromptFrameTone = z.infer<typeof promptFrameToneSchema>;

export const promptFrameDensitySchema = z.enum(['compact', 'balanced', 'spacious']);
export type PromptFrameDensity = z.infer<typeof promptFrameDensitySchema>;

export const promptFrameMotionIntensitySchema = z.enum(['none', 'subtle', 'balanced', 'expressive']);
export type PromptFrameMotionIntensity = z.infer<typeof promptFrameMotionIntensitySchema>;

export const promptFrameFontScaleSchema = z.enum(['small', 'normal', 'large']);
export type PromptFrameFontScale = z.infer<typeof promptFrameFontScaleSchema>;

export const promptFrameHexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const promptFrameStyleIntentSchema = z.object({
  contractVersion: z.literal(PROMPTFRAME_STYLE_CONTRACT_VERSION).default(PROMPTFRAME_STYLE_CONTRACT_VERSION),
  stylePackId: z.string().trim().min(1).max(80).optional(),
  tone: promptFrameToneSchema.optional(),
  accentColor: promptFrameHexColorSchema.optional(),
  density: promptFrameDensitySchema.optional(),
  motionIntensity: promptFrameMotionIntensitySchema.optional(),
  fontScale: promptFrameFontScaleSchema.optional(),
  brandTokens: z.object({
    primaryColor: promptFrameHexColorSchema.optional(),
    logoAssetId: z.string().trim().min(1).max(160).regex(/^asset:\/\/[a-zA-Z0-9._:-]+$/).optional(),
    fontFamilyHint: z.string().trim().min(1).max(120).optional(),
  }).strict().optional(),
}).strict();
export type PromptFrameStyleIntent = z.infer<typeof promptFrameStyleIntentSchema>;

export const PROMPTFRAME_UNKNOWN_CUSTOM_STYLE_PROP_RULE = {
  id: 'component.style.unknown_custom_style_prop',
  stage: 'schema',
  severity: 'warning',
  message: 'Root-level private style props are not part of the public PromptFrame style contract.',
  repairHint: 'Move visual style controls under styleIntent and consume @promptframe/component-kit/style helpers instead of custom color/theme/style props.',
} as const;

export const PROMPTFRAME_STYLE_INTENT_ROOT_PROP_NAME = 'styleIntent' as const;

export const PROMPTFRAME_PRIVATE_STYLE_ROOT_PROP_NAMES = [
  'accentColor',
  'backgroundColor',
  'brandColor',
  'borderColor',
  'color',
  'fontFamily',
  'foregroundColor',
  'primaryColor',
  'secondaryColor',
  'style',
  'styles',
  'surfaceColor',
  'textColor',
  'theme',
  'themeName',
] as const;

export interface PromptFrameUnknownCustomStylePropFinding {
  ruleId: typeof PROMPTFRAME_UNKNOWN_CUSTOM_STYLE_PROP_RULE.id;
  propName: string;
  severity: typeof PROMPTFRAME_UNKNOWN_CUSTOM_STYLE_PROP_RULE.severity;
  message: string;
  repairHint: typeof PROMPTFRAME_UNKNOWN_CUSTOM_STYLE_PROP_RULE.repairHint;
}

export function detectPromptFrameUnknownCustomStyleProps(schemaSourceText: string): PromptFrameUnknownCustomStylePropFinding[] {
  const privateProps = new Set<string>(PROMPTFRAME_PRIVATE_STYLE_ROOT_PROP_NAMES);
  return extractPromptFrameRootPropKeys(schemaSourceText)
    .filter((propName) => privateProps.has(propName))
    .sort((left, right) => left.localeCompare(right))
    .map((propName) => ({
      ruleId: PROMPTFRAME_UNKNOWN_CUSTOM_STYLE_PROP_RULE.id,
      propName,
      severity: PROMPTFRAME_UNKNOWN_CUSTOM_STYLE_PROP_RULE.severity,
      message: `${PROMPTFRAME_UNKNOWN_CUSTOM_STYLE_PROP_RULE.message} prop=${propName}.`,
      repairHint: PROMPTFRAME_UNKNOWN_CUSTOM_STYLE_PROP_RULE.repairHint,
    }));
}

export function extractPromptFrameRootPropKeys(schemaSourceText: string): string[] {
  const body = extractPromptFrameRootZodObjectBody(schemaSourceText);
  if (!body) return [];
  return splitTopLevelObjectEntries(body)
    .map((entry) => entry.trim())
    .map(extractObjectEntryKey)
    .filter((key): key is string => typeof key === 'string' && key.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function extractPromptFrameRootZodObjectBody(source: string): string | null {
  const preferred = [
    /\bpropsSchema\s*=\s*z\.object\s*\(/,
    /\bschema\s*=\s*z\.object\s*\(/,
  ];
  const match = preferred
    .map((pattern) => pattern.exec(source))
    .find((item): item is RegExpExecArray => item !== null)
    ?? /\bz\.object\s*\(/.exec(source);
  if (!match) return null;
  const openParenIndex = source.indexOf('(', match.index);
  const openBraceIndex = firstNonWhitespaceIndex(source, openParenIndex + 1);
  if (openBraceIndex < 0 || source[openBraceIndex] !== '{') return null;
  const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
  return closeBraceIndex > openBraceIndex
    ? source.slice(openBraceIndex + 1, closeBraceIndex)
    : null;
}

function firstNonWhitespaceIndex(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    if (!/\s/.test(source[index]!)) return index;
  }
  return -1;
}

function splitTopLevelObjectEntries(body: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let curlyDepth = 0;
  let parenDepth = 0;
  let squareDepth = 0;
  let stringQuote: '"' | "'" | '`' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    const next = body[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (stringQuote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === stringQuote) stringQuote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      stringQuote = char;
      continue;
    }
    if (char === '{') curlyDepth += 1;
    else if (char === '}') curlyDepth = Math.max(0, curlyDepth - 1);
    else if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (char === '[') squareDepth += 1;
    else if (char === ']') squareDepth = Math.max(0, squareDepth - 1);
    else if (char === ',' && curlyDepth === 0 && parenDepth === 0 && squareDepth === 0) {
      entries.push(body.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(body.slice(start));
  return entries;
}

function extractObjectEntryKey(entry: string): string | null {
  const match = /^(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$-]*))\s*:/.exec(entry);
  return match?.[1] ?? match?.[2] ?? null;
}

function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0;
  let stringQuote: '"' | "'" | '`' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (stringQuote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === stringQuote) stringQuote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      stringQuote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export const authoringUploadTargetSchema = z.enum([
  'marketplace_authoring',
  'project_private_generation',
]);
export type AuthoringUploadTarget = z.infer<typeof authoringUploadTargetSchema>;

export const authoringUploadTargetPolicySchema = z.object({
  target: authoringUploadTargetSchema,
  description: nonEmptyStringSchema.max(500),
  allowedVisibility: z.array(componentVisibilitySchema).min(1).max(4),
  requiresUploadTrustPipeline: z.boolean().default(true),
  requiresHumanPublishApproval: z.boolean().default(true),
  deterministicGateMode: z.literal('fail_closed').default('fail_closed'),
}).strict();
export type AuthoringUploadTargetPolicy = z.infer<typeof authoringUploadTargetPolicySchema>;

export const authoringPackageFloorSchema = z.object({
  contracts: semverSchema,
  componentKit: semverSchema,
  cli: semverSchema,
  createComponent: semverSchema,
}).strict();
export type AuthoringPackageFloor = z.infer<typeof authoringPackageFloorSchema>;

export const componentReusabilityTargetVisibilitySchema = z.enum([
  'project_private',
  'user_private',
  'team_private',
  'public',
]);
export type ComponentReusabilityTargetVisibility = z.infer<typeof componentReusabilityTargetVisibilitySchema>;

export const componentReusabilitySignalIdSchema = z.enum([
  'propsRichness',
  'hardcodedContentRisk',
  'dataShapeRichness',
  'styleConfigurability',
  'domainNeutrality',
  'emptyStateSupport',
  'previewCaseCoverage',
  'sourceFactsReuse',
]);
export type ComponentReusabilitySignalId = z.infer<typeof componentReusabilitySignalIdSchema>;

export const componentReusabilityRecommendationSchema = z.enum([
  'allow',
  'warn',
  'manual_review',
  'reject',
]);
export type ComponentReusabilityRecommendation = z.infer<typeof componentReusabilityRecommendationSchema>;

export const componentReusabilitySignalSchema = z.object({
  id: componentReusabilitySignalIdSchema,
  score: z.number().min(0).max(1),
  weight: z.number().positive().max(1),
  severity: z.enum(['info', 'warning', 'error']).default('info'),
  reason: nonEmptyStringSchema.max(500),
}).strict();
export type ComponentReusabilitySignal = z.infer<typeof componentReusabilitySignalSchema>;

export const componentReusabilityScoreSchema = z.object({
  contractVersion: z.literal(COMPONENT_REUSABILITY_CONTRACT_VERSION).default(COMPONENT_REUSABILITY_CONTRACT_VERSION),
  uploadTarget: authoringUploadTargetSchema,
  targetVisibility: componentReusabilityTargetVisibilitySchema,
  score: z.number().min(0).max(1),
  recommendation: componentReusabilityRecommendationSchema,
  signals: z.array(componentReusabilitySignalSchema).min(1).max(16),
  generatedAt: z.string().datetime(),
}).strict();
export type ComponentReusabilityScore = z.infer<typeof componentReusabilityScoreSchema>;

export const authoringStandardReleaseSchema = z.object({
  releaseVersion: z.literal(AUTHORING_STANDARD_RELEASE_VERSION),
  contractsVersion: z.literal(PROMPTFRAME_CONTRACTS_VERSION),
  manifestSchemaVersion: z.literal(COMPONENT_MANIFEST_SCHEMA_VERSION),
  componentRefVersion: z.literal(COMPONENT_REF_VERSION),
  standardVersion: z.literal(COMPONENT_STANDARD_VERSION),
  standardSourceHash: sha256Schema,
  standardPolicyVersion: z.literal(COMPONENT_STANDARD_POLICY_VERSION),
  securityPolicyVersion: z.literal(COMPONENT_SECURITY_POLICY_VERSION),
  styleContractVersion: z.literal(PROMPTFRAME_STYLE_CONTRACT_VERSION),
  supportedComponentTypes: z.array(promptFrameComponentTypeSchema).min(1),
  minPackageVersions: authoringPackageFloorSchema,
  uploadTargets: z.array(authoringUploadTargetPolicySchema).min(1),
}).strict();
export type AuthoringStandardRelease = z.infer<typeof authoringStandardReleaseSchema>;

export const authoringStandardFreshnessStatusSchema = z.enum([
  'current',
  'warning',
  'upload_blocking',
  'security_breaking',
]);
export type AuthoringStandardFreshnessStatus = z.infer<typeof authoringStandardFreshnessStatusSchema>;

export const authoringFreshnessDiagnosticSchema = z.object({
  code: nonEmptyStringSchema.max(160),
  severity: z.enum(['info', 'warning', 'error']),
  message: nonEmptyStringSchema.max(2000),
}).strict();
export type AuthoringFreshnessDiagnostic = z.infer<typeof authoringFreshnessDiagnosticSchema>;

export const authoringStandardFreshnessDecisionSchema = z.object({
  status: authoringStandardFreshnessStatusSchema,
  target: authoringUploadTargetSchema,
  localStandardVersion: z.string().trim().min(1).optional(),
  localStandardSourceHash: sha256Schema.optional(),
  currentStandardVersion: z.literal(COMPONENT_STANDARD_VERSION),
  currentStandardSourceHash: sha256Schema,
  minPackageVersions: authoringPackageFloorSchema,
  diagnostic: authoringFreshnessDiagnosticSchema,
  retryable: z.boolean().default(false),
}).strict();
export type AuthoringStandardFreshnessDecision = z.infer<typeof authoringStandardFreshnessDecisionSchema>;

export const PROMPTFRAME_AUTHORING_STANDARD_RELEASE: AuthoringStandardRelease = authoringStandardReleaseSchema.parse({
  releaseVersion: AUTHORING_STANDARD_RELEASE_VERSION,
  contractsVersion: PROMPTFRAME_CONTRACTS_VERSION,
  manifestSchemaVersion: COMPONENT_MANIFEST_SCHEMA_VERSION,
  componentRefVersion: COMPONENT_REF_VERSION,
  standardVersion: COMPONENT_STANDARD_VERSION,
  standardSourceHash: COMPONENT_STANDARD_SOURCE_HASH,
  standardPolicyVersion: COMPONENT_STANDARD_POLICY_VERSION,
  securityPolicyVersion: COMPONENT_SECURITY_POLICY_VERSION,
  styleContractVersion: PROMPTFRAME_STYLE_CONTRACT_VERSION,
  supportedComponentTypes: promptFrameComponentTypeSchema.options,
  minPackageVersions: {
    contracts: '0.1.5',
    componentKit: '0.1.6',
    cli: '0.1.6',
    createComponent: '0.1.4',
  },
  uploadTargets: [
    {
      target: 'marketplace_authoring',
      description: 'External authoring lane for components submitted to the platform marketplace.',
      allowedVisibility: ['public', 'team'],
      requiresUploadTrustPipeline: true,
      requiresHumanPublishApproval: true,
      deterministicGateMode: 'fail_closed',
    },
    {
      target: 'project_private_generation',
      description: 'Director Component Author lane for project-scoped private components.',
      allowedVisibility: ['project_private', 'private'],
      requiresUploadTrustPipeline: true,
      requiresHumanPublishApproval: false,
      deterministicGateMode: 'fail_closed',
    },
  ],
});

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
  'component.style.unknown_custom_style_prop',
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

function collectDependencyRows(packageJson: Record<string, unknown>): Array<{
  name: string;
  version: string;
  dependencySet: string;
}> {
  const result = new Map<string, { name: string; version: string; dependencySet: string }>();
  for (const dependencySet of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const dependencies = asStringRecord(packageJson[dependencySet]);
    for (const [name, version] of Object.entries(dependencies)) {
      result.set(name, { name, version, dependencySet });
    }
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function dependencyLane(
  name: string,
  catalog: { platformCore: readonly string[]; reviewedVisual: readonly string[] },
): PromptFrameDependencyLane {
  if (catalog.platformCore.includes(name)) return 'platform_core';
  if (catalog.reviewedVisual.includes(name)) return 'reviewed_visual';
  return 'requested_dependency';
}

function isForbiddenVersionSpecifier(version: string): boolean {
  const normalized = version.trim().toLowerCase();
  if (PROMPTFRAME_PUBLIC_DEPENDENCY_POLICY.forbiddenVersionSpecifiers.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  return normalized === '' || normalized === '*' || normalized === 'latest';
}

function aggregateDependencyLane(
  lanes: PromptFrameDependencyLane[],
  diagnostics: ComponentDiagnostic[],
): PromptFrameDependencyLane {
  if (diagnostics.some((diagnostic) => diagnostic.code === 'dependency.install.script_forbidden'
    || diagnostic.code === 'dependency.install.native_forbidden')) {
    return 'native_or_scripted';
  }
  if (diagnostics.some((diagnostic) => diagnostic.code === 'dependency.install.unlocked_version'
    || diagnostic.code === 'dependency.install.lockfile_required')) {
    return 'unknown_unlocked';
  }
  if (lanes.includes('requested_dependency')) return 'requested_dependency';
  if (lanes.includes('reviewed_visual')) return 'reviewed_visual';
  return 'platform_core';
}

function dependencyPolicyStatus(diagnostics: ComponentDiagnostic[]): PromptFrameDependencyPolicyStatus {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return 'reject';
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'warning')) return 'manual_review';
  return 'allow';
}

function dependencyDiagnostic(
  code: string,
  message: string,
  repairHint: string,
  severity: ComponentDiagnostic['severity'] = 'error',
): ComponentDiagnostic {
  return {
    code,
    severity,
    stage: 'package',
    message,
    repairHint,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}
