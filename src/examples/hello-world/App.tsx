import type { ViewDescription } from "ruseact-dom";

export function createView(): ViewDescription {
  return (
    <main class="example-page">
      <nav class="site-nav" aria-label="Example navigation">
        <a class="brand" href="/" aria-label="Ruseact Playground home">
          <span class="brand-mark" aria-hidden="true">
            <span class="brand-mark-line brand-mark-line-long"></span>
            <span class="brand-mark-line brand-mark-line-short"></span>
            <span class="brand-mark-line brand-mark-line-long"></span>
            <span class="brand-mark-dot"></span>
          </span>
          <span>Ruseact Playground</span>
        </a>
        <span class="nav"><a href="/">Examples</a><a href="https://github.com/MaduroLabs/ruseact-example">Source</a><span class="version-note">alpha.1</span></span>
      </nav>
      <section class="example-card" aria-labelledby="hello-title">
        <div class="surface-header"><span class="route">/hello.html</span><span class="surface-label">Preview</span></div>
        <h1 id="hello-title">Hello, world!</h1>
        <p class="example-description">Package loading, explicit WebAssembly initialization, and static native DOM rendering.</p>
        <p class="source-note">Explore <a href="https://github.com/MaduroLabs/ruseact-example/blob/main/src/examples/hello-world/App.tsx">the Hello World source</a>.</p>
        <div class="example-footer"><span>Ruseact alpha.1 uses the actual consumer runtime.</span><a href="/">All examples</a></div>
      </section>
    </main>
  );
}
