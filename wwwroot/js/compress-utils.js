// PDF圧縮: PDF内の画像(JPEG/Flate)をJPEGに再圧縮する。目標サイズに届かない場合のみページ画像化を行う。

const MIN_IMAGE_BYTES = 8 * 1024; // これより小さい画像は再圧縮の効果が薄いので対象外
const DECODE_CACHE_LIMIT = 300 * 1024 * 1024; // デコード済み画像をキャッシュする上限(byte)
const ESTIMATE_ANCHORS = [0, 20, 40, 60, 80, 100];

// ページ画像化の段階(dpi, JPEG品質)。上から順に画質が低くなる
const RASTER_LEVELS = [
    { dpi: 150, quality: 0.7 },
    { dpi: 120, quality: 0.65 },
    { dpi: 100, quality: 0.6 },
    { dpi: 85, quality: 0.55 },
    { dpi: 72, quality: 0.5 },
    { dpi: 60, quality: 0.45 },
    { dpi: 50, quality: 0.4 },
    { dpi: 40, quality: 0.35 },
];

let session = null;
let queue = Promise.resolve();

// 見積もりと圧縮が同時に走らないよう直列化する
function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => { });
    return run;
}

function strengthToParams(strength) {
    const t = Math.min(100, Math.max(0, strength)) / 100;
    return {
        quality: 0.92 - 0.67 * t,
        scale: t <= 0.2 ? 1 : 1 - (t - 0.2) * 0.625,
    };
}

function nameOf(obj) {
    return obj instanceof PDFLib.PDFName ? obj.asString() : null;
}

function numberOf(obj) {
    return obj instanceof PDFLib.PDFNumber ? obj.asNumber() : null;
}

function getFilters(ctx, dict) {
    const filter = dict.lookup(PDFLib.PDFName.of('Filter'));
    if (!filter) return [];
    if (filter instanceof PDFLib.PDFArray) {
        return filter.asArray().map(o => nameOf(ctx.lookup(o)));
    }
    return [nameOf(filter)];
}

function getBaseComponentCount(ctx, cs) {
    const { PDFName, PDFArray } = PDFLib;
    const name = nameOf(cs);
    if (name === '/DeviceRGB') return 3;
    if (name === '/DeviceGray') return 1;
    if (name === '/DeviceCMYK') return 4;
    if (cs instanceof PDFArray && nameOf(ctx.lookup(cs.get(0))) === '/ICCBased') {
        const profile = ctx.lookup(cs.get(1));
        const n = profile && profile.dict ? numberOf(profile.dict.lookup(PDFName.of('N'))) : null;
        if (n === 3 || n === 1 || n === 4) return n;
    }
    return 0;
}

// 1画素あたりのサンプル数と、Indexed(索引色)の場合はパレット情報を返す。非対応の色空間は null
function getColorInfo(ctx, dict) {
    const { PDFName, PDFArray } = PDFLib;
    const cs = dict.lookup(PDFName.of('ColorSpace'));
    if (cs instanceof PDFArray && nameOf(ctx.lookup(cs.get(0))) === '/Indexed') {
        const baseComps = getBaseComponentCount(ctx, ctx.lookup(cs.get(1)));
        const hival = numberOf(ctx.lookup(cs.get(2)));
        const lookup = ctx.lookup(cs.get(3));
        if (!baseComps || hival === null || !lookup) return null;
        return { comps: 1, palette: { baseComps, hival, lookup } };
    }
    const comps = getBaseComponentCount(ctx, cs);
    return comps ? { comps, palette: null } : null;
}

function getDecodeArray(ctx, dict) {
    const decode = dict.lookup(PDFLib.PDFName.of('Decode'));
    if (!(decode instanceof PDFLib.PDFArray)) return null;
    return decode.asArray().map(o => numberOf(ctx.lookup(o)));
}

function isDefaultDecode(decode, comps, indexed, bpc) {
    if (!decode) return true;
    if (decode.length !== comps * 2) return false;
    const max = indexed ? (1 << bpc) - 1 : 1;
    return decode.every((v, i) => v === (i % 2 === 0 ? 0 : max));
}

