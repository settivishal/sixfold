// App-wide event bus. Features subscribe here instead of being wired into main.js.
//   move      { tok, size, byUser }            every applied turn
//   solved    { size, byUser }                 the cube became solved
//   solve     { ms, pen, puzzle, kind, daily, blind, recording, start, scramble }  a timed solve finished
//   lesson    { }                              a Learn lesson reached the end
//   pattern   { }                              a designed pattern was saved
//   ghost     { won, diff }                    a ghost race finished
//   quiz      { streak }                       a recognition-quiz answer
//   challenge { won, diff }                    a challenge-link race finished
//   daily     { rank, total, ms }              a daily result was accepted by the server
const bus = new EventTarget();

export const emit = (type, detail = {}) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export function on(type, fn) {
  const handler = e => fn(e.detail);
  bus.addEventListener(type, handler);
  return () => bus.removeEventListener(type, handler);
}
