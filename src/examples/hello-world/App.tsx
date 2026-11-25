import type { ViewDescription } from "ruseact-dom";

export function createView(): ViewDescription {
  return (
    <main class="example-page">
      <section class="example-card" aria-labelledby="hello-title">
        <p class="eyebrow">Ruseact bootstrap</p>
        <h1 id="hello-title">Ruseact</h1>
        <h2>Hello, world!</h2>
        <p>Your first Ruseact application.</p>
        <a href="/">Back to examples</a>
      </section>
    </main>
  );
}