// ブラウザのCMYK JPEGデコードはAdobe形式の扱いがPDFと異なり色が反転するため、
// 画像1枚だけのPDFを作ってpdf.jsで描画し、PDFと同じ見た目の画素を得る
async function decodeCmykJpegWithPdfJs(image) {
    const { PDFDocument, PDFName, PDFRawStream, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = PDFLib;
    const pdfjsLib = window.pdfjsLib;
    const doc = await PDFDocument.create();
    const dict = image.obj.dict.clone(doc.context);
    dict.delete(PDFName.of('SMask'));
    dict.delete(PDFName.of('Mask'));
    dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceCMYK'));
    const ref = doc.context.register(PDFRawStream.of(dict, image.obj.contents));
    const page = doc.addPage([image.width, image.height]);
    const key = page.node.newXObject('Im', ref);
    page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(image.width, 0, 0, image.height, 0, 0),
        drawObject(key),
        popGraphicsState(),
    );
    const data = await doc.save({ useObjectStreams: false });

    if (!session.pdfjsWorker) session.pdfjsWorker = new pdfjsLib.PDFWorker();
    const task = pdfjsLib.getDocument({ data, worker: session.pdfjsWorker, verbosity: 0 });
    try {
        const pdf = await task.promise;
        const pdfPage = await pdf.getPage(1);
        const canvas = createCanvas(image.width, image.height);
        const g = canvas.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, image.width, image.height);
        await pdfPage.render({ canvasContext: g, viewport: pdfPage.getViewport({ scale: 1 }) }).promise;
        return await createImageBitmap(canvas);
    } finally {
        await task.destroy();
    }
}

function getPredictorParams(ctx, dict) {
    const { PDFName, PDFArray, PDFDict } = PDFLib;
    let parms = dict.lookup(PDFName.of('DecodeParms'));
    if (parms instanceof PDFArray) parms = ctx.lookup(parms.get(0));
    if (!(parms instanceof PDFDict)) return { predictor: 1 };
    return {
        predictor: numberOf(parms.lookup(PDFName.of('Predictor'))) ?? 1,
        colors: numberOf(parms.lookup(PDFName.of('Colors'))) ?? 1,
        columns: numberOf(parms.lookup(PDFName.of('Columns'))) ?? 1,
        bpc: numberOf(parms.lookup(PDFName.of('BitsPerComponent'))) ?? 8,
    };
}

// 再圧縮できる画像(8bit RGB/Gray の JPEG もしくは Flate)だけを抽出する
function collectImages(pdfDoc) {
    const { PDFName, PDFRawStream, PDFBool } = PDFLib;
    const ctx = pdfDoc.context;
    const images = [];
    const skipped = { count: 0, bytes: 0, reasons: {} };

    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        const dict = obj.dict;
        if (nameOf(dict.lookup(PDFName.of('Subtype'))) !== '/Image') continue;
        if (obj.contents.length < MIN_IMAGE_BYTES) continue;

        const skip = (reason) => {
            skipped.count++;
            skipped.bytes += obj.contents.length;
            skipped.reasons[reason] = (skipped.reasons[reason] || 0) + 1;
        };

        const width = numberOf(dict.lookup(PDFName.of('Width')));
        const height = numberOf(dict.lookup(PDFName.of('Height')));
        const bpc = numberOf(dict.lookup(PDFName.of('BitsPerComponent')));
        if (!width || !height) { skip('invalid'); continue; }

        const imageMask = dict.lookup(PDFName.of('ImageMask'));
        if (imageMask instanceof PDFBool && imageMask.asBoolean()) { skip('mask'); continue; }
        if (bpc !== 8) { skip('bpc' + bpc); continue; }
        if (dict.has(PDFName.of('Mask'))) { skip('mask'); continue; }

        const color = getColorInfo(ctx, dict);
        if (!color) { skip('colorspace'); continue; }
        const { comps, palette } = color;

        const decode = getDecodeArray(ctx, dict);
        const filters = getFilters(ctx, dict);
        const kind = filters.length === 1 && filters[0] === '/DCTDecode' ? 'jpeg'
            : filters.length === 1 && filters[0] === '/FlateDecode' ? 'flate' : null;
        if (!kind) { skip('filter:' + filters.join('+')); continue; }
        if (kind === 'jpeg' && palette) { skip('jpeg-indexed'); continue; }

        // CMYK JPEG は pdf.js でデコードするためDecodeも解釈される。それ以外は既定値のみ対応
        if (!(comps === 4 && kind === 'jpeg') && !isDefaultDecode(decode, comps, !!palette, bpc)) {
            skip('decode');
            continue;
        }

        const image = { ref, obj, width, height, comps, palette, kind, origBytes: obj.contents.length, source: null };
        if (kind === 'flate') {
            const p = getPredictorParams(ctx, dict);
            if (p.predictor === 2 || (p.predictor >= 10 && (p.bpc !== 8 || p.colors !== comps || p.columns !== width))) {
                skip('predictor');
                continue;
            }
            image.predictor = p.predictor;
        }
        images.push(image);
    }
    if (skipped.count > 0) console.info('pdfCompress: skipped images', skipped);
    return { images, skipped };
}

