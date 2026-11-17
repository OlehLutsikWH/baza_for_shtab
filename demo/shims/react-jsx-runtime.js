// react/jsx-runtime поверх UMD React 18 (у UMD-збірці його немає) — для бібліотек на кшталт react-pdf.
const R = window.React;
export const Fragment = R.Fragment;
function make(type, props, key, spread) {
  const { children, ...rest } = props || {};
  if (key !== undefined) rest.key = key;
  if (children === undefined) return R.createElement(type, rest);
  return spread && Array.isArray(children) ? R.createElement(type, rest, ...children) : R.createElement(type, rest, children);
}
export const jsx = (type, props, key) => make(type, props, key, false);
export const jsxs = (type, props, key) => make(type, props, key, true);
export const jsxDEV = jsx;
