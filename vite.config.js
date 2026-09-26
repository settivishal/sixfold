// Relative base so the build works from any sub-path (GitHub Pages, a folder, a file server).
// three.js gets its own chunk: it's 90% of the bytes and rarely changes, so it stays cached across deploys.
export default {
  base: './',
  build: {
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } },
    },
  },
};
