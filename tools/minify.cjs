// Builds the small file that goes into the mod.io zip:
//   node --expose-internals tools/minify.cjs setup.mjs out/setup.mjs
// It removes comments and whitespace and gives the mod's own internal names short ones.
// Then it checks that the result is the same program as the source (same code once the names are mapped back).
const fs = require("fs");
const acorn = require("internal/deps/acorn/acorn/dist/acorn");
const walk = require("internal/deps/acorn/acorn-walk/dist/walk");
const [, , inp, outp] = process.argv;
const opts = { ecmaVersion: "latest", sourceType: "module" };

// ---- stage 1: short names for everything declared once at the top of setup() ----
const patIds = (n, out = []) => {
  if (!n) return out;
  if (n.type === "Identifier") out.push(n);
  else if (n.type === "ObjectPattern") n.properties.forEach((p) => patIds(p.type === "RestElement" ? p.argument : p.value, out));
  else if (n.type === "ArrayPattern") n.elements.forEach((e) => patIds(e, out));
  else if (n.type === "AssignmentPattern") patIds(n.left, out);
  else if (n.type === "RestElement") patIds(n.argument, out);
  return out;
};
const mangle = (code) => {
  const ast = acorn.parse(code, opts);
  const setupFn = ast.body.map((b) => (b.type === "ExportNamedDeclaration" ? b.declaration : b)).find((b) => b && b.type === "FunctionDeclaration" && b.id.name === "setup");
  const top = new Set();
  const iife = setupFn.body.body.find((st) => st.type === "ExpressionStatement" && st.expression.type === "CallExpression" && st.expression.callee.type === "ArrowFunctionExpression");
  for (const st of (iife ? iife.expression.callee.body : setupFn.body).body) {
    if (st.type === "VariableDeclaration") st.declarations.forEach((d) => patIds(d.id).forEach((i) => top.add(i.name)));
    else if (st.type === "FunctionDeclaration") top.add(st.id.name);
  }
  const declCount = new Map(), allNames = new Set(), uses = new Map();
  const decl = (id) => declCount.set(id.name, (declCount.get(id.name) ?? 0) + 1);
  walk.fullAncestor(ast, (n, _st, anc) => {
    if (n.type === "Identifier") allNames.add(n.name);
    if (n.type === "VariableDeclarator") patIds(n.id).forEach(decl);
    else if ((n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression")) { if (n.id) decl(n.id); n.params.forEach((p) => patIds(p).forEach(decl)); }
    else if (n.type === "CatchClause" && n.param) patIds(n.param).forEach(decl);
    else if (n.type === "ClassDeclaration" || n.type === "ClassExpression") { if (n.id) decl(n.id); }
  });
  const cand = new Set([...top].filter((n) => n !== "ctx" && n !== "setup" && declCount.get(n) === 1));
  const edits = [];
  const refs = [];
  walk.fullAncestor(ast, (n, _st, anc) => {
    if (n.type !== "Identifier" || !cand.has(n.name)) return;
    const par = anc[anc.length - 2];
    if (par) {
      if (par.type === "MemberExpression" && par.property === n && !par.computed) return;
      if ((par.type === "MethodDefinition" || par.type === "PropertyDefinition") && par.key === n && !par.computed) return;
      if ((par.type === "LabeledStatement" || par.type === "BreakStatement" || par.type === "ContinueStatement") && par.label === n) return;
      if (par.type === "Property" && par.key === n && !par.computed && !par.shorthand) return;
      if (par.type === "Property" && par.shorthand && par.key === n) return; // the value node is handled below
      if (par.type === "Property" && par.shorthand && par.value === n) { refs.push({ n, shorthand: true }); return; }
    }
    refs.push({ n, shorthand: false });
  });
  const freq = new Map();
  refs.forEach((r) => freq.set(r.n.name, (freq.get(r.n.name) ?? 0) + 1));
  const reserved = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static await async of get set undefined NaN Infinity arguments eval".split(" "));
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
  const gen = function* () { for (let len = 1; len < 4; len++) { const idx = Array(len).fill(0); for (;;) { yield idx.map((i) => alphabet[i]).join(""); let k = len - 1; while (k >= 0 && ++idx[k] === alphabet.length) idx[k--] = 0; if (k < 0) break; } } };
  const g = gen(), map = new Map();
  for (const name of [...freq.keys()].sort((a, b) => freq.get(b) - freq.get(a))) {
    let nn;
    do nn = g.next().value; while (allNames.has(nn) || reserved.has(nn) || /^\d/.test(nn));
    map.set(name, nn);
  }
  for (const { n, shorthand } of refs) edits.push([n.start, n.end, shorthand ? `${n.name}:${map.get(n.name)}` : map.get(n.name)]);
  edits.sort((a, b) => b[0] - a[0]);
  let out = code;
  for (const [s, e, r] of edits) out = out.slice(0, s) + r + out.slice(e);
  return { out, map };
};
const original = fs.readFileSync(inp, "utf8");
const { out: renamed, map: nameMap } = mangle(original);
const src = renamed;
const comments = [];
const toks = [...acorn.tokenizer(src, { ...opts, onComment: (b, t, s, e) => comments.push([s, e]) })].filter((t) => t.type.label !== "eof");
const word = /[\w$\u0080-￿]/;
const OPEN_OK = new Set(["{", "(", "[", ",", ";", "=>", ":", "=", "&&", "||", "??", "?", "+", "-", "*", "/", "%", "==", "===", "!=", "!==", "<", ">", "<=", ">=", "+=", "-=", "||=", "&&=", "??="]);
const NEXT_OK = new Set(["}", ")", "]", ",", ";", ".", "?.", ":", "?", "&&", "||", "??", "=>"]);
const text = (t) => src.slice(t.start, t.end);
let out = "";
let prev = null;
for (const t of toks) {
  const cur = text(t);
  if (prev) {
    const gap = src.slice(prev.end, t.start);
    const cm = comments.filter(([s, e]) => s >= prev.end && e <= t.start);
    const nl = /\n/.test(gap) || cm.some(([s, e]) => /\n/.test(src.slice(s, e)));
    const p = text(prev), pl = p[p.length - 1], cf = cur[0];
    const spaced = gap.length > 0 || cm.length > 0;
    if (nl) {
      if (!(OPEN_OK.has(p) && prev.type.label !== "string") && !NEXT_OK.has(cur)) out += "\n";
      else if (word.test(pl) && word.test(cf)) out += " ";
    } else if (spaced) {
      if ((word.test(pl) && word.test(cf)) || ((pl === "+" || pl === "-") && cf === pl) || (pl === "/" && (cf === "/" || cf === "*")) || (pl === "." && /\d/.test(cf)) || (/^\d+$/.test(p) && cf === ".")) out += " ";
    }
  }
  out += cur;
  prev = t;
}
// the result must be the same program as the source: map the short names back and compare
const inv = new Map([...nameMap].map(([a, b]) => [b, a]));
const strip = (n, back) => JSON.stringify(n, (k, v) => {
  if (k === "start" || k === "end" || k === "raw" || k === "shorthand") return undefined;
  if (back && v && v.type === "Identifier" && inv.has(v.name)) return { ...v, name: inv.get(v.name) };
  return v;
});
if (strip(acorn.parse(original, opts), false) !== strip(acorn.parse(out, opts), true)) { console.error("MISMATCH: the minified code is not the same program"); process.exit(1); }
fs.mkdirSync(require("path").dirname(outp), { recursive: true });
fs.writeFileSync(outp, out);
console.log(`${original.length} -> ${out.length} bytes, gzip ${require("zlib").gzipSync(out, { level: 9 }).length}`);
