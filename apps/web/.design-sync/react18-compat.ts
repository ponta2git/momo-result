// Claude Design canvases run React 18, while shared/ui targets React 19. The bundle borrows the
// page's window.React / window.ReactDOM, so patch the two React 19 features shared/ui relies on
// before any component module runs. No-op on React 19+ (the app and the system's own previews).
type ReactGlobal = {
  createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown;
  version: string;
};
type ReactDomGlobal = { useFormStatus?: () => unknown };

// @types/react declares a UMD `React` global with React 19 signatures; read the runtime shape instead.
const host = globalThis as unknown as { React?: ReactGlobal; ReactDOM?: ReactDomGlobal };
const react = host.React;

if (react && Number(react.version.split(".")[0]) < 19) {
  // react-dom 19 `useFormStatus` (Button, IconButton). A canvas never submits a form, so idle.
  const reactDom = host.ReactDOM;
  if (reactDom && typeof reactDom.useFormStatus !== "function") {
    const idle = Object.freeze({ action: null, data: null, method: null, pending: false });
    reactDom.useFormStatus = () => idle;
  }

  // React 19 renders `<Context value>` as its Provider; React 18 would treat it as a Consumer
  // (Tooltip, DialogLayer, PortalContainer).
  const contextType = Symbol.for("react.context");
  const createElement = react.createElement;
  react.createElement = (type, props, ...children) => {
    const context = type as { $$typeof?: symbol; Provider?: unknown } | null;
    const provides =
      context?.$$typeof === contextType &&
      context.Provider !== undefined &&
      typeof props === "object" &&
      props !== null &&
      Object.hasOwn(props, "value");
    return createElement(provides ? context?.Provider : type, props, ...children);
  };
}
