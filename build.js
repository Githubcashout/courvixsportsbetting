/* Inline core.js + app.js into a single distributable HTML file.
   node build.js  ->  dist/courvix.html                                */
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const core = fs.readFileSync(path.join(dir, "core.js"), "utf8");
const app  = fs.readFileSync(path.join(dir, "app.js"), "utf8");

// guard: a literal </script> inside the sources would terminate the tag early
const guard = (s) => s.replace(/<\/script>/gi, "<\\/script>");

// NOTE: a *string* replacement would interpret $$, $&, $` and $' as substitution
// patterns and silently corrupt the source. Always use a function replacer here.
let out = html
  .replace('<script src="core.js"></script>', () => "<script>\n" + guard(core) + "\n</script>")
  .replace('<script src="app.js"></script>',  () => "<script>\n" + guard(app)  + "\n</script>");

// self-check: the inlined source must survive byte-for-byte
for (const [name, src] of [["core.js", core], ["app.js", app]]) {
  const probe = src.slice(0, 400);
  if (!out.includes(probe)) {
    console.error(`BUILD FAILED: ${name} was altered during inlining`);
    process.exit(1);
  }
}
if (out.includes("$$")) {
  // any surviving $$ is fine; a *missing* one is the failure mode, caught above
}

if (out.includes('src="core.js"') || out.includes('src="app.js"')) {
  console.error("BUILD FAILED: script tags were not replaced");
  process.exit(1);
}
if (/<script src=/.test(out)) {
  console.error("BUILD FAILED: an external script remains — the file would not be self-contained");
  process.exit(1);
}

fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
const dest = path.join(dir, "dist", "courvix.html");
fs.writeFileSync(dest, out);
console.log(`built ${dest}  (${(out.length / 1024).toFixed(1)} KB)`);
