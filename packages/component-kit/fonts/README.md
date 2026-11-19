# Fixed runtime fonts

The local preview shell, Studio and rendering workers load these same WOFF2
bytes before displaying video content. No font website is contacted at runtime.
`@promptframe/component-kit/runtime-fonts` contains the small version/hash
manifest and CSS fallback helper. `@promptframe/component-kit/fonts` loads the
three fixed payloads once per document; a decoding failure remains a failure.
The payload modules load on demand and are not imported by the manifest.

| Family | Version | WOFF2 bytes | License |
| --- | --- | ---: | --- |
| Inter | 4.1 | 352,240 | OFL-1.1 |
| Noto Sans SC | 2.004, variable weight 100–900 | 7,779,480 | OFL-1.1 |
| Noto Color Emoji | 2.057, COLRv1 | 1,996,756 | OFL-1.1 |

Inter reuses the original Inter 4.1 WOFF2 payload without modification. Noto
WOFF2 payloads are losslessly re-encoded from the following fixed TrueType
sources using fontTools 4.65.0 and Brotli 1.2.0, with timestamp recalculation
disabled. Original names, cmap, advances, variable axes, shaping and color
tables are preserved. Complete readable licenses accompany this file.

- [Noto Sans SC 2.004 source](https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf), Git blob `5371a543be5fc670c7cdee9760c03554ee3e9b8e`.
- [Noto Color Emoji 2.057 source](https://github.com/googlefonts/noto-emoji/blob/v2026-09-24-unicode18_0/2D/fonts/Noto-COLRv1.ttf), Git blob `d1c82373d26e6949d81bbaefa4323f1e19f77262`.

The manifest records original and delivery SHA-256 values. These are fixed
rendering inputs, not arbitrary font upload or network APIs. The fallback
helper preserves declared fonts and puts the fixed Chinese and emoji families
before generic system fallbacks. A custom family and characters outside these
fonts still require an available host font. COLRv1 support is required for the
bundled color emoji; unsupported browsers are not declared equivalent.
