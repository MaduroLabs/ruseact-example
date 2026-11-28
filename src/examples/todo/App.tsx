import type { CoreResult, ReactiveCore, SignalHandle } from "ruseact";
import {
  defineComponent,
  type KeyedItemEnvironment,
  type RendererResult,
} from "ruseact-dom";
import type { TodoFilter, TodoViewContext } from "./model";

type ComponentTag = (props?: Record<string, unknown>) => unknown;

function readBoolean(
  runtime: ReactiveCore,
  signal: SignalHandle<boolean>,
): RendererResult<boolean> {
  return runtime.get(signal);
}

function readNumber(
  runtime: ReactiveCore,
  signal: SignalHandle<number>,
): CoreResult<number> {
  return runtime.get(signal);
}

function readTaskKey(
  runtime: ReactiveCore,
  signal: SignalHandle<number>,
): CoreResult<number> {
  return runtime.get(signal);
}

function readTaskKeyAttribute(
  runtime: ReactiveCore,
  signal: SignalHandle<number>,
): CoreResult<string> {
  const result = readTaskKey(runtime, signal);
  if (!result.ok) return result;
  return { ok: true, value: String(result.value) };
}

function readCompletedClass(
  runtime: ReactiveCore,
  signal: SignalHandle<boolean>,
): CoreResult<string> {
  const result = runtime.get(signal);
  if (!result.ok) return result;
  return { ok: true, value: result.value ? "todo-item is-completed" : "todo-item" };
}

function readFilterClass(
  runtime: ReactiveCore,
  signal: SignalHandle<string>,
  expected: TodoFilter,
): CoreResult<string> {
  const result = runtime.get(signal);
  if (!result.ok) return result;
  return { ok: true, value: result.value === expected ? "filter-button is-selected" : "filter-button" };
}

function readFilterPressed(
  runtime: ReactiveCore,
  signal: SignalHandle<string>,
  expected: TodoFilter,
): CoreResult<string> {
  const result = runtime.get(signal);
  if (!result.ok) return result;
  return { ok: true, value: result.value === expected ? "true" : "false" };
}

function readEditing(
  runtime: ReactiveCore,
  editingTaskId: SignalHandle<number>,
  taskKey: SignalHandle<number>,
): RendererResult<boolean> {
  const editing = runtime.get(editingTaskId);
  if (!editing.ok) return editing;
  const key = runtime.get(taskKey);
  if (!key.ok) return key;
  return { ok: true, value: editing.value === key.value };
}

function readDisabled(
  runtime: ReactiveCore,
  signal: SignalHandle<number>,
): CoreResult<boolean> {
  const result = runtime.get(signal);
  if (!result.ok) return result;
  return { ok: true, value: result.value === 0 };
}

function formInput(event: Event): HTMLInputElement | undefined {
  const form = event.currentTarget as HTMLFormElement;
  return form.querySelector<HTMLInputElement>("[data-testid=todo-input]") ?? undefined;
}

function editorInput(event: Event): HTMLInputElement | undefined {
  const button = event.currentTarget as HTMLElement;
  return button.closest<HTMLElement>("[data-testid=todo-editor]")?.querySelector<HTMLInputElement>("[data-testid=todo-edit-input]") ?? undefined;
}

