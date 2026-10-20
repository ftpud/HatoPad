# Workflow editor modules

`../HarnessPanel.tsx` preserves the public component, props, and helper exports
used by App, the run view, and their tests.

- `useHarnessEditor.tsx` owns editor state, history, lifecycle effects, and actions.
- `HarnessEditorView.tsx` composes the picker, settings, summaries, and editor regions.
- `HarnessCanvasEditor.tsx`, `HarnessInspector.tsx`, and `HarnessToolbar.tsx` render
  the canvas, block/edge inspector, and editing controls.
- `BlockRunDetails.tsx`, `PauseResolution.tsx`, and the `Workflow*` components render
  run progress, conversation, output, and comparison views.
- `geometry.ts`, `definition.ts`, `clipboard.ts`, and `block-catalog.ts` contain
  shared calculations, validation, import/export, and block metadata.
- `types.ts` retains the public props; `view-types.ts` adds presentation-only values
  to the inferred editor model.

Keep hooks unconditional and preserve keyed run/block components when moving
markup. The existing HarnessPanel and WorkflowRunPanel interaction tests exercise
editing, keyboard navigation, drag geometry, imports, pauses, and run controls.
