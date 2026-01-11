import fs from "fs";
import path from "path";
import minimist from "minimist";
import bounds from "svg-path-bounds";
import svgpath from "svgpath";

const argv = minimist(process.argv.slice(2));

function readInput() {
  if (argv.file) {
    return fs.readFileSync(path.resolve(argv.file), "utf8");
  }
  if (argv.d) {
    return argv.d;
  }
  // --decimals Nをつけると小数点以下N桁に丸める
  console.error('Usage: node tools/svg-bbox.js --d "<path d>" OR --file path/to/d.txt');
  process.exit(2);
}

function roundNumbersInPath(d, decimals) {
  if (decimals == null) return d;
  const dec = Math.max(0, Math.floor(Number(decimals) || 0));
  return d.replace(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi, (num) => {
    // leave integers as-is to avoid unnecessary .0
    if (!num.includes('.') && !num.toLowerCase().includes('e')) return num;
    const n = Number(num);
    if (!isFinite(n)) return num;
    let s = n.toFixed(dec);
    s = s.replace(/\.?0+$/,''); // trim trailing zeros
    return s;
  });
}

let d = null;

try {
  // read raw input
  d = readInput();

  // sanitize: remove CR, normalize whitespace, remove common invisible chars
  d = d.replace(/\r/g, "")
       .replace(/[\u200B\u200C\u200D\uFEFF]/g, "") // zero-width etc
       .replace(/\s+/g, " ")
       .trim();

  const [xmin, ymin, xmax, ymax] = bounds(d);
  const width = Math.max(0, xmax - xmin);
  const height = Math.max(0, ymax - ymin);

  // translate path so top-left becomes (0,0) ; transform not used in output path
  const translated = svgpath(d).translate(-xmin, -ymin).abs().toString();

  // optional rounding
  const decimals = argv.decimals ?? argv.dec ?? null;
  const translatedRounded = decimals != null ? roundNumbersInPath(translated, decimals) : null;

  const result = {
    xmin, ymin, xmax, ymax,
    width, height,
    viewBox: `0 0 ${width} ${height}`,
    translatedPath: translated
  };

  if (translatedRounded != null) {
    result.translatedPathRounded = translatedRounded;
  }

  const out = JSON.stringify(result, null, 2);
  if (argv.out) {
    fs.writeFileSync(path.resolve(argv.out), out, "utf8");
    console.log("wrote:", argv.out);
  } else {
    console.log(out);
  }
} catch (e) {
  console.error("error:", e && e.message ? e.message : e);
  // debug output to inspect problematic input
  console.error("input (json):", JSON.stringify(d));
  try {
    console.error("input (hex):", Buffer.from(d || "", "utf8").toString("hex"));
  } catch (_) {}
  process.exit(1);
}