export function createView(view: TodoViewContext): unknown {
  const TodoSummary = defineComponent("TodoSummary", () => ({
    ok: true,
    value: (
      <dl class="todo-summary" data-testid="todo-summary">
        <div>
          <dt>Total</dt>
          <dd data-testid="total-count">
            {ruseact.bindText([view.totalCount], ({ runtime: currentRuntime }) => readNumber(currentRuntime, view.totalCount))}
          </dd>
        </div>
        <div>
          <dt>Active</dt>
          <dd data-testid="active-count">
            {ruseact.bindText([view.activeCount], ({ runtime: currentRuntime }) => readNumber(currentRuntime, view.activeCount))}
          </dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd data-testid="completed-count">
            {ruseact.bindText(
              [view.completedCount],
              ({ runtime: currentRuntime }) => readNumber(currentRuntime, view.completedCount),
            )}
          </dd>
        </div>
      </dl>
    ),
  })) as unknown as ComponentTag;

  const EmptyState = defineComponent("TodoEmptyState", () => ({
    ok: true,
    value: (
      <p class="todo-empty" data-testid="todo-empty">
        No tasks match this filter.
      </p>
    ),
  })) as unknown as ComponentTag;

  const TodoItem = defineComponent("TodoItem", (props) => {
    const taskKey = props.taskKey as SignalHandle<number>;
    const title = props.title as SignalHandle<string>;
    const completed = props.completed as SignalHandle<boolean>;
    const setupKey = readTaskKey(view.runtime, taskKey);
    if (!setupKey.ok) throw new Error(setupKey.error.code);
    view.onItemSetup(setupKey.value);

    const currentTaskKey = (): number => {
      const result = readTaskKey(view.runtime, taskKey);
      if (!result.ok) throw new Error(result.error.code);
      return result.value;
    };

    return {
      ok: true,
      value: (
        <li
          class={ruseact.bindAttribute(
            [completed],
            ({ runtime: currentRuntime }) => readCompletedClass(currentRuntime, completed),
          )}
          data-testid="todo-item"
          data-task-key={ruseact.bindAttribute(
            [taskKey],
            ({ runtime: currentRuntime }) => readTaskKeyAttribute(currentRuntime, taskKey),
          )}
        >
          {ruseact.conditional(
            [view.editingTaskId],
            ({ runtime: currentRuntime }) => readEditing(currentRuntime, view.editingTaskId, taskKey),
            () =>
              <div class="todo-editor" data-testid="todo-editor">
                <label for="todo-edit-input">Edit task</label>
                <input
                  id="todo-edit-input"
                  data-testid="todo-edit-input"
                  type="text"
                  value={ruseact.bindProperty([title], ({ runtime: currentRuntime }) => currentRuntime.get(title))}
                />
                <div class="todo-actions">
                  <button
                    type="button"
                    data-testid="todo-save"
                    onClick={(event: Event) => {
                      view.onManagedEvent();
                      view.saveEdit(currentTaskKey(), editorInput(event)?.value ?? "");
                    }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    data-testid="todo-cancel"
                    onClick={() => {
                      view.onManagedEvent();
                      view.cancelEdit();
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>,
            () =>
              <div class="todo-row">
                <label class="todo-check">
                  <input
                    type="checkbox"
                    checked={ruseact.bindProperty(
                      [completed],
                      ({ runtime: currentRuntime }) => currentRuntime.get(completed),
                    )}
                    onChange={() => {
                      view.onManagedEvent();
                      view.toggleTodo(currentTaskKey());
                    }}
                  />
                  <span class="todo-title">
                    {ruseact.bindText([title], ({ runtime: currentRuntime }) => currentRuntime.get(title))}
                  </span>
                </label>
                <div class="todo-actions">
                  <button
                    type="button"
                    data-testid="todo-edit"
                    onClick={() => {
                      view.onManagedEvent();
                      view.beginEdit(currentTaskKey());
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    data-testid="todo-remove"
                    onClick={() => {
                      view.onManagedEvent();
                      view.removeTodo(currentTaskKey());
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>,
          )}
        </li>
      ),
    };
  }) as unknown as ComponentTag;

  const TodoApplication = defineComponent("TodoApplication", () => {
    view.onParentSetup();
    return {
      ok: true,
      value: (
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
          <section class="example-card todo-card" aria-labelledby="todo-title">
            <div class="surface-header"><span class="route">/todo.html</span><span class="surface-label">Preview</span></div>
            <h1 id="todo-title">Todo Application</h1>
            <p class="example-description">
              A small application model published from JavaScript, rendered through retained keyed items, and flushed
              explicitly at each event boundary.
            </p>

            <form class="todo-form" data-testid="todo-form" onSubmit={(event: Event) => {
              event.preventDefault();
              view.onManagedEvent();
              const input = formInput(event);
              if (input && view.addTodo(input.value)) input.value = "";
            }}>
              <label for="todo-input">New task</label>
              <div class="todo-create-row">
                <input id="todo-input" data-testid="todo-input" type="text" autocomplete="off" />
                <button type="submit" data-testid="todo-add">Add task</button>
              </div>
            </form>

            <TodoSummary />

            <div class="todo-toolbar" aria-label="Todo controls">
              <div class="todo-filters" aria-label="Task filters">
                <button
                  type="button"
                  class={ruseact.bindAttribute(
                    [view.filter],
                    ({ runtime: currentRuntime }) => readFilterClass(currentRuntime, view.filter, "all"),
                  )}
                  aria-pressed={ruseact.bindAttribute(
                    [view.filter],
                    ({ runtime: currentRuntime }) => readFilterPressed(currentRuntime, view.filter, "all"),
                  )}
                  onClick={() => {
                    view.onManagedEvent();
                    view.setFilter("all");
                  }}
                >
                  All
                </button>
                <button
                  type="button"
                  class={ruseact.bindAttribute(
                    [view.filter],
                    ({ runtime: currentRuntime }) => readFilterClass(currentRuntime, view.filter, "active"),
                  )}
                  aria-pressed={ruseact.bindAttribute(
                    [view.filter],
                    ({ runtime: currentRuntime }) => readFilterPressed(currentRuntime, view.filter, "active"),
                  )}
                  onClick={() => {
                    view.onManagedEvent();
                    view.setFilter("active");
                  }}
                >
                  Active
                </button>
                <button
                  type="button"
                  class={ruseact.bindAttribute(
                    [view.filter],
                    ({ runtime: currentRuntime }) => readFilterClass(currentRuntime, view.filter, "completed"),
                  )}
                  aria-pressed={ruseact.bindAttribute(
                    [view.filter],
                    ({ runtime: currentRuntime }) => readFilterPressed(currentRuntime, view.filter, "completed"),
                  )}
                  onClick={() => {
                    view.onManagedEvent();
                    view.setFilter("completed");
                  }}
                >
                  Completed
                </button>
              </div>
              <div class="todo-actions">
                <button
                  type="button"
                  data-testid="todo-reverse"
                  onClick={() => {
                    view.onManagedEvent();
                    view.reverseVisible();
                  }}
                >
                  Reverse order
                </button>
                <button
                  type="button"
                  data-testid="todo-clear-completed"
                  disabled={ruseact.bindProperty(
                    [view.completedCount],
                    ({ runtime: currentRuntime }) => readDisabled(currentRuntime, view.completedCount),
                  )}
                  onClick={() => {
                    view.onManagedEvent();
                    view.clearCompleted();
                  }}
                >
                  Clear completed
                </button>
              </div>
            </div>

            <ul class="todo-list" data-testid="todo-list">
              {ruseact.keyed(
                [view.revision],
                ({ runtime: currentRuntime }) => ({
                  ok: true,
                  value: view.getVisibleTodos().map((todo) => ({
                    key: todo.id,
                    fields: {
                      taskKey: todo.id,
                      title: todo.title,
                      completed: todo.completed,
                    },
                  })),
                }),
                ({ fields }: KeyedItemEnvironment) =>
                  <TodoItem taskKey={fields.taskKey} title={fields.title} completed={fields.completed} />
                ,
              )}
            </ul>

            {ruseact.conditional(
              [view.hasVisibleTodos],
              ({ runtime: currentRuntime }) => readBoolean(currentRuntime, view.hasVisibleTodos),
              () => null,
              () => <EmptyState />,
            )}

            <p class="manual-flush-note" data-testid="todo-flush-note">
              Writes invalidate explicit dependencies; retained item field updates may require a separate follow-up
              flush because each root.flush() drains one pending snapshot.
            </p>
            <p class="source-note">Explore <a href="https://github.com/MaduroLabs/ruseact-example/blob/main/src/examples/todo/App.tsx">the Todo source</a>. Keyed items retain scalar fields and native nodes while their JavaScript collection changes.</p>
            <div class="example-footer"><span>Each event keeps the flush boundary explicit.</span><a href="/">All examples</a></div>
          </section>
        </main>
      ),
    };
  }) as unknown as ComponentTag;

  return <TodoApplication />;
}