async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function undoPngPredictor(data, rowBytes, bpp, rows) {
    const out = new Uint8Array(rowBytes * rows);
    for (let y = 0; y < rows; y++) {
        const filter = data[y * (rowBytes + 1)];
        const inOff = y * (rowBytes + 1) + 1;
        const outOff = y * rowBytes;
        const prevOff = outOff - rowBytes;
        for (let x = 0; x < rowBytes; x++) {
            const raw = data[inOff + x];
            const a = x >= bpp ? out[outOff + x - bpp] : 0;
            const b = y > 0 ? out[prevOff + x] : 0;
            const c = x >= bpp && y > 0 ? out[prevOff + x - bpp] : 0;
            let v;
            switch (filter) {
                case 0: v = raw; break;
                case 1: v = raw + a; break;
                case 2: v = raw + b; break;
                case 3: v = raw + ((a + b) >> 1); break;
                case 4: {
                    const p = a + b - c;
                    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                    v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
                    break;
                }
                default: throw new Error('unsupported png filter');
            }
            out[outOff + x] = v & 0xff;
        }
    }
    return out;
}

async function getPaletteBytes(palette) {
    const { lookup } = palette;
    if (lookup instanceof PDFLib.PDFString || lookup instanceof PDFLib.PDFHexString) return lookup.asBytes();
    if (lookup instanceof PDFLib.PDFRawStream) {
        const filter = lookup.dict.lookup(PDFLib.PDFName.of('Filter'));
        return filter ? await inflate(lookup.contents) : lookup.contents;
    }
    throw new Error('unsupported palette');
}

function cmykToRgb(c, m, y, k, out, q) {
    const nk = 255 - k;
    out[q] = ((255 - c) * nk / 255) | 0;
    out[q + 1] = ((255 - m) * nk / 255) | 0;
    out[q + 2] = ((255 - y) * nk / 255) | 0;
}

async function decodeImage(image) {
    if (image.kind === 'jpeg') {
        if (image.comps === 4) return await decodeCmykJpegWithPdfJs(image);
        const blob = new Blob([image.obj.contents], { type: 'image/jpeg' });
        return await createImageBitmap(blob, { imageOrientation: 'none', colorSpaceConversion: 'none' });
    }

    const { width, height, comps, palette } = image;
    let raw = await inflate(image.obj.contents);
    if (image.predictor >= 10) {
        raw = undoPngPredictor(raw, width * comps, comps, height);
    }
    if (raw.length < width * height * comps) throw new Error('unexpected image data length');

    const rgba = new Uint8ClampedArray(width * height * 4);
    const pixels = width * height;
    if (palette) {
        const table = await getPaletteBytes(palette);
        const n = palette.baseComps;
        for (let i = 0, q = 0; i < pixels; i++, q += 4) {
            const idx = Math.min(raw[i], palette.hival) * n;
            if (n === 3) {
                rgba[q] = table[idx]; rgba[q + 1] = table[idx + 1]; rgba[q + 2] = table[idx + 2];
            } else if (n === 1) {
                rgba[q] = rgba[q + 1] = rgba[q + 2] = table[idx];
            } else {
                cmykToRgb(table[idx], table[idx + 1], table[idx + 2], table[idx + 3], rgba, q);
            }
            rgba[q + 3] = 255;
        }
    } else {
        for (let i = 0, p = 0, q = 0; i < pixels; i++, q += 4) {
            if (comps === 3) {
                rgba[q] = raw[p]; rgba[q + 1] = raw[p + 1]; rgba[q + 2] = raw[p + 2];
                p += 3;
            } else if (comps === 4) {
                cmykToRgb(raw[p], raw[p + 1], raw[p + 2], raw[p + 3], rgba, q);
                p += 4;
            } else {
                rgba[q] = rgba[q + 1] = rgba[q + 2] = raw[p++];
            }
            rgba[q + 3] = 255;
        }
    }
    return await createImageBitmap(new ImageData(rgba, width, height));
}

function createCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

