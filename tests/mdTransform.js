// Imports a .md file as its text, as esbuild's "text" loader does.
module.exports = {
  process(src) {
    return { code: `module.exports = ${JSON.stringify(src)};` };
  },
};
