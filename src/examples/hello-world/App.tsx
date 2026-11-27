import type { ViewDescription } from "ruseact-dom";

export function createView(): ViewDescription {
  return (
    <main class="example-page">
      <nav class="site-nav" aria-label="Example navigation">
        <a class="brand" href="/"><span class="brand-mark">R</span> Ruseact</a>
        <span class="page-index">Example 01 / 05</span>
      </nav>
      <section class="example-card" aria-labelledby="hello-title">
        <p class="eyebrow">Ruseact bootstrap</p>
        <h1 id="hello-title">Ruseact</h1>
        <h2>Hello, world!</h2>
        <p>Package loading, explicit WebAssembly initialization, and static native DOM rendering.</p>
        <p class="source-note">Explore <a href="https://github.com/MaduroLabs/ruseact-example/blob/main/src/examples/hello-world/App.tsx">the Hello World source</a>.</p>
        <a href="/">Back to examples</a>
      </section>
    </main>
  );
}