async function canvasToJpeg(canvas, quality) {
    if (canvas.convertToBlob) {
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        return new Uint8Array(await blob.arrayBuffer());
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    return new Uint8Array(await blob.arrayBuffer());
}

async function getSource(image) {
    if (image.source) return image.source;
    const bitmap = await decodeImage(image);
    if (session.cacheBytes + image.width * image.height * 4 <= DECODE_CACHE_LIMIT) {
        session.cacheBytes += image.width * image.height * 4;
        image.source = bitmap;
    }
    return bitmap;
}

function releaseSources() {
    if (!session) return;
    for (const image of session.images) {
        if (image.source) image.source.close();
        image.source = null;
    }
    session.cacheBytes = 0;
}

async function encodeImage(image, params) {
    const source = await getSource(image);
    const w = Math.max(1, Math.round(image.width * params.scale));
    const h = Math.max(1, Math.round(image.height * params.scale));
    const canvas = createCanvas(w, h);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(source, 0, 0, w, h);
    if (source !== image.source) source.close();
    return { bytes: await canvasToJpeg(canvas, params.quality), width: w, height: h };
}

// 強さ(0-100)に対する各画像の再圧縮結果と、PDF全体の予想サイズ
async function getPlan(strength) {
    const key = Math.round(strength);
    if (session.plans.has(key)) return session.plans.get(key);

    const params = strengthToParams(key);
    const replacements = new Map();
    let saved = 0;
    for (let i = 0; i < session.images.length; i++) {
        const image = session.images[i];
        try {
            const result = await encodeImage(image, params);
            if (result.bytes.length < image.origBytes * 0.95) {
                replacements.set(i, result);
                saved += image.origBytes - result.bytes.length;
            }
        } catch (e) {
            console.warn('image recompress skipped', e);
        }
    }
    const plan = { strength: key, replacements, size: Math.max(0, session.baseSize - saved) };
    session.plans.set(key, plan);
    return plan;
}

async function buildPdf(plan) {
    const { PDFName } = PDFLib;
    const ctx = session.pdfDoc.context;

    session.images.forEach((image, i) => {
        const r = plan ? plan.replacements.get(i) : null;
        if (!r) {
            ctx.assign(image.ref, image.obj);
            return;
        }
        const dict = image.obj.dict;
        const extra = {};
        const sMask = dict.get(PDFName.of('SMask'));
        if (sMask) extra.SMask = sMask;
        ctx.assign(image.ref, ctx.stream(r.bytes, {
            Type: 'XObject',
            Subtype: 'Image',
            Width: r.width,
            Height: r.height,
            ColorSpace: image.comps === 3 ? dict.get(PDFName.of('ColorSpace')) : 'DeviceRGB',
            BitsPerComponent: 8,
            Filter: 'DCTDecode',
            ...extra,
        }));
    });
    return await session.pdfDoc.save({ useObjectStreams: session.useObjectStreams });
}

function toResult(bytes, extra) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    return { url: URL.createObjectURL(blob), size: bytes.length, ...extra };
}

async function renderRaster(level) {
    const pdfjsLib = window.pdfjsLib;
    const loadingTask = pdfjsLib.getDocument({
        data: session.bytes.slice(),
        cMapUrl: pdfjsLib.GlobalWorkerOptions.cMapUrl,
        cMapPacked: pdfjsLib.GlobalWorkerOptions.cMapPacked,
        standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
        wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
        openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl,
        verbosity: 0,
    });
    const pdf = await loadingTask.promise;
    try {
        const out = await PDFLib.PDFDocument.create();
        for (let n = 1; n <= pdf.numPages; n++) {
            const page = await pdf.getPage(n);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: level.dpi / 72 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(viewport.width));
            canvas.height = Math.max(1, Math.round(viewport.height));
            const g = canvas.getContext('2d', { alpha: false });
            g.fillStyle = '#fff';
            g.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: g, viewport }).promise;
            const jpg = await canvasToJpeg(canvas, level.quality);
            canvas.width = canvas.height = 0;
            page.cleanup();

            const image = await out.embedJpg(jpg);
            const pdfPage = out.addPage([base.width, base.height]);
            pdfPage.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
        }
        return await out.save({ useObjectStreams: true });
    } finally {
        try { pdf.destroy(); } catch { /* 無視 */ }
    }
}

async function openSession(data) {
    await closeSessionInternal();
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const pdfDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const encrypted = pdfDoc.isEncrypted;
    const { images, skipped } = encrypted ? { images: [], skipped: { count: 0, bytes: 0 } } : collectImages(pdfDoc);

    // pdf-lib はストリームを再圧縮しないため、再保存でサイズが増える場合がある。小さくなる保存方式を選ぶ
    let baseSize = bytes.length;
    let useObjectStreams = true;
    if (!encrypted) {
        const packed = (await pdfDoc.save({ useObjectStreams: true })).length;
        const plain = (await pdfDoc.save({ useObjectStreams: false })).length;
        useObjectStreams = packed <= plain;
        baseSize = Math.min(packed, plain);
    }

    session = { bytes, pdfDoc, images, baseSize, useObjectStreams, encrypted, plans: new Map(), cacheBytes: 0 };
    return {
        pageCount: pdfDoc.getPageCount(),
        size: bytes.length,
        encrypted,
        imageCount: images.length,
        imageBytes: images.reduce((sum, i) => sum + i.origBytes, 0),
        skippedCount: skipped.count,
        skippedBytes: skipped.bytes,
    };
}

