import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as PDFLib from 'pdf-lib';

globalThis.DOMMatrix ??= class DOMMatrix {};
const pdfjs = await import('../wwwroot/lib/pdfjs/pdf.mjs');
const source = fs.readFileSync(new URL('../wwwroot/js/pdf-utils.js', import.meta.url), 'utf8');

function createApp(pdfjsLib = pdfjs, document = undefined) {
    const window = { pdfjsLib };
    const fetchConfig = async () => ({
        json: async () => ({ pdfSettings: { scales: { thumbnail: 1 } } })
    });
    new Function('window', 'document', 'PDFLib', 'fetch', source)(window, document, PDFLib, fetchConfig);
    return window;
}

async function pdfBytes(rotations) {
    const doc = await PDFLib.PDFDocument.create();
    for (const angle of rotations) {
        const page = doc.addPage([200, 300]);
        page.setRotation(PDFLib.degrees(angle));
        page.drawRectangle({ x: 10, y: 20, width: 20, height: 30 });
    }
    return doc.save();
}

async function readBlob(url) {
    const response = await fetch(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    URL.revokeObjectURL(url);
    return bytes;
}

async function rotations(bytes) {
    const doc = await PDFLib.PDFDocument.load(bytes);
    return doc.getPages().map(page => page.getRotation().angle);
}

test('merge paths apply every absolute angle, including zero, and retain omitted rotations', async () => {
    const app = createApp();
    for (const original of [0, 90, 180, 270]) {
        const bytes = await pdfBytes([original]);
        app.setStoredPageData('file', 0, bytes);
        for (const angle of [0, 90, 180, 270]) {
            const fromStorage = await readBlob(await app.mergePdfPagesFromStorage([
                { fileId: 'file', pageIndex: 0, rotateAngle: angle }
            ]));
            const direct = await readBlob(await app.mergePDFPages([
                { pageData: bytes, rotateAngle: angle }
            ]));
            assert.deepEqual(await rotations(fromStorage), [angle]);
            assert.deepEqual(await rotations(direct), [angle]);
            const pdf = await pdfjs.getDocument({ data: fromStorage }).promise;
            const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
            assert.equal(viewport.width, angle % 180 === 0 ? 200 : 300);
            assert.equal(viewport.height, angle % 180 === 0 ? 300 : 200);
            await pdf.destroy();
        }
        const combined = await readBlob(await app.mergePDFPages([{ pageData: bytes }]));
        assert.deepEqual(await rotations(combined), [original]);
    }
});

test('mixed page rotations are read separately before editing', async () => {
    const app = createApp();
    const bytes = await pdfBytes([270, 0, 90, 180]);
    assert.deepEqual(Array.from(await app.getPDFPageRotations(bytes)), [270, 0, 90, 180]);
});

test('vector crop maps displayed coordinates at all rotations', async () => {
    const app = createApp();
    const bytes = await pdfBytes([270]);
    const base64 = Buffer.from(bytes).toString('base64');
    const expected = {
        0: { x: 20, y: 150, width: 60, height: 90 },
        90: { x: 40, y: 30, width: 60, height: 90 },
        180: { x: 120, y: 60, width: 60, height: 90 },
        270: { x: 100, y: 180, width: 60, height: 90 }
    };
    for (const angle of [0, 90, 180, 270]) {
        const output = await app.cropPdfPageToTrimVector(base64, 0.1, 0.2, 0.3, 0.3, angle);
        const doc = await PDFLib.PDFDocument.load(output);
        assert.deepEqual(doc.getPage(0).getCropBox(), expected[angle]);
    }
});

test('vector tiles retain the requested rotation, including after combining', async () => {
    const app = createApp();
    const base64 = Buffer.from(await pdfBytes([270])).toString('base64');
    for (const angle of [0, 90, 180, 270]) {
        const urls = await app.splitPdfPageIntoTiles(base64, 2, 'horizontal', false, angle);
        assert.equal(urls.length, 2);
        const tileBytes = await Promise.all(urls.map(readBlob));
        for (const bytes of tileBytes) assert.deepEqual(await rotations(bytes), [angle]);
        const merged = await readBlob(await app.mergePDFPages(tileBytes.map(pageData => ({ pageData }))));
        assert.deepEqual(await rotations(merged), [angle, angle]);
    }
});

test('raster tiles rotate the canvas and swap dimensions for quarter turns', async () => {
    const calls = [];
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==';
    const document = {
        createElement() {
            const canvas = {
                width: 0, height: 0,
                getContext() {
                    return {
                        fillRect() {},
                        translate: (...args) => calls.push(['translate', ...args]),
                        rotate: (...args) => calls.push(['rotate', ...args]),
                        drawImage() {}
                    };
                },
                toDataURL: () => `data:image/png;base64,${png}`
            };
            return canvas;
        }
    };
    const fakePdfjs = {
        GlobalWorkerOptions: {},
        getDocument: () => ({
            promise: Promise.resolve({
                getPage: async () => ({
                    getViewport: () => ({ width: 400, height: 600 }),
                    render: () => ({ promise: Promise.resolve() })
                }),
                destroy() {}
            })
        })
    };
    const app = createApp(fakePdfjs, document);
    const base64 = Buffer.from(await pdfBytes([270])).toString('base64');
    for (const angle of [0, 90, 180, 270]) {
        calls.length = 0;
        const urls = await app.splitPdfPageIntoTiles(base64, 2, 'horizontal', true, angle);
        assert.equal(urls.length, 2);
        const tile = await PDFLib.PDFDocument.load(await readBlob(urls[0]));
        URL.revokeObjectURL(urls[1]);
        const size = tile.getPage(0).getSize();
        assert.deepEqual(size, angle % 180 === 0
            ? { width: 400, height: 300 }
            : { width: 300, height: 400 });
        assert.ok(calls.some(call => call[0] === 'rotate' && call[1] === angle * Math.PI / 180));
        if (angle !== 0) {
            const expected = { 90: [300, 0], 180: [400, 300], 270: [0, 400] }[angle];
            assert.ok(calls.some(call => call[0] === 'translate' &&
                call[1] === expected[0] && call[2] === expected[1]));
        }
    }
});

test('N-up uses clockwise PDF rotation in its drawing transform', async () => {
    const app = createApp();
    const base64 = Buffer.from(await pdfBytes([270])).toString('base64');
    for (const angle of [0, 90, 180, 270]) {
        const bytes = await readBlob(await app.createNUpPdf(
            [{ pageData: base64, rotateAngle: angle }], 2, 'horizontal', 'landscape'
        ));
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        const operators = await (await doc.getPage(1)).getOperatorList();
        const transforms = operators.fnArray
            .map((op, index) => op === pdfjs.OPS.transform ? operators.argsArray[index] : null)
            .filter(Boolean);
        const expected = {
            0: [1, 0, 0, 1],
            90: [0, -1, 1, 0],
            180: [-1, 0, 0, -1],
            270: [0, 1, -1, 0]
        }[angle];
        assert.ok(transforms.some(matrix =>
            expected.every((value, i) => Math.abs(matrix[i] - value) < 0.00001)));
        await doc.destroy();
    }
});

test('provided PDF can be returned to its unrotated landscape orientation', {
    skip: !process.env.PDF_ROTATION_FIXTURE
}, async () => {
    const app = createApp();
    const bytes = new Uint8Array(fs.readFileSync(process.env.PDF_ROTATION_FIXTURE));
    assert.deepEqual(Array.from(await app.getPDFPageRotations(bytes.slice())), [270]);
    app.setStoredPageData('fixture', 0, bytes);
    const output = await readBlob(await app.mergePdfPagesFromStorage([
        { fileId: 'fixture', pageIndex: 0, rotateAngle: 0 }
    ]));
    const pdf = await pdfjs.getDocument({ data: output }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    assert.equal(page.rotate, 0);
    assert.ok(viewport.width > viewport.height);
    await pdf.destroy();
});
