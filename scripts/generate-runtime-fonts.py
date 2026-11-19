"""Regenerate fixed payload modules from the verified upstream font inputs.

Build tool only: Python 3.10+, fontTools==4.65.0 and Brotli==1.2.0.
Pass InterVariable.woff2, NotoSansSC-VF.ttf and Noto-COLRv1.ttf in that order.
No downloads, runtime input, subsetting or glyph/name modification is performed.
"""
import base64
import hashlib
import io
from pathlib import Path
import sys

from fontTools.ttLib import TTFont

INPUTS = [
    ('inter', '693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3',
     '693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3'),
    ('notoSansSC', 'd68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964',
     'a5822f9d6ef83d113dd94741221c16ba7a321f63033a02bd164968188995d547'),
    ('notoColorEmoji', 'b8e25ea68db82f9e4d0aee921f4420be2be39887bd5c893a2ad98710531f9d0c',
     '188b2b5de8d1216e807b6222a0a467832fc790a82522600b6f10853252e7cebb'),
]

if len(sys.argv) != 4:
    raise SystemExit('Pass the three fixed font files; see packages/component-kit/fonts/README.md')

output = Path(__file__).resolve().parent.parent / 'packages/component-kit/src/fonts'
for (name, source_hash, delivery_hash), file in zip(INPUTS, sys.argv[1:]):
    source = Path(file).read_bytes()
    if hashlib.sha256(source).hexdigest() != source_hash:
        raise SystemExit('font source digest mismatch: ' + name)
    if name == 'inter':
        data = source
    else:
        font = TTFont(io.BytesIO(source), recalcTimestamp=False)
        font.flavor = 'woff2'
        buffer = io.BytesIO()
        font.save(buffer)
        data = buffer.getvalue()
    if hashlib.sha256(data).hexdigest() != delivery_hash:
        raise SystemExit('font conversion digest mismatch: check the pinned build tools')
    output.mkdir(exist_ok=True)
    (output / (name + '.generated.ts')).write_text(
        '// Fixed WOFF2 input. Source and OFL licenses: ../../fonts/README.md.\n'
        'export const FONT_DATA_URL: string = "data:font/woff2;base64,'
        + base64.b64encode(data).decode('ascii') + '";\n', encoding='utf-8')