async function closeSessionInternal() {
    releaseSources();
    if (session && session.pdfjsWorker) {
        try { session.pdfjsWorker.destroy(); } catch { /* 無視 */ }
    }
    session = null;
}

// 強さごとの予想サイズ(アンカー点)。画像が無い場合は元サイズのみ
async function estimate() {
    if (!session) return [];
    const originalSize = session.bytes.length;
    const base = Math.min(originalSize, session.baseSize);
    if (session.encrypted || session.images.length === 0) {
        return ESTIMATE_ANCHORS.map(strength => ({ strength, size: base }));
    }
    const result = [];
    for (const strength of ESTIMATE_ANCHORS) {
        const plan = await getPlan(strength);
        result.push({ strength, size: Math.min(originalSize, plan.size) });
    }
    return result;
}

async function compressByStrength(strength) {
    if (session.encrypted || session.images.length === 0) {
        const bytes = await buildPdf(null);
        return finalize(bytes, { strength, mode: 'vector' });
    }
    const plan = await getPlan(strength);
    const bytes = await buildPdf(plan);
    return finalize(bytes, { strength, mode: 'vector' });
}

function finalize(bytes, extra) {
    if (bytes.length >= session.bytes.length) {
        return toResult(session.bytes, { ...extra, unchanged: true });
    }
    return toResult(bytes, { ...extra, unchanged: false });
}

// 目標サイズに収まる最小の強さを二分探索する。ベクター(画像再圧縮)で届かない場合は needsRaster を返す
async function compressToTarget(targetBytes) {
    if (!session.encrypted && session.images.length > 0) {
        let lo = 0, hi = 100;
        while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            const plan = await getPlan(mid);
            if (plan.size <= targetBytes * 0.98) hi = mid; else lo = mid + 1;
        }

        // 予想サイズとの差を実測で確認し、届かなければ強さを上げて再試行する
        let strength = lo;
        let bestSize = Infinity;
        while (true) {
            const bytes = await buildPdf(await getPlan(strength));
            bestSize = bytes.length;
            if (bytes.length <= targetBytes) {
                return finalize(bytes, { strength, mode: 'vector', reached: true });
            }
            if (strength >= 100) break;
            strength = Math.min(100, strength + 3);
        }
        return { needsRaster: true, bestVectorSize: Math.min(bestSize, session.bytes.length) };
    }

    if (session.bytes.length <= targetBytes) {
        return toResult(session.bytes, { mode: 'vector', reached: true, unchanged: true });
    }
    return { needsRaster: true, bestVectorSize: session.bytes.length };
}

// ページ画像化: 目標サイズに収まる最も高画質な段階を二分探索する
async function compressRasterToTarget(targetBytes) {
    const cache = new Map();
    const render = async (i) => {
        if (!cache.has(i)) cache.set(i, await renderRaster(RASTER_LEVELS[i]));
        return cache.get(i);
    };

    let lo = 0, hi = RASTER_LEVELS.length - 1;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const bytes = await render(mid);
        if (bytes.length <= targetBytes) hi = mid; else lo = mid + 1;
    }
    const bytes = await render(lo);
    const level = RASTER_LEVELS[lo];
    return toResult(bytes, {
        mode: 'raster',
        dpi: level.dpi,
        reached: bytes.length <= targetBytes,
        unchanged: false,
    });
}

// 圧縮率(0-100)に応じた段階でページを画像化する
async function compressRasterByStrength(strength) {
    const index = Math.round(Math.min(100, Math.max(0, strength)) / 100 * (RASTER_LEVELS.length - 1));
    const level = RASTER_LEVELS[index];
    const bytes = await renderRaster(level);
    return finalize(bytes, { mode: 'raster', dpi: level.dpi, reached: true });
}

window.pdfCompress = {
    open: (data) => enqueue(() => openSession(data)),
    estimate: () => enqueue(estimate),
    compress: (strength) => enqueue(() => compressByStrength(strength)),
    compressToTarget: (targetBytes) => enqueue(() => compressToTarget(targetBytes)),
    compressRasterToTarget: (targetBytes) => enqueue(() => compressRasterToTarget(targetBytes)),
    compressRaster: (strength) => enqueue(() => compressRasterByStrength(strength)),
    close: () => enqueue(closeSessionInternal),
};
