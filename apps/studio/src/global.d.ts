/**
 * Build-time constants defined in vite.config.ts. They are substituted as
 * literals, which is what lets the public build drop the feedback layer.
 */
declare const __SC_ALPHA__: boolean;
/** GitHub "new issue" URL for the private alpha feedback repo. '' when unset. */
declare const __SC_ISSUE_URL__: string;
/** Short git SHA, suffixed `-alpha` in the alpha build. */
declare const __SC_BUILD__: string;

/**
 * Vite's `?inline` suffix: the stylesheet arrives as a string instead of as a
 * side-effecting import, so it is tree-shaken with the code that uses it
 * rather than extracted into the shared bundle.
 */
declare module '*.css?inline' {
  const css: string;
  export default css;
}
