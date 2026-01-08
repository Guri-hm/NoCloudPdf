import fs from "fs";
import path from "path";
import minimist from "minimist";
import bounds from "svg-path-bounds";
import svgpath from "svgpath";

const argv = minimist(process.argv.slice(2));

function readInput() {
  if (argv.file) {
    return fs.readFileSync(path.resolve(argv.file), "utf8").trim();
  }
  if (argv.d) {
    return argv.d;
  }
  console.error('Usage: node tools/svg-bbox.js --d "<path d>" OR --file path/to/d.txt');
  process.exit(2);
}

try {
  const d = readInput();
  const [xmin, ymin, xmax, ymax] = bounds(d);
  const width = Math.max(0, xmax - xmin);
  const height = Math.max(0, ymax - ymin);

  // translate path so top-left becomes (0,0) ; transform not used in output path
  const translated = svgpath(d).translate(-xmin, -ymin).abs().toString();

  const result = {
    xmin, ymin, xmax, ymax,
    width, height,
    viewBox: `0 0 ${width} ${height}`,
    translatedPath: translated
  };

  const out = JSON.stringify(result, null, 2);
  if (argv.out) {
    fs.writeFileSync(path.resolve(argv.out), out, "utf8");
    console.log("wrote:", argv.out);
  } else {
    console.log(out);
  }
} catch (e) {
  console.error("error:", e && e.message ? e.message : e);
  process.exit(1);
}